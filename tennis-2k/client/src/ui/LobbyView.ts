import {
  ARCHETYPES,
  COURTS,
  type AIDifficulty,
  type ArchetypeId,
  type CourtId,
  type MatchConfig,
  type MatchFormat,
  type PlayerIndex,
} from '@court2k/shared';

export interface LobbyState {
  tab: 'single' | 'online';
  court: CourtId;
  archetype: ArchetypeId;
  format: MatchFormat;
  aiDifficulty: AIDifficulty;
  onlineRoomCode: string | null;
  onlinePlayerIndex: PlayerIndex | null;
  onlineConnected: [boolean, boolean];
  onlineReady: [boolean, boolean];
  onlineConfig: MatchConfig | null;
  wsConnected: boolean;
}

export interface LobbyCallbacks {
  onSelectTab: (tab: 'single' | 'online') => void;
  onSelectCourt: (court: CourtId) => void;
  onSelectArchetype: (arch: ArchetypeId) => void;
  onSelectFormat: (fmt: MatchFormat) => void;
  onSelectDifficulty: (diff: AIDifficulty) => void;
  onStartSingle: () => void;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onToggleReady: () => void;
  onLeaveRoom: () => void;
  onToggleMute: () => void;
}

const HEADGEAR_TEXT: Record<string, string> = {
  headband: '白头带 · 宽肩重炮型',
  wristband_only: '双护腕 · 均衡标准型',
  visor: '运动遮阳帽 · 复古全白',
  cap_backwards: '反戴鸭舌帽 · 敏捷修长',
};

export class LobbyView {
  private readonly root: HTMLElement;
  private readonly cb: LobbyCallbacks;
  private joinCodeDraft = '';

  constructor(container: HTMLElement, cb: LobbyCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'lobby-shell interactive';
    container.appendChild(this.root);
    this.cb = cb;
  }

  public setVisible(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  public render(state: LobbyState, muted: boolean): void {
    const activeCourt = state.onlineConfig ? state.onlineConfig.court : state.court;
    const activeFormat = state.onlineConfig ? state.onlineConfig.format : state.format;
    const isHost = state.onlinePlayerIndex === 0;
    const inRoom = state.onlineRoomCode !== null;
    const lockHostFields = state.tab === 'online' && inRoom && !isHost;

    const courtCards = (Object.keys(COURTS) as CourtId[])
      .map((id) => {
        const c = COURTS[id];
        const sel = activeCourt === id ? 'selected' : '';
        const disabled = lockHostFields ? 'disabled' : '';
        return `
          <button type="button" class="choice-card ${sel}" data-court="${id}" ${disabled}>
            <div class="choice-title">
              <span>${c.label.split(' · ')[0]}</span>
              <span class="swatch-dot" style="background:${c.innerColor}"></span>
            </div>
            <div class="choice-sub">${c.label.split(' · ')[1] ?? ''}</div>
          </button>`;
      })
      .join('');

    const archCards = (Object.keys(ARCHETYPES) as ArchetypeId[])
      .map((id) => {
        const a = ARCHETYPES[id];
        const sel = state.archetype === id ? 'selected' : '';
        return `
          <button type="button" class="choice-card ${sel}" data-arch="${id}">
            <div class="choice-title">
              <span>${a.label}</span>
              <span class="swatch-dot" style="background:${a.jerseyPrimary}"></span>
            </div>
            <div class="choice-sub">${HEADGEAR_TEXT[a.headgear] ?? ''}</div>
            <div class="stat-pills">
              <span class="stat-pill">POW ${a.power}</span>
              <span class="stat-pill">SPD ${a.speed}</span>
              <span class="stat-pill">SPN ${a.spin}</span>
              <span class="stat-pill">TIM ${a.timing}</span>
              <span class="stat-pill">NET ${a.net}</span>
            </div>
          </button>`;
      })
      .join('');

    const singleControls = `
      <div class="row-split">
        <div>
          <div class="section-label">赛制</div>
          <div class="pill-group">
            <button type="button" class="pill-btn ${state.format === 'fast4' ? 'selected' : ''}" data-format="fast4">Fast4 (默认)</button>
            <button type="button" class="pill-btn ${state.format === 'super_tiebreak' ? 'selected' : ''}" data-format="super_tiebreak">超级抢十</button>
          </div>
        </div>
        <div>
          <div class="section-label">AI 难度</div>
          <div class="pill-group">
            <button type="button" class="pill-btn ${state.aiDifficulty === 'rookie' ? 'selected' : ''}" data-diff="rookie">新手</button>
            <button type="button" class="pill-btn ${state.aiDifficulty === 'pro' ? 'selected' : ''}" data-diff="pro">进阶</button>
            <button type="button" class="pill-btn ${state.aiDifficulty === 'legend' ? 'selected' : ''}" data-diff="legend">大师</button>
          </div>
        </div>
      </div>
      <button type="button" class="primary-btn" id="btn-start-single">开始比赛</button>
    `;

    const myReady = state.onlinePlayerIndex !== null ? state.onlineReady[state.onlinePlayerIndex] : false;
    const onlineControls = !inRoom
      ? `
        <div>
          <div class="section-label">赛制</div>
          <div class="pill-group">
            <button type="button" class="pill-btn ${state.format === 'fast4' ? 'selected' : ''}" data-format="fast4">Fast4 (默认)</button>
            <button type="button" class="pill-btn ${state.format === 'super_tiebreak' ? 'selected' : ''}" data-format="super_tiebreak">超级抢十</button>
          </div>
        </div>
        <div class="online-box">
          <button type="button" class="primary-btn" id="btn-create-room">创建 4 位码房间</button>
          <div class="join-row">
            <input type="text" maxlength="4" class="room-input" id="input-room-code" placeholder="4位码" value="${this.joinCodeDraft}" />
            <button type="button" class="secondary-btn" id="btn-join-room">加入房间</button>
          </div>
        </div>
      `
      : `
        <div>
          <div class="section-label">赛制 ${lockHostFields ? '(房主控制)' : ''}</div>
          <div class="pill-group">
            <button type="button" class="pill-btn ${activeFormat === 'fast4' ? 'selected' : ''}" data-format="fast4" ${lockHostFields ? 'disabled' : ''}>Fast4</button>
            <button type="button" class="pill-btn ${activeFormat === 'super_tiebreak' ? 'selected' : ''}" data-format="super_tiebreak" ${lockHostFields ? 'disabled' : ''}>超级抢十</button>
          </div>
        </div>
        <div class="room-status-card">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-size:11px;color:var(--muted);">房间号（发给好友加入）</div>
              <div class="room-code-big">${state.onlineRoomCode}</div>
            </div>
            <button type="button" class="secondary-btn" id="btn-leave-room">离开房间</button>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:12px;">
            <span>P0 房主: ${state.onlineConnected[0] ? (state.onlineReady[0] ? '✅ 已准备' : '🟢 在线') : '⚪ 空位'}</span>
            <span>P1 客场: ${state.onlineConnected[1] ? (state.onlineReady[1] ? '✅ 已准备' : '🟢 在线') : '⚪ 等待加入'}</span>
          </div>
          <button type="button" class="primary-btn" id="btn-toggle-ready">${myReady ? '取消准备' : '准备开赛 (READY)'}</button>
        </div>
      `;

    const selArch = ARCHETYPES[state.archetype];
    const selCourt = COURTS[activeCourt];

    this.root.innerHTML = `
      <div class="lobby-header">
        <div class="brand-title">
          <span class="brand-badge">COURT 2K · GRAND SLAM ERA</span>
          <h1>Court 2K：大满贯时代</h1>
          <p>60Hz 确定性物理 · 2K 绿条甜区 · Takeover 火热槽 · 鹰眼特写</p>
        </div>
        <button type="button" class="hud-btn" id="btn-lobby-mute">${muted ? '🔇 音效已关' : '🔊 音效开启'}</button>
      </div>

      <div class="lobby-body">
        <div class="lobby-panel">
          <div class="mode-tabs">
            <button type="button" class="tab-btn ${state.tab === 'single' ? 'active' : ''}" data-tab="single">单人对战 (VS AI)</button>
            <button type="button" class="tab-btn ${state.tab === 'online' ? 'active' : ''}" data-tab="online">1v1 联机大厅</button>
          </div>

          <div>
            <div class="section-label">大满贯球场 ${lockHostFields ? '(由房主选择)' : ''}</div>
            <div class="card-grid-3">${courtCards}</div>
          </div>

          <div>
            <div class="section-label">MyPLAYER 流派（五维总分 400）</div>
            <div class="card-grid-4">${archCards}</div>
          </div>

          ${state.tab === 'single' ? singleControls : onlineControls}
        </div>

        <div class="lobby-preview-badge">
          <div class="section-label">实时 3D 预览</div>
          <div style="font-size:15px;font-weight:800;margin-bottom:4px;">${selArch.label} · ${selCourt.label}</div>
          <div style="font-size:12px;color:var(--muted);line-height:1.45;">
            弹跳: Y ${selCourt.restitutionY} / XZ ${selCourt.retentionXZ}<br/>
            ${HEADGEAR_TEXT[selArch.headgear]}
          </div>
        </div>
      </div>

      <div class="lobby-footer">
        <div>
          操控：<span class="kbd">WASD</span> / <span class="kbd">方向键</span> 移动与瞄准 ·
          <span class="kbd">J</span> 主攻/一发 ·
          <span class="kbd">K</span> 切削/二发 ·
          <span class="kbd">W+K</span> 放小球 ·
          <span class="kbd">L</span> 挑高 ·
          <span class="kbd">Esc</span> 暂停
        </div>
        <div>按住 J/K/L 蓄力，绿区松手触发 2K Perfect 爆击</div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
      btn.onclick = () => this.cb.onSelectTab(btn.dataset.tab as 'single' | 'online');
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-court]').forEach((btn) => {
      btn.onclick = () => this.cb.onSelectCourt(btn.dataset.court as CourtId);
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-arch]').forEach((btn) => {
      btn.onclick = () => this.cb.onSelectArchetype(btn.dataset.arch as ArchetypeId);
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-format]').forEach((btn) => {
      btn.onclick = () => this.cb.onSelectFormat(btn.dataset.format as MatchFormat);
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach((btn) => {
      btn.onclick = () => this.cb.onSelectDifficulty(btn.dataset.diff as AIDifficulty);
    });

    const startSingle = this.root.querySelector<HTMLButtonElement>('#btn-start-single');
    if (startSingle) startSingle.onclick = () => this.cb.onStartSingle();

    const createRoom = this.root.querySelector<HTMLButtonElement>('#btn-create-room');
    if (createRoom) createRoom.onclick = () => this.cb.onCreateRoom();

    const codeInput = this.root.querySelector<HTMLInputElement>('#input-room-code');
    if (codeInput) {
      codeInput.oninput = () => {
        this.joinCodeDraft = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
        codeInput.value = this.joinCodeDraft;
      };
      codeInput.onkeydown = (e) => {
        if (e.key === 'Enter' && this.joinCodeDraft.length === 4) {
          this.cb.onJoinRoom(this.joinCodeDraft);
        }
      };
    }

    const joinRoom = this.root.querySelector<HTMLButtonElement>('#btn-join-room');
    if (joinRoom) {
      joinRoom.onclick = () => {
        const val = (codeInput?.value ?? this.joinCodeDraft).trim().toUpperCase();
        this.joinCodeDraft = val;
        this.cb.onJoinRoom(val);
      };
    }

    const readyBtn = this.root.querySelector<HTMLButtonElement>('#btn-toggle-ready');
    if (readyBtn) readyBtn.onclick = () => this.cb.onToggleReady();

    const leaveBtn = this.root.querySelector<HTMLButtonElement>('#btn-leave-room');
    if (leaveBtn) leaveBtn.onclick = () => this.cb.onLeaveRoom();

    const muteBtn = this.root.querySelector<HTMLButtonElement>('#btn-lobby-mute');
    if (muteBtn) muteBtn.onclick = () => this.cb.onToggleMute();
  }
}
