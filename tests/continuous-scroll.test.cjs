const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

// Pixel/source-position mappings deliberately differ between panes. A plain
// pixel offset is insufficient even though both panes represent the same note.
function fixture({
  documentEnd = 500,
  heights = [700, 700],
  positions = [1200, 5400],
  maps = [anchor => anchor * 20, anchor => anchor * 20],
  options = {},
  lag = [false, false],
  quantized = false,
} = {}) {
  const dom = new JSDOM('<main></main>', { pretendToBeVisual: true });
  const { document } = dom.window;
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8'), {
    require(name) {
      assert.equal(name, 'obsidian');
      return { Plugin: class {}, Notice: class {}, setIcon() {}, getLanguage: () => 'en' };
    },
    module, Date, Set, Map, Promise, setTimeout, clearTimeout,
  });
  const ContinuousScrollSession = module.exports.ContinuousScrollSession;
  assert.equal(typeof ContinuousScrollSession, 'function', 'export the continuous session for regression tests');
  const records = [[], []];
  const applied = [[], []];
  const observedPixel = value => quantized ? Math.round(value) : value;
  const state = maps.map((toPixel, index) => ({
    toPixel, height: observedPixel(heights[index]), originalHeight: observedPixel(heights[index]), top: positions[index],
    lagPending: false,
  }));
  const panes = state.map((item, index) => {
    const pane = document.createElement('div');
    pane.style.lineHeight = '20px';
    pane.style.height = `${heights[index]}px`;
    pane.style.maxHeight = '100%';
    const content = document.createElement('div');
    pane.append(content);
    document.querySelector('main').append(pane);
    const clamp = value => Math.max(0, Math.min(observedPixel(item.toPixel(documentEnd)) - item.height,
      observedPixel(value)));
    item.top = clamp(item.top);
    Object.defineProperties(pane, {
      scrollHeight: { get: () => observedPixel(item.toPixel(documentEnd)), configurable: true },
      clientHeight: { get: () => item.height, configurable: true },
      scrollTop: {
        get: () => item.top,
        set: value => { item.top = clamp(Number(value)); },
        configurable: true,
      },
    });
    return pane;
  });
  function toAnchor(index, pixel) {
    if (pixel < 0 || pixel > state[index].toPixel(documentEnd) + 0.01) return null;
    let low = 0;
    let high = documentEnd;
    for (let count = 0; count < 50; count++) {
      const middle = (low + high) / 2;
      if (state[index].toPixel(middle) < pixel) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  }
  const adapters = state.map((item, index) => ({
    content: panes[index].firstElementChild,
    at(pixel) { return toAnchor(index, observedPixel(pixel)); },
    apply(anchor) {
      applied[index].push(anchor);
      if (lag[index] && !item.lagPending) {
        item.lagPending = true;
        // First placement can be based on an obsolete reading-view estimate.
        panes[index].scrollTop = item.toPixel(anchor) - 120;
      } else panes[index].scrollTop = item.toPixel(anchor);
    },
    setViewportHeight(height) {
      records[index].push(height);
      item.height = height === null ? item.originalHeight : observedPixel(height);
      panes[index].style.height = height === null ? `${item.originalHeight}px` : `${height}px`;
      panes[index].scrollTop = panes[index].scrollTop;
    },
  }));
  const invalid = [];
  const session = new ContinuousScrollSession(panes, adapters, {
    settleMs: 0, maxPasses: 40, onInvalid: message => invalid.push(message), ...options,
  });
  const near = (actual, expected, message, tolerance = 1.1) =>
    assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected}`);
  function seam(message = 'left visible bottom continues at right top') {
    near(toAnchor(0, panes[0].scrollTop + panes[0].clientHeight),
      toAnchor(1, panes[1].scrollTop), message, 0.08);
  }
  async function cleanup() {
    session.dispose();
    await new Promise(resolve => setTimeout(resolve, 5));
    dom.window.close();
  }
  return { dom, panes, adapters, state, records, applied, session, invalid, near, seam, cleanup,
    PluginClass: module.exports };
}

test('one click keeps the left reading position and joins the right pane before locking', async () => {
  const f = fixture();
  try {
    assert.equal(await f.session.ready, true);
    assert.equal(f.session.continuous, true);
    f.near(f.panes[0].scrollTop, 1200, 'left reading position stays fixed');
    f.near(f.panes[1].scrollTop, 1900, 'right starts after the left visible content');
    f.seam();
  } finally { await f.cleanup(); }
});

test('near the end, right stops at the actual bottom and left is backed up to meet it', async () => {
  const f = fixture({ positions: [9000, 200] });
  try {
    assert.equal(await f.session.ready, true);
    f.near(f.panes[1].scrollTop, 9300, 'right reaches the end');
    f.near(f.panes[0].scrollTop, 8600, 'left moves up instead of leaving duplicate text');
    f.seam();
  } finally { await f.cleanup(); }
});

test('different source-to-pixel mappings join by content rather than copied pixel offsets', async () => {
  const f = fixture({ positions: [1200, 400], maps: [anchor => anchor * 20, anchor => anchor * 30] });
  try {
    assert.equal(await f.session.ready, true);
    f.near(f.panes[0].scrollTop, 1200, 'left does not jump');
    f.near(f.panes[1].scrollTop, 2850, 'right maps the same source position in its own layout');
    f.seam();
  } finally { await f.cleanup(); }
});

test('end-of-file backtracking also uses content anchors with unequal rendering heights', async () => {
  const f = fixture({ positions: [9000, 200], maps: [anchor => anchor * 20, anchor => anchor * 30] });
  try {
    assert.equal(await f.session.ready, true);
    f.near(f.panes[1].scrollTop, 14300, 'right reaches its own actual end');
    f.near(f.panes[0].scrollTop, 8833.333333, 'left meets the right content position');
    f.seam();
  } finally { await f.cleanup(); }
});

test('a note shorter than two screens shrinks the left visible area to avoid repeated content', async () => {
  const f = fixture({ documentEnd: 50, positions: [200, 0] });
  try {
    assert.equal(await f.session.ready, true);
    f.near(f.panes[1].scrollTop, 300, 'right shows the bottom of a short note');
    f.near(f.panes[0].scrollTop, 0, 'left begins with the note');
    f.near(f.panes[0].clientHeight, 300, 'left only displays content preceding the right');
    f.seam();
    f.session.dispose();
    f.near(f.panes[0].clientHeight, 700, 'unlock restores the original viewport');
    assert.equal(f.records[0].at(-1), null, 'temporary viewport override is removed');
  } finally { await f.cleanup(); }
});

test('a note fitting in the right pane has an empty left content area, not duplicated text', async () => {
  const f = fixture({ documentEnd: 20, positions: [0, 0] });
  try {
    assert.equal(await f.session.ready, true);
    f.near(f.panes[1].scrollTop, 0, 'right shows the whole note');
    f.near(f.panes[0].clientHeight, 0, 'left does not repeat the same note');
    f.seam();
    f.session.dispose();
    f.near(f.panes[0].clientHeight, 700, 'left viewport restores on unlock');
  } finally { await f.cleanup(); }
});

test('asymmetric viewport heights use the left visible height and the right end boundary', async () => {
  const f = fixture({ heights: [500, 800], positions: [9000, 200] });
  try {
    assert.equal(await f.session.ready, true);
    f.near(f.panes[1].scrollTop, 9200, 'right bottom reflects its own viewport');
    f.near(f.panes[0].scrollTop, 8700, 'left bottom meets right top');
    f.seam();
  } finally { await f.cleanup(); }
});

test('re-aligning after height reflow repairs the content seam without stale pixel assumptions', async () => {
  const f = fixture();
  try {
    assert.equal(await f.session.ready, true);
    f.state[1].toPixel = anchor => anchor < 50 ? anchor * 20 : 1000 + (anchor - 50) * 30;
    assert.equal(await f.session.realign(), true);
    f.near(f.panes[0].scrollTop, 1200, 'reflow keeps left reading position');
    f.near(f.panes[1].scrollTop, 2350, 'right follows changed content geometry');
    f.seam();
  } finally { await f.cleanup(); }
});

test('settling retries an initial stale reading-view estimate before declaring alignment ready', async () => {
  const f = fixture({ lag: [false, true] });
  try {
    assert.equal(await f.session.ready, true);
    assert.ok(f.applied[1].length >= 2, 'alignment is checked again after initial placement');
    f.near(f.panes[0].scrollTop, 1200, 'initial estimate correction preserves left');
    f.seam();
  } finally { await f.cleanup(); }
});

test('scrolling and reversing at the end preserve the content seam without queued overscroll', async () => {
  const f = fixture({ positions: [8500, 300] });
  try {
    assert.equal(await f.session.ready, true);
    f.session.move(500);
    await f.session.realign();
    f.near(f.panes[1].scrollTop, 9300, 'right stops at document end');
    f.seam();
    for (let count = 0; count < 5; count++) f.session.move(400);
    await f.session.realign();
    f.near(f.panes[1].scrollTop, 9300, 'blocked movement stays at end');
    f.session.move(-40);
    await f.session.realign();
    f.near(f.panes[1].scrollTop, 9260, 'first reversed movement is applied immediately');
    f.seam();
  } finally { await f.cleanup(); }
});

test('ordinary movement automatically rechecks the content seam without a second user command', async () => {
  const f = fixture({ positions: [1200, 400], maps: [anchor => anchor * 20, anchor => anchor * 30] });
  try {
    assert.equal(await f.session.ready, true);
    f.session.move(120);
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.ok(f.panes[0].scrollTop > 1200, 'continuous reading advances');
    f.seam('one move continues by source content automatically');
    const before = f.panes[0].scrollTop;
    f.panes[1].scrollTop -= 90;
    f.panes[1].dispatchEvent(new f.dom.window.Event('scroll'));
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.ok(f.panes[0].scrollTop < before, 'scrolling the right pane backward moves the pair');
    f.seam('right-pane input keeps the seam automatically');
  } finally { await f.cleanup(); }
});

test('content growth restores a previously shortened left viewport', async () => {
  const f = fixture({ documentEnd: 50, positions: [200, 0] });
  try {
    assert.equal(await f.session.ready, true);
    f.near(f.panes[0].clientHeight, 300, 'short-note viewport begins shortened');
    // More content or changed typography can make both full panes possible.
    // The anchor range is unchanged, but every source line is now taller.
    f.state[0].toPixel = anchor => anchor * 40;
    f.state[1].toPixel = anchor => anchor * 40;
    assert.equal(await f.session.realign(), true);
    f.near(f.panes[0].clientHeight, 700, 'left regains its full original viewport');
    f.seam();
  } finally { await f.cleanup(); }
});

test('disposing during the settling delay prevents any late pane writes', async () => {
  const f = fixture({ options: { settleMs: 20 } });
  try {
    f.session.dispose();
    const positions = f.panes.map(pane => pane.scrollTop);
    const applications = f.applied.map(calls => calls.length);
    await f.session.ready;
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.deepEqual(f.panes.map(pane => pane.scrollTop), positions, 'no delayed scroll after disposal');
    assert.deepEqual(f.applied.map(calls => calls.length), applications, 'disposed task cannot invoke adapters');
    assert.equal(f.records[0].at(-1), null, 'dispose clears any pending viewport override');
  } finally { await f.cleanup(); }
});

test('invalidated views cannot complete a stale asynchronous alignment', async () => {
  let valid = true;
  const f = fixture({ options: { settleMs: 20, validate: () => valid } });
  try {
    valid = false;
    const applications = f.applied.map(calls => calls.length);
    assert.equal(await f.session.ready, false);
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.deepEqual(f.applied.map(calls => calls.length), applications, 'changed file/layout is not repositioned');
  } finally { await f.cleanup(); }
});

test('a missing source anchor fails explicitly rather than claiming a continuous lock', async () => {
  const f = fixture({ options: { settleMs: 10 } });
  try {
    f.adapters[0].at = () => null;
    assert.equal(await f.session.ready, false);
    assert.ok(f.invalid.length > 0 || f.session.disposed,
      'invalid or unsupported content mapping must be reported or release the session');
  } finally { await f.cleanup(); }
});

test('a disposed continuous session restores ordinary independent wheel scrolling', async () => {
  const f = fixture();
  try {
    assert.equal(await f.session.ready, true);
    f.session.dispose();
    const event = new f.dom.window.WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    f.panes[0].dispatchEvent(event);
    assert.equal(event.defaultPrevented, false, 'continuous wheel handler has been removed');
    assert.equal(f.panes[0].style.getPropertyValue('overflow-anchor'), '', 'temporary scroll style restores');
    assert.equal(f.panes[1].style.getPropertyValue('scroll-behavior'), '', 'both panes restore native styles');
  } finally { await f.cleanup(); }
});

test('wheel input during a later seam check is applied rather than silently discarded', async () => {
  const f = fixture({ options: { settleMs: 10 } });
  try {
    assert.equal(await f.session.ready, true);
    const pending = f.session.realign();
    const event = new f.dom.window.WheelEvent('wheel', { deltaY: 50, bubbles: true, cancelable: true });
    f.panes[0].dispatchEvent(event);
    await pending;
    await new Promise(resolve => setTimeout(resolve, 100));
    f.near(f.panes[0].scrollTop, 1250, 'accepted vertical input advances even while checking the seam');
    f.seam();
  } finally { await f.cleanup(); }
});

test('a nested scroller keeps native wheel behavior while a seam check is pending', async () => {
  const f = fixture({ options: { settleMs: 10 } });
  try {
    assert.equal(await f.session.ready, true);
    const inner = f.dom.window.document.createElement('div');
    inner.style.overflowY = 'auto';
    Object.defineProperties(inner, { scrollHeight: { value: 1000 }, clientHeight: { value: 100 } });
    inner.scrollTop = 100;
    f.panes[0].append(inner);
    const pending = f.session.realign();
    const event = new f.dom.window.WheelEvent('wheel', { deltaY: 50, bubbles: true, cancelable: true });
    inner.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false, 'nested native scrolling must not be blocked by background realignment');
    await pending;
  } finally { await f.cleanup(); }
});

test('an intentionally blank left viewport remains a valid two-pane workspace', async () => {
  const f = fixture({ documentEnd: 20, positions: [0, 0] });
  try {
    assert.equal(await f.session.ready, true);
    const rootSplit = {};
    const leaves = f.panes.map((pane, index) => {
      const containerEl = f.dom.window.document.createElement('section');
      pane.before(containerEl);
      containerEl.append(pane);
      pane.className = 'cm-scroller';
      pane.firstElementChild.className = 'cm-sizer';
      pane.firstElementChild.getBoundingClientRect = () => ({ width: 500 });
      containerEl.getClientRects = () => [containerEl.getBoundingClientRect()];
      containerEl.getBoundingClientRect = () => ({ left: index * 610, right: index * 610 + 600,
        top: 0, bottom: 700, width: 600, height: 700 });
      return { getRoot: () => rootSplit, view: { containerEl, contentEl: containerEl,
        file: { path: 'same-note.md' }, getMode: () => 'source', getState: () => ({ source: false }),
        currentMode: { getScroll() {}, applyScroll() {} } } };
    });
    const plugin = new f.PluginClass();
    plugin.app = { workspace: { rootSplit, getLeavesOfType: () => leaves } };
    f.panes[0].style.visibility = 'hidden';
    const pair = plugin.findPair();
    assert.equal(pair?.length, 2, 'hide only left content, not the workspace leaf');
    assert.equal(plugin.continuousCompatible(pair), true, 'empty left viewport must not invalidate its own session');
  } finally { await f.cleanup(); }
});

test('end-of-file anchor sampling restores a full left viewport before yielding to rendering', async () => {
  const f = fixture({ positions: [9000, 200], options: { settleMs: 5 } });
  try {
    const visibleHeights = [];
    const originalSetViewportHeight = f.adapters[0].setViewportHeight;
    f.adapters[0].setViewportHeight = height => {
      originalSetViewportHeight(height);
      queueMicrotask(() => visibleHeights.push(f.panes[0].clientHeight));
    };
    assert.equal(await f.session.ready, true);
    visibleHeights.push(f.panes[0].clientHeight);
    assert.ok(visibleHeights.every(height => height === 700),
      `temporary sampling viewport leaked across a task boundary: ${visibleHeights.join(', ')}`);
    f.seam();
  } finally { await f.cleanup(); }
});

test('Alt pauses an in-flight seam check and releasing it reconnects the independently adjusted pane', async () => {
  const f = fixture({ options: { settleMs: 10 } });
  try {
    assert.equal(await f.session.ready, true);
    const rightBefore = f.panes[1].scrollTop;
    const pending = f.session.realign();
    f.dom.window.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Alt', altKey: true }));
    f.panes[0].scrollTop += 200;
    f.panes[0].dispatchEvent(new f.dom.window.Event('scroll'));
    assert.equal(await pending, true, 'temporary independent scrolling is not an alignment failure');
    await new Promise(resolve => setTimeout(resolve, 40));
    f.near(f.panes[0].scrollTop, 1400, 'Alt adjustment remains in the source pane');
    f.near(f.panes[1].scrollTop, rightBefore, 'peer stays still for the entire Alt hold');
    f.dom.window.dispatchEvent(new f.dom.window.KeyboardEvent('keyup', { key: 'Alt', altKey: false }));
    await new Promise(resolve => setTimeout(resolve, 160));
    f.near(f.panes[0].scrollTop, 1400, 'reconnecting keeps the adjusted left reading position');
    f.near(f.panes[1].scrollTop, 2100, 'peer reconnects when Alt is released');
    f.seam();
  } finally { await f.cleanup(); }
});

test('queued wheel input at EOF discards blocked motion and applies the first reverse event', async () => {
  const f = fixture({ positions: [9000, 200], options: { settleMs: 10 } });
  try {
    assert.equal(await f.session.ready, true);
    f.near(f.panes[1].scrollTop, 9300, 'fixture starts at the actual end');
    const pending = f.session.realign();
    for (let count = 0; count < 6; count++) {
      f.panes[0].dispatchEvent(new f.dom.window.WheelEvent('wheel',
        { deltaY: 400, bubbles: true, cancelable: true }));
    }
    f.panes[1].dispatchEvent(new f.dom.window.WheelEvent('wheel',
      { deltaY: -40, bubbles: true, cancelable: true }));
    await pending;
    await new Promise(resolve => setTimeout(resolve, 60));
    f.near(f.panes[1].scrollTop, 9260, 'first reverse event moves right immediately after the check');
    f.near(f.panes[0].scrollTop, 8560, 'left reverses by the same distance');
    f.seam();
  } finally { await f.cleanup(); }
});

test('integer-rounded scroll positions preserve the observed EOF seam instead of an unobserved midpoint', async () => {
  // Browser layout: 1021px total content and a 722px viewport leave the right
  // pane at 299px. A binary-search midpoint near 298.38 rounds to 298px and
  // represents the wrong source anchor; the observed 299px sample is needed.
  const f = fixture({ documentEnd: 51.05, heights: [722, 722], positions: [200, 0], quantized: true });
  try {
    assert.equal(await f.session.ready, true);
    assert.equal(f.panes[1].scrollHeight, 1021);
    assert.equal(f.panes[1].scrollTop, 299, 'right reaches its integer-rounded maximum');
    assert.equal(f.panes[0].scrollTop, 0, 'short note begins in the left pane');
    assert.equal(f.panes[0].clientHeight, 299, 'left ends at the source position actually observed at 299px');
    f.seam();
  } finally { await f.cleanup(); }
});
