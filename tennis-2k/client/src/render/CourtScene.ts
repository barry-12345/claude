import * as THREE from 'three';
import {
  ARCHETYPES,
  COURT_DIM,
  COURTS,
  netHeightAt,
  type ArchetypeId,
  type CourtId,
  type HawkeyeState,
  type MatchState,
  type PlayerIndex,
  type ShotActionKey,
} from '@court2k/shared';
import type { AvatarStatus, PlayerAvatarController } from '../contracts.js';
import type { QualityPreset } from '../core/PerfManager.js';
import { GlbPlayerAvatar } from './PlayerAvatar.js';

interface DustParticle {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  maxAge: number;
}

interface DaylightTheme {
  skyTop: string;
  skyHorizon: string;
  sunColor: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  standColor: string;
  boardColor: string;
  accentStripColor: string;
}

const DAYLIGHT_THEMES: Record<CourtId, DaylightTheme> = {
  hard: {
    skyTop: '#60a5fa',
    skyHorizon: '#dbeafe',
    sunColor: '#fffaf0',
    sunIntensity: 2.35,
    hemiSky: '#dbeafe',
    hemiGround: '#8fa3b8',
    hemiIntensity: 1.28,
    standColor: '#d5dde8',
    boardColor: '#1e3a5f',
    accentStripColor: '#38bdf8',
  },
  clay: {
    skyTop: '#5b9ee8',
    skyHorizon: '#fde8d0',
    sunColor: '#fff2d9',
    sunIntensity: 2.45,
    hemiSky: '#e0f2fe',
    hemiGround: '#c9977b',
    hemiIntensity: 1.28,
    standColor: '#e6ddd2',
    boardColor: '#1b4d3e',
    accentStripColor: '#fb923c',
  },
  grass: {
    skyTop: '#67a9f0',
    skyHorizon: '#e5f3ff',
    sunColor: '#fffdf7',
    sunIntensity: 2.30,
    hemiSky: '#e0f2fe',
    hemiGround: '#7ca886',
    hemiIntensity: 1.28,
    standColor: '#e8ece9',
    boardColor: '#14452f',
    accentStripColor: '#9333ea',
  },
};

const STANCE_RING_COLORS: Record<Exclude<ShotActionKey, 'none'>, string> = {
  J: '#f59e0b',
  K: '#06b6d4',
  L: '#a855f7',
};

function makeSurfaceTexture(courtId: CourtId): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const cfg = COURTS[courtId];

  if (ctx) {
    ctx.fillStyle = cfg.innerColor;
    ctx.fillRect(0, 0, 512, 512);

    if (courtId === 'grass') {
      const stripeCount = 16;
      const stripeH = 512 / stripeCount;
      for (let i = 0; i < stripeCount; i++) {
        ctx.fillStyle = i % 2 === 0 ? '#3B8A49' : '#2F753C';
        ctx.fillRect(0, i * stripeH, 512, stripeH);
      }
    }

    for (let i = 0; i < 4200; i++) {
      const x = (i * 73) % 512;
      const y = (i * 137 + Math.floor(i / 7) * 19) % 512;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.045)';
      ctx.fillRect(x, y, 2, 2);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeNetTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 128, 64);
    ctx.strokeStyle = 'rgba(232, 238, 246, 0.88)';
    ctx.lineWidth = 2;
    for (let x = 0; x <= 128; x += 8) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 64);
      ctx.stroke();
    }
    for (let y = 0; y <= 64; y += 8) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(128, y);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 2);
  return tex;
}

function makeBallTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#d4f529';
    ctx.fillRect(0, 0, 128, 64);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(32, 32, 22, -Math.PI * 0.45, Math.PI * 0.45);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(96, 32, 22, Math.PI * 0.55, Math.PI * 1.45);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class CourtScene {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;

  private readonly hemiLight: THREE.HemisphereLight;
  private readonly dirLight: THREE.DirectionalLight;
  private readonly rimLight: THREE.DirectionalLight;
  private readonly skyUniforms: {
    topColor: { value: THREE.Color };
    horizonColor: { value: THREE.Color };
  };
  private readonly bgColor: THREE.Color;
  private readonly fog: THREE.Fog;

  private readonly innerCourtMat: THREE.MeshStandardMaterial;
  private readonly outerCourtMat: THREE.MeshStandardMaterial;
  private readonly boardMat: THREE.MeshStandardMaterial;
  private readonly standMat: THREE.MeshStandardMaterial;
  private readonly accentStripMat: THREE.MeshBasicMaterial;
  private readonly surfaceTextures: Record<CourtId, THREE.CanvasTexture>;

  private readonly avatars: [PlayerAvatarController, PlayerAvatarController];
  private readonly ballMesh: THREE.Mesh;
  private readonly ballShadow: THREE.Mesh;
  private readonly landingRing: THREE.Mesh;

  private readonly trailMesh: THREE.InstancedMesh;
  private readonly trailPoints: THREE.Vector3[] = [];
  private readonly dummy = new THREE.Object3D();

  // Clay dust particles
  private readonly dustMesh: THREE.InstancedMesh;
  private readonly dustParticles: DustParticle[] = [];
  private dustCursor = 0;

  // V2 subtle ground pre-selection ring (only when armedAction !== 'none' during rally)
  private readonly shotStanceRing: THREE.Mesh;
  private readonly shotStanceRingMat: THREE.MeshBasicMaterial;

  // V2 CLEAN sweet-spot emerald wave (0.32s)
  private readonly cleanShockwave: THREE.Mesh;
  private readonly cleanShockwaveMat: THREE.MeshBasicMaterial;
  private shockwaveTimer = 0;

  // Hawkeye 3D visual markers
  private readonly hawkeyeGroup: THREE.Group;
  private readonly hawkeyeBallMark: THREE.Mesh;
  private readonly hawkeyeLineHighlight: THREE.Mesh;
  private readonly hawkeyePulseRing: THREE.Mesh;

  private currentCourt: CourtId = 'hard';
  private currentArchetypes: [ArchetypeId, ArchetypeId] = ['allcourt', 'defender'];
  private particleScale = 1.0;
  private lastAppliedDpr = -1;

  private readonly camTarget = new THREE.Vector3(0, 0.3, 1.8);
  private readonly camPos = new THREE.Vector3(0, 10.4, 24.0);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;

    const initialTheme = DAYLIGHT_THEMES.hard;
    this.bgColor = new THREE.Color(initialTheme.skyHorizon);
    this.fog = new THREE.Fog(initialTheme.skyHorizon, 64, 150);

    this.scene = new THREE.Scene();
    this.scene.background = this.bgColor;
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.2, 220);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);

    // 1-Draw-Call Gradient Sky Dome
    this.skyUniforms = {
      topColor: { value: new THREE.Color(initialTheme.skyTop) },
      horizonColor: { value: new THREE.Color(initialTheme.skyHorizon) },
    };
    const skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(120, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.skyUniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: `
          varying vec3 vWorldPos;
          void main() {
            vec4 worldPos = modelMatrix * vec4(position, 1.0);
            vWorldPos = worldPos.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPos;
          }
        `,
        fragmentShader: `
          uniform vec3 topColor;
          uniform vec3 horizonColor;
          varying vec3 vWorldPos;
          void main() {
            float h = normalize(vWorldPos).y;
            float t = pow(clamp(h, 0.0, 1.0), 0.62);
            gl_FragColor = vec4(mix(horizonColor, topColor, t), 1.0);
          }
        `,
      })
    );
    this.scene.add(skyDome);

    // Bright Grand Slam Daylight Lighting
    this.hemiLight = new THREE.HemisphereLight(
      initialTheme.hemiSky,
      initialTheme.hemiGround,
      initialTheme.hemiIntensity
    );
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(initialTheme.sunColor, initialTheme.sunIntensity);
    this.dirLight.position.set(14, 24, 16);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(1024, 1024);
    this.dirLight.shadow.camera.near = 4;
    this.dirLight.shadow.camera.far = 65;
    this.dirLight.shadow.camera.left = -16;
    this.dirLight.shadow.camera.right = 16;
    this.dirLight.shadow.camera.top = 18;
    this.dirLight.shadow.camera.bottom = -18;
    this.dirLight.shadow.bias = -0.0005;
    this.scene.add(this.dirLight);

    this.rimLight = new THREE.DirectionalLight('#e0f2fe', 0.55);
    this.rimLight.position.set(-14, 12, -18);
    this.scene.add(this.rimLight);

    // Surface textures
    this.surfaceTextures = {
      hard: makeSurfaceTexture('hard'),
      clay: makeSurfaceTexture('clay'),
      grass: makeSurfaceTexture('grass'),
    };

    // Outer surround floor
    this.outerCourtMat = new THREE.MeshStandardMaterial({
      color: COURTS.hard.outerColor,
      roughness: 0.82,
      metalness: 0.02,
    });
    const outerFloor = new THREE.Mesh(new THREE.PlaneGeometry(24, 38), this.outerCourtMat);
    outerFloor.rotation.x = -Math.PI / 2;
    outerFloor.receiveShadow = true;
    this.scene.add(outerFloor);

    // Inner playable court surface
    this.innerCourtMat = new THREE.MeshStandardMaterial({
      map: this.surfaceTextures.hard,
      roughness: 0.76,
      metalness: 0.02,
    });
    const innerFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(COURT_DIM.DOUBLES_HALF_WIDTH * 2 + 0.8, COURT_DIM.HALF_LENGTH * 2 + 1.2),
      this.innerCourtMat
    );
    innerFloor.rotation.x = -Math.PI / 2;
    innerFloor.position.y = 0.002;
    innerFloor.receiveShadow = true;
    this.scene.add(innerFloor);

    this.buildCourtLines();
    this.buildNet();

    this.boardMat = new THREE.MeshStandardMaterial({ color: initialTheme.boardColor, roughness: 0.62 });
    this.standMat = new THREE.MeshStandardMaterial({ color: initialTheme.standColor, roughness: 0.82 });
    this.accentStripMat = new THREE.MeshBasicMaterial({ color: initialTheme.accentStripColor });
    this.buildStadium();

    // Avatars (Blender 5.2 GLB)
    this.avatars = [
      new GlbPlayerAvatar(ARCHETYPES.allcourt),
      new GlbPlayerAvatar(ARCHETYPES.defender),
    ];
    this.scene.add(this.avatars[0].root, this.avatars[1].root);

    // Ball & shadow & predicted landing
    const ballTex = makeBallTexture();
    this.ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.062, 16, 16),
      new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.38 })
    );
    this.ballMesh.castShadow = true;
    this.scene.add(this.ballMesh);

    this.ballShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.11, 16),
      new THREE.MeshBasicMaterial({
        color: '#000000',
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      })
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.position.y = 0.009;
    this.scene.add(this.ballShadow);

    this.landingRing = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.24, 24),
      new THREE.MeshBasicMaterial({
        color: '#38bdf8',
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    this.landingRing.rotation.x = -Math.PI / 2;
    this.landingRing.position.y = 0.011;
    this.landingRing.visible = false;
    this.scene.add(this.landingRing);

    // Ball Trail (14 instanced spheres = 1 draw call)
    this.trailMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.045, 8, 8),
      new THREE.MeshBasicMaterial({
        color: '#e6ff4b',
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
      14
    );
    this.trailMesh.count = 0;
    this.scene.add(this.trailMesh);

    // Clay Dust InstancedMesh (48 particles = 1 draw call)
    this.dustMesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.09, 8, 8),
      new THREE.MeshBasicMaterial({
        color: '#d97745',
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
      }),
      48
    );
    this.dustMesh.count = 48;
    for (let i = 0; i < 48; i++) {
      this.dustParticles.push({
        active: false,
        pos: new THREE.Vector3(0, -10, 0),
        vel: new THREE.Vector3(),
        age: 0,
        maxAge: 0.5,
      });
      this.dummy.position.set(0, -10, 0);
      this.dummy.scale.setScalar(0.001);
      this.dummy.updateMatrix();
      this.dustMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.scene.add(this.dustMesh);

    // V2 Ground Pre-selection Shot Ring (NO progress bar, NO needle)
    this.shotStanceRingMat = new THREE.MeshBasicMaterial({
      color: STANCE_RING_COLORS.J,
      transparent: true,
      opacity: 0.86,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.shotStanceRing = new THREE.Mesh(
      new THREE.RingGeometry(0.50, 0.62, 36),
      this.shotStanceRingMat
    );
    this.shotStanceRing.rotation.x = -Math.PI / 2;
    this.shotStanceRing.position.y = 0.018;
    this.shotStanceRing.visible = false;
    this.scene.add(this.shotStanceRing);

    // V2 CLEAN sweet-spot emerald shockwave (0.32s)
    this.cleanShockwaveMat = new THREE.MeshBasicMaterial({
      color: '#22e574',
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.cleanShockwave = new THREE.Mesh(
      new THREE.RingGeometry(0.56, 0.72, 36),
      this.cleanShockwaveMat
    );
    this.cleanShockwave.rotation.x = -Math.PI / 2;
    this.cleanShockwave.position.y = 0.025;
    this.cleanShockwave.visible = false;
    this.scene.add(this.cleanShockwave);

    // Hawkeye 3D markers
    this.hawkeyeGroup = new THREE.Group();
    this.hawkeyeGroup.visible = false;
    this.scene.add(this.hawkeyeGroup);

    this.hawkeyeBallMark = new THREE.Mesh(
      new THREE.CircleGeometry(0.048, 20),
      new THREE.MeshBasicMaterial({ color: '#111827', side: THREE.DoubleSide })
    );
    this.hawkeyeBallMark.rotation.x = -Math.PI / 2;
    this.hawkeyeBallMark.scale.set(0.85, 1.35, 1);
    this.hawkeyeBallMark.position.y = 0.012;

    this.hawkeyeLineHighlight = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.016, 4.0),
      new THREE.MeshBasicMaterial({ color: '#22e574' })
    );
    this.hawkeyeLineHighlight.position.y = 0.01;

    this.hawkeyePulseRing = new THREE.Mesh(
      new THREE.RingGeometry(0.11, 0.145, 28),
      new THREE.MeshBasicMaterial({
        color: '#38bdf8',
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      })
    );
    this.hawkeyePulseRing.rotation.x = -Math.PI / 2;
    this.hawkeyePulseRing.position.y = 0.014;

    this.hawkeyeGroup.add(this.hawkeyeBallMark, this.hawkeyeLineHighlight, this.hawkeyePulseRing);
  }

  public setCourt(courtId: CourtId): void {
    if (this.currentCourt === courtId) return;
    this.currentCourt = courtId;
    const cfg = COURTS[courtId];
    const theme = DAYLIGHT_THEMES[courtId];

    this.innerCourtMat.map = this.surfaceTextures[courtId];
    this.innerCourtMat.needsUpdate = true;
    this.outerCourtMat.color.set(cfg.outerColor);

    this.skyUniforms.topColor.value.set(theme.skyTop);
    this.skyUniforms.horizonColor.value.set(theme.skyHorizon);
    this.bgColor.set(theme.skyHorizon);
    this.fog.color.set(theme.skyHorizon);

    this.dirLight.color.set(theme.sunColor);
    this.dirLight.intensity = theme.sunIntensity;
    this.hemiLight.color.set(theme.hemiSky);
    this.hemiLight.groundColor.set(theme.hemiGround);
    this.hemiLight.intensity = theme.hemiIntensity;

    this.standMat.color.set(theme.standColor);
    this.boardMat.color.set(theme.boardColor);
    this.accentStripMat.color.set(theme.accentStripColor);
  }

  public setArchetypes(pair: [ArchetypeId, ArchetypeId]): void {
    for (const idx of [0, 1] as const) {
      if (this.currentArchetypes[idx] !== pair[idx]) {
        this.currentArchetypes[idx] = pair[idx];
        this.avatars[idx].setArchetype(ARCHETYPES[pair[idx]]);
      }
    }
  }

  public getAvatarStatus(playerIndex: PlayerIndex = 0): AvatarStatus {
    const primary = this.avatars[playerIndex].getStatus();
    const secondary = this.avatars[1 - playerIndex].getStatus();
    const bothLoaded = primary.loaded && secondary.loaded;
    return {
      loaded: bothLoaded,
      source: bothLoaded ? 'glb' : 'fallback',
      triangles: primary.triangles,
      clipNames: primary.clipNames,
    };
  }

  public applyPerfPreset(preset: QualityPreset, activeDpr: number): void {
    if (Math.abs(activeDpr - this.lastAppliedDpr) > 0.001) {
      this.renderer.setPixelRatio(activeDpr);
      this.lastAppliedDpr = activeDpr;
    }
    this.particleScale = preset.particleScale;

    const wantShadow = preset.shadowMapSize > 0;
    if (this.renderer.shadowMap.enabled !== wantShadow) {
      this.renderer.shadowMap.enabled = wantShadow;
      this.dirLight.castShadow = wantShadow;
    }
    if (wantShadow && this.dirLight.shadow.mapSize.x !== preset.shadowMapSize) {
      this.dirLight.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
      this.dirLight.shadow.map?.dispose();
      this.dirLight.shadow.map = null;
    }
  }

  public resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  public triggerCleanShockwave(pos: { x: number; z: number }): void {
    this.cleanShockwave.position.set(pos.x, 0.025, pos.z);
    this.cleanShockwave.scale.setScalar(1);
    this.cleanShockwaveMat.opacity = 0.85;
    this.cleanShockwave.visible = true;
    this.shockwaveTimer = 0.32;
  }

  public renderLobbyPreview(courtId: CourtId, archetypeId: ArchetypeId, elapsedSec: number, dt: number): void {
    this.setCourt(courtId);
    this.setArchetypes([archetypeId, 'defender']);

    const previewPos = { x: 2.35, y: 0, z: 11.4 };
    this.avatars[0].updatePose(
      {
        index: 0,
        side: 1,
        archetype: archetypeId,
        pos: previewPos,
        vel: { x: 0, y: 0, z: 0 },
        // Face toward +Z camera in 3/4 view so face, chest stripe, racquet, headgear & shorts are clearly visible
        yaw: Math.PI - 0.32 + Math.sin(elapsedSec * 0.65) * 0.32,
        anim: 'idle',
        animTime: elapsedSec,
        isSliding: false,
        slideTimer: 0,
        moveAccelTime: 0,
        stance: {
          armedAction: 'none',
          holdDurationSec: 0,
          bufferRemainingSec: 0,
          lastConsumedHitTick: -1,
          lockedAimX: 0,
          lastQuality: null,
        },
      },
      dt
    );
    this.avatars[1].root.visible = false;
    this.ballMesh.visible = false;
    this.ballShadow.visible = false;
    this.landingRing.visible = false;
    this.trailMesh.count = 0;
    this.shotStanceRing.visible = false;
    this.cleanShockwave.visible = false;
    this.hawkeyeGroup.visible = false;

    this.camPos.lerp(new THREE.Vector3(3.15, 1.55, 14.85), 1 - Math.exp(-5 * dt));
    this.camTarget.lerp(new THREE.Vector3(1.15, 0.96, 10.6), 1 - Math.exp(-5 * dt));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
    this.renderer.render(this.scene, this.camera);
  }

  public renderMatch(localState: MatchState, localPlayerIndex: PlayerIndex, dt: number): void {
    this.setCourt(localState.config.court);
    this.setArchetypes(localState.config.archetypes);

    this.avatars[0].root.visible = true;
    this.avatars[1].root.visible = true;
    this.avatars[0].updatePose(localState.players[0], dt);
    this.avatars[1].updatePose(localState.players[1], dt);

    // Emit clay slide dust
    if (COURTS[localState.config.court].hasClayDust && this.particleScale > 0) {
      for (const p of localState.players) {
        if (p.isSliding || Math.hypot(p.vel.x, p.vel.z) > 5.8) {
          if (Math.random() < (p.isSliding ? 0.85 : 0.25) * this.particleScale) {
            this.spawnClayDust(p.pos.x, p.pos.z);
          }
        }
      }
    }
    this.updateDust(dt);

    // Ball & shadow
    const b = localState.ball;
    this.ballMesh.visible = true;
    this.ballMesh.position.set(b.pos.x, b.pos.y, b.pos.z);
    this.ballMesh.rotation.x += b.spin.x * dt;
    this.ballMesh.rotation.z += b.spin.z * dt;

    this.ballShadow.visible = true;
    this.ballShadow.position.set(b.pos.x, 0.009, b.pos.z);
    const heightScale = Math.max(0.45, 1.15 - b.pos.y * 0.14);
    this.ballShadow.scale.setScalar(heightScale);
    (this.ballShadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.12, 0.4 - b.pos.y * 0.06);

    // Ball trail
    if (b.active) {
      this.trailPoints.unshift(new THREE.Vector3(b.pos.x, b.pos.y, b.pos.z));
      if (this.trailPoints.length > 14) {
        this.trailPoints.pop();
      }
      this.trailMesh.count = this.trailPoints.length;
      for (let i = 0; i < this.trailPoints.length; i++) {
        this.dummy.position.copy(this.trailPoints[i]);
        const s = 1 - i / 15;
        this.dummy.scale.setScalar(Math.max(0.15, s * 0.9));
        this.dummy.updateMatrix();
        this.trailMesh.setMatrixAt(i, this.dummy.matrix);
      }
      this.trailMesh.instanceMatrix.needsUpdate = true;
    } else {
      this.trailPoints.length = 0;
      this.trailMesh.count = 0;
    }

    // Predicted landing ring
    if (b.active && b.predictedLanding && b.bounces === 0) {
      this.landingRing.visible = true;
      this.landingRing.position.set(b.predictedLanding.x, 0.011, b.predictedLanding.z);
      const pulse = 1 + Math.sin(localState.tick * 0.25) * 0.14;
      this.landingRing.scale.setScalar(pulse);
    } else {
      this.landingRing.visible = false;
    }

    // V2 Ground Pre-selection Shot Ring under local player (only in rally when armedAction !== 'none')
    const localPlayer = localState.players[localPlayerIndex];
    const armed = localPlayer.stance.armedAction;
    if (localState.phase === 'rally' && armed !== 'none') {
      this.shotStanceRing.visible = true;
      this.shotStanceRing.position.set(localPlayer.pos.x, 0.018, localPlayer.pos.z);
      this.shotStanceRingMat.color.set(STANCE_RING_COLORS[armed]);
      const pulse = 1 + Math.sin(localState.tick * 0.28) * 0.06;
      this.shotStanceRing.scale.setScalar(pulse);
    } else {
      this.shotStanceRing.visible = false;
    }

    // CLEAN sweet-spot wave decay (0.32s)
    if (this.shockwaveTimer > 0) {
      this.shockwaveTimer = Math.max(0, this.shockwaveTimer - dt);
      const t = 1 - this.shockwaveTimer / 0.32;
      this.cleanShockwave.scale.setScalar(1 + t * 1.85);
      this.cleanShockwaveMat.opacity = (1 - t) * 0.82;
      if (this.shockwaveTimer <= 0) {
        this.cleanShockwave.visible = false;
      }
    }

    // Hawkeye 3D close-up & camera
    if (localState.phase === 'hawkeye' && localState.hawkeye.active) {
      this.renderHawkeye(localState.hawkeye, dt);
    } else {
      this.hawkeyeGroup.visible = false;
      const camX = THREE.MathUtils.clamp(localPlayer.pos.x * 0.22, -1.6, 1.6);
      const desiredPos = new THREE.Vector3(camX, 10.4, 24.0);
      const desiredTarget = new THREE.Vector3(camX * 0.3, 0.3, 1.8);
      const rate = 1 - Math.exp(-8 * dt);
      this.camPos.lerp(desiredPos, rate);
      this.camTarget.lerp(desiredTarget, rate);
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camTarget);
    }

    this.renderer.render(this.scene, this.camera);
  }

  public getDrawCalls(): number {
    return this.renderer.info.render.calls;
  }

  public dispose(): void {
    for (const a of this.avatars) {
      a.dispose();
    }
    this.surfaceTextures.hard.dispose();
    this.surfaceTextures.clay.dispose();
    this.surfaceTextures.grass.dispose();
    this.renderer.dispose();
  }

  private renderHawkeye(hk: HawkeyeState, dt: number): void {
    this.hawkeyeGroup.visible = true;
    const bp = hk.bouncePos;
    this.hawkeyeBallMark.position.set(bp.x, 0.012, bp.z);
    this.hawkeyePulseRing.position.set(bp.x, 0.014, bp.z);
    const pulse = 1 + Math.sin(hk.elapsedSec * 12) * 0.2;
    this.hawkeyePulseRing.scale.setScalar(pulse);
    (this.hawkeyeLineHighlight.material as THREE.MeshBasicMaterial).color.set(
      hk.isIn ? '#22e574' : '#ff4b5c'
    );

    if (hk.lineType === 'sideline') {
      const signX = bp.x >= 0 ? 1 : -1;
      this.hawkeyeLineHighlight.rotation.y = 0;
      this.hawkeyeLineHighlight.scale.set(1, 1, 1);
      this.hawkeyeLineHighlight.position.set(signX * COURT_DIM.SINGLES_HALF_WIDTH, 0.01, bp.z);
    } else if (hk.lineType === 'baseline') {
      const signZ = bp.z >= 0 ? 1 : -1;
      this.hawkeyeLineHighlight.rotation.y = Math.PI / 2;
      this.hawkeyeLineHighlight.scale.set(1, 1, 1);
      this.hawkeyeLineHighlight.position.set(bp.x, 0.01, signZ * COURT_DIM.HALF_LENGTH);
    } else if (hk.lineType === 'service_line') {
      const signZ = bp.z >= 0 ? 1 : -1;
      this.hawkeyeLineHighlight.rotation.y = Math.PI / 2;
      this.hawkeyeLineHighlight.scale.set(1, 1, 1);
      this.hawkeyeLineHighlight.position.set(bp.x, 0.01, signZ * COURT_DIM.SERVICE_LINE_Z);
    } else {
      this.hawkeyeLineHighlight.rotation.y = 0;
      this.hawkeyeLineHighlight.scale.set(1, 1, 1);
      this.hawkeyeLineHighlight.position.set(0, 0.01, bp.z);
    }

    const offsetSideX = bp.x >= 0 ? 0.65 : -0.65;
    const desiredCamPos = new THREE.Vector3(bp.x + offsetSideX, 0.42, bp.z + 0.95);
    const desiredTarget = new THREE.Vector3(bp.x, 0.02, bp.z);
    const rate = 1 - Math.exp(-10 * dt);
    this.camPos.lerp(desiredCamPos, rate);
    this.camTarget.lerp(desiredTarget, rate);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  private spawnClayDust(x: number, z: number): void {
    const p = this.dustParticles[this.dustCursor];
    this.dustCursor = (this.dustCursor + 1) % this.dustParticles.length;
    p.active = true;
    p.pos.set(x + (Math.random() - 0.5) * 0.25, 0.06, z + (Math.random() - 0.5) * 0.25);
    p.vel.set((Math.random() - 0.5) * 1.1, 0.5 + Math.random() * 0.7, (Math.random() - 0.5) * 1.1);
    p.age = 0;
    p.maxAge = 0.45 + Math.random() * 0.25;
  }

  private updateDust(dt: number): void {
    for (let i = 0; i < this.dustParticles.length; i++) {
      const p = this.dustParticles[i];
      if (!p.active) {
        this.dummy.position.set(0, -10, 0);
        this.dummy.scale.setScalar(0.001);
      } else {
        p.age += dt;
        if (p.age >= p.maxAge) {
          p.active = false;
          this.dummy.position.set(0, -10, 0);
          this.dummy.scale.setScalar(0.001);
        } else {
          p.pos.addScaledVector(p.vel, dt);
          p.vel.y -= 0.8 * dt;
          const life = p.age / p.maxAge;
          const scale = (0.7 + life * 1.4) * (1 - life);
          this.dummy.position.copy(p.pos);
          this.dummy.scale.setScalar(Math.max(0.001, scale));
        }
      }
      this.dummy.updateMatrix();
      this.dustMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.dustMesh.instanceMatrix.needsUpdate = true;
  }

  private buildCourtLines(): void {
    const lineMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const lw = 0.06;
    const y = 0.005;

    const addRectLine = (cx: number, cz: number, w: number, l: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(cx, y, cz);
      this.scene.add(m);
    };

    const fullL = COURT_DIM.HALF_LENGTH * 2;
    const doublesW = COURT_DIM.DOUBLES_HALF_WIDTH * 2 + lw;
    const singlesW = COURT_DIM.SINGLES_HALF_WIDTH * 2;

    // Baselines
    addRectLine(0, COURT_DIM.HALF_LENGTH, doublesW, lw * 1.3);
    addRectLine(0, -COURT_DIM.HALF_LENGTH, doublesW, lw * 1.3);
    // Doubles sidelines
    addRectLine(COURT_DIM.DOUBLES_HALF_WIDTH, 0, lw, fullL);
    addRectLine(-COURT_DIM.DOUBLES_HALF_WIDTH, 0, lw, fullL);
    // Singles sidelines
    addRectLine(COURT_DIM.SINGLES_HALF_WIDTH, 0, lw, fullL);
    addRectLine(-COURT_DIM.SINGLES_HALF_WIDTH, 0, lw, fullL);
    // Service lines
    addRectLine(0, COURT_DIM.SERVICE_LINE_Z, singlesW, lw);
    addRectLine(0, -COURT_DIM.SERVICE_LINE_Z, singlesW, lw);
    // Center service line
    addRectLine(0, 0, lw, COURT_DIM.SERVICE_LINE_Z * 2);
    // Center hash marks
    addRectLine(0, COURT_DIM.HALF_LENGTH - 0.14, lw, 0.24);
    addRectLine(0, -COURT_DIM.HALF_LENGTH + 0.14, lw, 0.24);
  }

  private buildNet(): void {
    const postGeo = new THREE.CylinderGeometry(0.045, 0.045, COURT_DIM.NET_POST_HEIGHT, 12);
    const postMat = new THREE.MeshStandardMaterial({ color: '#334155', metalness: 0.45, roughness: 0.35 });
    for (const sign of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(sign * COURT_DIM.NET_POST_X, COURT_DIM.NET_POST_HEIGHT / 2, 0);
      post.castShadow = true;
      this.scene.add(post);
    }

    const segs = 24;
    const netGeo = new THREE.PlaneGeometry(COURT_DIM.NET_POST_X * 2, 1.0, segs, 1);
    const posAttr = netGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const yNorm = posAttr.getY(i) + 0.5;
      posAttr.setY(i, yNorm * netHeightAt(x));
    }
    netGeo.computeVertexNormals();

    const netMat = new THREE.MeshBasicMaterial({
      map: makeNetTexture(),
      transparent: true,
      side: THREE.DoubleSide,
      opacity: 0.9,
    });
    const netMesh = new THREE.Mesh(netGeo, netMat);
    this.scene.add(netMesh);

    const tapeGeo = new THREE.PlaneGeometry(COURT_DIM.NET_POST_X * 2, 0.075, segs, 1);
    const tapeAttr = tapeGeo.attributes.position;
    for (let i = 0; i < tapeAttr.count; i++) {
      const x = tapeAttr.getX(i);
      const yOff = tapeAttr.getY(i);
      tapeAttr.setY(i, netHeightAt(x) + yOff - 0.02);
    }
    const tapeMesh = new THREE.Mesh(
      tapeGeo,
      new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide })
    );
    tapeMesh.position.z = 0.003;
    this.scene.add(tapeMesh);

    const strap = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, COURT_DIM.NET_CENTER_HEIGHT, 0.02),
      new THREE.MeshBasicMaterial({ color: '#ffffff' })
    );
    strap.position.set(0, COURT_DIM.NET_CENTER_HEIGHT / 2, 0);
    this.scene.add(strap);
  }

  private buildStadium(): void {
    const wallSpecs: Array<[number, number, number, number]> = [
      [0, -18.5, 22, 1.0],
      [0, 18.5, 22, 1.0],
      [-11.5, 0, 1.0, 37],
      [11.5, 0, 1.0, 37],
    ];

    for (const [x, z, w, d] of wallSpecs) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 0.95, d), this.boardMat);
      wall.position.set(x, 0.475, z);
      wall.receiveShadow = true;
      this.scene.add(wall);

      const strip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), this.accentStripMat);
      strip.position.set(x, 0.98, z);
      this.scene.add(strip);
    }

    // Light architectural umpire chair
    const chairMat = new THREE.MeshStandardMaterial({ color: '#e2e8f0', roughness: 0.45 });
    const chairBase = new THREE.Mesh(new THREE.BoxGeometry(0.65, 1.85, 0.65), chairMat);
    chairBase.position.set(-6.4, 0.925, 0);
    chairBase.castShadow = true;
    this.scene.add(chairBase);

    // Bright Grand Slam limestone/cream tiered stands
    for (let t = 0; t < 3; t++) {
      const back = new THREE.Mesh(new THREE.BoxGeometry(28, 1.2, 2.2), this.standMat);
      back.position.set(0, 1.2 + t * 1.15, -21.5 - t * 2.2);
      back.receiveShadow = true;
      this.scene.add(back);

      const left = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 42), this.standMat);
      left.position.set(-14.2 - t * 2.2, 1.2 + t * 1.15, 0);
      left.receiveShadow = true;
      this.scene.add(left);

      const right = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 42), this.standMat);
      right.position.set(14.2 + t * 2.2, 1.2 + t * 1.15, 0);
      right.receiveShadow = true;
      this.scene.add(right);
    }

    // Summer-dressed instanced spectators (1 single draw call)
    const spectatorCount = 240;
    const specMesh = new THREE.InstancedMesh(
      new THREE.CapsuleGeometry(0.18, 0.35, 4, 8),
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.72 }),
      spectatorCount
    );
    const palette = [
      new THREE.Color('#38bdf8'),
      new THREE.Color('#fbbf24'),
      new THREE.Color('#f8fafc'),
      new THREE.Color('#fb7185'),
      new THREE.Color('#34d399'),
      new THREE.Color('#f97316'),
    ];
    let idx = 0;
    for (let tier = 0; tier < 3 && idx < spectatorCount; tier++) {
      const y = 2.05 + tier * 1.15;
      for (let i = 0; i < 28 && idx < spectatorCount; i++) {
        this.dummy.position.set(-12 + i * 0.88, y, -21.2 - tier * 2.2);
        this.dummy.scale.setScalar(1);
        this.dummy.updateMatrix();
        specMesh.setMatrixAt(idx, this.dummy.matrix);
        specMesh.setColorAt(idx, palette[idx % palette.length]);
        idx++;
      }
      for (let i = 0; i < 26 && idx < spectatorCount; i++) {
        this.dummy.position.set(-14.0 - tier * 2.2, y, -18 + i * 1.45);
        this.dummy.updateMatrix();
        specMesh.setMatrixAt(idx, this.dummy.matrix);
        specMesh.setColorAt(idx, palette[(idx + 2) % palette.length]);
        idx++;
      }
      for (let i = 0; i < 26 && idx < spectatorCount; i++) {
        this.dummy.position.set(14.0 + tier * 2.2, y, -18 + i * 1.45);
        this.dummy.updateMatrix();
        specMesh.setMatrixAt(idx, this.dummy.matrix);
        specMesh.setColorAt(idx, palette[(idx + 4) % palette.length]);
        idx++;
      }
    }
    specMesh.count = idx;
    specMesh.instanceMatrix.needsUpdate = true;
    if (specMesh.instanceColor) specMesh.instanceColor.needsUpdate = true;
    this.scene.add(specMesh);

    // 4 Corner Stadium Architectural Pylons (light brushed silver-white)
    const towerMat = new THREE.MeshStandardMaterial({ color: '#e2e8f0', metalness: 0.25, roughness: 0.45 });
    const trimMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.35 });
    const corners: Array<[number, number]> = [
      [-17, -23],
      [17, -23],
      [-17, 23],
      [17, 23],
    ];
    for (const [cx, cz] of corners) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 12.5, 8), towerMat);
      pole.position.set(cx, 6.25, cz);
      this.scene.add(pole);

      const head = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.75, 0.35), trimMat);
      head.position.set(cx, 12.7, cz);
      head.lookAt(0, 0, 0);
      this.scene.add(head);
    }
  }
}
