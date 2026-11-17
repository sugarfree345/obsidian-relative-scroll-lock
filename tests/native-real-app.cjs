// Optional acceptance test against an already running, isolated Obsidian.
// Launch its dedicated profile with --remote-debugging-port=19236. This script
// refuses every vault except test-results/obsidian-strict/vault. It does not
// launch Obsidian or change any personal vault or security setting.
//
// During native input the recorder only reads positions and cached source
// anchors. It never calls adapter.at(), snapshot(), or pixelFor(): those can
// temporarily assign scrollTop and interfere with a native gesture.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results');
const expectedVault = path.join(output, 'obsidian-strict/vault');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const id = manifest.id;
const editingScrollbars = process.env.OBSIDIAN_NATIVE_SCROLLBAR_MODE === 'editing';
const unlockedScrollbarBaseline = editingScrollbars && process.env.OBSIDIAN_NATIVE_UNLOCKED_BASELINE === '1';
const captureWrites = process.env.OBSIDIAN_NATIVE_TRACE_WRITES === '1';
const readingNote = 'Native scrolling acceptance.md';
const editingNote = 'Native editing semantics.md';
const fixtureText = Array.from({ length: 500 }, (_, index) =>
  `Paragraph ${index + 1}. Alpha beta gamma delta epsilon. This synthetic paragraph tests native keyboard and scrollbar input without touching personal notes.`).join('\n\n');
const normalize = value => process.platform === 'win32'
  ? path.resolve(value).toLowerCase() : path.resolve(value);

(async () => {
  const browser = await chromium.connectOverCDP(process.env.OBSIDIAN_TEST_CDP || 'http://127.0.0.1:19236');
  let page;
  const results = [];
  const errors = [];
  const originals = new Map();
  let fatal = null;

  const assertFixture = async () => assert.equal(
    normalize(await page.evaluate(() => app.vault.adapter.basePath)), normalize(expectedVault),
    'refuse to operate on a personal or newly switched vault');

  const raw = () => page.evaluate(id => {
    const plugin = app.plugins.plugins[id];
    const pair = plugin.findPair();
    if (!pair) throw Error('The synthetic workspace must contain exactly two side-by-side Markdown panes');
    return pair.map(leaf => plugin.scroller(leaf.view).scrollTop);
  }, id);

  // This is intentionally separate from raw(). Call ONLY after input has
  // ended and the read-only animation trace has reached a quiet period.
  const snapshot = () => page.evaluate(id => {
    const plugin = app.plugins.plugins[id];
    const pair = plugin.findPair();
    return {
      locked: Boolean(plugin.session?.continuous), aligning: Boolean(plugin.session?.aligning),
      panes: pair?.map((leaf, index) => {
        const pane = plugin.scroller(leaf.view);
        const adapter = plugin.adapter(leaf.view);
        const height = plugin.session?.height(index) ?? pane.clientHeight;
        return { top: pane.scrollTop, height, max: pane.scrollHeight - pane.clientHeight,
          topAnchor: adapter.at(pane.scrollTop), bottomAnchor: adapter.at(pane.scrollTop + height) };
      }),
    };
  }, id);

  const assertSeam = (state, label) => {
    assert.equal(state.locked, true, `${label}: continuous lock must remain active`);
    assert.ok(state.panes?.length === 2, `${label}: both panes must remain visible`);
    const error = Math.abs(state.panes[0].bottomAnchor - state.panes[1].topAnchor);
    assert.ok(Number.isFinite(error) && error <= 0.05,
      `${label}: source-position seam differs by ${error}: ${JSON.stringify(state)}`);
  };

  const focusReading = index => page.evaluate(({ id, index }) => {
    const plugin = app.plugins.plugins[id];
    const pane = plugin.scroller(plugin.findPair()[index].view);
    window.getSelection()?.removeAllRanges();
    pane.setAttribute('tabindex', '0');
    pane.focus({ preventScroll: true });
    if (document.activeElement !== pane) throw Error('Reading scroller did not receive keyboard focus');
  }, { id, index });

  const setMode = async (mode, file = readingNote) => {
    await assertFixture();
    await page.evaluate(async ({ id, mode, file }) => {
      const plugin = app.plugins.plugins[id];
      plugin.unlock();
      const pair = plugin.findPair();
      if (!pair) throw Error('Missing synthetic Markdown pair');
      for (const leaf of pair) await leaf.setViewState({ type: 'markdown', state: { file, ...mode } });
    }, { id, mode, file });
    await page.waitForTimeout(650);
  };

  const resetPositions = async positions => {
    // Reapply while UNLOCKED to absorb Reading view's initial height estimate.
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.evaluate(({ id, positions }) => {
        const plugin = app.plugins.plugins[id];
        plugin.unlock();
        plugin.findPair().forEach((leaf, index) => {
          plugin.scroller(leaf.view).scrollTop = positions[index];
        });
      }, { id, positions });
      await page.waitForTimeout(220);
    }
  };

  const join = async () => {
    assert.equal(await page.evaluate(id => app.plugins.plugins[id].continuousLock(), id), true,
      'synthetic pair must align before input');
    await page.waitForTimeout(250);
    const state = await snapshot();
    assertSeam(state, 'before native input');
    // snapshot() samples content positions; allow any resulting native event
    // to settle BEFORE recording or dispatching the tested input.
    await page.waitForTimeout(200);
    return state;
  };

  const recordNative = async (operation, { locked = true } = {}) => {
    await page.evaluate(({ id, captureWrites }) => {
      const plugin = app.plugins.plugins[id];
      const pair = plugin.findPair();
      const panes = pair.map(leaf => plugin.scroller(leaf.view));
      const editing = pair.map(leaf => leaf.view.getMode() === 'source');
      const trace = { frames: [], writes: [], restores: [], running: true, lastMovement: performance.now(), frameId: null };
      if (captureWrites && editing.some(Boolean)) panes.forEach((pane, index) => {
        let prototype = Object.getPrototypeOf(pane);
        while (prototype && !Object.getOwnPropertyDescriptor(prototype, 'scrollTop')) prototype = Object.getPrototypeOf(prototype);
        const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, 'scrollTop');
        if (!descriptor?.get || !descriptor?.set) return;
        const own = Object.getOwnPropertyDescriptor(pane, 'scrollTop');
        trace.restores.push({ pane, own });
        Object.defineProperty(pane, 'scrollTop', { configurable: true,
          get() { return descriptor.get.call(this); },
          set(top) {
            if (trace.running && trace.writes.length < 1500) trace.writes.push({ time: performance.now(), index,
              before: descriptor.get.call(this), top, stack: String(new Error().stack).slice(0, 600) });
            descriptor.set.call(this, top);
          },
        });
      });
      window.__relativeScrollNativeTrace = trace;
      const sample = () => {
        if (!trace.running) return;
        const tops = panes.map(pane => pane.scrollTop);
        const previous = trace.frames.at(-1);
        const now = performance.now();
        if (!previous || tops.some((top, index) => Math.abs(top - previous.tops[index]) > 0.01)) {
          trace.lastMovement = now;
        }
        // Editing getScroll() reads cached CM geometry without assigning
        // scrollTop. It distinguishes virtual-height adjustment from actual
        // reversal of visible source content. Never call adapter.at() here.
        const anchors = pair.map((leaf, index) => editing[index] ? leaf.view.currentMode.getScroll() : null);
        const session = plugin.session;
        trace.frames.push({ time: now, tops, anchors, heights: panes.map(pane => pane.scrollHeight),
          state: { driver: session?.driver, aligning: session?.aligning, pointers: session?.nativePointers?.size,
            revision: session?.inputRevision, quiet: session ? Math.max(0, session.nativeUntil - Date.now()) : 0 } });
        if (trace.frames.length < 1200) trace.frameId = requestAnimationFrame(sample);
      };
      sample();
    }, { id, captureWrites });
    let operationResult;
    let failure;
    try {
      operationResult = await operation();
      await page.waitForTimeout(260);
      await page.waitForFunction(({ id, locked }) => {
        const trace = window.__relativeScrollNativeTrace;
        const session = app.plugins.plugins[id]?.session;
        return trace && performance.now() - trace.lastMovement >= 240 && (!locked || !session?.aligning);
      }, { id, locked }, { timeout: 6000 });
    } catch (error) { failure = error; }
    const recorded = await page.evaluate(() => {
      const trace = window.__relativeScrollNativeTrace;
      trace.running = false;
      cancelAnimationFrame(trace.frameId);
      for (const { pane, own } of trace.restores) {
        if (own) Object.defineProperty(pane, 'scrollTop', own); else delete pane.scrollTop;
      }
      return { frames: trace.frames, writes: trace.writes };
    });
    const frames = recorded.frames;
    if (failure) {
      failure.nativeFrames = frames;
      throw failure;
    }
    return { frames, writes: recorded.writes, operationResult };
  };

  const motion = (trace, index, direction) => {
    const frames = trace.frames;
    assert.ok(frames.length >= 3, 'record several actual animation frames');
    let reverseDistance = 0;
    let maxReverseStep = 0;
    for (let frame = 1; frame < frames.length; frame++) {
      const signed = direction * (frames[frame].tops[index] - frames[frame - 1].tops[index]);
      if (signed < 0) {
        reverseDistance -= signed;
        maxReverseStep = Math.max(maxReverseStep, -signed);
      }
    }
    return { start: frames[0].tops[index], end: frames.at(-1).tops[index],
      signedDistance: direction * (frames.at(-1).tops[index] - frames[0].tops[index]),
      reverseDistance, maxReverseStep };
  };

  const contentMotion = (trace, index, direction) => {
    let checked = 0;
    let reversals = 0;
    let maxReverseLines = 0;
    for (let frame = 1; frame < trace.frames.length; frame++) {
      const before = trace.frames[frame - 1].anchors?.[index];
      const after = trace.frames[frame].anchors?.[index];
      if (!Number.isFinite(before) || !Number.isFinite(after)) continue;
      checked++;
      const delta = direction * (after - before);
      maxReverseLines = Math.max(maxReverseLines, -delta);
      if (delta < -0.05) reversals++;
    }
    return { checked, reversals, maxReverseLines };
  };

  const runCase = async (name, operation) => {
    console.log('Testing', name);
    try {
      const detail = await operation();
      results.push({ name, status: 'passed', ...detail });
    } catch (error) {
      results.push({ name, status: 'failed', error: error.stack || String(error),
        frames: error.nativeFrames });
      console.error('FAILED', name, error.message);
    }
  };

  try {
    // The exact path is checked before installing the build, creating notes,
    // changing panes, pressing keys, or touching settings in the test profile.
    for (const candidate of browser.contexts().flatMap(context => context.pages())) {
      if (!candidate.url().startsWith('app://obsidian.md/')) continue;
      const base = await candidate.evaluate(() => app.vault.adapter.basePath).catch(() => null);
      if (base && normalize(base) === normalize(expectedVault)) { page = candidate; break; }
    }
    assert.ok(page, 'the dedicated Obsidian test vault must already be running on the requested CDP port');
    await assertFixture();
    assert.equal(normalize(fs.realpathSync(expectedVault)), normalize(expectedVault),
      'the synthetic vault path must not redirect to another location');
    page.on('pageerror', error => errors.push(error.message));
    await page.bringToFront();
    const pluginDir = path.join(expectedVault, '.obsidian/plugins', id);
    fs.mkdirSync(pluginDir, { recursive: true });
    for (const name of ['main.js', 'manifest.json', 'styles.css']) {
      fs.copyFileSync(path.join(root, name), path.join(pluginDir, name));
    }
    await page.evaluate(async id => {
      await app.plugins.unloadPlugin(id);
      await app.plugins.loadManifests();
      await app.plugins.enablePlugin(id);
      if (!app.plugins.plugins[id]) throw Error('Built plugin did not load in synthetic vault');
    }, id);
    for (const name of [readingNote, editingNote]) {
      originals.set(name, await page.evaluate(async ({ name, text }) => {
        const file = app.vault.getAbstractFileByPath(name);
        const original = file ? await app.vault.cachedRead(file) : null;
        if (file) await app.vault.modify(file, text); else await app.vault.create(name, text);
        return original;
      }, { name, text: fixtureText }));
    }
    await page.evaluate(async ({ id, note }) => {
      const plugin = app.plugins.plugins[id];
      plugin.unlock();
      const leaves = app.workspace.getLeavesOfType('markdown');
      for (const leaf of leaves.slice(1)) leaf.detach();
      const file = app.vault.getAbstractFileByPath(note);
      const left = leaves[0]?.parent ? leaves[0] : app.workspace.createLeafInParent(app.workspace.rootSplit, 0);
      await left.openFile(file);
      const right = app.workspace.createLeafBySplit(left, 'vertical', false);
      await right.openFile(file);
      for (const leaf of app.workspace.getLeavesOfType('empty')) leaf.detach();
      app.workspace.leftSplit.collapse();
      app.workspace.rightSplit.collapse();
    }, { id, note: readingNote });
    await setMode({ mode: 'preview' });

    // Compare each locked native animation against the same unlocked browser
    // behavior, so a one-frame/truncated animation cannot count as a pass.
    if (!editingScrollbars) for (const index of [0, 1]) {
      for (const [key, direction] of [['Space', 1], ['ArrowDown', 1], ['ArrowUp', -1], ['PageDown', 1], ['PageUp', -1]]) {
        await runCase(`Reading pane ${index}: ${key}`, async () => {
          await resetPositions([4000, 9000]);
          await join();
          const initialPositions = await raw();
          await resetPositions(initialPositions);
          await focusReading(index);
          const baseline = await recordNative(() => page.keyboard.press(key, { delay: 70 }), { locked: false });
          const nativeMotion = motion(baseline, index, direction);
          assert.ok(nativeMotion.signedDistance > 8, `${key}: unlocked native baseline must actually move`);
          await resetPositions(initialPositions);
          await join();
          await focusReading(index);
          const locked = await recordNative(() => page.keyboard.press(key, { delay: 70 }));
          const source = motion(locked, index, direction);
          const peer = motion(locked, 1 - index, direction);
          assert.ok(source.signedDistance >= Math.max(5, nativeMotion.signedDistance * 0.65),
            `${key}: native animation was truncated (${source.signedDistance} vs unlocked ${nativeMotion.signedDistance})`);
          assert.ok(Math.abs(source.signedDistance - nativeMotion.signedDistance) <= Math.max(12, nativeMotion.signedDistance * 0.25),
            `${key}: locked native distance differs materially from unlocked baseline`);
          assert.ok(peer.signedDistance > 5, `${key}: the other pane must follow`);
          for (const [label, value] of [['source', source], ['peer', peer]]) {
            assert.ok(value.maxReverseStep <= 2.1 && value.reverseDistance <= 6,
              `${key}: ${label} visibly reversed during native animation: ${JSON.stringify(value)}`);
          }
          const after = await snapshot();
          assertSeam(after, `${key}: settled join`);
          return { index, key, direction, nativeMotion, source, peer, baseline, locked, after };
        });
      }
    }

    // There is no DOM element representing a native scrollbar thumb. Infer
    // its bounds from the real track and scrollbar pseudo-element dimensions,
    // then issue actual mouse down/move/up events through Chromium. A failed
    // hit test is reported as NOT VERIFIED, never as a passing drag test.
    if (editingScrollbars) await setMode({ mode: 'source', source: false });
    for (const index of [0, 1]) for (const direction of [1, -1]) {
      const name = `${editingScrollbars ? 'Live Preview' : 'Reading'} pane ${index}: native scrollbar drag ${direction > 0 ? 'down' : 'up'}`;
      console.log('Testing', name);
      const attempts = [];
      let verified = false;
      try {
        for (const minimumThumb of [40, 20]) {
          await resetPositions([9000, 14000]);
          await join();
          if (unlockedScrollbarBaseline) await resetPositions(await raw());
          const geometry = await page.evaluate(({ id, index, minimumThumb, direction }) => {
            const plugin = app.plugins.plugins[id];
            const pane = plugin.scroller(plugin.findPair()[index].view);
            const rect = pane.getBoundingClientRect();
            const style = getComputedStyle(pane);
            const borderTop = parseFloat(style.borderTopWidth) || 0;
            const borderRight = parseFloat(style.borderRightWidth) || 0;
            const trackHeight = pane.clientHeight;
            const max = pane.scrollHeight - trackHeight;
            const cssMinimum = parseFloat(getComputedStyle(pane, '::-webkit-scrollbar-thumb').minHeight) || minimumThumb;
            const thumbHeight = Math.min(trackHeight, Math.max(cssMinimum, trackHeight * trackHeight / pane.scrollHeight));
            const thumbTop = rect.top + borderTop + (trackHeight - thumbHeight) * pane.scrollTop / Math.max(1, max);
            const gutter = Math.max(0, rect.width - pane.clientLeft - pane.clientWidth - borderRight);
            const x = gutter >= 3 ? rect.right - borderRight - gutter / 2 : rect.right - borderRight - 3;
            const y = thumbTop + thumbHeight / 2;
            const endY = Math.max(rect.top + 8, Math.min(rect.bottom - 8, y + direction * 28));
            return { x, y, endY, gutter, thumbHeight, top: pane.scrollTop, max };
          }, { id, index, minimumThumb, direction });
          await page.mouse.move(geometry.x, geometry.y);
          const trace = await recordNative(async () => {
            const before = await raw();
            const checkpoints = [];
            let afterDown;
            await page.mouse.down();
            let upAt;
            try {
              await page.waitForTimeout(70);
              afterDown = await raw();
              for (let step = 1; step <= 18; step++) {
                await page.mouse.move(geometry.x, geometry.y + (geometry.endY - geometry.y) * step / 18);
                await page.waitForTimeout(16);
                if (step % 3 === 0) checkpoints.push(await raw());
              }
            } finally {
              await page.mouse.up();
              upAt = await page.evaluate(() => performance.now());
            }
            return { before, afterDown, checkpoints, upAt };
          }, { locked: !unlockedScrollbarBaseline });
          const source = motion(trace, index, direction);
          const peer = motion(trace, 1 - index, direction);
          const { before, afterDown, checkpoints } = trace.operationResult;
          const noTrackClick = Math.abs(afterDown[index] - before[index]) <= 3;
          const movingCheckpoints = new Set(checkpoints.map(tops => Math.round(tops[index]))).size;
          const hitThumb = noTrackClick && movingCheckpoints >= 2 && source.signedDistance > 12;
          attempts.push({ geometry, hitThumb, noTrackClick, movingCheckpoints, source, peer, trace });
          if (!hitThumb) continue;
          if (!unlockedScrollbarBaseline) assert.ok(peer.signedDistance > 5, 'native thumb movement must move the other pane');
          const visible = editingScrollbars ? {
            source: contentMotion(trace, index, direction), peer: contentMotion(trace, 1 - index, direction),
          } : null;
          if (!unlockedScrollbarBaseline) for (const [label, value] of [['source', source], ['peer', peer]]) {
            if (visible) {
              // CM6 refines virtual document heights while scrolling. Its
              // scrollTop may reverse even WITHOUT the plugin while visible
              // source content keeps moving forward. Verify the cached source
              // anchor instead, allowing the same 0.05-line rounding tolerance
              // used by the settled seam check; retain raw pixel metrics.
              assert.ok(visible[label].checked >= 3, 'record cached content anchors');
              assert.equal(visible[label].reversals, 0,
                `${label} content reversed during thumb drag: ${JSON.stringify(visible[label])}`);
            } else assert.ok(value.maxReverseStep <= 2.1 && value.reverseDistance <= 6,
              `${label} reversed during thumb drag: ${JSON.stringify(value)}`);
          }
          const after = await snapshot();
          if (!unlockedScrollbarBaseline) assertSeam(after, 'settled native scrollbar join');
          results.push({ name, status: 'passed', index, direction, attempts, visible, after });
          verified = true;
          break;
        }
        if (!verified) results.push({ name, status: 'not-verified', index, direction, attempts,
          reason: 'Real mouse events did not establish a moving native thumb. No synthetic scrollTop substitute was used.' });
      } catch (error) {
        results.push({ name, status: 'failed', index, direction, attempts,
          error: error.stack || String(error), frames: error.nativeFrames });
        console.error('FAILED', name, error.message);
      }
    }

    // Editor semantics: the same key handlers must not consume a literal
    // Space or ordinary caret navigation in either Live Preview pane.
    if (!editingScrollbars) for (const index of [0, 1]) {
      await runCase(`Live Preview pane ${index}: Space and caret navigation`, async () => {
        await setMode({ mode: 'source', source: false }, editingNote);
        await resetPositions([1800, 6000]);
        await join();
        await page.evaluate(({ id, index }) => {
          const plugin = app.plugins.plugins[id];
          const view = plugin.findPair()[index].view;
          const editor = view.editor;
          let line = Math.min(editor.lineCount() - 2, Math.floor(view.currentMode.getScroll()) + 3);
          while (line < editor.lineCount() - 2 && !editor.getLine(line).trim()) line++;
          editor.setCursor({ line, ch: Math.min(8, editor.getLine(line).length) });
          editor.focus();
        }, { id, index });
        await page.waitForTimeout(500);
        const editorState = () => page.evaluate(({ id, index }) => {
          const plugin = app.plugins.plugins[id];
          const editor = plugin.findPair()[index].view.editor;
          const cursor = editor.getCursor();
          return { text: editor.getValue(), cursor, offset: editor.posToOffset(cursor) };
        }, { id, index });
        const before = await editorState();
        const space = await recordNative(() => page.keyboard.press('Space', { delay: 60 }));
        const inserted = await editorState();
        assert.equal(inserted.text, before.text.slice(0, before.offset) + ' ' + before.text.slice(before.offset),
          'Space inserts exactly one literal space in the editing document');
        assert.equal(inserted.offset, before.offset + 1, 'Space advances the caret');
        const down = await recordNative(() => page.keyboard.press('ArrowDown', { delay: 60 }));
        const afterDown = await editorState();
        assert.equal(afterDown.text, inserted.text, 'ArrowDown does not edit the document');
        assert.ok(afterDown.offset > inserted.offset,
          'ArrowDown moves the native caret, including within a soft-wrapped source line');
        const up = await recordNative(() => page.keyboard.press('ArrowUp', { delay: 60 }));
        const afterUp = await editorState();
        assert.equal(afterUp.text, inserted.text, 'ArrowUp does not edit the document');
        assert.ok(afterUp.offset < afterDown.offset, 'ArrowUp moves the native editor caret upward');
        assert.ok(Math.abs(afterUp.offset - inserted.offset) <= 1,
          'ArrowUp returns to the previous visual caret column');
        const after = await snapshot();
        assertSeam(after, 'join after Live Preview editing');
        // Do not include whole fixture documents in the result artifact.
        const cursorOnly = state => ({ cursor: state.cursor, offset: state.offset, length: state.text.length });
        await page.evaluate(async ({ id, name, text }) => {
          const plugin = app.plugins.plugins[id];
          plugin.unlock();
          for (const leaf of plugin.findPair()) await leaf.view.save();
          await app.vault.modify(app.vault.getAbstractFileByPath(name), text);
        }, { id, name: editingNote, text: fixtureText });
        await page.waitForTimeout(300);
        return { index, before: cursorOnly(before), inserted: cursorOnly(inserted),
          afterDown: cursorOnly(afterDown), afterUp: cursorOnly(afterUp), space, down, up, after };
      });
    }
  } catch (error) {
    fatal = error.stack || String(error);
    console.error(error);
  } finally {
    if (page) {
      try {
        await assertFixture();
        await page.evaluate(async id => {
          const plugin = app.plugins.plugins[id];
          plugin?.unlock();
          for (const leaf of app.workspace.getLeavesOfType('markdown')) await leaf.view.save();
          const trace = window.__relativeScrollNativeTrace;
          if (trace) { trace.running = false; cancelAnimationFrame(trace.frameId); }
        }, id);
        // Leave newly created synthetic fixtures available for inspection,
        // but restore pre-existing fixture files and remove test insertions.
        for (const [name, original] of originals) await page.evaluate(async ({ name, text }) => {
          const file = app.vault.getAbstractFileByPath(name);
          if (file) await app.vault.modify(file, text);
        }, { name, text: original ?? fixtureText });
      } catch (error) { errors.push(`Fixture cleanup: ${error.message}`); }
    }
    fs.mkdirSync(output, { recursive: true });
    const failed = results.filter(result => result.status === 'failed');
    const unverified = results.filter(result => result.status === 'not-verified');
    const report = {
      app: page ? await page.title().catch(() => null) : null,
      userAgent: page ? await page.evaluate(() => navigator.userAgent).catch(() => null) : null,
      pluginVersion: manifest.version, fixtureOnly: true, unlockedScrollbarBaseline,
      recorder: 'requestAnimationFrame reads scrollTop and cached editor anchors without assigning scrollTop; seam sampled after input and quiet period',
      results, errors, fatal, verified: results.filter(result => result.status === 'passed').length,
      notVerified: unverified.length, failed: failed.length,
      passed: !fatal && failed.length === 0 && errors.length === 0 && unverified.length === 0,
    };
    const reportName = unlockedScrollbarBaseline ? 'native-obsidian-editing-baseline.json' : editingScrollbars ? 'native-obsidian-editing-smoke.json' : 'native-obsidian-smoke.json';
    fs.writeFileSync(path.join(output, reportName), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ verified: report.verified, notVerified: report.notVerified,
      failed: report.failed, errors: report.errors, passed: report.passed }));
    if (fatal || failed.length || errors.length) process.exitCode = 1;
    else if (unverified.length) process.exitCode = 2;
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
