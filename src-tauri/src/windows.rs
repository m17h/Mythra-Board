//! More than one window. Each window shows the home screen or one board, and a board is only
//! ever open in one window at a time: asking for it again brings its window to the front.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Which board each window has open, by window label.
#[derive(Default)]
pub struct OpenBoards(Mutex<HashMap<String, String>>);

impl OpenBoards {
    /// The window that has this board open, other than `except`.
    fn holder(&self, board: &str, except: &str) -> Option<String> {
        let open = self.0.lock().unwrap();
        open.iter().find(|(label, id)| *label != except && *id == board).map(|(label, _)| label.clone())
    }

    pub fn forget(&self, label: &str) {
        self.0.lock().unwrap().remove(label);
    }
}

static NEXT: AtomicU32 = AtomicU32::new(1);

fn bring_forward<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// The window the user is working in: the focused one, or failing that any window.
pub fn current<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    let windows = app.webview_windows();
    windows
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .or_else(|| windows.get("main"))
        .or_else(|| windows.values().next())
        .cloned()
}

/// Send a menu choice to the window the user is working in. Every window hears the event,
/// so it says which window it is for.
pub fn send_menu<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if let Some(w) = current(app) {
        let _ = app.emit("menu", serde_json::json!({ "id": id, "window": w.label() }));
    }
}

/// This window is about to show `board` (or the home screen, for None). Returns false if
/// another window already has that board open; that window is brought forward instead.
#[tauri::command]
pub fn claim_board<R: Runtime>(app: AppHandle<R>, window: WebviewWindow<R>, open: tauri::State<OpenBoards>, board: Option<String>) -> bool {
    let label = window.label();
    if let Some(id) = &board {
        if let Some(other) = open.holder(id, label) {
            bring_forward(&app, &other);
            return false;
        }
    }
    let mut map = open.0.lock().unwrap();
    match board {
        Some(id) => map.insert(label.to_string(), id),
        None => map.remove(label),
    };
    true
}

/// The board a new window should start on (None for the home screen).
#[tauri::command]
pub fn start_board<R: Runtime>(window: WebviewWindow<R>, open: tauri::State<OpenBoards>) -> Option<String> {
    open.0.lock().unwrap().get(window.label()).cloned()
}

/// Boards open in windows other than this one.
#[tauri::command]
pub fn boards_open_elsewhere<R: Runtime>(window: WebviewWindow<R>, open: tauri::State<OpenBoards>) -> Vec<String> {
    let open = open.0.lock().unwrap();
    open.iter().filter(|(label, _)| *label != window.label()).map(|(_, id)| id.clone()).collect()
}

/// Open a new window, on the home screen or on a board. A board that is already open just
/// brings its window forward.
#[tauri::command]
pub async fn open_window<R: Runtime>(app: AppHandle<R>, window: WebviewWindow<R>, open: tauri::State<'_, OpenBoards>, board: Option<String>) -> Result<(), String> {
    if let Some(id) = &board {
        if let Some(other) = open.holder(id, "") {
            bring_forward(&app, &other);
            return Ok(());
        }
    }
    let label = format!("window-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    // Reserve the board for the new window straight away, so it can't be opened twice.
    if let Some(id) = board {
        open.0.lock().unwrap().insert(label.clone(), id);
    }
    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::default())
        .title("Mythra Board")
        .inner_size(1280.0, 820.0)
        .min_inner_size(640.0, 480.0)
        .disable_drag_drop_handler();
    // Stack the new window a little below and to the right of the current one.
    if let (Ok(pos), Ok(scale)) = (window.outer_position(), window.scale_factor()) {
        let pos = pos.to_logical::<f64>(scale);
        builder = builder.position(pos.x + 28.0, pos.y + 28.0);
    }
    #[cfg(target_os = "macos")]
    {
        builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
    }
    if let Err(e) = builder.build() {
        open.forget(&label);
        return Err(e.to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_which_window_has_a_board() {
        let open = OpenBoards::default();
        open.0.lock().unwrap().insert("main".into(), "a".into());
        open.0.lock().unwrap().insert("window-1".into(), "b".into());
        assert_eq!(open.holder("a", "window-1").as_deref(), Some("main"));
        assert_eq!(open.holder("a", "main"), None);
        assert_eq!(open.holder("c", ""), None);
        open.forget("main");
        assert_eq!(open.holder("a", ""), None);
    }
}
