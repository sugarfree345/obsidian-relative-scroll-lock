# Relative Scroll Lock Strict 1.1.0

A fork of v-49's Relative Scroll Lock 1.0.2 with the requested strict boundary behavior.

- Position two Markdown panes independently and lock their relative offset.
- Either pane reaching its top or bottom stops both in that direction.
- Reverse scrolling resumes immediately, with no accumulated overscroll to undo.
- Hold Alt to adjust one pane, then resume from the new positions.
- Preserve existing status-bar, ribbon, note-header, and command-palette controls.

## Install

Disable the original Relative Scroll Lock (and other scroll-sync plugins). Download **`relative-scroll-lock-strict-1.1.0.zip`**, extract its **`relative-scroll-lock-strict`** folder to your vault's `.obsidian/plugins/`, reload Obsidian, and enable **Relative Scroll Lock Strict** under Community plugins.

If you use BRAT, add **`sugarfree345/obsidian-relative-scroll-lock`**. Standalone `main.js`, `manifest.json`, and `styles.css` are attached for BRAT or manual installation. `SHA256SUMS.txt` contains release checksums. GitHub's automatic source archives are not installable builds.

Desktop only; exactly two Markdown panes side by side. The original plugin's Community directory listing does not distribute this fork. The fork uses a separate plugin ID, so it does not overwrite the original installation.

## Verification

27 regression tests, 12 real-browser scenarios, and four real Obsidian 1.15.1 / Windows view combinations passed. The actual-app tests cover strict top/bottom stops, repeated blocked input, immediate reversal, and Alt adjustment in Source, Live Preview, Reading, and mixed panes. Automatic scroll anchoring is disabled while locked and restored on unlock to prevent Reading view layout from feeding unwanted movement into the pair.

See [validation](https://github.com/sugarfree345/obsidian-relative-scroll-lock/blob/main/docs/validation.md) for the scope and evidence of completed checks. Historical upstream results do not certify the changed implementation.

MIT license; original copyright 2026 v-49 retained. Fork maintained by sugarfree345.
