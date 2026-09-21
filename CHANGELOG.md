# Changelog

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
