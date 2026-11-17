// Real Chromium keyboard/pointer input in synthetic scroll containers only.
// The drag rail drives scrollTop from trusted pointer events; it is deliberately
// not presented as a test of the platform's native system-scrollbar thumb.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const sourceRef = process.env.SCROLL_LOCK_TEST_SOURCE_REF;
const source = sourceRef
  ? execFileSync('git', ['show', `${sourceRef}:src/main.js`], { cwd: root, encoding: 'utf8' })
  : fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1020, height: 600 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(`<!doctype html><style>
      body { margin: 0; display: flex; gap: 20px; padding: 20px; }
      .column { width: 440px; height: 300px; position: relative; }
      .pane { width: 440px; height: 300px; overflow: auto; line-height: 20px; }
      .content { height: 12000px; background: repeating-linear-gradient(#fff 0 19px, #ddd 19px 20px); }
      .drag-rail { position: fixed; width: 14px; height: 300px; background: #ccd; z-index: 100;
        user-select: none; touch-action: none; cursor: ns-resize; }
    </style>
    <div class="column"><div class="pane" tabindex="0"><div class="content">Left synthetic note</div></div></div>
    <div class="column"><div class="pane" tabindex="0"><div class="content">Right synthetic note</div></div></div>`);
    await page.addScriptTag({ content: `(() => {
      const module = { exports: {} };
      const require = () => ({ Plugin: class {}, Notice: class {}, setIcon() {}, getLanguage: () => 'en' });
      ${source}
      const panes = [...document.querySelectorAll('.pane')];
      const rails = panes.map((pane) => {
        const rail = document.createElement('div');
        rail.className = 'drag-rail';
        const rect = pane.getBoundingClientRect();
        rail.style.left = (rect.right - 40) + 'px';
        rail.style.top = rect.top + 'px';
        pane.append(rail);
        let drag = null;
        rail.addEventListener('pointerdown', event => {
          drag = { y: event.clientY, top: pane.scrollTop };
          rail.setPointerCapture(event.pointerId);
          pane.focus({ preventScroll: true });
        });
        rail.addEventListener('pointermove', event => {
          if (drag) pane.scrollTop = drag.top + (event.clientY - drag.y) * 6;
        });
        rail.addEventListener('pointerup', event => {
          drag = null;
          if (rail.hasPointerCapture(event.pointerId)) rail.releasePointerCapture(event.pointerId);
        });
        rail.addEventListener('pointercancel', () => { drag = null; });
        return rail;
      });
      window.nativeInput = {
        panes, rails, session: null, samples: [], sampling: false,
        reset() {
          this.session?.dispose();
          panes[0].scrollTop = 1200;
          panes[1].scrollTop = 1500;
          const adapters = panes.map(pane => ({
            at: pixel => pixel / 20,
            apply: anchor => { pane.scrollTop = anchor * 20; },
            setViewportHeight() {}, content: pane.firstElementChild,
          }));
          this.session = new module.exports.ContinuousScrollSession(panes, adapters, { settleMs: 45 });
          return this.session.ready;
        },
        begin() {
          this.samples = [panes.map(pane => pane.scrollTop)];
          this.sampling = true;
          this.check = this.session.realign();
        },
        end() {
          this.sampling = false;
          this.samples.push(panes.map(pane => pane.scrollTop));
          return { positions: panes.map(pane => pane.scrollTop), samples: this.samples,
            height: panes[0].clientHeight, disposed: this.session.disposed };
        },
      };
      function frame() {
        if (nativeInput.sampling) nativeInput.samples.push(panes.map(pane => pane.scrollTop));
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    })();` });

    const cases = [];
    const specifications = [
      { name: 'space-left-during-alignment', index: 0, direction: 1, key: 'Space', count: 1, minimum: 100 },
      { name: 'space-right-during-alignment', index: 1, direction: 1, key: 'Space', count: 1, minimum: 100 },
      { name: 'arrow-down-left-stream', index: 0, direction: 1, key: 'ArrowDown', count: 8, minimum: 80 },
      { name: 'arrow-up-right-stream', index: 1, direction: -1, key: 'ArrowUp', count: 8, minimum: 80 },
      { name: 'pointer-native-scroll-left-stream', index: 0, direction: 1, drag: 70, minimum: 300 },
      { name: 'pointer-native-scroll-right-stream', index: 1, direction: -1, drag: -50, minimum: 200 },
    ];
    for (const spec of specifications) {
      if (!await page.evaluate(() => nativeInput.reset())) throw Error('Synthetic continuous alignment failed to initialize');
      await page.locator('.pane').nth(spec.index).focus();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.evaluate(() => nativeInput.begin());
      if (spec.key) {
        for (let count = 0; count < spec.count; count++) {
          await page.keyboard.press(spec.key);
          if (spec.count > 1) await page.waitForTimeout(22);
        }
      } else {
        const box = await page.locator('.drag-rail').nth(spec.index).boundingBox();
        const x = box.x + box.width / 2;
        const start = box.y + 130;
        await page.mouse.move(x, start);
        await page.mouse.down();
        for (let step = 1; step <= 12; step++) {
          await page.mouse.move(x, start + spec.drag * step / 12);
          await page.waitForTimeout(15);
        }
        await page.mouse.up();
      }
      await page.waitForTimeout(800);
      const result = await page.evaluate(() => nativeInput.end());
      const trace = result.samples.map(sample => sample[spec.index]);
      const reversals = trace.slice(1).filter((value, index) => spec.direction * (value - trace[index]) < -2).length;
      const advance = spec.direction * (trace.at(-1) - trace[0]);
      const seamError = Math.abs(result.positions[1] - result.positions[0] - result.height);
      const failures = [];
      if (advance < spec.minimum) failures.push(`native movement was lost: ${advance}px, expected at least ${spec.minimum}px`);
      if (reversals) failures.push(`${reversals} reverse jumps during one-way input`);
      if (seamError > 2) failures.push(`final content seam differs by ${seamError}px`);
      if (result.disposed) failures.push('the continuous session was unexpectedly disposed');
      cases.push({ name: spec.name, passed: failures.length === 0, input: spec.key || 'trusted pointer drag controlling native scrollTop',
        positions: result.positions, advance, reversals, seamError, frames: trace.length, failures,
        ...(failures.length ? { trace: trace.slice(0, 60) } : {}) });
    }
    const passed = cases.every(item => item.passed) && errors.length === 0;
    const result = { browser: await browser.version(), source: sourceRef || 'working src/main.js',
      fixtureOnly: true, cases, errors, passed };
    const resultsDir = path.join(root, 'test-results');
    fs.mkdirSync(resultsDir, { recursive: true });
    const suffix = sourceRef ? `-baseline-${sourceRef.replace(/[^a-zA-Z0-9_.-]/g, '_')}` : '';
    fs.writeFileSync(path.join(resultsDir, `native-browser-smoke${suffix}.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    if (!passed) process.exitCode = 1;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
