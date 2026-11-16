# Changelog

## 1.1.0 — 2026-11-17 (Strict fork)

- Fork upstream 1.0.2 under the separate plugin ID `relative-scroll-lock-strict`, maintained by sugarfree345; retain upstream v-49's MIT license.
- Keep both panes inside their shared scrollable range: reaching either pane's top or bottom stops both in that direction while preserving their starting offset.
- Limit mouse-wheel displacement before native scrolling; reverse scrolling resumes without accumulated overscroll.
- Preserve Alt-based independent adjustment and existing lock/unlock controls.
- Suspend smooth scrolling and automatic browser scroll anchoring while locked, restoring original styles on unlock; verify the fix in actual Obsidian Reading view.
- Distribute a ready-to-install folder ZIP plus standalone Obsidian/BRAT release assets and SHA-256 checksums.
- Clearly separate historical upstream validation from verification of this fork.

The entries below describe the original upstream plugin, not the strict fork.

## 1.0.2 — 2026-10-15

- Add the published Community Plugins listing and in-app installation instructions to the English and Chinese guides. Runtime behavior is unchanged.

## 1.0.1 — 2026-10-15

- Use the English installation and usage guide as the primary README for Community directory review.
- Keep the complete Chinese guide in README.zh-CN.md and include it in the installation package.
- Add a screenshot sized for the Community directory. Runtime behavior is unchanged.

## 1.0.0 — 2026-10-15

- Lock and unlock relative vertical scrolling between two independently positioned Markdown panes.
- Preserve both starting positions, including two views of the same note.
- Hold Alt to adjust one pane independently and resume at the new offset.
- Provide status-bar, ribbon, note-header, and command-palette controls.
- Support Chinese and English UI, with no default keyboard shortcut.
- Unlock automatically when the note, view mode, or supported layout changes.
- Release under the MIT license with reproducible build and regression tests.
