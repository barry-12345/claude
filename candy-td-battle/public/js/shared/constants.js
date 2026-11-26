export const CANVAS_WIDTH = 1280;
export const CANVAS_HEIGHT = 720;
export const MAX_DPR = 2;

export const TOP_BAR_HEIGHT = 56;
export const GRID_COLS = 18;
export const GRID_ROWS = 9;
export const CELL_W = 60;
export const CELL_H = 56;
export const GRID_X0 = 100;
export const GRID_Y0 = 72;
export const GRID_WIDTH = GRID_COLS * CELL_W; // 1080 -> x in [100, 1180]
export const GRID_HEIGHT = GRID_ROWS * CELL_H; // 504 -> y in [72, 576]

// Symmetric dual-side locked view hotzones (36px safety gap on both sides)
export const PEEK_RIGHT_ZONE = {
  x: 1216,
  y: 180,
  w: 60,
  h: 360
}; // 1216 - 1180 = 36px safety gap

export const PEEK_LEFT_ZONE = {
  x: 4,
  y: 180,
  w: 60,
  h: 360
}; // 100 - 64 = 36px safety gap

export const PEEK_ZONE = PEEK_RIGHT_ZONE;
export const PEEK_SWITCH_DEBOUNCE_MS = 180;

export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE; // 50ms

export const INITIAL_HP = 20;
export const INITIAL_GOLD = 190;
export const INITIAL_ECO = 25;
export const ECO_PERIOD_TICKS = 120; // 6.0s
export const SELL_REFUND_RATE = 0.7;
export const DEMOLISH_COST = 60;

export const WAVE_START_DELAY_TICKS = 100; // 5.0s
export const WAVE_INTERVAL_TICKS = 440; // 22.0s (W1-W14)
export const OVERTIME_W15_INTERVAL_TICKS = 400; // 20.0s (W15 -> W16)
export const OVERTIME_W16_INTERVAL_TICKS = 360; // 18.0s (W16 -> W17)
export const OVERTIME_INTERVAL_TICKS = 320; // 16.0s (W17+)
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

export const BUFF_TILE_DEFS = {
  range: {
    id: 'range',
    name: '射程晶格',
    icon: '🎯',
    color: '#38B6FF',
    bgColor: 'rgba(56, 182, 255, 0.22)',
    borderColor: '#38B6FF',
    shortLabel: '+20%射程',
    desc: '射程 ×1.20（+20% 攻击距离）'
  },
  rate: {
    id: 'rate',
    name: '极速糖格',
    icon: '⚡',
    color: '#FF5D9E',
    bgColor: 'rgba(255, 93, 158, 0.22)',
    borderColor: '#FF5D9E',
    shortLabel: '+20%攻速',
    desc: '攻速 ×1.20（+20% 射击频率）'
  },
  damage: {
    id: 'damage',
    name: '烈焰糖格',
    icon: '🔥',
    color: '#FF884D',
    bgColor: 'rgba(255, 136, 77, 0.24)',
    borderColor: '#FF884D',
    shortLabel: '+15%伤害',
    desc: '伤害 ×1.15（+15% 最终伤害）'
  },
  bounty: {
    id: 'bounty',
    name: '招财金格',
    icon: '💰',
    color: '#E6A200',
    bgColor: 'rgba(255, 209, 71, 0.28)',
    borderColor: '#E6A200',
    shortLabel: '+$3/击杀',
    desc: '击杀自然怪额外掉 +$3（暗袭怪不触发）'
  }
};

export const DEFAULT_MAP_ID = 'classic_s';
export const MAP_ORDER = [
  'classic_s',
  'waffle_zig',
  'rainbow_m',
  'stair_cascade',
  'canyon_u',
  'crown_peaks',
  'horseshoe_ring',
  'cross_switch'
];

const RAW_MAP_DEFS = [
  {
    id: 'classic_s',
    name: '经典 S 弯',
    styleTag: '均衡三折蛇道',
    desc: '三段标准 S 型弯道，四塔与拆迁位均衡发挥',
    waypoints: [[0, 2], [4, 2], [4, 6], [9, 6], [9, 1], [14, 1], [14, 5], [17, 5]],
    obstacles: [
      { col: 3, row: 4, kind: 'lollipop', label: '棒棒糖树', buff: 'range' },
      { col: 6, row: 3, kind: 'cake', label: '草莓蛋糕石', buff: 'rate' },
      { col: 11, row: 4, kind: 'pudding', label: '薄荷布丁簇', buff: 'damage' },
      { col: 15, row: 3, kind: 'cotton', label: '棉花云灌木', buff: 'bounty' }
    ]
  },
  {
    id: 'waffle_zig',
    name: '华夫折返廊',
    styleTag: '超长横廊 · 利穿透',
    desc: '超长水平折返走廊，柠檬-A 穿透光束与减速核心天堂',
    waypoints: [[0, 1], [10, 1], [10, 4], [5, 4], [5, 7], [17, 7]],
    obstacles: [
      { col: 7, row: 2, kind: 'cake', label: '草莓蛋糕石', buff: 'damage' },
      { col: 8, row: 5, kind: 'lollipop', label: '棒棒糖树', buff: 'range' },
      { col: 3, row: 5, kind: 'cotton', label: '棉花云灌木', buff: 'bounty' },
      { col: 13, row: 6, kind: 'pudding', label: '薄荷布丁簇', buff: 'rate' }
    ]
  },
  {
    id: 'rainbow_m',
    name: '彩虹双拱门',
    styleTag: '对称双拱 · 利 AOE',
    desc: '双拱门高密口袋阵，焦糖爆米花与薄荷溅射收益拉满',
    waypoints: [[0, 6], [3, 6], [3, 2], [7, 2], [7, 6], [11, 6], [11, 2], [15, 2], [15, 6], [17, 6]],
    obstacles: [
      { col: 5, row: 4, kind: 'pudding', label: '薄荷布丁簇', buff: 'rate' },
      { col: 9, row: 4, kind: 'cake', label: '草莓蛋糕石', buff: 'damage' },
      { col: 13, row: 4, kind: 'lollipop', label: '棒棒糖树', buff: 'range' },
      { col: 1, row: 4, kind: 'cotton', label: '棉花云灌木', buff: 'bounty' }
    ]
  },
  {
    id: 'stair_cascade',
    name: '千层阶梯道',
    styleTag: '快节奏短图',
    desc: '1692px 紧凑阶梯短跑道，对前期防线成形要求极高',
    waypoints: [[0, 1], [3, 1], [3, 3], [6, 3], [6, 6], [10, 6], [10, 2], [14, 2], [14, 5], [17, 5]],
    obstacles: [
      { col: 5, row: 2, kind: 'cotton', label: '棉花云灌木', buff: 'bounty' },
      { col: 8, row: 4, kind: 'pudding', label: '薄荷布丁簇', buff: 'rate' },
      { col: 12, row: 4, kind: 'cake', label: '草莓蛋糕石', buff: 'damage' },
      { col: 15, row: 3, kind: 'lollipop', label: '棒棒糖树', buff: 'range' }
    ]
  },
  {
    id: 'canyon_u',
    name: '双谷夹心道',
    styleTag: '纵深竖谷 · 利辐射',
    desc: '两条纵深 U 型糖果峡谷，中路辐射格可双面输出',
    waypoints: [[0, 7], [4, 7], [4, 1], [8, 1], [8, 7], [13, 7], [13, 2], [17, 2]],
    obstacles: [
      { col: 2, row: 4, kind: 'cotton', label: '棉花云灌木', buff: 'bounty' },
      { col: 6, row: 4, kind: 'cake', label: '草莓蛋糕石', buff: 'damage' },
      { col: 10, row: 4, kind: 'pudding', label: '薄荷布丁簇', buff: 'rate' },
      { col: 15, row: 4, kind: 'lollipop', label: '棒棒糖树', buff: 'range' }
    ]
  },
  {
    id: 'crown_peaks',
    name: '奶油皇冠峰',
    styleTag: '中路高冠 · 双低谷',
    desc: '皇冠中心位可覆盖三侧折返，围绕中路拆迁博弈激烈',
    waypoints: [[0, 4], [3, 4], [3, 7], [7, 7], [7, 1], [11, 1], [11, 7], [15, 7], [15, 4], [17, 4]],
    obstacles: [
      { col: 5, row: 5, kind: 'pudding', label: '薄荷布丁簇', buff: 'rate' },
      { col: 9, row: 4, kind: 'lollipop', label: '棒棒糖树', buff: 'range' },
      { col: 13, row: 5, kind: 'cake', label: '草莓蛋糕石', buff: 'damage' },
      { col: 9, row: 6, kind: 'cotton', label: '棉花云灌木', buff: 'bounty' }
    ]
  },
  {
    id: 'horseshoe_ring',
    name: '焦糖马蹄环',
    styleTag: '双 U 凹心阵地',
    desc: '深 U 马蹄包围圈，凹心核心塔拥有超长有效停留时间',
    waypoints: [[0, 2], [3, 2], [3, 7], [8, 7], [8, 4], [11, 4], [11, 7], [15, 7], [15, 2], [17, 2]],
    obstacles: [
      { col: 5, row: 4, kind: 'cake', label: '草莓蛋糕石', buff: 'damage' },
      { col: 9, row: 2, kind: 'lollipop', label: '棒棒糖树', buff: 'range' },
      { col: 13, row: 4, kind: 'pudding', label: '薄荷布丁簇', buff: 'rate' },
      { col: 1, row: 5, kind: 'cotton', label: '棉花云灌木', buff: 'bounty' }
    ]
  },
  {
    id: 'cross_switch',
    name: '饼干折扇道',
    styleTag: '大回环折返',
    desc: '2060px 最长回环路线，前后防线分工与远程狙击体验极佳',
    waypoints: [[0, 7], [6, 7], [6, 4], [2, 4], [2, 1], [11, 1], [11, 5], [17, 5]],
    obstacles: [
      { col: 4, row: 5, kind: 'cotton', label: '棉花云灌木', buff: 'bounty' },
      { col: 8, row: 3, kind: 'lollipop', label: '棒棒糖树', buff: 'range' },
      { col: 13, row: 3, kind: 'pudding', label: '薄荷布丁簇', buff: 'rate' },
      { col: 9, row: 6, kind: 'cake', label: '草莓蛋糕石', buff: 'damage' }
    ]
  }
];

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
    role: '高频破盾 / 切精英',
    hotkey: '1',
    color: '#FF6B8B',
    accent: '#FFE0E8',
    defaultTargeting: 'first',
    armoredMultiplier: 0.65,
    levels: [
      {
        level: 1,
        cost: 80,
        totalCost: 80,
        range: 150,
        rate: 2.6,
        damage: 11,
        shieldBreak: 1,
        desc: '高频点射，每发破 1 层盾，对硬甲 0.65×'
      },
      {
        level: 2,
        cost: 75,
        totalCost: 155,
        range: 165,
        rate: 3.3,
        damage: 16,
        shieldBreak: 1,
        desc: '高频连射与极速破盾'
      }
    ],
    branches: {
      A: {
        level: 3,
        branch: 'A',
        key: 'gatling',
        name: '加特林叠伤炮',
        shortName: '加特林',
        icon: '🔥',
        cost: 145,
        totalCost: 300,
        range: 175,
        rate: 4.6,
        damage: 20,
        shieldBreak: 1,
        stackBonusPerShot: 0.10,
        maxStacks: 10,
        desc: '4.6/s 狂暴连射，连打同目标每发 +10% 伤（上限 +100%）'
      },
      B: {
        level: 3,
        branch: 'B',
        key: 'shredder',
        name: '碎糖削甲散射',
        shortName: '碎糖炮',
        icon: '💥',
        cost: 145,
        totalCost: 300,
        range: 175,
        rate: 3.6,
        damage: 22,
        shieldBreak: 1,
        splitCount: 2,
        splitMult: 0.65,
        shredTicks: 60, // 3.0s
        desc: '分裂 2 颗 65% 弹片（同破盾）+ 施加 3s 碎甲减防'
      }
    }
  },
  mint: {
    id: 'mint',
    name: '薄荷冰淇淋',
    shortName: '薄荷冰',
    role: '减速 / 乘法易伤核心',
    hotkey: '2',
    color: '#38C6B4',
    accent: '#D8FBF5',
    defaultTargeting: 'first',
    armoredMultiplier: 0.60,
    levels: [
      {
        level: 1,
        cost: 100,
        totalCost: 100,
        range: 160,
        rate: 1.0,
        damage: 6,
        splashRadius: 88,
        slowPct: 0.32,
        slowTicks: 48, // 2.4s
        vulnBonus: 0.12,
        desc: 'r=88 减速 32% + 全队易伤 +12%（2.4s）'
      },
      {
        level: 2,
        cost: 90,
        totalCost: 190,
        range: 178,
        rate: 1.1,
        damage: 10,
        splashRadius: 102,
        slowPct: 0.42,
        slowTicks: 56, // 2.8s
        vulnBonus: 0.20,
        desc: 'r=102 减速 42% + 全队易伤 +20%（2.8s）'
      }
    ],
    branches: {
      A: {
        level: 3,
        branch: 'A',
        key: 'frost_nova',
        name: '极寒冰环',
        shortName: '极寒冰',
        icon: '❄️',
        cost: 160,
        totalCost: 350,
        range: 195,
        rate: 1.15,
        damage: 14,
        splashRadius: 118,
        slowPct: 0.52,
        slowTicks: 64, // 3.2s
        vulnBonus: 0.22,
        novaEvery: 4,
        freezeTicks: 20, // 1.0s
        bossFreezeTicks: 10, // 0.5s
        freezeImmuneTicks: 50, // 2.5s
        desc: '减速 52%/易伤 +22%；每 4 发冰环冻结 1s（Boss 0.5s）'
      },
      B: {
        level: 3,
        branch: 'B',
        key: 'brittle_catalyst',
        name: '脆糖催化塔',
        shortName: '催化塔',
        icon: '💎',
        cost: 160,
        totalCost: 350,
        range: 195,
        rate: 1.15,
        damage: 15,
        splashRadius: 115,
        slowPct: 0.45,
        slowTicks: 64, // 3.2s
        vulnBonus: 0.35,
        shatterRadius: 75,
        shatterPct: 0.12,
        shatterBossCap: 120,
        desc: '全队易伤 +35% + 死亡触发 12% MaxHP 冰糖爆裂'
      }
    }
  },
  popcorn: {
    id: 'popcorn',
    name: '焦糖爆米花',
    shortName: '爆米花',
    role: '群体 AOE / 清线',
    hotkey: '3',
    color: '#FF944D',
    accent: '#FFF0D8',
    defaultTargeting: 'first',
    armoredMultiplier: 0.55,
    levels: [
      {
        level: 1,
        cost: 140,
        totalCost: 140,
        range: 180,
        rate: 0.75,
        damage: 28,
        splashRadius: 82,
        desc: '抛物线 r=82 全额群伤，对硬甲 0.55×'
      },
      {
        level: 2,
        cost: 120,
        totalCost: 260,
        range: 195,
        rate: 0.80,
        damage: 45,
        splashRadius: 96,
        desc: 'r=96 扩爆重锤群伤'
      }
    ],
    branches: {
      A: {
        level: 3,
        branch: 'A',
        key: 'caramel_lava',
        name: '焦糖岩浆池',
        shortName: '岩浆池',
        icon: '🌋',
        cost: 200,
        totalCost: 460,
        range: 210,
        rate: 0.80,
        damage: 62,
        splashRadius: 108,
        lavaDurationTicks: 70, // 3.5s
        lavaRadius: 72,
        lavaDps: 24,
        lavaMaxStacks: 2,
        desc: '落点留 3.5s 灼烧池（24/s，最多叠 2 池，穿盾 50% 伤）'
      },
      B: {
        level: 3,
        branch: 'B',
        key: 'pop_rocks',
        name: '连锁跳跳糖',
        shortName: '跳跳糖',
        icon: '🎇',
        cost: 200,
        totalCost: 460,
        range: 215,
        rate: 0.85,
        damage: 70,
        splashRadius: 112,
        bounceCount: 4,
        bounceMult: 0.45,
        bounceRadius: 55,
        desc: 'r=112 主爆 + 弹跳 4 颗 45% 伤小跳跳糖追击'
      }
    }
  },
  lemon: {
    id: 'lemon',
    name: '柠檬破甲狙',
    shortName: '柠檬狙',
    role: '超远破甲 / 点杀Boss',
    hotkey: '4',
    color: '#FFD147',
    accent: '#FFFAD6',
    defaultTargeting: 'strong',
    armoredMultiplier: 1.6,
    levels: [
      {
        level: 1,
        cost: 190,
        totalCost: 190,
        range: 300,
        rate: 0.55,
        damage: 68,
        armoredBonus: 1.6,
        shieldBreak: 1,
        desc: '瞬发激光，对硬甲/重甲 1.6×（108.8 伤）'
      },
      {
        level: 2,
        cost: 160,
        totalCost: 350,
        range: 340,
        rate: 0.65,
        damage: 110,
        armoredBonus: 1.8,
        shieldBreak: 1,
        desc: '超远视野，对硬甲/重甲 1.8×（198 伤）'
      }
    ],
    branches: {
      A: {
        level: 3,
        branch: 'A',
        key: 'rail_beam',
        name: '蓄力穿透光束',
        shortName: '穿透炮',
        icon: '⚡',
        cost: 250,
        totalCost: 600,
        range: 400,
        rate: 0.72,
        damage: 175,
        armoredBonus: 1.8,
        shieldBreak: 1,
        beamExtendPx: 180,
        beamWidth: 26,
        pierceMults: [0.85, 0.70, 0.55],
        desc: '沿射线延 180px 直线穿透最多 3 额外目标（85/70/55%）'
      },
      B: {
        level: 3,
        branch: 'B',
        key: 'executioner',
        name: '终结斩杀狙',
        shortName: '斩杀狙',
        icon: '🎯',
        cost: 250,
        totalCost: 600,
        range: 420,
        rate: 0.78,
        damage: 190,
        armoredBonus: 1.9,
        shieldBreak: 1,
        bossEliteBonus: 1.25,
        executeThreshold: 0.30,
        executeMult: 1.75,
        desc: '对硬甲 1.9×；Boss/精英 +25%；<30% 血处决 1.75×'
      }
    }
  }
};

export function getTowerLevelDef(towerType, level, branch = null) {
  const def = TOWER_DEFS[towerType];
  if (!def) return null;
  if (level <= 2) {
    return def.levels[Math.max(0, level - 1)] || null;
  }
  if (level === 3 && branch && def.branches && def.branches[branch]) {
    return def.branches[branch];
  }
  return null;
}

export const CREEP_DEFS = {
  // Natural wave creeps (Macaron bright style, drop gold)
  jelly: {
    id: 'jelly',
    name: 'QQ软糖怪',
    hp: 35,
    speed: 82,
    armored: false,
    heavyArmor: false,
    shieldHits: 0,
    slowResist: 0,
    isBoss: false,
    isDark: false,
    leakDamage: 1,
    naturalBounty: 7,
    radius: 13,
    color: '#FF6B8B'
  },
  gummy_pack: {
    id: 'gummy_pack',
    name: '泡泡糖速跑',
    hp: 42,
    speed: 122,
    armored: false,
    heavyArmor: false,
    shieldHits: 0,
    slowResist: 0,
    isBoss: false,
    isDark: false,
    leakDamage: 1,
    naturalBounty: 8,
    radius: 13,
    color: '#FF8AD4'
  },
  toffee: {
    id: 'toffee',
    name: '太妃硬糖块',
    hp: 145,
    speed: 64,
    armored: true,
    heavyArmor: false,
    shieldHits: 0,
    slowResist: 0,
    isBoss: false,
    isDark: false,
    leakDamage: 2,
    naturalBounty: 18,
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
    heavyArmor: false,
    shieldHits: 0,
    slowResist: 0,
    isBoss: false,
    isDark: false,
    leakDamage: 3,
    naturalBounty: 30,
    radius: 18,
    color: '#A58BF5'
  },
  giant_cake: {
    id: 'giant_cake',
    name: '婚礼蛋糕王',
    hp: 800,
    speed: 52,
    armored: true,
    heavyArmor: false,
    shieldHits: 0,
    slowResist: 0,
    isBoss: true,
    isDark: false,
    leakDamage: 5,
    naturalBounty: 75,
    radius: 23,
    color: '#FFFDF7'
  },

  // Player-sent Dark/Neon Raid Forces (zero bounty anti-feed)
  dark_pop: {
    id: 'dark_pop',
    name: '暗影跳跳糖',
    hp: 44,
    speed: 92,
    armored: false,
    heavyArmor: false,
    shieldHits: 0,
    slowResist: 0,
    isBoss: false,
    isDark: true,
    leakDamage: 1,
    naturalBounty: 0,
    radius: 12,
    color: '#2B1638',
    neonColor: '#FF4FD8'
  },
  neon_dasher: {
    id: 'neon_dasher',
    name: '霓虹冲锋糖',
    hp: 52,
    speed: 148,
    armored: false,
    heavyArmor: false,
    shieldHits: 0,
    ccImmuneBeforeProgress: 0.30,
    slowResist: 0.5,
    isBoss: false,
    isDark: true,
    leakDamage: 1,
    naturalBounty: 0,
    radius: 12,
    color: '#181A36',
    neonColor: '#3BF2FF'
  },
  shield_choco: {
    id: 'shield_choco',
    name: '晶盾黑巧卫士',
    hp: 125,
    speed: 68,
    armored: true,
    heavyArmor: false,
    shieldHits: 8,
    slowResist: 0,
    isBoss: false,
    isDark: true,
    leakDamage: 2,
    naturalBounty: 0,
    radius: 16,
    color: '#25172E',
    neonColor: '#4BA3FF'
  },
  dark_healer: {
    id: 'dark_healer',
    name: '黑莓圣代奶妈',
    hp: 420,
    speed: 62,
    armored: false,
    heavyArmor: false,
    shieldHits: 0,
    slowResist: 0,
    isBoss: true,
    isDark: true,
    healPeriodTicks: 20, // 1.0s
    healRadius: 135,
    healPctNormal: 0.06,
    healPctBoss: 0.03,
    leakDamage: 4,
    naturalBounty: 0,
    radius: 20,
    color: '#1F132B',
    neonColor: '#39FF9C'
  },
  iron_titan: {
    id: 'iron_titan',
    name: '黑曜铁王八',
    hp: 1150,
    speed: 48,
    armored: true,
    heavyArmor: true,
    shieldHits: 6,
    slowResist: 0.5,
    isBoss: true,
    isDark: true,
    leakDamage: 6,
    naturalBounty: 0,
    radius: 23,
    color: '#1A1324',
    neonColor: '#FF7A2F'
  }
};

export const SEND_ORDER = [
  'raid_swarm',
  'raid_dash',
  'raid_shield',
  'express_healer',
  'express_titan'
];

export const SEND_DEFS = {
  raid_swarm: {
    id: 'raid_swarm',
    name: '暗影跳糖潮',
    shortName: '暗影×8',
    icon: '👾',
    hotkey: 'Q',
    cost: 65,
    eco: 6,
    cooldownTicks: 40, // 2.0s
    isExpress: false,
    spawns: [{ type: 'dark_pop', count: 8, intervalTicks: 5 }],
    tag: '常规人海',
    color: '#FF4FD8',
    desc: '派出 8 只暗影跳跳糖（0.25s 间隔），紧凑人海逼出爆米花 AOE'
  },
  raid_dash: {
    id: 'raid_dash',
    name: '霓虹闪电流',
    shortName: '闪电×5',
    icon: '⚡',
    hotkey: 'W',
    cost: 110,
    eco: 9,
    cooldownTicks: 60, // 3.0s
    isExpress: false,
    spawns: [{ type: 'neon_dasher', count: 5, intervalTicks: 6 }],
    tag: '前段免控',
    color: '#3BF2FF',
    desc: '派出 5 只霓虹冲锋糖（148速），前 30% 路程免控免减速，后段减速减半'
  },
  raid_shield: {
    id: 'raid_shield',
    name: '晶盾黑巧兵',
    shortName: '晶盾×3',
    icon: '🔷',
    hotkey: 'E',
    cost: 165,
    eco: 13,
    cooldownTicks: 90, // 4.5s
    isExpress: false,
    spawns: [{ type: 'shield_choco', count: 3, intervalTicks: 12 }],
    tag: '8层次数盾',
    color: '#4BA3FF',
    desc: '派出 3 只晶盾黑巧卫士（硬甲 + 8 层次数盾），完克纯柠檬狙，逼出草莓破盾'
  },
  express_healer: {
    id: 'express_healer',
    name: '暗黑奶妈车',
    shortName: '💚 奶妈车',
    icon: '💚',
    hotkey: 'R',
    cost: 270,
    eco: 19,
    cooldownTicks: 280, // 14.0s
    isExpress: true,
    spawns: [
      { type: 'dark_healer', count: 1, intervalTicks: 6 },
      { type: 'dark_pop', count: 4, intervalTicks: 6 }
    ],
    tag: '3s 预警',
    color: '#39FF9C',
    desc: '3s 预警快递：1 只黑莓奶妈 Boss（每秒半径 135px 群体回血 6%，含自然怪）+ 4 只暗影糖'
  },
  express_titan: {
    id: 'express_titan',
    name: '终极铁王八',
    shortName: '🛡️ 铁王八',
    icon: '🛡️',
    hotkey: 'T',
    cost: 460,
    eco: 29,
    cooldownTicks: 440, // 22.0s
    isExpress: true,
    spawns: [
      { type: 'iron_titan', count: 1, intervalTicks: 8 },
      { type: 'shield_choco', count: 2, intervalTicks: 8 }
    ],
    tag: '3s 预警',
    color: '#FF7A2F',
    desc: '3s 预警快递：黑曜铁王八 Boss（重甲 0.5× + 6 盾 + 50% 抗减速）+ 2 只晶盾卫士'
  }
};

export const NATURAL_WAVES = [
  // W1: 315 EHP
  [{ type: 'jelly', count: 9, intervalTicks: 15 }],
  // W2: 389 EHP (+23.6%)
  [
    { type: 'jelly', count: 8, intervalTicks: 14 },
    { type: 'gummy_pack', count: 2, intervalTicks: 12 }
  ],
  // W3: 489 EHP (+25.5%)
  [
    { type: 'jelly', count: 5, intervalTicks: 13 },
    { type: 'gummy_pack', count: 6, intervalTicks: 11 }
  ],
  // W4: 617 EHP (+26.3%)
  [
    { type: 'jelly', count: 5, intervalTicks: 12 },
    { type: 'gummy_pack', count: 3, intervalTicks: 11 },
    { type: 'toffee', count: 1, intervalTicks: 22 }
  ],
  // W5: 762 EHP (+23.4%)
  [
    { type: 'gummy_pack', count: 9, intervalTicks: 10 },
    { type: 'toffee', count: 1, intervalTicks: 20 }
  ],
  // W6: 943 EHP (+23.8%)
  [
    { type: 'jelly', count: 4, intervalTicks: 10 },
    { type: 'gummy_pack', count: 3, intervalTicks: 9 },
    { type: 'toffee', count: 2, intervalTicks: 18 }
  ],
  // W7: 1177 EHP (+24.8%)
  [
    { type: 'gummy_pack', count: 9, intervalTicks: 9 },
    { type: 'toffee', count: 2, intervalTicks: 17 }
  ],
  // W8: 1450 EHP (+23.2%)
  [
    { type: 'gummy_pack', count: 8, intervalTicks: 9 },
    { type: 'toffee', count: 1, intervalTicks: 16 },
    { type: 'macaron_stack', count: 1, intervalTicks: 22 }
  ],
  // W9: 1828 EHP (+26.0%)
  [
    { type: 'gummy_pack', count: 7, intervalTicks: 8 },
    { type: 'toffee', count: 2, intervalTicks: 15 },
    { type: 'macaron_stack', count: 1, intervalTicks: 20 }
  ],
  // W10: 2290 EHP (+25.3%) — Mid-game Boss debut
  [
    { type: 'giant_cake', count: 1, intervalTicks: 28 },
    { type: 'gummy_pack', count: 3, intervalTicks: 10 }
  ],
  // W11: 2891 EHP (+26.3%)
  [
    { type: 'toffee', count: 2, intervalTicks: 14 },
    { type: 'macaron_stack', count: 2, intervalTicks: 18 },
    { type: 'gummy_pack', count: 8, intervalTicks: 8 }
  ],
  // W12: 3698 EHP (+27.9%)
  [
    { type: 'toffee', count: 3, intervalTicks: 13 },
    { type: 'macaron_stack', count: 2, intervalTicks: 16 },
    { type: 'gummy_pack', count: 10, intervalTicks: 7 }
  ],
  // W13: 4635 EHP (+25.3%)
  [
    { type: 'giant_cake', count: 1, intervalTicks: 28 },
    { type: 'toffee', count: 2, intervalTicks: 14 },
    { type: 'macaron_stack', count: 1, intervalTicks: 18 },
    { type: 'gummy_pack', count: 4, intervalTicks: 7 }
  ],
  // W14: 5837 EHP (+25.9%)
  [
    { type: 'giant_cake', count: 1, intervalTicks: 28 },
    { type: 'toffee', count: 2, intervalTicks: 13 },
    { type: 'macaron_stack', count: 2, intervalTicks: 15 },
    { type: 'gummy_pack', count: 4, intervalTicks: 7 }
  ],
  // W15: 7366 EHP (+26.2%) — Dual Boss finale
  [
    { type: 'giant_cake', count: 2, intervalTicks: 34 },
    { type: 'macaron_stack', count: 1, intervalTicks: 14 },
    { type: 'gummy_pack', count: 6, intervalTicks: 6 }
  ]
];

export function getWaveConfig(waveNum) {
  if (waveNum <= MAX_MAIN_WAVES) {
    return {
      wave: waveNum,
      isOvertime: false,
      hpScale: Number(Math.pow(1.07, waveNum - 1).toFixed(3)),
      speedScale: 1,
      groups: NATURAL_WAVES[waveNum - 1]
    };
  }
  const otIndex = waveNum - MAX_MAIN_WAVES; // 1 for wave 16
  return {
    wave: waveNum,
    isOvertime: true,
    hpScale: 2.579 * Math.pow(1.20, otIndex),
    speedScale: Math.min(1.40, 1 + otIndex * 0.03),
    groups: [
      { type: 'giant_cake', count: 2 + Math.floor((otIndex - 1) / 2), intervalTicks: 24 },
      { type: 'macaron_stack', count: 2 + otIndex, intervalTicks: 14 },
      { type: 'gummy_pack', count: 8 + 2 * otIndex, intervalTicks: 6 }
    ]
  };
}

export function getWaveIntervalTicks(waveNum) {
  if (waveNum < MAX_MAIN_WAVES) return WAVE_INTERVAL_TICKS; // 440 (22.0s)
  if (waveNum === MAX_MAIN_WAVES) return OVERTIME_W15_INTERVAL_TICKS; // 400 (20.0s)
  if (waveNum === MAX_MAIN_WAVES + 1) return OVERTIME_W16_INTERVAL_TICKS; // 360 (18.0s)
  return OVERTIME_INTERVAL_TICKS; // 320 (16.0s)
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

function compileMapDef(raw) {
  const pathCellSet = new Set();
  for (let i = 0; i < raw.waypoints.length - 1; i++) {
    const [c1, r1] = raw.waypoints[i];
    const [c2, r2] = raw.waypoints[i + 1];
    const dc = Math.sign(c2 - c1);
    const dr = Math.sign(r2 - r1);
    let c = c1;
    let r = r1;
    pathCellSet.add(cellKey(c, r));
    while (c !== c2 || r !== r2) {
      c += dc;
      r += dr;
      pathCellSet.add(cellKey(c, r));
    }
  }

  const obstacleMap = new Map(raw.obstacles.map((o) => [cellKey(o.col, o.row), o]));
  const pointsPx = raw.waypoints.map(([c, r]) => cellToPixel(c, r));
  const segments = [];
  let totalPathLength = 0;
  for (let i = 0; i < pointsPx.length - 1; i++) {
    const a = pointsPx[i];
    const b = pointsPx[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    segments.push({
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      dx,
      dy,
      len,
      angle: Math.atan2(dy, dx),
      startDist: totalPathLength,
      endDist: totalPathLength + len
    });
    totalPathLength += len;
  }

  const initialBuildableCount = GRID_COLS * GRID_ROWS - pathCellSet.size - obstacleMap.size;

  return {
    id: raw.id,
    name: raw.name,
    styleTag: raw.styleTag,
    desc: raw.desc,
    waypoints: raw.waypoints,
    obstacles: raw.obstacles,
    pathCellSet,
    obstacleMap,
    pointsPx,
    segments,
    totalPathLength,
    initialBuildableCount
  };
}

export const MAP_DEFS = Object.fromEntries(
  RAW_MAP_DEFS.map((raw) => [raw.id, compileMapDef(raw)])
);

export function getMapDef(mapId) {
  return MAP_DEFS[mapId] || MAP_DEFS[DEFAULT_MAP_ID];
}

export function isValidMapSelection(mapId) {
  return mapId === 'random' || Boolean(MAP_DEFS[mapId]);
}

export function getObstacleAt(mapId, col, row) {
  const mapDef = getMapDef(mapId);
  return mapDef.obstacleMap.get(cellKey(col, row)) || null;
}

export function getBuffAt(mapId, col, row, clearedSet = null) {
  if (!clearedSet) return null;
  const key = cellKey(col, row);
  if (!clearedSet.has(key)) return null;
  const obs = getMapDef(mapId).obstacleMap.get(key);
  return obs ? obs.buff : null;
}

export function isBuildableCell(mapId, col, row, clearedSet = null) {
  if (!Number.isInteger(col) || !Number.isInteger(row)) return false;
  if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return false;
  const mapDef = getMapDef(mapId);
  const key = cellKey(col, row);
  if (mapDef.pathCellSet.has(key)) return false;
  if (mapDef.obstacleMap.has(key)) {
    return Boolean(clearedSet && clearedSet.has(key));
  }
  return true;
}

export function getPositionAtProgress(mapId, progress) {
  const mapDef = getMapDef(mapId);
  const clamped = Math.max(0, Math.min(1, progress));
  const targetDist = clamped * mapDef.totalPathLength;
  const segments = mapDef.segments;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (targetDist <= seg.endDist || i === segments.length - 1) {
      const local = seg.len > 0 ? (targetDist - seg.startDist) / seg.len : 0;
      return {
        x: seg.x1 + seg.dx * local,
        y: seg.y1 + seg.dy * local,
        angle: seg.angle
      };
    }
  }
  const last = mapDef.pointsPx[mapDef.pointsPx.length - 1];
  return { x: last.x, y: last.y, angle: 0 };
}

export function isPointInRightZone(x, y) {
  return (
    x >= PEEK_RIGHT_ZONE.x &&
    x <= PEEK_RIGHT_ZONE.x + PEEK_RIGHT_ZONE.w &&
    y >= PEEK_RIGHT_ZONE.y &&
    y <= PEEK_RIGHT_ZONE.y + PEEK_RIGHT_ZONE.h
  );
}

export function isPointInLeftZone(x, y) {
  return (
    x >= PEEK_LEFT_ZONE.x &&
    x <= PEEK_LEFT_ZONE.x + PEEK_LEFT_ZONE.w &&
    y >= PEEK_LEFT_ZONE.y &&
    y <= PEEK_LEFT_ZONE.y + PEEK_LEFT_ZONE.h
  );
}

export const isPointInPeekZone = isPointInRightZone;
