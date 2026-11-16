// Optional smoke test: connect ONLY to a separately launched synthetic vault.
// Obsidian.exe --user-data-dir=<workspace>/test-results/obsidian-strict/profile
//              --remote-debugging-port=19236
// The expected vault must be <workspace>/test-results/obsidian-strict/vault.
// This intentionally refuses to operate on any other vault.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results/obsidian-strict');
const expectedVault = path.join(output, 'vault');
const pluginId = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).id;
const note = 'Strict test.md';
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= 2,
  `${label}: ${actual} vs ${expected}`);

(async () => {
  const browser = await chromium.connectOverCDP(process.env.OBSIDIAN_TEST_CDP || 'http://127.0.0.1:19236');
  try {
    const page = browser.contexts().flatMap(context => context.pages())
      .find(page => page.url().startsWith('app://obsidian.md/'));
    assert.ok(page, 'isolated Obsidian test instance must be running');
    assert.equal(await page.evaluate(() => app.vault.adapter.basePath), expectedVault,
      'refuse to run against a personal vault');
    const pluginDir = path.join(expectedVault, '.obsidian/plugins', pluginId);
    fs.mkdirSync(pluginDir, { recursive: true });
    for (const name of ['main.js', 'manifest.json', 'styles.css']) {
      fs.copyFileSync(path.join(root, name), path.join(pluginDir, name));
    }
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(async ({ pluginId, note }) => {
      await app.plugins.unloadPlugin(pluginId);
      await app.plugins.loadManifests();
      await app.plugins.setEnable(true);
      await app.plugins.enablePlugin(pluginId);
      if (!app.plugins.plugins[pluginId]) throw Error('Plugin failed to load');
      const existing = app.workspace.getLeavesOfType('markdown');
      for (const leaf of existing.slice(1)) leaf.detach();
      const file = app.vault.getAbstractFileByPath(note);
      if (!file) throw Error('Synthetic fixture note missing');
      const left = existing[0]?.parent ? existing[0] : app.workspace.createLeafInParent(app.workspace.rootSplit, 0);
      await left.openFile(file);
      const right = app.workspace.createLeafBySplit(left, 'vertical', false);
      await right.openFile(file);
      for (const leaf of app.workspace.getLeavesOfType('empty')) leaf.detach();
      app.workspace.leftSplit.collapse();
      app.workspace.rightSplit.collapse();
    }, { pluginId, note });
    const settle = () => page.waitForTimeout(240);
    const snapshot = () => page.evaluate(pluginId => {
      const plugin = app.plugins.plugins[pluginId];
      return plugin.findPair().map(leaf => {
        const pane = plugin.scroller(leaf.view);
        return { top: pane.scrollTop, max: pane.scrollHeight - pane.clientHeight };
      });
    }, pluginId);
    const position = async (left, right) => {
      // Reading view lazily measures rendered sections after a large jump.
      // Re-place while unlocked so the fixture really starts 40px from the
      // settled bottom, rather than from an obsolete estimated height.
      for (let attempt = 0; attempt < (right === 'bottom' ? 3 : 2); attempt++) {
        await page.evaluate(({ pluginId, left, right }) => {
          const plugin = app.plugins.plugins[pluginId];
          plugin.unlock();
          const panes = plugin.findPair().map(leaf => plugin.scroller(leaf.view));
          panes[0].scrollTop = left;
          panes[1].scrollTop = right === 'bottom' ? panes[1].scrollHeight - panes[1].clientHeight - 40 : right;
        }, { pluginId, left, right });
        await page.waitForTimeout(500);
      }
      await page.evaluate(pluginId => app.plugins.plugins[pluginId].toggle(), pluginId);
      await settle();
      return snapshot();
    };
    const wheel = async (index, delta, count = 1) => {
      const box = await page.evaluate(({ pluginId, index }) => {
        const plugin = app.plugins.plugins[pluginId];
        const rect = plugin.scroller(plugin.findPair()[index].view).getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }, { pluginId, index });
      await page.mouse.move(box.x, box.y);
      for (let i = 0; i < count; i++) {
        await page.mouse.wheel(0, delta);
        await page.waitForTimeout(35);
      }
      await settle();
      return snapshot();
    };
    const scenarios = [];
    for (const modes of [
      [{ mode: 'source', source: true }, { mode: 'source', source: true }],
      [{ mode: 'source', source: false }, { mode: 'source', source: false }],
      [{ mode: 'preview' }, { mode: 'preview' }],
      [{ mode: 'source', source: false }, { mode: 'preview' }],
    ]) {
      await page.evaluate(async ({ pluginId, note, modes }) => {
        const plugin = app.plugins.plugins[pluginId];
        plugin.unlock();
        const leaves = plugin.findPair();
        for (let i = 0; i < 2; i++) {
          await leaves[i].setViewState({ type: 'markdown', state: { file: note, ...modes[i] } });
        }
      }, { pluginId, note, modes });
      await page.waitForTimeout(800);
      console.log('Testing', JSON.stringify(modes));
      const before = await position(1000, 4000);
      const forward = await wheel(0, 180);
      assert.ok(forward[0].top > before[0].top + 10, 'real wheel must move the document');
      near(forward[0].top - before[0].top, forward[1].top - before[1].top, 'equal forward movement');
      const fromRight = await wheel(1, -120);
      near(fromRight[0].top - forward[0].top, fromRight[1].top - forward[1].top, 'equal reverse movement from right');

      const topStart = await position(40, 1040);
      console.log('Top start', JSON.stringify(topStart));
      const top = await wheel(1, -240);
      near(top[0].top, 0, 'left stops at top');
      near(top[1].top, topStart[1].top - topStart[0].top, 'right stops at common top boundary');
      const topBlocked = await wheel(1, -240, 6);
      near(topBlocked[0].top, top[0].top, 'top left stays blocked');
      near(topBlocked[1].top, top[1].top, 'top right stays blocked');
      const topReverse = await wheel(1, 120);
      assert.ok(topReverse[0].top > top[0].top + 10, 'reverse resumes immediately at top');
      near(topReverse[0].top - top[0].top, topReverse[1].top - top[1].top, 'no top backlog');

      const bottomStart = await position(1200, 'bottom');
      console.log('Bottom start', JSON.stringify(bottomStart));
      const bottom = await wheel(0, 240);
      near(bottom[1].top, bottom[1].max, 'right stops at bottom');
      near(bottom[0].top - bottomStart[0].top, bottom[1].top - bottomStart[1].top, 'left stops at common bottom boundary');
      const bottomBlocked = await wheel(0, 240, 6);
      near(bottomBlocked[0].top, bottom[0].top, 'bottom left stays blocked');
      near(bottomBlocked[1].top, bottom[1].top, 'bottom right stays blocked');
      const bottomReverse = await wheel(0, -120);
      assert.ok(bottomReverse[1].top < bottom[1].top - 10, 'reverse resumes immediately at bottom');
      near(bottomReverse[0].top - bottom[0].top, bottomReverse[1].top - bottom[1].top, 'no bottom backlog');

      const altStart = await position(1000, 4000);
      await page.keyboard.down('Alt');
      const altAdjusted = await wheel(0, 120);
      await page.keyboard.up('Alt');
      near(altAdjusted[1].top, altStart[1].top, 'Alt leaves the other pane fixed');
      assert.ok(altAdjusted[0].top > altStart[0].top + 10, 'Alt independently scrolls source');
      const resumed = await wheel(0, 120);
      near(resumed[0].top - altAdjusted[0].top, resumed[1].top - altAdjusted[1].top, 'Alt release uses new offset');
      scenarios.push({ modes, before, forward, fromRight, topStart, top, topBlocked, topReverse,
        bottomStart, bottom, bottomBlocked, bottomReverse, altStart, altAdjusted, resumed, passed: true });
    }
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, 'strict-obsidian-smoke.png') });
    const title = await page.title();
    const results = { app: title, appVersion: title.match(/Obsidian ([\d.]+)/)?.[1],
      browserUserAgent: await page.evaluate(() => navigator.userAgent), pluginId, pluginVersion: '1.1.0',
      fixtureOnly: true, input: 'real Chromium wheel events', scenarios, errors, passed: true };
    fs.writeFileSync(path.join(output, 'strict-obsidian-smoke.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ app: results.app, scenarios: scenarios.length, passed: true }));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
