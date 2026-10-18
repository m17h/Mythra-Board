# Mythra Board

A fast, simple desktop board for writing ideas down and linking them together.
Built with [Tauri 2](https://tauri.app), React and [React Flow](https://reactflow.dev).

## Using it

- The **home screen** lists your boards with live previews. Search (it looks inside notes too), sort, pin, rename, duplicate or delete (with Undo). Start new boards blank or from a template: Mind map, Brainstorm, Flowchart, Project plan, Pros & cons.
- **Double-click** anywhere to add a note. Press **Esc** when you're done typing.
- **Hover an item** to see four dots. **Drag a dot** onto another item to link them, or drop it on empty space to start a new linked note. **Click a dot** to add a linked note on that side. Links that share a side spread out so they never overlap.
- **Tab** adds a linked note to the right (Shift-Tab: left), even while typing.
- The **dock** at the bottom has: Note (N), Text (T), Shape (S: box, circle, diamond), Section (F), Pen (P), Eraser (E) and Image (I).
- **Sections** group things: click anywhere in one to select it, drag it and everything inside moves along, double-click inside to add a note. Hold ⇧ and drag inside a section to box-select its contents. Select items and press ⌥⌘G to wrap them in a section; copying a section copies what's in it.
- Items **snap** into line with each other while you drag (hold ⌥ to move freely, or turn it off in the board's ⋯ menu).
- **Right-click** anything for more options, including Bring to front / Send to back.
- **Export as PNG** (⇧⌘E) saves a picture of the whole board.
- Notes understand a little Markdown: `# heading`, `- bullet`, `- [ ] to-do` (tick it right on the board), `**bold**`, `*italic*`, and web addresses become clickable.
- **Paste** text, images or a web address (which becomes a link card). You can also drag image files onto the board.
- **Click a link** to change its shape, arrows, dashes or label. Press **?** for every shortcut, and **⌘[** to go back to all boards.

Boards save automatically to `~/Library/Application Support/com.mythra.board/boards/`, one file per board.
Each save is written safely (never half-written) and the previous version is kept as a backup.
Deleted boards move to `trash/` there, and images are kept in `assets/`.

## Development

```sh
pnpm install
pnpm app        # run the desktop app with live reload
pnpm dev        # run in a browser at http://localhost:1420 (saves to browser storage)
pnpm check      # type-check, unit tests, production build
cargo test --manifest-path src-tauri/Cargo.toml   # save/load safety tests
pnpm package    # build Mythra Board.app (and a .dmg)
```

## Layout

- `src/Home.tsx` – the home screen; `src/templates.ts` – starter boards
- `src/BoardView.tsx` – the board screen
- `src/store.ts` – everything you can do to a board, plus undo/redo
- `src/geometry.ts`, `src/linkPath.ts` – where links attach (and spread out) and how they're drawn
- `src/components/items.tsx` – notes, text, shapes, images, sections, pen strokes, link cards
- `src/components/` – also links, toolbars, the dock and drawing gestures
- `src/persistence.ts` – saving, loading and images (damaged data is skipped, never fatal)
- `src-tauri/src/storage.rs` – atomic file writes, backups, trash and image storage
