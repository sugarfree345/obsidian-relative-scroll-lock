const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

function fixture({ modes = ['source', 'source'], source = [false, false],
  widths = [500, 500], styles = [{}, {}], language = 'zh' } = {}) {
  const dom = new JSDOM('<main></main><footer></footer>');
  const { document } = dom.window;
  class Plugin {
    constructor(app) { this.app = app; }
    addRibbonIcon() { const el = document.createElement('button'); document.body.append(el); return el; }
    addStatusBarItem() { const el = document.createElement('span'); document.querySelector('footer').append(el); return el; }
    registerDomEvent() {}
    registerEvent() {}
    addCommand() {}
  }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8'), {
    module, Date, Set, Map, Promise, setTimeout, clearTimeout,
    require(name) {
      assert.equal(name, 'obsidian');
      return { Plugin, Notice: class {}, getLanguage: () => language, setIcon() {} };
    },
  });
  const pair = modes.map((mode, index) => {
    const containerEl = document.createElement('section');
    document.querySelector('main').append(containerEl);
    const scroller = document.createElement('div');
    scroller.className = mode === 'preview' ? 'markdown-preview-view' : 'cm-scroller';
    const root = document.createElement('div');
    root.className = mode === 'preview' ? 'markdown-preview-sizer' : 'cm-sizer';
    root.style.fontSize = '16px';
    root.style.fontFamily = 'sans-serif';
    root.style.lineHeight = '24px';
    Object.assign(root.style, styles[index]);
    root.getBoundingClientRect = () => ({ width: widths[index] });
    scroller.append(root);
    containerEl.append(scroller);
    return { view: { containerEl, contentEl: containerEl, file: { path: 'same-note.md' },
      getMode: () => mode, getState: () => ({ source: source[index] }),
      currentMode: { getScroll() { return 0; }, applyScroll() {} } }, root };
  });
  const app = { workspace: { on() {}, onLayoutReady() {} } };
  const plugin = new module.exports(app);
  plugin.onload();
  return { pair, plugin, dom, cleanup() { plugin.onunload(); dom.window.close(); } };
}

test('Live Preview accepts unequal outer sizer widths and inherited font styles for content-based alignment', () => {
  const f = fixture({ widths: [487, 530], styles: [
    { fontSize: '16px', fontFamily: 'Arial', lineHeight: '24px' },
    { fontSize: '17px', fontFamily: 'serif', lineHeight: 'normal' },
  ] });
  try {
    assert.equal(f.plugin.continuousIssue(f.pair), null);
    assert.equal(f.plugin.continuousCompatible(f.pair), true);
  } finally { f.cleanup(); }
});

test('Source mode also accepts different outer sizer geometry when the source submode matches', () => {
  const f = fixture({ source: [true, true], widths: [480, 610], styles: [{}, { fontSize: '19px' }] });
  try {
    assert.equal(f.plugin.continuousIssue(f.pair), null);
    assert.equal(f.plugin.continuousCompatible(f.pair), true);
  } finally { f.cleanup(); }
});

for (const language of ['zh', 'en']) {
  test(`${language}: Live Preview versus Source is refused with a specific mode explanation`, () => {
    const f = fixture({ source: [false, true], language });
    try {
      const issue = f.plugin.continuousIssue(f.pair);
      assert.equal(typeof issue, 'string');
      assert.match(issue, /实时预览|Live Preview/i, 'identify the Live Preview submode');
      assert.match(issue, /源码|Source/i, 'identify the Source submode');
      assert.notEqual(issue, f.plugin.continuousIssue(null), 'mode mismatch must not use a generic layout message');
      assert.equal(f.plugin.continuousCompatible(f.pair), false);
    } finally { f.cleanup(); }
  });
}

test('Reading view still refuses unequal content widths and explains the width mismatch', () => {
  const f = fixture({ modes: ['preview', 'preview'], widths: [500, 540] });
  try {
    const issue = f.plugin.continuousIssue(f.pair);
    assert.equal(typeof issue, 'string');
    assert.match(issue, /宽度|width/i);
    assert.notEqual(issue, f.plugin.continuousIssue(null));
    assert.equal(f.plugin.continuousCompatible(f.pair), false);
  } finally { f.cleanup(); }
});

test('Reading view with matching content geometry remains supported', () => {
  const f = fixture({ modes: ['preview', 'preview'] });
  try {
    assert.equal(f.plugin.continuousIssue(f.pair), null);
    assert.equal(f.plugin.continuousCompatible(f.pair), true);
  } finally { f.cleanup(); }
});

test('Reading and editing modes are refused with a mode-specific message', () => {
  const f = fixture({ modes: ['source', 'preview'] });
  try {
    const issue = f.plugin.continuousIssue(f.pair);
    assert.equal(typeof issue, 'string');
    assert.match(issue, /模式|mode/i);
    assert.notEqual(issue, f.plugin.continuousIssue(null));
    assert.equal(f.plugin.continuousCompatible(f.pair), false);
  } finally { f.cleanup(); }
});

for (const missing of ['getScroll', 'applyScroll']) {
  test(`a missing public ${missing} interface is refused with an API-specific explanation`, () => {
    const f = fixture();
    try {
      delete f.pair[0].view.currentMode[missing];
      const issue = f.plugin.continuousIssue(f.pair);
      assert.equal(typeof issue, 'string');
      assert.match(issue, /接口|API|版本|scroll/i);
      assert.notEqual(issue, f.plugin.continuousIssue(null));
      assert.equal(f.plugin.continuousCompatible(f.pair), false);
    } finally { f.cleanup(); }
  });
}

test('a not-yet-rendered content root is refused with a content-specific explanation', () => {
  const f = fixture();
  try {
    f.pair[1].root.remove();
    const issue = f.plugin.continuousIssue(f.pair);
    assert.equal(typeof issue, 'string');
    assert.match(issue, /正文|内容|容器|准备|加载|渲染|content|render|ready/i);
    assert.notEqual(issue, f.plugin.continuousIssue(null));
    assert.equal(f.plugin.continuousCompatible(f.pair), false);
  } finally { f.cleanup(); }
});

test('different files are refused with a note-specific explanation', () => {
  const f = fixture();
  try {
    f.pair[1].view.file = { path: 'different-note.md' };
    const issue = f.plugin.continuousIssue(f.pair);
    assert.equal(typeof issue, 'string');
    assert.match(issue, /同一|文件|笔记|same|note|file/i);
    assert.notEqual(issue, f.plugin.continuousIssue(null));
    assert.equal(f.plugin.continuousCompatible(f.pair), false);
  } finally { f.cleanup(); }
});

test('a missing pair gives a layout-specific explanation', () => {
  const f = fixture();
  try {
    const issue = f.plugin.continuousIssue(null);
    assert.equal(typeof issue, 'string');
    assert.match(issue, /左右|两栏|分栏|主区域|two|side|layout/i);
    assert.equal(f.plugin.continuousCompatible(null), false);
  } finally { f.cleanup(); }
});

test('Source adapter fallback uses synchronous CM block geometry without scheduling editing applyScroll', async () => {
  const f = fixture();
  try {
    const view = f.pair[0].view;
    const pane = f.plugin.scroller(view);
    let asynchronousCalls = 0;
    view.currentMode.applyScroll = () => { asynchronousCalls++; setTimeout(() => { pane.scrollTop = 9999; }, 0); };
    const contentDOM = f.dom.window.document.createElement('div');
    Object.defineProperty(contentDOM, 'offsetTop', { value: 12 });
    view.editor = { cm: {
      state: { doc: { lines: 100, line: number => ({ from: (number - 1) * 10 }),
        lineAt: offset => ({ number: Math.floor(offset / 10) + 1 }) } },
      lineBlockAt(from) { assert.equal(from, 200); return { from: 200, to: 209, top: 400, height: 20 }; },
      contentDOM,
    } };
    f.plugin.adapter(view).apply(20.5);
    assert.equal(pane.scrollTop, 422, 'geometry applies the target position synchronously');
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(asynchronousCalls, 0, 'editing applyScroll must not queue an uncancellable later movement');
    assert.equal(pane.scrollTop, 422, 'no delayed callback changes the user position');
  } finally { f.cleanup(); }
});

test('missing editing CM geometry does not fall back to a delayed applyScroll callback', async () => {
  const f = fixture();
  try {
    const view = f.pair[0].view;
    const pane = f.plugin.scroller(view);
    pane.scrollTop = 123;
    let calls = 0;
    view.currentMode.applyScroll = () => { calls++; setTimeout(() => { pane.scrollTop = 9999; }, 0); };
    view.editor = { cm: { state: { doc: { lines: 100 } } } };
    f.plugin.adapter(view).apply(20.5);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(calls, 0);
    assert.equal(pane.scrollTop, 123, 'unsupported editing geometry cannot trigger a late scroll');
  } finally { f.cleanup(); }
});

test('Reading adapter fallback retains the public synchronous applyScroll interface', () => {
  const f = fixture({ modes: ['preview', 'preview'] });
  try {
    const view = f.pair[0].view;
    const pane = f.plugin.scroller(view);
    const calls = [];
    view.currentMode.applyScroll = anchor => { calls.push(anchor); pane.scrollTop = 777; };
    f.plugin.adapter(view).apply(20.5);
    assert.deepEqual(calls, [20.5]);
    assert.equal(pane.scrollTop, 777);
  } finally { f.cleanup(); }
});
