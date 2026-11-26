import {
  CANVAS_WIDTH,
  ECO_PERIOD_TICKS,
  MAX_MAIN_WAVES,
  SELL_REFUND_RATE,
  SEND_DEFS,
  SEND_ORDER,
  TICK_RATE,
  TOWER_DEFS,
  TOWER_ORDER,
  cellToPixel
} from './shared/constants.js';

export class CandyUI {
  constructor({ net, audio, renderer, callbacks }) {
    this.net = net;
    this.audio = audio;
    this.renderer = renderer;
    this.callbacks = callbacks;

    this.roomState = null;
    this.snapshot = null;
    this.selectedBuildType = null;
    this.selectedTowerId = null;

    this.$ = (id) => document.getElementById(id);
    this._cacheElements();
    this._buildActionCards();
    this._bindEvents();
    this._syncMuteIcon();
  }

  _cacheElements() {
    this.elTopBar = this.$('top-bar');
    this.elBottomConsole = this.$('bottom-console');
    this.elPeekZone = this.$('peek-zone');
    this.elPeekBanner = this.$('peek-banner');
    this.elExpressBanner = this.$('incoming-express-banner');
    this.elOvertimeBanner = this.$('overtime-banner');
    this.elOutgoingPill = this.$('outgoing-express-pill');
    this.elTowerPopover = this.$('tower-popover');
    this.elLobbyOverlay = this.$('lobby-overlay');
    this.elLobbyEntry = this.$('lobby-entry');
    this.elFileProtocolWarning = this.$('file-protocol-warning');
    this.elLobbyRoom = this.$('lobby-room');
    this.elLobbyCountdown = this.$('lobby-countdown');
    this.elReconnectOverlay = this.$('reconnect-overlay');
    this.elResultOverlay = this.$('result-overlay');
    this.elHelpOverlay = this.$('help-overlay');
    this.elNetDebug = this.$('netdebug-panel');
    this.elToastContainer = this.$('toast-container');
  }

  _buildActionCards() {
    const towerContainer = this.$('tower-cards');
    towerContainer.innerHTML = '';
    this.towerButtons = {};

    const icons = { strawberry: '🍓', mint: '🍨', popcorn: '🍿', lemon: '🍋' };
    for (const type of TOWER_ORDER) {
      const def = TOWER_DEFS[type];
      const btn = document.createElement('button');
      btn.className = 'action-card';
      btn.dataset.towerType = type;
      btn.innerHTML = `
        <span class="card-hotkey">${def.hotkey}</span>
        <span class="card-dot" style="background:${def.accent};border:2px solid ${def.color}">${icons[type]}</span>
        <span class="card-name">${def.shortName}</span>
        <span class="card-meta">$${def.levels[0].cost}</span>
      `;
      btn.addEventListener('click', () => {
        this.audio.unlock();
        this.callbacks.onSelectBuild(this.selectedBuildType === type ? null : type);
      });
      towerContainer.appendChild(btn);
      this.towerButtons[type] = btn;
    }

    const sendContainer = this.$('send-cards');
    sendContainer.innerHTML = '';
    this.sendButtons = {};

    const sendIcons = {
      send_jelly: '🍬',
      send_gummy: '🫧',
      send_toffee: '🧱',
      express_party: '🚚',
      express_boss: '🎂',
      express_feint: '🎩'
    };
    for (const type of SEND_ORDER) {
      const def = SEND_DEFS[type];
      const btn = document.createElement('button');
      btn.className = 'action-card';
      btn.dataset.sendType = type;
      btn.innerHTML = `
        <span class="card-hotkey">${def.hotkey}</span>
        <span class="card-dot" style="background:#FFF8FC;border:2px solid ${def.color}">${sendIcons[type]}</span>
        <span class="card-name">${def.shortName}</span>
        <span class="card-meta">$${def.cost} <span class="card-eco-tag">+${def.eco}Eco</span></span>
        <span class="card-cooldown-mask hidden">0s</span>
      `;
      btn.addEventListener('click', () => {
        this.audio.unlock();
        this.callbacks.onSendWave(type);
      });
      sendContainer.appendChild(btn);
      this.sendButtons[type] = { btn, mask: btn.querySelector('.card-cooldown-mask') };
    }
  }

  _bindEvents() {
    this.$('btn-create-pvp').addEventListener('click', () => {
      this.audio.unlock();
      this.callbacks.onCreateRoom({ mode: 'pvp', nickname: this.getNickname() });
    });

    this.$('btn-join-pvp').addEventListener('click', () => {
      this.audio.unlock();
      const code = this.$('input-room-code').value.trim().toUpperCase();
      if (code.length !== 4) {
        this.showToast('请输入 4 位房间码');
        return;
      }
      this.callbacks.onJoinRoom({ roomCode: code, nickname: this.getNickname() });
    });

    this.$('btn-ai-casual').addEventListener('click', () => {
      this.audio.unlock();
      this.callbacks.onCreateRoom({
        mode: 'ai',
        aiDifficulty: 'casual',
        nickname: this.getNickname()
      });
    });

    this.$('btn-ai-clever').addEventListener('click', () => {
      this.audio.unlock();
      this.callbacks.onCreateRoom({
        mode: 'ai',
        aiDifficulty: 'clever',
        nickname: this.getNickname()
      });
    });

    this.$('btn-copy-link').addEventListener('click', async () => {
      if (!this.roomState?.roomCode) return;
      const base = `${location.origin}${location.pathname}`;
      const url = `${base}?room=${this.roomState.roomCode}`;
      try {
        await navigator.clipboard.writeText(url);
        this.showToast('已复制好友邀请链接！');
      } catch {
        this.showToast(`邀请链接: ${url}`);
      }
    });

    this.$('btn-toggle-ready').addEventListener('click', () => {
      this.audio.unlock();
      if (!this.roomState) return;
      const me = this.roomState.players.find((p) => p.slot === this.roomState.playerSlot);
      this.net.send({ type: 'player_ready', ready: !(me && me.ready) });
    });

    this.$('btn-back-home').addEventListener('click', () => {
      this.callbacks.onReturnHome();
    });

    this.$('btn-rematch').addEventListener('click', () => {
      this.audio.unlock();
      this.net.send({ type: 'rematch_request' });
      this.$('rematch-status').textContent = '已发送再来一局请求，等待对方确认...';
    });

    this.$('btn-result-home').addEventListener('click', () => {
      this.callbacks.onReturnHome();
    });

    this.$('btn-mute').addEventListener('click', () => {
      this.audio.unlock();
      this.audio.toggleMute();
      this._syncMuteIcon();
    });

    this.$('btn-help').addEventListener('click', () => {
      this.elHelpOverlay.classList.remove('hidden');
    });

    this.$('btn-close-help').addEventListener('click', () => {
      this.elHelpOverlay.classList.add('hidden');
    });

    this.$('tp-close').addEventListener('click', () => {
      this.callbacks.onSelectTower(null);
    });

    this.$('tp-upgrade').addEventListener('click', () => {
      if (this.renderer.isPeekingProtected() || !this.selectedTowerId) return;
      this.net.send({ type: 'upgrade_tower', towerId: this.selectedTowerId });
    });

    this.$('tp-sell').addEventListener('click', () => {
      if (this.renderer.isPeekingProtected() || !this.selectedTowerId) return;
      this.net.send({ type: 'sell_tower', towerId: this.selectedTowerId });
      this.callbacks.onSelectTower(null);
    });

    this.elTowerPopover.querySelectorAll('.tgt-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.renderer.isPeekingProtected() || !this.selectedTowerId) return;
        this.net.send({
          type: 'set_targeting',
          towerId: this.selectedTowerId,
          targeting: btn.dataset.target
        });
      });
    });
  }

  _syncMuteIcon() {
    this.$('btn-mute').textContent = this.audio.muted ? '🔇' : '🔊';
  }

  getNickname() {
    return this.$('input-nickname').value.trim() || '草莓甜心';
  }

  prefillRoomCode(code) {
    if (code) {
      this.$('input-room-code').value = code.toUpperCase().slice(0, 4);
    }
  }

  showToast(message, durationMs = 2400) {
    const el = document.createElement('div');
    el.className = 'toast-item';
    el.textContent = message;
    this.elToastContainer.appendChild(el);
    setTimeout(() => {
      el.remove();
    }, durationMs);
  }

  setLobbyConnecting(connecting, label = '连接中...') {
    const btnIds = ['btn-create-pvp', 'btn-join-pvp', 'btn-ai-casual', 'btn-ai-clever'];
    for (const id of btnIds) {
      const btn = this.$(id);
      if (!btn) continue;
      if (!btn.dataset.defaultText) {
        btn.dataset.defaultText = btn.textContent;
      }
      btn.disabled = Boolean(connecting);
      btn.textContent = connecting ? label : btn.dataset.defaultText;
    }
  }

  showFileProtocolWarning() {
    if (this.elFileProtocolWarning) {
      this.elFileProtocolWarning.classList.remove('hidden');
    }
  }

  setPeekBanner(active) {
    document.getElementById('stage')?.setAttribute('data-peeking', active ? '1' : '0');
    if (active) {
      this.selectedTowerId = null;
      this.renderer.selectedTowerId = null;
      this.elTowerPopover.classList.add('hidden');
    }
  }

  resetForNewMatch() {
    this.selectedBuildType = null;
    this.selectedTowerId = null;
    this.setSelectedBuild(null);
    this.setSelectedTower(null);
    this.elExpressBanner.classList.add('hidden');
    this.elOvertimeBanner.classList.add('hidden');
    this.elOutgoingPill.classList.add('hidden');
    this.elTowerPopover.classList.add('hidden');
    this.$('rematch-status').textContent = '';
    const oppLamp = this.$('hud-opp-alert-lamp');
    oppLamp.textContent = '🚚 待命';
    oppLamp.classList.remove('active');
    document.getElementById('stage')?.setAttribute('data-peeking', '0');
  }

  setSelectedBuild(type) {
    this.selectedBuildType = type;
    for (const [key, btn] of Object.entries(this.towerButtons)) {
      btn.classList.toggle('selected', key === type);
    }
  }

  setSelectedTower(tower) {
    this.selectedTowerId = tower ? tower.id : null;
    if (!tower) {
      this.elTowerPopover.classList.add('hidden');
      return;
    }
    this._renderTowerPopover(tower);
  }

  _renderTowerPopover(tower) {
    if (this.renderer.isPeekingProtected()) {
      this.elTowerPopover.classList.add('hidden');
      return;
    }
    const def = TOWER_DEFS[tower.type];
    const lv = def.levels[tower.level - 1];
    this.$('tp-title').textContent = `${def.name} Lv.${tower.level}`;
    this.$('tp-stats').textContent = `射程 ${lv.range} · 伤 ${lv.damage} · ${lv.rate}/s`;

    this.elTowerPopover.querySelectorAll('.tgt-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.target === tower.targeting);
    });

    const upgBtn = this.$('tp-upgrade');
    if (tower.level >= 3) {
      upgBtn.textContent = '已满级';
      upgBtn.disabled = true;
    } else {
      const nextCost = def.levels[tower.level].cost;
      upgBtn.textContent = `升级 $${nextCost}`;
      upgBtn.disabled = (this.snapshot?.self?.gold || 0) < nextCost;
    }

    const refund = Math.round(tower.invested * SELL_REFUND_RATE);
    this.$('tp-sell').textContent = `出售 +$${refund}`;

    const pos = cellToPixel(tower.col, tower.row);
    const left = Math.min(CANVAS_WIDTH - 260, Math.max(24, pos.x + 34));
    const top = Math.min(430, Math.max(66, pos.y - 68));
    this.elTowerPopover.style.left = `${left}px`;
    this.elTowerPopover.style.top = `${top}px`;
    this.elTowerPopover.classList.remove('hidden');
  }

  showLobbyHome() {
    this.roomState = null;
    this.snapshot = null;
    this.elLobbyOverlay.classList.remove('hidden');
    this.elLobbyEntry.classList.remove('hidden');
    this.elLobbyRoom.classList.add('hidden');
    this.elLobbyCountdown.classList.add('hidden');
    this.elReconnectOverlay.classList.add('hidden');
    this.elResultOverlay.classList.add('hidden');
    this.elTopBar.classList.add('hidden');
    this.elBottomConsole.classList.add('hidden');
    this.elPeekZone.classList.add('hidden');
    this.elTowerPopover.classList.add('hidden');
    this.elExpressBanner.classList.add('hidden');
    this.elOvertimeBanner.classList.add('hidden');
  }

  updateRoomState(state) {
    this.roomState = state;
    const phase = state.phase;

    if (phase === 'LOBBY') {
      this.elLobbyOverlay.classList.remove('hidden');
      this.elLobbyEntry.classList.add('hidden');
      this.elLobbyRoom.classList.remove('hidden');
      this.elLobbyCountdown.classList.add('hidden');
      this.elReconnectOverlay.classList.add('hidden');
      this.elResultOverlay.classList.add('hidden');

      this.$('lobby-room-code').textContent = state.roomCode;
      for (const slot of [0, 1]) {
        const p = state.players.find((x) => x.slot === slot);
        const nameEl = this.$(`slot-name-${slot}`);
        const badgeEl = this.$(`slot-ready-${slot}`);
        if (p) {
          nameEl.textContent = p.nickname + (slot === state.playerSlot ? ' (我)' : '');
          badgeEl.textContent = p.ready ? '已准备' : '未准备';
          badgeEl.classList.toggle('ready', p.ready);
        } else {
          nameEl.textContent = '等待好友加入...';
          badgeEl.textContent = '空位';
          badgeEl.classList.remove('ready');
        }
      }

      const me = state.players.find((x) => x.slot === state.playerSlot);
      this.$('btn-toggle-ready').textContent = me && me.ready ? '取消准备' : '✨ 准备开战';
      return;
    }

    if (phase === 'COUNTDOWN') {
      this.elLobbyOverlay.classList.remove('hidden');
      this.elLobbyEntry.classList.add('hidden');
      this.elLobbyRoom.classList.add('hidden');
      this.elLobbyCountdown.classList.remove('hidden');
      this.elResultOverlay.classList.add('hidden');
      this.elReconnectOverlay.classList.add('hidden');
      this.$('countdown-num').textContent = String(Math.max(1, state.countdownSec || 1));
      return;
    }

    if (phase === 'PLAYING') {
      this.elLobbyOverlay.classList.add('hidden');
      this.elReconnectOverlay.classList.add('hidden');
      this.elResultOverlay.classList.add('hidden');
      this.elTopBar.classList.remove('hidden');
      this.elBottomConsole.classList.remove('hidden');
      this.elPeekZone.classList.remove('hidden');

      const opp = state.players.find((p) => p.slot !== state.playerSlot);
      if (opp) {
        this.$('hud-opp-name').textContent = opp.nickname;
      }
      return;
    }

    if (phase === 'PAUSED_RECONNECT') {
      this.elReconnectOverlay.classList.remove('hidden');
      this.$('reconnect-sec').textContent = String(state.reconnectRemainSec ?? 20);
      return;
    }

    if (phase === 'ENDED') {
      this.elReconnectOverlay.classList.add('hidden');
      this.elPeekZone.classList.add('hidden');
      this.elTowerPopover.classList.add('hidden');
      this.elResultOverlay.classList.remove('hidden');
      this.$('rematch-status').textContent = '';
    }
  }

  updateSnapshot(snap) {
    this.snapshot = snap;
    const { self, opponent } = snap;

    this.$('hud-self-hp').textContent = `${self.hp}/20`;
    this.$('hud-self-gold').textContent = `$${self.gold}`;
    this.$('hud-self-eco').textContent = `Eco +${self.eco}/6s`;

    const ecoPct = Math.round(((ECO_PERIOD_TICKS - snap.ecoPayoutInTicks) / ECO_PERIOD_TICKS) * 100);
    this.$('hud-eco-bar').style.width = `${Math.max(0, Math.min(100, ecoPct))}%`;

    const nextSec = Math.ceil(snap.nextWaveInTicks / TICK_RATE);
    const wavePill = this.$('hud-wave-pill');
    if (snap.wave === 0) {
      this.$('hud-wave-text').textContent = `开战准备 · ${nextSec}s`;
      wavePill.classList.remove('overtime');
      this.elOvertimeBanner.classList.add('hidden');
    } else if (snap.wave <= MAX_MAIN_WAVES) {
      this.$('hud-wave-text').textContent = `波次 ${snap.wave}/15 · ${nextSec}s`;
      wavePill.classList.remove('overtime');
      this.elOvertimeBanner.classList.add('hidden');
    } else {
      this.$('hud-wave-text').textContent = `🌈 狂暴加时 W${snap.wave} · ${nextSec}s`;
      wavePill.classList.add('overtime');
      this.$('overtime-wave-num').textContent = String(snap.wave);
      this.elOvertimeBanner.classList.remove('hidden');
    }

    // Opponent minimal status bar
    this.$('hud-opp-hp').textContent = String(opponent.hp);
    this.$('hud-opp-eco').textContent = `+${opponent.eco}`;
    const oppLamp = this.$('hud-opp-alert-lamp');
    if (opponent.incomingAlerts && opponent.incomingAlerts.length > 0) {
      oppLamp.textContent = `🚚 来袭×${opponent.incomingAlerts.length}`;
      oppLamp.classList.add('active');
    } else {
      oppLamp.textContent = '🚚 待命';
      oppLamp.classList.remove('active');
    }

    // Sender-only outgoing express indicator
    if (self.outgoingAlerts && self.outgoingAlerts.length > 0) {
      const a = self.outgoingAlerts[0];
      const sec = Math.max(0, (a.arriveTick - snap.tick) / TICK_RATE).toFixed(1);
      const label = SEND_DEFS[a.sendType]?.shortName || '快递';
      this.elOutgoingPill.textContent = `已发出: ${label} (${sec}s)`;
      this.elOutgoingPill.classList.remove('hidden');
    } else {
      this.elOutgoingPill.classList.add('hidden');
    }

    // Incoming express alert banner (zero fake leak!)
    if (self.incomingAlerts && self.incomingAlerts.length > 0) {
      const first = self.incomingAlerts[0];
      const sec = Math.max(0, (first.arriveTick - snap.tick) / TICK_RATE).toFixed(1);
      const countSuffix = self.incomingAlerts.length > 1 ? ` · 共 ${self.incomingAlerts.length} 辆排队` : '';
      this.elExpressBanner.textContent = `🚚 糖果快递即将送达！(${sec}s${countSuffix})`;
      this.elExpressBanner.classList.remove('hidden');
    } else {
      this.elExpressBanner.classList.add('hidden');
    }

    // Bottom tower cards affordability
    for (const type of TOWER_ORDER) {
      const btn = this.towerButtons[type];
      const cost = TOWER_DEFS[type].levels[0].cost;
      btn.classList.toggle('cant-afford', self.gold < cost);
    }

    // Bottom send cards cooldown & affordability
    for (const type of SEND_ORDER) {
      const { btn, mask } = this.sendButtons[type];
      const def = SEND_DEFS[type];
      const cdTicks = (self.sendCooldowns && self.sendCooldowns[type]) || 0;
      btn.classList.toggle('cant-afford', self.gold < def.cost);
      if (cdTicks > 0) {
        mask.textContent = `${(cdTicks / TICK_RATE).toFixed(1)}s`;
        mask.classList.remove('hidden');
      } else {
        mask.classList.add('hidden');
      }
    }

    // Refresh open tower popover (never re-open during peek!)
    if (this.selectedTowerId && !this.renderer.isPeekingProtected()) {
      const sel = self.towers.find((t) => t.id === this.selectedTowerId);
      if (sel) {
        this._renderTowerPopover(sel);
      } else {
        this.callbacks.onSelectTower(null);
      }
    } else if (this.renderer.isPeekingProtected()) {
      this.elTowerPopover.classList.add('hidden');
    }

    // Ended result modal
    if (snap.phase === 'ENDED' && snap.endedResult) {
      this._renderEndedResult(snap.endedResult);
    }
  }

  _renderEndedResult(res) {
    const mySlot = this.roomState ? this.roomState.playerSlot : 0;
    const isWin = res.winnerSlot === mySlot;
    this.$('result-badge').textContent = isWin ? '🏆 甜蜜胜利！' : '🍬 惜败一局';
    this.$('result-title').textContent = isWin ? '你守住了糖果城堡！' : '糖果城堡被攻破啦！';
    this.$('result-reason').textContent =
      res.reason === 'reconnect_timeout'
        ? '对方超过 20 秒未重连，系统判定胜出'
        : `终局波次：第 ${res.wave} 波（${Math.round(res.endTick / TICK_RATE)} 秒）`;

    const grid = this.$('result-stats-grid');
    grid.innerHTML = '';
    for (const st of res.stats) {
      const pInfo = this.roomState?.players?.find((p) => p.slot === st.slot);
      const name = pInfo ? pInfo.nickname : `玩家 ${st.slot + 1}`;
      const box = document.createElement('div');
      box.className = 'stat-box';
      box.innerHTML = `
        <strong>${name}${st.slot === mySlot ? ' (我)' : ''}</strong><br/>
        剩余生命：❤️ ${st.hp} · 最终 Eco：+${st.eco}/6s<br/>
        建塔：${st.towersBuilt} · 击杀：${st.creepsKilled}<br/>
        派怪：${st.creepsSent} · 虚晃快递：${st.feintsSent}
      `;
      grid.appendChild(box);
    }
  }

  updateNetDebug(enabled) {
    if (!enabled) {
      this.elNetDebug.classList.add('hidden');
      return;
    }
    this.elNetDebug.classList.remove('hidden');
    const snap = this.renderer.currSnapshot;
    const creeps = snap ? snap.self.creeps.length + snap.opponent.creeps.length : 0;
    const projs = snap
      ? (snap.self.projectiles?.length || 0) + (snap.opponent.projectiles?.length || 0)
      : 0;
    const parts = this.renderer.activeParticleCount;
    this.elNetDebug.innerHTML = [
      `FPS: ${this.renderer.fps}`,
      `Render: ${this.renderer.renderMs.toFixed(2)} ms`,
      `RTT: ${this.net.rttMs} ms`,
      `ServerTick: ${this.net.serverTickMs} ms`,
      `DPR: ${this.renderer.dpr}`,
      `Entities(怪/弹/粒): ${creeps}/${projs}/${parts}`
    ].join('<br/>');
  }
}
