# Mythra Board

A fast, simple desktop board for writing ideas down and linking them together.
Built with [Tauri 2](https://tauri.app), React and [React Flow](https://reactflow.dev).

## Using it

**Boards and the home screen**
- The home screen lists your boards with live previews: search (including inside notes), sort, pin, rename, duplicate, delete (with Undo), save as a `.mythra` board file, or open one (⌘O).
- Start blank or from a template (Mind map, Brainstorm, Flowchart, Project plan, Pros & cons). The first launch opens a short Welcome tour.
- **Settings** (⌘,): appearance (Auto / Light / medium-gray Dark), where boards are kept (this Mac, **iCloud Drive**, or any folder) and AI.

**On a board**
- **Double-click** to add a note; **Tab** while typing grows a linked note. Hover an item and drag one of its dots to link it, or drop on empty space for a new note.
- Tools (bottom dock): Select (V), Lasso (L), Pan (H), Note (N), Text (T), Shape (S, eight kinds), Section (F), Arrow/line (A), Pen (P), Eraser (E), Image (I).
- Select something to style it: **Colour** (with fill style), **Outline**, **Text** (Title → Caption styles, size, alignment, card titles), **Shape**, **Arrange** (align, space evenly, group), **Lock**, and **✨ AI**.
- **Mind maps**: fold a branch (C) to hide its children, and "Tidy up" to lay branches out neatly.
- **Link boards**: type `[[Board name]]` in a note, or add a board card (right-click → Link a board here). Boards show what links to them; **⌘[** goes back.
- **⌘K** opens the command palette (every action and board); **⌘F** finds text on the board.
- **Version history** keeps snapshots as you work; restore any of them (undoable).
- **Export** (⇧⌘E): PNG, true-vector SVG, PDF or a board file — the whole board or just the selection — or copy as a picture.
- **Present** (⇧⌘P) turns sections into full-screen slides, with a laser pointer (click and drag).
- **Hand-drawn style** (board ⋯ menu) gives wobbly lines and handwriting.
- **AI** (needs your Anthropic API key in Settings, stored in the Keychain): brainstorm ideas from a note, turn a note into a mind map, or summarise the board. The text involved is sent to Claude only when you use one of these.

Boards save automatically. Each save is written safely with a backup; deleted boards go to `trash/`, pictures to `assets/`, snapshots to `history/`. If a synced board was changed on two Macs at once, the other copy is kept in Version history.

## Development

```sh
pnpm install
pnpm app        # run the desktop app with live reload
pnpm dev        # run in a browser at http://localhost:5420 (saves to browser storage)
pnpm check      # type-check, unit tests, production build
cargo test --manifest-path src-tauri/Cargo.toml   # save/load safety tests
pnpm package    # build Mythra Board.app (and a .dmg)
scripts/release-mac.sh   # signed .app + .dmg (notarised when APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID are set)
```

## Layout

- `src/Home.tsx` – the home screen; `src/templates.ts` – starter boards
- `src/BoardView.tsx` – the board screen
- `src/store.ts` – everything you can do to a board, plus undo/redo
- `src/geometry.ts`, `src/linkPath.ts` – where links attach (and spread out) and how they're drawn
- `src/components/items.tsx` – notes, text, shapes, images, sections, pen strokes, link cards
- `src/components/` – also links, toolbars, the dock and drawing gestures
- `src/persistence.ts` – saving, loading and images (damaged data is skipped, never fatal)
- `src-tauri/src/storage.rs` – atomic file writes, backups, trash, history, images and moving folders
- `src-tauri/src/ai.rs` – Claude requests (key kept in the Keychain); `src-tauri/src/menu.rs` – the menu bar
- `.github/workflows/build.yml` – checks every push; builds macOS, Windows and Linux installers for version tags
