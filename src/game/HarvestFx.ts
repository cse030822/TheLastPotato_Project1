import * as THREE from "three";

/**
 * 감자알이 돋을 때 터지는 생명빛(그린) 입자 연출.
 *  - 아트 디렉션: 발광(additive)은 생명 요소에만 → 초록 additive 스파클.
 *  - 각 버스트는 지면 위 지점에서 위·바깥으로 흩어지며 짧게 반짝이고 사라진다.
 */
export class HarvestFx {
  private bursts: {
    pts: THREE.Points;
    vel: Float32Array;
    life: number;
    ttl: number;
    mat: THREE.PointsMaterial;
  }[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  /** 지정 위치에서 수확 입자 버스트 발생. */
  pop(pos: THREE.Vector3): void {
    const n = 16;
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = pos.x;
      arr[i * 3 + 1] = pos.y;
      arr[i * 3 + 2] = pos.z;
      const a = Math.random() * Math.PI * 2;
      const up = 1.2 + Math.random() * 1.6;
      const out = 0.6 + Math.random() * 1.0;
      vel[i * 3] = Math.cos(a) * out;
      vel[i * 3 + 1] = up;
      vel[i * 3 + 2] = Math.sin(a) * out;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x8bff9a,
      size: 0.14,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    this.scene.add(pts);
    this.bursts.push({ pts, vel, life: 0, ttl: 0.85, mat });
  }

  update(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life += dt;
      const attr = b.pts.geometry.getAttribute("position") as THREE.BufferAttribute;
      const pos = attr.array as Float32Array;
      for (let j = 0; j < pos.length; j += 3) {
        b.vel[j + 1] -= 3.5 * dt; // 중력
        pos[j] += b.vel[j] * dt;
        pos[j + 1] += b.vel[j + 1] * dt;
        pos[j + 2] += b.vel[j + 2] * dt;
      }
      attr.needsUpdate = true;
      b.mat.opacity = Math.max(0, 1 - b.life / b.ttl);
      if (b.life >= b.ttl) {
        this.scene.remove(b.pts);
        b.pts.geometry.dispose();
        b.mat.dispose();
        this.bursts.splice(i, 1);
      }
    }
  }

  /** 재시작 시 남은 버스트 정리. */
  clear(): void {
    for (const b of this.bursts) {
      this.scene.remove(b.pts);
      b.pts.geometry.dispose();
      b.mat.dispose();
    }
    this.bursts = [];
  }
}
