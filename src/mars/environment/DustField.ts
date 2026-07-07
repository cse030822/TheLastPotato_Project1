import * as THREE from "three";

/**
 * 바람에 날리는 화성 흙먼지.
 *  - 두 겹: 공중에 흩날리는 미세 먼지 + 지면을 빠르게 스치는 낮은 먼지
 *  - 돌풍(gust): 바람 세기가 시간에 따라 강약을 반복 → "휘몰아치는" 느낌
 *  - 상하 난기류로 입자가 흔들림
 * 생명 요소만 채도를 높인다는 원칙에 따라, 먼지는 저채도 황토색 + NormalBlending
 * (발광처럼 보이지 않게) 유지한다.
 */
export class DustField {
  readonly points: THREE.Points; // 공중 미세 먼지
  readonly ground: THREE.Points; // 지면을 스치는 낮은 먼지

  private readonly area = 90;
  private readonly maxY = 8;
  private phase: Float32Array; // 입자별 위상(난기류 다양화)
  private groundPhase: Float32Array;

  constructor(count = 1500, groundCount = 700) {
    const air = this.makeLayer(count, this.maxY, 0.07, 0.14, 0xa9805a, 2);
    this.points = air.points;
    this.phase = air.phase;

    // 지면 먼지: 더 낮고, 더 크고, 조금 더 진하게 → 스쳐 지나가는 흙먼지
    const gnd = this.makeLayer(groundCount, 1.6, 0.11, 0.2, 0x9a6f49, 1);
    this.ground = gnd.points;
    this.groundPhase = gnd.phase;
  }

  private makeLayer(
    count: number,
    maxY: number,
    size: number,
    opacity: number,
    color: number,
    yPow: number,
  ): { points: THREE.Points; phase: Float32Array } {
    const positions = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * this.area;
      positions[i * 3 + 1] = Math.pow(Math.random(), yPow) * maxY + 0.03;
      positions[i * 3 + 2] = (Math.random() - 0.5) * this.area - 3;
      phase[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color,
      size,
      transparent: true,
      opacity,
      depthWrite: false,
      sizeAttenuation: true,
      blending: THREE.NormalBlending,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    return { points, phase };
  }

  update(dt: number, elapsed: number): void {
    // 전체 바람 방향은 대각선, 세기는 돌풍처럼 강약 반복
    const gust = 0.55 + 0.85 * (0.5 + 0.5 * Math.sin(elapsed * 0.35));
    const windX = (0.7 + gust) * 1.0;
    const windZ = Math.sin(elapsed * 0.12) * 0.25; // 방향도 서서히 흔들림

    this.advance(this.points, this.phase, dt, elapsed, windX * 0.8, windZ, 0.02);
    // 지면 먼지는 더 빠르게 스치고 상하 흔들림이 작다
    this.advance(this.ground, this.groundPhase, dt, elapsed, windX * 1.7, windZ * 1.3, 0.008);
  }

  private advance(
    pts: THREE.Points,
    phase: Float32Array,
    dt: number,
    elapsed: number,
    windX: number,
    windZ: number,
    sway: number,
  ): void {
    const pos = pts.geometry.attributes.position as THREE.BufferAttribute;
    const half = this.area / 2;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i) + windX * dt;
      let z = pos.getZ(i) + windZ * dt;
      // 상하 난기류(입자별 위상으로 제각각 흔들림)
      const y = pos.getY(i) + Math.sin(elapsed * 1.3 + phase[i]) * sway * dt * 60;

      // 영역을 벗어나면 반대편에서 재진입(무한 스크롤)
      if (x > half) x -= this.area;
      else if (x < -half) x += this.area;
      const zc = z + 3; // 중심 보정
      if (zc > half) z -= this.area;
      else if (zc < -half) z += this.area;

      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
  }
}
