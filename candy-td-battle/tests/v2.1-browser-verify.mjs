import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createCandyServer } from '../server/index.js';
import { CELL_H, CELL_W, GRID_X0, GRID_Y0 } from '../public/js/shared/constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const opts = {
    port: 3105,
    out: path.resolve(ROOT_DIR, 'docs/review/v2.1/evidence/round-1'),
    edge: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' && argv[i + 1]) opts.port = Number(argv[++i]);
    else if (a === '--out' && argv[i + 1]) opts.out = path.resolve(ROOT_DIR, argv[++i]);
    else if (a === '--edge' && argv[i + 1]) opts.edge = argv[++i];
  }
  return opts;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => {
      srv.close(() => resolve(true));
    });
    srv.listen(port, '127.0.0.1');
  });
}

function cellCenter(col, row) {
  return {
    x: GRID_X0 + (col + 0.5) * CELL_W,
    y: GRID_Y0 + (row + 0.5) * CELL_H
  };
}

class EdgeCdpBrowser {
  constructor(edgePath) {
    this.edgePath = edgePath;
    this.proc = null;
    this.userDataDir = null;
    this.ws = null;
    this.seq = 1;
    this.pending = new Map();
    this.consoleErrors = [];
    this.pageErrors = [];
  }

  async launch() {
    this.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'candy-td-edge-'));
    const args = [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--window-size=1280,720',
      '--remote-debugging-port=0',
      `--user-data-dir=${this.userDataDir}`,
      'about:blank'
    ];
    this.proc = spawn(this.edgePath, args, { stdio: 'ignore' });

    const portFile = path.join(this.userDataDir, 'DevToolsActivePort');
    let cdpPort = null;
    for (let i = 0; i < 60; i++) {
      try {
        const raw = await fs.readFile(portFile, 'utf8');
        const firstLine = raw.split(/\r?\n/)[0]?.trim();
        if (firstLine && Number(firstLine) > 0) {
          cdpPort = Number(firstLine);
          break;
        }
      } catch {
        // wait
      }
      await sleep(100);
    }
    if (!cdpPort) {
      throw new Error('Failed to detect Edge DevToolsActivePort');
    }

    let pageWsUrl = null;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
        const list = await res.json();
        const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page) {
          pageWsUrl = page.webSocketDebuggerUrl;
          break;
        }
      } catch {
        // wait
      }
      await sleep(100);
    }
    if (!pageWsUrl) {
      throw new Error('Failed to find Edge page target');
    }

    this.ws = new WebSocket(pageWsUrl);
    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });

    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString('utf8'));
      if (msg.id) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
          else p.resolve(msg.result);
        }
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
        this.consoleErrors.push(text);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const desc = msg.params?.exceptionDetails?.exception?.description || msg.params?.exceptionDetails?.text || 'Exception';
        this.pageErrors.push(desc);
      }
    });

    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 720,
      deviceScaleFactor: 2,
      mobile: false
    });
  }

  send(method, params = {}) {
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 15000);
      this.pending.set(id, {
        resolve: (res) => {
          clearTimeout(timer);
          resolve(res);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        }
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async goto(url) {
    await this.send('Page.navigate', { url });
    await this.waitForFn(() => document.readyState === 'complete', 10000);
    await sleep(250);
  }

  async eval(fnOrExpr, ...args) {
    const expr =
      typeof fnOrExpr === 'function'
        ? `(${fnOrExpr.toString()})(...${JSON.stringify(args)})`
        : fnOrExpr;
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true
    });
    if (res.exceptionDetails) {
      throw new Error(
        res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'Eval exception'
      );
    }
    return res.result?.value;
  }

  async waitForFn(fn, timeoutMs = 10000, pollMs = 60, ...args) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ok = await this.eval(fn, ...args);
      if (ok) return ok;
      await sleep(pollMs);
    }
    throw new Error(`waitForFn timed out after ${timeoutMs}ms`);
  }

  async clickCoords(x, y, holdMs = 30) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    if (holdMs > 0) await sleep(holdMs);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  async pressKey(key, code) {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: code || key });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: code || key });
  }

  async screenshot(filePath) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(filePath, Buffer.from(data, 'base64'));
  }

  async close() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    if (this.proc) {
      try {
        this.proc.kill('SIGKILL');
      } catch {
        // ignore
      }
      this.proc = null;
    }
    if (this.userDataDir) {
      await sleep(200);
      await fs.rm(this.userDataDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function getSelectorCenter(browser, selector) {
  return browser.eval((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await fs.mkdir(opts.out, { recursive: true });

  const testPort = opts.port;
  const prodPort = opts.port + 1;
  assert.equal(await isPortFree(testPort), true, `Port ${testPort} must be free`);
  assert.equal(await isPortFree(prodPort), true, `Port ${prodPort} must be free`);

  const testSrv = createCandyServer({ port: testPort, allowTestHooks: true });
  const prodSrv = createCandyServer({ port: prodPort, allowTestHooks: false });
  await testSrv.start();
  await prodSrv.start();

  // Allow temporary WS upgrade rejection for AC-04 disconnect verification
  let blockTestWsUpgrade = false;
  const origUpgradeListeners = testSrv.server.listeners('upgrade').slice();
  testSrv.server.removeAllListeners('upgrade');
  testSrv.server.on('upgrade', (req, socket, head) => {
    if (blockTestWsUpgrade) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }
    for (const fn of origUpgradeListeners) fn.call(testSrv.server, req, socket, head);
  });

  const browser = new EdgeCdpBrowser(opts.edge);
  const metrics = {
    port: testPort,
    prodPort,
    outDir: opts.out,
    ac01: null,
    ac02: null,
    ac04: null,
    ac05: null,
    ac08: null,
    consoleErrors: [],
    pageErrors: []
  };

  try {
    await browser.launch();

    // =========================================================================
    // AC-01: 4 towers x 2 branches (8 slow clicks 120ms on text center under 20Hz)
    // =========================================================================
    await browser.goto(`http://127.0.0.1:${testPort}/?test=1`);
    await browser.eval(() => {
      document.querySelector('#lobby-map-picker .map-card[data-map-id="classic_s"]')?.click();
      document.getElementById('btn-ai-casual')?.click();
    });
    await browser.waitForFn(() => document.getElementById('lobby-countdown') && !document.getElementById('lobby-countdown').classList.contains('hidden'));
    await browser.eval(() => window.__CANDY_TEST__.fastForwardTicks(2));
    await browser.waitForFn(() => !document.getElementById('top-bar').classList.contains('hidden'));
    await browser.eval(() => window.__CANDY_TEST__.grantResources({ target: 'self', gold: 20000, hp: 500 }));

    const towerCells = [
      { type: 'strawberry', branch: 'A', col: 2, row: 1 },
      { type: 'strawberry', branch: 'B', col: 3, row: 1 },
      { type: 'mint', branch: 'A', col: 5, row: 1 },
      { type: 'mint', branch: 'B', col: 6, row: 1 },
      { type: 'popcorn', branch: 'A', col: 7, row: 1 },
      { type: 'popcorn', branch: 'B', col: 8, row: 1 },
      { type: 'lemon', branch: 'A', col: 10, row: 2 },
      { type: 'lemon', branch: 'B', col: 11, row: 2 }
    ];

    const ac01Results = [];
    for (let idx = 0; idx < towerCells.length; idx++) {
      const tc = towerCells[idx];
      const hotIdx = ['strawberry', 'mint', 'popcorn', 'lemon'].indexOf(tc.type) + 1;
      await browser.pressKey(String(hotIdx));
      const pt = cellCenter(tc.col, tc.row);
      await browser.clickCoords(pt.x, pt.y, 20);
      await browser.waitForFn(
        (col, row) => window.__CANDY_TEST__.getSnapshot().then((s) => s.self.towers.some((t) => t.col === col && t.row === row)),
        5000,
        40,
        tc.col,
        tc.row
      );

      // Select tower to open popover and upgrade Lv1 -> Lv2
      await browser.clickCoords(pt.x, pt.y, 20);
      await browser.waitForFn(() => !document.getElementById('tower-popover').classList.contains('hidden'));
      const upgCenter = await getSelectorCenter(browser, '#tp-upgrade');
      await browser.clickCoords(upgCenter.x, upgCenter.y, 30);
      await browser.waitForFn(
        () => !document.getElementById('tp-branch-grid').classList.contains('hidden')
      );

      if (idx === 0) {
        await browser.screenshot(path.join(opts.out, 'ac01-lv2-branch-popover.png'));
      }

      // Hold mousedown for 125ms (>= 2 snapshots at 20Hz) on text center of branch button
      const btnSel = tc.branch === 'A' ? '#tp-branch-a' : '#tp-branch-b';
      const descSel = `${btnSel} .bc-desc`;
      const descCenter = await getSelectorCenter(browser, descSel);
      assert.ok(descCenter, `Missing boundingBox for ${descSel}`);

      await browser.eval((sel) => {
        window.__ac01NodeRef = document.querySelector(sel);
      }, descSel);

      await browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: descCenter.x, y: descCenter.y, button: 'none' });
      await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: descCenter.x, y: descCenter.y, button: 'left', clickCount: 1 });
      await sleep(125);
      const sameNodeAfterHold = await browser.eval((sel) => document.querySelector(sel) === window.__ac01NodeRef, descSel);
      await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: descCenter.x, y: descCenter.y, button: 'left', clickCount: 1 });

      assert.equal(sameNodeAfterHold, true, `DOM node ${descSel} was rebuilt during 125ms hold!`);

      await browser.waitForFn(
        (col, row, expectedBranch) =>
          window.__CANDY_TEST__.getSnapshot().then((s) => {
            const tw = s.self.towers.find((t) => t.col === col && t.row === row);
            return Boolean(tw && tw.level === 3 && tw.branch === expectedBranch);
          }),
        5000,
        40,
        tc.col,
        tc.row,
        tc.branch
      );

      if (idx === 0) {
        await browser.screenshot(path.join(opts.out, 'ac01-lv3-upgraded.png'));
      }

      ac01Results.push({
        type: tc.type,
        branch: tc.branch,
        sameNodeAfter125msHold: sameNodeAfterHold,
        upgraded: true
      });
    }
    metrics.ac01 = { passedCount: ac01Results.length, results: ac01Results };

    // =========================================================================
    // AC-02 & AC-05: DPR=2 W20 Dual-Side Heavy Stress + 3 Live Tower Placements
    // =========================================================================
    await browser.goto(`http://127.0.0.1:${testPort}/?netdebug=1&test=1`);
    await browser.eval(() => {
      document.querySelector('#lobby-map-picker .map-card[data-map-id="classic_s"]')?.click();
      document.getElementById('btn-ai-casual')?.click();
    });
    await browser.waitForFn(() => document.getElementById('lobby-countdown') && !document.getElementById('lobby-countdown').classList.contains('hidden'));
    await browser.eval(() => window.__CANDY_TEST__.fastForwardTicks(2));
    await browser.waitForFn(() => !document.getElementById('top-bar').classList.contains('hidden'));

    await browser.eval(async () => {
      await window.__CANDY_TEST__.grantResources({ target: 'self', gold: 10000, hp: 5000 });
      await window.__CANDY_TEST__.grantResources({ target: 'opponent', hp: 5000 });
      await window.__CANDY_TEST__.jumpWave(20);
      await window.__CANDY_TEST__.spawnStress({ towers: 25, creeps: 80, bothSides: true, oppTowers: 14, oppCreeps: 60 });
    });

    await sleep(600); // Allow FPS window (500ms) & audio/visuals to settle
    const samples = [];
    for (let i = 0; i < 20; i++) {
      await sleep(250);
      const st = await browser.eval(() => window.__CANDY_TEST__.getViewState());
      samples.push(st);
    }

    const avgFps = samples.reduce((a, s) => a + s.fps, 0) / samples.length;
    const minFps = Math.min(...samples.map((s) => s.fps));
    const maxRenderMs = Math.max(...samples.map((s) => s.renderMs));
    const avgRenderMs = samples.reduce((a, s) => a + s.renderMs, 0) / samples.length;
    const maxServerTickMs = Math.max(...samples.map((s) => s.serverTickMs));
    const maxLasers = Math.max(...samples.map((s) => s.lasers));
    const maxSplash = Math.max(...samples.map((s) => s.splashRings));
    const maxParticles = Math.max(...samples.map((s) => s.activeParticles));
    const maxFloatTexts = Math.max(...samples.map((s) => s.activeFloatTexts));
    const avgWsKbps = samples.reduce((a, s) => a + s.wsKbps, 0) / samples.length;

    const netDebugText = await browser.eval(() => document.getElementById('netdebug-panel')?.innerText || '');
    assert.ok(netDebugText.includes('WS KB/s:'), 'netdebug panel must show WS KB/s');
    assert.ok(netDebugText.includes('SkipSnap:'), 'netdebug panel must show SkipSnap');

    await browser.screenshot(path.join(opts.out, 'ac02-w20-stress-netdebug-dpr2.png'));

    // Click 3 free cells during W20 heavy combat
    const liveBuildCells = [
      { col: 17, row: 8 },
      { col: 16, row: 8 },
      { col: 15, row: 8 }
    ];
    const snapBefore3 = await browser.eval(() => window.__CANDY_TEST__.getSnapshot());
    const countBefore3 = snapBefore3.self.towers.length;
    const buildLatencies = [];
    await browser.pressKey('1');
    for (let k = 0; k < liveBuildCells.length; k++) {
      const cell = liveBuildCells[k];
      const pt = cellCenter(cell.col, cell.row);
      const t0 = Date.now();
      await browser.clickCoords(pt.x, pt.y, 20);
      await browser.waitForFn(
        (col, row) => window.__CANDY_TEST__.getSnapshot().then((s) => s.self.towers.some((t) => t.col === col && t.row === row)),
        3000,
        30,
        cell.col,
        cell.row
      );
      buildLatencies.push(Date.now() - t0);
    }

    assert.ok(avgFps >= 55, `Expected avgFps >= 55, got ${avgFps.toFixed(1)}`);
    assert.ok(avgRenderMs <= 8, `Expected avgRenderMs <= 8, got ${avgRenderMs.toFixed(2)}`);
    assert.ok(maxServerTickMs <= 8, `Expected maxServerTickMs <= 8, got ${maxServerTickMs}`);
    assert.ok(maxLasers <= 32, `lasers cap exceeded: ${maxLasers}`);
    assert.ok(maxSplash <= 40, `splashRings cap exceeded: ${maxSplash}`);
    assert.ok(maxParticles <= 220, `particles cap exceeded: ${maxParticles}`);
    assert.ok(maxFloatTexts <= 60, `floatTexts cap exceeded: ${maxFloatTexts}`);

    metrics.ac02 = {
      dpr: 2,
      avgFps: Number(avgFps.toFixed(1)),
      minFps,
      avgRenderMs: Number(avgRenderMs.toFixed(2)),
      maxRenderMs,
      maxServerTickMs,
      avgWsKbps: Number(avgWsKbps.toFixed(1)),
      towersBefore: countBefore3,
      towersPlacedLive: 3,
      buildLatenciesMs: buildLatencies,
      netDebugText
    };
    metrics.ac05 = {
      maxLasers,
      maxSplashRings: maxSplash,
      maxParticles,
      maxFloatTexts
    };

    // =========================================================================
    // AC-04: Disconnect -> non-silent offline build Toast -> auto-reconnect -> build
    // =========================================================================
    await browser.goto(`http://127.0.0.1:${testPort}/?test=1`);
    await browser.eval(() => {
      document.querySelector('#lobby-map-picker .map-card[data-map-id="classic_s"]')?.click();
      document.getElementById('btn-ai-casual')?.click();
    });
    await browser.waitForFn(() => document.getElementById('lobby-countdown') && !document.getElementById('lobby-countdown').classList.contains('hidden'));
    await browser.eval(() => window.__CANDY_TEST__.fastForwardTicks(2));
    await browser.waitForFn(() => !document.getElementById('top-bar').classList.contains('hidden'));

    // Terminate active client WS from server and temporarily block immediate reconnect for 1.2s
    blockTestWsUpgrade = true;
    for (const c of testSrv.wss.clients) {
      c.terminate();
    }
    await sleep(200);

    // Click build while disconnected -> must show clear Toast (not silent)
    await browser.pressKey('1');
    const ptOffline = cellCenter(2, 1);
    await browser.clickCoords(ptOffline.x, ptOffline.y, 20);
    await browser.waitForFn(() => {
      const toasts = Array.from(document.querySelectorAll('#toast-container .toast-item')).map((el) => el.textContent);
      return toasts.some((t) => t.includes('连接已断开'));
    }, 3000);
    const offlineToasts = await browser.eval(() =>
      Array.from(document.querySelectorAll('#toast-container .toast-item')).map((el) => el.textContent)
    );
    await browser.screenshot(path.join(opts.out, 'ac04-offline-toast.png'));

    // Unblock WS upgrade and verify exponential backoff reconnect restores PLAYING & allows building
    blockTestWsUpgrade = false;
    await browser.waitForFn(
      () => window.__CANDY_TEST__.getSnapshot().then((s) => s && s.phase === 'PLAYING').catch(() => false),
      8000,
      150
    );
    await browser.clickCoords(ptOffline.x, ptOffline.y, 20);
    await browser.waitForFn(
      () => window.__CANDY_TEST__.getSnapshot().then((s) => s.self.towers.some((t) => t.col === 2 && t.row === 1)),
      5000
    );
    await browser.screenshot(path.join(opts.out, 'ac04-reconnected.png'));
    metrics.ac04 = {
      offlineToasts,
      reconnectedAndBuilt: true
    };

    // =========================================================================
    // AC-08: Production normal entry (NO ?test=1, allowTestHooks=false)
    // =========================================================================
    await browser.goto(`http://127.0.0.1:${prodPort}/`);
    const testHookUndefined = await browser.eval(() => window.__CANDY_TEST__ === undefined);
    assert.equal(testHookUndefined, true, 'Production entry must NOT mount __CANDY_TEST__');

    await browser.eval(() => {
      document.querySelector('#lobby-map-picker .map-card[data-map-id="classic_s"]')?.click();
      document.getElementById('btn-ai-casual')?.click();
    });
    await browser.waitForFn(() => !document.getElementById('top-bar').classList.contains('hidden'), 8000);

    // Build Strawberry ($80) at (2,1), upgrade Lv1->Lv2 ($75), then wait for Eco+kills to afford $145 Lv3 branch
    await browser.pressKey('1');
    const pCell = cellCenter(2, 1);
    await browser.clickCoords(pCell.x, pCell.y, 20);
    await sleep(250);
    await browser.clickCoords(pCell.x, pCell.y, 20);
    await browser.waitForFn(() => !document.getElementById('tower-popover').classList.contains('hidden'), 3000);
    const upgBtnCenter = await getSelectorCenter(browser, '#tp-upgrade');
    await browser.clickCoords(upgBtnCenter.x, upgBtnCenter.y, 20);
    await browser.waitForFn(() => !document.getElementById('tp-branch-grid').classList.contains('hidden'), 3000);

    // Wait for gold >= $145 (starting 190 - 80 - 75 = 35; +25 eco/6s + wave 1 kills)
    await browser.waitForFn(() => {
      const btnA = document.getElementById('tp-branch-a');
      return btnA && !btnA.disabled;
    }, 22000, 200);

    const brACenter = await getSelectorCenter(browser, '#tp-branch-a .bc-desc');
    await browser.clickCoords(brACenter.x, brACenter.y, 125);
    await browser.waitForFn(() => document.getElementById('tp-title')?.textContent?.includes('Lv.3'), 3000);

    // Switch to opponent view with Space, verify peek banner, screenshot, then Space back & build Mint
    await browser.pressKey(' ', 'Space');
    await browser.waitForFn(() => document.getElementById('stage')?.getAttribute('data-peeking') === '1', 3000);
    await sleep(320);
    await browser.screenshot(path.join(opts.out, 'ac08-opp-view.png'));

    await browser.pressKey(' ', 'Space');
    await browser.waitForFn(() => document.getElementById('stage')?.getAttribute('data-peeking') === '0', 3000);
    await sleep(260);
    await browser.pressKey('2');
    const mCell = cellCenter(3, 1);
    await browser.clickCoords(mCell.x, mCell.y, 20);
    await sleep(300);
    await browser.screenshot(path.join(opts.out, 'ac08-normal-entry.png'));

    metrics.ac08 = {
      testHookUndefined,
      lv3UpgradedTitle: await browser.eval(() => document.getElementById('tp-title')?.textContent || ''),
      finalGold: await browser.eval(() => document.getElementById('hud-self-gold')?.textContent || '')
    };

    metrics.consoleErrors = browser.consoleErrors;
    metrics.pageErrors = browser.pageErrors;
    assert.equal(browser.consoleErrors.length, 0, `Console errors: ${browser.consoleErrors.join('; ')}`);
    assert.equal(browser.pageErrors.length, 0, `Page errors: ${browser.pageErrors.join('; ')}`);

    const metricsPath = path.join(opts.out, 'metrics.json');
    await fs.writeFile(metricsPath, JSON.stringify(metrics, null, 2), 'utf8');
    console.log(JSON.stringify(metrics, null, 2));
  } finally {
    await browser.close();
    await testSrv.stop();
    await prodSrv.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
