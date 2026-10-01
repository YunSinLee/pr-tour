# Changelog

## 0.8.0 — 2026-10-01

- Explain PRs for readers without repository or domain context by default. Introduce the problem and unfamiliar terms, compare previous and new behavior, and write natural Korean when Korean is requested. Preserve explicit audience/language choices and technical conditions.
- Add Unified / Split diff views with merge-base code on the left and head code on the right, independent line numbers and syntax colors, wrapped long lines, and a browser-saved view preference.
- Preserve expanded context, reading position, side-specific focus, review selections, saved comments, and pinned source links when switching. Keep verified head definition links on the head side; do not assign them to base context.
- Offer Split in the mobile tools menu, with horizontal scrolling or wrapping to the screen width. Close an open tools menu before cancelling a review selection with Escape.
- Update the Korean introduction, both offline demos, and regression coverage for source fidelity, unequal additions/deletions, comments, storage failures, and mobile use.

## 0.7.1 — 2026-09-30

- Replace the header's GitHub text link with an offline GitHub icon, retaining an accessible name, tooltip, keyboard focus, and a 44-pixel click/touch target.
- Copy review feedback as concise Markdown with pinned file/line links, without source code, comment IDs, timestamps, or JSON schema metadata. Use the same text when manual clipboard copying is needed.
- Preserve the complete JSON download/import format for backups and transfer. Update both demos and test copied ranges, base/head source links, renamed paths, literal feedback, and clipboard fallback.

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
