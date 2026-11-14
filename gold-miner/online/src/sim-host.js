'use strict';
// Runs the game script of index.html (the <script id="gm-main"> block, unchanged) inside node:vm, one context per room.
// The page's DOM is replaced by a small fake: every canvas method is a no-op, requestAnimationFrame never calls back,
// so nothing is drawn; the room drives the game only through window.__game.net.
const fs = require('fs');
const vm = require('vm');

function extractScript(html) {
  const m = /<script id="gm-main">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('GAME_HTML has no <script id="gm-main"> block');
  return m[1];
}

// ---- the fake browser
function fakeCtx2d() {
  const grad = { addColorStop() {} };
  const fns = {
    measureText: s => ({ width: String(s).length * 10 }),
    createLinearGradient: () => grad, createRadialGradient: () => grad, createPattern: () => null,
    getImageData: () => ({ data: new Uint8ClampedArray(4) }), isPointInPath: () => false,
  };
  return new Proxy({}, {
    get(t, k) { if (k in t) return t[k]; if (k in fns) return fns[k]; return () => {}; },
    set(t, k, v) { t[k] = v; return true; },
  });
}
function fakeElement(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), style: {}, width: 300, height: 150, className: '', textContent: '', innerHTML: '', children: [],
    getContext: () => fakeCtx2d(), addEventListener() {}, removeEventListener() {}, appendChild(c) { this.children.push(c); return c; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720 }), focus() {}, blur() {}, setAttribute() {},
  };
  return el;
}
function makeSandbox(scriptText, opts) {
  const els = { c: fakeElement('canvas'), safe: fakeElement('div'), rot: fakeElement('div'), 'gm-main': Object.assign(fakeElement('script'), { textContent: scriptText }) };
  const store = new Map();
  const sb = {
    console: { log() {}, warn() {}, error: (...a) => opts.onError && opts.onError(a.join(' ')), info() {} },
    location: { search: '?touch=0' + (opts.fast ? '&fast=1' : ''), hash: '', protocol: 'vm:', host: '', href: 'vm://game/index.html', pathname: '/index.html', origin: 'vm://game', reload() {} },
    document: {
      getElementById: id => els[id] || null, createElement: tag => fakeElement(tag), addEventListener() {}, removeEventListener() {},
      documentElement: {}, body: fakeElement('body'), hidden: false, fullscreenElement: null, createRange: () => ({ selectNodeContents() {} }),
    },
    navigator: { maxTouchPoints: 0, userAgent: 'goldminer-online-sim', clipboard: null },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: k => { store.delete(k); } },
    matchMedia: () => ({ matches: false }),
    getComputedStyle: () => ({ paddingLeft: '0px', paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px' }),
    history: { replaceState() {} },
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, screen: {},
    addEventListener() {}, removeEventListener() {}, getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    performance: { now: () => performance.now() },
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id), setInterval: () => 0, clearInterval() {},
    WebSocket: undefined, AudioContext: undefined,
  };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  return sb;
}

// One compiled script, many contexts.  createGame() returns { ctx, g (window.__game), net, G, build }.
class SimHost {
  constructor(gameHtmlPath, opts = {}) {
    this.path = gameHtmlPath;
    this.opts = opts;
    this.html = fs.readFileSync(gameHtmlPath, 'utf8');
    this.scriptText = extractScript(this.html);
    this.script = new vm.Script(this.scriptText, { filename: 'index.html#gm-main' });
    this.build = null;
  }
  createGame(extra = {}) {
    const sb = makeSandbox(this.scriptText, Object.assign({}, this.opts, extra));
    const ctx = vm.createContext(sb);
    this.script.runInContext(ctx);
    const g = sb.__game;
    if (!g || !g.net) throw new Error('game script did not expose __game.net');
    g.net.host();
    this.build = g.net.build;
    return { ctx, sb, g, net: g.net, G: g.G, build: g.net.build };
  }
}
// JSON round trip: values leave the vm realm as plain objects of this realm
const plain = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

module.exports = { SimHost, extractScript, plain };
