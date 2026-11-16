# Relative Scroll Lock Strict

**Position two Markdown panes independently. Lock their offset. Both stop together at either end.**

[简体中文](README.zh-CN.md) · [Download](https://github.com/sugarfree345/obsidian-relative-scroll-lock/releases/latest) · [Report an issue](https://github.com/sugarfree345/obsidian-relative-scroll-lock/issues)

This is a fork of [v-49's Relative Scroll Lock](https://github.com/v-49/obsidian-relative-scroll-lock), based on version 1.0.2. The original scroll-lock controls remain, with a stricter boundary rule: if either pane reaches the top or bottom, neither pane can continue in that direction. Reverse scrolling resumes immediately without consuming accumulated wheel movement.

The fork has a separate plugin ID, `relative-scroll-lock-strict`. **Disable the original Relative Scroll Lock and any other scroll-sync plugin before enabling this fork.** This fork is distributed through GitHub Releases, not the Obsidian Community Plugins listing for the original.

## Install

### Download the ready-to-use ZIP

1. Download `relative-scroll-lock-strict-1.1.0.zip` from the [latest release](https://github.com/sugarfree345/obsidian-relative-scroll-lock/releases/latest).
2. Extract the `relative-scroll-lock-strict` folder into your vault's plugin directory, normally `.obsidian/plugins/`.
3. Reload Obsidian. In **Settings → Community plugins**, enable **Relative Scroll Lock Strict**. Restricted mode must be off.

The installed directory must contain `main.js`, `manifest.json`, and `styles.css` directly inside `.obsidian/plugins/relative-scroll-lock-strict/`. Do not add another nested folder. GitHub's automatic source archives require a build; use the release ZIP instead.

### BRAT

If you already use [BRAT](https://github.com/TfTHacker/obsidian42-brat), add `sugarfree345/obsidian-relative-scroll-lock` as a beta plugin. Releases include the standalone `main.js`, `manifest.json`, and `styles.css` assets that BRAT expects.

## Use

1. Open exactly two Markdown panes side by side in the main workspace. Both can display the same note.
2. Scroll each pane independently to the desired starting position. For continuous two-column reading, align the right pane's first passage with the passage immediately after the left pane's last visible passage.
3. Click **Scroll lock: unlocked** in the status bar, ribbon, or note header.
4. Scroll either pane. Both move the same distance, limited by the space remaining in either pane.
5. If either pane reaches the top or bottom, both stop in that direction. Scroll back to resume immediately.

Hold **Alt** while scrolling to reposition only the pane under the pointer. Release Alt to continue from the new relative positions. Click the lock again to unlock. No default shortcut is assigned; assign **Lock / unlock** under **Settings → Hotkeys** if desired.

If the two tabs are natively linked, clicking Lock removes their native link. Unlocking does not restore it; recreate it from the tab context menu if needed.

## Compatibility and limits

- Desktop Obsidian **1.13.7+**; exactly two visible Markdown panes side by side in the main workspace.
- Reading view, Live Preview, source mode, and mixed modes use the existing view adapters. See [validation](docs/validation.md) for what has actually been tested for this fork.
- PDF, Canvas, mobile, pop-out windows, vertically stacked panes, and three or more visible main panes are unsupported.
- A file, view-mode, or unsupported layout change unlocks the pair.
- This preserves pixel distance, not corresponding text or line numbers. Keep pane widths, fonts, and display modes equal for continuous same-note reading. Edits, folds, resizing, and images loading may require realignment.
- Mouse-wheel movement is constrained before the panes scroll. Other scroll changes use correction through scroll events; do not assume every third-party editor modification behaves identically.
- Ctrl/Meta-wheel zoom, horizontal scrolling, and nested scrollable elements keep their normal behavior.

## Privacy and license

No network requests, telemetry, accounts, or note-body changes. The plugin reads view and scroll-container state. Locking can remove a native tab link, which Obsidian saves in its workspace state. Pair relationships and positions are not persisted by this plugin.

[MIT](LICENSE). Original copyright **2026 v-49** is retained. Fork maintained by **sugarfree345**. Not affiliated with Obsidian.

## Build

```sh
npm ci
npm run check
npm run package
```

`src/main.js` is bundled to root `main.js`. Packaging produces:

- `dist/relative-scroll-lock-strict/`: installable plugin folder.
- `dist/relative-scroll-lock-strict-1.1.0.zip`: installable ZIP containing that folder.
- `dist/main.js`, `dist/manifest.json`, `dist/styles.css`, `dist/LICENSE`: standalone release assets.
- `dist/SHA256SUMS.txt`: release checksums.

ZIP contents are sorted with fixed timestamps, so the same source and build output produce the same archive. No personal vault is needed to build or run the automated tests.
