import * as THREE from "three";
import { Potato, TUBERS_PER_PLANT } from "./Potato";
import { terrainHeight } from "../mars/environment/heightfield";

export type GardenPhase = "seed" | "compost" | "energy" | "won" | "lost";

/** 빔에서 에너지 공급 여부를 읽기 위한 최소 인터페이스(Beam이 만족). */
interface EnergySource {
  active: boolean;
  grounded: boolean;
  impactPoint: THREE.Vector3;
}

interface Projectile {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  delay: number;
  arc: number;
  onArrive: () => void;
}

/**
 * 감자밭 진행 관리.
 *  1) seed   — 플레이어가 오른손으로 조준·발사해 원하는 자리에 감자 씨앗을 심는다(3개)
 *  2) compost — 심은 자리마다 테라건에서 퇴비가 날아와 흙을 북돋운다
 *  3) energy  — 에너지가 나오기 시작. 이때부터 곤충이 등장하고,
 *               에너지 빔을 감자에 겨누면 감자가 자란다(자라는 동안 빛나며 보호됨).
 * 살아남은 감자가 모두 다 자라면 승리, 모두 파괴되면 패배.
 */
export class Garden {
  readonly potatoes: Potato[] = [];
  phase: GardenPhase = "seed";
  readonly maxPotatoes = 3;

  private phaseT = 0;
  private advanceTimer = -1; // 마지막으로 씨앗을 심은 뒤 이만큼 지나면 compost로 진행
  private readonly projectiles: Projectile[] = [];
  private readonly energizeRadius = 1.8;
  private readonly growthRate = 0.05; // 초당 성장(약 20초에 완전 성숙 — 감자알을 모두 맺기까지)
  private ended = false;
  private energyElapsed = 0; // 에너지 단계 진입 후 경과(초) — HUD 타이머용

  /** 감자알이 새로 돋을 때(월드 좌표) 호출 — 수확 연출·사운드용. main이 주입. */
  onHarvest: ((worldPos: THREE.Vector3) => void) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly muzzle: () => THREE.Vector3,
    private readonly onWin: () => void,
    private readonly onLose: () => void,
  ) {
    // 감자는 플레이어가 씨앗을 쏴서 직접 배치한다(초기엔 아무것도 없음).
  }

  /** 에너지 단계 이후 경과 시간(초). HUD 타이머 표시용. */
  get elapsedSec(): number {
    return this.energyElapsed;
  }

  /** 지금까지 수확한 감자알 총합. */
  get totalHarvest(): number {
    let n = 0;
    for (const p of this.potatoes) n += p.harvestCount;
    return n;
  }

  /** 현재 심긴 감자 기준 최대 감자알 수. */
  get maxHarvest(): number {
    return this.potatoes.length * TUBERS_PER_PLANT;
  }

  /** 에너지 단계 진입 여부(= 감자 성장/에너지 공급이 가능한 시점). */
  get energyStarted(): boolean {
    return this.phase === "energy" || this.phase === "won" || this.phase === "lost";
  }

  /** 곤충 위협 활성 여부(= 퇴비 단계부터 곤충 등장). */
  get threatsActive(): boolean {
    return (
      this.phase === "compost" ||
      this.phase === "energy" ||
      this.phase === "won" ||
      this.phase === "lost"
    );
  }

  get placedCount(): number {
    return this.potatoes.length;
  }

  /**
   * 씨앗 심기(seed 단계에서 오른손 발사 지점에 호출).
   * 테라건에서 씨앗이 날아와 그 자리에 심긴다. 최대 3개, 서로 너무 가까우면 무시.
   * @returns 심었는지 여부
   */
  plantAt(pos: THREE.Vector3): boolean {
    if (this.phase !== "seed") return false;
    if (this.potatoes.length >= this.maxPotatoes) return false;
    for (const p of this.potatoes) {
      if (Math.hypot(p.position.x - pos.x, p.position.z - pos.z) < 1.4) return false;
    }
    const y = terrainHeight(pos.x, pos.z);
    const pot = new Potato(new THREE.Vector3(pos.x, y, pos.z));
    pot.onTuberPop = (wp) => this.onHarvest?.(wp); // 감자알이 돋을 때 연출/사운드
    this.scene.add(pot.group);
    this.potatoes.push(pot);

    // 테라건에서 씨앗이 날아와 심긴다(도착 시 씨감자 노출).
    const seedMat = new THREE.MeshStandardMaterial({ color: 0x9c7a4d, roughness: 0.9 });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), seedMat);
    this.spawnProjectile(mesh, pot.position, 0, 0.55, 1.4, () => pot.plantSeed());

    // 마지막 심기 후 잠시 뒤 자동 진행(3개 다 심으면 더 빨리). 1개만 심어도 막히지 않는다.
    this.advanceTimer = this.potatoes.length >= this.maxPotatoes ? 1.5 : 3.5;
    return true;
  }

  private launchCompost(): void {
    const compMat = new THREE.MeshStandardMaterial({ color: 0x3a2a16, roughness: 1 });
    this.potatoes.forEach((pot, i) => {
      const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12, 0), compMat);
      this.spawnProjectile(mesh, pot.position, i * 0.4, 0.7, 1.4, () => pot.compost());
    });
  }

  private toCompost(): void {
    this.phase = "compost";
    this.phaseT = 0;
    this.launchCompost();
  }

  private spawnProjectile(
    mesh: THREE.Mesh,
    target: THREE.Vector3,
    delay: number,
    dur: number,
    arc: number,
    onArrive: () => void,
  ): void {
    mesh.visible = false;
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.projectiles.push({
      mesh,
      from: this.muzzle().clone(),
      to: target.clone().setY(target.y + 0.2),
      t: 0,
      dur,
      delay,
      arc,
      onArrive,
    });
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (p.delay > 0) {
        p.delay -= dt;
        continue;
      }
      p.mesh.visible = true;
      p.t += dt / p.dur;
      const k = Math.min(1, p.t);
      p.mesh.position.lerpVectors(p.from, p.to, k);
      p.mesh.position.y += Math.sin(Math.PI * k) * p.arc; // 포물선 아크
      p.mesh.rotation.x += dt * 6;
      if (p.t >= 1) {
        p.onArrive();
        this.scene.remove(p.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  update(dt: number, energyBeam: EnergySource): void {
    this.phaseT += dt;
    this.updateProjectiles(dt);

    // seed → compost: 플레이어가 씨앗을 직접 심고(≥1개) 마지막 심기 뒤 잠깐 지나면 진행.
    // (고정 위치 자동 심기는 제거 — 위치는 플레이어가 정한다.)
    if (this.phase === "seed") {
      if (this.advanceTimer > 0) {
        this.advanceTimer -= dt;
        if (this.advanceTimer <= 0) this.toCompost();
      }
    } else if (this.phase === "compost" && this.phaseT > 3.0) {
      this.phase = "energy";
      this.phaseT = 0;
    }

    if (this.phase === "energy") this.energyElapsed += dt;

    // 에너지 공급 판정: 감자별로 이번 프레임 발광 여부를 갱신
    for (const pot of this.potatoes) {
      pot.glowing = pot.grown; // 성숙한 감자는 상시 발광/보호
    }
    if (this.energyStarted && energyBeam.active && energyBeam.grounded) {
      for (const pot of this.potatoes) {
        if (!pot.alive || !pot.planted) continue;
        const dx = pot.position.x - energyBeam.impactPoint.x;
        const dz = pot.position.z - energyBeam.impactPoint.z;
        if (Math.hypot(dx, dz) < this.energizeRadius) {
          pot.growth = Math.min(1, pot.growth + this.growthRate * dt);
          pot.glowing = true;
        }
      }
    }

    for (const pot of this.potatoes) pot.update(dt);

    // 승패 판정(에너지 단계 이후)
    if (!this.ended && this.phase === "energy") {
      const anyAlive = this.potatoes.some((p) => p.alive);
      const anyGrowing = this.potatoes.some((p) => p.alive && !p.grown);
      if (!anyAlive) {
        this.ended = true;
        this.phase = "lost";
        this.onLose();
      } else if (!anyGrowing) {
        this.ended = true;
        this.phase = "won";
        this.onWin();
      }
    }
  }

  /** 재시작: 감자·발사체를 모두 치우고 씨앗 단계로 되돌린다(배열은 제자리에서 비운다). */
  reset(): void {
    for (const pot of this.potatoes) this.scene.remove(pot.group);
    this.potatoes.length = 0; // BugManager가 같은 배열을 참조하므로 재할당 대신 비운다.
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.projectiles.length = 0;
    this.phase = "seed";
    this.phaseT = 0;
    this.advanceTimer = -1;
    this.energyElapsed = 0;
    this.ended = false;
  }
}
