import { CANVAS_HEIGHT, CANVAS_WIDTH, cellKey } from './shared/constants.js';
import { CandyAudio } from './audio.js';
import { NetClient } from './net-client.js';
import { CandyRenderer } from './renderer.js';
import { InputController } from './input.js';
import { CandyUI } from './ui.js';

const params = new URLSearchParams(location.search);
const netDebugEnabled = params.get('netdebug') === '1';
const testModeEnabled = params.get('test') === '1';
const inviteRoomCode = params.get('room');

const stage = document.getElementById('stage');
const canvas = document.getElementById('game-canvas');
const rightZone = document.getElementById('peek-zone-right');
const leftZone = document.getElementById('peek-zone-left');

function fitStageToViewport() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const scale = Math.min(vw / CANVAS_WIDTH, vh / CANVAS_HEIGHT);
  stage.style.transform = `scale(${scale})`;
}

const audio = new CandyAudio();
const net = new NetClient();
const renderer = new CandyRenderer(canvas);

let latestRoomState = null;
let matchEndAudioPlayed = false;
let lobbyConnecting = false;

function formatConnectError(err) {
  if (err && err.message === 'WS_CONNECT_TIMEOUT') {
    return '连接对战服务器超时，请检查服务状态、网络或代理设置后重试';
  }
  return '无法连接对战服务器，请检查服务状态、网络或代理设置';
}

function maybePlayMatchEndAudio(endedResult) {
  if (matchEndAudioPlayed || !endedResult) return;
  matchEndAudioPlayed = true;
  const mySlot = latestRoomState ? latestRoomState.playerSlot : 0;
  audio.play(endedResult.winnerSlot === mySlot ? 'win' : 'lose');
}

const ui = new CandyUI({
  net,
  audio,
  renderer,
  callbacks: {
    async onCreateRoom({ mode, aiDifficulty, nickname, mapId }) {
      if (lobbyConnecting) return;
      lobbyConnecting = true;
      ui.setLobbyConnecting(true, '连接中...');
      try {
        await net.connect();
        net.saveSession({ nickname });
        const sent = net.send({ type: 'create_room', mode, aiDifficulty, nickname, mapId });
        if (!sent) {
          ui.showToast('连接尚未就绪，请重试');
        }
      } catch (err) {
        ui.showToast(formatConnectError(err), 3400);
      } finally {
        lobbyConnecting = false;
        ui.setLobbyConnecting(false);
      }
    },
    async onJoinRoom({ roomCode, nickname }) {
      if (lobbyConnecting) return;
      lobbyConnecting = true;
      ui.setLobbyConnecting(true, '连接中...');
      try {
        await net.connect();
        net.saveSession({ nickname });
        const sent = net.send({ type: 'join_room', roomCode, nickname });
        if (!sent) {
          ui.showToast('连接尚未就绪，请重试');
        }
      } catch (err) {
        ui.showToast(formatConnectError(err), 3400);
      } finally {
        lobbyConnecting = false;
        ui.setLobbyConnecting(false);
      }
    },
    onSelectMap(mapId) {
      net.send({ type: 'select_map', mapId });
    },
    onSelectBuild(type) {
      renderer.selectedBuildType = type;
      if (type) {
        renderer.selectedTowerId = null;
        renderer.selectedObstacleKey = null;
      }
      ui.setSelectedBuild(type);
      if (type) {
        ui.setSelectedTower(null);
        ui.setSelectedObstacle(null);
      }
    },
    onSelectTower(tower) {
      renderer.selectedTowerId = tower ? tower.id : null;
      if (tower) renderer.selectedObstacleKey = null;
      ui.setSelectedTower(tower);
    },
    onSelectObstacle(obs) {
      renderer.selectedObstacleKey = obs ? cellKey(obs.col, obs.row) : null;
      if (obs) renderer.selectedTowerId = null;
      ui.setSelectedObstacle(obs);
    },
    onUpgradeTower(towerId, branch) {
      net.send({
        type: 'upgrade_tower',
        towerId,
        ...(branch ? { branch } : {})
      });
    },
    onDemolishObstacle(col, row) {
      net.send({ type: 'demolish_obstacle', col, row });
    },
    onSendWave(sendType) {
      net.send({ type: 'send_wave', sendType });
    },
    onReturnSelfView() {
      input.setViewMode('self');
    },
    onReturnHome() {
      net.send({ type: 'leave_room' });
      latestRoomState = null;
      matchEndAudioPlayed = false;
      renderer.resetMatchState();
      ui.resetForNewMatch();
      net.clearRoomSession();
      ui.showLobbyHome();
      input.setEnabled(false);
    }
  }
});

const input = new InputController({
  canvas,
  stage,
  rightZone,
  leftZone,
  renderer,
  onSelectBuild(type) {
    renderer.selectedBuildType = type;
    if (type) {
      renderer.selectedTowerId = null;
      renderer.selectedObstacleKey = null;
    }
    ui.setSelectedBuild(type);
    if (type) {
      ui.setSelectedTower(null);
      ui.setSelectedObstacle(null);
    }
  },
  onPlaceTower(towerType, col, row) {
    net.send({ type: 'place_tower', towerType, col, row });
  },
  onSelectTower(tower) {
    renderer.selectedTowerId = tower ? tower.id : null;
    if (tower) renderer.selectedObstacleKey = null;
    ui.setSelectedTower(tower);
  },
  onSelectObstacle(obs) {
    renderer.selectedObstacleKey = obs ? cellKey(obs.col, obs.row) : null;
    if (obs) renderer.selectedTowerId = null;
    ui.setSelectedObstacle(obs);
  },
  onHoverOpponentTower(tower, pt) {
    ui.showOpponentTowerCard(tower, pt);
  },
  onSendWave(sendType) {
    net.send({ type: 'send_wave', sendType });
  },
  onViewModeChange(mode) {
    ui.setViewMode(mode);
  },
  onToggleHelp() {
    ui.toggleHelp();
  },
  onCloseHelp() {
    ui.closeHelp();
  },
  isHelpOpen() {
    return ui.helpOpen;
  },
  onUnlockAudio() {
    audio.unlock();
  }
});

net.handlers.onRoomState = (state) => {
  latestRoomState = state;
  renderer.setPlayerSlot(state.playerSlot);
  if (state.resolvedMapId) {
    renderer.setMapId(state.resolvedMapId);
  }
  if (state.phase === 'COUNTDOWN') {
    matchEndAudioPlayed = false;
    renderer.resetMatchState();
    ui.resetForNewMatch();
  }
  ui.updateRoomState(state);
  input.setEnabled(state.phase === 'PLAYING');
  if (state.phase === 'ENDED' && renderer.currSnapshot?.endedResult) {
    maybePlayMatchEndAudio(renderer.currSnapshot.endedResult);
  }
};

net.handlers.onSnapshot = (snap) => {
  if (snap.tick === 0 && snap.phase === 'PLAYING') {
    matchEndAudioPlayed = false;
  }
  renderer.pushSnapshot(snap);
  ui.updateSnapshot(snap);
  if (snap.phase === 'ENDED' && snap.endedResult) {
    maybePlayMatchEndAudio(snap.endedResult);
  }
};

net.handlers.onEvents = (events) => {
  renderer.handleEvents(events);
  const mySlot = latestRoomState ? latestRoomState.playerSlot : 0;
  const playedThisBatch = new Set();
  const playOnce = (sound) => {
    if (!playedThisBatch.has(sound)) {
      playedThisBatch.add(sound);
      audio.play(sound);
    }
  };

  for (const ev of events) {
    if (ev.type === 'tower_built') playOnce('build');
    else if (ev.type === 'tower_upgraded') playOnce('upgrade');
    else if (ev.type === 'obstacle_demolished' && ev.slot === mySlot) playOnce('demolish');
    else if (ev.type === 'tower_sold' || ev.type === 'eco_payout') playOnce('coin');
    else if (ev.type === 'express_started') playOnce('express_honk');
    else if (ev.type === 'shield_hit' && ev.slot === mySlot) playOnce('shield_hit');
    else if (ev.type === 'shield_break' && ev.slot === mySlot) playOnce('shield_break');
    else if (ev.type === 'frost_nova' && ev.slot === mySlot) playOnce('frost_nova');
    else if (ev.type === 'healer_pulse' && ev.slot === mySlot) playOnce('heal_pulse');
    else if (ev.type === 'execute_hit' && ev.slot === mySlot) playOnce('execute');
    else if (ev.type === 'life_lost' && ev.slot === mySlot) {
      playOnce('hurt');
    } else if (ev.type === 'match_ended' && ev.endedResult) {
      maybePlayMatchEndAudio(ev.endedResult);
    } else if (ev.type === 'tower_shot' && ev.slot === mySlot) {
      if (ev.towerType === 'strawberry') playOnce('pop');
      else if (ev.towerType === 'mint') playOnce('frost');
      else if (ev.towerType === 'popcorn') playOnce('boom');
      else if (ev.towerType === 'lemon') playOnce('laser');
    }
  }
};

net.handlers.onError = (err) => {
  ui.showToast(err.message || err.code || '操作失败');
};

net.handlers.onConnectionChange = (connected) => {
  if (!connected && latestRoomState && latestRoomState.phase === 'PLAYING') {
    ui.showToast('网络连接已断开，正在尝试自动重连...');
    setTimeout(() => {
      const s = net.session;
      if (s.roomCode && s.reconnectToken) {
        net.connect()
          .then(() => {
            net.send({
              type: 'join_room',
              roomCode: s.roomCode,
              nickname: s.nickname || ui.getNickname(),
              playerId: s.playerId,
              reconnectToken: s.reconnectToken
            });
          })
          .catch(() => {});
      }
    }, 600);
  }
};

// Auto-reconnect on F5 refresh or prefill ?room=XXXX
(async function bootstrap() {
  fitStageToViewport();
  window.addEventListener('resize', () => {
    fitStageToViewport();
    renderer.resize();
  });

  if (inviteRoomCode) {
    ui.prefillRoomCode(inviteRoomCode);
  }

  const saved = net.session;
  if (saved.nickname) {
    document.getElementById('input-nickname').value = saved.nickname;
  }

  if (location.protocol === 'file:') {
    ui.showFileProtocolWarning();
    ui.showLobbyHome();
    return;
  }

  if (saved.roomCode && saved.reconnectToken && (!inviteRoomCode || inviteRoomCode.toUpperCase() === saved.roomCode)) {
    try {
      await net.connect();
      net.send({
        type: 'join_room',
        roomCode: saved.roomCode,
        nickname: saved.nickname || ui.getNickname(),
        playerId: saved.playerId,
        reconnectToken: saved.reconnectToken
      });
    } catch {
      ui.showLobbyHome();
    }
  } else {
    ui.showLobbyHome();
  }
})();

// Dual-gated test hook: ONLY mounted when URL contains ?test=1
// (Backend additionally requires CANDY_ALLOW_TEST_HOOKS=1)
if (testModeEnabled) {
  window.__CANDY_TEST__ = {
    getSnapshot() {
      return net.sendTestCommand('getSnapshot', {});
    },
    setSeed(seed) {
      return net.sendTestCommand('setSeed', { seed });
    },
    grantResources({ target = 'self', gold, eco, hp }) {
      return net.sendTestCommand('grantResources', { target, gold, eco, hp });
    },
    jumpWave(waveNum) {
      return net.sendTestCommand('jumpWave', { waveNum });
    },
    spawnStress({ towers = 15, creeps = 45 } = {}) {
      return net.sendTestCommand('spawnStress', { towers, creeps });
    },
    fastForwardTicks(ticks) {
      return net.sendTestCommand('fastForwardTicks', { ticks });
    },
    simulateDisconnect(target = 'opponent', remainMs) {
      return net.sendTestCommand('simulateDisconnect', { target, remainMs });
    },
    getAudioState() {
      return {
        muted: audio.muted,
        state: audio.ctx ? audio.ctx.state : 'uninitialized',
        events: audio.eventLog.slice(-50)
      };
    },
    getViewState() {
      return {
        viewMode: input.viewMode,
        peekProgress: Number(renderer.peekProgress.toFixed(3)),
        selectedBuildType: renderer.selectedBuildType,
        selectedTowerId: renderer.selectedTowerId,
        hoverOpponentTowerId: renderer.hoverOpponentTowerId,
        tooltipVisible: ui.tooltipVisible,
        helpOpen: ui.helpOpen
      };
    }
  };
}

// 60fps render loop
let lastFrame = performance.now();
let netDebugAccum = 0;
function loop(now) {
  const dtSec = Math.min(0.1, Math.max(0.001, (now - lastFrame) / 1000));
  lastFrame = now;

  renderer.render(now, dtSec);

  netDebugAccum += dtSec;
  if (netDebugEnabled && netDebugAccum >= 0.2) {
    netDebugAccum = 0;
    ui.updateNetDebug(true);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
