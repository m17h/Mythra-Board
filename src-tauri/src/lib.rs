mod storage;

use storage::Storage;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

type Store<'a> = tauri::State<'a, Storage>;

fn err(e: std::io::Error) -> String {
    e.to_string()
}

#[derive(serde::Serialize)]
struct BoardFile {
    id: String,
    json: String,
}

#[tauri::command]
fn list_boards(store: Store) -> Result<Vec<BoardFile>, String> {
    let boards = store.list().map_err(err)?;
    Ok(boards.into_iter().map(|(id, json)| BoardFile { id, json }).collect())
}

#[tauri::command]
fn load_board(store: Store, id: String) -> Result<Option<String>, String> {
    store.load(&id).map_err(err)
}

#[tauri::command]
fn save_board(store: Store, id: String, json: String) -> Result<(), String> {
    store.save(&id, &json).map_err(err)
}

#[tauri::command]
fn trash_board(store: Store, id: String) -> Result<(), String> {
    store.trash(&id).map_err(err)
}

#[tauri::command]
fn restore_board(store: Store, id: String) -> Result<(), String> {
    store.restore(&id).map_err(err)
}

/// Image bytes arrive as the raw request body, with the file name in a header.
#[tauri::command]
fn save_asset(store: Store, request: Request) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected image bytes".into());
    };
    let name = request
        .headers()
        .get("asset-name")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing asset name")?;
    store.save_asset(name, bytes).map_err(err)
}

/// The kinds of file the app writes, with their extension and save-dialog label.
const EXPORT_KINDS: [(&str, &str); 4] = [("png", "PNG image"), ("svg", "SVG image"), ("pdf", "PDF document"), ("mythra", "Mythra board")];

/// Ask where to save an exported file, then write it there. The location always comes
/// from the user's choice in the save dialog, never from the page.
#[tauri::command]
async fn export_file(app: tauri::AppHandle, request: Request<'_>) -> Result<bool, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected file bytes".into());
    };
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok());
    let (ext, label) = EXPORT_KINDS
        .iter()
        .find(|(ext, _)| Some(*ext) == header("file-kind"))
        .ok_or("unknown file kind")?;
    let name = header("file-name")
        .filter(|n| n.ends_with(&format!(".{ext}")) && !n.contains(['/', '\\']))
        .map(str::to_string)
        .unwrap_or_else(|| format!("Board.{ext}"));
    let Some(path) = app.dialog().file().set_file_name(&name).add_filter(*label, &[*ext]).blocking_save_file() else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(path, bytes).map_err(err)?;
    Ok(true)
}

/// Board files can carry images, but anything this big is not one of ours.
const MAX_BOARD_FILE: u64 = 500 * 1024 * 1024;

/// Let the user pick a .mythra board file and return its contents.
#[tauri::command]
async fn open_board_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let Some(path) = app.dialog().file().add_filter("Mythra board", &["mythra"]).blocking_pick_file() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    if std::fs::metadata(&path).map_err(err)?.len() > MAX_BOARD_FILE {
        return Err("That file is too large to be a board".into());
    }
    std::fs::read_to_string(path).map(Some).map_err(err)
}

/// Put a picture on the clipboard. The body is raw RGBA pixels; size comes in headers.
#[tauri::command]
fn copy_image(request: Request) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected image pixels".into());
    };
    let size = |name: &str| -> Result<usize, String> {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse().ok())
            .ok_or_else(|| format!("missing {name}"))
    };
    let (width, height) = (size("image-width")?, size("image-height")?);
    if width * height * 4 != bytes.len() {
        return Err("image size doesn't match its pixels".into());
    }
    let image = arboard::ImageData { width, height, bytes: bytes.into() };
    arboard::Clipboard::new().and_then(|mut c| c.set_image(image)).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_versions(store: Store, id: String) -> Result<Vec<u64>, String> {
    store.versions(&id).map_err(err)
}

#[tauri::command]
fn load_version(store: Store, id: String, time: u64) -> Result<String, String> {
    store.load_version(&id, time).map_err(err)
}

#[tauri::command]
fn snapshot_board(store: Store, id: String, json: String) -> Result<bool, String> {
    store.snapshot(&id, &json, true).map_err(err)
}

#[tauri::command]
fn load_asset(store: Store, name: String) -> Result<Response, String> {
    store.load_asset(&name).map(Response::new).map_err(err)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            app.manage(Storage::new(&root));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_boards,
            load_board,
            save_board,
            trash_board,
            restore_board,
            save_asset,
            load_asset,
            export_file,
            open_board_file,
            copy_image,
            list_versions,
            load_version,
            snapshot_board
        ])
        .run(tauri::generate_context!())
        .expect("error while running Mythra Board");
}
