//! Boards live in `boards/<id>.json`. Files are written atomically (temp file + rename)
//! and the previous version is kept as `<id>.backup.json`, so a crash mid-save can never
//! lose a board. Deleted boards move to `trash/`, and images live in `assets/`.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const BACKUP_SUFFIX: &str = ".backup.json";
const ASSET_EXTENSIONS: [&str; 5] = ["png", "jpg", "jpeg", "gif", "webp"];

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

pub struct Storage {
    boards: PathBuf,
    trash: PathBuf,
    assets: PathBuf,
}

impl Storage {
    pub fn new(root: &Path) -> Self {
        Storage { boards: root.join("boards"), trash: root.join("trash"), assets: root.join("assets") }
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

    pub fn save(&self, id: &str, json: &str) -> io::Result<()> {
        let id = safe_id(id)?;
        if !is_valid(json) {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "refusing to save invalid board data"));
        }
        fs::create_dir_all(&self.boards)?;
        let main = self.main_path(id);
        if main.exists() {
            fs::copy(&main, self.backup_path(id))?;
        }
        write_atomic(&main, json.as_bytes())
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

    /// Move a board (and its backup) into the trash, where it can be restored.
    pub fn trash(&self, id: &str) -> io::Result<()> {
        let id = safe_id(id)?;
        fs::create_dir_all(&self.trash)?;
        for (from, name) in [(self.main_path(id), format!("{id}.json")), (self.backup_path(id), format!("{id}{BACKUP_SUFFIX}"))] {
            if from.exists() {
                fs::rename(from, self.trash.join(name))?;
            }
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
        Ok(())
    }

    pub fn save_asset(&self, name: &str, bytes: &[u8]) -> io::Result<()> {
        let name = safe_asset(name)?;
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
        s.save("a", r#"{"v":1}"#).unwrap();
        s.save("a", r#"{"v":2}"#).unwrap();
        s.save("b", r#"{"v":3}"#).unwrap();
        assert_eq!(s.load("a").unwrap().as_deref(), Some(r#"{"v":2}"#));
        let mut ids: Vec<_> = s.list().unwrap().into_iter().map(|(id, _)| id).collect();
        ids.sort();
        assert_eq!(ids, ["a", "b"]);
    }

    #[test]
    fn falls_back_to_backup_and_keeps_damaged_file() {
        let (d, s) = store();
        s.save("a", r#"{"v":1}"#).unwrap();
        s.save("a", r#"{"v":2}"#).unwrap();
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
        s.save("a", r#"{"v":1}"#).unwrap();
        s.trash("a").unwrap();
        assert!(s.list().unwrap().is_empty());
        s.restore("a").unwrap();
        assert_eq!(s.load("a").unwrap().as_deref(), Some(r#"{"v":1}"#));
    }

    #[test]
    fn rejects_bad_input() {
        let (_d, s) = store();
        assert!(s.save("a", "nope").is_err());
        assert!(s.save("../evil", "{}").is_err());
        assert!(s.load("a/b").is_err());
        assert!(s.save_asset("../x.png", b"x").is_err());
        assert!(s.save_asset("x.exe", b"x").is_err());
        s.save_asset("img_1.png", b"png").unwrap();
        assert_eq!(s.load_asset("img_1.png").unwrap(), b"png");
    }
}
