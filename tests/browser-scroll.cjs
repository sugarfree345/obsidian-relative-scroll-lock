// Real Chromium scrolling with synthetic documents; this never opens a vault.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(`<!doctype html><style>
      body { margin: 0; display: flex; gap: 20px; padding: 20px; }
      .pane { width: 440px; height: 300px; overflow: auto; line-height: 20px; scroll-behavior: auto; }
      .content { height: 6000px; background: repeating-linear-gradient(#fff 0 19px, #ddd 19px 20px); }
      #nested { height: 80px; width: 150px; overflow-y: auto; background: #cce; }
      #nested div { height: 800px; }
    </style><div class="pane" tabindex="0"><div class="content">Left synthetic document</div></div>
      <div class="pane" tabindex="0"><div class="content">Right synthetic document</div></div>`);
    const source = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf8');
    await page.addScriptTag({ content: `(() => {
      const module = { exports: {} };
      const require = () => ({ Plugin: class {}, Notice: class {}, setIcon() {}, getLanguage: () => 'en' });
      ${source}
      const panes = [...document.querySelectorAll('.pane')];
      window.scrollTest = { panes, session: null, reset(positions) {
        this.session?.dispose(); this.session = null;
        panes.forEach((pane, i) => { pane.scrollTop = positions[i]; });
      }, lock() { this.session = new module.exports.RelativeScrollSession(panes); } };
    })();` });
    const cases = [];
    const settle = () => page.waitForTimeout(120);
    const positions = () => page.evaluate(() => scrollTest.panes.map(p => p.scrollTop));
    const max = await page.evaluate(() => scrollTest.panes[0].scrollHeight - scrollTest.panes[0].clientHeight);
    const near = (actual, expected, label) => actual.forEach((value, index) =>
      assert.ok(Math.abs(value - expected[index]) < 1.1, `${label}, pane ${index}: ${value} vs ${expected[index]}`));
    const reset = async pair => {
      await page.evaluate(pair => scrollTest.reset(pair), pair);
      await settle();
      await page.evaluate(() => scrollTest.lock());
    };
    const wheel = async (index, delta) => {
      const box = await page.locator('.pane').nth(index).boundingBox();
      await page.mouse.move(box.x + box.width - 50, box.y + 150);
      await page.mouse.wheel(0, delta);
      await settle();
    };
    for (const index of [0, 1]) {
      await reset([max - 420, max - 20]);
      await wheel(index, 100);
      near(await positions(), [max - 400, max], 'partial bottom movement');
      for (let count = 0; count < 4; count++) await wheel(index, 400);
      near(await positions(), [max - 400, max], 'both stay at bottom');
      await wheel(index, -40);
      near(await positions(), [max - 440, max - 40], 'immediate bottom reversal');
      cases.push({ name: `wheel-bottom-from-${index}`, passed: true });

      await reset([20, 420]);
      await wheel(index, -100);
      near(await positions(), [0, 400], 'partial top movement');
      for (let count = 0; count < 4; count++) await wheel(index, -400);
      near(await positions(), [0, 400], 'both stay at top');
      await wheel(index, 40);
      near(await positions(), [40, 440], 'immediate top reversal');
      cases.push({ name: `wheel-top-from-${index}`, passed: true });
    }

    await reset([1200, 5400]);
    await page.evaluate(() => { scrollTest.panes[0].scrollTop = 4000; });
    await settle();
    near(await positions(), [1500, max], 'native scroll fallback clamps source overshoot');
    await page.evaluate(() => { scrollTest.panes[0].scrollTop -= 50; });
    await settle();
    near(await positions(), [1450, max - 50], 'native scroll fallback reverses immediately');
    cases.push({ name: 'native-scroll-fallback', passed: true });

    await reset([max - 400, max]);
    await page.locator('.pane').nth(0).focus();
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(350);
    near(await positions(), [max - 400, max], 'PageDown at bottom keeps both clamped');
    await page.keyboard.press('PageUp');
    await page.waitForTimeout(350);
    const afterPageUp = await positions();
    assert.ok(afterPageUp[0] < max - 400, 'PageUp must move immediately');
    near([afterPageUp[1] - afterPageUp[0]], [400], 'keyboard preserves offset');
    cases.push({ name: 'keyboard-page-navigation', passed: true });

    await reset([1200, 4000]);
    await page.keyboard.down('Alt');
    await wheel(0, 120);
    await page.keyboard.up('Alt');
    const afterAlt = await positions();
    assert.ok(afterAlt[0] > 1200, 'Alt wheel must scroll the source natively');
    near([afterAlt[1]], [4000], 'Alt wheel must leave target untouched');
    await wheel(0, 40);
    near(await positions(), [afterAlt[0] + 40, 4040], 'ordinary wheel uses new Alt offset');
    cases.push({ name: 'native-alt-adjustment', passed: true });

    await reset([0, 400]);
    await page.evaluate(() => {
      const nested = document.createElement('div');
      nested.id = 'nested'; nested.innerHTML = '<div>Nested synthetic scroller</div>';
      scrollTest.panes[0].firstElementChild.prepend(nested);
      nested.scrollTop = 100;
    });
    await page.locator('#nested').hover();
    await page.mouse.wheel(0, 70);
    await settle();
    near(await positions(), [0, 400], 'nested content does not move paired panes');
    assert.ok(await page.locator('#nested').evaluate(el => el.scrollTop > 100), 'nested content scrolls natively');
    cases.push({ name: 'nested-native-scroller', passed: true });

    await page.locator('#nested').evaluate(el => { el.scrollTop = el.scrollHeight - el.clientHeight; });
    await page.mouse.wheel(0, 30);
    await settle();
    near(await positions(), [30, 430], 'nested bottom chains into paired panes');
    cases.push({ name: 'nested-edge-chains-to-pair', passed: true });

    await reset([0, 400]);
    await page.locator('#nested').evaluate(el => { el.style.overscrollBehaviorY = 'contain'; });
    await page.locator('#nested').hover();
    await page.mouse.wheel(0, 70);
    await settle();
    near(await positions(), [0, 400], 'nested containment prevents chaining');
    cases.push({ name: 'nested-containment', passed: true });

    await page.evaluate(() => { scrollTest.session.dispose(); });
    await wheel(1, 60);
    near(await positions(), [0, 460], 'dispose restores independent native wheel');
    cases.push({ name: 'dispose-restores-native-wheel', passed: true });

    // Representative reading-view reflow: newly rendered content above the
    // viewport must not become a synthetic user scroll and move both panes.
    await page.evaluate(() => {
      scrollTest.reset([0, 0]);
      document.activeElement.blur();
      for (const pane of scrollTest.panes) {
        const content = pane.firstElementChild;
        content.replaceChildren(...Array.from({ length: 100 }, (_, index) => {
          const row = document.createElement('div');
          row.style.height = '60px';
          row.textContent = `Synthetic paragraph ${index + 1}`;
          return row;
        }));
      }
    });
    await reset([1200, 2000]);
    await page.waitForTimeout(500);
    const beforeReflow = await positions();
    await page.evaluate(() => {
      const added = document.createElement('div');
      added.style.height = '180px';
      added.textContent = 'Synthetic late-loaded content above the viewport';
      scrollTest.panes[0].firstElementChild.prepend(added);
    });
    await page.waitForTimeout(500);
    near(await positions(), beforeReflow, 'reading reflow does not feed scroll anchoring into the pair');
    await page.evaluate(() => scrollTest.session.dispose());
    assert.equal(await page.locator('.pane').first().evaluate(el => el.style.getPropertyValue('overflow-anchor')), '');
    cases.push({ name: 'layout-reflow-does-not-trigger-paired-scroll', passed: true });
    assert.deepEqual(errors, []);
    const output = path.resolve(__dirname, '../test-results');
    fs.mkdirSync(output, { recursive: true });
    const result = { browser: await browser.version(), source: 'src/main.js', cases, errors, passed: true };
    fs.writeFileSync(path.join(output, 'browser-scroll.json'), JSON.stringify(result, null, 2));
    await page.screenshot({ path: path.join(output, 'browser-scroll.png') });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
