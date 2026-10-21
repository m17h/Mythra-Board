//! Boards live in `boards/<id>.json`. Files are written atomically (temp file + rename)
//! and the previous version is kept as `<id>.backup.json`, so a crash mid-save can never
//! lose a board. Deleted boards move to `trash/`, files and images live in `assets/`, and
//! saved board templates live in `templates/`.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const BACKUP_SUFFIX: &str = ".backup.json";
/// When a board was moved to the trash, as ms since 1970, is kept next to it in `<id>.deleted`.
const DELETED_SUFFIX: &str = ".deleted";
const ASSET_EXTENSIONS: [&str; 26] = [
    "png", "jpg", "jpeg", "gif", "webp", "pdf", "txt", "md", "csv", "json", "rtf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "key", "pages", "numbers", "zip", "mp3", "m4a", "wav", "mp4", "mov",
];
/// Attached files bigger than this are refused.
pub const MAX_ASSET_BYTES: usize = 200 * 1024 * 1024;

fn invalid(msg: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, msg.to_string())
}

fn safe_id(id: &str) -> io::Result<&str> {
    let ok = !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok { Ok(id) } else { Err(invalid("bad board id")) }
}

fn safe_asset(name: &str) -> io::Result<&str> {
    let (stem, ext) = name.rsplit_once('.').ok_or_else(|| invalid("bad asset name"))?;
    safe_id(stem).map_err(|_| invalid("bad asset name"))?;
    if ASSET_EXTENSIONS.contains(&ext) { Ok(name) } else { Err(invalid("bad asset type")) }
}

/// The `updatedAt` stamp inside a saved board, if it has one.
fn updated_at(json: &str) -> Option<u64> {
    serde_json::from_str::<serde_json::Value>(json).ok()?.get("updatedAt")?.as_u64()
}

fn is_valid(json: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(json).is_ok()
}

/// Move an unreadable file aside so it is never overwritten.
fn quarantine(path: &Path) -> io::Result<()> {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    fs::rename(path, path.with_file_name(format!("{name}.damaged-{stamp}")))
}

fn read_valid(path: &Path) -> io::Result<Option<String>> {
    match fs::read_to_string(path) {
        Ok(json) if is_valid(&json) => Ok(Some(json)),
        Ok(_) => {
            quarantine(path)?;
            Ok(None)
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let tmp = path.with_extension("tmp");
    {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    fs::rename(&tmp, path)
}

/// Automatic history snapshots are at least this far apart.
const SNAPSHOT_EVERY_MS: u128 = 10 * 60 * 1000;
/// How many snapshots to keep per board.
const SNAPSHOT_LIMIT: usize = 60;

pub struct Storage {
    root: PathBuf,
    boards: PathBuf,
    trash: PathBuf,
    assets: PathBuf,
    history: PathBuf,
    templates: PathBuf,
}

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

fn ms_since_1970(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// File names in `dir`, or none if the folder doesn't exist yet.
fn file_names(dir: &Path) -> io::Result<Vec<String>> {
    match fs::read_dir(dir) {
        Ok(entries) => Ok(entries.filter_map(|e| e.ok()).filter_map(|e| e.file_name().into_string().ok()).collect()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(vec![]),
        Err(e) => Err(e),
    }
}

fn remove_if_present(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
        _ => Ok(()),
    }
}

/// Every board-like file (`.json`, including backups and damaged copies) under `dir`, at
/// any depth. Fails if a folder can't be read, or if iCloud hasn't downloaded a file yet
/// (its contents are unknown, so nothing it might use can safely be deleted).
fn json_files(dir: &Path, found: &mut Vec<PathBuf>) -> io::Result<()> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".icloud") {
            return Err(io::Error::other("some files haven't been downloaded from iCloud yet"));
        }
        if entry.file_type()?.is_dir() {
            json_files(&entry.path(), found)?;
        } else if name.contains(".json") {
            found.push(entry.path());
        }
    }
    Ok(())
}

impl Storage {
    pub fn new(root: &Path) -> Self {
        Storage {
            root: root.to_path_buf(),
            boards: root.join("boards"),
            trash: root.join("trash"),
            assets: root.join("assets"),
            history: root.join("history"),
            templates: root.join("templates"),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Copy boards, pictures, history, trash and templates from `old` into this folder, skipping
    /// anything already here (so moving to a folder another Mac uses never overwrites).
    /// Returns how many files were copied. `old` is left untouched.
    pub fn adopt_from(&self, old: &Storage) -> io::Result<usize> {
        fn copy_missing(from: &Path, to: &Path) -> io::Result<usize> {
            let entries = match fs::read_dir(from) {
                Ok(e) => e,
                Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(0),
                Err(e) => return Err(e),
            };
            fs::create_dir_all(to)?;
            let mut copied = 0;
            for entry in entries.filter_map(|e| e.ok()) {
                let target = to.join(entry.file_name());
                if entry.file_type()?.is_dir() {
                    copied += copy_missing(&entry.path(), &target)?;
                } else if !target.exists() {
                    fs::copy(entry.path(), &target)?;
                    copied += 1;
                }
            }
            Ok(copied)
        }
        if old.root == self.root {
            return Ok(0);
        }
        let mut copied = 0;
        for (from, to) in [(&old.boards, &self.boards), (&old.assets, &self.assets), (&old.history, &self.history), (&old.trash, &self.trash), (&old.templates, &self.templates)] {
            copied += copy_missing(from, to)?;
        }
        Ok(copied)
    }

    fn main_path(&self, id: &str) -> PathBuf {
        self.boards.join(format!("{id}.json"))
    }

    fn backup_path(&self, id: &str) -> PathBuf {
        self.boards.join(format!("{id}{BACKUP_SUFFIX}"))
    }

    /// The saved board, falling back to the backup if the main file is damaged.
    pub fn load(&self, id: &str) -> io::Result<Option<String>> {
        let id = safe_id(id)?;
        if let Some(json) = read_valid(&self.main_path(id))? {
            return Ok(Some(json));
        }
        read_valid(&self.backup_path(id))
    }

    /// Save a board. `expected` is the `updatedAt` of the copy the app last read or wrote;
    /// if the file on disk has since changed (another Mac edited it through a synced folder),
    /// that copy is kept in history before being replaced, and `true` is returned.
    pub fn save(&self, id: &str, json: &str, expected: Option<u64>) -> io::Result<bool> {
        let id = safe_id(id)?;
        if !is_valid(json) {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "refusing to save invalid board data"));
        }
        fs::create_dir_all(&self.boards)?;
        let main = self.main_path(id);
        let mut conflict = false;
        if let Ok(existing) = fs::read_to_string(&main) {
            let on_disk = updated_at(&existing);
            if expected.is_some() && on_disk.is_some() && on_disk != expected && on_disk != updated_at(json) {
                self.snapshot(id, &existing, true)?;
                conflict = true;
            }
            fs::copy(&main, self.backup_path(id))?;
        }
        write_atomic(&main, json.as_bytes())?;
        // History is a bonus; a failure here must never fail the save itself.
        let _ = self.snapshot(id, json, false);
        Ok(conflict)
    }

    fn history_dir(&self, id: &str) -> PathBuf {
        self.history.join(id)
    }

    /// Snapshot times (ms since 1970), newest first.
    pub fn versions(&self, id: &str) -> io::Result<Vec<u64>> {
        let id = safe_id(id)?;
        let entries = match fs::read_dir(self.history_dir(id)) {
            Ok(entries) => entries,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(vec![]),
            Err(e) => return Err(e),
        };
        let mut times: Vec<u64> = entries
            .filter_map(|e| e.ok())
            .filter_map(|e| e.file_name().to_str()?.strip_suffix(".json")?.parse().ok())
            .collect();
        times.sort_unstable_by(|a, b| b.cmp(a));
        Ok(times)
    }

    pub fn load_version(&self, id: &str, time: u64) -> io::Result<String> {
        let id = safe_id(id)?;
        fs::read_to_string(self.history_dir(id).join(format!("{time}.json")))
    }

    /// Keep a copy of the board in its history. Unless `force`, only when the last copy is
    /// at least ten minutes old. Old copies beyond the limit are removed.
    pub fn snapshot(&self, id: &str, json: &str, force: bool) -> io::Result<bool> {
        let id = safe_id(id)?;
        let now = now_ms();
        let versions = self.versions(id)?;
        if !force && versions.first().is_some_and(|&t| now.saturating_sub(t as u128) < SNAPSHOT_EVERY_MS) {
            return Ok(false);
        }
        let dir = self.history_dir(id);
        fs::create_dir_all(&dir)?;
        // Don't store an identical copy twice in a row.
        if let Some(&latest) = versions.first() {
            if fs::read_to_string(dir.join(format!("{latest}.json"))).is_ok_and(|prev| prev == json) {
                return Ok(false);
            }
        }
        write_atomic(&dir.join(format!("{now}.json")), json.as_bytes())?;
        for old in versions.iter().skip(SNAPSHOT_LIMIT - 1) {
            let _ = fs::remove_file(dir.join(format!("{old}.json")));
        }
        Ok(true)
    }

    /// Every readable board as `(id, json)`.
    pub fn list(&self) -> io::Result<Vec<(String, String)>> {
        let entries = match fs::read_dir(&self.boards) {
            Ok(entries) => entries,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(vec![]),
            Err(e) => return Err(e),
        };
        let mut ids: Vec<String> = entries
            .filter_map(|e| e.ok())
            .filter_map(|e| e.file_name().into_string().ok())
            .filter_map(|name| {
                let id = name.strip_suffix(".json")?;
                (!name.ends_with(BACKUP_SUFFIX) && safe_id(id).is_ok()).then(|| id.to_string())
            })
            .collect();
        // A board whose main file was lost but whose backup survived still shows up.
        for e in fs::read_dir(&self.boards)?.filter_map(|e| e.ok()) {
            if let Some(id) = e.file_name().to_string_lossy().strip_suffix(BACKUP_SUFFIX) {
                if safe_id(id).is_ok() && !ids.iter().any(|x| x == id) {
                    ids.push(id.to_string());
                }
            }
        }
        let mut boards = vec![];
        for id in ids {
            if let Some(json) = self.load(&id)? {
                boards.push((id, json));
            }
        }
        Ok(boards)
    }

    fn deleted_marker(&self, id: &str) -> PathBuf {
        self.trash.join(format!("{id}{DELETED_SUFFIX}"))
    }

    /// Move a board (and its backup) into the trash, where it can be restored. The time it
    /// was deleted is noted alongside, so old trash can be emptied later.
    pub fn trash(&self, id: &str) -> io::Result<()> {
        let id = safe_id(id)?;
        fs::create_dir_all(&self.trash)?;
        let mut moved = false;
        for (from, name) in [(self.main_path(id), format!("{id}.json")), (self.backup_path(id), format!("{id}{BACKUP_SUFFIX}"))] {
            if from.exists() {
                fs::rename(from, self.trash.join(name))?;
                moved = true;
            }
        }
        if moved {
            write_atomic(&self.deleted_marker(id), now_ms().to_string().as_bytes())?;
        }
        Ok(())
    }

    pub fn restore(&self, id: &str) -> io::Result<()> {
        let id = safe_id(id)?;
        fs::create_dir_all(&self.boards)?;
        for name in [format!("{id}.json"), format!("{id}{BACKUP_SUFFIX}")] {
            let from = self.trash.join(&name);
            if from.exists() {
                fs::rename(from, self.boards.join(name))?;
            }
        }
        remove_if_present(&self.deleted_marker(id))
    }

    /// Every readable board in the trash as `(id, json, deleted_at)`, with `deleted_at` in ms
    /// since 1970 (from the time noted on delete, else the file's last change).
    pub fn list_trash(&self) -> io::Result<Vec<(String, String, u64)>> {
        let mut ids: Vec<String> = vec![];
        for name in file_names(&self.trash)? {
            let id = name.strip_suffix(BACKUP_SUFFIX).or_else(|| name.strip_suffix(".json"));
            if let Some(id) = id.filter(|id| safe_id(id).is_ok()) {
                if !ids.iter().any(|x| x == id) {
                    ids.push(id.to_string());
                }
            }
        }
        let mut boards = vec![];
        for id in ids {
            let mut found = None;
            for path in [self.trash.join(format!("{id}.json")), self.trash.join(format!("{id}{BACKUP_SUFFIX}"))] {
                if let Some(json) = read_valid(&path)? {
                    found = Some((json, path));
                    break;
                }
            }
            let Some((json, path)) = found else { continue };
            let noted = fs::read_to_string(self.deleted_marker(&id)).ok().and_then(|s| s.trim().parse().ok());
            let deleted_at = match noted {
                Some(time) => time,
                None => ms_since_1970(fs::metadata(&path)?.modified()?),
            };
            boards.push((id, json, deleted_at));
        }
        Ok(boards)
    }

    /// Permanently remove a trashed board, its backup and its whole version history.
    pub fn delete_forever(&self, id: &str) -> io::Result<()> {
        let id = safe_id(id)?;
        for path in [self.trash.join(format!("{id}.json")), self.trash.join(format!("{id}{BACKUP_SUFFIX}")), self.deleted_marker(id)] {
            remove_if_present(&path)?;
        }
        match fs::remove_dir_all(self.history_dir(id)) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        }
    }

    /// Permanently remove boards that have been in the trash for longer than
    /// `older_than_ms`. Returns how many were removed.
    pub fn purge_trash(&self, older_than_ms: u64) -> io::Result<usize> {
        let cutoff = (now_ms() as u64).saturating_sub(older_than_ms);
        let mut removed = 0;
        for (id, _, deleted_at) in self.list_trash()? {
            if deleted_at < cutoff {
                self.delete_forever(&id)?;
                removed += 1;
            }
        }
        Ok(removed)
    }

    /// Every readable template as `(id, json)`.
    pub fn list_templates(&self) -> io::Result<Vec<(String, String)>> {
        let mut templates = vec![];
        for name in file_names(&self.templates)? {
            let Some(id) = name.strip_suffix(".json").filter(|id| safe_id(id).is_ok()) else { continue };
            if let Some(json) = read_valid(&self.templates.join(&name))? {
                templates.push((id.to_string(), json));
            }
        }
        Ok(templates)
    }

    pub fn save_template(&self, id: &str, json: &str) -> io::Result<()> {
        let id = safe_id(id)?;
        if !is_valid(json) {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "refusing to save invalid template data"));
        }
        fs::create_dir_all(&self.templates)?;
        write_atomic(&self.templates.join(format!("{id}.json")), json.as_bytes())
    }

    pub fn delete_template(&self, id: &str) -> io::Result<()> {
        let id = safe_id(id)?;
        remove_if_present(&self.templates.join(format!("{id}.json")))
    }

    /// Where an attached file is kept on disk (the name is checked first).
    pub fn asset_path(&self, name: &str) -> io::Result<PathBuf> {
        Ok(self.assets.join(safe_asset(name)?))
    }

    pub fn save_asset(&self, name: &str, bytes: &[u8]) -> io::Result<()> {
        let name = safe_asset(name)?;
        if bytes.len() > MAX_ASSET_BYTES {
            return Err(invalid("file is larger than 200 MB"));
        }
        fs::create_dir_all(&self.assets)?;
        let path = self.assets.join(name);
        if path.exists() {
            return Ok(());
        }
        write_atomic(&path, bytes)
    }

    pub fn load_asset(&self, name: &str) -> io::Result<Vec<u8>> {
        fs::read(self.assets.join(safe_asset(name)?))
    }

    /// Delete attached files that no board, trashed board, history copy or template mentions
    /// any more, and that are at least `min_age_ms` old (so a file attached moments ago, whose
    /// board isn't saved yet, is safe). If anything can't be read, nothing is deleted.
    /// Returns `(files deleted, bytes freed)`.
    pub fn cleanup_assets(&self, min_age_ms: u64) -> io::Result<(usize, u64)> {
        let now = now_ms() as u64;
        let mut unused: Vec<(String, u64)> = vec![];
        for name in file_names(&self.assets)? {
            // Only our own files; this also leaves iCloud placeholders alone.
            if safe_asset(&name).is_err() {
                continue;
            }
            let meta = fs::metadata(self.assets.join(&name))?;
            if !meta.is_file() {
                continue;
            }
            // A file can arrive through a synced folder carrying an old date, so the newest of
            // its modified and created times counts.
            let changed = meta.modified().map(ms_since_1970).unwrap_or(now).max(meta.created().map(ms_since_1970).unwrap_or(0));
            if now.saturating_sub(changed) >= min_age_ms {
                unused.push((name, meta.len()));
            }
        }
        if unused.is_empty() {
            return Ok((0, 0));
        }
        let mut files = vec![];
        for dir in [&self.boards, &self.trash, &self.history, &self.templates] {
            json_files(dir, &mut files)?;
        }
        for path in files {
            let text = match fs::read_to_string(&path) {
                Ok(text) => text,
                Err(e) if e.kind() == io::ErrorKind::NotFound => continue,
                Err(e) if e.kind() == io::ErrorKind::InvalidData => String::from_utf8_lossy(&fs::read(&path)?).into_owned(),
                Err(e) => return Err(e),
            };
            unused.retain(|(name, _)| !text.contains(name.as_str()));
            if unused.is_empty() {
                return Ok((0, 0));
            }
        }
        let (mut deleted, mut freed) = (0, 0);
        for (name, size) in unused {
            if fs::remove_file(self.assets.join(&name)).is_ok() {
                deleted += 1;
                freed += size;
            }
        }
        Ok((deleted, freed))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, Storage) {
        let dir = tempfile::tempdir().unwrap();
        let s = Storage::new(dir.path());
        (dir, s)
    }

    #[test]
    fn saves_lists_and_loads() {
        let (_d, s) = store();
        assert!(s.list().unwrap().is_empty());
        s.save("a", r#"{"v":1}"#, None).unwrap();
        s.save("a", r#"{"v":2}"#, None).unwrap();
        s.save("b", r#"{"v":3}"#, None).unwrap();
        assert_eq!(s.load("a").unwrap().as_deref(), Some(r#"{"v":2}"#));
        let mut ids: Vec<_> = s.list().unwrap().into_iter().map(|(id, _)| id).collect();
        ids.sort();
        assert_eq!(ids, ["a", "b"]);
    }

    #[test]
    fn falls_back_to_backup_and_keeps_damaged_file() {
        let (d, s) = store();
        s.save("a", r#"{"v":1}"#, None).unwrap();
        s.save("a", r#"{"v":2}"#, None).unwrap();
        fs::write(d.path().join("boards/a.json"), "{broken").unwrap();
        assert_eq!(s.load("a").unwrap().as_deref(), Some(r#"{"v":1}"#));
        let damaged = fs::read_dir(d.path().join("boards"))
            .unwrap()
            .filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().contains("damaged"))
            .count();
        assert_eq!(damaged, 1);
        assert_eq!(s.list().unwrap().len(), 1);
    }

    #[test]
    fn trash_and_restore() {
        let (_d, s) = store();
        s.save("a", r#"{"v":1}"#, None).unwrap();
        s.trash("a").unwrap();
        assert!(s.list().unwrap().is_empty());
        s.restore("a").unwrap();
        assert_eq!(s.load("a").unwrap().as_deref(), Some(r#"{"v":1}"#));
    }

    #[test]
    fn keeps_spaced_out_history() {
        let (_d, s) = store();
        s.save("a", r#"{"v":1}"#, None).unwrap();
        // A save straight after doesn't add another snapshot...
        s.save("a", r#"{"v":2}"#, None).unwrap();
        assert_eq!(s.versions("a").unwrap().len(), 1);
        // ...but a forced one does (unless nothing changed).
        std::thread::sleep(std::time::Duration::from_millis(2));
        assert!(s.snapshot("a", r#"{"v":2}"#, true).unwrap());
        assert!(!s.snapshot("a", r#"{"v":2}"#, true).unwrap());
        let v = s.versions("a").unwrap();
        assert_eq!(v.len(), 2);
        assert!(v[0] > v[1]);
        assert_eq!(s.load_version("a", v[1]).unwrap(), r#"{"v":1}"#);
        assert!(s.load_version("../a", v[1]).is_err());
    }

    #[test]
    fn keeps_the_other_devices_copy_when_saves_cross() {
        let (_d, s) = store();
        assert!(!s.save("a", r#"{"updatedAt":1,"v":"mine"}"#, None).unwrap());
        // Another Mac saves a newer copy through the synced folder...
        assert!(!s.save("a", r#"{"updatedAt":5,"v":"theirs"}"#, Some(1)).unwrap());
        // ...then this Mac, still expecting the copy it last saved (1), saves over it.
        assert!(s.save("a", r#"{"updatedAt":6,"v":"mine again"}"#, Some(1)).unwrap());
        let theirs = s.versions("a").unwrap().iter().any(|&t| s.load_version("a", t).unwrap().contains("theirs"));
        assert!(theirs, "the overwritten copy should be in history");
        // Saving on top of our own last save is not a conflict.
        assert!(!s.save("a", r#"{"updatedAt":7,"v":"next"}"#, Some(6)).unwrap());
    }

    #[test]
    fn moving_to_a_new_folder_copies_without_overwriting() {
        let (old_dir, old) = store();
        let new_dir = tempfile::tempdir().unwrap();
        let new = Storage::new(new_dir.path());
        old.save("a", r#"{"v":"old a"}"#, None).unwrap();
        old.save("b", r#"{"v":"old b"}"#, None).unwrap();
        old.save_asset("pic.png", b"png").unwrap();
        new.save("b", r#"{"v":"new b"}"#, None).unwrap();
        assert!(new.adopt_from(&old).unwrap() >= 2);
        assert_eq!(new.load("a").unwrap().as_deref(), Some(r#"{"v":"old a"}"#));
        assert_eq!(new.load("b").unwrap().as_deref(), Some(r#"{"v":"new b"}"#));
        assert_eq!(new.load_asset("pic.png").unwrap(), b"png");
        assert!(old_dir.path().join("boards/a.json").exists());
    }

    #[test]
    fn rejects_bad_input() {
        let (_d, s) = store();
        assert!(s.save("a", "nope", None).is_err());
        assert!(s.save("../evil", "{}", None).is_err());
        assert!(s.load("a/b").is_err());
        assert!(s.save_asset("../x.png", b"x").is_err());
        assert!(s.save_asset("x.exe", b"x").is_err());
        s.save_asset("img_1.png", b"png").unwrap();
        assert_eq!(s.load_asset("img_1.png").unwrap(), b"png");
    }

    #[test]
    fn lists_trash_with_the_time_it_was_deleted() {
        let (d, s) = store();
        s.save("a", r#"{"v":1}"#, None).unwrap();
        s.save("b", r#"{"v":2}"#, None).unwrap();
        let before = now_ms() as u64;
        s.trash("a").unwrap();
        let trashed = s.list_trash().unwrap();
        assert_eq!(trashed.len(), 1);
        let (id, json, deleted_at) = &trashed[0];
        assert_eq!((id.as_str(), json.as_str()), ("a", r#"{"v":1}"#));
        assert!(*deleted_at >= before && *deleted_at <= now_ms() as u64);
        // Without the note, the file's own date is used.
        fs::remove_file(d.path().join("trash/a.deleted")).unwrap();
        assert!(s.list_trash().unwrap()[0].2 > 0);
        // Restoring clears the note.
        s.trash("b").unwrap();
        s.restore("b").unwrap();
        assert!(!d.path().join("trash/b.deleted").exists());
        assert_eq!(s.list_trash().unwrap().len(), 1);
        // A damaged trashed board is skipped.
        fs::write(d.path().join("trash/c.json"), "{broken").unwrap();
        assert_eq!(s.list_trash().unwrap().len(), 1);
    }

    #[test]
    fn delete_forever_removes_board_and_history() {
        let (d, s) = store();
        s.save("a", r#"{"v":1}"#, None).unwrap();
        s.save("a", r#"{"v":2}"#, None).unwrap();
        assert!(d.path().join("history/a").is_dir());
        s.trash("a").unwrap();
        s.delete_forever("a").unwrap();
        assert!(s.list_trash().unwrap().is_empty());
        assert!(fs::read_dir(d.path().join("trash")).unwrap().next().is_none());
        assert!(!d.path().join("history/a").exists());
        // Already gone is fine; bad ids are not.
        s.delete_forever("a").unwrap();
        assert!(s.delete_forever("../a").is_err());
    }

    #[test]
    fn purge_only_removes_old_trash() {
        let (d, s) = store();
        s.save("old", r#"{"v":1}"#, None).unwrap();
        s.save("new", r#"{"v":2}"#, None).unwrap();
        s.trash("old").unwrap();
        s.trash("new").unwrap();
        let ten_days_ago = now_ms() as u64 - 10 * 24 * 60 * 60 * 1000;
        fs::write(d.path().join("trash/old.deleted"), ten_days_ago.to_string()).unwrap();
        assert_eq!(s.purge_trash(30 * 24 * 60 * 60 * 1000).unwrap(), 0);
        assert_eq!(s.purge_trash(5 * 24 * 60 * 60 * 1000).unwrap(), 1);
        let left: Vec<_> = s.list_trash().unwrap().into_iter().map(|(id, _, _)| id).collect();
        assert_eq!(left, ["new"]);
        assert!(!d.path().join("history/old").exists());
        assert!(d.path().join("history/new").exists());
    }

    #[test]
    fn saves_lists_and_deletes_templates() {
        let (d, s) = store();
        assert!(s.list_templates().unwrap().is_empty());
        s.save_template("t1", r#"{"name":"Plan"}"#).unwrap();
        s.save_template("t2", r#"{"name":"Map"}"#).unwrap();
        s.save_template("t1", r#"{"name":"Plan 2"}"#).unwrap();
        let mut templates = s.list_templates().unwrap();
        templates.sort();
        assert_eq!(templates, [("t1".to_string(), r#"{"name":"Plan 2"}"#.to_string()), ("t2".to_string(), r#"{"name":"Map"}"#.to_string())]);
        s.delete_template("t1").unwrap();
        s.delete_template("t1").unwrap();
        assert_eq!(s.list_templates().unwrap().len(), 1);
        assert!(s.save_template("../t", "{}").is_err());
        assert!(s.save_template("t3", "nope").is_err());
        assert!(s.delete_template("a/b").is_err());
        // Templates come along when moving to a new folder.
        let new_dir = tempfile::tempdir().unwrap();
        let new = Storage::new(new_dir.path());
        new.adopt_from(&s).unwrap();
        assert_eq!(new.list_templates().unwrap().len(), 1);
        assert!(d.path().join("templates/t2.json").exists());
    }

    #[test]
    fn asset_types_and_size_limit() {
        let (d, s) = store();
        for name in ["a.pdf", "b.docx", "c.key", "d.numbers", "e.mov", "f.m4a", "g.json"] {
            s.save_asset(name, b"x").unwrap();
        }
        for name in ["a.exe", "b.sh", "c.app", "noext", ".png", "a b.png", "../a.pdf"] {
            assert!(s.save_asset(name, b"x").is_err(), "{name} should be refused");
        }
        assert_eq!(s.asset_path("a.pdf").unwrap(), d.path().join("assets/a.pdf"));
        assert!(s.asset_path("../a.pdf").is_err());
        let too_big = vec![0u8; MAX_ASSET_BYTES + 1];
        let e = s.save_asset("big.zip", &too_big).unwrap_err();
        assert_eq!(e.kind(), io::ErrorKind::InvalidInput);
        assert!(!d.path().join("assets/big.zip").exists());
    }

    #[test]
    fn cleanup_keeps_used_and_recent_files() {
        let (d, s) = store();
        for name in ["board.png", "trash.pdf", "old.png", "template.png", "unused.png", "unused2.mov"] {
            s.save_asset(name, b"12345").unwrap();
        }
        s.save("a", r#"{"image":"board.png"}"#, None).unwrap();
        s.save("b", r#"{"file":"trash.pdf"}"#, None).unwrap();
        s.trash("b").unwrap();
        s.save_template("t", r#"{"image":"template.png"}"#).unwrap();
        // Only an old history copy still uses this one.
        fs::create_dir_all(d.path().join("history/a")).unwrap();
        fs::write(d.path().join("history/a/1.json"), r#"{"image":"old.png"}"#).unwrap();
        // Nothing is old enough yet.
        assert_eq!(s.cleanup_assets(24 * 60 * 60 * 1000).unwrap(), (0, 0));
        assert_eq!(fs::read_dir(d.path().join("assets")).unwrap().count(), 6);
        std::thread::sleep(std::time::Duration::from_millis(5));
        assert_eq!(s.cleanup_assets(0).unwrap(), (2, 10));
        for name in ["board.png", "trash.pdf", "old.png", "template.png"] {
            assert!(d.path().join("assets").join(name).exists(), "{name} should be kept");
        }
        assert!(!d.path().join("assets/unused.png").exists());
        assert!(!d.path().join("assets/unused2.mov").exists());
    }

    #[test]
    fn cleanup_deletes_nothing_when_a_board_is_not_downloaded() {
        let (d, s) = store();
        s.save_asset("pic.png", b"png").unwrap();
        fs::create_dir_all(d.path().join("boards")).unwrap();
        fs::write(d.path().join("boards/.a.json.icloud"), "").unwrap();
        assert!(s.cleanup_assets(0).is_err());
        assert!(d.path().join("assets/pic.png").exists());
    }
}
