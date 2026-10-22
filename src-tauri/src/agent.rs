//! Claude working on boards, through the person's own Claude Code. Mythra Board is only a
//! window onto it: Claude Code is installed and signed in by the person themselves, and runs
//! here in its non-interactive mode with nothing but the board tools (no files, no commands).
//!
//! The board tools are offered to Claude Code over MCP, from a tiny server on this computer
//! only. Each tool call is passed to the window that started the run, which carries it out on
//! the open board and sends the result back.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};

/// How long a single tool call may take before Claude is told it failed.
const TOOL_TIMEOUT: Duration = Duration::from_secs(120);
/// Requests to the tool server can't be bigger than this.
const MAX_REQUEST: usize = 8 * 1024 * 1024;

struct Run {
    window: String,
    tools: Value,
    child: Option<Child>,
}

#[derive(Default)]
pub struct Agent {
    runs: Mutex<HashMap<String, Run>>,
    pending: Mutex<HashMap<String, mpsc::Sender<Value>>>,
    server: OnceLock<(u16, String)>,
}

static NEXT_CALL: AtomicU64 = AtomicU64::new(1);

fn random_token() -> String {
    let mut bytes = [0u8; 24];
    getrandom::getrandom(&mut bytes).expect("no randomness available");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// ---------- Finding Claude Code ----------

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).map(PathBuf::from)
}

/// Where Claude Code is installed. Apps opened from the Dock don't see the Terminal's PATH,
/// so look in the usual places, then ask a login shell.
pub fn find_claude() -> Option<PathBuf> {
    let exe = if cfg!(windows) { "claude.exe" } else { "claude" };
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(h) = home() {
        candidates.push(h.join(".local/bin").join(exe));
        candidates.push(h.join(".claude/local").join(exe));
        candidates.push(h.join(".npm-global/bin").join(exe));
        candidates.push(h.join(".bun/bin").join(exe));
        candidates.push(h.join(".volta/bin").join(exe));
        if cfg!(windows) {
            candidates.push(h.join("AppData/Roaming/npm/claude.cmd"));
        }
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/claude"));
    candidates.push(PathBuf::from("/usr/local/bin/claude"));
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            candidates.push(dir.join(exe));
        }
    }
    if let Some(found) = candidates.into_iter().find(|p| p.is_file()) {
        return Some(found);
    }
    #[cfg(unix)]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let out = Command::new(shell).args(["-lc", "command -v claude"]).stdin(Stdio::null()).output().ok()?;
        let path = PathBuf::from(String::from_utf8_lossy(&out.stdout).trim());
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

/// A PATH that includes the usual install folders, for Claude Code and anything it starts.
fn search_path() -> std::ffi::OsString {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    if let Some(h) = home() {
        dirs.push(h.join(".local/bin"));
    }
    dirs.push("/opt/homebrew/bin".into());
    dirs.push("/usr/local/bin".into());
    dirs.push("/usr/bin".into());
    dirs.push("/bin".into());
    std::env::join_paths(dirs).unwrap_or_default()
}

#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeStatus {
    installed: bool,
    signed_in: bool,
    version: Option<String>,
    plan: Option<String>,
    email: Option<String>,
}

/// Whether Claude Code is installed and signed in, and with what.
#[tauri::command]
pub async fn claude_status() -> ClaudeStatus {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(claude) = find_claude() else { return ClaudeStatus::default() };
        let run = |args: &[&str]| {
            Command::new(&claude)
                .args(args)
                .env("PATH", search_path())
                .stdin(Stdio::null())
                .output()
                .ok()
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        };
        let version = run(&["--version"]).map(|v| v.split_whitespace().next().unwrap_or("").to_string()).filter(|v| !v.is_empty());
        let auth: Value = run(&["auth", "status", "--json"]).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
        let text = |k: &str| auth.get(k).and_then(Value::as_str).map(str::to_string);
        ClaudeStatus {
            installed: true,
            signed_in: auth.get("loggedIn").and_then(Value::as_bool).unwrap_or(false),
            version,
            plan: text("subscriptionType").or_else(|| text("authMethod")),
            email: text("email"),
        }
    })
    .await
    .unwrap_or_default()
}

// ---------- The tool server ----------

fn read_request(stream: &mut TcpStream) -> Option<(String, String, HashMap<String, String>, Vec<u8>)> {
    stream.set_read_timeout(Some(Duration::from_secs(30))).ok()?;
    let mut reader = BufReader::new(stream.try_clone().ok()?);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_string();
    let path = parts.next()?.to_string();
    let mut headers = HashMap::new();
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h).ok()? == 0 {
            break;
        }
        let h = h.trim_end();
        if h.is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }
    let len: usize = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    if len > MAX_REQUEST {
        return None;
    }
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body).ok()?;
    Some((method, path, headers, body))
}

fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.flush();
}

/// Answer one MCP message for a run.
fn answer<R: Runtime>(app: &AppHandle<R>, run_id: &str, msg: &Value) -> Option<Value> {
    let id = msg.get("id")?.clone();
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
    let agent = app.state::<Agent>();
    let result = match method {
        "initialize" => {
            let version = msg.pointer("/params/protocolVersion").cloned().unwrap_or(json!("2025-06-18"));
            json!({ "protocolVersion": version, "capabilities": { "tools": {} }, "serverInfo": { "name": "mythra-board", "version": env!("CARGO_PKG_VERSION") } })
        }
        "ping" => json!({}),
        "tools/list" => {
            let tools = agent.runs.lock().unwrap().get(run_id).map(|r| r.tools.clone()).unwrap_or(json!([]));
            json!({ "tools": tools })
        }
        "tools/call" => {
            let window = agent.runs.lock().unwrap().get(run_id).map(|r| r.window.clone());
            let Some(window) = window else {
                return Some(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32000, "message": "This run has ended." } }));
            };
            let call_id = format!("call-{}", NEXT_CALL.fetch_add(1, Ordering::Relaxed));
            let (tx, rx) = mpsc::channel();
            agent.pending.lock().unwrap().insert(call_id.clone(), tx);
            let name = msg.pointer("/params/name").cloned().unwrap_or(Value::Null);
            let args = msg.pointer("/params/arguments").cloned().unwrap_or(json!({}));
            let _ = app.emit_to(window.as_str(), "agent-tool", json!({ "callId": call_id, "name": name, "args": args }));
            let content = rx.recv_timeout(TOOL_TIMEOUT);
            agent.pending.lock().unwrap().remove(&call_id);
            match content {
                Ok(content) => json!({ "content": content }),
                Err(_) => json!({ "content": [{ "type": "text", "text": "The board didn't answer in time." }], "isError": true }),
            }
        }
        _ => return Some(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "Method not found" } })),
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

fn handle<R: Runtime>(app: AppHandle<R>, mut stream: TcpStream, token: &str) {
    let Some((method, path, headers, body)) = read_request(&mut stream) else { return };
    let authorised = headers.get("authorization").is_some_and(|v| v == &format!("Bearer {token}"));
    let run_id = path.strip_prefix("/mcp/").unwrap_or("").to_string();
    if !authorised || run_id.is_empty() {
        return respond(&mut stream, "401 Unauthorized", "{}");
    }
    if method != "POST" {
        return respond(&mut stream, "405 Method Not Allowed", "{}");
    }
    let Ok(msg) = serde_json::from_slice::<Value>(&body) else {
        return respond(&mut stream, "400 Bad Request", "{}");
    };
    match answer(&app, &run_id, &msg) {
        Some(reply) => respond(&mut stream, "200 OK", &reply.to_string()),
        // Notifications get no reply.
        None => respond(&mut stream, "202 Accepted", ""),
    }
}

/// The tool server's port and access token, starting it the first time it's needed.
fn server<R: Runtime>(app: &AppHandle<R>) -> Result<(u16, String), String> {
    let agent = app.state::<Agent>();
    if let Some(s) = agent.server.get() {
        return Ok(s.clone());
    }
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let token = random_token();
    let (app2, token2) = (app.clone(), token.clone());
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let (app, token) = (app2.clone(), token2.clone());
            std::thread::spawn(move || handle(app, stream, &token));
        }
    });
    let _ = agent.server.set((port, token));
    Ok(agent.server.get().cloned().unwrap())
}

// ---------- Runs ----------

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartOptions {
    run_id: String,
    prompt: String,
    system: String,
    tools: Value,
    model: String,
    resume: Option<String>,
}

fn safe_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 100 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Start Claude Code on a message from this window.
#[tauri::command]
pub fn agent_start<R: Runtime>(app: AppHandle<R>, window: WebviewWindow<R>, opts: StartOptions) -> Result<(), String> {
    if !safe_id(&opts.run_id) || !crate::ai::MODELS.contains(&opts.model.as_str()) {
        return Err("Invalid request".into());
    }
    if opts.resume.as_deref().is_some_and(|r| !safe_id(r)) {
        return Err("Invalid conversation id".into());
    }
    let claude = find_claude().ok_or("Claude Code isn't installed. Install it from claude.com/product/claude-code, then try again.")?;
    let (port, token) = server(&app)?;
    // Claude Code keeps conversations per folder; give it one of its own.
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("assistant");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mcp = json!({ "mcpServers": { "board": {
        "type": "http",
        "url": format!("http://127.0.0.1:{port}/mcp/{}", opts.run_id),
        "headers": { "Authorization": format!("Bearer {token}") },
    } } });
    let mut cmd = Command::new(&claude);
    cmd.current_dir(&dir)
        .env("PATH", search_path())
        .args(["-p", "--output-format", "stream-json", "--verbose", "--model", &opts.model])
        .args(["--system-prompt", &opts.system])
        // Only the board tools: no files, commands or web, and nothing from the person's own settings.
        .args(["--tools", "", "--strict-mcp-config", "--mcp-config", &mcp.to_string()])
        .args(["--allowedTools", "mcp__board", "--permission-prompts", "none", "--setting-sources", "", "--disable-slash-commands"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(resume) = &opts.resume {
        cmd.args(["--resume", resume]);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // no console window
    }
    let mut child = cmd.spawn().map_err(|e| format!("Couldn't start Claude Code: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("no input")?;
    let stdout = child.stdout.take().ok_or("no output")?;
    let mut stderr = child.stderr.take().ok_or("no error output")?;
    let label = window.label().to_string();
    app.state::<Agent>().runs.lock().unwrap().insert(opts.run_id.clone(), Run { window: label.clone(), tools: opts.tools, child: Some(child) });
    let prompt = opts.prompt;
    std::thread::spawn(move || {
        let _ = stdin.write_all(prompt.as_bytes());
    });
    let err_text = Arc::new(Mutex::new(String::new()));
    let err_sink = err_text.clone();
    std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        err_sink.lock().unwrap().push_str(&s);
    });
    let run_id = opts.run_id;
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            let _ = app.emit_to(label.as_str(), "agent-event", json!({ "runId": run_id, "kind": "line", "line": line }));
        }
        let agent = app.state::<Agent>();
        let child = agent.runs.lock().unwrap().get_mut(&run_id).and_then(|r| r.child.take());
        let code = child.and_then(|mut c| c.wait().ok()).and_then(|s| s.code());
        // Give the error reader a moment to finish.
        std::thread::sleep(Duration::from_millis(100));
        let stderr = err_text.lock().unwrap().chars().take(2000).collect::<String>();
        agent.runs.lock().unwrap().remove(&run_id);
        let _ = app.emit_to(label.as_str(), "agent-event", json!({ "runId": run_id, "kind": "exit", "code": code, "stderr": stderr }));
    });
    Ok(())
}

/// Stop a run. What Claude already did stays on the board.
#[tauri::command]
pub fn agent_stop<R: Runtime>(app: AppHandle<R>, run_id: String) {
    let agent = app.state::<Agent>();
    let child = agent.runs.lock().unwrap().get_mut(&run_id).and_then(|r| r.child.take());
    if let Some(mut c) = child {
        let _ = c.kill();
        let _ = c.wait();
    }
}

/// The board's answer to a tool call.
#[tauri::command]
pub fn agent_tool_result<R: Runtime>(app: AppHandle<R>, call_id: String, content: Value) {
    if let Some(tx) = app.state::<Agent>().pending.lock().unwrap().remove(&call_id) {
        let _ = tx.send(content);
    }
}

/// Stop every run started by a window that's closing.
pub fn stop_window_runs<R: Runtime>(app: &AppHandle<R>, label: &str) {
    let agent = app.state::<Agent>();
    let mut runs = agent.runs.lock().unwrap();
    for run in runs.values_mut().filter(|r| r.window == label) {
        if let Some(mut c) = run.child.take() {
            let _ = c.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_ids() {
        assert!(safe_id("run-123_abc"));
        assert!(!safe_id(""));
        assert!(!safe_id("../etc"));
        assert!(!safe_id("a b"));
    }

    #[test]
    fn reads_a_request() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let client = std::thread::spawn(move || {
            let mut s = TcpStream::connect(addr).unwrap();
            let body = r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#;
            write!(s, "POST /mcp/run-1 HTTP/1.1\r\nAuthorization: Bearer t\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
            let mut reply = String::new();
            s.read_to_string(&mut reply).unwrap();
            reply
        });
        let (mut stream, _) = listener.accept().unwrap();
        let (method, path, headers, body) = read_request(&mut stream).unwrap();
        assert_eq!(method, "POST");
        assert_eq!(path, "/mcp/run-1");
        assert_eq!(headers.get("authorization").unwrap(), "Bearer t");
        assert!(String::from_utf8(body).unwrap().contains("ping"));
        respond(&mut stream, "200 OK", "{}");
        drop(stream);
        assert!(client.join().unwrap().starts_with("HTTP/1.1 200 OK"));
    }
}
