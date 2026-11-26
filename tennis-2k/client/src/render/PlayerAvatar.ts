import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { ArchetypeConfig, PlayerAnimState, PlayerState } from '@court2k/shared';
import type { AvatarStatus, PlayerAvatarController } from '../contracts.js';
import { normalizeBaseUrl } from '../net/WsClient.js';

const RECOLORABLE_MATERIALS = new Set([
  'Mat_JerseyPrimary',
  'Mat_JerseyAccent',
  'Mat_Shorts',
  'Mat_Skin',
  'Mat_Hair',
  'Mat_Socks',
  'Mat_ShoeUpper',
  'Mat_ShoeSole',
  'Mat_RacquetFrame',
  'Mat_RacquetStrings',
]);

const LOOPING_ANIMS = new Set<PlayerAnimState>(['idle', 'run', 'celebrate']);

const glbCache = new Map<string, Promise<GLTF>>();

function getDefaultGlbUrl(): string {
  const base =
    typeof import.meta !== 'undefined' && import.meta.env
      ? normalizeBaseUrl(import.meta.env.BASE_URL)
      : '/';
  return `${base}assets/models/tennis_player.glb`;
}

function loadSharedGlb(url: string): Promise<GLTF> {
  const cached = glbCache.get(url);
  if (cached) {
    return cached;
  }
  const loader = new GLTFLoader();
  const promise = new Promise<GLTF>((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve(gltf),
      undefined,
      (err) => reject(err)
    );
  });
  glbCache.set(url, promise);
  return promise;
}

function damp(current: number, target: number, lambda: number, dt: number): number {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

function countMeshTriangles(mesh: THREE.Mesh): number {
  const geom = mesh.geometry;
  if (!geom) return 0;
  if (geom.index) {
    return Math.round(geom.index.count / 3);
  }
  const pos = geom.getAttribute('position');
  return pos ? Math.round(pos.count / 3) : 0;
}

function isObjectChainVisible(obj: THREE.Object3D, stopAt: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = obj;
  while (cur) {
    if (!cur.visible) return false;
    if (cur === stopAt) break;
    cur = cur.parent;
  }
  return true;
}

function getRacquetFrameColor(config: ArchetypeConfig): string {
  switch (config.id) {
    case 'power':
      return '#991B1B';
    case 'serve_volley':
      return '#15803D';
    case 'defender':
      return '#365314';
    case 'allcourt':
    default:
      return '#1E293B';
  }
}

/**
 * Blender 5.2 stylized GLB player avatar controller.
 * Loads `tennis_player.glb`, clones skeleton & 10 recolorable materials per player,
 * switches headgear/wristbands, applies Chest shoulderScale, and drives 8 NLA clips.
 */
export class GlbPlayerAvatar implements PlayerAvatarController {
  public readonly root: THREE.Group;

  private readonly bodyPivot: THREE.Group;
  private readonly contactShadow: THREE.Mesh;
  private readonly shadowGeo: THREE.CircleGeometry;
  private readonly shadowMat: THREE.MeshBasicMaterial;

  private currentConfig: ArchetypeConfig;
  private modelRoot: THREE.Object3D | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<PlayerAnimState, THREE.AnimationAction>();
  private recolorMats = new Map<string, THREE.MeshStandardMaterial>();
  private clonedMaterials: THREE.Material[] = [];

  private chestBone: THREE.Object3D | null = null;
  private spineBone: THREE.Object3D | null = null;
  private headbandNode: THREE.Object3D | null = null;
  private visorNode: THREE.Object3D | null = null;
  private capBackwardsNode: THREE.Object3D | null = null;
  private wristbandLNode: THREE.Object3D | null = null;
  private wristbandRNode: THREE.Object3D | null = null;
  private racquetNode: THREE.Object3D | null = null;
  private meshes: THREE.Mesh[] = [];

  private loaded = false;
  private visibleTriangles = 0;
  private clipNames: string[] = [];
  private activeAnim: PlayerAnimState = 'idle';
  private lastAnimTime = 0;
  private coilYaw = 0;
  private disposed = false;

  constructor(initialConfig: ArchetypeConfig, glbUrl = getDefaultGlbUrl()) {
    this.currentConfig = initialConfig;
    this.root = new THREE.Group();
    this.bodyPivot = new THREE.Group();
    this.root.add(this.bodyPivot);

    this.shadowGeo = new THREE.CircleGeometry(0.42, 20);
    this.shadowMat = new THREE.MeshBasicMaterial({
      color: '#000000',
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    this.contactShadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.position.y = 0.008;
    this.root.add(this.contactShadow);

    void this.initFromGlb(glbUrl);
  }

  public setArchetype(config: ArchetypeConfig): void {
    this.currentConfig = config;
    if (this.loaded) {
      this.applyArchetypeToModel();
    }
  }

  public updatePose(player: PlayerState, dt: number): void {
    const safeDt = Math.min(0.1, Math.max(0.001, dt));
    this.root.position.set(player.pos.x, player.pos.y, player.pos.z);
    this.bodyPivot.rotation.y = damp(this.bodyPivot.rotation.y, player.yaw, 16, safeDt);

    if (!this.loaded || !this.mixer) {
      return;
    }

    const anim = player.anim;
    const isLooping = LOOPING_ANIMS.has(anim);
    const restartedOneShot = !isLooping && player.animTime < this.lastAnimTime - 0.04;

    if (anim !== this.activeAnim || restartedOneShot) {
      const nextAction = this.actions.get(anim) ?? this.actions.get('idle');
      const prevAction = this.actions.get(this.activeAnim);
      if (nextAction) {
        const fadeSec =
          anim === 'forehand' || anim === 'backhand' || anim === 'lob' || anim === 'serve_toss'
            ? 0.08
            : 0.14;

        nextAction.reset();
        nextAction.enabled = true;
        nextAction.setEffectiveTimeScale(1);
        nextAction.setEffectiveWeight(1);
        if (isLooping) {
          nextAction.setLoop(THREE.LoopRepeat, Infinity);
          nextAction.clampWhenFinished = false;
        } else {
          nextAction.setLoop(THREE.LoopOnce, 1);
          nextAction.clampWhenFinished = true;
        }
        nextAction.play();

        if (prevAction && prevAction !== nextAction) {
          prevAction.crossFadeTo(nextAction, fadeSec, false);
        }
      }
      this.activeAnim = anim;
    }
    this.lastAnimTime = player.animTime;

    this.mixer.update(safeDt);

    // Enforce shoulderScale on Chest bone and add soft armed-stance upper-body coil
    if (this.chestBone) {
      this.chestBone.scale.set(
        this.currentConfig.shoulderScale,
        1,
        this.currentConfig.id === 'defender' ? 0.94 : 1.0
      );

      const armed = player.stance.armedAction;
      const targetCoil =
        armed === 'none' || anim === 'serve_toss'
          ? 0
          : armed === 'K'
            ? -0.22
            : armed === 'L'
              ? 0.16
              : 0.28;
      this.coilYaw = damp(this.coilYaw, targetCoil, 14, safeDt);
      if (Math.abs(this.coilYaw) > 0.002) {
        if (this.spineBone) {
          this.spineBone.rotation.y += this.coilYaw * 0.45;
          this.chestBone.rotation.y += this.coilYaw * 0.55;
        } else {
          this.chestBone.rotation.y += this.coilYaw;
        }
      }
    }
  }

  public getStatus(): AvatarStatus {
    return {
      loaded: this.loaded,
      source: this.loaded ? 'glb' : 'fallback',
      triangles: this.visibleTriangles,
      clipNames: [...this.clipNames],
    };
  }

  public dispose(): void {
    this.disposed = true;
    if (this.mixer) {
      this.mixer.stopAllAction();
      if (this.modelRoot) {
        this.mixer.uncacheRoot(this.modelRoot);
      }
      this.mixer = null;
    }
    for (const mat of this.clonedMaterials) {
      mat.dispose();
    }
    this.clonedMaterials = [];
    this.recolorMats.clear();
    this.shadowGeo.dispose();
    this.shadowMat.dispose();
  }

  private async initFromGlb(url: string): Promise<void> {
    try {
      const gltf = await loadSharedGlb(url);
      if (this.disposed) return;

      const cloned = SkeletonUtils.clone(gltf.scene);
      this.modelRoot = cloned;
      this.bodyPivot.add(cloned);

      this.recolorMats.clear();
      this.meshes = [];

      cloned.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          mesh.castShadow = true;
          mesh.frustumCulled = false;
          this.meshes.push(mesh);

          if (Array.isArray(mesh.material)) {
            mesh.material = mesh.material.map((m) => this.cloneRecolorableIfNeeded(m));
          } else if (mesh.material) {
            mesh.material = this.cloneRecolorableIfNeeded(mesh.material);
          }
        }
      });

      this.chestBone = cloned.getObjectByName('Chest') ?? null;
      this.spineBone = cloned.getObjectByName('Spine') ?? null;
      this.headbandNode = cloned.getObjectByName('Headgear_Headband') ?? null;
      this.visorNode = cloned.getObjectByName('Headgear_Visor') ?? null;
      this.capBackwardsNode = cloned.getObjectByName('Headgear_CapBackwards') ?? null;
      this.wristbandLNode = cloned.getObjectByName('Wristband_L') ?? null;
      this.wristbandRNode = cloned.getObjectByName('Wristband_R') ?? null;
      this.racquetNode = cloned.getObjectByName('Racquet') ?? null;

      this.mixer = new THREE.AnimationMixer(cloned);
      this.actions.clear();
      this.clipNames = [];

      for (const clip of gltf.animations) {
        this.clipNames.push(clip.name);
        const action = this.mixer.clipAction(clip);
        this.actions.set(clip.name as PlayerAnimState, action);
      }

      const idleAction = this.actions.get('idle');
      if (idleAction) {
        idleAction.reset();
        idleAction.setLoop(THREE.LoopRepeat, Infinity);
        idleAction.play();
      }
      this.activeAnim = 'idle';

      this.loaded = true;
      this.applyArchetypeToModel();
    } catch (err) {
      this.loaded = false;
      this.visibleTriangles = 0;
      this.clipNames = [];
      console.error(`[GlbPlayerAvatar] Failed to load avatar model from ${url}:`, err);
    }
  }

  private cloneRecolorableIfNeeded(mat: THREE.Material): THREE.Material {
    if (!RECOLORABLE_MATERIALS.has(mat.name)) {
      return mat;
    }
    const existing = this.recolorMats.get(mat.name);
    if (existing) {
      return existing;
    }
    const cloned = mat.clone() as THREE.MeshStandardMaterial;
    this.recolorMats.set(mat.name, cloned);
    this.clonedMaterials.push(cloned);
    return cloned;
  }

  private applyArchetypeToModel(): void {
    const cfg = this.currentConfig;

    this.setMatColor('Mat_JerseyPrimary', cfg.jerseyPrimary);
    this.setMatColor('Mat_JerseyAccent', cfg.jerseyAccent);
    this.setMatColor('Mat_Shorts', cfg.shortsColor);
    this.setMatColor('Mat_Skin', cfg.skinTone);
    this.setMatColor('Mat_Hair', cfg.hairColor);
    this.setMatColor('Mat_Socks', '#F1F5F9');
    this.setMatColor('Mat_ShoeUpper', cfg.id === 'serve_volley' ? '#F8FAFC' : '#E2E8F0');
    this.setMatColor('Mat_ShoeSole', '#1E293B');
    this.setMatColor('Mat_RacquetFrame', getRacquetFrameColor(cfg));
    this.setMatColor('Mat_RacquetStrings', '#F1F5F9');

    if (this.headbandNode) {
      this.headbandNode.visible = cfg.headgear === 'headband';
    }
    if (this.visorNode) {
      this.visorNode.visible = cfg.headgear === 'visor';
    }
    if (this.capBackwardsNode) {
      this.capBackwardsNode.visible = cfg.headgear === 'cap_backwards';
    }
    const showWristbands = cfg.headgear === 'headband' || cfg.headgear === 'wristband_only';
    if (this.wristbandLNode) {
      this.wristbandLNode.visible = showWristbands;
    }
    if (this.wristbandRNode) {
      this.wristbandRNode.visible = showWristbands;
    }
    if (this.racquetNode) {
      this.racquetNode.visible = true;
    }

    if (this.chestBone) {
      this.chestBone.scale.set(cfg.shoulderScale, 1, cfg.id === 'defender' ? 0.94 : 1.0);
    }

    if (this.modelRoot) {
      let tris = 0;
      for (const mesh of this.meshes) {
        if (isObjectChainVisible(mesh, this.modelRoot)) {
          tris += countMeshTriangles(mesh);
        }
      }
      this.visibleTriangles = tris;
    }
  }

  private setMatColor(name: string, hex: string): void {
    const mat = this.recolorMats.get(name);
    if (mat && mat.color) {
      mat.color.set(hex);
    }
  }
}
