//! The app's menu bar. Custom items send their id to the page as a "menu" event; the page
//! decides what to do (and ignores items that don't apply, e.g. board actions on the home
//! screen). Standard editing items use the system's own versions so text fields behave
//! exactly as they do everywhere else.

use tauri::menu::{AboutMetadata, Menu, MenuItem, MenuItemBuilder, Submenu, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};

fn item<R: Runtime>(app: &AppHandle<R>, id: &str, label: &str, accelerator: Option<&str>) -> tauri::Result<MenuItem<R>> {
    let mut b = MenuItemBuilder::with_id(id, label);
    if let Some(a) = accelerator {
        b = b.accelerator(a);
    }
    b.build(app)
}

fn submenu<R: Runtime>(app: &AppHandle<R>, title: &str, entries: &[(&str, &str, Option<&str>)]) -> tauri::Result<Submenu<R>> {
    let mut b = SubmenuBuilder::new(app, title);
    for (id, label, accel) in entries {
        b = if id.is_empty() { b.separator() } else { b.item(&item(app, id, label, *accel)?) };
    }
    b.build()
}

const SEP: (&str, &str, Option<&str>) = ("", "", None);

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let about = AboutMetadata { name: Some("Mythra Board".into()), ..Default::default() };
    let app_menu = SubmenuBuilder::new(app, "Mythra Board")
        .about(Some(about))
        .separator()
        .item(&item(app, "settings", "Settings…", Some("CmdOrCtrl+,"))?)
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file = submenu(
        app,
        "File",
        &[
            ("new-board", "New Board", Some("CmdOrCtrl+N")),
            ("open-file", "Open Board File…", Some("CmdOrCtrl+O")),
            SEP,
            ("all-boards", "All Boards", None),
            ("back", "Back", None),
            SEP,
            ("export", "Export…", Some("CmdOrCtrl+Shift+E")),
            ("save-file", "Save a Board File…", None),
            ("history", "Version History…", None),
        ],
    )?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&item(app, "duplicate", "Duplicate", Some("CmdOrCtrl+D"))?)
        .item(&item(app, "delete", "Delete", None)?)
        .separator()
        .item(&item(app, "find", "Find on Board…", Some("CmdOrCtrl+F"))?)
        .item(&item(app, "palette", "Command Palette…", Some("CmdOrCtrl+K"))?)
        .build()?;

    let appearance = submenu(
        app,
        "Appearance",
        &[("theme-system", "Match My Mac", None), ("theme-light", "Light", None), ("theme-dark", "Dark", None)],
    )?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&item(app, "zoom-in", "Zoom In", Some("CmdOrCtrl+="))?)
        .item(&item(app, "zoom-out", "Zoom Out", Some("CmdOrCtrl+-"))?)
        .item(&item(app, "zoom-reset", "Actual Size", Some("CmdOrCtrl+0"))?)
        .item(&item(app, "fit", "Fit Everything", None)?)
        .separator()
        .item(&item(app, "minimap", "Mini Map", None)?)
        .item(&appearance)
        .item(&item(app, "style", "Hand-drawn Style", None)?)
        .separator()
        .item(&item(app, "present", "Present Sections", Some("CmdOrCtrl+Shift+P"))?)
        .fullscreen()
        .build()?;

    let arrange = submenu(
        app,
        "Arrange",
        &[
            ("group", "Group", Some("CmdOrCtrl+G")),
            ("ungroup", "Ungroup", Some("CmdOrCtrl+Shift+G")),
            ("section", "Put in a Section", Some("CmdOrCtrl+Alt+G")),
            ("lock", "Lock or Unlock", Some("CmdOrCtrl+Shift+L")),
            SEP,
            ("front", "Bring to Front", Some("CmdOrCtrl+Shift+]")),
            ("back-layer", "Send to Back", Some("CmdOrCtrl+Shift+[")),
            SEP,
            ("tidy", "Tidy Up Mind Maps", None),
            ("fold", "Fold or Unfold Branch", None),
            SEP,
            ("link-board", "Link to Another Board…", None),
        ],
    )?;

    let window = SubmenuBuilder::new(app, "Window").minimize().maximize().separator().close_window().build()?;
    let help = submenu(app, "Help", &[("shortcuts", "Keyboard Shortcuts", Some("CmdOrCtrl+/"))])?;

    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &arrange, &window, &help])
}

/// Forward custom menu choices to the page.
pub fn forward<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let _ = app.emit("menu", id);
}
