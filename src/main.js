"use strict";

const { Plugin, Notice, setIcon, getLanguage } = require("obsidian");

const messages = {
  zh: {
    toggle: "锁紧 / 松开", unlock: "松开", control: "滚动锁：锁紧 / 松开",
    ready: "滚动锁已就绪：点击「接续并锁定」自动双栏阅读，或分别定位后使用手动锁。",
    layout: "请在主区域保留左右两栏笔记，再点滚动锁。支持同一笔记、阅读和编辑模式。",
    closed: "视图已关闭，滚动锁已松开。",
    lockedNotice: "已锁紧：两栏一起滚动，到顶或到底一起停住。按住 Alt 可单独调整。",
    unlockedNotice: "已松开：分别调整左右位置，再点一次锁紧。",
    changed: "笔记、布局或显示模式已切换，滚动锁已松开；定位后可重新锁紧。",
    temporary: "滚动锁：临时松开", locked: "滚动锁：锁紧", unlocked: "滚动锁：松开",
    lockedTitle: "点击松开，分别调整位置；按住 Alt 可临时单独滚动",
    unlockedTitle: "先分别定位左右两栏，点击从当前位置锁紧同步",
    continuous: "接续并锁定", continuousStatus: "滚动锁：自动接续",
    continuousTitle: "保持左栏位置，让右栏接上左栏底部；文末自动向上调整左栏",
    continuousReady: "已接续并锁定。右栏到文末时自动回推左栏，排版变化后自动校正。",
    continuousLayout: "连续阅读需要同一篇笔记、相同显示模式、相同正文宽度和字号的左右两栏。",
    continuousPair: "请在主区域左右打开两个 Markdown 栏。阅读、实时预览和源码模式均可使用自动接续。",
    continuousFile: "自动接续需要两栏显示同一篇笔记；当前是不同文件。",
    continuousModes: (left, right) => `两栏模式不同：左栏是${left}，右栏是${right}。请统一模式；两栏均为编辑模式也可以。`,
    continuousWidth: (left, right) => `两栏阅读正文宽度不同：左 ${left}px，右 ${right}px。请统一宽度后重试。`,
    continuousFont: "两栏阅读正文的字体、字号或行高不同，请统一后重试。",
    continuousEditorReady: "编辑器正文尚未准备好，请稍等再点「接续并锁定」。",
    continuousAPI: "当前视图没有提供内容定位接口，请重开该笔记或更新 Obsidian 后重试。",
    modeReading: "阅读模式", modeLive: "实时预览编辑模式", modeSource: "源码编辑模式",
    continuousFailed: "暂时无法稳定衔接，已松开。请统一两栏排版和折叠状态，再试一次。",
    continuousShort: "全文不足两屏：右栏显示到文末，左栏仅显示前面的内容，其余区域留空。",
    aligning: "正在接续…",
  },
  en: {
    toggle: "Lock / unlock", unlock: "Unlock", control: "Scroll lock: lock / unlock",
    ready: "Scroll lock is ready. Click “Continue and lock” for continuous reading, or position both panes and lock manually.",
    layout: "Open exactly two Markdown panes side by side in the main workspace. The same note and reading/editing modes are supported.",
    closed: "A pane was closed. Scroll lock is now unlocked.",
    lockedNotice: "Locked at the current positions. Both panes stop together at either boundary. Hold Alt to adjust one pane.",
    unlockedNotice: "Unlocked. Adjust either pane, then click again to lock.",
    changed: "The note, layout, or view mode changed. Reposition the panes and lock again.",
    temporary: "Scroll lock: temporarily unlocked", locked: "Scroll lock: locked", unlocked: "Scroll lock: unlocked",
    lockedTitle: "Click to unlock; hold Alt while scrolling to adjust one pane independently",
    unlockedTitle: "Position both panes first, then click to lock without jumping",
    continuous: "Continue and lock", continuousStatus: "Scroll lock: continuous",
    continuousTitle: "Continue from the left viewport in the right pane; backfill the left pane at the end",
    continuousReady: "Continuous reading locked. The left pane backfills at the end; layout changes are realigned automatically.",
    continuousLayout: "Continuous reading needs the same note, view mode, text width and font size in two side-by-side panes.",
    continuousPair: "Open two Markdown panes side by side in the main workspace. Reading, Live Preview and Source editing are supported.",
    continuousFile: "Continue and lock needs the same note in both panes. These panes show different files.",
    continuousModes: (left, right) => `Different view modes: left is ${left}; right is ${right}. Use the same mode in both panes. Both panes can be editing.`,
    continuousWidth: (left, right) => `Reading text widths differ: left ${left}px, right ${right}px. Match their widths and retry.`,
    continuousFont: "The reading panes have different text fonts, sizes or line heights. Match their typography and retry.",
    continuousEditorReady: "The editor content is not ready yet. Wait briefly, then click Continue and lock again.",
    continuousAPI: "This view does not expose content positioning. Reopen the note or update Obsidian, then retry.",
    modeReading: "Reading", modeLive: "Live Preview editing", modeSource: "Source editing",
    continuousFailed: "Could not establish a stable seam. Unlocked; match the layout and folds, then try again.",
    continuousShort: "The note is shorter than two screens. The right pane shows the end; unused space in the left pane stays blank.",
    aligning: "Aligning…",
  },
};

// Each scroll container retains its own position. No file offsets or note
// contents are read, written, or shared between the two views.
class RelativeScrollSession {
  constructor(panes, onState = () => {}, onInvalid = () => {}) {
    this.panes = panes;
    this.onState = onState;
    this.onInvalid = onInvalid;
    this.positions = panes.map((pane) => pane.scrollTop);
    this.disposers = [];
    this.alt = false;
    this.disposed = false;
    this.propagating = false;
    panes.forEach((pane, index) => {
      // Smooth scrolling and automatic DOM anchoring can feed stale or
      // layout-induced deltas back into the pair. Restore both exact styles
      // on unlock; ordinary unlocked document behavior remains native.
      for (const [property, lockedValue] of [["scroll-behavior", "auto"], ["overflow-anchor", "none"]]) {
        const value = pane.style.getPropertyValue(property);
        const priority = pane.style.getPropertyPriority(property);
        pane.style.setProperty(property, lockedValue, "important");
        this.disposers.push(() => {
          if (value) pane.style.setProperty(property, value, priority);
          else pane.style.removeProperty(property);
        });
      }
      this.listen(pane, "scroll", () => this.scroll(index), { passive: true });
      this.listen(pane, "wheel", (event) => this.wheel(index, event), { passive: false, capture: true });
    });
    const windows = new Set(panes.map((pane) => pane.ownerDocument.defaultView));
    for (const win of windows) {
      this.listen(win, "keydown", (event) => this.setAlt(event.altKey), true);
      this.listen(win, "keyup", (event) => this.setAlt(event.altKey), true);
      this.listen(win, "blur", () => {
        this.setAlt(false);
      });
    }
  }

  listen(target, name, fn, options) {
    target.addEventListener(name, fn, options);
    this.disposers.push(() => target.removeEventListener(name, fn, options));
  }

  setAlt(value) {
    if (this.alt !== value) {
      // An Alt adjustment establishes a new offset. Absorb pending native
      // scroll events before resuming so releasing Alt never snaps back.
      this.positions = this.panes.map((pane) => pane.scrollTop);
      this.alt = value;
      this.onState(value);
    }
  }

  valid() {
    if (this.disposed) return false;
    if (this.panes.some((pane) => !pane.isConnected)) {
      this.onInvalid();
      return false;
    }
    return true;
  }

  // Inner code blocks, tables, and controls should keep their normal wheel
  // behavior. Chain to the pair only when a nested scroller reaches its edge.
  nestedConsumes(pane, event) {
    const win = pane.ownerDocument.defaultView;
    for (let el = event.target; el && el !== pane; el = el.parentElement) {
      if (el.nodeType !== 1) continue;
      if (el.matches("textarea, input, select, [role='slider']")) return true;
      const style = win.getComputedStyle(el);
      if (!/^(auto|scroll|overlay)$/.test(style.overflowY) || el.scrollHeight <= el.clientHeight) continue;
      const max = el.scrollHeight - el.clientHeight;
      if ((event.deltaY > 0 && el.scrollTop < max - 0.5) ||
          (event.deltaY < 0 && el.scrollTop > 0.5)) return true;
      const behavior = style.overscrollBehaviorY || style.overscrollBehavior;
      if (behavior === "contain" || behavior === "none") return true;
    }
    return false;
  }

  wheel(index, event) {
    if (!this.valid() || event.defaultPrevented) return;
    this.setAlt(event.altKey);
    // Preserve zoom, horizontal scrolling, and the explicit Alt escape hatch.
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        !Number.isFinite(event.deltaY) || event.deltaY === 0 ||
        Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const pane = this.panes[index];
    if (this.nestedConsumes(pane, event) || !event.cancelable) return;
    let delta = event.deltaY;
    if (event.deltaMode === 1) {
      const style = pane.ownerDocument.defaultView.getComputedStyle(pane);
      const lineHeight = parseFloat(style.lineHeight);
      const fontSize = parseFloat(style.fontSize);
      delta *= Number.isFinite(lineHeight) ? lineHeight : (Number.isFinite(fontSize) ? fontSize * 1.2 : 16);
    } else if (event.deltaMode === 2) {
      delta *= pane.clientHeight;
    }
    // Cancel even at the boundary: excess wheel/trackpad motion is discarded,
    // never accumulated. The very next reverse gesture can move both panes.
    event.preventDefault();
    event.stopPropagation();
    this.move(delta);
  }

  move(delta) {
    const maxima = this.panes.map((pane) => Math.max(0, pane.scrollHeight - pane.clientHeight));
    // A resize or content deletion can make an old position unreachable.
    // Rebase within the new ranges rather than creating a negative allowance.
    const base = this.positions.map((position, index) => Math.min(maxima[index], Math.max(0, position)));
    const lower = Math.max(...base.map((position) => -position));
    const upper = Math.min(...base.map((position, index) => maxima[index] - position));
    const shared = Math.min(upper, Math.max(lower, delta));
    this.propagating = true;
    try {
      this.panes.forEach((pane, index) => { pane.scrollTop = base[index] + shared; });
      // Read back actual (possibly subpixel-rounded) positions before native
      // asynchronous scroll events echo the assignments.
      this.positions = this.panes.map((pane) => pane.scrollTop);
    } finally {
      this.propagating = false;
    }
  }

  scroll(index) {
    if (!this.valid() || this.propagating) return;
    if (this.alt) {
      this.positions = this.panes.map((pane) => pane.scrollTop);
      return;
    }
    // Scrollbar drags, keyboard navigation and non-cancelable wheel events
    // arrive after native movement; constrain the source as well as its peer.
    const delta = this.panes[index].scrollTop - this.positions[index];
    if (delta !== 0) this.move(delta);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of this.disposers.splice(0)) dispose();
  }
}

// Anchors are Obsidian MarkdownSubView scroll positions (source line +
// fraction), not document percentages. The adapters sample and restore a
// scrollTop synchronously, so only the final viewport reaches the screen.
class ContinuousScrollSession extends RelativeScrollSession {
  constructor(panes, adapters, options = {}) {
    super(panes, options.onState, options.onInvalid);
    this.continuous = true;
    this.adapters = adapters;
    this.validate = options.validate || (() => true);
    this.settleMs = options.settleMs ?? 45;
    this.maxPasses = options.maxPasses ?? 24;
    this.aligning = false;
    this.short = false;
    this.scheduled = null;
    this.timer = null;
    this.pendingWait = null;
    this.running = null;
    this.dirty = false;
    this.queuedDelta = 0;
    this.atEnd = false;
    const win = panes[0].ownerDocument.defaultView;
    if (win.ResizeObserver) {
      const observer = new win.ResizeObserver(() => this.schedule());
      for (const adapter of adapters) {
        if (adapter.content) observer.observe(adapter.content);
        if (adapter.container) observer.observe(adapter.container);
      }
      this.disposers.push(() => observer.disconnect());
    }
    if (win.MutationObserver) {
      const observer = new win.MutationObserver(() => this.schedule());
      for (const adapter of adapters) if (adapter.content) {
        observer.observe(adapter.content, { childList: true, subtree: true, characterData: true });
      }
      this.disposers.push(() => observer.disconnect());
    }
    for (const pane of panes) this.listen(pane, "load", () => this.schedule(), true);
    this.listen(win, "resize", () => this.schedule());
    this.ready = this.realign();
  }

  valid() {
    if (!super.valid()) return false;
    if (!this.validate()) {
      this.onInvalid();
      return false;
    }
    return true;
  }

  wait() {
    return new Promise((resolve) => {
      this.pendingWait = resolve;
      this.timer = this.panes[0].ownerDocument.defaultView.setTimeout(() => {
        this.timer = null;
        this.pendingWait = null;
        resolve();
      }, this.settleMs);
    });
  }

  schedule() {
    if (this.disposed || this.alt) return;
    if (this.aligning) { this.dirty = true; return; }
    if (this.scheduled !== null) return;
    const win = this.panes[0].ownerDocument.defaultView;
    this.scheduled = win.setTimeout(() => {
      this.scheduled = null;
      void this.realign();
    }, this.settleMs);
  }

  setAlt(value) {
    super.setAlt(value);
    if (value) this.atEnd = false;
    if (!value && this.continuous) this.schedule();
  }

  move(delta) {
    if (!this.valid()) return;
    if (this.aligning) {
      // Keep wheel/trackpad input during asynchronous rendering. Clamp the
      // queued displacement immediately so blocked motion never builds up
      // a reverse-scroll dead zone. Nested scrollers still use base.wheel().
      const base = this.positions.map((p, i) => Math.min(this.max(i), Math.max(0, p)));
      const lower = Math.max(...base.map((p) => -p));
      const upper = Math.min(...base.map((p, i) => this.max(i) - p));
      this.queuedDelta = Math.min(upper, Math.max(lower, this.queuedDelta + delta));
      return;
    }
    const before = this.positions.slice();
    super.move(delta);
    if (this.positions.some((position, i) => Math.abs(position - before[i]) > 0.01)) {
      this.atEnd = this.panes[1].scrollTop >= this.max(1) - 1;
      const bottom = this.adapters[0].at(this.panes[0].scrollTop + this.height(0));
      const top = this.adapters[1].at(this.panes[1].scrollTop);
      if (!Number.isFinite(bottom) || !Number.isFinite(top) || Math.abs(bottom - top) > 0.025) this.schedule();
    }
  }

  scroll(index) {
    if (this.aligning || !this.valid()) return;
    super.scroll(index);
  }

  capture() {
    this.positions = this.panes.map((pane) => pane.scrollTop);
  }

  paused() {
    if (!this.alt) return false;
    this.capture();
    return true;
  }

  max(index) {
    const pane = this.panes[index];
    return Math.max(0, pane.scrollHeight - pane.clientHeight);
  }

  height(index) {
    return this.adapters[index].viewportHeight?.() ?? this.panes[index].clientHeight;
  }

  pixelFor(index, anchor) {
    // Invert the monotone public scroll-position map without displaying a
    // temporary viewport. Each adapter sample restores its DOM synchronously.
    let low = 0;
    let high = Math.max(0, this.panes[index].scrollHeight - 8);
    let best = null;
    let error = Infinity;
    for (let i = 0; i < 26 && high - low > 0.25; i++) {
      const middle = (low + high) / 2;
      const value = this.adapters[index].at(middle);
      if (!Number.isFinite(value)) return null;
      // Native scrollTop and clientHeight can round to integer pixels. Keep
      // the best observed sample instead of returning an unobserved midpoint
      // just across a rounding boundary.
      for (const pixel of [Math.round(middle), middle]) {
        const sample = this.adapters[index].at(pixel);
        const distance = Number.isFinite(sample) ? Math.abs(sample - anchor) : Infinity;
        if (distance < error) { best = pixel; error = distance; }
      }
      if (error < 0.000001) return best;
      if (value < anchor) low = middle;
      else high = middle;
    }
    return error <= 0.025 ? best : null;
  }

  async place(index, anchor) {
    if (!this.valid() || !Number.isFinite(anchor)) return false;
    this.adapters[index].apply(anchor);
    await this.wait();
    return this.valid();
  }

  realign() {
    if (this.running) return this.running;
    if (!this.valid()) return Promise.resolve(false);
    this.running = this.align().catch(() => {
      if (!this.disposed) this.onInvalid();
      return false;
    }).finally(() => {
      this.running = null;
      this.aligning = false;
      if (!this.disposed) {
        const delta = this.queuedDelta;
        this.queuedDelta = 0;
        if (delta) this.move(delta);
        this.onState();
      }
    });
    return this.running;
  }

  async align() {
    this.aligning = true;
    this.onState();
    const [left, right] = this.panes;
    // A short note uses a reduced LEFT viewport, with blank space below it.
    // Restore the full viewport before remeasuring after an edit or resize.
    this.adapters[0].setViewportHeight(null);
    this.short = false;
    let leftAnchor = this.adapters[0].at(left.scrollTop);
    await this.wait();
    let stable = 0;
    let previous = null;
    let tail = this.atEnd;
    for (let pass = 0; pass < this.maxPasses; pass++) {
      if (!this.valid()) return false;
      if (this.paused()) return true;
      this.dirty = false;
      if (!tail) {
        const current = this.adapters[0].at(left.scrollTop);
        if (!Number.isFinite(leftAnchor)) leftAnchor = current;
        if (Number.isFinite(leftAnchor) && Number.isFinite(current) && Math.abs(current - leftAnchor) > 0.025) {
          if (!await this.place(0, leftAnchor)) return false;
          if (this.paused()) return true;
        }
      }
      let seam = left.scrollTop + this.height(0);
      let expected = this.adapters[0].at(seam);
      let actual = this.adapters[1].at(right.scrollTop);
      if (!tail && Number.isFinite(expected)) {
        if (!Number.isFinite(actual) || Math.abs(actual - expected) > 0.025) {
          if (!await this.place(1, expected)) return false;
          if (this.paused()) return true;
          actual = this.adapters[1].at(right.scrollTop);
        }
        if (Number.isFinite(actual) && actual + 0.025 < expected && right.scrollTop >= this.max(1) - 1) tail = true;
        if (right.scrollTop >= this.max(1) - 3) tail = true;
      } else if (!tail) {
        // Sampling beyond scrollMax is impossible. In matching layouts this
        // means there is less than one right viewport left in the document.
        if (seam > this.max(0) + 1) tail = true;
      }
      if (tail) {
        right.scrollTop = this.max(1);
        await this.wait();
        if (!this.valid()) return false;
        if (this.paused()) return true;
        actual = this.adapters[1].at(right.scrollTop);
        if (Number.isFinite(actual)) {
          const currentBottom = this.adapters[0].at(left.scrollTop + this.height(0));
          if (this.short || !Number.isFinite(currentBottom) || Math.abs(currentBottom - actual) > 0.025) {
            this.adapters[0].setViewportHeight(null);
            this.short = false;
            const fullHeight = this.height(0);
            let seamTop = this.pixelFor(0, actual);
            if (seamTop === null) {
              // Ask Obsidian to render an unmeasured target, then invert its
              // newly measured position map. No reduced viewport is painted.
              if (!await this.place(0, actual)) return false;
              if (this.paused()) return true;
              seamTop = this.pixelFor(0, actual);
            }
            if (seamTop === null) { await this.wait(); continue; }
            if (seamTop < fullHeight - 1) {
              // A fully expanded pair cannot fit into a short note without
              // duplicated text. Keep the right at EOF and expose only the
              // prefix in the left pane; do not mutate the Markdown file.
              this.adapters[0].setViewportHeight(Math.max(0, seamTop));
              this.short = true;
              left.scrollTop = 0;
            } else {
              left.scrollTop = seamTop - fullHeight;
            }
            await this.wait();
            if (!this.valid()) return false;
          }
        }
      }
      seam = left.scrollTop + this.height(0);
      expected = this.adapters[0].at(seam);
      actual = this.adapters[1].at(right.scrollTop);
      const emptyLeft = this.short && this.height(0) <= 1;
      const aligned = Number.isFinite(expected) && Number.isFinite(actual) &&
        (Math.abs(expected - actual) <= 0.025 || (emptyLeft && actual <= 0.025));
      // Reading view may keep refining estimates for far-away sections even
      // after the visible seam is stable. Only local geometry matters here;
      // at EOF, changing scrollMax also changes right.scrollTop and is caught.
      const snapshot = [left.scrollTop, right.scrollTop, this.height(0), this.height(1)];
      const unchanged = previous && snapshot.every((value, i) => Math.abs(value - previous[i]) <= 1);
      stable = aligned && unchanged && (!tail || right.scrollTop >= this.max(1) - 1) ? stable + 1 : 0;
      previous = snapshot;
      this.capture();
      if (stable >= 2) { this.atEnd = tail; return true; }
      await this.wait();
    }
    if (!this.disposed) this.onInvalid();
    return false;
  }

  dispose() {
    if (this.disposed) return;
    const win = this.panes[0].ownerDocument.defaultView;
    if (this.scheduled !== null) win.clearTimeout(this.scheduled);
    if (this.timer !== null) win.clearTimeout(this.timer);
    this.pendingWait?.();
    this.pendingWait = null;
    super.dispose();
    this.adapters[0].setViewportHeight(null);
  }
}

module.exports = class ScrollLockPlugin extends Plugin {
  onload() {
    const language = typeof getLanguage === "function" ? getLanguage() : "en";
    this.text = messages[String(language).startsWith("zh") ? "zh" : "en"];
    this.session = null;
    this.binding = null;
    this.actions = new Map();
    this.continuousActions = new Map();
    this.loaded = true;
    this.ribbon = this.addRibbonIcon("unlock", this.text.control, () => this.toggle());
    this.continuousRibbon = this.addRibbonIcon("columns-2", this.text.continuous, () => void this.continuousLock());
    this.status = this.addStatusBarItem();
    this.status.classList.add("relative-scroll-lock-status");
    this.status.setAttribute("role", "button");
    this.status.setAttribute("tabindex", "0");
    this.registerDomEvent(this.status, "click", () => this.toggle());
    this.registerDomEvent(this.status, "keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.toggle();
      }
    });
    this.addCommand({
      id: "toggle", name: this.text.toggle,
      callback: () => this.toggle(),
    });
    this.addCommand({ id: "unlock", name: this.text.unlock, callback: () => this.unlock() });
    this.addCommand({ id: "continuous-lock", name: this.text.continuous, callback: () => void this.continuousLock() });
    this.continuousStatus = this.addStatusBarItem();
    this.continuousStatus.classList.add("relative-scroll-lock-status", "relative-scroll-continuous-status");
    this.continuousStatus.setAttribute("role", "button");
    this.continuousStatus.setAttribute("tabindex", "0");
    this.registerDomEvent(this.continuousStatus, "click", () => void this.continuousLock());
    this.registerDomEvent(this.continuousStatus, "keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void this.continuousLock();
      }
    });
    this.registerEvent(this.app.workspace.on("layout-change", () => this.refresh()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.refresh()));
    this.app.workspace.onLayoutReady(() => {
      if (!this.loaded) return;
      this.refresh();
      new Notice(this.text.ready, 7000);
    });
    this.render();
  }

  visibleLeaves() {
    const workspace = this.app.workspace;
    return workspace.getLeavesOfType("markdown").filter((leaf) => {
      if (typeof leaf.getRoot === "function" && leaf.getRoot() !== workspace.rootSplit) return false;
      const el = leaf.view.containerEl;
      if (!el.isConnected || !el.getClientRects().length) return false;
      const rect = el.getBoundingClientRect();
      const style = el.ownerDocument.defaultView.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
  }

  findPair() {
    const leaves = this.visibleLeaves();
    if (leaves.length !== 2) return null;
    leaves.sort((a, b) => a.view.containerEl.getBoundingClientRect().left - b.view.containerEl.getBoundingClientRect().left);
    const left = leaves[0].view.containerEl.getBoundingClientRect();
    const right = leaves[1].view.containerEl.getBoundingClientRect();
    const overlap = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
    if (right.left < left.right - 8 || overlap < Math.min(left.height, right.height) / 2) return null;
    if (!leaves.every((leaf) => leaf.view.file && this.scroller(leaf.view))) return null;
    return leaves;
  }

  scroller(view) {
    const reading = view.getMode() === "preview";
    const root = view.contentEl || view.containerEl;
    return root.querySelector(reading ? ".markdown-preview-view" : ".cm-scroller");
  }

  releaseNativeLink(pair) {
    if (pair[0].group && pair[0].group === pair[1].group) {
      for (const leaf of pair) leaf.setGroup(null);
      this.app.workspace.requestSaveLayout?.();
    }
  }

  continuousCompatible(pair) {
    return this.continuousIssue(pair) === null;
  }

  modeLabel(view) {
    return view.getMode() === "preview" ? this.text.modeReading :
      view.getState?.().source ? this.text.modeSource : this.text.modeLive;
  }

  continuousIssue(pair) {
    if (!pair || pair.length !== 2) return this.text.continuousPair;
    if (pair[0].view.file.path !== pair[1].view.file.path) return this.text.continuousFile;
    const [a, b] = pair.map((leaf) => leaf.view);
    if (a.getMode() !== b.getMode() || (a.getMode() === "source" &&
        Boolean(a.getState?.().source) !== Boolean(b.getState?.().source))) {
      return this.text.continuousModes(this.modeLabel(a), this.modeLabel(b));
    }
    const roots = pair.map((leaf) => this.contentRoot(leaf.view));
    if (roots.some((root) => !root)) return this.text.continuousEditorReady;
    if (!pair.every((leaf) => typeof leaf.view.currentMode?.getScroll === "function" &&
        typeof leaf.view.currentMode?.applyScroll === "function")) return this.text.continuousAPI;
    // CM6's .cm-sizer is an outer sizing wrapper, not the text viewport.
    // Rendered widgets, gutters and scrollbar state can change its metrics.
    // For editing, let the content-anchor engine establish and verify the
    // actual seam instead of rejecting on these unrelated outer metrics.
    if (a.getMode() === "source") return null;
    const widths = roots.map((root) => root.getBoundingClientRect().width);
    if (Math.abs(widths[0] - widths[1]) > 2) {
      return this.text.continuousWidth(widths[0].toFixed(1), widths[1].toFixed(1));
    }
    const styles = roots.map((root) => root.ownerDocument.defaultView.getComputedStyle(root));
    if (!["fontSize", "fontFamily", "lineHeight"].every((key) => styles[0][key] === styles[1][key])) {
      return this.text.continuousFont;
    }
    return null;
  }

  contentRoot(view) {
    const pane = this.scroller(view);
    return pane?.querySelector(view.getMode() === "preview" ? ".markdown-preview-sizer" : ".cm-sizer");
  }

  adapter(view) {
    const pane = this.scroller(view);
    const mode = view.currentMode;
    const names = ["clip-path", "visibility"];
    const previous = names.map((name) => [name, pane.style.getPropertyValue(name), pane.style.getPropertyPriority(name)]);
    let clippedHeight = null;
    return {
      content: this.contentRoot(view),
      container: view.containerEl,
      viewportHeight() { return clippedHeight === null ? pane.clientHeight : Math.min(pane.clientHeight, clippedHeight); },
      at(pixel) {
        if (!Number.isFinite(pixel)) return null;
        const original = pane.scrollTop;
        const temporary = [];
        try {
          if (pixel > pane.scrollHeight - pane.clientHeight && pixel <= pane.scrollHeight) {
            // getScroll() reads the live scrollTop. A momentary viewport of
            // eight pixels makes a bottom-edge position addressable as a
            // TOP position. Restore everything synchronously before paint.
            for (const [name, value] of [["height", "8px"], ["min-height", "0"], ["max-height", "8px"], ["flex", "none"]]) {
              temporary.push([name, pane.style.getPropertyValue(name), pane.style.getPropertyPriority(name)]);
              pane.style.setProperty(name, value, "important");
            }
          }
          pane.scrollTop = pixel;
          if (Math.abs(pane.scrollTop - pixel) > 1) return null;
          const anchor = mode.getScroll();
          return Number.isFinite(anchor) ? anchor : null;
        } finally {
          for (const [name, value, priority] of temporary) {
            if (value) pane.style.setProperty(name, value, priority);
            else pane.style.removeProperty(name);
          }
          pane.scrollTop = original;
        }
      },
      apply(anchor) { mode.applyScroll(anchor); },
      setViewportHeight(height) {
        if (height === null) {
          if (clippedHeight === null) return;
          for (const [name, value, priority] of previous) {
            if (value) pane.style.setProperty(name, value, priority);
            else pane.style.removeProperty(name);
          }
          clippedHeight = null;
          return;
        }
        // Clip the unused bottom area instead of resizing the actual editor:
        // Obsidian gives its scrollers padding and a minimum height. Keeping
        // native geometry also avoids reflowing the very anchor being joined.
        clippedHeight = Math.max(0, height);
        pane.style.setProperty("clip-path", `inset(0 0 ${Math.max(0, pane.clientHeight - clippedHeight)}px 0)`, "important");
        if (height <= 1) pane.style.setProperty("visibility", "hidden", "important");
        else if (previous[1][1]) pane.style.setProperty("visibility", previous[1][1], previous[1][2]);
        else pane.style.removeProperty("visibility");
      },
    };
  }

  async continuousLock() {
    if (this.session?.continuous) return this.session.realign();
    const pair = this.findPair();
    const issue = this.continuousIssue(pair);
    if (issue) {
      new Notice(issue);
      return false;
    }
    this.session?.dispose();
    this.session = null;
    this.releaseNativeLink(pair);
    const modes = pair.map((leaf) => leaf.view.currentMode);
    const binding = pair.map((leaf) => ({ leaf, view: leaf.view, path: leaf.view.file.path, scroller: this.scroller(leaf.view) }));
    this.binding = binding;
    let session;
    session = new ContinuousScrollSession(binding.map((item) => item.scroller), pair.map((leaf) => this.adapter(leaf.view)), {
      onState: () => this.render(),
      onInvalid: () => { if (this.session === session) this.unlock(this.continuousIssue(this.findPair()) || this.text.continuousFailed); },
      validate: () => {
        if (!this.loaded) return false;
        const current = this.findPair();
        return current && this.continuousCompatible(current) && binding.every((item, i) =>
          current[i] === item.leaf && item.leaf.view === item.view && item.view.file?.path === item.path &&
          item.view.currentMode === modes[i] && this.scroller(item.view) === item.scroller);
      },
    });
    this.session = session;
    this.render();
    const success = await session.ready;
    if (this.session !== session) return false;
    if (!success) { this.unlock(this.text.continuousFailed); return false; }
    new Notice(session.short ? this.text.continuousShort : this.text.continuousReady, 5000);
    this.render();
    return true;
  }

  toggle() {
    if (this.session) {
      this.unlock();
      return;
    }
    const pair = this.findPair();
    if (!pair) {
      new Notice(this.text.layout);
      return;
    }
    this.releaseNativeLink(pair);
    this.binding = pair.map((leaf) => ({ leaf, view: leaf.view, path: leaf.view.file.path, scroller: this.scroller(leaf.view) }));
    this.session = new RelativeScrollSession(
      this.binding.map((item) => item.scroller),
      () => this.render(),
      () => this.unlock(this.text.closed),
    );
    this.render();
    new Notice(this.text.lockedNotice, 3500);
  }

  unlock(message) {
    const wasLocked = Boolean(this.session);
    this.session?.dispose();
    this.session = null;
    this.binding = null;
    this.render();
    if (message) new Notice(message);
    else if (wasLocked) new Notice(this.text.unlockedNotice, 2500);
  }

  refresh() {
    if (!this.loaded) return;
    if (this.binding) {
      const visible = this.findPair();
      const valid = visible && this.binding.every(({ leaf, view, path, scroller }) =>
        visible.includes(leaf) && leaf.view === view && view.file?.path === path && this.scroller(view) === scroller);
      if (!valid) this.unlock(this.text.changed);
    }
    const all = this.app.workspace.getLeavesOfType("markdown");
    for (const controls of [this.actions, this.continuousActions]) {
      for (const [view, button] of controls) {
        if (!all.some((leaf) => leaf.view === view) || !button.isConnected) {
          button.remove();
          controls.delete(view);
        }
      }
    }
    for (const leaf of all) {
      const view = leaf.view;
      if (!this.actions.has(view) && typeof view.addAction === "function") {
        const button = view.addAction("unlock", this.text.control, () => this.toggle());
        button.classList.add("relative-scroll-lock-action");
        this.actions.set(view, button);
      }
      if (!this.continuousActions.has(view) && typeof view.addAction === "function") {
        const button = view.addAction("columns-2", this.text.continuousTitle, () => void this.continuousLock());
        button.classList.add("relative-scroll-continuous-action");
        this.continuousActions.set(view, button);
      }
    }
    this.render();
  }

  render() {
    const locked = Boolean(this.session);
    const temporary = locked && this.session.alt;
    const continuous = Boolean(this.session?.continuous);
    const text = this.session?.aligning ? this.text.aligning : temporary ? this.text.temporary :
      continuous ? this.text.continuousStatus : locked ? this.text.locked : this.text.unlocked;
    const title = locked ? this.text.lockedTitle : this.text.unlockedTitle;
    const icon = locked && !temporary ? "lock" : "unlock";
    if (this.status) {
      this.status.textContent = text;
      this.status.setAttribute("title", title);
      this.status.setAttribute("aria-label", `${text}。${title}`);
      this.status.setAttribute("aria-pressed", String(locked));
      this.status.classList.toggle("is-locked", locked);
    }
    for (const button of [this.ribbon, ...this.actions.values()]) {
      if (!button) continue;
      setIcon(button, icon);
      button.setAttribute("aria-label", `${text}。${title}`);
      button.setAttribute("aria-pressed", String(locked));
      button.classList.toggle("is-active", locked);
    }
    if (this.continuousStatus) {
      this.continuousStatus.textContent = this.text.continuous;
      this.continuousStatus.setAttribute("title", this.text.continuousTitle);
      this.continuousStatus.setAttribute("aria-label", this.text.continuousTitle);
      this.continuousStatus.setAttribute("aria-pressed", String(continuous));
      this.continuousStatus.classList.toggle("is-locked", continuous);
    }
    for (const button of [this.continuousRibbon, ...this.continuousActions.values()]) {
      if (!button) continue;
      button.setAttribute("aria-label", this.text.continuousTitle);
      button.setAttribute("aria-pressed", String(continuous));
      button.classList.toggle("is-active", continuous);
    }
  }

  onunload() {
    this.loaded = false;
    this.session?.dispose();
    this.session = null;
    for (const button of this.actions.values()) button.remove();
    this.actions.clear();
    for (const button of this.continuousActions.values()) button.remove();
    this.continuousActions.clear();
  }
};

// Also exposed for regression tests; Obsidian loads the default class above.
module.exports.RelativeScrollSession = RelativeScrollSession;
module.exports.ContinuousScrollSession = ContinuousScrollSession;
