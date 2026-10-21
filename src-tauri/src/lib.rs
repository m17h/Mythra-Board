mod ai;
mod menu;
mod storage;

use std::path::PathBuf;
use std::sync::RwLock;
use storage::Storage;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

type Store<'a> = tauri::State<'a, RwLock<Storage>>;

/// Which folder boards are kept in. Saved in the app's settings file.
#[derive(serde::Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Settings {
    data_dir: Option<PathBuf>,
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("settings.json"))
}

fn read_settings(app: &tauri::AppHandle) -> Settings {
    settings_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_settings(app: &tauri::AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    std::fs::create_dir_all(path.parent().unwrap_or(&path)).map_err(err)?;
    std::fs::write(path, serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?).map_err(err)
}

fn default_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// iCloud Drive's folder on this Mac, if iCloud Drive is turned on.
fn icloud_drive(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dir = app.path().home_dir().ok()?.join("Library/Mobile Documents/com~apple~CloudDocs");
    dir.is_dir().then_some(dir)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Location {
    path: String,
    kind: &'static str,
    icloud_available: bool,
}

fn location(app: &tauri::AppHandle, store: &Storage) -> Location {
    let root = store.root();
    let kind = if Some(root) == default_dir(app).ok().as_deref() {
        "default"
    } else if icloud_drive(app).is_some_and(|i| root.starts_with(i)) {
        "icloud"
    } else {
        "custom"
    };
    Location { path: root.display().to_string(), kind, icloud_available: icloud_drive(app).is_some() }
}

#[tauri::command]
fn storage_location(app: tauri::AppHandle, store: Store) -> Location {
    location(&app, &store.read().unwrap())
}

/// Move where boards are kept: "default", "icloud", or a folder the user picks. Boards are
/// copied over (never overwriting what's already there), and the old folder is left as is.
#[tauri::command]
async fn choose_storage_location(app: tauri::AppHandle, store: Store<'_>, kind: String) -> Result<Option<Location>, String> {
    let target = match kind.as_str() {
        "default" => default_dir(&app)?,
        "icloud" => icloud_drive(&app).ok_or("iCloud Drive isn't turned on for this Mac")?.join("Mythra Board"),
        "folder" => {
            let Some(picked) = app.dialog().file().set_title("Choose a folder for your boards").blocking_pick_folder() else {
                return Ok(None);
            };
            let picked = picked.into_path().map_err(|e| e.to_string())?;
            if picked.file_name().is_some_and(|n| n == "Mythra Board") { picked } else { picked.join("Mythra Board") }
        }
        _ => return Err("unknown location".into()),
    };
    std::fs::create_dir_all(&target).map_err(err)?;
    let next = Storage::new(&target);
    next.adopt_from(&store.read().unwrap()).map_err(err)?;
    let is_default = target == default_dir(&app)?;
    write_settings(&app, &Settings { data_dir: (!is_default).then(|| target.clone()) })?;
    *store.write().unwrap() = next;
    Ok(Some(location(&app, &store.read().unwrap())))
}

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
    let boards = store.read().unwrap().list().map_err(err)?;
    Ok(boards.into_iter().map(|(id, json)| BoardFile { id, json }).collect())
}

#[tauri::command]
fn load_board(store: Store, id: String) -> Result<Option<String>, String> {
    store.read().unwrap().load(&id).map_err(err)
}

/// Returns true if another device had changed the board since we last saved it (that
/// copy is kept in the board's version history).
#[tauri::command]
fn save_board(store: Store, id: String, json: String, expected: Option<u64>) -> Result<bool, String> {
    store.read().unwrap().save(&id, &json, expected).map_err(err)
}

#[tauri::command]
fn trash_board(store: Store, id: String) -> Result<(), String> {
    store.read().unwrap().trash(&id).map_err(err)
}

#[tauri::command]
fn restore_board(store: Store, id: String) -> Result<(), String> {
    store.read().unwrap().restore(&id).map_err(err)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TrashedBoard {
    id: String,
    json: String,
    deleted_at: u64,
}

#[tauri::command]
fn list_trash(store: Store) -> Result<Vec<TrashedBoard>, String> {
    let boards = store.read().unwrap().list_trash().map_err(err)?;
    Ok(boards.into_iter().map(|(id, json, deleted_at)| TrashedBoard { id, json, deleted_at }).collect())
}

#[tauri::command]
fn delete_board_forever(store: Store, id: String) -> Result<(), String> {
    store.read().unwrap().delete_forever(&id).map_err(err)
}

const DAY_MS: u64 = 24 * 60 * 60 * 1000;
/// Boards stay in the trash this long before being removed for good.
const TRASH_DAYS: u64 = 30;
/// Unused attached files are only removed once they are at least this old.
const ASSET_MIN_AGE_MS: u64 = DAY_MS;

/// Permanently remove boards trashed more than `days` ago. Returns how many.
#[tauri::command]
fn purge_trash(store: Store, days: u64) -> Result<usize, String> {
    store.read().unwrap().purge_trash(days.saturating_mul(DAY_MS)).map_err(err)
}

#[tauri::command]
fn list_templates(store: Store) -> Result<Vec<BoardFile>, String> {
    let templates = store.read().unwrap().list_templates().map_err(err)?;
    Ok(templates.into_iter().map(|(id, json)| BoardFile { id, json }).collect())
}

#[tauri::command]
fn save_template(store: Store, id: String, json: String) -> Result<(), String> {
    store.read().unwrap().save_template(&id, &json).map_err(err)
}

#[tauri::command]
fn delete_template(store: Store, id: String) -> Result<(), String> {
    store.read().unwrap().delete_template(&id).map_err(err)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CleanupReport {
    files: usize,
    bytes: u64,
}

/// Delete attached files no board uses any more.
#[tauri::command]
fn cleanup_assets(store: Store) -> Result<CleanupReport, String> {
    let (files, bytes) = store.read().unwrap().cleanup_assets(ASSET_MIN_AGE_MS).map_err(err)?;
    Ok(CleanupReport { files, bytes })
}

/// Open an attached file in the app the system uses for it.
#[tauri::command]
fn open_asset(app: tauri::AppHandle, store: Store, name: String) -> Result<(), String> {
    let path = store.read().unwrap().asset_path(&name).map_err(err)?;
    if !path.is_file() {
        return Err("That file is missing".into());
    }
    app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

/// File bytes arrive as the raw request body, with the file name in a header.
#[tauri::command]
fn save_asset(store: Store, request: Request) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected file bytes".into());
    };
    let name = request
        .headers()
        .get("asset-name")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing asset name")?;
    store.read().unwrap().save_asset(name, bytes).map_err(err)
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
fn ai_key_status() -> bool {
    ai::has_key()
}

#[tauri::command]
fn set_ai_key(key: String) -> Result<(), String> {
    ai::set_key(&key)
}

#[tauri::command]
fn clear_ai_key() -> Result<(), String> {
    ai::clear_key()
}

#[tauri::command]
async fn ask_ai(model: String, system: String, prompt: String) -> Result<String, String> {
    ai::ask(&model, &system, &prompt).await
}

#[tauri::command]
fn list_versions(store: Store, id: String) -> Result<Vec<u64>, String> {
    store.read().unwrap().versions(&id).map_err(err)
}

#[tauri::command]
fn load_version(store: Store, id: String, time: u64) -> Result<String, String> {
    store.read().unwrap().load_version(&id, time).map_err(err)
}

#[tauri::command]
fn snapshot_board(store: Store, id: String, json: String) -> Result<bool, String> {
    store.read().unwrap().snapshot(&id, &json, true).map_err(err)
}

#[tauri::command]
fn load_asset(store: Store, name: String) -> Result<Response, String> {
    store.read().unwrap().load_asset(&name).map(Response::new).map_err(err)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .menu(|app| menu::build(app))
        .on_menu_event(|app, event| menu::forward(app, event.id().as_ref()))
        .setup(|app| {
            let root = match read_settings(app.handle()).data_dir {
                // A chosen folder that has gone (e.g. a drive unplugged) falls back to the default.
                Some(dir) if dir.is_dir() => dir,
                _ => app.path().app_data_dir()?,
            };
            let store = Storage::new(&root);
            // Tidying up is a bonus; a failure here must never stop the app opening.
            let _ = store.purge_trash(TRASH_DAYS * DAY_MS);
            let _ = store.cleanup_assets(ASSET_MIN_AGE_MS);
            app.manage(RwLock::new(store));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_boards,
            load_board,
            save_board,
            trash_board,
            restore_board,
            list_trash,
            delete_board_forever,
            purge_trash,
            list_templates,
            save_template,
            delete_template,
            save_asset,
            load_asset,
            open_asset,
            cleanup_assets,
            export_file,
            open_board_file,
            copy_image,
            list_versions,
            load_version,
            snapshot_board,
            storage_location,
            choose_storage_location,
            ai_key_status,
            set_ai_key,
            clear_ai_key,
            ask_ai
        ])
        .run(tauri::generate_context!())
        .expect("error while running Mythra Board");
}
