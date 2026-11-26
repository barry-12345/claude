import {
  ARCHETYPES,
  computeStatsSummary,
  COURTS,
  type GameEvent,
  type KeyPointLabel,
  type MatchState,
  type PlayerIndex,
} from '@court2k/shared';
import type { PerfMetrics } from '../core/PerfManager.js';

export interface HudCallbacks {
  onToggleMute: () => void;
  onRequestPause: () => void;
  onRequestResume: () => void;
  onRequestRematch: () => void;
  onExitToLobby: () => void;
}

export const KEY_POINT_LABELS: Record<KeyPointLabel, string> = {
  NONE: '',
  BREAK_POINT: 'BREAK POINT · 破发点',
  DECIDING_POINT: 'DECIDING POINT · 金球决胜',
  SET_POINT: 'SET POINT · 盘点',
  MATCH_POINT: 'MATCH POINT · 赛点',
  TIEBREAK: 'TIEBREAK · 抢七局',
  SUPER_TIEBREAK: 'SUPER TIEBREAK · 超级抢十',
};

const LINE_LABELS: Record<string, string> = {
  sideline: '单打边线',
  baseline: '底线',
  service_line: '发球线',
  center_service_line: '中发球线',
};

const TENNIS_POINT_NAMES = ['0', '15', '30', '40'];

function formatPoints(pts: number, isTiebreak: boolean): string {
  if (isTiebreak) return String(pts);
  return TENNIS_POINT_NAMES[Math.min(3, pts)] ?? String(pts);
}

export function formatPostMatchScoreSummary(score: MatchState['score'], localIdx: PlayerIndex): string {
  const oppIdx = (1 - localIdx) as PlayerIndex;
  if (score.format === 'super_tiebreak') {
    return `${score.points[localIdx]} - ${score.points[oppIdx]}`;
  }
  if (score.isTiebreak) {
    return `${score.games[localIdx]} - ${score.games[oppIdx]} (${score.points[localIdx]}-${score.points[oppIdx]})`;
  }
  return `${score.games[localIdx]} - ${score.games[oppIdx]}`;
}

export class HudView {
  private readonly hudRoot: HTMLElement;
  private readonly modalRoot: HTMLElement;
  private readonly toastRoot: HTMLElement;
  private readonly netDebugEl: HTMLElement;
  private readonly cb: HudCallbacks;

  private readonly calloutEl: HTMLElement;
  private readonly scoreWrapEl: HTMLElement;
  private readonly hawkeyeBannerEl: HTMLElement;
  private readonly bottomWrapEl: HTMLElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly pauseBtn: HTMLButtonElement;

  private calloutTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastScoreKey = '';
  private lastBottomKey = '';
  private lastHawkeyeKey = '';
  private lastActionsKey = '';
  private lastModalKey = '';

  constructor(container: HTMLElement, cb: HudCallbacks, showNetDebug: boolean) {
    this.cb = cb;

    this.hudRoot = document.createElement('div');
    this.hudRoot.className = 'hud-layer hidden';
    container.appendChild(this.hudRoot);

    const topBar = document.createElement('div');
    topBar.className = 'hud-top-bar';
    this.hudRoot.appendChild(topBar);

    this.scoreWrapEl = document.createElement('div');
    topBar.appendChild(this.scoreWrapEl);

    const actions = document.createElement('div');
    actions.className = 'hud-actions';
    topBar.appendChild(actions);

    this.muteBtn = document.createElement('button');
    this.muteBtn.type = 'button';
    this.muteBtn.id = 'btn-hud-mute';
    this.muteBtn.className = 'hud-btn';
    this.muteBtn.onclick = () => this.cb.onToggleMute();
    actions.appendChild(this.muteBtn);

    this.pauseBtn = document.createElement('button');
    this.pauseBtn.type = 'button';
    this.pauseBtn.id = 'btn-hud-pause';
    this.pauseBtn.className = 'hud-btn';
    this.pauseBtn.onclick = () => this.cb.onRequestPause();
    actions.appendChild(this.pauseBtn);

    this.calloutEl = document.createElement('div');
    this.calloutEl.className = 'center-callout hidden';
    this.hudRoot.appendChild(this.calloutEl);

    this.hawkeyeBannerEl = document.createElement('div');
    this.hawkeyeBannerEl.className = 'hawkeye-banner hidden';
    this.hudRoot.appendChild(this.hawkeyeBannerEl);

    this.bottomWrapEl = document.createElement('div');
    this.bottomWrapEl.className = 'hud-bottom';
    this.hudRoot.appendChild(this.bottomWrapEl);

    this.modalRoot = document.createElement('div');
    this.modalRoot.className = 'modal-backdrop hidden';
    container.appendChild(this.modalRoot);

    this.toastRoot = document.createElement('div');
    this.toastRoot.className = 'toast-container';
    container.appendChild(this.toastRoot);

    this.netDebugEl = document.createElement('div');
    this.netDebugEl.className = showNetDebug ? 'netdebug-panel' : 'netdebug-panel hidden';
    container.appendChild(this.netDebugEl);
  }

  public setMatchVisible(visible: boolean): void {
    this.hudRoot.classList.toggle('hidden', !visible);
    if (!visible) {
      this.modalRoot.classList.add('hidden');
      this.lastModalKey = '';
      this.lastScoreKey = '';
      this.lastBottomKey = '';
      this.lastHawkeyeKey = '';
      this.lastActionsKey = '';
    }
  }

  public showToast(message: string, durationMs = 2600): void {
    const item = document.createElement('div');
    item.className = 'toast-item';
    item.textContent = message;
    this.toastRoot.appendChild(item);
    setTimeout(() => {
      item.remove();
    }, durationMs);
  }

  public handleEventCallout(ev: GameEvent, localIdx: PlayerIndex): void {
    if (ev.type === 'SHOT_HIT') {
      const cls =
        ev.quality === 'CLEAN'
          ? 'perfect'
          : ev.quality === 'STRETCH'
            ? 'warn'
            : '';
      const who = ev.hitter === localIdx ? '' : '对手 ';
      this.showCallout(`${who}${ev.quality} · ${ev.speedKmh} km/h`, cls, 1000);
    } else if (ev.type === 'NET_LET') {
      this.showCallout(ev.isServe ? 'NET LET · 重发一球' : 'NET CORD · 擦网过网', 'warn', 1100);
    } else if (ev.type === 'POINT_SCORED') {
      const reasonMap: Record<string, string> = {
        ace: 'ACE! 发球直接得分',
        winner: 'WINNER! 制胜分',
        double_bounce: 'WINNER! 对手未及回球',
        double_fault: 'DOUBLE FAULT 双误',
        out: 'OUT 出界',
        net: 'NET 挂网',
        unforced_error: '失误丢分',
      };
      const isWin = ev.winner === localIdx;
      this.showCallout(reasonMap[ev.reason] ?? '得分', isWin ? 'perfect' : 'bad', 1300);
    }
  }

  public updateMatchHud(
    state: MatchState,
    localIdx: PlayerIndex,
    muted: boolean,
    rematchRequested: [boolean, boolean],
    matchOverReason: 'normal' | 'forfeit',
    forfeitedBy?: PlayerIndex
  ): void {
    const oppIdx = (1 - localIdx) as PlayerIndex;
    const sc = state.score;
    const lp = state.players[localIdx];
    const op = state.players[oppIdx];
    const kpText = KEY_POINT_LABELS[sc.keyPointLabel];
    const isOnline = state.config.mode === 'online';
    const pausesLeft = state.pause.manualPausesLeft[localIdx];

    const oppName = isOnline
      ? `对手 (${ARCHETYPES[op.archetype].label})`
      : `AI (${ARCHETYPES[op.archetype].label})`;
    const myName = `你 (${ARCHETYPES[lp.archetype].label})`;

    // 1. Scorebug (update only on change)
    const scoreKey = `${state.config.court}:${sc.format}:${sc.serveNumber}:${sc.server}:${sc.games.join(',')}:${sc.points.join(',')}:${sc.isTiebreak}:${kpText}:${oppName}:${myName}`;
    if (scoreKey !== this.lastScoreKey) {
      this.lastScoreKey = scoreKey;
      this.scoreWrapEl.innerHTML = `
        <div class="scorebug">
          <div class="scorebug-head">
            <span>${COURTS[state.config.court].label}</span>
            <span>${sc.format === 'fast4' ? 'FAST4' : 'SUPER TB'} · ${sc.serveNumber === 1 ? '一发' : '二发'}</span>
          </div>
          <div class="scorebug-row">
            <span class="serve-dot ${sc.server === oppIdx ? 'active' : ''}"></span>
            <span>${oppName}</span>
            <span class="sb-games">${sc.games[oppIdx]}</span>
            <span class="sb-points">${formatPoints(sc.points[oppIdx], sc.isTiebreak)}</span>
          </div>
          <div class="scorebug-row">
            <span class="serve-dot ${sc.server === localIdx ? 'active' : ''}"></span>
            <span style="color:var(--gold);">${myName}</span>
            <span class="sb-games">${sc.games[localIdx]}</span>
            <span class="sb-points">${formatPoints(sc.points[localIdx], sc.isTiebreak)}</span>
          </div>
        </div>
        ${kpText ? `<div class="keypoint-banner">${kpText}</div>` : ''}
      `;
    }

    // 2. Persistent Top-Right Buttons (never detached!)
    const actionsKey = `${muted}:${isOnline}:${pausesLeft}`;
    if (actionsKey !== this.lastActionsKey) {
      this.lastActionsKey = actionsKey;
      this.muteBtn.textContent = muted ? '🔇 静音' : '🔊 音效';
      this.pauseBtn.textContent = `⏸ 暂停 (Esc)${isOnline ? ` [${pausesLeft}]` : ''}`;
    }

    // 3. Hawkeye Banner
    const hkKey =
      state.phase === 'hawkeye' && state.hawkeye.active
        ? `1:${state.hawkeye.isIn}:${state.hawkeye.lineType}:${state.hawkeye.distanceToLineCm.toFixed(1)}`
        : '0';
    if (hkKey !== this.lastHawkeyeKey) {
      this.lastHawkeyeKey = hkKey;
      if (hkKey === '0') {
        this.hawkeyeBannerEl.classList.add('hidden');
      } else {
        this.hawkeyeBannerEl.classList.remove('hidden');
        this.hawkeyeBannerEl.innerHTML = `
          <div style="font-size:11px;letter-spacing:0.12em;color:var(--cyan);font-weight:800;">HAWKEYE 3D 鹰眼挑战</div>
          <div class="hawkeye-verdict ${state.hawkeye.isIn ? 'in' : 'out'}">${state.hawkeye.isIn ? 'IN · 界内' : 'OUT · 出界'}</div>
          <div class="hawkeye-detail">${LINE_LABELS[state.hawkeye.lineType] ?? state.hawkeye.lineType} · 距线 ${state.hawkeye.distanceToLineCm.toFixed(1)} cm</div>
        `;
      }
    }

    // 4. Clean V2 Bottom Controls Hint (no Takeover bars)
    const bottomKey = `v2:${lp.stance.armedAction}`;
    if (bottomKey !== this.lastBottomKey) {
      this.lastBottomKey = bottomKey;
      const armedBadge =
        lp.stance.armedAction === 'J'
          ? '<span class="armed-pill armed-j">预选 J 强攻</span>'
          : lp.stance.armedAction === 'K'
            ? '<span class="armed-pill armed-k">预选 K 小球/削球</span>'
            : lp.stance.armedAction === 'L'
              ? '<span class="armed-pill armed-l">预选 L 挑高</span>'
              : '';
      this.bottomWrapEl.innerHTML = `
        <div class="controls-mini">
          ${armedBadge}
          <span class="kbd">WASD/方向键</span> 走位+左右 ·
          <span class="kbd">J</span> 打后强攻 ·
          <span class="kbd">K</span> 打前小球/削球 ·
          <span class="kbd">L</span> 挑高 ·
          不按键放球
        </div>
      `;
    }

    this.updateModal(state, localIdx, rematchRequested, matchOverReason, forfeitedBy);
  }

  public updateNetDebug(
    metrics: PerfMetrics,
    drawCalls: number,
    rttMs: number,
    reconnects: number,
    mode: 'lobby' | 'single' | 'online'
  ): void {
    if (this.netDebugEl.classList.contains('hidden')) return;
    this.netDebugEl.innerHTML = `
      <div><strong>NET / PERF DEBUG</strong></div>
      <div>Mode: ${mode}</div>
      <div>FPS: ${metrics.fps} | Max: ${metrics.maxFrameMs}ms</div>
      <div>Avg: ${metrics.avgFrameMs}ms | P95: ${metrics.p95FrameMs}ms</div>
      <div>Tier: ${metrics.qualityTier} (Up: ${metrics.upgradeCount}/1)</div>
      <div>ActiveDPR: ${metrics.activeDpr.toFixed(2)}</div>
      <div>DrawCalls: ${drawCalls}</div>
      <div>EstHz: ${metrics.estHz}Hz (${metrics.fpsCapEnabled ? '60fps Cap' : 'Uncapped'})</div>
      <div>RTT: ${rttMs}ms | Reconn: ${reconnects}</div>
    `;
  }

  private showCallout(text: string, variant: '' | 'perfect' | 'warn' | 'bad', ms: number): void {
    if (this.calloutTimeout) clearTimeout(this.calloutTimeout);
    this.calloutEl.className = 'center-callout';
    this.calloutEl.innerHTML = `<span class="shot-badge ${variant}">${text}</span>`;
    this.calloutTimeout = setTimeout(() => {
      this.calloutEl.classList.add('hidden');
    }, ms);
  }

  private updateModal(
    state: MatchState,
    localIdx: PlayerIndex,
    rematchRequested: [boolean, boolean],
    matchOverReason: 'normal' | 'forfeit',
    forfeitedBy?: PlayerIndex
  ): void {
    const oppIdx = (1 - localIdx) as PlayerIndex;
    const isOnline = state.config.mode === 'online';

    if (state.phase === 'paused_manual') {
      const remSec = isOnline ? Math.ceil(state.pause.remainingSec) : 0;
      const key = `pm:${remSec}:${state.pause.initiatedBy}:${state.pause.manualPausesLeft.join(',')}`;
      this.modalRoot.classList.remove('hidden');
      if (key === this.lastModalKey) return;
      this.lastModalKey = key;

      const who = state.pause.initiatedBy === localIdx ? '你' : '对手';
      this.modalRoot.innerHTML = `
        <div class="modal-card">
          <div class="modal-title">比赛已暂停</div>
          <div style="text-align:center;color:var(--muted);font-size:13px;">
            发起方：<strong>${who}</strong>${
              isOnline
                ? ` · 剩余手动暂停次数：你 ${state.pause.manualPausesLeft[localIdx]} 次 / 对手 ${state.pause.manualPausesLeft[oppIdx]} 次`
                : ' · 单机模式不限次数与时长'
            }
          </div>
          ${isOnline ? `<div class="countdown-big">${remSec}s</div>` : ''}
          <div class="modal-actions">
            <button type="button" class="primary-btn" id="btn-modal-resume">继续比赛 (Esc)</button>
            <button type="button" class="secondary-btn" id="btn-modal-exit">返回大厅</button>
          </div>
        </div>
      `;
      this.modalRoot.querySelector<HTMLButtonElement>('#btn-modal-resume')!.onclick = () =>
        this.cb.onRequestResume();
      this.modalRoot.querySelector<HTMLButtonElement>('#btn-modal-exit')!.onclick = () =>
        this.cb.onExitToLobby();
      return;
    }

    if (state.phase === 'paused_disconnect') {
      const remSec = Math.ceil(state.pause.remainingSec);
      const key = `pd:${remSec}`;
      this.modalRoot.classList.remove('hidden');
      if (key === this.lastModalKey) return;
      this.lastModalKey = key;

      this.modalRoot.innerHTML = `
        <div class="modal-card">
          <div class="modal-title" style="color:var(--gold);">对手断线重连中</div>
          <div class="countdown-big">${remSec}s</div>
          <div style="text-align:center;color:var(--muted);font-size:13px;">
            正在等待对手 15 秒内重连，超时将自动判你获胜（此期间不可提前恢复）
          </div>
          <div class="modal-actions">
            <button type="button" class="secondary-btn" style="width:100%;" id="btn-modal-exit">离开房间</button>
          </div>
        </div>
      `;
      this.modalRoot.querySelector<HTMLButtonElement>('#btn-modal-exit')!.onclick = () =>
        this.cb.onExitToLobby();
      return;
    }

    if (state.phase === 'resuming') {
      const sec = Math.max(1, Math.ceil(state.pause.resumeCountdownSec));
      const key = `res:${sec}`;
      this.modalRoot.classList.remove('hidden');
      if (key === this.lastModalKey) return;
      this.lastModalKey = key;

      this.modalRoot.innerHTML = `
        <div class="modal-card">
          <div class="modal-title">准备恢复比赛</div>
          <div class="countdown-big">${sec}</div>
          <div style="text-align:center;color:var(--muted);font-size:13px;">倒计时结束即刻恢复，请做好接球准备</div>
        </div>
      `;
      return;
    }

    if (state.phase === 'match_over') {
      const key = `mo:${state.score.winner}:${state.score.games.join(',')}:${state.score.points.join(',')}:${rematchRequested.join(',')}:${matchOverReason}`;
      this.modalRoot.classList.remove('hidden');
      if (key === this.lastModalKey) return;
      this.lastModalKey = key;

      const didWin = state.score.winner === localIdx;
      const sMy = state.stats[localIdx];
      const sOpp = state.stats[oppIdx];
      const mySum = computeStatsSummary(sMy);
      const oppSum = computeStatsSummary(sOpp);
      const scoreSummary = formatPostMatchScoreSummary(state.score, localIdx);
      const forfeitNotice =
        matchOverReason === 'forfeit'
          ? forfeitedBy === localIdx
            ? '因断线超过 15 秒判负'
            : '对手断线超过 15 秒弃权，你获得胜利！'
          : scoreSummary;

      const myRematch = rematchRequested[localIdx];
      const oppRematch = rematchRequested[oppIdx];
      const rematchLabel = isOnline
        ? myRematch
          ? oppRematch
            ? '正在开启新局...'
            : '已确认，等待对手...'
          : oppRematch
            ? '对手已邀请 · 点击再来一局'
            : '再来一局 (Rematch)'
        : '再来一局';

      this.modalRoot.innerHTML = `
        <div class="modal-card">
          <div class="modal-title" style="color:${didWin ? 'var(--green)' : 'var(--red)'};">
            ${didWin ? '🏆 胜利！MATCH WINNER' : '比赛结束 · DEFEAT'}
          </div>
          <div style="text-align:center;font-size:14px;color:var(--gold);font-weight:700;">${forfeitNotice}</div>
          <table class="stats-table">
            <thead>
              <tr><th>你</th><th>赛后统计</th><th>${isOnline ? '对手' : 'AI'}</th></tr>
            </thead>
            <tbody>
              <tr><td>${sMy.aces}</td><td>Ace 发球直接得分</td><td>${sOpp.aces}</td></tr>
              <tr><td>${sMy.doubleFaults}</td><td>双误 (Double Faults)</td><td>${sOpp.doubleFaults}</td></tr>
              <tr><td>${mySum.firstServePct}%</td><td>一发成功率</td><td>${oppSum.firstServePct}%</td></tr>
              <tr><td>${sMy.winners}</td><td>制胜分 (Winners)</td><td>${sOpp.winners}</td></tr>
              <tr><td>${sMy.unforcedErrors}</td><td>非受迫失误 (UE)</td><td>${sOpp.unforcedErrors}</td></tr>
              <tr><td>${mySum.cleanPct}%</td><td>CLEAN 甜点率</td><td>${oppSum.cleanPct}%</td></tr>
            </tbody>
          </table>
          <div class="modal-actions">
            <button type="button" class="primary-btn" id="btn-modal-rematch" ${isOnline && myRematch ? 'disabled' : ''}>${rematchLabel}</button>
            <button type="button" class="secondary-btn" id="btn-modal-exit">返回大厅</button>
          </div>
        </div>
      `;

      this.modalRoot.querySelector<HTMLButtonElement>('#btn-modal-rematch')!.onclick = () =>
        this.cb.onRequestRematch();
      this.modalRoot.querySelector<HTMLButtonElement>('#btn-modal-exit')!.onclick = () =>
        this.cb.onExitToLobby();
      return;
    }

    this.modalRoot.classList.add('hidden');
    this.lastModalKey = '';
  }
}
