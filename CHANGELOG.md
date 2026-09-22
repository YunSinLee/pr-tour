# Changelog

## 0.7.0 — 2026-09-22

- Resize the three desktop panes by dragging either divider, with minimum widths, keyboard controls, cancel/reset, and browser-saved preferences. Preserve pane widths when switching guide/code order; keep the existing tabbed mobile layout.
- Attach source citations to the connection between adjacent reading steps, including unchanged wiring outside the diff. Expand excerpts with line numbers, syntax colors, and pinned source links offline.
- Distinguish source-cited connections, explicit inference with unresolved details, and reading-order moves. Summarize authored and missing connections without implying verified execution-path coverage.
- Reject stale destination IDs, invalid source ranges/sides, and incomplete inference metadata. Preserve older manifests and surface partially authored connections as warnings.
- Add connection explanations to both Starlette examples, including the test client's callback and message queue. Document the format, interpretation limits, and regeneration requirements.
- Save review comments in an IndexedDB transaction to prevent simultaneous saves in different tabs from losing unrelated comments in WebKit. Migrate existing localStorage comments without deleting the legacy copy, and retain JSON export when browser storage is unavailable.
- Thanks to [imMamdouhaboammar](https://github.com/anthropics/skills/discussions/1800#discussioncomment-18549931) for suggesting evidence for the transitions between changed regions.

## 0.6.0 — 2026-09-21

- Add reader comments on individual source lines or ranges, with touch-sized selection controls and a mobile bottom-sheet editor.
- Edit, delete/undo, and revisit comments, including collapsed context and old paths in renamed files.
- Keep saved comments in browser storage per PR snapshot, showing storage failures; preserve dismissed editor drafts for the current page session.
- Preserve unrelated comments saved from another tab and prevent stale edits from silently overwriting newer data. Show a JSON backup warning when a concurrent change prevents saving.
- Copy or download JSON containing pinned commits, source paths, sides, exact selected source, and feedback. Provide manual copying when clipboard access is blocked.
- Import JSON files or pasted exports after validating the PR snapshot and exact source. Preview additions, duplicates and conflicts; keep local edits by default or explicitly replace conflicts. Reject invalid files without changing saved comments.
- Document comment use, storage limits, and the export schema, and test offline use, source fidelity, persistence, snapshot isolation, and mobile layouts in both languages.

## 0.5.0 — 2026-09-21

- Keep the mobile code view open while previous/next follows each note across steps and scrolls to its lines.
- Make room for code with a compact header, a tools menu, and an expanded reading view with access to the current explanation.
- Keep selected lines near the top even at the end of a file, and start each new code point at its left edge.
- Document mobile controls, note ordering, installation updates, and rebuilding existing HTML with the latest renderer. Add English and Korean mobile screenshots.
- Update both offline demos and test forward/backward navigation, expanded reading, menu dismissal, and narrow-screen layouts in Chromium and WebKit.
- Verify that plain URLs and unknown step fragments open the first step and allow navigation.

## 0.4.0 — 2026-09-19

- Add Guide / Code tabs on narrow screens, preserving each pane’s reading position. Notes open their focused code, and changing steps returns to the guide.
- Add optional mobile code wrapping, larger navigation controls, safe-area padding, and a compact phone landscape layout.
- Expand mobile definition previews while preserving related-definition navigation, backdrop dismissal, and source text.
- Rebuild the English and Korean demos and add offline mobile regression coverage in Chromium and WebKit.
