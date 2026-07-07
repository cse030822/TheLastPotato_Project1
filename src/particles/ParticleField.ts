import * as THREE from "three";

// 파티클 종류
export const KIND = {
  WATER: 0,
  WATER_TRAIL: 1, // 물이 지나간 자리에 남는 옅은 잔상
  FLAME: 2,
  FLAME_HALO: 3, // 불꽃이 사라진 자리에 남는 강한 빛무리
} as const;
export type Kind = (typeof KIND)[keyof typeof KIND];

export interface SpawnOptions {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  color: THREE.Color;
  size: number;
  life: number;
  kind: Kind;
}

const VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vColor = color;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (320.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    // 둥근 점 + 중심이 밝은 소프트 폴오프
    float r = length(gl_PointCoord - vec2(0.5));
    if (r > 0.5) discard;
    float soft = smoothstep(0.5, 0.0, r);
    gl_FragColor = vec4(vColor * soft, vAlpha * soft);
  }
`;

/**
 * 가산 혼합(Additive) THREE.Points 기반 파티클 풀.
 * - 겹치는 부분은 가산 혼합으로 자연스럽게 더 밝게 빛난다.
 * - 링 버퍼로 최대 개수를 넘기지 않게(가장 오래된 것을 덮어씀) 관리한다.
 */
export class ParticleField {
  readonly points: THREE.Points;
  private geo: THREE.BufferGeometry;
  private cursor = 0;

  // GPU로 넘기는 속성
  private aPos: Float32Array;
  private aColor: Float32Array;
  private aSize: Float32Array;
  private aAlpha: Float32Array;

  // CPU 시뮬레이션용 병렬 배열
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private baseSize: Float32Array;
  private kind: Uint8Array;
  private perp: Float32Array; // 불꽃 좌우 흔들림 축
  private phase: Float32Array;

  // update 중 즉시 생성하면 순회가 꼬이므로 지연 생성 큐에 모은다.
  private deferred: SpawnOptions[] = [];
  private tmp = new THREE.Vector3();

  constructor(
    private readonly max: number,
    private readonly gravity: THREE.Vector3,
    // 물=NormalBlending(액체 방울), 불꽃=AdditiveBlending(발광) 처럼 종류별로 지정.
    blending: THREE.Blending = THREE.AdditiveBlending,
  ) {
    this.aPos = new Float32Array(max * 3);
    this.aColor = new Float32Array(max * 3);
    this.aSize = new Float32Array(max);
    this.aAlpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.kind = new Uint8Array(max);
    this.perp = new Float32Array(max * 3);
    this.phase = new Float32Array(max);

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.aPos, 3));
    this.geo.setAttribute("color", new THREE.BufferAttribute(this.aColor, 3));
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.aSize, 1));
    this.geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.aAlpha, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending,
    });

    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
  }

  /** 파티클 하나 생성(링 버퍼) */
  spawn(o: SpawnOptions, perp?: THREE.Vector3): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const i3 = i * 3;
    this.aPos[i3] = o.pos.x;
    this.aPos[i3 + 1] = o.pos.y;
    this.aPos[i3 + 2] = o.pos.z;
    this.vel[i3] = o.vel.x;
    this.vel[i3 + 1] = o.vel.y;
    this.vel[i3 + 2] = o.vel.z;
    this.aColor[i3] = o.color.r;
    this.aColor[i3 + 1] = o.color.g;
    this.aColor[i3 + 2] = o.color.b;
    this.perp[i3] = perp?.x ?? 0;
    this.perp[i3 + 1] = perp?.y ?? 0;
    this.perp[i3 + 2] = perp?.z ?? 0;
    this.baseSize[i] = o.size;
    this.life[i] = o.life;
    this.maxLife[i] = o.life;
    this.kind[i] = o.kind;
    this.phase[i] = Math.random() * Math.PI * 2;
  }

  update(dt: number): void {
    const g = this.gravity;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.aAlpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const i3 = i * 3;
      const k = this.kind[i];

      if (this.life[i] <= 0) {
        // 이번 프레임에 소멸 → 불꽃은 빛무리를 남긴다
        if (k === KIND.FLAME && Math.random() < 0.4) {
          this.deferred.push({
            pos: this.tmp
              .set(this.aPos[i3], this.aPos[i3 + 1], this.aPos[i3 + 2])
              .clone(),
            vel: new THREE.Vector3(0, 0, 0),
            color: new THREE.Color(1.0, 0.55, 0.2),
            size: this.baseSize[i] * 1.6,
            life: 0.2,
            kind: KIND.FLAME_HALO,
          });
        }
        this.aAlpha[i] = 0;
        continue;
      }

      const age = 1 - this.life[i] / this.maxLife[i]; // 0 → 1

      // 불꽃 계열은 중력 약함(필드 gravity가 이미 작음), 좌우 미세 흔들림
      if (k === KIND.FLAME) {
        const wob = Math.sin(this.phase[i] + age * 22) * 2.4 * dt;
        this.vel[i3] += this.perp[i3] * wob;
        this.vel[i3 + 1] += this.perp[i3 + 1] * wob;
        this.vel[i3 + 2] += this.perp[i3 + 2] * wob;
      }

      // 속도 적분(중력) — 잔상/빛무리는 정지
      if (k === KIND.WATER || k === KIND.FLAME) {
        this.vel[i3] += g.x * dt;
        this.vel[i3 + 1] += g.y * dt;
        this.vel[i3 + 2] += g.z * dt;
      }
      this.aPos[i3] += this.vel[i3] * dt;
      this.aPos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.aPos[i3 + 2] += this.vel[i3 + 2] * dt;

      // 종류별 크기·투명도 곡선
      let size = this.baseSize[i];
      let alpha = 1;
      switch (k) {
        case KIND.WATER:
          // 지면 충돌 → 어디에 떨어졌는지(대상) 보이도록 물이 튀는 스플래시를 남기고 소멸.
          if (this.aPos[i3 + 1] <= 0.06) {
            const px = this.aPos[i3];
            const pz = this.aPos[i3 + 2];
            for (let s = 0; s < 5; s++) {
              this.deferred.push({
                pos: new THREE.Vector3(
                  px + (Math.random() - 0.5) * 0.3,
                  0.05,
                  pz + (Math.random() - 0.5) * 0.3,
                ),
                vel: new THREE.Vector3(0, 0, 0),
                color: new THREE.Color(0.3, 0.72, 1.0),
                size: this.baseSize[i] * (0.7 + Math.random() * 0.5),
                life: 0.35 + Math.random() * 0.2,
                kind: KIND.WATER_TRAIL,
              });
            }
            this.life[i] = 0;
            this.aAlpha[i] = 0;
            continue;
          }
          size *= 1 - 0.35 * age;
          alpha = Math.min(1, this.life[i] / this.maxLife[i] / 0.5); // 끝부분 페이드
          // 지나간 자리 잔상
          if (Math.random() < 0.1) {
            this.deferred.push({
              pos: new THREE.Vector3(
                this.aPos[i3],
                this.aPos[i3 + 1],
                this.aPos[i3 + 2],
              ),
              vel: new THREE.Vector3(0, 0, 0),
              color: new THREE.Color(0.15, 0.5, 0.95),
              size: size * 0.7,
              life: 0.5,
              kind: KIND.WATER_TRAIL,
            });
          }
          break;
        case KIND.WATER_TRAIL:
          alpha = 0.35 * (this.life[i] / this.maxLife[i]);
          break;
        case KIND.FLAME:
          // 생성 직후 부풀었다가(0~25%) 금세 작아짐
          size *= age < 0.25 ? 0.6 + age * 2.4 : 1.2 * (1 - (age - 0.25) / 0.75);
          alpha = Math.min(1, (this.life[i] / this.maxLife[i]) / 0.4);
          break;
        case KIND.FLAME_HALO:
          size *= 1 + age * 1.5; // 퍼지며
          alpha = 0.5 * (this.life[i] / this.maxLife[i]);
          break;
      }
      this.aSize[i] = Math.max(0, size);
      this.aAlpha[i] = Math.max(0, alpha);
    }

    // 지연 생성 플러시
    if (this.deferred.length) {
      for (const o of this.deferred) this.spawn(o);
      this.deferred.length = 0;
    }

    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }
}
