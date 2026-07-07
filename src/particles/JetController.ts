import * as THREE from "three";
import { KIND, ParticleField } from "./ParticleField";

// 화성 중력 느낌(지구의 약 0.38배). 물은 이 중력으로 살짝 휘지만
// 분무기처럼 곧게 쫙 뻗도록 약하게 준다.
const MARS_G = new THREE.Vector3(0, -3.2, 0);
// 불꽃은 중력 영향이 거의 없이 곧게 뻗는다.
const FLAME_G = new THREE.Vector3(0, -0.4, 0);

function perpBasis(dir: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const up =
    Math.abs(dir.y) > 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
  const a = new THREE.Vector3().crossVectors(dir, up).normalize();
  const b = new THREE.Vector3().crossVectors(dir, a).normalize();
  return [a, b];
}

/**
 * 두 테라-건의 분사를 담당.
 *  - 오른손 FIRE → 형광 블루 물 (포물선)
 *  - 왼손 FIRE → 붉은 불꽃 (직진 + 흔들림)
 * FIRE가 유지되는 동안만 생성되고, 상태가 풀리면 즉시 멈춘다.
 */
export class JetController {
  // 물은 빛이 아니라 액체이므로 NormalBlending(발광 X). 불꽃만 가산 발광.
  private water = new ParticleField(1200, MARS_G, THREE.NormalBlending);
  private flame = new ParticleField(1000, FLAME_G, THREE.AdditiveBlending);

  private waterAccum = 0;
  private flameAccum = 0;

  // 작은 방울을 촘촘히 뿌려 가느다란 직선 물줄기로 보이게 한다.
  private readonly waterRate = 460; // 초당 물방울
  private readonly flameRate = 380; // 초당 불꽃 입자

  constructor(scene: THREE.Scene) {
    scene.add(this.water.points, this.flame.points);
  }

  /** 오른손 물 분사 (FIRE 동안 매 프레임 호출) */
  emitWater(pos: THREE.Vector3, dir: THREE.Vector3, dt: number): void {
    this.waterAccum += this.waterRate * dt;
    const [a, b] = perpBasis(dir);
    while (this.waterAccum >= 1) {
      this.waterAccum -= 1;
      const speed = 11 + Math.random() * 2; // 빠르게 → 곧게 뻗음
      const spread = 0.03; // 좁은 원뿔
      const vel = dir
        .clone()
        .multiplyScalar(speed)
        .addScaledVector(a, (Math.random() - 0.5) * spread * speed)
        .addScaledVector(b, (Math.random() - 0.5) * spread * speed);
      vel.y += 0.15; // 거의 수평으로
      const t = Math.random();
      const color = new THREE.Color().setRGB(
        0.15 + 0.2 * t,
        0.55 + 0.35 * t,
        1.0,
      );
      this.water.spawn({
        pos: jitter(pos, 0.015),
        vel,
        color,
        size: 8 + Math.random() * 4, // 작은 방울
        life: 1.1 + Math.random() * 0.3,
        kind: KIND.WATER,
      });
    }
  }

  /** 왼손 불꽃 분사 (FIRE 동안 매 프레임 호출) */
  emitFlame(pos: THREE.Vector3, dir: THREE.Vector3, dt: number): void {
    this.flameAccum += this.flameRate * dt;
    const [a] = perpBasis(dir);
    while (this.flameAccum >= 1) {
      this.flameAccum -= 1;
      const speed = 13 + Math.random() * 2; // 곧고 빠르게
      const spread = 0.035; // 좁게
      const [pa, pb] = perpBasis(dir);
      const vel = dir
        .clone()
        .multiplyScalar(speed)
        .addScaledVector(pa, (Math.random() - 0.5) * spread * speed)
        .addScaledVector(pb, (Math.random() - 0.5) * spread * speed);

      // 안쪽은 하양·노랑(작고 밝게), 바깥은 주황·빨강
      const inner = Math.random() < 0.45;
      const color = inner
        ? new THREE.Color(1.0, 0.95, 0.7)
        : new THREE.Color(1.0, 0.35 + Math.random() * 0.15, 0.1);
      this.flame.spawn(
        {
          pos: jitter(pos, 0.02),
          vel,
          color,
          size: inner ? 9 + Math.random() * 4 : 14 + Math.random() * 7,
          life: 0.45 + Math.random() * 0.2,
          kind: KIND.FLAME,
        },
        a, // 좌우 흔들림 축
      );
    }
  }

  update(dt: number): void {
    this.water.update(dt);
    this.flame.update(dt);
  }
}

function jitter(p: THREE.Vector3, amt: number): THREE.Vector3 {
  return new THREE.Vector3(
    p.x + (Math.random() - 0.5) * amt,
    p.y + (Math.random() - 0.5) * amt,
    p.z + (Math.random() - 0.5) * amt,
  );
}
