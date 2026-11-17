# Validation

## Native scrolling 1.2.2

Verified on Windows on 2026-11-17, in the guarded synthetic Obsidian vault only:

- **75 Node/JSDOM tests** pass. Added cases reproduce native movement arriving during asynchronous alignment, continuous native scroll streams from either pane, same-value source writes, programmatic echoes, editable key semantics, synchronous editing-position fallback, layout-induced scroll changes at EOF, and real pointer priority. Existing compatibility, continuity and manual-lock checks remain.
- **18 Chrome 157.0.8103.79 cases** pass: the 12 strict-scroll browser cases plus six native-input cases. The same six-case native harness fails against the published 1.2.1 commit `3a7c30e`; the fix records no reverse jumps and a zero final seam error in those synthetic browser scenarios. The drag rail in this browser-only harness is explicitly a real pointer controlling a synthetic scroller, not a native scrollbar thumb. See [native browser comparison](validation-native-browser-1.2.2.json) and [strict browser results](validation-strict-browser-1.2.2.json).
- **20 actual Obsidian 1.15.1 native-input scenarios** pass: Reading Space, ArrowUp/Down, PageUp/Down from both panes (10); actual native scrollbar thumb drags up/down from both Reading panes (4); the same real scrollbar drags from both Live Preview panes (4); and literal Space insertion/caret navigation in both Live Preview editors (2). All scrollbar cases verify a real moving thumb rather than a track click or synthetic substitute. No page errors were recorded. See [native app results and unlocked control](validation-native-obsidian-1.2.2.json).
- The existing **11 actual Obsidian continuity scenarios** pass again on 1.2.2: Source, Live Preview and Reading positioning/EOF/wheel movement, short and one-screen notes, resize correction, and correction after an edit. See [current continuity results](validation-continuous-obsidian-1.2.2.json).

Native input supersedes an earlier alignment revision. While a pointer/key is held or native scrolling is still active, the plugin synchronizes the peer without rewriting an already-correct source position and defers position sampling. After a 120 ms scroll-quiet interval it verifies/rejoins from the last user-driven pane. Layout-induced movement is treated separately, so lazy rendering does not steal ownership or clear EOF pinning. Editing positioning no longer submits the delayed CM6 `applyScroll()` measurement chain; its fallback uses guarded synchronous block geometry.

**Editing-mode measurement:** CM6 virtual-height refinements can change the numeric `scrollTop` while the same visible text remains in place. An unlocked editor control recorded a 121 px reverse change with **no** reverse source-anchor movement. The Live Preview drag checks therefore retain raw pixel traces but judge visible content using read-only cached source anchors, with a 0.05-source-line rounding tolerance. They do not call the mutating `adapter.at()` sampler during the gesture. Reading scenarios use native/unlocked movement baselines and pixel traces. These are bounded, scenario-specific checks, not a promise of zero pixel changes for every theme, decoration or virtualized document.

Optional reproduction:

```sh
npm run test:browser:native
npm run test:app:native
```

The application test requires the same dedicated test profile/vault and CDP port described below. `OBSIDIAN_NATIVE_SCROLLBAR_MODE=editing` runs the four Live Preview native-thumb checks; also setting `OBSIDIAN_NATIVE_UNLOCKED_BASELINE=1` records the unlocked editor control. `OBSIDIAN_NATIVE_TRACE_WRITES=1` optionally instruments script writes for diagnosis. Raw frames remain in ignored `test-results/`; published JSON keeps the case metrics and trace endpoints. No personal vault was used or modified.

## Editing compatibility 1.2.1

Verified on Windows on 2026-11-17:

- **62 Node/JSDOM tests**: the 50 existing tests plus 12 compatibility/diagnostic regression tests.
- **Two additional actual Obsidian 1.15.1 scenarios** in the same guarded synthetic vault. `node tests/editor-compatibility-real-app.cjs` covers Live Preview with unequal outer-wrapper widths and Source editing with unequal inherited wrapper fonts while keeping the text layout controlled. Both scenarios assert that the old precheck would reject, the new precheck accepts, the real content seam settles, wheel scrolling preserves it, and end-of-file backfilling works. No page errors were recorded. See [numeric results](validation-editor-obsidian-1.2.1.json).

The fix removes the CM6 outer-wrapper width/font precondition for editing. Same-file, same-editing-submode and public content-positioning API checks remain, and the actual seam must still converge before success. Reading mode retains its typography/width check. Failure messages now distinguish missing panes, different files, different modes, unavailable editor/API, and reading typography/width mismatches.

The reported user's saved layout confirmed two Live Preview panes and the installed 1.2.0 artifact matched the delivered bytes. Runtime DOM metrics in that user's live window were not available, so the report does not identify their particular failed outer metric as proven. The constructed actual-app regressions demonstrate the false-rejection defect independently. No personal note text or plugin installation was changed by validation.

The 1.2.0 real-app results below remain historical 1.2.0 evidence; the two added 1.2.1 scenarios are recorded separately.

## Continuous reading 1.2.0

Verified on Windows on 2026-11-17, using only synthetic documents and a dedicated Obsidian profile/vault:

- `npm run check`: **50 Node/JSDOM cases** (23 continuous-reading cases and 27 manual-lock regression cases), bundle build, and release metadata verification.
- `npm run test:browser`: **12 real Chrome 157.0.8103.79 scenarios**, including strict boundaries, immediate reversal, keyboard movement, Alt, nested scrollers, cleanup, and layout reflow. These use synthetic browser containers, not Obsidian.
- `node tests/continuous-real-app.cjs`: **11 actual Obsidian 1.15.1 scenarios**, with real Chromium wheel input and no page errors. See [numeric results](validation-continuous-obsidian-1.2.0.json).

The actual-app scenarios cover:

1. Source/Source, Live Preview/Live Preview, and Reading/Reading on the same long synthetic note (800 sections): one-click placement, forward movement, reversal from the other pane, the end-of-file fallback, blocked downward input, and immediate upward reversal.
2. A note shorter than two viewports, in all three display modes: put the right pane at the bottom, expose only the preceding content in the left pane, and restore the full left reading area on unlock.
3. A note that fits in one viewport, in all three modes: keep the entire note in the right pane and leave the left content area blank, without duplicating the text.
4. Automatic seam correction after resizing both panes together.
5. Automatic seam correction after editing the synthetic note.

Unit tests additionally exercise content-to-pixel maps that differ between panes, asynchronous estimate correction, input retained during alignment, Alt pause/resume, blocked-input reversal, cancellation, missing anchors, and integer pixel rounding. Alignment uses a source-position tolerance of 0.025 lines and local pixel stability; it does not promise mathematical zero error at every moment of asynchronous rendering.

The short-note implementation temporarily clips the unused bottom of the left scroller. It preserves the editor's layout, padding, original inline styles and style priorities, and never changes note text. Unlocking removes the temporary clip. The public `MarkdownSubView` scroll-position API supplies content anchors; its normal editor/preview layout and DOM scroll containers are still required.

Continuous mode deliberately requires the same note, same display mode (including the Source/Live Preview distinction), matching text width and typography. Arbitrary themes, mismatched folds, very large rendered blocks, third-party widgets, physical touchpad hardware, other operating systems, and older app versions were not certified by this run. A layout that cannot establish a stable seam unlocks with a notice instead of silently keeping an incorrect join.

To repeat the optional actual-app harness, launch Obsidian with a **dedicated** profile, `--remote-debugging-port=19236`, and the vault at `test-results/obsidian-strict/vault`, containing `Strict test.md` and exactly two Markdown panes. The script verifies the exact vault path before loading the built plugin or changing files. Never adapt the guard to run on a personal vault. `CONTINUOUS_SHORT_ONLY=1` runs only the short-note/reflow subset. The default suite runs all 11 scenarios and writes results under `test-results/`.

## Strict fork 1.1.0

The 1.1.0 fork changes the scroll engine's boundary behavior. Upstream real-app results below are historical evidence for the original implementation, **not certification of this fork**.

Run `npm run check` for the regression suite, bundle build, and release metadata checks. Browser-level and actual Obsidian validation, when run, must be reported separately with their environment and exact scenarios. A passing DOM or browser fixture does not establish real Obsidian compatibility by itself.

Completed checks on Windows for this fork:

- All **27** Node/JSDOM regression tests pass (`npm test`), including strict boundaries from either pane, immediate reversal, fractional/line/page wheel input, Alt, nested scrolling and containment, cleanup, style restoration, and content-height reduction.
- All **12** real Chromium **157.0.8103.51** scenarios pass with no page errors (`npm run test:browser`, installed Chrome required). These use synthetic scroll containers and real wheel/keyboard input, not Obsidian. They also check that inserting content above a locked reading viewport does not trigger automatic scroll anchoring. See [numeric browser results](validation-strict-browser-1.1.0.json).
- The built plugin passes **four** actual **Obsidian 1.15.1 / Windows** scenarios in a separate synthetic vault: Source/Source, Live Preview/Live Preview, Reading/Reading, and Live Preview/Reading. Real wheel input checks independent initial placement, forward/reverse movement, partial top/bottom clamping, six repeated blocked wheel ticks at each edge, immediate reversal without backlog, and Alt adjustment/resumption. No page errors were recorded. See [numeric Obsidian results](validation-strict-obsidian-1.1.0.json) and the guarded optional harness `tests/strict-real-app.cjs`.

Actual-app testing exposed automatic scroll anchoring during Reading view's lazy rendering. The fork disables browser anchoring only while locked, alongside smooth scrolling, and restores the previous inline styles on unlock. The complete four-mode smoke test above passed after this fix. Long Reading views are positioned after their initial lazy layout settles; changing content geometry can still require manual realignment.

These checks do not certify macOS, Linux, physical touchpad hardware, all themes/plugins, or every document type. DOM wheel unit tests cover small fractional and line/page inputs; browser/app tests use real Chromium input generated by Playwright. No personal vault or profile was used or changed.

The critical acceptance scenarios are:

- Lock independently positioned panes without jumping, then move either pane in both directions.
- Stop both at either pane's top or bottom, including a wheel gesture that would overshoot; preserve the starting offset.
- Repeat wheel events at a boundary, then reverse immediately without a dead zone or accumulated overscroll.
- Hold Alt to move only one pane, then release and preserve the new offset.
- Check fractional pixels, line/page wheel units, touchpad-sized input, modifier keys, and nested scrollable regions.
- Check scroll-event fallback for non-wheel movement, plus listener cleanup and layout invalidation.

Manual release acceptance should cover Reading/Reading and Live Preview/Live Preview in an isolated synthetic vault. Editing, resizing, changing folds, and loading images can change content geometry and may require realignment. No personal vault should be used for automated tests.

## Historical upstream validation (1.0.x)

## Evidence and scope

The original local build was tested on Windows in an isolated Obsidian 1.13.7 profile and synthetic vault on 2026-10-15. The [recorded numeric results](validation-1.0.0.json) show separate starting scroll positions and matching displacement for:

- Live Preview / Live Preview;
- Reading view / Reading view;
- Live Preview / Reading view.

Those scenarios checked locking without jumping, bidirectional movement, unlock/reposition/relock, Alt-based independent movement, a real mouse-wheel event, and command invocation. No page runtime errors were recorded. The screenshot also comes from that isolated vault.

## Public release changes

The public release keeps the relative-scroll engine and adds Chinese/English UI. It removes the preset shortcut, removes native-link changes at plugin load, and releases the lock when side-by-side panes become an unsupported layout. A native link is removed only when the user clicks Lock.

The public source has 12 automated regression tests. `npm run check` runs them and verifies the generated release assets. The minified public build was also installed in the isolated test vault and passed the same three mode combinations, mouse-wheel test, Alt adjustment, relocking, and command invocation on Windows / Obsidian 1.14.4. See the [public-build smoke results](public-build-smoke-1.0.0.json). No page runtime errors were recorded. The screenshot in the README is from this public-build run.

## Limits

Automated DOM fixtures are not real Obsidian. Real-app tests cover Windows / Obsidian 1.13.7 for the local original and Windows / Obsidian 1.14.4 for the public build, using synthetic notes. macOS, Linux, physical keyboard shortcuts, source-mode-only real-app use, large image-heavy documents, and third-party editor modifications are not certified. No performance benchmark or general cross-version compatibility claim is made.

The optional harness is `tests/real-app.cjs`. It uses Playwright against a dedicated test Obsidian instance exposing CDP on `127.0.0.1:19235`, with two panes of the synthetic `对照测试.md` file and this plugin enabled. Never point this harness at a personal working vault: it changes the test panes and their scroll positions. It is not part of the default CI test suite.
