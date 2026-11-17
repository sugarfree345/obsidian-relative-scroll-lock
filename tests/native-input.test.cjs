const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const sourceRef = process.env.SCROLL_LOCK_TEST_SOURCE_REF;
const source = sourceRef
  ? execFileSync('git', ['show', `${sourceRef}:src/main.js`], { cwd: root, encoding: 'utf8' })
  : fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');

function fixture({ continuous = true, settleMs = 10, positions = null } = {}) {
  const dom = new JSDOM('<main></main>', { pretendToBeVisual: true });
  const { document } = dom.window;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, Date, Set, Map, Promise, setTimeout, clearTimeout,
    require(name) {
      assert.equal(name, 'obsidian');
      return { Plugin: class {}, Notice: class {}, setIcon() {}, getLanguage: () => 'en' };
    },
  });
  const state = positions || [1200, continuous ? 1900 : 5400];
  const geometry = [{ height: 10000, viewport: 700 }, { height: 10000, viewport: 700 }];
  const writes = [[], []];
  const panes = state.map((top, index) => {
    const pane = document.createElement('div');
    pane.tabIndex = 0;
    pane.style.lineHeight = '20px';
    pane.append(document.createElement('div'));
    document.querySelector('main').append(pane);
    Object.defineProperties(pane, {
      scrollHeight: { get: () => geometry[index].height },
      clientHeight: { get: () => geometry[index].viewport },
      scrollTop: {
        get: () => state[index],
        set: value => { state[index] = Math.max(0, Math.min(geometry[index].height - geometry[index].viewport, value)); writes[index].push(state[index]); },
      },
    });
    return pane;
  });
  const adapters = panes.map(pane => ({
    at(pixel) { return pixel / 20; },
    apply(anchor) { pane.scrollTop = anchor * 20; },
    setViewportHeight() {}, content: pane.firstElementChild,
  }));
  const session = continuous
    ? new module.exports.ContinuousScrollSession(panes, adapters, { settleMs, maxPasses: 30 })
    : new module.exports.RelativeScrollSession(panes);
  const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) <= 1.1,
    `${message}: ${actual} vs ${expected}`);
  function nativeScroll(index, top) {
    panes[index].scrollTop = top;
    writes[index].length = 0;
    panes[index].dispatchEvent(new dom.window.Event('scroll'));
  }
  function seam() { near(panes[1].scrollTop - panes[0].scrollTop, 700, 'the panes still continue by content'); }
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function cleanup() { session.dispose(); await sleep(5); dom.window.close(); }
  return { dom, panes, writes, geometry, session, near, nativeScroll, seam, sleep, cleanup };
}

for (const index of [0, 1]) {
  test(`native movement in pane ${index} during realignment becomes the new reading position`, async () => {
    const f = fixture();
    try {
      assert.equal(await f.session.ready, true);
      const pending = f.session.realign();
      f.nativeScroll(index, index === 0 ? 1320 : 2020);
      await pending;
      await f.sleep(100);
      f.near(f.panes[0].scrollTop, 1320, 'left respects the new native reading position');
      f.near(f.panes[1].scrollTop, 2020, 'right respects the new native reading position');
      f.seam();
    } finally { await f.cleanup(); }
  });
}

for (const index of [0, 1]) {
  test(`a continuous native drag stream from pane ${index} is not restored to a stale anchor`, async () => {
    const f = fixture();
    try {
      assert.equal(await f.session.ready, true);
      const pending = f.session.realign();
      for (let step = 1; step <= 8; step++) {
        f.nativeScroll(index, (index === 0 ? 1200 : 1900) + step * 35);
        await f.sleep(4);
      }
      await pending;
      await f.sleep(140);
      f.near(f.panes[0].scrollTop, 1480, 'left follows the end of the drag stream');
      f.near(f.panes[1].scrollTop, 2180, 'right follows the end of the drag stream');
      f.seam();
    } finally { await f.cleanup(); }
  });
}

for (const continuous of [false, true]) {
  test(`${continuous ? 'continuous' : 'manual'} lock does not rewrite a legal native source position`, async () => {
    const f = fixture({ continuous });
    try {
      if (continuous) assert.equal(await f.session.ready, true);
      const peerStart = f.panes[1].scrollTop;
      f.nativeScroll(0, 1300);
      assert.equal(f.writes[0].length, 0, 'writing source scrollTop again can interrupt its native keyboard animation');
      f.near(f.panes[1].scrollTop, peerStart + 100, 'the peer still synchronizes immediately');
    } finally { await f.cleanup(); }
  });
}

test('programmatic scroll echoes do not become a second native movement', async () => {
  const f = fixture();
  try {
    assert.equal(await f.session.ready, true);
    f.session.move(80);
    const expected = f.panes.map(pane => pane.scrollTop);
    for (let count = 0; count < 3; count++) {
      for (const pane of f.panes) pane.dispatchEvent(new f.dom.window.Event('scroll'));
      await f.sleep(2);
    }
    assert.deepEqual(f.panes.map(pane => pane.scrollTop), expected);
    f.seam();
  } finally { await f.cleanup(); }
});

test('Space and arrow keys in text inputs and editable content retain their native editing meaning', async () => {
  const f = fixture();
  try {
    assert.equal(await f.session.ready, true);
    for (const tag of ['input', 'textarea', 'div']) {
      const editor = f.dom.window.document.createElement(tag);
      if (tag === 'div') editor.setAttribute('contenteditable', 'true');
      f.panes[0].firstElementChild.append(editor);
      for (const key of [' ', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']) {
        const event = new f.dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        editor.dispatchEvent(event);
        assert.equal(event.defaultPrevented, false, `${tag}: ${JSON.stringify(key)} must remain available to the editor`);
      }
    }
  } finally { await f.cleanup(); }
});

test('lazy layout movement after content growth preserves EOF pinning instead of stealing native ownership', async () => {
  const f = fixture({ positions: [8600, 9300] });
  try {
    assert.equal(await f.session.ready, true);
    assert.equal(f.session.atEnd, true);
    f.geometry[1].height = 10500;
    f.nativeScroll(1, 9400); // A late renderer changes scroll geometry without user intent.
    assert.equal(f.session.atEnd, true, 'layout-induced movement must not clear the existing EOF pin');
    await f.sleep(220);
    f.near(f.panes[1].scrollTop, 9800, 'right is repinned to the newly measured bottom');
    f.near(f.panes[0].scrollTop, 9100, 'left backfills to the updated seam');
    f.seam();
  } finally { await f.cleanup(); }
});

test('a real pointer scroll wins over simultaneous geometry changes and may leave the document end', async () => {
  const f = fixture({ positions: [8600, 9300] });
  try {
    assert.equal(await f.session.ready, true);
    f.geometry[1].height = 10500;
    f.panes[1].dispatchEvent(new f.dom.window.MouseEvent('pointerdown', { button: 0, bubbles: true }));
    f.nativeScroll(1, 9000);
    f.dom.window.dispatchEvent(new f.dom.window.MouseEvent('pointerup', { button: 0, bubbles: true }));
    assert.equal(f.session.atEnd, false, 'actual user movement may intentionally leave EOF');
    await f.sleep(260);
    f.near(f.panes[1].scrollTop, 9000, 'new user position wins over layout-induced repinning');
    f.near(f.panes[0].scrollTop, 8300, 'left follows the right-hand driver');
    f.seam();
  } finally { await f.cleanup(); }
});
