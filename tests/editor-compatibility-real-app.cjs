// Optional regression in a dedicated synthetic Obsidian vault only.
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
    page.on('pageerror', error => errors.push(error.message));
    for (const name of ['main.js', 'manifest.json', 'styles.css']) {
      fs.copyFileSync(path.join(root, name), path.join(vault, '.obsidian/plugins', id, name));
    }
    await page.evaluate(async id => {
      for (const { el, styles } of window.editorTestStyles || []) for (const [name, value, priority] of styles) {
        if (value) el.style.setProperty(name, value, priority); else el.style.removeProperty(name);
      }
      delete window.editorTestStyles;
      await app.plugins.unloadPlugin(id);
      await app.plugins.loadManifests();
      await app.plugins.enablePlugin(id);
    }, id);
    const results = [];
    const snapshot = () => page.evaluate(id => {
      const p = app.plugins.plugins[id];
      return { locked: !!p.session, aligning: p.session?.aligning, panes: p.findPair().map((leaf, i) => {
        const scroller = p.scroller(leaf.view);
        const adapter = p.adapter(leaf.view);
        return { top: scroller.scrollTop, max: scroller.scrollHeight - scroller.clientHeight,
          topAnchor: adapter.at(scroller.scrollTop),
          bottomAnchor: adapter.at(scroller.scrollTop + (p.session?.height(i) ?? scroller.clientHeight)) };
      }) };
    }, id);
    const verify = (state, label) => {
      assert.ok(state.locked, label + ': stays locked');
      assert.ok(Math.abs(state.panes[0].bottomAnchor - state.panes[1].topAnchor) < 0.06,
        label + ': seam mismatch ' + JSON.stringify(state));
    };
    for (const test of [{ source: false, difference: 'outer width' }, { source: true, difference: 'outer font' }]) {
      await page.evaluate(async ({ id, test }) => {
        const p = app.plugins.plugins[id]; p.unlock();
        for (const leaf of p.findPair()) {
          await leaf.setViewState({ type: 'markdown', state: { file: 'Strict test.md', mode: 'source', source: test.source } });
        }
      }, { id, test });
      await page.waitForTimeout(700);
      const diagnostic = await page.evaluate(({ id, test }) => {
        const p = app.plugins.plugins[id];
        const pair = p.findPair();
        const roots = pair.map(leaf => p.contentRoot(leaf.view));
        const texts = pair.map(leaf => p.scroller(leaf.view).querySelector('.cm-content'));
        const properties = ['width', 'min-width', 'max-width', 'font-family'];
        window.editorTestStyles = [...roots, ...texts].map(el => ({ el, styles: properties.map(name =>
          [name, el.style.getPropertyValue(name), el.style.getPropertyPriority(name)]) }));
        if (test.difference === 'outer width') {
          const width = texts[1].getBoundingClientRect().width;
          for (const text of texts) text.style.setProperty('width', `${width}px`, 'important');
          roots[0].style.setProperty('max-width', 'none', 'important');
          roots[0].style.setProperty('width', `${roots[1].getBoundingClientRect().width + 12}px`, 'important');
          roots[0].style.setProperty('min-width', `${roots[1].getBoundingClientRect().width + 12}px`, 'important');
        } else {
          const font = getComputedStyle(texts[1]).fontFamily;
          for (const text of texts) text.style.setProperty('font-family', font, 'important');
          roots[0].style.setProperty('font-family', 'serif', 'important');
        }
        const styles = roots.map(el => getComputedStyle(el));
        const widths = roots.map(el => el.getBoundingClientRect().width);
        const oldWouldReject = Math.abs(widths[0] - widths[1]) > 2 ||
          ['fontSize', 'fontFamily', 'lineHeight'].some(key => styles[0][key] !== styles[1][key]);
        p.findPair().forEach((leaf, i) => { p.scroller(leaf.view).scrollTop = i ? 4000 : 1200; });
        return { oldWouldReject, widths, issue: p.continuousIssue(pair) };
      }, { id, test });
      assert.equal(diagnostic.oldWouldReject, true, 'fixture exercises the old false-rejection precheck');
      assert.equal(diagnostic.issue, null, 'editing proceeds to real anchor validation');
      await page.waitForTimeout(400);
      assert.equal(await page.evaluate(id => app.plugins.plugins[id].continuousLock(), id), true);
      const initial = await snapshot(); verify(initial, 'initial editing seam');
      const point = await page.evaluate(id => {
        const p = app.plugins.plugins[id]; const r = p.scroller(p.findPair()[0].view).getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, id);
      await page.mouse.move(point.x, point.y);
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(500);
      const moved = await snapshot(); verify(moved, 'editing wheel seam');
      assert.ok(moved.panes[0].top > initial.panes[0].top, 'real wheel movement');
      await page.evaluate(id => {
        const p = app.plugins.plugins[id]; p.unlock();
        p.findPair().forEach((leaf, i) => {
          const el = p.scroller(leaf.view); el.scrollTop = i ? 200 : el.scrollHeight - el.clientHeight - 40;
        });
      }, id);
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(id => app.plugins.plugins[id].continuousLock(), id), true);
      const tail = await snapshot(); verify(tail, 'editing EOF seam');
      assert.ok(Math.abs(tail.panes[1].top - tail.panes[1].max) <= 2, 'right reaches EOF');
      results.push({ ...test, diagnostic, initial, moved, tail, passed: true });
      await page.evaluate(id => {
        app.plugins.plugins[id].unlock();
        for (const { el, styles } of window.editorTestStyles) for (const [name, value, priority] of styles) {
          if (value) el.style.setProperty(name, value, priority); else el.style.removeProperty(name);
        }
        delete window.editorTestStyles;
      }, id);
    }
    assert.deepEqual(errors, []);
    const report = { app: await page.title(), pluginVersion: manifest.version, fixtureOnly: true, results, errors, passed: true };
    fs.writeFileSync(path.join(root, 'test-results/editor-compatibility-smoke.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
