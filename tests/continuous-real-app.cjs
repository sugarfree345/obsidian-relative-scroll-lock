// Optional actual-app acceptance test. ONLY the synthetic vault in
// test-results/obsidian-strict/vault is allowed. Launch its dedicated profile
// with --remote-debugging-port=19236; this never uses a personal vault.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const vault = path.join(root, 'test-results/obsidian-strict/vault');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const id = manifest.id;
(async () => {
  const browser = await chromium.connectOverCDP(process.env.OBSIDIAN_TEST_CDP || 'http://127.0.0.1:19236');
  try {
    const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('app://obsidian.md/'));
    assert.equal(path.normalize(await page.evaluate(() => app.vault.adapter.basePath)), path.normalize(vault));
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    for (const name of ['main.js', 'manifest.json', 'styles.css']) fs.copyFileSync(path.join(root, name), path.join(vault, '.obsidian/plugins', id, name));
    await page.evaluate(async id => {
      await app.plugins.unloadPlugin(id);
      await app.plugins.loadManifests();
      await app.plugins.enablePlugin(id);
      if (!app.plugins.plugins[id]) throw Error('Plugin failed to load');
      app.workspace.leftSplit.collapse();
      app.workspace.rightSplit.collapse();
    }, id);
    const setMode = async (mode, file = 'Strict test.md') => {
      await page.evaluate(async ({ id, mode, file }) => {
        const p = app.plugins.plugins[id];
        p.unlock();
        const leaves = p.findPair();
        for (const leaf of leaves) await leaf.setViewState({ type: 'markdown', state: { file, ...mode } });
      }, { id, mode, file });
      await page.waitForTimeout(900);
    };
    const snapshot = () => page.evaluate(id => {
      const p = app.plugins.plugins[id];
      const pair = p.findPair();
      return { locked: !!p.session, aligning: p.session?.aligning, short: p.session?.short,
        panes: pair?.map(leaf => {
          const pane = p.scroller(leaf.view);
          const a = p.adapter(leaf.view);
          const height = p.session?.continuous ? p.session.height(pair.indexOf(leaf)) : pane.clientHeight;
          return { top: pane.scrollTop, max: pane.scrollHeight - pane.clientHeight, height,
            topAnchor: a.at(pane.scrollTop), bottomAnchor: a.at(pane.scrollTop + height),
            width: p.contentRoot(leaf.view).getBoundingClientRect().width };
        }) };
    }, id);
    const seam = (s, label) => {
      assert.equal(s.locked, true, label + ': must remain locked');
      assert.ok(Math.abs(s.panes[0].bottomAnchor - s.panes[1].topAnchor) < 0.05,
        label + ': content seam ' + JSON.stringify(s));
    };
    const position = async tail => {
      await page.evaluate(({ id, tail }) => {
        const p = app.plugins.plugins[id]; p.unlock();
        p.findPair().forEach((leaf, i) => {
          const pane = p.scroller(leaf.view);
          pane.scrollTop = i ? 4000 : tail ? pane.scrollHeight - pane.clientHeight - 60 : 1200;
        });
      }, { id, tail });
      await page.waitForTimeout(600);
    };
    const join = async () => {
      const ok = await page.evaluate(id => app.plugins.plugins[id].continuousLock(), id);
      const s = await snapshot();
      console.log('Join', ok, 'short:', s.short, 'left:', s.panes?.[0].top, 'right:', s.panes?.[1].top);
      assert.equal(ok, true, 'one click aligns and locks');
      seam(s, 'initial seam');
      return s;
    };
    const wheel = async (index, delta) => {
      const box = await page.evaluate(({ id, index }) => {
        const p = app.plugins.plugins[id]; const r = p.scroller(p.findPair()[index].view).getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, { id, index });
      await page.mouse.move(box.x, box.y);
      await page.mouse.wheel(0, delta);
      await page.waitForTimeout(550);
      const s = await snapshot(); seam(s, 'wheel seam'); return s;
    };
    const results = [];
    if (!process.env.CONTINUOUS_SHORT_ONLY) for (const mode of [{ mode: 'source', source: true }, { mode: 'source', source: false }, { mode: 'preview' }]) {
      await setMode(mode);
      console.log('mode', mode);
      await position(false);
      const initial = await join();
      const forward = await wheel(0, 180);
      const reverse = await wheel(1, -120);
      assert.ok(forward.panes[0].top > initial.panes[0].top + 20, 'wheel moves');
      assert.ok(reverse.panes[0].top < forward.panes[0].top - 20, 'right reverse moves');
      await position(true);
      const tail = await join();
      assert.ok(Math.abs(tail.panes[1].top - tail.panes[1].max) <= 2, 'right at end');
      const blocked = await wheel(0, 800);
      const back = await wheel(1, -100);
      assert.ok(back.panes[0].top < blocked.panes[0].top - 10, 'immediate reverse from end');
      results.push({ mode, initial, forward, reverse, tail, blocked, back });
    }
    for (const [name, text] of [
      ['Continuous short.md', Array.from({ length: 12 }, (_, i) => `Short paragraph ${i + 1}.`).join('\n\n')],
      ['Continuous tiny.md', 'This complete note fits in one pane.'],
    ]) {
      await page.evaluate(async ({ name, text }) => {
        const file = app.vault.getAbstractFileByPath(name);
        if (file) await app.vault.modify(file, text); else await app.vault.create(name, text);
      }, { name, text });
      for (const mode of [{ mode: 'source', source: true }, { mode: 'source', source: false }, { mode: 'preview' }]) {
        await setMode(mode, name);
        await position(false);
        const short = await join();
        assert.ok(short.short, 'short note uses a reduced left viewport');
        assert.ok(Math.abs(short.panes[1].top - short.panes[1].max) < 2, 'short right reaches end');
        await page.evaluate(id => app.plugins.plugins[id].unlock(), id);
        const restored = await snapshot();
        assert.ok(restored.panes[0].height > short.panes[0].height + 10, 'unlock restores full left viewport');
        results.push({ name, mode, short, restored });
      }
    }
    await setMode({ mode: 'preview' });
    await position(false);
    await join();
    await page.setViewportSize({ width: 1200, height: 680 });
    await page.waitForTimeout(1600);
    const resized = await snapshot();
    seam(resized, 'automatic resize correction');
    results.push({ name: 'automatic resize correction', resized });
    const reflowName = 'Continuous reflow.md';
    const reflowText = Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1}. Synthetic content for automatic layout correction.`).join('\n\n');
    await page.evaluate(async ({ name, text }) => {
      const file = app.vault.getAbstractFileByPath(name);
      if (file) await app.vault.modify(file, text); else await app.vault.create(name, text);
    }, { name: reflowName, text: reflowText });
    await setMode({ mode: 'preview' }, reflowName);
    await position(false);
    await join();
    await page.evaluate(async ({ name, text }) => {
      await app.vault.modify(app.vault.getAbstractFileByPath(name), 'A newly inserted introduction.\n\n' + text);
    }, { name: reflowName, text: reflowText });
    await page.waitForTimeout(1500);
    const edited = await snapshot();
    seam(edited, 'automatic correction after editing');
    results.push({ name: 'automatic correction after editing', edited });
    await page.screenshot({ path: path.join(root, 'test-results/continuous-smoke.png') });
    fs.writeFileSync(path.join(root, 'test-results/continuous-smoke.json'), JSON.stringify({
      app: await page.title(), userAgent: await page.evaluate(() => navigator.userAgent), pluginVersion: manifest.version,
      fixtureOnly: true, results, errors, passed: true,
    }, null, 2));
    assert.deepEqual(errors, []);
    console.log('PASS', results.length, 'actual Obsidian mode scenarios');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
