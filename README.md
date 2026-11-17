# Relative Scroll Lock Strict

**Continue one note across two panes and lock scrolling in one click. Or lock any two panes at a manually chosen offset.**

[简体中文](README.zh-CN.md) · [Releases](https://github.com/sugarfree345/obsidian-relative-scroll-lock/releases) · [Report an issue](https://github.com/sugarfree345/obsidian-relative-scroll-lock/issues)

This is a fork of [v-49's Relative Scroll Lock](https://github.com/v-49/obsidian-relative-scroll-lock), based on version 1.0.2. Both panes stop together when either reaches a boundary, and reverse scrolling resumes immediately. Version 1.2.0 added **Continue and lock**, so continuous two-column use no longer requires manually matching the right pane to the end of the left pane. Version 1.2.1 improves compatibility checks for Source and Live Preview editing and provides specific failure notices.

The fork has a separate plugin ID, `relative-scroll-lock-strict`. **Disable the original Relative Scroll Lock and any other scroll-sync plugin before enabling this fork.** The original Community Plugins listing is not this fork.

## Install

### Install the ready-to-use ZIP

1. Use the local build `dist/relative-scroll-lock-strict-1.2.1.zip`, or download that version's ZIP from [Releases](https://github.com/sugarfree345/obsidian-relative-scroll-lock/releases) once it has been published. A local 1.2.1 build does not mean that GitHub's latest release already contains it.
2. Extract the `relative-scroll-lock-strict` folder into your vault's plugin directory, normally `.obsidian/plugins/`.
3. Reload Obsidian. In **Settings → Community plugins**, enable **Relative Scroll Lock Strict**. Restricted mode must be off.

The installed directory must contain `main.js`, `manifest.json`, and `styles.css` directly inside `.obsidian/plugins/relative-scroll-lock-strict/`. Do not add another nested folder. GitHub's automatic source archives require a build; use the installable ZIP instead.

### BRAT

If you already use [BRAT](https://github.com/TfTHacker/obsidian42-brat), add `sugarfree345/obsidian-relative-scroll-lock` as a beta plugin. BRAT installs the published release assets; it does not install an unpublished local build. Releases provide the standalone `main.js`, `manifest.json`, and `styles.css` assets that BRAT expects.

## Continue and lock

1. Open exactly two Markdown panes side by side in the main workspace, displaying the **same note**.
2. Use the **same display mode** in both: Reading view, Live Preview, or source mode. Live Preview and source mode must also match.
3. In Reading view, use matching text width, fonts, font size, and line height. Matching layouts are also recommended in editing mode for precise joins. Position the left pane where you want to begin.
4. Click **Continue and lock** in the ribbon, status bar, or either note header, or run the command with ID `continuous-lock` from the command palette.
5. The plugin places the right pane at the continuation of the left pane's visible content, then locks the pair. Scroll either pane to read.

The join is rechecked while scrolling, after resizing or note changes, and when images load. Alignment has a bounded wait: if the content cannot settle, the plugin unlocks and shows a notice rather than leaving an uncertain join locked.

Near the end of the note, the right pane goes to the bottom and the left pane moves upward to keep the content joined. If the whole note is shorter than two panes, the left reading area temporarily becomes shorter, with unused space below it. Unlocking restores its normal size. These are view changes; the note body is not modified.

Hold **Alt** while scrolling to adjust one pane temporarily. In continuous mode, releasing Alt automatically rejoins the content. Click the ordinary lock control to unlock.

Continuous mode supports **Reading/Reading, Live Preview/Live Preview, and Source/Source**. Different files and mixed modes are rejected. Reading view also requires matching text width and typography. In editing mode, the plugin attempts content-anchor alignment without using the outer editor sizing wrapper's width or font as a precondition; it only remains locked after a stable join is established. Manual locking remains available for different files or mixed modes.

A rejection notice now identifies the specific problem, such as the pane layout, different files, different modes, or an editor that is not ready. Mode mismatch notices name each pane's mode. The continuous status describes scroll behavior and does not switch the panes into Reading view.

## Manual relative locking

1. Open exactly two Markdown panes side by side. The files and display modes may differ.
2. Scroll each pane independently to the desired starting position.
3. Click **Scroll lock: unlocked** in the status bar, ribbon, or note header, or run **Lock / unlock**.
4. Scroll either pane. Both move the same pixel distance, limited by the space remaining in either pane.
5. When either reaches the top or bottom, both stop in that direction. Scroll back to resume immediately.

In manual mode, hold **Alt** to adjust one pane independently; releasing Alt preserves the new relative positions. Manual mode does not automatically rejoin the content. Click the lock again to unlock.

No default shortcuts are assigned. Configure **Continue and lock** and **Lock / unlock** under **Settings → Hotkeys** if desired.

If the two tabs are natively linked, starting either lock mode removes their native link. Unlocking does not restore it; recreate it from the tab context menu if needed.

## Compatibility and limits

- Desktop Obsidian **1.13.7+**; exactly two visible Markdown panes side by side in the main workspace.
- Continuous mode requires the same file and display mode, including the distinction between Source and Live Preview. Reading view additionally requires matching text width and typography. Source and Live Preview use verified content-anchor alignment; matching editor layouts are recommended. Manual mode also supports different files and mixed modes.
- PDF, Canvas, mobile, pop-out windows, vertically stacked panes, and three or more visible main panes are unsupported.
- Changing the file, display mode, or supported layout unlocks the pair. Continuous mode also checks that its rendering requirements still hold.
- Continuous mode uses content scroll anchors and measured layout to maintain the join. Complex themes, folding, very long rendered blocks, and third-party rendering plugins can affect precision; exact alignment under every combination is not guaranteed.
- Mouse-wheel movement is constrained before native scrolling. Other scroll changes use correction through scroll events.
- Ctrl/Meta-wheel zoom, horizontal scrolling, and nested scrollable elements keep their normal behavior.

## Verification

The automated suites cover continuous alignment, compatibility diagnostics, and manual-lock regression cases. Unit tests do not replace checks in Obsidian. See [validation](docs/validation.md) for version-specific results, the recorded application version, actual scenarios, and any remaining limits.

## Privacy and license

No network requests, telemetry, accounts, or note-body changes. The plugin reads view state, scroll positions, and content scroll anchors. Continuous mode may temporarily change the left pane's visible height; unlocking restores it. Starting a lock can remove a native tab link, which Obsidian saves in its workspace state. Pair relationships and positions are not persisted by this plugin.

[MIT](LICENSE). Original copyright **2026 v-49** is retained. Fork maintained by **sugarfree345**. Not affiliated with Obsidian.

## Build

```sh
npm ci
npm run check
npm run package
```

`src/main.js` is bundled to root `main.js`. Packaging produces:

- `dist/relative-scroll-lock-strict/`: installable plugin folder.
- `dist/relative-scroll-lock-strict-1.2.1.zip`: installable ZIP containing that folder.
- `dist/main.js`, `dist/manifest.json`, `dist/styles.css`, `dist/LICENSE`: standalone release assets.
- `dist/SHA256SUMS.txt`: release checksums.

ZIP contents are sorted with fixed timestamps, so the same source and build output produce the same archive. No personal vault is needed to build or run the automated tests.
