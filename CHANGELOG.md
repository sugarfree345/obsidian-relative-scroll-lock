# Changelog

## 1.2.1 — 2026-11-17 (Editing compatibility)

- Let Source/Source and Live Preview/Live Preview attempt content-anchor alignment without rejecting them on the outer `.cm-sizer` wrapper's width or inherited typography. A verified, stable seam is still required; failures still unlock with a notice.
- Keep the same-file and same-mode requirements, including the Source/Live Preview distinction. Reading/Reading still requires matching text width and typography; matching editor layouts remain recommended for precision.
- Replace the generic startup rejection with specific notices for the pane layout, file, mode, Reading-view width/typography, editor readiness, and missing positioning API. Mode mismatch notices name both panes' modes.
- Change the Chinese active status to “自动接续” to make editing-mode support clearer. Existing manual locking, Alt adjustment, end-of-file backfill, and short-note behavior remain available.
- Add compatibility regression coverage. See `docs/validation.md` for version-specific results; changing the precheck does not establish which runtime metric caused an individual 1.2.0 failure.

## 1.2.0 — 2026-11-17 (Continuous reading)

- Add **Continue and lock** (`continuous-lock`) in the command palette, ribbon, status bar, and both note headers. Automatically place the right pane after the left pane's visible content before locking.
- Require the same file, display mode, text width, and font size for continuous reading; keep manual relative locking available for different files and mixed modes.
- Use Obsidian's content scroll anchors and recheck the join while scrolling, after resizing, after note changes, and when images load. Stop and unlock with a notice if alignment cannot settle within a bounded wait.
- At the end of a note, put the right pane at the bottom and move the left pane upward to preserve the join. For notes shorter than two panes, temporarily shorten the left reading area and leave the unused space below it; restore the layout on unlock without changing the note body.
- In continuous mode, rejoin automatically after releasing Alt. Preserve the existing manual lock/unlock controls and Alt-based independent adjustment in manual mode.
- Add 23 continuous-reading unit cases alongside the 27 existing regression cases. See `docs/validation.md` for the actual application checks; these unit cases alone do not establish compatibility with every theme or rendering plugin.

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
