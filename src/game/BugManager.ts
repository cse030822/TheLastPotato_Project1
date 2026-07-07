import * as THREE from "three";
import { Bug } from "../mars/Bug";
import { terrainHeight, TERRAIN_CENTER } from "../mars/environment/heightfield";
import type { Potato } from "./Potato";

/**
 * 외계 곤충 웨이브 관리.
 *  - 스폰: 에덴 돔 외곽 360°에서, 모래를 파헤치거나(sand) 뼈대에서 내려오는(frame) 두 방식
 *  - 이동: 각 곤충은 "가장 가까운 살아있는 감자"로 접근(뚝뚝 끊기는 러지 — Bug가 처리)
 *  - 템포: 시간이 지날수록 스폰이 잦아짐(0초 ~4초 간격 → 60초 이후 1초 간격)
 *  - 충돌: 감자 히트박스에 닿으면 감자 체력 감소, 3개 모두 파괴 시 실패
 *  - 빔 피격: 발사 중인 빔 선분 근처의 곤충에 데미지(격파 시 소멸)
 */
export class BugManager {
  private bugs: Bug[] = [];
  private elapsed = 0;
  private spawnTimer = 0;
  private failed = false;

  private readonly center = new THREE.Vector3(TERRAIN_CENTER.x, 0, TERRAIN_CENTER.z);
  private readonly damagePerSec = 22; // 감자에 닿아 있는 동안 초당 체력 감소

  private readonly _p = new THREE.Vector3();
  private readonly _end = new THREE.Vector3();

  // 에너지 단계 진입 전까지는 스폰하지 않는다(곤충은 에너지가 나올 때부터 등장).
  private enabled = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly potatoes: Potato[],
    private readonly onFail: () => void,
  ) {
    this.spawnTimer = 1.0; // 위협 활성(퇴비 단계) 후 곧바로 첫 곤충이 등장
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  /** 재시작: 곤충을 모두 치우고 초기 상태로 되돌린다. */
  reset(): void {
    for (const b of this.bugs) this.scene.remove(b.group);
    this.bugs = [];
    this.elapsed = 0;
    this.spawnTimer = 1.0;
    this.failed = false;
    this.enabled = false;
  }

  get count(): number {
    return this.bugs.length;
  }

  /**
   * 스폰 간격(초). 초반엔 뜨문뜨문, 시간이 지날수록 짧아지고(35초에 최소),
   * 매번 무작위 지터를 곱해 "나중엔 무작위로 자주" 나오게 한다.
   */
  private spawnInterval(): number {
    const base = Math.max(0.5, 3.0 - 2.5 * Math.min(1, this.elapsed / 35));
    return base * (0.55 + Math.random() * 0.9); // 0.55x ~ 1.45x 무작위
  }

  private alivepotatoes(): Potato[] {
    return this.potatoes.filter((p) => p.alive);
  }

  /** 보호(빛나는) 감자는 피하고 노출된 감자를 우선 노린다. 없으면 가장 가까운 감자. */
  private nearestPotato(pos: THREE.Vector3): Potato | null {
    let best: Potato | null = null;
    let bestD = Infinity;
    let pref: Potato | null = null;
    let prefD = Infinity;
    for (const p of this.potatoes) {
      if (!p.alive) continue;
      const dx = p.position.x - pos.x;
      const dz = p.position.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
      if (!p.glowing && d < prefD) {
        prefD = d;
        pref = p;
      }
    }
    return pref ?? best;
  }

  private spawn(): void {
    // 카메라 반대편(테라건 반대 = 먼 지평선, -z 쪽) 뒤쪽 아크에서만 등장.
    // 카메라 방향(+z, 손앞)에서는 튀어나오지 않는다.
    const backSpread = 1.3; // 라디안(±) — 뒤쪽 약 150° 범위
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2 * backSpread;
    const R = 15 + Math.random() * 9; // 돔 밖 열린 지형(눈에 잘 띄되 지평선 쪽)
    const gx = this.center.x + Math.cos(ang) * R;
    const gz = this.center.z + Math.sin(ang) * R;
    const groundPos = new THREE.Vector3(gx, terrainHeight(gx, gz), gz);
    // 먼 지형이라 모래를 파헤치며 등장 → 감자 쪽(이쪽)으로 걸어온다.
    const bug = new Bug(groundPos, "sand");
    this.scene.add(bug.group);
    this.bugs.push(bug);
  }

  update(dt: number): void {
    this.elapsed += dt;

    // 스폰(에너지 단계 진입 후 + 감자가 남아있고 실패 전일 때만)
    if (this.enabled && !this.failed && this.alivepotatoes().length > 0) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawn();
        // 후반부일수록 가끔 여러 마리가 무작위로 한꺼번에 몰려온다.
        if (this.elapsed > 20 && Math.random() < 0.4) this.spawn();
        if (this.elapsed > 40 && Math.random() < 0.35) this.spawn();
        this.spawnTimer = this.spawnInterval();
      }
    }

    // 이동 + 감자 공격
    for (const bug of this.bugs) {
      const target = this.nearestPotato(bug.position);
      if (!target) {
        bug.update(dt, bug.position, false);
        continue;
      }
      const dx = target.position.x - bug.position.x;
      const dz = target.position.z - bug.position.z;
      const dist = Math.hypot(dx, dz);
      let attacking = false;

      if (target.glowing) {
        // 빛나는(에너지 받는/성숙한) 감자는 보호막: protectRadius 안으로 못 들어옴.
        if (dist < target.protectRadius && dist > 1e-3) {
          bug.position.x = target.position.x - (dx / dist) * target.protectRadius;
          bug.position.z = target.position.z - (dz / dist) * target.protectRadius;
        }
      } else {
        attacking = !bug.isEmerging() && dist < bug.attackRadius;
        if (attacking) {
          target.health -= this.damagePerSec * dt;
          if (target.health <= 0) target.destroy();
        }
      }
      bug.update(dt, target.position, attacking);
    }

    // 소멸 처리
    this.bugs = this.bugs.filter((b) => {
      if (b.removeMe) {
        this.scene.remove(b.group);
        return false;
      }
      return true;
    });

    // 실패 판정: 감자가 한 번이라도 심겼는데(배열에 존재) 전부 파괴됐을 때만.
    // (게임 시작 시 감자 0개 상태를 "전멸"로 오판해 스폰이 꺼지던 버그 수정)
    if (
      !this.failed &&
      this.potatoes.length > 0 &&
      this.alivepotatoes().length === 0
    ) {
      this.failed = true;
      this.onFail();
    }
  }

  /** 발사 중인 빔 선분(start→dir*len) 근처의 곤충에 데미지. */
  hitBeam(start: THREE.Vector3, dir: THREE.Vector3, len: number, amount: number): void {
    this._end.copy(dir).multiplyScalar(len).add(start);
    for (const bug of this.bugs) {
      if (bug.removeMe) continue;
      const d = pointToSegment(bug.position, start, this._end, this._p);
      if (d < bug.hitRadius) bug.damage(amount);
    }
  }
}

/** 점 p에서 선분 ab까지의 최단 거리. */
function pointToSegment(
  p: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  scratch: THREE.Vector3,
): number {
  scratch.copy(b).sub(a);
  const len2 = scratch.lengthSq();
  let t = len2 > 0 ? (p.clone().sub(a).dot(scratch) / len2) : 0;
  t = Math.max(0, Math.min(1, t));
  scratch.multiplyScalar(t).add(a); // 선분 위 최근접점
  return scratch.distanceTo(p);
}
