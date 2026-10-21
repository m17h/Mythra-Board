//! Asking Claude for help, with the user's own API key. The key lives in the system
//! keychain and is only ever read here, so the page itself never sees it.

use serde_json::{json, Value};

const SERVICE: &str = "com.mythra.board";
const ACCOUNT: &str = "anthropic-api-key";
const API_URL: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2023-06-01";
pub const MODELS: [&str; 3] = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"];
const MAX_TOKENS: u32 = 4096;

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())
}

pub fn has_key() -> bool {
    entry().and_then(|e| e.get_password().map_err(|e| e.to_string())).is_ok_and(|k| !k.is_empty())
}

pub fn set_key(key: &str) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() || key.len() > 400 || key.chars().any(char::is_whitespace) {
        return Err("That doesn't look like an API key".into());
    }
    entry()?.set_password(key).map_err(|e| e.to_string())
}

pub fn clear_key() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn request_body(model: &str, system: &str, prompt: &str) -> Value {
    json!({
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": system,
        "messages": [{ "role": "user", "content": prompt }],
    })
}

/// The text of Claude's reply, or a plain-language error.
pub fn read_response(status: u16, body: &str) -> Result<String, String> {
    let value: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    if status != 200 {
        let detail = value.pointer("/error/message").and_then(Value::as_str).unwrap_or("");
        return Err(match status {
            401 | 403 => "Claude didn't accept the API key. Check it in Settings.".into(),
            429 => "Too many requests right now. Try again in a moment.".into(),
            529 | 503 => "Claude is busy right now. Try again in a moment.".into(),
            _ if detail.is_empty() => format!("Claude returned an error ({status})."),
            _ => format!("Claude returned an error: {detail}"),
        });
    }
    let text: String = value
        .get("content")
        .and_then(Value::as_array)
        .map(|blocks| blocks.iter().filter_map(|b| b.get("text").and_then(Value::as_str)).collect())
        .unwrap_or_default();
    if text.is_empty() {
        Err("Claude's reply was empty.".into())
    } else {
        Ok(text)
    }
}

pub async fn send(url: &str, key: &str, body: &Value) -> Result<String, String> {
    let response = reqwest::Client::new()
        .post(url)
        .header("x-api-key", key)
        .header("anthropic-version", API_VERSION)
        .json(body)
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| if e.is_timeout() { "Claude took too long to reply.".into() } else { format!("Couldn't reach Claude: {e}") })?;
    let status = response.status().as_u16();
    let text = response.text().await.map_err(|e| e.to_string())?;
    read_response(status, &text)
}

pub async fn ask(model: &str, system: &str, prompt: &str) -> Result<String, String> {
    if !MODELS.contains(&model) {
        return Err("Unknown model".into());
    }
    let key = entry()?.get_password().map_err(|_| "Add your Claude API key in Settings first.".to_string())?;
    send(API_URL, &key, &request_body(model, system, prompt)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn reads_replies_and_errors() {
        let ok = r#"{"content":[{"type":"text","text":"Hello"},{"type":"text","text":" there"}]}"#;
        assert_eq!(read_response(200, ok).unwrap(), "Hello there");
        assert!(read_response(401, "{}").unwrap_err().contains("API key"));
        assert!(read_response(400, r#"{"error":{"message":"bad thing"}}"#).unwrap_err().contains("bad thing"));
        assert!(read_response(200, r#"{"content":[]}"#).is_err());
    }

    #[test]
    fn sends_the_right_request() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/v1/messages", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buf = vec![0u8; 16384];
            let mut req = String::new();
            // Read until the whole JSON body has arrived.
            while !req.contains("\r\n\r\n") || !req.trim_end().ends_with('}') {
                let n = stream.read(&mut buf).unwrap();
                if n == 0 {
                    break;
                }
                req.push_str(&String::from_utf8_lossy(&buf[..n]));
            }
            let body = r#"{"content":[{"type":"text","text":"ok"}]}"#;
            write!(stream, "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{}", body.len(), body).unwrap();
            req
        });
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let reply = rt.block_on(send(&url, "test-key", &request_body("claude-haiku-5-5", "sys", "hi"))).unwrap();
        assert_eq!(reply, "ok");
        let req = server.join().unwrap().to_lowercase();
        assert!(req.starts_with("post /v1/messages"));
        assert!(req.contains("x-api-key: test-key"));
        assert!(req.contains("anthropic-version: 2023-06-01"));
        assert!(req.contains(r#""model":"claude-haiku-5-5""#));
        assert!(req.contains(r#""role":"user""#));
    }
}
