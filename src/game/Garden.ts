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
  private readonly shieldLinger = 1.8; // 빔이 떠난 뒤에도 보호막이 유지되는 시간(초)
  private ended = false;
  private missionElapsed = 0; // 첫 씨앗을 심은 순간부터의 경과(초) — HUD 타이머·승리 판정용
  private timerStarted = false; // 첫 씨앗을 심으면 타이머 시작
  readonly survivalDuration = 60; // 60초 방어 목표
  /** 승리 사유: 감자를 모두 키움("grown") vs 60초 방어 성공("survived"). */
  winReason: "grown" | "survived" | null = null;
  /** 결과 등급: 3그루 모두 지킴(perfect) · 1~2그루 지킴(partial) · 전멸(fail). */
  resultTier: "perfect" | "partial" | "fail" | null = null;
  /** 종료 시점 살아남은 감자 수(결과 문구·통계용). */
  survivors = 0;
  /** 연습 모드: 타이머와 승패 판정을 멈춘다(무한 연습). main이 진입 시 설정. */
  practice = false;

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

  /** 첫 씨앗을 심은 순간부터의 경과 시간(초). WAVE 계산 등에 사용. */
  get elapsedSec(): number {
    return this.missionElapsed;
  }

  /** 60초 방어 카운트다운 남은 시간(초). HUD 타이머 표시용. */
  get timeLeft(): number {
    return Math.max(0, this.survivalDuration - this.missionElapsed);
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

  /** 버틴 시간(초, 60초 상한). 결과 통계·점수용. */
  get survivedSec(): number {
    return Math.min(Math.floor(this.missionElapsed), this.survivalDuration);
  }

  /**
   * 최종 점수 = 수확한 감자알×100 + 살아남은 그루×500 + 버틴 시간(초)×10.
   * 종료 시점(survivors 확정 후)에 읽는다. 완전 방어 시 대략 3600점대.
   */
  get finalScore(): number {
    return this.totalHarvest * 100 + this.survivors * 500 + this.survivedSec * 10;
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

    // 씨앗 3개를 모두 심어야 다음 단계(퇴비)로 진행한다. 그 전에는 자동 진행하지 않으므로
    // 곤충도 오지 않고, 남은 자리를 천천히 다 심을 수 있다(손 제스처가 느려도 막히지 않음).
    this.advanceTimer = this.potatoes.length >= this.maxPotatoes ? 1.5 : -1;
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
    this.timerStarted = true; // 곤충이 등장하는 이 순간부터 60초 방어 카운트다운 시작
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

    // 타이머는 곤충이 등장하는 퇴비 단계부터(퇴비·에너지 관통) 게임 종료 전까지 흐른다.
    // 연습 모드에서는 시간이 흐르지 않아 카운트다운·승패가 발생하지 않는다.
    if (this.timerStarted && !this.ended && !this.practice) this.missionElapsed += dt;

    // 에너지 공급 판정. 보호막(glowing)은 남은 shield 시간으로 유지된다.
    //  - 매 프레임 shield를 흘려보내고(glowing = shield>0),
    //  - 빔은 "가장 가까운 한 그루"만 키우고 그 그루의 shield를 가득 채운다.
    // → 감자 3개를 붙여 심어 빔 하나로 셋 다 동시에 지키던 전략을 막는다(근접 심기 무력화).
    //   대신 shield가 잠깐(shieldLinger초) 남으므로, 빔을 세 그루 사이로 훑으며 번갈아 지킬 수 있다.
    // 다 자란 감자라도 방치하면 곤충이 갉아먹어 성장이 되돌아가므로 계속 지켜야 한다.
    for (const pot of this.potatoes) {
      pot.shield = Math.max(0, pot.shield - dt);
      pot.glowing = pot.shield > 0;
    }
    if (this.energyStarted && energyBeam.active && energyBeam.grounded) {
      let target: Potato | null = null;
      let bestD = this.energizeRadius * this.energizeRadius;
      for (const pot of this.potatoes) {
        if (!pot.alive || !pot.planted) continue;
        const dx = pot.position.x - energyBeam.impactPoint.x;
        const dz = pot.position.z - energyBeam.impactPoint.z;
        const d = dx * dx + dz * dz;
        if (d < bestD) {
          bestD = d;
          target = pot;
        }
      }
      if (target) {
        target.growth = Math.min(1, target.growth + this.growthRate * dt);
        target.shield = this.shieldLinger;
        target.glowing = true;
      }
    }

    for (const pot of this.potatoes) pot.update(dt);

    // 승패 판정(에너지 단계 이후). 종료 시점 "살아남은 감자 수"로 결과 등급이 갈린다.
    //  - 완전 성공(perfect): 3그루 모두 생존, 또는 3그루 모두 100% 성장 — 즉시
    //  - 부분 성공(partial): 60초를 버텼고 1~2그루 생존 — 실패가 아닌 보상 결과
    //  - 실패(fail): 감자가 모두 파괴됨
    if (!this.ended && this.phase === "energy" && !this.practice) {
      const survivors = this.potatoes.filter((p) => p.alive).length;
      const allGrown =
        this.potatoes.length === this.maxPotatoes &&
        this.potatoes.every((p) => p.alive && p.grown);
      const timeUp = this.missionElapsed >= this.survivalDuration;
      if (survivors === 0) {
        this.ended = true;
        this.phase = "lost";
        this.survivors = 0;
        this.resultTier = "fail";
        this.onLose();
      } else if (allGrown) {
        this.ended = true;
        this.phase = "won";
        this.survivors = survivors;
        this.winReason = "grown";
        this.resultTier = "perfect";
        this.onWin();
      } else if (timeUp) {
        this.ended = true;
        this.phase = "won";
        this.survivors = survivors;
        this.winReason = "survived";
        this.resultTier = survivors >= this.maxPotatoes ? "perfect" : "partial";
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
    this.missionElapsed = 0;
    this.timerStarted = false;
    this.ended = false;
    this.winReason = null;
    this.resultTier = null;
    this.survivors = 0;
  }
}
