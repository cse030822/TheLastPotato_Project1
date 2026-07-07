import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { makeRng } from "./noise";
import { terrainHeight } from "./heightfield";

/**
 * 무너진 안식처, 에덴 돔.
 *  - 먼지·긁힘이 낀 반투명 유리 반구(한쪽이 깨져 열려 있음)
 *  - 녹슬고 휘어진 금속 뼈대(위도/경도 링)
 *  - 깨진 틈으로 쏟아지는 붉은 모래 파티클
 *  - 틈으로 내리는 God Ray(가짜 볼류메트릭 콘)
 *  - 외부 소품: 기운 태양광 패널, 반쯤 묻힌 안테나, 끊어진 파이프
 *  - 내부 소품: 물탱크, 제어 패널, 농업 로봇 잔해
 *
 * 카메라와 화단을 모두 감싸도록 큰 반구로 만든다(1인칭 돔 내부 시점).
 */
export class EdenDome {
  readonly group = new THREE.Group();
  private sandPour: THREE.Points;
  private sandVel: Float32Array;
  private godRayMat: THREE.MeshBasicMaterial;
  private spark: THREE.PointLight;
  private sparkTimer = 0;

  private readonly radius = 15;
  private readonly center = new THREE.Vector3(0, 0, -3);
  // 깨진 틈이 향하는 방위각(전방-우측 상단). god ray/모래가 이 쪽으로 들어온다.
  private readonly gapAzimuth = -0.5;
  private readonly gapPolar = 0.55; // 천정에서의 각도(작을수록 위쪽)

  constructor() {
    this.group.position.copy(this.center);

    this.buildGlassShell();
    this.buildFrame();
    this.buildBrokenRim();
    this.godRayMat = this.buildGodRays();
    const sand = this.buildSandPour();
    this.sandPour = sand.points;
    this.sandVel = sand.vel;
    this.spark = this.buildSpark();
    this.buildExteriorProps();
    this.buildInteriorProps();
    this.buildCratesAndWreck();
  }

  /**
   * 좌우에 놓인 금속 컨테이너(크레이트)와 좌측 기계 잔해.
   * 콘셉트 아트의 코너 산업 소품처럼 화면을 채우되, 형태가 분명한 오브젝트만 쓴다.
   * 좌표는 월드 기준으로 잡고 그룹 오프셋(center)을 빼서 배치한다.
   */
  private buildCratesAndWreck(): void {
    const rng = makeRng(555);
    const cz = this.center.z;
    const mats = [
      new THREE.MeshStandardMaterial({ color: 0x6b5a3f, metalness: 0.5, roughness: 0.7 }),
      new THREE.MeshStandardMaterial({ color: 0x53412c, metalness: 0.5, roughness: 0.75 }),
      new THREE.MeshStandardMaterial({ color: 0x7a6a4a, metalness: 0.45, roughness: 0.7 }),
    ];
    const edgeMat = new THREE.MeshStandardMaterial({
      color: 0x322614,
      metalness: 0.6,
      roughness: 0.6,
    });

    const addCrate = (wx: number, wz: number, s: number, baseY: number) => {
      const g = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.9, s), mats[(rng() * mats.length) | 0]);
      box.castShadow = true;
      box.receiveShadow = true;
      // 테두리 프레임(살짝 큰 어두운 박스)
      const frame = new THREE.Mesh(new THREE.BoxGeometry(s * 1.04, s * 0.24, s * 1.04), edgeMat);
      frame.position.y = s * 0.33;
      g.add(box, frame);
      g.position.set(wx, baseY + s * 0.45, wz - cz);
      g.rotation.y = (rng() - 0.5) * 0.7;
      this.group.add(g);
    };

    // 슬래브(석판 바닥, 월드 y≈0.09) 위에 놓이는 좌우 크레이트 군집
    const spots: [number, number][] = [
      [-6.2, -4.3], [-6.9, -2.8], [-5.3, -6.2],
      [6.2, -4.0], [6.9, -6.0], [5.4, -3.0],
    ];
    for (const [wx, wz] of spots) {
      const s = 0.6 + rng() * 0.7;
      addCrate(wx, wz, s, 0.09);
      if (rng() < 0.5) addCrate(wx + (rng() - 0.5) * 0.5, wz + (rng() - 0.5) * 0.5, s * 0.6, 0.09 + s * 0.9);
    }

    // 좌측 기계 잔해(넘어진 산업 기계 덩어리 + 각진 판 + 드럼)
    const wreck = new THREE.Group();
    const wmat = new THREE.MeshStandardMaterial({ color: 0x5a4632, metalness: 0.55, roughness: 0.72 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.3, 1.6), wmat);
    body.rotation.z = 0.25;
    body.castShadow = true;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 1.2), edgeMat);
    plate.position.set(1.3, 0.2, 0.4);
    plate.rotation.set(0.3, 0.5, 0.4);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.0, 12), wmat);
    drum.rotation.z = Math.PI / 2;
    drum.position.set(-1.4, -0.2, 0.6);
    drum.castShadow = true;
    wreck.add(body, plate, drum);
    const wx = -9.5;
    const wz = -7.5;
    wreck.position.set(wx, terrainHeight(wx, wz) + 0.6, wz - cz);
    wreck.rotation.y = 0.6;
    this.group.add(wreck);
  }

  /**
   * 깨진 유리 반구 — 지오데식 삼각 패널 단위로 만들되, 상당수(특히 깨진 틈 쪽)를
   * 통째로 빼서 "패널이 뜯겨 나간" 부서진 돔으로 보이게 한다. 남은 패널만 병합해
   * 단일 지오메트리로 그린다(골조 스트럿은 buildFrame에서 온전히 유지).
   */
  private buildGlassShell(): void {
    const ico = new THREE.IcosahedronGeometry(this.radius, 2);
    const src = ico.attributes.position.array as ArrayLike<number>;
    const rng = makeRng(451);

    // 깨진 틈 방향(그룹 로컬). 이 방향에 가까운 패널일수록 많이 사라진다.
    const gapDir = new THREE.Vector3(
      Math.sin(this.gapPolar) * Math.cos(this.gapAzimuth),
      Math.cos(this.gapPolar),
      Math.sin(this.gapPolar) * Math.sin(this.gapAzimuth),
    ).normalize();

    const kept: number[] = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const cen = new THREE.Vector3();
    const faceCount = src.length / 9; // PolyhedronGeometry는 비인덱스(면당 정점 3개)

    for (let f = 0; f < faceCount; f++) {
      const o = f * 9;
      a.set(src[o], src[o + 1], src[o + 2]);
      b.set(src[o + 3], src[o + 4], src[o + 5]);
      c.set(src[o + 6], src[o + 7], src[o + 8]);
      cen.copy(a).add(b).add(c).multiplyScalar(1 / 3);

      // 상반구(돔)만 유리로. 아래쪽은 지형에 묻히므로 제외.
      if (cen.y < 0.2) continue;

      // 깨진 정도: 콘셉트 아트처럼 유리가 상당수 뜯겨 나가 골조가 드러나게.
      // 산발 결손(35%) + 윗부분(천정)과 틈 쪽에 큰 결손 집중.
      const nearGap = Math.max(0, cen.clone().normalize().dot(gapDir));
      const upness = Math.max(0, cen.y / this.radius); // 0(수평) → 1(천정)
      const removeProb = 0.35 + nearGap * nearGap * 0.55 + upness * upness * 0.35;
      if (rng() < removeProb) continue;

      for (let k = 0; k < 9; k++) kept.push(src[o + k]);
    }
    ico.dispose();

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(kept, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: 0x8fa6a2,
      metalness: 0.1,
      roughness: 0.3,
      transparent: true,
      opacity: 0.26,
      side: THREE.DoubleSide,
      emissive: 0x223330,
      emissiveIntensity: 0.15,
      depthWrite: false,
    });

    this.group.add(new THREE.Mesh(geo, mat));
  }

  /**
   * [4단계] 지오데식 삼각 패널 골조 — 콘셉트 아트의 삼각 분할 돔 느낌.
   * IcosahedronGeometry를 WireframeGeometry로 감싸 모든 삼각 모서리를 스트럿(strut)으로
   * 드러낸다. (EdgesGeometry는 세분면의 잔모서리를 숨겨 큰 20면만 남으므로 부적합.)
   * 하반구 스트럿은 지형에 가려 보이지 않는다.
   */
  private buildFrame(): void {
    // 삼각 패널 스트럿 — 콘셉트 아트처럼 "굵은 녹슨 금속 빔". 각 모서리를 가는
    // 실린더로 만들어 하나로 병합(단일 드로우콜). 지하로 완전히 내려간 빔은 생략.
    const icosa = new THREE.IcosahedronGeometry(this.radius, 2);
    const wire = new THREE.WireframeGeometry(icosa);
    const wp = wire.attributes.position as THREE.BufferAttribute;

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const mid = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    const beams: THREE.BufferGeometry[] = [];

    for (let i = 0; i < wp.count; i += 2) {
      a.fromBufferAttribute(wp, i);
      b.fromBufferAttribute(wp, i + 1);
      if (a.y < -0.5 && b.y < -0.5) continue; // 지하 빔 스킵
      const len = a.distanceTo(b);
      const cyl = new THREE.CylinderGeometry(0.08, 0.08, len, 5, 1);
      dir.copy(b).sub(a).normalize();
      q.setFromUnitVectors(up, dir);
      cyl.applyQuaternion(q);
      mid.copy(a).add(b).multiplyScalar(0.5);
      cyl.translate(mid.x, mid.y, mid.z);
      beams.push(cyl);
    }
    wire.dispose();
    icosa.dispose();

    const merged = mergeGeometries(beams, false);
    beams.forEach((g) => g.dispose());
    const struts = new THREE.Mesh(
      merged,
      new THREE.MeshStandardMaterial({
        color: 0x5c3a22,
        metalness: 0.55,
        roughness: 0.72,
        emissive: 0x1a0d06,
        emissiveIntensity: 0.25,
      }),
    );
    struts.castShadow = true;
    this.group.add(struts);

    // 바닥 기초 링(온전한 녹슨 금속 테)
    const base = new THREE.Mesh(
      new THREE.TorusGeometry(this.radius, 0.18, 8, 80),
      new THREE.MeshStandardMaterial({ color: 0x4a3220, metalness: 0.5, roughness: 0.8 }),
    );
    base.rotation.x = Math.PI / 2;
    base.position.y = 0.02;
    base.castShadow = true;
    this.group.add(base);

    // 몇 개 남은 온전한 유리 패널 + 깨진 틈 근처의 부서진/처진 패널 실루엣
    this.buildBrokenPanels();
  }

  /**
   * 부서진 패널 실루엣. 삼각 패널 몇 장을 돔 표면에 남기고(온전),
   * 깨진 틈 근처엔 떨어져 나가 비스듬히 걸린 어두운 패널을 배치한다.
   */
  private buildBrokenPanels(): void {
    const intactMat = new THREE.MeshStandardMaterial({
      color: 0x8fa6a2,
      transparent: true,
      opacity: 0.22,
      roughness: 0.35,
      metalness: 0.1,
      emissive: 0x1c2a28,
      emissiveIntensity: 0.2,
      side: THREE.DoubleSide,
    });
    const rng = makeRng(303);

    // 온전한 패널 몇 장(돔 상부에 흩뿌림) — 삼각(CircleGeometry 3분할)
    for (let i = 0; i < 7; i++) {
      const az = rng() * Math.PI * 2;
      const th = 0.2 + rng() * 0.9;
      // 깨진 틈 근처는 비워 둔다
      if (Math.abs(this.angleDiff(az, this.gapAzimuth)) < 0.7 && th < 1.0) continue;
      const panel = new THREE.Mesh(new THREE.CircleGeometry(1.5, 3), intactMat);
      const r = this.radius - 0.1;
      panel.position.set(
        Math.sin(th) * Math.cos(az) * r,
        Math.cos(th) * r,
        Math.sin(th) * Math.sin(az) * r,
      );
      panel.lookAt(0, panel.position.y * 0.6, 0);
      panel.rotation.z = rng() * Math.PI;
      this.group.add(panel);
    }

    // 공중에 떠 보이던 "부서진 비스듬한 패널"은 요청에 따라 제거(정체불명 오브젝트 정리).
  }

  /** 깨진 가장자리: 뾰족뾰족한 유리 파편 링(틈 주변). */
  private buildBrokenRim(): void {
    const shardMat = new THREE.MeshStandardMaterial({
      color: 0xbfd0cc,
      transparent: true,
      opacity: 0.35,
      roughness: 0.25,
      metalness: 0.1,
      emissive: 0x2a3a38,
      emissiveIntensity: 0.2,
      side: THREE.DoubleSide,
    });
    const rng = makeRng(7);
    const shardCount = 34; // 더 부서진 느낌으로 파편 증가
    for (let i = 0; i < shardCount; i++) {
      // 틈 주변(gapAzimuth ± 0.7, gapPolar 위쪽)에 파편을 흩뿌린다.
      const az = this.gapAzimuth + (rng() - 0.5) * 1.4;
      const th = this.gapPolar + (rng() - 0.5) * 0.7;
      const r = this.radius - 0.05;
      const cx = Math.sin(th) * Math.cos(az) * r;
      const cy = Math.cos(th) * r;
      const cz = Math.sin(th) * Math.sin(az) * r;

      const s = 0.4 + rng() * 1.1;
      const shard = new THREE.Mesh(
        new THREE.ConeGeometry(s * 0.4, s, 3),
        shardMat,
      );
      shard.position.set(cx, cy, cz);
      shard.lookAt(0, cy * 0.5, 0);
      shard.rotation.z = rng() * Math.PI;
      this.group.add(shard);
    }
  }

  /** 깨진 틈으로 내리는 빛줄기(God Ray) — 반투명 가산 콘 몇 개. */
  private buildGodRays(): THREE.MeshBasicMaterial {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffcf9a,
      transparent: true,
      opacity: 0.04,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    // 틈 지점에서 지면으로 향하는 긴 콘 여러 개
    const gx = Math.sin(this.gapPolar) * Math.cos(this.gapAzimuth) * this.radius;
    const gy = Math.cos(this.gapPolar) * this.radius;
    const gz = Math.sin(this.gapPolar) * Math.sin(this.gapAzimuth) * this.radius;
    const gap = new THREE.Vector3(gx, gy, gz);

    for (let i = 0; i < 5; i++) {
      const h = 20;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.6 + i * 0.5, h, 16, 1, true), mat);
      // 콘 꼭짓점을 틈에 두고 아래(-y, 안쪽)를 향하게
      const target = new THREE.Vector3(
        (Math.random() - 0.5) * 4,
        0,
        -3 + (Math.random() - 0.5) * 4,
      );
      const mid = gap.clone().lerp(target, 0.5);
      cone.position.copy(mid);
      cone.lookAt(target);
      cone.rotateX(Math.PI / 2); // 콘 축(+y)을 진행방향으로
      cone.scale.y = gap.distanceTo(target) / h;
      this.group.add(cone);
    }
    return mat;
  }

  /** 깨진 틈에서 화단 가장자리로 쏟아지는 붉은 모래 파티클. */
  private buildSandPour(): { points: THREE.Points; vel: Float32Array } {
    const n = 220;
    const positions = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const gx = Math.sin(this.gapPolar) * Math.cos(this.gapAzimuth) * this.radius;
    const gy = Math.cos(this.gapPolar) * this.radius;
    const gz = Math.sin(this.gapPolar) * Math.sin(this.gapAzimuth) * this.radius;

    for (let i = 0; i < n; i++) {
      positions[i * 3] = gx + (Math.random() - 0.5) * 2.5;
      positions[i * 3 + 1] = gy - Math.random() * gy;
      positions[i * 3 + 2] = gz + (Math.random() - 0.5) * 2.5;
      vel[i * 3] = (Math.random() - 0.5) * 0.2;
      vel[i * 3 + 1] = -(1.5 + Math.random() * 2);
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xb5673a,
      size: 0.12,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    points.userData.gap = { gx, gy, gz };
    this.group.add(points);
    return { points, vel };
  }

  /** 끊어진 전선에서 이따금 튀는 푸른 스파크. */
  private buildSpark(): THREE.PointLight {
    const light = new THREE.PointLight(0x66ccff, 0, 6);
    // 틈 근처 뼈대 위에 배치
    const az = this.gapAzimuth + 0.9;
    const th = 0.75;
    light.position.set(
      Math.sin(th) * Math.cos(az) * this.radius * 0.95,
      Math.cos(th) * this.radius * 0.95,
      Math.sin(th) * Math.sin(az) * this.radius * 0.95,
    );
    this.group.add(light);
    return light;
  }

  /** 외부 소품: 기운 태양광 패널, 반쯤 묻힌 안테나, 끊어진 파이프. */
  private buildExteriorProps(): void {
    // 기울어진 태양광 패널 2장 (돔 좌측 밖)
    const panelMat = new THREE.MeshStandardMaterial({
      color: 0x1a2a3a,
      metalness: 0.4,
      roughness: 0.5,
      emissive: 0x0a1420,
      emissiveIntensity: 0.2,
    });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, metalness: 0.6, roughness: 0.5 });
    for (const [px, pz, rot, tilt] of [
      [-13, -2, 0.4, -0.5],
      [-15, -6, 0.9, -0.4],
    ] as const) {
      const g = new THREE.Group();
      const panel = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 2), panelMat);
      panel.castShadow = true;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.4, 8), frameMat);
      post.position.y = -0.7;
      g.add(panel, post);
      g.position.set(px, 1.4, pz);
      g.rotation.set(tilt, rot, 0.15);
      this.group.add(g);
    }

    // 모래에 반쯤 묻힌 통신 안테나(기울어진 접시)
    const antenna = new THREE.Group();
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.12, 4, 8),
      frameMat,
    );
    mast.position.y = 1.4;
    const dish = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4),
      new THREE.MeshStandardMaterial({ color: 0x8a8a86, metalness: 0.5, roughness: 0.6, side: THREE.DoubleSide }),
    );
    dish.rotation.x = -1.9;
    dish.position.y = 3;
    antenna.add(mast, dish);
    antenna.position.set(13.5, -0.3, -8);
    antenna.rotation.z = 0.35;
    antenna.castShadow = true;
    this.group.add(antenna);

    // 끊어진 파이프 라인(돔 밖에서 안으로 이어지다 끊김)
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x6a5040, metalness: 0.5, roughness: 0.7 });
    for (const [x1, z1, x2, z2] of [
      [16, -3, 9, -4],
      [8.5, -4.2, 5, -5],
    ] as const) {
      const a = new THREE.Vector3(x1, 0.4, z1);
      const b = new THREE.Vector3(x2, 0.4, z2);
      const len = a.distanceTo(b);
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, len, 10), pipeMat);
      pipe.position.copy(a).lerp(b, 0.5);
      pipe.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        b.clone().sub(a).normalize(),
      );
      pipe.castShadow = true;
      this.group.add(pipe);
    }
  }

  /** 내부 소품: 물탱크, 제어 패널, 농업 로봇 잔해, 말라붙은 수로. */
  private buildInteriorProps(): void {
    // 물탱크(원통) — 화단 뒤쪽
    const tank = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 0.9, 2.2, 20),
      new THREE.MeshStandardMaterial({ color: 0x5c6b6e, metalness: 0.4, roughness: 0.6 }),
    );
    // 가운데를 비우도록 좌측 돔 벽 쪽으로 치워 배치
    tank.position.set(-8.5, 1.1, -7.5);
    tank.castShadow = true;
    // 탱크에 남은 물 표시용 청록 밴드
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.92, 0.92, 0.5, 20),
      new THREE.MeshStandardMaterial({ color: 0x2f8f8a, emissive: 0x0a3a38, emissiveIntensity: 0.4, metalness: 0.3, roughness: 0.4 }),
    );
    band.position.set(-8.5, 0.4, -7.5);
    this.group.add(tank, band);

    // 제어 패널(부서진 모니터) — 다이제틱 UI(타이머 등) 자리
    const panel = new THREE.Group();
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 1.1, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x2a2c2e, metalness: 0.5, roughness: 0.6 }),
    );
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 0.8),
      new THREE.MeshStandardMaterial({
        color: 0x102015,
        emissive: 0x1a3a12,
        emissiveIntensity: 0.5,
      }),
    );
    screen.position.z = 0.16;
    panel.add(box, screen);
    panel.position.set(3.4, 1.2, -6.4);
    panel.rotation.y = -0.5;
    panel.castShadow = true;
    this.group.add(panel);

    // 농업 로봇 잔해는 요청에 따라 제거(정체불명 오브젝트 정리).

    // 말라붙은 수로(움푹한 좁고 긴 홈) — 화단 앞을 가로질러
    const channel = new THREE.Mesh(
      new THREE.BoxGeometry(5, 0.12, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x3a2418, roughness: 1 }),
    );
    channel.position.set(0, 0.04, -1.4);
    channel.receiveShadow = true;
    this.group.add(channel);
  }

  /** @internal */
  private angleDiff(a: number, b: number): number {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  update(dt: number, elapsed: number): void {
    // 모래 폭포: 아래로 떨어지고 바닥에 닿으면 틈으로 되돌린다.
    const pos = this.sandPour.geometry.attributes.position as THREE.BufferAttribute;
    const g = this.sandPour.userData.gap as { gx: number; gy: number; gz: number };
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + this.sandVel[i * 3 + 1] * dt;
      let x = pos.getX(i) + this.sandVel[i * 3] * dt;
      let z = pos.getZ(i) + this.sandVel[i * 3 + 2] * dt;
      if (y <= 0.05) {
        // 리셋: 틈 근처로
        x = g.gx + (Math.random() - 0.5) * 2.5;
        y = g.gy - Math.random() * 1.5;
        z = g.gz + (Math.random() - 0.5) * 2.5;
      }
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;

    // God Ray 은은한 밝기 흔들림(먼지 입자가 지나가는 느낌)
    this.godRayMat.opacity = 0.065 + Math.sin(elapsed * 0.7) * 0.018;

    // 끊어진 전선 스파크: 가끔 번쩍
    this.sparkTimer -= dt;
    if (this.sparkTimer <= 0) {
      this.spark.intensity = 2.5;
      this.sparkTimer = 1.5 + Math.random() * 3;
    } else {
      this.spark.intensity *= Math.pow(0.02, dt); // 빠르게 감쇠
    }
  }
}
