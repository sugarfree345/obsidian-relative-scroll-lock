const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

function fixture(modes = ['source', 'source'], language = 'zh') {
  const dom = new JSDOM('<main></main><footer></footer>', { pretendToBeVisual: true });
  const { document } = dom.window;
  const notices = [];
  const listeners = new Map();
  class Plugin {
    constructor(app) { this.app = app; this.cleanups = []; this.commands = []; }
    addRibbonIcon(icon, label, callback) { const el = document.createElement('button'); document.body.append(el); el.addEventListener('click', callback); return el; }
    addStatusBarItem() { const el = document.createElement('span'); document.querySelector('footer').append(el); return el; }
    registerDomEvent(el, name, callback) { el.addEventListener(name, callback); this.cleanups.push(() => el.removeEventListener(name, callback)); }
    registerEvent() {}
    addCommand(command) { this.commands.push(command); }
  }
  const mock = { Plugin, getLanguage: () => language, Notice: class { constructor(message) { notices.push(message); } }, setIcon(el, name) { el.dataset.icon = name; } };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8'), {
    require(name) { assert.equal(name, 'obsidian'); return mock; }, module, Date, Set, Map,
  });
  const rootSplit = {};
  const leaves = modes.map((mode, index) => {
    const containerEl = document.createElement('section');
    document.querySelector('main').append(containerEl);
    containerEl.getClientRects = () => [containerEl.getBoundingClientRect()];
    containerEl.getBoundingClientRect = () => ({ left: index * 610, right: index * 610 + 600, top: 0, bottom: 700, width: 600, height: 700 });
    const pane = document.createElement('div');
    pane.className = mode === 'preview' ? 'markdown-preview-view' : 'cm-scroller';
    pane.style.lineHeight = '20px';
    containerEl.append(pane);
    Object.defineProperties(pane, { scrollHeight: { value: 10000, configurable: true }, clientHeight: { value: 700, configurable: true } });
    pane.scrollTop = index === 0 ? 1200 : 5400;
    const view = { containerEl, contentEl: containerEl, file: { path: '同一篇笔记.md' }, getMode: () => mode,
      addAction(icon, label, callback) { const button = document.createElement('button'); containerEl.append(button); button.addEventListener('click', callback); return button; } };
    return { view, getRoot: () => rootSplit, group: 'native-group', setGroup(group) { this.group = group; } };
  });
  const workspace = { rootSplit, getLeavesOfType: () => leaves, requestSaveLayout() {}, on(name, fn) { listeners.set(name, fn); }, onLayoutReady(fn) { fn(); } };
  const plugin = new module.exports({ workspace });
  plugin.onload();
  const panes = leaves.map(leaf => leaf.view.contentEl.firstChild);
  function scroll(index, top) { panes[index].scrollTop = top; panes[index].dispatchEvent(new dom.window.Event('scroll')); }
  function wheel(index, alt) { panes[index].dispatchEvent(new dom.window.WheelEvent('wheel', { altKey: alt })); }
  function sendWheel(index, options = {}, target = panes[index]) {
    const event = new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100, ...options });
    target.dispatchEvent(event);
    return event;
  }
  return { dom, leaves, panes, plugin, notices, listeners, scroll, wheel, sendWheel };
}

for (const modes of [['source', 'source'], ['preview', 'preview'], ['source', 'preview']]) {
  test(`same file, ${modes.join('/')}: locking preserves positions and scrolling is bidirectional`, () => {
    const f = fixture(modes);
    assert.equal(f.leaves[0].group, 'native-group');
    assert.equal(f.leaves[1].group, 'native-group');
    assert.equal(f.plugin.session, null);
    f.plugin.toggle();
    assert.equal(f.leaves[0].group, null);
    assert.equal(f.leaves[1].group, null);
    assert.deepEqual(f.panes.map(p => p.scrollTop), [1200, 5400]);
    f.scroll(0, 1370);
    assert.equal(f.panes[1].scrollTop, 5570);
    f.panes[1].dispatchEvent(new f.dom.window.Event('scroll'));
    assert.equal(f.panes[0].scrollTop, 1370, 'programmatic echo must not bounce');
    f.scroll(1, 5440);
    assert.equal(f.panes[0].scrollTop, 1240);
    f.plugin.onunload();
  });
}

test('unlock, independently reposition, then relock without snapping', () => {
  const f = fixture();
  f.plugin.toggle();
  f.scroll(0, 1500);
  f.plugin.toggle();
  f.scroll(1, 8000);
  assert.equal(f.panes[0].scrollTop, 1500);
  f.plugin.toggle();
  assert.deepEqual(f.panes.map(p => p.scrollTop), [1500, 8000]);
  f.scroll(1, 8100);
  assert.equal(f.panes[0].scrollTop, 1600);
  f.plugin.onunload();
});

test('Alt gesture is independent; next ordinary gesture uses new positions', () => {
  const f = fixture();
  f.plugin.toggle();
  f.wheel(0, true);
  f.scroll(0, 2300);
  assert.equal(f.panes[1].scrollTop, 5400);
  assert.match(f.plugin.status.textContent, /临时松开/);
  f.dom.window.dispatchEvent(new f.dom.window.KeyboardEvent('keyup', { key: 'Alt', altKey: false }));
  f.wheel(0, false);
  f.scroll(0, 2400);
  assert.equal(f.panes[1].scrollTop, 5500);
  f.plugin.onunload();
});

test('scrollbar/keyboard fallback clamps both panes and reverses with no dead travel', () => {
  const f = fixture();
  f.plugin.toggle();
  f.scroll(0, 6000);
  assert.deepEqual(f.panes.map(p => p.scrollTop), [5100, 9300]);
  f.panes[1].dispatchEvent(new f.dom.window.Event('scroll'));
  assert.equal(f.panes[0].scrollTop, 5100, 'programmatic echo must not bounce');
  f.scroll(0, 5200);
  assert.deepEqual(f.panes.map(p => p.scrollTop), [5100, 9300]);
  f.scroll(0, 5000);
  assert.deepEqual(f.panes.map(p => p.scrollTop), [5000, 9200]);
  f.scroll(1, 0);
  assert.deepEqual(f.panes.map(p => p.scrollTop), [0, 4200]);
  f.scroll(1, 4100);
  assert.deepEqual(f.panes.map(p => p.scrollTop), [0, 4200]);
  f.scroll(1, 4300);
  assert.deepEqual(f.panes.map(p => p.scrollTop), [100, 4300]);
  f.plugin.onunload();
});

for (const index of [0, 1]) {
  test(`wheel from pane ${index}: both stop at bottom and reverse immediately`, () => {
    const f = fixture();
    f.panes[0].scrollTop = 4880;
    f.panes[1].scrollTop = 9280;
    f.plugin.toggle();
    const event = f.sendWheel(index, { deltaY: 100 });
    assert.equal(event.defaultPrevented, true, 'native wheel movement must be intercepted');
    assert.deepEqual(f.panes.map(p => p.scrollTop), [4900, 9300]);
    for (let count = 0; count < 5; count++) f.sendWheel(index, { deltaY: 400 });
    assert.deepEqual(f.panes.map(p => p.scrollTop), [4900, 9300]);
    f.sendWheel(index, { deltaY: -35 });
    assert.deepEqual(f.panes.map(p => p.scrollTop), [4865, 9265]);
    f.plugin.onunload();
  });

  test(`wheel from pane ${index}: both stop at top and reverse immediately`, () => {
    const f = fixture();
    f.panes[0].scrollTop = 20;
    f.panes[1].scrollTop = 4420;
    f.plugin.toggle();
    f.sendWheel(index, { deltaY: -100 });
    assert.deepEqual(f.panes.map(p => p.scrollTop), [0, 4400]);
    for (let count = 0; count < 5; count++) f.sendWheel(index, { deltaY: -400 });
    assert.deepEqual(f.panes.map(p => p.scrollTop), [0, 4400]);
    f.sendWheel(index, { deltaY: 35 });
    assert.deepEqual(f.panes.map(p => p.scrollTop), [35, 4435]);
    f.plugin.onunload();
  });
}

test('strict movement respects unequal pane lengths and a non-scrollable pane', () => {
  const f = fixture();
  Object.defineProperty(f.panes[0], 'scrollHeight', { value: 4000, configurable: true });
  f.panes[0].scrollTop = 3280;
  f.panes[1].scrollTop = 5400;
  f.plugin.toggle();
  f.sendWheel(1, { deltaY: 100 });
  assert.deepEqual(f.panes.map(p => p.scrollTop), [3300, 5420]);
  f.sendWheel(0, { deltaY: -30 });
  assert.deepEqual(f.panes.map(p => p.scrollTop), [3270, 5390]);
  f.plugin.unlock();
  Object.defineProperty(f.panes[0], 'scrollHeight', { value: 700, configurable: true });
  f.panes[0].scrollTop = 0;
  f.plugin.toggle();
  f.sendWheel(1, { deltaY: 100 });
  f.sendWheel(1, { deltaY: -100 });
  assert.deepEqual(f.panes.map(p => p.scrollTop), [0, 5390]);
  f.plugin.onunload();
});

test('fractional wheel distances preserve the initial difference', () => {
  const f = fixture();
  f.plugin.toggle();
  f.sendWheel(0, { deltaY: 0.25 });
  f.sendWheel(1, { deltaY: -0.125 });
  assert.deepEqual(f.panes.map(p => p.scrollTop), [1200.125, 5400.125]);
  f.plugin.onunload();
});

test('line and page wheel units use line height and the source viewport height', () => {
  const f = fixture();
  f.plugin.toggle();
  f.sendWheel(0, { deltaMode: 1, deltaY: 3 });
  assert.deepEqual(f.panes.map(p => p.scrollTop), [1260, 5460]);
  f.sendWheel(1, { deltaMode: 2, deltaY: -1 });
  assert.deepEqual(f.panes.map(p => p.scrollTop), [560, 4760]);
  f.plugin.onunload();
});

test('Ctrl/Meta zoom and horizontal wheel gestures remain native', () => {
  const f = fixture();
  f.plugin.toggle();
  for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { deltaY: 0, deltaX: 100 }]) {
    assert.equal(f.sendWheel(0, options).defaultPrevented, false);
    assert.deepEqual(f.panes.map(p => p.scrollTop), [1200, 5400]);
  }
  f.plugin.onunload();
});

test('Alt wheel stays native, then ordinary wheel locks at the adjusted positions', () => {
  const f = fixture();
  f.plugin.toggle();
  assert.equal(f.sendWheel(0, { altKey: true }).defaultPrevented, false);
  f.scroll(0, 2300);
  assert.equal(f.panes[1].scrollTop, 5400);
  f.dom.window.dispatchEvent(new f.dom.window.KeyboardEvent('keyup', { key: 'Alt', altKey: false }));
  f.sendWheel(0, { deltaY: 100 });
  assert.deepEqual(f.panes.map(p => p.scrollTop), [2400, 5500]);
  f.plugin.onunload();
});

test('scrollable nested content retains its own wheel behavior', () => {
  const f = fixture();
  const inner = f.dom.window.document.createElement('div');
  inner.style.overflowY = 'auto';
  Object.defineProperties(inner, { scrollHeight: { value: 1000 }, clientHeight: { value: 100 } });
  inner.scrollTop = 100;
  f.panes[0].append(inner);
  f.plugin.toggle();
  assert.equal(f.sendWheel(0, { deltaY: 30 }, inner).defaultPrevented, false);
  assert.deepEqual(f.panes.map(p => p.scrollTop), [1200, 5400]);
  f.plugin.onunload();
});

test('nested scroller at its edge chains into the strictly coupled pair', () => {
  const f = fixture();
  const inner = f.dom.window.document.createElement('div');
  inner.style.overflowY = 'auto';
  Object.defineProperties(inner, { scrollHeight: { value: 1000 }, clientHeight: { value: 100 } });
  inner.scrollTop = 900;
  f.panes[0].append(inner);
  f.plugin.toggle();
  assert.equal(f.sendWheel(0, { deltaY: 30 }, inner).defaultPrevented, true);
  assert.deepEqual(f.panes.map(p => p.scrollTop), [1230, 5430]);
  f.plugin.onunload();
});

test('nested overscroll containment keeps the gesture native at its edge', () => {
  const f = fixture();
  const inner = f.dom.window.document.createElement('div');
  inner.style.overflowY = 'auto';
  inner.style.overscrollBehaviorY = 'contain';
  Object.defineProperties(inner, { scrollHeight: { value: 1000 }, clientHeight: { value: 100 } });
  inner.scrollTop = 900;
  f.panes[0].append(inner);
  f.plugin.toggle();
  assert.equal(f.sendWheel(0, { deltaY: 30 }, inner).defaultPrevented, false);
  assert.deepEqual(f.panes.map(p => p.scrollTop), [1200, 5400]);
  f.plugin.onunload();
});

test('CSS scroll behavior and anchoring are constrained and exactly restored on unlock', () => {
  const f = fixture();
  f.panes[0].style.setProperty('scroll-behavior', 'smooth', 'important');
  f.panes[0].style.setProperty('overflow-anchor', 'auto', 'important');
  f.plugin.toggle();
  assert.equal(f.panes[0].style.getPropertyValue('scroll-behavior'), 'auto');
  assert.equal(f.panes[1].style.getPropertyValue('scroll-behavior'), 'auto');
  assert.equal(f.panes[0].style.getPropertyValue('overflow-anchor'), 'none');
  assert.equal(f.panes[1].style.getPropertyValue('overflow-anchor'), 'none');
  f.plugin.unlock();
  assert.equal(f.panes[0].style.getPropertyValue('scroll-behavior'), 'smooth');
  assert.equal(f.panes[0].style.getPropertyPriority('scroll-behavior'), 'important');
  assert.equal(f.panes[1].style.getPropertyValue('scroll-behavior'), '');
  assert.equal(f.panes[0].style.getPropertyValue('overflow-anchor'), 'auto');
  assert.equal(f.panes[0].style.getPropertyPriority('overflow-anchor'), 'important');
  assert.equal(f.panes[1].style.getPropertyValue('overflow-anchor'), '');
  f.plugin.onunload();
});

test('content shrink rebases unreachable positions without a negative shared allowance', () => {
  const f = fixture();
  f.plugin.toggle();
  Object.defineProperty(f.panes[1], 'scrollHeight', { value: 3700, configurable: true });
  f.sendWheel(0, { deltaY: 100 });
  assert.deepEqual(f.panes.map(p => p.scrollTop), [1200, 3000]);
  f.sendWheel(1, { deltaY: -20 });
  assert.deepEqual(f.panes.map(p => p.scrollTop), [1180, 2980]);
  f.plugin.onunload();
});

test('unlock removes the wheel handler and restores native scrolling', () => {
  const f = fixture();
  f.plugin.toggle();
  f.plugin.unlock();
  assert.equal(f.sendWheel(0).defaultPrevented, false);
  f.scroll(0, 1500);
  assert.equal(f.panes[1].scrollTop, 5400);
  f.plugin.onunload();
});

test('mode or file change releases lock and cleans up scroll handlers', () => {
  const f = fixture();
  f.plugin.toggle();
  f.leaves[0].view.file = { path: '另一篇.md' };
  f.listeners.get('file-open')();
  assert.equal(f.plugin.session, null);
  f.scroll(0, 1600);
  assert.equal(f.panes[1].scrollTop, 5400);
  f.plugin.onunload();
});

test('closing a pane releases the lock and unloading removes controls', () => {
  const f = fixture();
  f.plugin.toggle();
  f.leaves[1].view.containerEl.remove();
  f.scroll(0, 1400);
  assert.equal(f.plugin.session, null);
  f.plugin.onunload();
  assert.equal(f.dom.window.document.querySelectorAll('.relative-scroll-lock-action').length, 0);
});

test('status bar and note header controls both toggle lock', () => {
  const f = fixture();
  f.plugin.status.click();
  assert.equal(f.plugin.status.getAttribute('aria-pressed'), 'true');
  f.dom.window.document.querySelector('.relative-scroll-lock-action').click();
  assert.equal(f.plugin.status.getAttribute('aria-pressed'), 'false');
  f.plugin.status.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Enter' }));
  assert.equal(f.plugin.status.getAttribute('aria-pressed'), 'true');
  f.plugin.onunload();
});

test('layout with three visible panes refuses lock rather than picking arbitrarily', () => {
  const f = fixture(['source', 'source', 'source']);
  f.plugin.toggle();
  assert.equal(f.plugin.session, null);
  assert.match(f.notices.at(-1), /左右两栏/);
  f.plugin.onunload();
});

test('English UI and command names follow the app language', () => {
  const f = fixture(['source', 'source'], 'en');
  assert.equal(f.plugin.status.textContent, 'Scroll lock: unlocked');
  assert.equal(f.plugin.commands[0].name, 'Lock / unlock');
  assert.equal(f.plugin.commands[0].hotkeys, undefined);
  f.plugin.toggle();
  assert.equal(f.plugin.status.textContent, 'Scroll lock: locked');
  f.plugin.onunload();
});

test('changing side-by-side panes to a vertical split releases the lock', () => {
  const f = fixture();
  f.plugin.toggle();
  f.leaves[1].view.containerEl.getBoundingClientRect = () => ({ left: 0, right: 600, top: 720, bottom: 1420, width: 600, height: 700 });
  f.listeners.get('layout-change')();
  assert.equal(f.plugin.session, null);
  f.plugin.onunload();
});
