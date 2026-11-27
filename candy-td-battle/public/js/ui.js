import {
  BUFF_TILE_DEFS,
  CANVAS_WIDTH,
  CREEP_DEFS,
  DEMOLISH_COST,
  ECO_PERIOD_TICKS,
  GRID_COLS,
  GRID_ROWS,
  MAP_ORDER,
  MAX_MAIN_WAVES,
  SELL_REFUND_RATE,
  SEND_DEFS,
  SEND_ORDER,
  TARGETING_LABELS,
  TICK_RATE,
  TOWER_DEFS,
  TOWER_ORDER,
  cellToPixel,
  getMapDef,
  getTowerLevelDef
} from './shared/constants.js';

const OBSTACLE_ICONS = {
  lollipop: '🍭',
  cake: '🍰',
  pudding: '🍮',
  cotton: '☁️'
};

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
    this.selectedObstacle = null;
    this.selectedMapId = 'random';
    this.tooltipVisible = false;
    this.helpOpen = false;

    this.$ = (id) => document.getElementById(id);
    this._cacheElements();
    this._hudCache = {};
    this._popoverState = {
      key: null,
      targeting: null,
      canAfford: null,
      canAffordA: null,
      canAffordB: null,
      refund: null,
      left: null,
      top: null
    };
    this._obsState = { key: null, canAfford: null, left: null, top: null };
    this._buildMapPickers();
    this._buildActionCards();
    this._buildHelpCodex();
    this._bindEvents();
    this._syncMuteIcon();
  }

  _cacheElements() {
    this.elTopBar = this.$('top-bar');
    this.elBottomConsole = this.$('bottom-console');
    this.elPeekRight = this.$('peek-zone-right');
    this.elPeekLeft = this.$('peek-zone-left');
    this.elPeekBanner = this.$('peek-banner');
    this.elExpressBanner = this.$('incoming-express-banner');
    this.elOvertimeBanner = this.$('overtime-banner');
    this.elOvertimeWaveNum = this.$('overtime-wave-num');
    this.elOutgoingPill = this.$('outgoing-express-pill');
    this.elTowerPopover = this.$('tower-popover');
    this.elObstaclePopover = this.$('obstacle-popover');
    this.elOpponentTowerCard = this.$('opponent-tower-card');
    this.elActionTooltip = this.$('action-tooltip');
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

    // Cached HUD refs (avoid 20Hz getElementById)
    this.elHudMapName = this.$('hud-map-name');
    this.elHudSelfHp = this.$('hud-self-hp');
    this.elHudSelfGold = this.$('hud-self-gold');
    this.elHudSelfEco = this.$('hud-self-eco');
    this.elHudEcoBar = this.$('hud-eco-bar');
    this.elHudWavePill = this.$('hud-wave-pill');
    this.elHudWaveText = this.$('hud-wave-text');
    this.elHudOppName = this.$('hud-opp-name');
    this.elHudOppHp = this.$('hud-opp-hp');
    this.elHudOppEco = this.$('hud-opp-eco');
    this.elHudOppAlertLamp = this.$('hud-opp-alert-lamp');

    // Cached Tower Popover refs
    this.elTpTitle = this.$('tp-title');
    this.elTpBuffBadge = this.$('tp-buff-badge');
    this.elTpStats = this.$('tp-stats');
    this.elTpTgtBtns = Array.from(this.elTowerPopover.querySelectorAll('.tgt-btn'));
    this.elTpUpgradeSingle = this.$('tp-upgrade-single');
    this.elTpBranchGrid = this.$('tp-branch-grid');
    this.elTpUpgrade = this.$('tp-upgrade');
    this.elTpBranchA = this.$('tp-branch-a');
    this.elTpBranchAName = this.$('tp-branch-a-name');
    this.elTpBranchACost = this.$('tp-branch-a-cost');
    this.elTpBranchADesc = this.$('tp-branch-a-desc');
    this.elTpBranchB = this.$('tp-branch-b');
    this.elTpBranchBName = this.$('tp-branch-b-name');
    this.elTpBranchBCost = this.$('tp-branch-b-cost');
    this.elTpBranchBDesc = this.$('tp-branch-b-desc');
    this.elTpSell = this.$('tp-sell');

    // Cached Obstacle Popover refs
    this.elOpTitle = this.$('op-title');
    this.elOpBuffPreview = this.$('op-buff-preview');
    this.elOpDemolish = this.$('op-demolish');
  }

  _renderMiniMapSvg(mapId) {
    const mapDef = getMapDef(mapId);
    const pts = mapDef.waypoints
      .map(([c, r]) => {
        const x = ((c + 0.5) / GRID_COLS) * 74;
        const y = ((r + 0.5) / GRID_ROWS) * 38;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    const obsDots = mapDef.obstacles
      .map((o) => {
        const x = ((o.col + 0.5) / GRID_COLS) * 74;
        const y = ((o.row + 0.5) / GRID_ROWS) * 38;
        const col = BUFF_TILE_DEFS[o.buff]?.borderColor || '#FF6B8B';
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2" fill="${col}" />`;
      })
      .join('');
    return `<svg viewBox="0 0 74 38" width="74" height="38" aria-hidden="true">
      <polyline points="${pts}" fill="none" stroke="#E9C99B" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
      <polyline points="${pts}" fill="none" stroke="#FFF6DF" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" />
      ${obsDots}
    </svg>`;
  }

  _buildMapPickers() {
    const renderGrid = (container, onPick) => {
      container.innerHTML = '';
      const options = [{ id: 'random', name: '随机地图', desc: '每局随机抽取 8 张风味糖果路线之一' }, ...MAP_ORDER.map((id) => getMapDef(id))];
      for (const opt of options) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'map-card';
        btn.dataset.mapId = opt.id;
        btn.innerHTML = `
          <div class="map-thumb">${opt.id === 'random' ? '🎲' : this._renderMiniMapSvg(opt.id)}</div>
          <span class="map-card-name">${opt.name}</span>
        `;
        btn.addEventListener('click', () => onPick(opt.id));
        container.appendChild(btn);
      }
    };

    renderGrid(this.$('lobby-map-picker'), (mapId) => {
      this.selectedMapId = mapId;
      this._syncMapPickerUI();
    });

    renderGrid(this.$('room-map-picker'), (mapId) => {
      if (!this.roomState || this.roomState.hostSlot !== this.roomState.playerSlot) return;
      this.callbacks.onSelectMap(mapId);
    });

    this._syncMapPickerUI();
  }

  _syncMapPickerUI() {
    const lobbyDesc = this.$('lobby-map-desc');
    const pickedLobby = this.selectedMapId === 'random' ? null : getMapDef(this.selectedMapId);
    lobbyDesc.textContent = pickedLobby
      ? `${pickedLobby.styleTag} — ${pickedLobby.desc}`
      : '每局随机抽取 8 张风味糖果路线之一（再来一局重新抽取）';

    this.$('lobby-map-picker').querySelectorAll('.map-card').forEach((btn) => {
      btn.classList.toggle('selected', btn.dataset.mapId === this.selectedMapId);
    });

    if (this.roomState) {
      const sel = this.roomState.mapSelection || 'random';
      const isHost = this.roomState.hostSlot === this.roomState.playerSlot;
      const roomHint = this.$('room-map-hint');
      const mapName = sel === 'random' ? '🎲 随机地图' : getMapDef(sel).name;
      roomHint.textContent = isHost
        ? `当前：${mapName}（点击可切换）`
        : `当前：${mapName}（仅房主可切换）`;

      this.$('room-map-picker').querySelectorAll('.map-card').forEach((btn) => {
        btn.classList.toggle('selected', btn.dataset.mapId === sel);
        btn.disabled = !isHost;
      });
    }
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
        if (this.renderer.viewMode === 'opponent') {
          this.callbacks.onReturnSelfView();
        }
        this.callbacks.onSelectBuild(this.selectedBuildType === type ? null : type);
      });
      btn.addEventListener('mouseenter', () => this._showTowerTooltip(type, btn));
      btn.addEventListener('mouseleave', () => this._hideTooltip());
      towerContainer.appendChild(btn);
      this.towerButtons[type] = btn;
    }

    const sendContainer = this.$('send-cards');
    sendContainer.innerHTML = '';
    this.sendButtons = {};

    for (const type of SEND_ORDER) {
      const def = SEND_DEFS[type];
      const btn = document.createElement('button');
      btn.className = 'action-card send-dark';
      btn.dataset.sendType = type;
      btn.innerHTML = `
        <span class="card-hotkey">${def.hotkey}</span>
        <span class="card-dot" style="background:#1F122B;border:2px solid ${def.color}">${def.icon}</span>
        <span class="card-name">${def.shortName}</span>
        <span class="card-meta">$${def.cost} <span class="card-eco-tag">+${def.eco}Eco</span></span>
        <span class="card-cooldown-mask hidden">0s</span>
      `;
      btn.addEventListener('click', () => {
        this.audio.unlock();
        this.callbacks.onSendWave(type);
      });
      btn.addEventListener('mouseenter', () => this._showSendTooltip(type, btn));
      btn.addEventListener('mouseleave', () => this._hideTooltip());
      sendContainer.appendChild(btn);
      this.sendButtons[type] = { btn, mask: btn.querySelector('.card-cooldown-mask') };
    }
  }

  _positionTooltipAboveButton(btn) {
    const stageRect = document.getElementById('stage').getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const scale = stageRect.width / CANVAS_WIDTH || 1;
    const centerX = (btnRect.left + btnRect.width / 2 - stageRect.left) / scale;
    const tooltipW = 310;
    const left = Math.max(12, Math.min(CANVAS_WIDTH - tooltipW - 12, centerX - tooltipW / 2));
    this.elActionTooltip.style.left = `${left}px`;
  }

  _showTowerTooltip(type, btn) {
    const def = TOWER_DEFS[type];
    const lv1 = def.levels[0];
    const brA = def.branches.A;
    const brB = def.branches.B;
    this.elActionTooltip.innerHTML = `
      <div class="at-head">
        <span class="at-title">${def.name}（$${lv1.cost}）</span>
        <span class="at-badge">${def.role}</span>
      </div>
      <div class="at-stats">Lv1: 射程 ${lv1.range} · 攻速 ${lv1.rate}/s · 伤害 ${lv1.damage}</div>
      <div class="at-desc">${lv1.desc}</div>
      <div class="at-sub">
        <b>Lv3 分支 A</b> ${brA.icon} ${brA.name}：${brA.desc}<br/>
        <b>Lv3 分支 B</b> ${brB.icon} ${brB.name}：${brB.desc}
      </div>
    `;
    this._positionTooltipAboveButton(btn);
    this.elActionTooltip.classList.remove('hidden');
    this.tooltipVisible = true;
  }

  _showSendTooltip(type, btn) {
    const def = SEND_DEFS[type];
    const cdSec = (def.cooldownTicks / TICK_RATE).toFixed(1);
    const channelLabel = def.isExpress ? '🚚 3s 快递预警' : '⚡ 常规即时';
    this.elActionTooltip.innerHTML = `
      <div class="at-head">
        <span class="at-title">${def.icon} ${def.name}</span>
        <span class="at-badge">${channelLabel}</span>
      </div>
      <div class="at-stats">费用 $${def.cost} · +${def.eco} Eco/6s · 冷却 ${cdSec}s · 防卫赏金 $0</div>
      <div class="at-desc">${def.desc}</div>
      <div class="at-sub">所有暗袭部队血量随当前自然波次同步成长，击杀不给对手金币。</div>
    `;
    this._positionTooltipAboveButton(btn);
    this.elActionTooltip.classList.remove('hidden');
    this.tooltipVisible = true;
  }

  _hideTooltip() {
    this.elActionTooltip.classList.add('hidden');
    this.tooltipVisible = false;
  }

  _buildHelpCodex() {
    this.$('help-tab-rules').innerHTML = `
      <ul class="help-list">
        <li><b>$190 四塔开荒与 Lv3 双分支</b>：开局资金 $190（推荐 🍓 草莓 $80 + 🍨 薄荷 $100 起手）；塔升至 Lv2 后可 2 选 1 转职为专属 <b>Lv3 分支 A / B</b>，出售返还 <b>70%</b> 累计投入。</li>
        <li><b>明牌增益障碍物拆迁（$60）</b>：每张地图有 4 个带角落增益徽章（🎯射程 / ⚡攻速 / 🔥伤害 / 💰掉金）的甜品障碍物，点击即可预览解锁增益并花 $60 拆除，拆后永久保留。</li>
        <li><b>暗黑霓虹突袭（Q/W/E/R/T）</b>：向对手派怪可永久提升每 6 秒发薪的 Eco，且暗袭部队<b>防卫赏金恒为 $0</b>（绝不送钱）；<code>R/T</code> 发出后会触发 3 秒快递车与图标预警。</li>
        <li><b>对称锁定视角切换</b>：移入最右侧胶囊或按 <code>Space</code> 锁定进入对手视角（可悬停查看对手塔只读属性，点击棋盘 0 误建）；移入最左侧胶囊 / 再按 <code>Space</code> / <code>Esc</code> / <code>1-4</code> 平滑回防。</li>
      </ul>
    `;

    const towerCardsHtml = TOWER_ORDER.map((type) => {
      const def = TOWER_DEFS[type];
      const lv1 = def.levels[0];
      const brA = def.branches.A;
      const brB = def.branches.B;
      return `
        <div class="codex-item">
          <div class="codex-item-head"><span>${def.name} (${def.hotkey})</span><span>$${lv1.cost}</span></div>
          <div><b>定位</b>：${def.role} · 默认索敌：${TARGETING_LABELS[def.defaultTargeting]}</div>
          <div><b>Lv1</b>：射程 ${lv1.range} · 攻速 ${lv1.rate}/s · 伤 ${lv1.damage}</div>
          <div><b>A ${brA.icon} ${brA.name}</b>：${brA.desc}</div>
          <div><b>B ${brB.icon} ${brB.name}</b>：${brB.desc}</div>
        </div>
      `;
    }).join('');
    this.$('help-tab-towers').innerHTML = `<div class="codex-grid">${towerCardsHtml}</div>`;

    const naturalIds = ['jelly', 'gummy_pack', 'toffee', 'macaron_stack', 'giant_cake'];
    const darkIds = ['dark_pop', 'neon_dasher', 'shield_choco', 'dark_healer', 'iron_titan'];
    const creepHints = {
      jelly: '无甲基础怪，草莓/爆米花轻松清理',
      gummy_pack: '高速轻甲怪，推荐薄荷减速 + 爆米花',
      toffee: '硬甲单位，非破甲塔仅 0.55~0.65×，需柠檬狙或草莓-B碎甲',
      macaron_stack: 'HP<50% 破壳提速至 96，推荐薄荷减速+柠檬点杀',
      giant_cake: 'W10/W15 Boss，高血硬甲，薄荷易伤+柠檬-B斩杀狙主克',
      dark_pop: '人海冲锋，推荐焦糖爆米花 AOE 清场',
      neon_dasher: '前 30% 路程免控免减速，后段减速减半，需中后段薄荷+草莓补刀',
      shield_choco: '8 层次数盾完克单发高伤柠檬，需草莓高频破盾',
      dark_healer: 'Boss · 每 1s 半径 135px 群体回血 6%（含自然怪），切「血厚」柠檬集火',
      iron_titan: 'Boss · 重甲 0.5× + 6 盾 + 50% 减速抗性，需薄荷易伤+草莓破盾+柠檬集火'
    };

    const renderCreepCard = (id, isDark) => {
      const c = CREEP_DEFS[id];
      return `
        <div class="codex-item ${isDark ? 'dark' : ''}">
          <div class="codex-item-head">
            <span>${c.name}${c.isBoss ? ' 👑Boss' : ''}</span>
            <span>${isDark ? '赏金 $0' : `赏金 $${c.naturalBounty}`}</span>
          </div>
          <div>基础HP ${c.hp} · 速 ${c.speed} · 扣血 ❤️${c.leakDamage}${c.heavyArmor ? ' · 重甲' : c.armored ? ' · 硬甲' : ''}${c.shieldHits ? ` · ${c.shieldHits}层盾` : ''}</div>
          <div><b>克制/机制</b>：${creepHints[id]}</div>
        </div>
      `;
    };

    this.$('help-tab-creeps').innerHTML = `
      <div class="codex-group-title">🍬 系统自然波怪（5 种 · 马卡龙亮色 · 击杀掉金币）</div>
      <div class="codex-grid">${naturalIds.map((id) => renderCreepCard(id, false)).join('')}</div>
      <div class="codex-group-title">👾 玩家暗袭特种部队（5 种 · 深紫黑霓虹 · 随波次成长 · $0 赏金防互刷）</div>
      <div class="codex-grid">${darkIds.map((id) => renderCreepCard(id, true)).join('')}</div>
    `;
  }

  _bindEvents() {
    this.$('btn-create-pvp').addEventListener('click', () => {
      this.audio.unlock();
      this.callbacks.onCreateRoom({
        mode: 'pvp',
        nickname: this.getNickname(),
        mapId: this.selectedMapId
      });
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
        nickname: this.getNickname(),
        mapId: this.selectedMapId
      });
    });

    this.$('btn-ai-clever').addEventListener('click', () => {
      this.audio.unlock();
      this.callbacks.onCreateRoom({
        mode: 'ai',
        aiDifficulty: 'clever',
        nickname: this.getNickname(),
        mapId: this.selectedMapId
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
      this.toggleHelp();
    });

    this.$('btn-close-help').addEventListener('click', () => {
      this.closeHelp();
    });

    this.elHelpOverlay.addEventListener('click', (e) => {
      if (e.target === this.elHelpOverlay) {
        this.closeHelp();
      }
    });

    this.elHelpOverlay.querySelectorAll('.help-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.helpTab;
        this.elHelpOverlay.querySelectorAll('.help-tab-btn').forEach((b) => {
          b.classList.toggle('active', b.dataset.helpTab === tab);
        });
        for (const key of ['rules', 'towers', 'creeps']) {
          this.$(`help-tab-${key}`).classList.toggle('hidden', key !== tab);
        }
      });
    });

    this.$('tp-close').addEventListener('click', () => {
      this.callbacks.onSelectTower(null);
    });

    this.$('tp-upgrade').addEventListener('click', () => {
      if (this.renderer.isPeekingProtected() || !this.selectedTowerId) return;
      this.callbacks.onUpgradeTower(this.selectedTowerId, null);
    });

    this.$('tp-branch-a').addEventListener('click', () => {
      if (this.renderer.isPeekingProtected() || !this.selectedTowerId) return;
      this.callbacks.onUpgradeTower(this.selectedTowerId, 'A');
    });

    this.$('tp-branch-b').addEventListener('click', () => {
      if (this.renderer.isPeekingProtected() || !this.selectedTowerId) return;
      this.callbacks.onUpgradeTower(this.selectedTowerId, 'B');
    });

    this.$('tp-sell').addEventListener('click', () => {
      if (this.renderer.isPeekingProtected() || !this.selectedTowerId) return;
      if (this.callbacks.onSellTower) {
        const sent = this.callbacks.onSellTower(this.selectedTowerId);
        if (sent !== false) this.callbacks.onSelectTower(null);
      } else {
        this.net.send({ type: 'sell_tower', towerId: this.selectedTowerId });
        this.callbacks.onSelectTower(null);
      }
    });

    this.elTowerPopover.querySelectorAll('.tgt-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.renderer.isPeekingProtected() || !this.selectedTowerId) return;
        if (this.callbacks.onSetTargeting) {
          this.callbacks.onSetTargeting(this.selectedTowerId, btn.dataset.target);
        } else {
          this.net.send({
            type: 'set_targeting',
            towerId: this.selectedTowerId,
            targeting: btn.dataset.target
          });
        }
      });
    });

    this.$('op-close').addEventListener('click', () => {
      this.callbacks.onSelectObstacle(null);
    });

    this.$('op-demolish').addEventListener('click', () => {
      if (this.renderer.isPeekingProtected() || !this.selectedObstacle) return;
      const sent = this.callbacks.onDemolishObstacle(this.selectedObstacle.col, this.selectedObstacle.row);
      if (sent !== false) {
        this.callbacks.onSelectObstacle(null);
      }
    });
  }

  toggleHelp() {
    if (this.helpOpen) this.closeHelp();
    else this.openHelp();
  }

  openHelp() {
    this.elHelpOverlay.classList.remove('hidden');
    this.helpOpen = true;
  }

  closeHelp() {
    this.elHelpOverlay.classList.add('hidden');
    this.helpOpen = false;
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

  setViewMode(mode) {
    const isOpp = mode === 'opponent';
    document.getElementById('stage')?.setAttribute('data-peeking', isOpp ? '1' : '0');
    this.elPeekBanner.classList.toggle('hidden', !isOpp);
    if (this.roomState?.phase === 'PLAYING') {
      this.elPeekRight.classList.toggle('hidden', isOpp);
      this.elPeekLeft.classList.toggle('hidden', !isOpp);
    } else {
      this.elPeekRight.classList.add('hidden');
      this.elPeekLeft.classList.add('hidden');
    }
    if (isOpp) {
      this.selectedTowerId = null;
      this.selectedObstacle = null;
      this._resetPopoverCache();
      this._obsState = { key: null, canAfford: null, left: null, top: null };
      this.renderer.selectedTowerId = null;
      this.renderer.selectedObstacleKey = null;
      this.elTowerPopover.classList.add('hidden');
      this.elObstaclePopover.classList.add('hidden');
    } else {
      this.elOpponentTowerCard.classList.add('hidden');
    }
  }

  showOpponentTowerCard(tower, pt) {
    if (!tower || !pt || this.renderer.viewMode !== 'opponent') {
      this.elOpponentTowerCard.classList.add('hidden');
      return;
    }
    const def = TOWER_DEFS[tower.type];
    const lvDef = getTowerLevelDef(tower.type, tower.level, tower.branch);
    const buff = tower.buffTile ? BUFF_TILE_DEFS[tower.buffTile] : null;
    const effRange = Math.round(lvDef.range * (tower.buffTile === 'range' ? 1.2 : 1));
    const effRate = (lvDef.rate * (tower.buffTile === 'rate' ? 1.2 : 1)).toFixed(2);
    const effDmg = Math.round(lvDef.damage * (tower.buffTile === 'damage' ? 1.15 : 1));
    const branchLabel = tower.level === 3 && tower.branch ? ` · ${lvDef.icon}${lvDef.shortName}` : '';
    this.elOpponentTowerCard.innerHTML = `
      <div class="otc-title">
        <span>${def.name} Lv.${tower.level}${branchLabel}</span>
        <span class="otc-ro">只读</span>
      </div>
      <div>射程 ${effRange} · 攻速 ${effRate}/s · 伤 ${effDmg}</div>
      <div>索敌：${TARGETING_LABELS[tower.targeting] || '最前'}${buff ? ` · ${buff.icon} ${buff.name}` : ''}</div>
    `;
    const left = Math.min(CANVAS_WIDTH - 230, Math.max(76, pt.x + 18));
    const top = Math.min(480, Math.max(66, pt.y - 34));
    this.elOpponentTowerCard.style.left = `${left}px`;
    this.elOpponentTowerCard.style.top = `${top}px`;
    this.elOpponentTowerCard.classList.remove('hidden');
  }

  resetForNewMatch() {
    this.selectedBuildType = null;
    this.selectedTowerId = null;
    this.selectedObstacle = null;
    this._hudCache = {};
    this._resetPopoverCache();
    this._obsState = { key: null, canAfford: null, left: null, top: null };
    this.setSelectedBuild(null);
    this.setSelectedTower(null);
    this.setSelectedObstacle(null);
    this.elExpressBanner.classList.add('hidden');
    this.elOvertimeBanner.classList.add('hidden');
    this.elOutgoingPill.classList.add('hidden');
    this.elTowerPopover.classList.add('hidden');
    this.elObstaclePopover.classList.add('hidden');
    this.elOpponentTowerCard.classList.add('hidden');
    this._hideTooltip();
    this.$('rematch-status').textContent = '';
    this.elHudOppAlertLamp.textContent = '🚚 待命';
    this.elHudOppAlertLamp.classList.remove('active');
    this.setViewMode('self');
  }

  _resetPopoverCache() {
    this._popoverState = {
      key: null,
      targeting: null,
      canAfford: null,
      canAffordA: null,
      canAffordB: null,
      refund: null,
      left: null,
      top: null
    };
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
      this._resetPopoverCache();
      this.elTowerPopover.classList.add('hidden');
      return;
    }
    this.setSelectedObstacle(null);
    this._renderTowerPopover(tower);
  }

  setSelectedObstacle(obs) {
    this.selectedObstacle = obs || null;
    if (!obs) {
      this._obsState = { key: null, canAfford: null, left: null, top: null };
      this.elObstaclePopover.classList.add('hidden');
      return;
    }
    this.setSelectedTower(null);
    this._renderObstaclePopover(obs);
  }

  _renderObstaclePopover(obs) {
    if (this.renderer.isPeekingProtected()) {
      this.elObstaclePopover.classList.add('hidden');
      return;
    }
    const obsKey = `${obs.col},${obs.row}`;
    const gold = this.snapshot?.self?.gold || 0;
    const canAfford = gold >= DEMOLISH_COST;

    if (this._obsState.key !== obsKey) {
      this._obsState.key = obsKey;
      const bDef = BUFF_TILE_DEFS[obs.buff];
      const icon = OBSTACLE_ICONS[obs.kind] || '🍬';
      this.elOpTitle.textContent = `${icon} ${obs.label}`;
      this.elOpBuffPreview.textContent = `解锁：${bDef.icon} ${bDef.name}（${bDef.desc}）`;
      this.elOpDemolish.textContent = `💰 拆迁 $${DEMOLISH_COST}`;

      const pos = cellToPixel(obs.col, obs.row);
      const left = Math.min(CANVAS_WIDTH - 290, Math.max(104, pos.x + 34));
      const top = Math.min(430, Math.max(66, pos.y - 68));
      if (this._obsState.left !== left) {
        this._obsState.left = left;
        this.elObstaclePopover.style.left = `${left}px`;
      }
      if (this._obsState.top !== top) {
        this._obsState.top = top;
        this.elObstaclePopover.style.top = `${top}px`;
      }
    }

    if (this._obsState.canAfford !== canAfford) {
      this._obsState.canAfford = canAfford;
      this.elOpDemolish.disabled = !canAfford;
    }
    if (this.elObstaclePopover.classList.contains('hidden')) {
      this.elObstaclePopover.classList.remove('hidden');
    }
  }

  _renderTowerPopover(tower) {
    if (this.renderer.isPeekingProtected()) {
      this.elTowerPopover.classList.add('hidden');
      return;
    }

    const def = TOWER_DEFS[tower.type];
    const popoverKey = `${tower.id}:${tower.type}:${tower.level}:${tower.branch || ''}`;
    const structureChanged = this._popoverState.key !== popoverKey;

    if (structureChanged) {
      this._popoverState.key = popoverKey;
      const lv = getTowerLevelDef(tower.type, tower.level, tower.branch);
      const buff = tower.buffTile ? BUFF_TILE_DEFS[tower.buffTile] : null;
      const effRange = Math.round(lv.range * (tower.buffTile === 'range' ? 1.2 : 1));
      const effRate = (lv.rate * (tower.buffTile === 'rate' ? 1.2 : 1)).toFixed(2);
      const effDmg = Math.round(lv.damage * (tower.buffTile === 'damage' ? 1.15 : 1));

      const branchTag = tower.level === 3 && tower.branch ? ` · ${lv.icon}${lv.shortName}` : '';
      this.elTpTitle.textContent = `${def.name} Lv.${tower.level}${branchTag}`;

      if (buff) {
        this.elTpBuffBadge.textContent = `${buff.icon} ${buff.name} (${buff.shortLabel})`;
        this.elTpBuffBadge.classList.remove('hidden');
      } else {
        this.elTpBuffBadge.classList.add('hidden');
      }

      this.elTpStats.textContent = `射程 ${effRange} · 伤 ${effDmg} · ${effRate}/s`;

      if (tower.level === 1) {
        this.elTpUpgradeSingle.classList.remove('hidden');
        this.elTpBranchGrid.classList.add('hidden');
        this.elTpUpgrade.textContent = `升级 Lv.2 $${def.levels[1].cost}`;
      } else if (tower.level === 2) {
        this.elTpUpgradeSingle.classList.add('hidden');
        this.elTpBranchGrid.classList.remove('hidden');
        const brA = def.branches.A;
        const brB = def.branches.B;
        this.elTpBranchAName.textContent = `${brA.icon} ${brA.shortName}`;
        this.elTpBranchACost.textContent = `$${brA.cost}`;
        this.elTpBranchADesc.textContent = brA.desc;
        this.elTpBranchBName.textContent = `${brB.icon} ${brB.shortName}`;
        this.elTpBranchBCost.textContent = `$${brB.cost}`;
        this.elTpBranchBDesc.textContent = brB.desc;
      } else {
        this.elTpUpgradeSingle.classList.remove('hidden');
        this.elTpBranchGrid.classList.add('hidden');
        this.elTpUpgrade.textContent = '已满级 Lv.3';
      }

      const pos = cellToPixel(tower.col, tower.row);
      const left = Math.min(CANVAS_WIDTH - 290, Math.max(104, pos.x + 34));
      const top = Math.min(410, Math.max(66, pos.y - 78));
      if (this._popoverState.left !== left) {
        this._popoverState.left = left;
        this.elTowerPopover.style.left = `${left}px`;
      }
      if (this._popoverState.top !== top) {
        this._popoverState.top = top;
        this.elTowerPopover.style.top = `${top}px`;
      }
    }

    // Lightweight state-only dirty updates (zero DOM rebuilds)
    if (structureChanged || this._popoverState.targeting !== tower.targeting) {
      this._popoverState.targeting = tower.targeting;
      for (const b of this.elTpTgtBtns) {
        b.classList.toggle('active', b.dataset.target === tower.targeting);
      }
    }

    const gold = this.snapshot?.self?.gold || 0;
    if (tower.level === 1) {
      const canAfford = gold >= def.levels[1].cost;
      if (structureChanged || this._popoverState.canAfford !== canAfford) {
        this._popoverState.canAfford = canAfford;
        this.elTpUpgrade.disabled = !canAfford;
      }
    } else if (tower.level === 2) {
      const canAffordA = gold >= def.branches.A.cost;
      const canAffordB = gold >= def.branches.B.cost;
      if (structureChanged || this._popoverState.canAffordA !== canAffordA) {
        this._popoverState.canAffordA = canAffordA;
        this.elTpBranchA.disabled = !canAffordA;
      }
      if (structureChanged || this._popoverState.canAffordB !== canAffordB) {
        this._popoverState.canAffordB = canAffordB;
        this.elTpBranchB.disabled = !canAffordB;
      }
    } else if (structureChanged || this._popoverState.canAfford !== false) {
      this._popoverState.canAfford = false;
      this.elTpUpgrade.disabled = true;
    }

    const refund = Math.round(tower.invested * SELL_REFUND_RATE);
    if (structureChanged || this._popoverState.refund !== refund) {
      this._popoverState.refund = refund;
      this.elTpSell.textContent = `出售 +$${refund}`;
    }

    if (this.elTowerPopover.classList.contains('hidden')) {
      this.elTowerPopover.classList.remove('hidden');
    }
  }

  showLobbyHome() {
    this.roomState = null;
    this.snapshot = null;
    this._hudCache = {};
    this._resetPopoverCache();
    this._obsState = { key: null, canAfford: null, left: null, top: null };
    this.elLobbyOverlay.classList.remove('hidden');
    this.elLobbyEntry.classList.remove('hidden');
    this.elLobbyRoom.classList.add('hidden');
    this.elLobbyCountdown.classList.add('hidden');
    this.elReconnectOverlay.classList.add('hidden');
    this.elResultOverlay.classList.add('hidden');
    this.elTopBar.classList.add('hidden');
    this.elBottomConsole.classList.add('hidden');
    this.elPeekRight.classList.add('hidden');
    this.elPeekLeft.classList.add('hidden');
    this.elPeekBanner.classList.add('hidden');
    this.elTowerPopover.classList.add('hidden');
    this.elObstaclePopover.classList.add('hidden');
    this.elOpponentTowerCard.classList.add('hidden');
    this.elExpressBanner.classList.add('hidden');
    this.elOvertimeBanner.classList.add('hidden');
    this._syncMapPickerUI();
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
      this._syncMapPickerUI();

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
      const mapName = state.resolvedMapId ? getMapDef(state.resolvedMapId).name : '随机地图';
      this.$('countdown-map-name').textContent = mapName;
      return;
    }

    if (phase === 'PLAYING') {
      this.elLobbyOverlay.classList.add('hidden');
      this.elReconnectOverlay.classList.add('hidden');
      this.elResultOverlay.classList.add('hidden');
      this.elTopBar.classList.remove('hidden');
      this.elBottomConsole.classList.remove('hidden');
      this.setViewMode(this.renderer.viewMode);

      if (state.resolvedMapId) {
        this.$('hud-map-name').textContent = getMapDef(state.resolvedMapId).name;
      }

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
      this.elPeekRight.classList.add('hidden');
      this.elPeekLeft.classList.add('hidden');
      this.elPeekBanner.classList.add('hidden');
      this.elTowerPopover.classList.add('hidden');
      this.elObstaclePopover.classList.add('hidden');
      this.elOpponentTowerCard.classList.add('hidden');
      this.elResultOverlay.classList.remove('hidden');
      this.$('rematch-status').textContent = '';
    }
  }

  updateSnapshot(snap) {
    this.snapshot = snap;
    const { self, opponent } = snap;
    const c = this._hudCache;

    if (snap.mapId && c.mapId !== snap.mapId) {
      c.mapId = snap.mapId;
      this.elHudMapName.textContent = getMapDef(snap.mapId).name;
    }

    if (c.selfHp !== self.hp) {
      c.selfHp = self.hp;
      this.elHudSelfHp.textContent = `${self.hp}/20`;
    }
    if (c.selfGold !== self.gold) {
      c.selfGold = self.gold;
      this.elHudSelfGold.textContent = `$${self.gold}`;
    }
    if (c.selfEco !== self.eco) {
      c.selfEco = self.eco;
      this.elHudSelfEco.textContent = `Eco +${self.eco}/6s`;
    }

    const ecoPct = Math.max(
      0,
      Math.min(100, Math.round(((ECO_PERIOD_TICKS - snap.ecoPayoutInTicks) / ECO_PERIOD_TICKS) * 100))
    );
    if (c.ecoPct !== ecoPct) {
      c.ecoPct = ecoPct;
      this.elHudEcoBar.style.width = `${ecoPct}%`;
    }

    const nextSec = Math.ceil(snap.nextWaveInTicks / TICK_RATE);
    if (c.wave !== snap.wave || c.nextSec !== nextSec) {
      c.wave = snap.wave;
      c.nextSec = nextSec;
      if (snap.wave === 0) {
        this.elHudWaveText.textContent = `开战准备 · ${nextSec}s`;
        this.elHudWavePill.classList.remove('overtime');
        this.elOvertimeBanner.classList.add('hidden');
      } else if (snap.wave <= MAX_MAIN_WAVES) {
        this.elHudWaveText.textContent = `波次 ${snap.wave}/15 · ${nextSec}s`;
        this.elHudWavePill.classList.remove('overtime');
        this.elOvertimeBanner.classList.add('hidden');
      } else {
        this.elHudWaveText.textContent = `🌈 狂暴加时 W${snap.wave} · ${nextSec}s`;
        this.elHudWavePill.classList.add('overtime');
        this.elOvertimeWaveNum.textContent = String(snap.wave);
        this.elOvertimeBanner.classList.remove('hidden');
      }
    }

    if (c.oppHp !== opponent.hp) {
      c.oppHp = opponent.hp;
      this.elHudOppHp.textContent = String(opponent.hp);
    }
    if (c.oppEco !== opponent.eco) {
      c.oppEco = opponent.eco;
      this.elHudOppEco.textContent = `+${opponent.eco}`;
    }

    const oppAlertCount = opponent.incomingAlerts ? opponent.incomingAlerts.length : 0;
    if (c.oppAlertCount !== oppAlertCount) {
      c.oppAlertCount = oppAlertCount;
      if (oppAlertCount > 0) {
        this.elHudOppAlertLamp.textContent = `🚚 来袭×${oppAlertCount}`;
        this.elHudOppAlertLamp.classList.add('active');
      } else {
        this.elHudOppAlertLamp.textContent = '🚚 待命';
        this.elHudOppAlertLamp.classList.remove('active');
      }
    }

    if (self.outgoingAlerts && self.outgoingAlerts.length > 0) {
      const a = self.outgoingAlerts[0];
      const sec = Math.max(0, (a.arriveTick - snap.tick) / TICK_RATE).toFixed(1);
      const outKey = `${a.sendType}:${sec}`;
      if (c.outKey !== outKey) {
        c.outKey = outKey;
        const label = SEND_DEFS[a.sendType]?.shortName || '快递';
        this.elOutgoingPill.textContent = `已发出: ${label} (${sec}s)`;
        this.elOutgoingPill.classList.remove('hidden');
      }
    } else if (c.outKey !== '') {
      c.outKey = '';
      this.elOutgoingPill.classList.add('hidden');
    }

    // 2A: Incoming express alert banner explicitly displays 💚 暗黑奶妈车 / 🛡️ 终极铁王八
    if (self.incomingAlerts && self.incomingAlerts.length > 0) {
      const first = self.incomingAlerts[0];
      const sec = Math.max(0, (first.arriveTick - snap.tick) / TICK_RATE).toFixed(1);
      const inKey = `${first.sendType}:${sec}:${self.incomingAlerts.length}`;
      if (c.inKey !== inKey) {
        c.inKey = inKey;
        const def = SEND_DEFS[first.sendType];
        const countSuffix = self.incomingAlerts.length > 1 ? ` · 共 ${self.incomingAlerts.length} 辆排队` : '';
        const label = def ? `${def.icon} ${def.name}` : '🚚 暗袭快递';
        this.elExpressBanner.textContent = `${label} 即将抵达！(${sec}s${countSuffix})`;
        this.elExpressBanner.classList.toggle('healer', first.sendType === 'express_healer');
        this.elExpressBanner.classList.remove('hidden');
      }
    } else if (c.inKey !== '') {
      c.inKey = '';
      this.elExpressBanner.classList.add('hidden');
    }

    if (!c.towerAfford) c.towerAfford = {};
    for (const type of TOWER_ORDER) {
      const cantAfford = self.gold < TOWER_DEFS[type].levels[0].cost;
      if (c.towerAfford[type] !== cantAfford) {
        c.towerAfford[type] = cantAfford;
        this.towerButtons[type].classList.toggle('cant-afford', cantAfford);
      }
    }

    if (!c.sendAfford) c.sendAfford = {};
    if (!c.sendCd) c.sendCd = {};
    for (const type of SEND_ORDER) {
      const { btn, mask } = this.sendButtons[type];
      const def = SEND_DEFS[type];
      const cantAfford = self.gold < def.cost;
      if (c.sendAfford[type] !== cantAfford) {
        c.sendAfford[type] = cantAfford;
        btn.classList.toggle('cant-afford', cantAfford);
      }
      const cdTicks = (self.sendCooldowns && self.sendCooldowns[type]) || 0;
      const cdText = cdTicks > 0 ? `${(cdTicks / TICK_RATE).toFixed(1)}s` : '';
      if (c.sendCd[type] !== cdText) {
        c.sendCd[type] = cdText;
        if (cdText) {
          mask.textContent = cdText;
          mask.classList.remove('hidden');
        } else {
          mask.classList.add('hidden');
        }
      }
    }

    if (this.selectedTowerId && !this.renderer.isPeekingProtected()) {
      const sel = self.towers.find((t) => t.id === this.selectedTowerId);
      if (sel) {
        this._renderTowerPopover(sel);
      } else {
        this.callbacks.onSelectTower(null);
      }
    } else if (this.selectedObstacle && !this.renderer.isPeekingProtected()) {
      const key = `${this.selectedObstacle.col},${this.selectedObstacle.row}`;
      if ((self.clearedObstacles || []).includes(key)) {
        this.callbacks.onSelectObstacle(null);
      } else {
        this._renderObstaclePopover(this.selectedObstacle);
      }
    } else if (this.renderer.isPeekingProtected()) {
      this.elTowerPopover.classList.add('hidden');
      this.elObstaclePopover.classList.add('hidden');
    }

    if (snap.phase === 'ENDED' && snap.endedResult) {
      this.renderEndedResult(snap.endedResult);
    } else {
      c.endedPhase = snap.phase;
    }
  }

  renderEndedResult(res) {
    if (!res) return;
    if (this._hudCache.endedPhase === 'ENDED') return;
    this._hudCache.endedPhase = 'ENDED';
    this._renderEndedResult(res);
  }

  _renderEndedResult(res) {
    const mySlot = this.roomState ? this.roomState.playerSlot : 0;
    const isWin = res.winnerSlot === mySlot;
    this.$('result-badge').textContent = isWin ? '🏆 甜蜜胜利！' : '🍬 惜败一局';
    this.$('result-title').textContent = isWin ? '你守住了糖果城堡！' : '糖果城堡被攻破啦！';
    const mapText = res.mapId ? ` · 地图：${getMapDef(res.mapId).name}` : '';
    this.$('result-reason').textContent =
      res.reason === 'reconnect_timeout'
        ? '对方超过 20 秒未重连，系统判定胜出'
        : `终局波次：第 ${res.wave} 波（${Math.round(res.endTick / TICK_RATE)} 秒）${mapText}`;

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
        建塔：${st.towersBuilt} · 拆迁：${st.obstaclesCleared || 0}<br/>
        击杀：${st.creepsKilled} · 派怪：${st.creepsSent}
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
      `WS KB/s: ${this.net.getWsKbps().toFixed(1)}`,
      `SkipSnap: ${this.net.skippedSnapshots || 0}`,
      `DPR: ${this.renderer.dpr}`,
      `Entities(怪/弹/粒): ${creeps}/${projs}/${parts}`
    ].join('<br/>');
  }
}
