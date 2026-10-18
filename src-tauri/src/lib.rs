mod storage;

use storage::Storage;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::Manager;

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

#[tauri::command]
fn load_asset(store: Store, name: String) -> Result<Response, String> {
    store.load_asset(&name).map(Response::new).map_err(err)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
            load_asset
        ])
        .run(tauri::generate_context!())
        .expect("error while running Mythra Board");
}
