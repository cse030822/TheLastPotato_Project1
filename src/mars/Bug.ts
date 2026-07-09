import * as THREE from "three";
import { terrainHeight } from "./environment/heightfield";

/**
 * 외계 곤충(라스트 포테이토를 노리는 절지 생물).
 * 디자인: 어두운 장갑질 몸체 + 아치형 가시 등딱지 + 붉은 발광 눈 + 10개 다리 + 꼬리 침.
 * 이동: "절지동물처럼 뚝뚝 끊어지는" 러지(lunge) 스텝으로 가장 가까운 감자를 향해 접근.
 * 등장: 모래를 파헤치며 솟아오르거나(sand), 돔 뼈대에서 내려온다(frame).
 */

export type SpawnMode = "sand" | "frame";

/**
 * 곤충 외형 변종. **시각 요소만** 다르다 — 이동·공격·체력·속도 등 메커니즘은
 * 변종과 무관하게 완전히 동일하다(스탯은 Bug 클래스 상수/필드에 그대로 있음).
 * 아트 디렉션: 전부 어두운 무채색 몸 + 붉은 발광 눈(생명색은 감자 전용).
 */
interface BugAppearance {
  body: number; // 몸통 기본색
  plate: number; // 등딱지 장갑판
  spike: number; // 가시·뿔·턱
  leg: number; // 다리
  eye: number; // 눈 표면색
  eyeEmissive: number; // 눈 발광색
  eyeIntensity: number; // 눈 발광 세기
  spikeScale: number; // 등가시 크기 배율(0에 가까우면 매끈). 0.05 이하면 가시 생략
  hornScale: number; // 머리 뿔 길이 배율
  legPairs: number; // 다리 쌍 수(1=2다리 … 5=10다리)
  bodySegs: number; // 몸통 마디 수(실루엣 길이)
  tailSegs: number; // 꼬리 마디 수(0=꼬리 없음)
  hasHorns: boolean; // 머리 뿔 유무
  headScale: number; // 머리 크기 배율
  metalness: number;
  roughness: number;
}

// 6종 변종 — 다리 수·몸통 길이·꼬리·가시·머리 크기·색까지 제각각.
// 아트 디렉션: 대체로 어두운 무채색 + 붉은 눈(생명색=초록/시안은 배제).
// 붉은 몸(홍갑충)은 '위협/죽음' 색이라 대비를 깨지 않는다.
const BUG_VARIANTS: BugAppearance[] = [
  // 흑요석 갑충: 10다리·긴 꼬리·표준 가시, 근본 charcoal
  { body: 0x201a15, plate: 0x2d241d, spike: 0x120d0a, leg: 0x161009, eye: 0xff3010, eyeEmissive: 0xff2200, eyeIntensity: 2.4, spikeScale: 1.0, hornScale: 1.0, legPairs: 5, bodySegs: 5, tailSegs: 5, hasHorns: true, headScale: 1.0, metalness: 0.5, roughness: 0.5 },
  // 녹슨 육각충: 6다리·짧은 꼬리·뭉툭 가시, 산화 적갈
  { body: 0x33210f, plate: 0x3d2913, spike: 0x1a0f06, leg: 0x211405, eye: 0xff5a1e, eyeEmissive: 0xff3a00, eyeIntensity: 2.2, spikeScale: 0.7, hornScale: 0.8, legPairs: 3, bodySegs: 4, tailSegs: 3, hasHorns: true, headScale: 1.05, metalness: 0.4, roughness: 0.62 },
  // 잿빛 장각충: 10다리·긴 몸·아주 높은 가시, 탁한 회
  { body: 0x2a2622, plate: 0x35302b, spike: 0x141210, leg: 0x1c1916, eye: 0xd81028, eyeEmissive: 0xc00010, eyeIntensity: 2.6, spikeScale: 1.45, hornScale: 1.35, legPairs: 5, bodySegs: 6, tailSegs: 6, hasHorns: true, headScale: 0.95, metalness: 0.55, roughness: 0.5 },
  // 홍갑충(빨강): 8다리·선명한 암적색 몸·뜨거운 눈
  { body: 0x8f1e14, plate: 0xa8281a, spike: 0x5a120b, leg: 0x54130b, eye: 0xff8a2e, eyeEmissive: 0xff5a00, eyeIntensity: 2.8, spikeScale: 1.15, hornScale: 1.1, legPairs: 4, bodySegs: 5, tailSegs: 4, hasHorns: true, headScale: 1.05, metalness: 0.45, roughness: 0.5 },
  // 이족 도약충(다리 2개): 큰 머리·꼬리 없음·가시 최소
  { body: 0x241a20, plate: 0x30222c, spike: 0x140a10, leg: 0x1a1016, eye: 0xff2a2a, eyeEmissive: 0xff0000, eyeIntensity: 2.7, spikeScale: 0.45, hornScale: 0.7, legPairs: 1, bodySegs: 3, tailSegs: 0, hasHorns: false, headScale: 1.35, metalness: 0.5, roughness: 0.55 },
  // 창백 유충: 매끈(가시 거의 없음)·4다리·꼬리 없음, 뼛빛 밝은 회(대비용)
  { body: 0x6a5f52, plate: 0x746a5c, spike: 0x2a2018, leg: 0x4a4238, eye: 0xff3020, eyeEmissive: 0xd01808, eyeIntensity: 2.2, spikeScale: 0.18, hornScale: 0.5, legPairs: 2, bodySegs: 4, tailSegs: 0, hasHorns: false, headScale: 1.1, metalness: 0.2, roughness: 0.75 },
];

/** 무작위 외형 변종 하나 선택. */
export function pickBugAppearance(): BugAppearance {
  return BUG_VARIANTS[(Math.random() * BUG_VARIANTS.length) | 0];
}

/** 사진 디자인 기반 절차적 곤충 모델. legPivots는 다리 애니메이션용. */
function createBugModel(a: BugAppearance): { group: THREE.Group; legPivots: THREE.Group[] } {
  const g = new THREE.Group();
  const legPivots: THREE.Group[] = [];

  const bodyMat = new THREE.MeshStandardMaterial({ color: a.body, metalness: a.metalness, roughness: a.roughness, flatShading: true });
  const plateMat = new THREE.MeshStandardMaterial({ color: a.plate, metalness: a.metalness + 0.05, roughness: a.roughness - 0.05, flatShading: true });
  const spikeMat = new THREE.MeshStandardMaterial({ color: a.spike, metalness: a.metalness, roughness: a.roughness, flatShading: true });
  const legMat = new THREE.MeshStandardMaterial({ color: a.leg, metalness: a.metalness, roughness: a.roughness + 0.05, flatShading: true });
  const eyeMat = new THREE.MeshStandardMaterial({ color: a.eye, emissive: a.eyeEmissive, emissiveIntensity: a.eyeIntensity });

  // --- 몸통: 아치형 장갑 세그먼트(앞 +z 크고 뒤로 작아짐) + 등가시 ---
  const segCount = Math.max(1, a.bodySegs);
  for (let i = 0; i < segCount; i++) {
    const t = segCount > 1 ? i / (segCount - 1) : 0;
    const r = 0.44 * (1 - t * 0.42);
    const z = 0.55 - t * 1.45;
    const seg = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), plateMat);
    seg.scale.set(1.18, 0.78, 1.06);
    seg.position.set(0, r * 0.6, z);
    seg.castShadow = true;
    g.add(seg);

    // 등 위 가시(가시 거의 없는 변종은 생략). 밑동은 등딱지에 붙게 위치 보정.
    if (a.spikeScale > 0.05) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(r * 0.3, r * 1.0, 5), spikeMat);
      spike.scale.setScalar(a.spikeScale);
      spike.position.set(0, r * 0.6 + r * 0.72 + r * 0.5 * (a.spikeScale - 1), z);
      spike.castShadow = true;
      g.add(spike);
      // 좌우 곁가시
      for (const s of [-1, 1]) {
        const sp = new THREE.Mesh(new THREE.ConeGeometry(r * 0.17, r * 0.6, 4), spikeMat);
        sp.scale.setScalar(a.spikeScale);
        sp.position.set(s * r * 0.72, r * 0.62, z);
        sp.rotation.z = s * 1.0;
        g.add(sp);
      }
    }
  }

  // --- 머리: 붉은 눈 + (뿔) + 턱 --- 한 그룹으로 묶어 headScale로 크기 차등.
  const headGroup = new THREE.Group();
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.36, 1), bodyMat);
  head.scale.set(1.1, 0.85, 1.25);
  head.position.set(0, 0.3, 1.12);
  head.castShadow = true;
  headGroup.add(head);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), eyeMat);
    eye.position.set(s * 0.17, 0.36, 1.36);
    headGroup.add(eye);
    if (a.hasHorns) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.44, 5), spikeMat);
      horn.scale.setScalar(a.hornScale);
      horn.position.set(s * 0.15, 0.55, 1.2);
      horn.rotation.set(-0.5, 0, s * 0.3);
      headGroup.add(horn);
    }
    const mand = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.38, 5), spikeMat);
    mand.position.set(s * 0.13, 0.2, 1.44);
    mand.rotation.set(1.45, 0, s * 0.2);
    headGroup.add(mand);
  }
  headGroup.scale.setScalar(a.headScale);
  g.add(headGroup);

  // --- 다리: legPairs 쌍(=2×legPairs개). 다리 개수와 무관하게 pivot 회전으로 걷기. ---
  const legPairs = Math.max(1, a.legPairs);
  const legZ: number[] = [];
  if (legPairs === 1) {
    legZ.push(0.2); // 다리 한 쌍이면 몸 중앙 약간 앞
  } else {
    const front = 0.72;
    const back = -0.66;
    for (let i = 0; i < legPairs; i++) legZ.push(front + (back - front) * (i / (legPairs - 1)));
  }
  for (let pair = 0; pair < legPairs; pair++) {
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.36, 0.2, legZ[pair]);
      const femur = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.04, 0.52, 6), legMat);
      femur.position.set(s * 0.23, -0.03, 0);
      femur.rotation.z = s * 1.15;
      const tibia = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.02, 0.52, 6), legMat);
      tibia.position.set(s * 0.44, -0.3, 0);
      tibia.rotation.z = s * 0.5;
      femur.castShadow = true;
      tibia.castShadow = true;
      pivot.add(femur, tibia);
      pivot.userData.baseX = pivot.rotation.x;
      pivot.userData.phase = pair * 1.1 + (s > 0 ? Math.PI : 0);
      g.add(pivot);
      legPivots.push(pivot);
    }
  }

  // --- 꼬리: 마디 + 끝 침(있는 변종만) ---
  if (a.tailSegs > 0) {
    const tail = new THREE.Group();
    let tz = -0.78;
    let ty = 0.28;
    for (let i = 0; i < a.tailSegs; i++) {
      const r = 0.15 * (1 - i * 0.15);
      const seg = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), plateMat);
      seg.position.set(0, ty, tz);
      seg.castShadow = true;
      tail.add(seg);
      tz -= 0.16;
      ty += 0.1;
    }
    const sting = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.34, 6), spikeMat);
    sting.position.set(0, ty, tz);
    sting.rotation.x = -0.7;
    tail.add(sting);
    g.add(tail);
  }

  return { group: g, legPivots };
}

export class Bug {
  readonly group: THREE.Group;
  readonly position = new THREE.Vector3();
  private legPivots: THREE.Group[];

  health = 3; // 빔 피격 내구도
  removeMe = false;
  readonly attackRadius = 0.85; // 감자에 닿는 거리
  readonly hitRadius = 1.15; // 빔 충돌 반경(조준이 조금 빗나가도 맞도록 넉넉히)

  private readonly sizeScale: number;
  private readonly bodyHeight: number;
  private state: "emerge" | "walk" | "attack" = "emerge";

  // 등장 연출
  private emergeT = 0;
  private readonly emergeDur: number;
  private readonly startPos = new THREE.Vector3();
  private readonly groundPos = new THREE.Vector3();

  // 뚝뚝 끊기는 러지 스텝
  private lungeRemaining = 0;
  private stepTimer = 0;
  private readonly lungeSpeed = 4.6;
  private readonly stepLen = 0.55;
  private readonly pauseDur = 0.1;

  private walkPhase = 0;
  private twitch = 0;

  // 죽는 중
  private dead = false;
  private deathT = 0;

  constructor(
    groundPos: THREE.Vector3,
    mode: SpawnMode,
    sizeScale = 0.62,
    appearance: BugAppearance = pickBugAppearance(),
  ) {
    const model = createBugModel(appearance);
    this.group = model.group;
    this.legPivots = model.legPivots;
    this.sizeScale = sizeScale;
    this.group.scale.setScalar(sizeScale);
    this.bodyHeight = 0.34 * sizeScale;

    this.groundPos.copy(groundPos);
    this.groundPos.y = terrainHeight(groundPos.x, groundPos.z) + this.bodyHeight;

    if (mode === "sand") {
      // 모래를 파헤치며 솟아오름: 지면 아래에서 시작
      this.startPos.copy(this.groundPos);
      this.startPos.y -= 1.1;
      this.emergeDur = 1.2;
    } else {
      // 부서진 돔 뼈대에서 내려옴: 높은 곳에서 시작
      this.startPos.set(groundPos.x * 0.82, this.groundPos.y + 6.5, groundPos.z * 0.82 + -3 * 0.18);
      this.emergeDur = 1.7;
    }
    this.position.copy(this.startPos);
    this.group.position.copy(this.position);

    // 처음엔 대략 중심을 바라보게
    this.group.rotation.y = Math.atan2(-groundPos.x, -(groundPos.z + 3));
  }

  isEmerging(): boolean {
    return this.state === "emerge";
  }

  /** 빔 피격 데미지. */
  damage(amount: number): void {
    if (this.dead) return;
    this.health -= amount;
    if (this.health <= 0) {
      this.dead = true;
      this.deathT = 0;
    }
  }

  /**
   * @param target 목표 감자 월드 좌표
   * @param attacking 감자 히트박스 안에 들어와 공격 중인지
   */
  update(dt: number, target: THREE.Vector3, attacking: boolean): void {
    if (this.dead) {
      this.deathT += dt;
      const k = Math.max(0, 1 - this.deathT / 0.4);
      this.group.scale.setScalar(this.sizeScale * k);
      this.position.y -= dt * 0.8; // 살짝 주저앉으며 소멸
      this.group.position.y = this.position.y;
      if (this.deathT >= 0.4) this.removeMe = true;
      return;
    }

    if (this.state === "emerge") {
      this.emergeT += dt;
      const k = Math.min(1, this.emergeT / this.emergeDur);
      const e = k * k * (3 - 2 * k); // smoothstep
      this.position.lerpVectors(this.startPos, this.groundPos, e);
      this.group.position.copy(this.position);
      this.animateLegs(dt, 1.6); // 꿈틀
      if (k >= 1) this.state = "walk";
      return;
    }

    const targetYaw = Math.atan2(target.x - this.position.x, target.z - this.position.z);

    if (attacking) {
      this.state = "attack";
      this.twitch += dt * 20;
      this.group.rotation.y = approachAngle(this.group.rotation.y, targetYaw, dt * 6);
      const baseY = terrainHeight(this.position.x, this.position.z) + this.bodyHeight;
      this.group.position.y = baseY + Math.abs(Math.sin(this.twitch)) * 0.06 * this.sizeScale;
      this.animateLegs(dt, 3.4);
      return;
    }

    this.state = "walk";

    // 목표가 사실상 자기 자신(감자 전멸 등 유효 목표 없음)이면 제자리 대기.
    const dxz = Math.hypot(target.x - this.position.x, target.z - this.position.z);
    if (dxz < 0.2) {
      this.animateLegs(dt, 0.3);
      const by = terrainHeight(this.position.x, this.position.z) + this.bodyHeight;
      this.group.position.set(this.position.x, by, this.position.z);
      return;
    }

    // 러지 스텝: 잠깐 멈췄다가 뚝 하고 앞으로
    this.stepTimer -= dt;
    if (this.lungeRemaining <= 0 && this.stepTimer <= 0) {
      this.lungeRemaining = this.stepLen;
      this.stepTimer = this.pauseDur;
      // 러지 시작 순간에만 방향을 확 튼다(끊기는 느낌)
      this.group.rotation.y = approachAngle(this.group.rotation.y, targetYaw, 0.7);
    }

    if (this.lungeRemaining > 0) {
      const step = Math.min(this.lungeSpeed * dt, this.lungeRemaining);
      const fx = Math.sin(this.group.rotation.y);
      const fz = Math.cos(this.group.rotation.y);
      this.position.x += fx * step;
      this.position.z += fz * step;
      this.lungeRemaining -= step;
      this.animateLegs(dt, 2.6);
    } else {
      this.animateLegs(dt, 0.4);
    }

    const baseY = terrainHeight(this.position.x, this.position.z) + this.bodyHeight;
    this.group.position.set(this.position.x, baseY, this.position.z);
  }

  private animateLegs(dt: number, speed: number): void {
    this.walkPhase += dt * speed * 9;
    for (const p of this.legPivots) {
      const ph = p.userData.phase as number;
      p.rotation.x = (p.userData.baseX as number) + Math.sin(this.walkPhase + ph) * 0.45;
    }
  }
}

/** 각도 보간(±π 랩 처리). rate 0~1: 이번 프레임에 목표로 접근하는 비율. */
function approachAngle(cur: number, target: number, rate: number): number {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + d * Math.min(1, rate);
}
