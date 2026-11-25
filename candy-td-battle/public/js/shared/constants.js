export const CANVAS_WIDTH = 1280;
export const CANVAS_HEIGHT = 720;
export const MAX_DPR = 2;

export const TOP_BAR_HEIGHT = 56;
export const GRID_COLS = 18;
export const GRID_ROWS = 9;
export const CELL_W = 60;
export const CELL_H = 56;
export const GRID_X0 = 64;
export const GRID_Y0 = 72;
export const GRID_WIDTH = GRID_COLS * CELL_W; // 1080 -> x in [64, 1144]
export const GRID_HEIGHT = GRID_ROWS * CELL_H; // 504 -> y in [72, 576]

export const PEEK_ZONE = {
  x: 1204,
  y: 180,
  w: 72,
  h: 360
}; // 1204 - 1144 = 60px safety gap

export const PATH_WAYPOINTS = [
  [0, 2],
  [4, 2],
  [4, 6],
  [9, 6],
  [9, 1],
  [14, 1],
  [14, 5],
  [17, 5]
];

export const OBSTACLES = [
  { col: 1, row: 6, kind: 'lollipop', label: '棒棒糖树' },
  { col: 6, row: 3, kind: 'cake', label: '草莓蛋糕石' },
  { col: 11, row: 4, kind: 'pudding', label: '薄荷布丁簇' },
  { col: 16, row: 2, kind: 'cotton', label: '棉花云灌木' }
];

export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE; // 50ms

export const INITIAL_HP = 20;
export const INITIAL_GOLD = 320;
export const INITIAL_ECO = 25;
export const ECO_PERIOD_TICKS = 120; // 6.0s
export const SELL_REFUND_RATE = 0.7;

export const WAVE_START_DELAY_TICKS = 100; // 5.0s
export const WAVE_INTERVAL_TICKS = 440; // 22.0s
export const OVERTIME_INTERVAL_TICKS = 300; // 15.0s
export const MAX_MAIN_WAVES = 15;

export const EXPRESS_ALERT_TICKS = 60; // 3.0s
export const MAX_PENDING_EXPRESS = 2;

export const COUNTDOWN_SECONDS = 3;
export const RECONNECT_GRACE_MS = 20000;

export const PARTICLE_POOL_MAX = 220;
export const FLOAT_TEXT_POOL_MAX = 60;

export const PEEK_ENTER_MS = 260;
export const PEEK_EXIT_MS = 200;

export const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const TOWER_ORDER = ['strawberry', 'mint', 'popcorn', 'lemon'];
export const TARGETING_MODES = ['first', 'strong', 'close'];
export const TARGETING_LABELS = {
  first: '最前',
  strong: '血厚',
  close: '最近'
};

export const TOWER_DEFS = {
  strawberry: {
    id: 'strawberry',
    name: '草莓豆豆炮',
    shortName: '草莓炮',
    role: '单体速射',
    hotkey: '1',
    color: '#FF6B8B',
    accent: '#FFE0E8',
    defaultTargeting: 'first',
    armoredMultiplier: 0.6,
    levels: [
      { level: 1, cost: 80, totalCost: 80, range: 145, rate: 2.4, damage: 12, desc: '速射单体，对硬甲 0.6×' },
      { level: 2, cost: 75, totalCost: 155, range: 160, rate: 3.0, damage: 18, desc: '射速与射程提升' },
      { level: 3, cost: 140, totalCost: 295, range: 175, rate: 3.8, damage: 28, critEvery: 4, critMult: 1.6, desc: '每 4 发触发 1.6× 草莓暴击' }
    ]
  },
  mint: {
    id: 'mint',
    name: '薄荷冰淇淋',
    shortName: '薄荷冰',
    role: '范围减速',
    hotkey: '2',
    color: '#38C6B4',
    accent: '#D8FBF5',
    defaultTargeting: 'first',
    armoredMultiplier: 0.6,
    levels: [
      { level: 1, cost: 110, totalCost: 110, range: 135, rate: 1.0, damage: 6, splashRadius: 80, slowPct: 0.35, slowTicks: 44, vulnBonus: 0, desc: 'r=80 溅射减速 35% (2.2s)' },
      { level: 2, cost: 95, totalCost: 205, range: 150, rate: 1.0, damage: 10, splashRadius: 95, slowPct: 0.45, slowTicks: 52, vulnBonus: 0, desc: 'r=95 溅射减速 45% (2.6s)' },
      { level: 3, cost: 165, totalCost: 370, range: 165, rate: 1.0, damage: 16, splashRadius: 110, slowPct: 0.55, slowTicks: 60, vulnBonus: 0.15, desc: 'r=110 减速 55% + 他塔增伤 15%' }
    ]
  },
  popcorn: {
    id: 'popcorn',
    name: '焦糖爆米花',
    shortName: '爆米花',
    role: '群体AOE',
    hotkey: '3',
    color: '#FF944D',
    accent: '#FFF0D8',
    defaultTargeting: 'first',
    armoredMultiplier: 0.6,
    levels: [
      { level: 1, cost: 140, totalCost: 140, range: 180, rate: 0.75, damage: 26, splashRadius: 78, bounceCount: 0, bounceMult: 0, desc: '抛物线 r=78 群伤，对硬甲 0.6×' },
      { level: 2, cost: 120, totalCost: 260, range: 195, rate: 0.75, damage: 42, splashRadius: 92, bounceCount: 0, bounceMult: 0, desc: 'r=92 扩爆伤害大增' },
      { level: 3, cost: 210, totalCost: 470, range: 210, rate: 0.75, damage: 68, splashRadius: 110, bounceCount: 3, bounceMult: 0.4, desc: 'r=110 + 弹跳 3 颗 40% 小焦糖' }
    ]
  },
  lemon: {
    id: 'lemon',
    name: '柠檬破甲狙',
    shortName: '柠檬狙',
    role: '超远破甲',
    hotkey: '4',
    color: '#FFD147',
    accent: '#FFFAD6',
    defaultTargeting: 'strong',
    armoredMultiplier: 1.6,
    levels: [
      { level: 1, cost: 190, totalCost: 190, range: 290, rate: 0.55, damage: 65, armoredBonus: 1.6, pierceCount: 1, pierceMult: 0, desc: '无视硬甲，对硬甲 +60% (104伤)' },
      { level: 2, cost: 160, totalCost: 350, range: 330, rate: 0.65, damage: 105, armoredBonus: 1.8, pierceCount: 1, pierceMult: 0, desc: '对硬甲 +80% (189伤)' },
      { level: 3, cost: 260, totalCost: 610, range: 380, rate: 0.78, damage: 175, armoredBonus: 1.8, pierceCount: 2, pierceMult: 0.5, desc: '对硬甲 +80% + 穿透第2目标 50%' }
    ]
  }
};

export const CREEP_DEFS = {
  jelly: {
    id: 'jelly',
    name: 'QQ软糖怪',
    hp: 35,
    speed: 82,
    armored: false,
    leakDamage: 1,
    naturalBounty: 7,
    sendBounty: 4,
    radius: 13,
    color: '#FF6B8B'
  },
  gummy_pack: {
    id: 'gummy_pack',
    name: '泡泡糖速跑',
    hp: 42,
    speed: 122,
    armored: false,
    leakDamage: 1,
    naturalBounty: 8,
    sendBounty: 5,
    radius: 13,
    color: '#FF8AD4'
  },
  toffee: {
    id: 'toffee',
    name: '太妃硬糖块',
    hp: 145,
    speed: 64,
    armored: true,
    leakDamage: 2,
    naturalBounty: 18,
    sendBounty: 14,
    radius: 16,
    color: '#D4943A'
  },
  macaron_stack: {
    id: 'macaron_stack',
    name: '多层马卡龙',
    hp: 260,
    speed: 70,
    crackedSpeed: 96,
    armored: true,
    leakDamage: 3,
    naturalBounty: 30,
    sendBounty: 24,
    radius: 18,
    color: '#A58BF5'
  },
  giant_cake: {
    id: 'giant_cake',
    name: '婚礼蛋糕王',
    hp: 950,
    speed: 52,
    armored: true,
    leakDamage: 5,
    naturalBounty: 75,
    sendBounty: 65,
    radius: 23,
    color: '#FFFDF7'
  }
};

export const SEND_ORDER = [
  'send_jelly',
  'send_gummy',
  'send_toffee',
  'express_party',
  'express_boss',
  'express_feint'
];

export const SEND_DEFS = {
  send_jelly: {
    id: 'send_jelly',
    name: '软糖小分队',
    shortName: '软糖×4',
    hotkey: 'Q',
    cost: 50,
    eco: 5,
    cooldownTicks: 30, // 1.5s
    isExpress: false,
    isFake: false,
    spawns: [{ type: 'jelly', count: 4, intervalTicks: 9 }],
    tag: '常规Eco',
    color: '#FF6B8B'
  },
  send_gummy: {
    id: 'send_gummy',
    name: '泡泡糖冲刺',
    shortName: '泡泡×5',
    hotkey: 'W',
    cost: 90,
    eco: 8,
    cooldownTicks: 50, // 2.5s
    isExpress: false,
    isFake: false,
    spawns: [{ type: 'gummy_pack', count: 5, intervalTicks: 6 }],
    tag: '常规速攻',
    color: '#FF75C3'
  },
  send_toffee: {
    id: 'send_toffee',
    name: '太妃硬糖排',
    shortName: '硬糖×3',
    hotkey: 'E',
    cost: 140,
    eco: 11,
    cooldownTicks: 70, // 3.5s
    isExpress: false,
    isFake: false,
    spawns: [{ type: 'toffee', count: 3, intervalTicks: 13 }],
    tag: '破阵硬甲',
    color: '#D4943A'
  },
  express_party: {
    id: 'express_party',
    name: '狂欢快递箱',
    shortName: '🚚 狂欢箱',
    hotkey: 'R',
    cost: 240,
    eco: 17,
    cooldownTicks: 240, // 12s
    isExpress: true,
    isFake: false,
    spawns: [
      { type: 'macaron_stack', count: 2, intervalTicks: 7 },
      { type: 'gummy_pack', count: 6, intervalTicks: 7 }
    ],
    tag: '3s预警',
    color: '#9B72F2'
  },
  express_boss: {
    id: 'express_boss',
    name: 'Boss空投车',
    shortName: '🚚 Boss空投',
    hotkey: 'T',
    cost: 420,
    eco: 26,
    cooldownTicks: 400, // 20s
    isExpress: true,
    isFake: false,
    spawns: [
      { type: 'giant_cake', count: 1, intervalTicks: 7 },
      { type: 'toffee', count: 2, intervalTicks: 7 }
    ],
    tag: '3s预警',
    color: '#FF784E'
  },
  express_feint: {
    id: 'express_feint',
    name: '虚晃快递',
    shortName: '🎩 假动作',
    hotkey: 'F',
    cost: 65,
    eco: 5,
    cooldownTicks: 360, // 18s
    isExpress: true,
    isFake: true,
    spawns: [],
    tag: '3s空包',
    color: '#EC6FA8'
  }
};

export const NATURAL_WAVES = [
  // W1
  [{ type: 'jelly', count: 8, intervalTicks: 16 }],
  // W2
  [{ type: 'jelly', count: 10, intervalTicks: 14 }],
  // W3
  [
    { type: 'jelly', count: 6, intervalTicks: 14 },
    { type: 'gummy_pack', count: 6, intervalTicks: 12 }
  ],
  // W4
  [
    { type: 'jelly', count: 8, intervalTicks: 12 },
    { type: 'toffee', count: 1, intervalTicks: 24 }
  ],
  // W5
  [
    { type: 'gummy_pack', count: 8, intervalTicks: 10 },
    { type: 'toffee', count: 2, intervalTicks: 22 }
  ],
  // W6
  [
    { type: 'jelly', count: 10, intervalTicks: 10 },
    { type: 'toffee', count: 3, intervalTicks: 20 }
  ],
  // W7
  [
    { type: 'gummy_pack', count: 10, intervalTicks: 9 },
    { type: 'toffee', count: 4, intervalTicks: 18 }
  ],
  // W8
  [
    { type: 'gummy_pack', count: 8, intervalTicks: 9 },
    { type: 'macaron_stack', count: 2, intervalTicks: 24 }
  ],
  // W9
  [
    { type: 'toffee', count: 5, intervalTicks: 16 },
    { type: 'macaron_stack', count: 2, intervalTicks: 22 },
    { type: 'gummy_pack', count: 8, intervalTicks: 8 }
  ],
  // W10
  [
    { type: 'macaron_stack', count: 4, intervalTicks: 20 },
    { type: 'gummy_pack', count: 10, intervalTicks: 8 }
  ],
  // W11
  [
    { type: 'toffee', count: 6, intervalTicks: 14 },
    { type: 'macaron_stack', count: 4, intervalTicks: 18 },
    { type: 'gummy_pack', count: 10, intervalTicks: 7 }
  ],
  // W12
  [
    { type: 'macaron_stack', count: 6, intervalTicks: 16 },
    { type: 'gummy_pack', count: 14, intervalTicks: 7 }
  ],
  // W13
  [
    { type: 'giant_cake', count: 1, intervalTicks: 26 },
    { type: 'toffee', count: 5, intervalTicks: 14 },
    { type: 'gummy_pack', count: 10, intervalTicks: 7 }
  ],
  // W14
  [
    { type: 'giant_cake', count: 1, intervalTicks: 26 },
    { type: 'macaron_stack', count: 5, intervalTicks: 15 },
    { type: 'toffee', count: 6, intervalTicks: 12 }
  ],
  // W15
  [
    { type: 'giant_cake', count: 2, intervalTicks: 34 },
    { type: 'macaron_stack', count: 6, intervalTicks: 14 },
    { type: 'gummy_pack', count: 14, intervalTicks: 6 }
  ]
];

export function getWaveConfig(waveNum) {
  if (waveNum <= MAX_MAIN_WAVES) {
    return {
      wave: waveNum,
      isOvertime: false,
      hpScale: 1 + (waveNum - 1) * 0.08,
      speedScale: 1,
      groups: NATURAL_WAVES[waveNum - 1]
    };
  }
  const otIndex = waveNum - MAX_MAIN_WAVES; // 1 for wave 16
  const base15Scale = 1 + (MAX_MAIN_WAVES - 1) * 0.08; // 2.12
  return {
    wave: waveNum,
    isOvertime: true,
    hpScale: base15Scale * Math.pow(1.35, otIndex),
    speedScale: 1 + otIndex * 0.06,
    groups: [
      { type: 'giant_cake', count: 2 + Math.floor((otIndex - 1) / 2), intervalTicks: 24 },
      { type: 'macaron_stack', count: 6 + (otIndex - 1) * 2, intervalTicks: 11 },
      { type: 'gummy_pack', count: 12 + (otIndex - 1) * 3, intervalTicks: 5 }
    ]
  };
}

// Geometry helpers
export function cellKey(col, row) {
  return `${col},${row}`;
}

export function cellToPixel(col, row) {
  return {
    x: GRID_X0 + col * CELL_W + CELL_W / 2,
    y: GRID_Y0 + row * CELL_H + CELL_H / 2
  };
}

export function pixelToCell(x, y) {
  if (x < GRID_X0 || x >= GRID_X0 + GRID_WIDTH || y < GRID_Y0 || y >= GRID_Y0 + GRID_HEIGHT) {
    return null;
  }
  const col = Math.floor((x - GRID_X0) / CELL_W);
  const row = Math.floor((y - GRID_Y0) / CELL_H);
  if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return null;
  return { col, row };
}

export function buildPathCellSet() {
  const set = new Set();
  for (let i = 0; i < PATH_WAYPOINTS.length - 1; i++) {
    const [c1, r1] = PATH_WAYPOINTS[i];
    const [c2, r2] = PATH_WAYPOINTS[i + 1];
    const dc = Math.sign(c2 - c1);
    const dr = Math.sign(r2 - r1);
    let c = c1;
    let r = r1;
    set.add(cellKey(c, r));
    while (c !== c2 || r !== r2) {
      c += dc;
      r += dr;
      set.add(cellKey(c, r));
    }
  }
  return set;
}

export const PATH_CELL_SET = buildPathCellSet();

export const OBSTACLE_MAP = new Map(
  OBSTACLES.map((o) => [cellKey(o.col, o.row), o])
);

export function isBuildableCell(col, row) {
  if (!Number.isInteger(col) || !Number.isInteger(row)) return false;
  if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return false;
  const key = cellKey(col, row);
  return !PATH_CELL_SET.has(key) && !OBSTACLE_MAP.has(key);
}

export const PATH_POINTS_PX = PATH_WAYPOINTS.map(([c, r]) => cellToPixel(c, r));

const PATH_SEGMENTS = [];
let _totalPathLen = 0;
for (let i = 0; i < PATH_POINTS_PX.length - 1; i++) {
  const a = PATH_POINTS_PX[i];
  const b = PATH_POINTS_PX[i + 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  PATH_SEGMENTS.push({
    x1: a.x,
    y1: a.y,
    x2: b.x,
    y2: b.y,
    dx,
    dy,
    len,
    angle: Math.atan2(dy, dx),
    startDist: _totalPathLen,
    endDist: _totalPathLen + len
  });
  _totalPathLen += len;
}

export const TOTAL_PATH_LENGTH = _totalPathLen; // 1748

export function getPositionAtProgress(progress) {
  const clamped = Math.max(0, Math.min(1, progress));
  const targetDist = clamped * TOTAL_PATH_LENGTH;
  for (let i = 0; i < PATH_SEGMENTS.length; i++) {
    const seg = PATH_SEGMENTS[i];
    if (targetDist <= seg.endDist || i === PATH_SEGMENTS.length - 1) {
      const local = seg.len > 0 ? (targetDist - seg.startDist) / seg.len : 0;
      return {
        x: seg.x1 + seg.dx * local,
        y: seg.y1 + seg.dy * local,
        angle: seg.angle
      };
    }
  }
  const last = PATH_POINTS_PX[PATH_POINTS_PX.length - 1];
  return { x: last.x, y: last.y, angle: 0 };
}

export function isPointInPeekZone(x, y) {
  return (
    x >= PEEK_ZONE.x &&
    x <= PEEK_ZONE.x + PEEK_ZONE.w &&
    y >= PEEK_ZONE.y &&
    y <= PEEK_ZONE.y + PEEK_ZONE.h
  );
}
