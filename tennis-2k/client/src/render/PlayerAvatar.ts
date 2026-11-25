import * as THREE from 'three';
import type { ArchetypeConfig, PlayerState } from '@court2k/shared';
import type { PlayerAvatarController } from '../contracts.js';

function damp(current: number, target: number, lambda: number, dt: number): number {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

function createStringTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, 64, 64);
    ctx.strokeStyle = 'rgba(240, 244, 248, 0.55)';
    ctx.lineWidth = 2;
    for (let i = 6; i < 64; i += 8) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 64);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(64, i);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export class ProceduralPlayerAvatar implements PlayerAvatarController {
  public readonly root: THREE.Group;

  private readonly bodyPivot: THREE.Group;
  private readonly hips: THREE.Group;
  private readonly torsoGroup: THREE.Group;
  private readonly chestMesh: THREE.Mesh;
  private readonly chestStripe: THREE.Mesh;
  private readonly shortsMesh: THREE.Mesh;
  private readonly headGroup: THREE.Group;

  private readonly leftShoulder: THREE.Group;
  private readonly leftElbow: THREE.Group;
  private readonly leftWristband: THREE.Mesh;

  private readonly rightShoulder: THREE.Group;
  private readonly rightElbow: THREE.Group;
  private readonly rightWristband: THREE.Mesh;
  private readonly racquetGroup: THREE.Group;

  private readonly leftHip: THREE.Group;
  private readonly leftKnee: THREE.Group;
  private readonly leftShoe: THREE.Mesh;

  private readonly rightHip: THREE.Group;
  private readonly rightKnee: THREE.Group;
  private readonly rightShoe: THREE.Mesh;

  private readonly headgearGroup: THREE.Group;
  private readonly headbandMesh: THREE.Group;
  private readonly visorMesh: THREE.Group;
  private readonly capBackMesh: THREE.Group;

  private readonly takeoverAura: THREE.Group;
  private readonly takeoverRing: THREE.Mesh;
  private readonly contactShadow: THREE.Mesh;

  private readonly jerseyMat: THREE.MeshStandardMaterial;
  private readonly accentMat: THREE.MeshStandardMaterial;
  private readonly shortsMat: THREE.MeshStandardMaterial;
  private readonly skinMat: THREE.MeshStandardMaterial;
  private readonly hairMat: THREE.MeshStandardMaterial;
  private readonly stringTex: THREE.CanvasTexture;

  private readonly disposables: Array<{ dispose: () => void }> = [];

  constructor(initialConfig: ArchetypeConfig) {
    this.root = new THREE.Group();
    this.bodyPivot = new THREE.Group();
    this.root.add(this.bodyPivot);

    this.jerseyMat = new THREE.MeshStandardMaterial({
      color: initialConfig.jerseyPrimary,
      roughness: 0.55,
      metalness: 0.05,
    });
    this.accentMat = new THREE.MeshStandardMaterial({
      color: initialConfig.jerseyAccent,
      roughness: 0.45,
      metalness: 0.08,
    });
    this.shortsMat = new THREE.MeshStandardMaterial({
      color: '#1b2333',
      roughness: 0.65,
    });
    this.skinMat = new THREE.MeshStandardMaterial({
      color: '#d99b78',
      roughness: 0.62,
    });
    this.hairMat = new THREE.MeshStandardMaterial({
      color: '#1e1a18',
      roughness: 0.8,
    });
    const frameMat = new THREE.MeshStandardMaterial({
      color: '#1f2937',
      roughness: 0.35,
      metalness: 0.5,
    });
    const gripMat = new THREE.MeshStandardMaterial({
      color: '#111827',
      roughness: 0.8,
    });
    this.stringTex = createStringTexture();
    const stringMat = new THREE.MeshBasicMaterial({
      map: this.stringTex,
      transparent: true,
      side: THREE.DoubleSide,
      opacity: 0.85,
    });
    const shadowMat = new THREE.MeshBasicMaterial({
      color: '#000000',
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    const auraMat = new THREE.MeshBasicMaterial({
      color: '#fbbf24',
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.disposables.push(
      this.jerseyMat,
      this.accentMat,
      this.shortsMat,
      this.skinMat,
      this.hairMat,
      frameMat,
      gripMat,
      stringMat,
      this.stringTex,
      shadowMat,
      auraMat
    );

    // Ground contact shadow
    const shadowGeo = new THREE.CircleGeometry(0.42, 20);
    this.disposables.push(shadowGeo);
    this.contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.position.y = 0.008;
    this.root.add(this.contactShadow);

    // Takeover golden aura at feet
    this.takeoverAura = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(0.46, 0.62, 32);
    this.disposables.push(ringGeo);
    this.takeoverRing = new THREE.Mesh(ringGeo, auraMat);
    this.takeoverRing.rotation.x = -Math.PI / 2;
    this.takeoverRing.position.y = 0.02;
    this.takeoverAura.add(this.takeoverRing);
    this.takeoverAura.visible = false;
    this.root.add(this.takeoverAura);

    // Hips & Torso
    this.hips = new THREE.Group();
    this.hips.position.y = 0.92;
    this.bodyPivot.add(this.hips);

    const shortsGeo = new THREE.CylinderGeometry(0.16, 0.19, 0.22, 14);
    this.disposables.push(shortsGeo);
    this.shortsMesh = new THREE.Mesh(shortsGeo, this.shortsMat);
    this.shortsMesh.position.y = -0.02;
    this.shortsMesh.castShadow = true;
    this.hips.add(this.shortsMesh);

    this.torsoGroup = new THREE.Group();
    this.torsoGroup.position.y = 0.08;
    this.hips.add(this.torsoGroup);

    const chestGeo = new THREE.CapsuleGeometry(0.165, 0.26, 6, 14);
    this.disposables.push(chestGeo);
    this.chestMesh = new THREE.Mesh(chestGeo, this.jerseyMat);
    this.chestMesh.position.y = 0.24;
    this.chestMesh.scale.set(1.12, 1.0, 0.78);
    this.chestMesh.castShadow = true;
    this.torsoGroup.add(this.chestMesh);

    const stripeGeo = new THREE.CylinderGeometry(0.172, 0.172, 0.065, 16);
    this.disposables.push(stripeGeo);
    this.chestStripe = new THREE.Mesh(stripeGeo, this.accentMat);
    this.chestStripe.position.y = 0.26;
    this.chestStripe.scale.set(1.12, 1.0, 0.78);
    this.torsoGroup.add(this.chestStripe);

    // Neck & Head
    this.headGroup = new THREE.Group();
    this.headGroup.position.y = 0.52;
    this.torsoGroup.add(this.headGroup);

    const neckGeo = new THREE.CylinderGeometry(0.055, 0.062, 0.1, 10);
    const headGeo = new THREE.SphereGeometry(0.135, 16, 14);
    const hairGeo = new THREE.SphereGeometry(0.141, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.58);
    this.disposables.push(neckGeo, headGeo, hairGeo);

    const neck = new THREE.Mesh(neckGeo, this.skinMat);
    neck.position.y = 0.03;
    this.headGroup.add(neck);

    const head = new THREE.Mesh(headGeo, this.skinMat);
    head.position.y = 0.16;
    head.castShadow = true;
    this.headGroup.add(head);

    const hair = new THREE.Mesh(hairGeo, this.hairMat);
    hair.position.y = 0.17;
    hair.rotation.x = 0.2;
    this.headGroup.add(hair);

    // Headgear container
    this.headgearGroup = new THREE.Group();
    this.headgearGroup.position.y = 0.16;
    this.headGroup.add(this.headgearGroup);

    // 1. Headband
    this.headbandMesh = new THREE.Group();
    const hbTorus = new THREE.TorusGeometry(0.14, 0.02, 8, 22);
    const hbTailGeo = new THREE.BoxGeometry(0.03, 0.11, 0.015);
    this.disposables.push(hbTorus, hbTailGeo);
    const hbRing = new THREE.Mesh(hbTorus, this.accentMat);
    hbRing.rotation.x = Math.PI / 2 - 0.12;
    hbRing.position.y = 0.045;
    const hbTail = new THREE.Mesh(hbTailGeo, this.accentMat);
    hbTail.position.set(0.02, 0.01, 0.145);
    hbTail.rotation.x = 0.35;
    this.headbandMesh.add(hbRing, hbTail);
    this.headgearGroup.add(this.headbandMesh);

    // 2. Visor (brim extends forward toward -Z)
    this.visorMesh = new THREE.Group();
    const visorBandGeo = new THREE.TorusGeometry(0.142, 0.019, 8, 22);
    const visorBrimGeo = new THREE.CylinderGeometry(0.16, 0.19, 0.016, 16, 1, false, Math.PI - 0.85, 1.7);
    this.disposables.push(visorBandGeo, visorBrimGeo);
    const vBand = new THREE.Mesh(visorBandGeo, this.jerseyMat);
    vBand.rotation.x = Math.PI / 2 - 0.08;
    vBand.position.y = 0.05;
    const vBrim = new THREE.Mesh(visorBrimGeo, this.accentMat);
    vBrim.position.set(0, 0.045, -0.06);
    vBrim.rotation.x = 0.12;
    this.visorMesh.add(vBand, vBrim);
    this.headgearGroup.add(this.visorMesh);

    // 3. Backwards Cap (brim extends backward toward +Z)
    this.capBackMesh = new THREE.Group();
    const capDomeGeo = new THREE.SphereGeometry(0.147, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.56);
    const capBrimGeo = new THREE.CylinderGeometry(0.14, 0.16, 0.016, 14, 1, false, -0.75, 1.5);
    this.disposables.push(capDomeGeo, capBrimGeo);
    const capDome = new THREE.Mesh(capDomeGeo, this.accentMat);
    capDome.position.y = 0.02;
    const capBrim = new THREE.Mesh(capBrimGeo, this.jerseyMat);
    capBrim.position.set(0, 0.03, 0.08);
    capBrim.rotation.x = 0.16;
    this.capBackMesh.add(capDome, capBrim);
    this.headgearGroup.add(this.capBackMesh);

    // Arms helper geometries
    const shoulderGeo = new THREE.SphereGeometry(0.06, 10, 10);
    const upperArmGeo = new THREE.CapsuleGeometry(0.045, 0.2, 5, 10);
    const forearmGeo = new THREE.CapsuleGeometry(0.038, 0.2, 5, 10);
    const wristGeo = new THREE.CylinderGeometry(0.044, 0.044, 0.055, 12);
    this.disposables.push(shoulderGeo, upperArmGeo, forearmGeo, wristGeo);

    // Left Arm
    this.leftShoulder = new THREE.Group();
    this.leftShoulder.position.set(-0.23, 0.42, 0);
    this.torsoGroup.add(this.leftShoulder);
    this.leftShoulder.add(new THREE.Mesh(shoulderGeo, this.jerseyMat));
    const lUpper = new THREE.Mesh(upperArmGeo, this.skinMat);
    lUpper.position.y = -0.14;
    lUpper.castShadow = true;
    this.leftShoulder.add(lUpper);

    this.leftElbow = new THREE.Group();
    this.leftElbow.position.y = -0.28;
    this.leftShoulder.add(this.leftElbow);
    const lFore = new THREE.Mesh(forearmGeo, this.skinMat);
    lFore.position.y = -0.12;
    lFore.castShadow = true;
    this.leftElbow.add(lFore);
    this.leftWristband = new THREE.Mesh(wristGeo, this.accentMat);
    this.leftWristband.position.y = -0.21;
    this.leftElbow.add(this.leftWristband);

    // Right Arm + Racquet
    this.rightShoulder = new THREE.Group();
    this.rightShoulder.position.set(0.23, 0.42, 0);
    this.torsoGroup.add(this.rightShoulder);
    this.rightShoulder.add(new THREE.Mesh(shoulderGeo, this.jerseyMat));
    const rUpper = new THREE.Mesh(upperArmGeo, this.skinMat);
    rUpper.position.y = -0.14;
    rUpper.castShadow = true;
    this.rightShoulder.add(rUpper);

    this.rightElbow = new THREE.Group();
    this.rightElbow.position.y = -0.28;
    this.rightShoulder.add(this.rightElbow);
    const rFore = new THREE.Mesh(forearmGeo, this.skinMat);
    rFore.position.y = -0.12;
    rFore.castShadow = true;
    this.rightElbow.add(rFore);
    this.rightWristband = new THREE.Mesh(wristGeo, this.accentMat);
    this.rightWristband.position.y = -0.21;
    this.rightElbow.add(this.rightWristband);

    // 3D Tennis Racquet
    this.racquetGroup = new THREE.Group();
    this.racquetGroup.position.set(0, -0.25, -0.02);
    this.racquetGroup.rotation.x = -Math.PI * 0.42;
    this.rightElbow.add(this.racquetGroup);

    const handleGeo = new THREE.CylinderGeometry(0.017, 0.02, 0.22, 10);
    const throatGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.14, 8);
    const hoopGeo = new THREE.TorusGeometry(0.135, 0.014, 8, 24);
    const stringsGeo = new THREE.CircleGeometry(0.13, 20);
    this.disposables.push(handleGeo, throatGeo, hoopGeo, stringsGeo);

    const handle = new THREE.Mesh(handleGeo, gripMat);
    handle.position.y = 0.1;
    const throatL = new THREE.Mesh(throatGeo, frameMat);
    throatL.position.set(-0.04, 0.26, 0);
    throatL.rotation.z = -0.32;
    const throatR = new THREE.Mesh(throatGeo, frameMat);
    throatR.position.set(0.04, 0.26, 0);
    throatR.rotation.z = 0.32;
    const hoop = new THREE.Mesh(hoopGeo, this.accentMat);
    hoop.position.y = 0.47;
    hoop.scale.set(0.95, 1.28, 1.0);
    hoop.castShadow = true;
    const strings = new THREE.Mesh(stringsGeo, stringMat);
    strings.position.y = 0.47;
    strings.scale.set(0.95, 1.28, 1.0);
    this.racquetGroup.add(handle, throatL, throatR, hoop, strings);

    // Legs
    const thighGeo = new THREE.CapsuleGeometry(0.068, 0.28, 5, 12);
    const shinGeo = new THREE.CapsuleGeometry(0.052, 0.28, 5, 12);
    const shoeGeo = new THREE.BoxGeometry(0.11, 0.07, 0.22);
    this.disposables.push(thighGeo, shinGeo, shoeGeo);

    this.leftHip = new THREE.Group();
    this.leftHip.position.set(-0.1, -0.05, 0);
    this.hips.add(this.leftHip);
    const lThigh = new THREE.Mesh(thighGeo, this.skinMat);
    lThigh.position.y = -0.2;
    lThigh.castShadow = true;
    this.leftHip.add(lThigh);
    this.leftKnee = new THREE.Group();
    this.leftKnee.position.y = -0.42;
    this.leftHip.add(this.leftKnee);
    const lShin = new THREE.Mesh(shinGeo, this.skinMat);
    lShin.position.y = -0.2;
    lShin.castShadow = true;
    this.leftKnee.add(lShin);
    this.leftShoe = new THREE.Mesh(shoeGeo, this.accentMat);
    this.leftShoe.position.set(0, -0.42, -0.04);
    this.leftShoe.castShadow = true;
    this.leftKnee.add(this.leftShoe);

    this.rightHip = new THREE.Group();
    this.rightHip.position.set(0.1, -0.05, 0);
    this.hips.add(this.rightHip);
    const rThigh = new THREE.Mesh(thighGeo, this.skinMat);
    rThigh.position.y = -0.2;
    rThigh.castShadow = true;
    this.rightHip.add(rThigh);
    this.rightKnee = new THREE.Group();
    this.rightKnee.position.y = -0.42;
    this.rightHip.add(this.rightKnee);
    const rShin = new THREE.Mesh(shinGeo, this.skinMat);
    rShin.position.y = -0.2;
    rShin.castShadow = true;
    this.rightKnee.add(rShin);
    this.rightShoe = new THREE.Mesh(shoeGeo, this.accentMat);
    this.rightShoe.position.set(0, -0.42, -0.04);
    this.rightShoe.castShadow = true;
    this.rightKnee.add(this.rightShoe);

    this.setArchetype(initialConfig);
  }

  public setArchetype(config: ArchetypeConfig): void {
    this.jerseyMat.color.set(config.jerseyPrimary);
    this.accentMat.color.set(config.jerseyAccent);
    this.shortsMat.color.set(config.id === 'serve_volley' ? '#e5e7eb' : '#182030');

    this.torsoGroup.scale.set(config.shoulderScale, 1, config.id === 'defender' ? 0.94 : 1.0);

    this.headbandMesh.visible = config.headgear === 'headband';
    this.visorMesh.visible = config.headgear === 'visor';
    this.capBackMesh.visible = config.headgear === 'cap_backwards';
    const showWristbands = config.headgear === 'wristband_only' || config.headgear === 'headband';
    this.leftWristband.visible = showWristbands;
    this.rightWristband.visible = showWristbands;
  }

  public updatePose(player: PlayerState, dt: number): void {
    const safeDt = Math.min(0.1, Math.max(0.001, dt));

    this.root.position.set(player.pos.x, player.pos.y, player.pos.z);
    // In Three.js: yaw = 0 faces -Z, yaw = PI faces +Z
    this.bodyPivot.rotation.y = damp(this.bodyPivot.rotation.y, player.yaw, 16, safeDt);

    // Takeover aura pulse
    const isTakeover = player.takeoverPointsLeft > 0;
    this.takeoverAura.visible = isTakeover;
    if (isTakeover) {
      const pulse = 1 + Math.sin(player.animTime * 9) * 0.1;
      this.takeoverRing.scale.set(pulse, pulse, 1);
      this.takeoverRing.rotation.z += safeDt * 2.5;
    }

    const t = player.animTime;
    let hipY = 0.92;
    let torsoPitch = 0.08;
    let torsoYaw = 0;
    let lShoulderX = 0.25;
    let lShoulderZ = -0.22;
    let lElbowX = -0.65;
    let rShoulderX = 0.25;
    let rShoulderZ = 0.24;
    let rElbowX = -0.75;
    let lHipX = 0.08;
    let lKneeX = -0.16;
    let rHipX = -0.08;
    let rKneeX = -0.16;

    const charging = player.meter.active;

    switch (player.anim) {
      case 'run': {
        const stride = Math.sin(t * 14);
        hipY = 0.91 + Math.abs(Math.cos(t * 14)) * 0.04;
        torsoPitch = 0.22;
        torsoYaw = stride * 0.12;
        lHipX = stride * 0.65;
        rHipX = -stride * 0.65;
        lKneeX = Math.min(-0.12, -0.45 + stride * 0.35);
        rKneeX = Math.min(-0.12, -0.45 - stride * 0.35);
        lShoulderX = -stride * 0.55;
        rShoulderX = stride * 0.45;
        lElbowX = -0.9;
        rElbowX = -0.85;
        break;
      }
      case 'slide': {
        hipY = 0.72;
        torsoPitch = 0.3;
        torsoYaw = -0.35;
        lHipX = 0.78;
        lKneeX = -0.35;
        rHipX = -0.58;
        rKneeX = -0.65;
        lShoulderX = -0.4;
        lShoulderZ = -0.6;
        rShoulderX = 0.4;
        rShoulderZ = 0.65;
        break;
      }
      case 'serve_toss': {
        hipY = 0.93;
        torsoPitch = -0.14;
        torsoYaw = 0.45;
        const tossCycle = Math.min(1, t / 0.55);
        lShoulderX = -2.4 * tossCycle;
        lElbowX = -0.2;
        rShoulderX = -1.6;
        rShoulderZ = 0.55;
        rElbowX = -1.45;
        lHipX = 0.12;
        rHipX = -0.12;
        break;
      }
      case 'forehand': {
        const p = Math.min(1, t / 0.28);
        hipY = 0.89;
        torsoPitch = 0.18;
        torsoYaw = THREE.MathUtils.lerp(0.6, -0.75, p);
        rShoulderX = THREE.MathUtils.lerp(-0.4, 1.35, p);
        rShoulderZ = THREE.MathUtils.lerp(0.65, -0.35, p);
        rElbowX = -0.45;
        lShoulderX = 0.35;
        lShoulderZ = -0.45;
        break;
      }
      case 'backhand': {
        const p = Math.min(1, t / 0.28);
        hipY = 0.89;
        torsoPitch = 0.18;
        torsoYaw = THREE.MathUtils.lerp(-0.65, 0.7, p);
        rShoulderX = THREE.MathUtils.lerp(-0.2, 1.25, p);
        rShoulderZ = THREE.MathUtils.lerp(-0.55, 0.55, p);
        rElbowX = -0.35;
        lShoulderX = 0.55;
        lShoulderZ = 0.2;
        break;
      }
      case 'lob': {
        const p = Math.min(1, t / 0.32);
        hipY = 0.88;
        torsoPitch = -0.05;
        rShoulderX = THREE.MathUtils.lerp(-0.5, 2.0, p);
        rElbowX = -0.25;
        break;
      }
      case 'celebrate': {
        const jump = Math.abs(Math.sin(t * 7)) * 0.22;
        hipY = 0.92 + jump;
        torsoPitch = -0.08;
        lShoulderX = -2.35;
        lShoulderZ = -0.35;
        rShoulderX = -2.35;
        rShoulderZ = 0.35;
        lElbowX = -0.3;
        rElbowX = -0.3;
        break;
      }
      case 'idle':
      default: {
        const breathe = Math.sin(t * 3.5);
        hipY = 0.9 + breathe * 0.015;
        torsoPitch = 0.14;
        lShoulderX = 0.35;
        rShoulderX = 0.35;
        lElbowX = -0.9;
        rElbowX = -0.9;
        lHipX = 0.14;
        lKneeX = -0.28;
        rHipX = -0.08;
        rKneeX = -0.24;
        break;
      }
    }

    // Visual coil while charging the 2K shot meter
    if (charging && player.anim !== 'serve_toss') {
      torsoYaw = 0.62;
      rShoulderX = -0.35;
      rShoulderZ = 0.75;
      rElbowX = -0.85;
    }

    const rate = 18;
    this.hips.position.y = damp(this.hips.position.y, hipY, rate, safeDt);
    this.torsoGroup.rotation.x = damp(this.torsoGroup.rotation.x, torsoPitch, rate, safeDt);
    this.torsoGroup.rotation.y = damp(this.torsoGroup.rotation.y, torsoYaw, rate, safeDt);

    this.leftShoulder.rotation.x = damp(this.leftShoulder.rotation.x, lShoulderX, rate, safeDt);
    this.leftShoulder.rotation.z = damp(this.leftShoulder.rotation.z, lShoulderZ, rate, safeDt);
    this.leftElbow.rotation.x = damp(this.leftElbow.rotation.x, lElbowX, rate, safeDt);

    this.rightShoulder.rotation.x = damp(this.rightShoulder.rotation.x, rShoulderX, rate, safeDt);
    this.rightShoulder.rotation.z = damp(this.rightShoulder.rotation.z, rShoulderZ, rate, safeDt);
    this.rightElbow.rotation.x = damp(this.rightElbow.rotation.x, rElbowX, rate, safeDt);

    this.leftHip.rotation.x = damp(this.leftHip.rotation.x, lHipX, rate, safeDt);
    this.leftKnee.rotation.x = damp(this.leftKnee.rotation.x, lKneeX, rate, safeDt);
    this.rightHip.rotation.x = damp(this.rightHip.rotation.x, rHipX, rate, safeDt);
    this.rightKnee.rotation.x = damp(this.rightKnee.rotation.x, rKneeX, rate, safeDt);
  }

  public dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
