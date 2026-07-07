import * as THREE from "three";
import { Sky } from "./Sky";
import { createTerrain } from "./Terrain";
import { createRocks, createGravel } from "./Rocks";
import { createCrackedFloor } from "./Floor";
import { EdenDome } from "./EdenDome";
import { DustField } from "./DustField";
import { HazeBanks } from "./HazeBanks";

/**
 * 화성 환경 전체 조립체.
 * 하늘·지형·바위·에덴 돔·먼지·조명을 한 곳에서 구성하고,
 * 태양광(그림자용 DirectionalLight)을 Sky의 태양 방향과 일치시킨다.
 *
 * "죽음 속에서 피어나는 생명" — 배경은 채도 낮은 적갈색으로 깔고,
 * 생명 요소(감자빛)에만 초록 보조광을 준다.
 */
export class MarsEnvironment {
  readonly group = new THREE.Group();
  readonly sky: Sky;
  readonly dome: EdenDome;
  readonly dust: DustField;
  readonly haze: HazeBanks;
  /** 감자밭 생명 보조광 — 성장 단계에 따라 세기를 올릴 수 있도록 노출. */
  readonly lifeLight: THREE.PointLight;

  private fog!: THREE.FogExp2;
  private readonly fogDensity = 0.0075; // 콘셉트 아트의 은은한 모래 헤이즈(God ray가 살짝 보이게)
  private elapsed = 0;

  constructor(scene: THREE.Scene) {
    // --- 화성 뿌연 먼지 대기: 지수 안개(FogExp2). 콘셉트 아트의 따뜻한 모래빛 헤이즈. ---
    this.fog = new THREE.FogExp2(0x7d4a28, this.fogDensity);
    scene.fog = this.fog;

    // --- 하늘 + 천체 ---
    this.sky = new Sky();
    this.group.add(this.sky.group);

    // --- 조명: 노을/새벽의 낮고 붉은 태양 → 길고 부드러운 그림자 ---
    this.setupLights(scene);

    // --- 지형(중·후경) + 각진 바위 + 근경 자갈 + 전경 금 간 석판 바닥 ---
    this.group.add(createTerrain());
    this.group.add(createRocks());
    this.group.add(createGravel());
    this.group.add(createCrackedFloor());

    // --- 무너진 에덴 돔 + 소품 + God Ray + 모래 폭포 ---
    this.dome = new EdenDome();
    this.group.add(this.dome.group);

    // --- 바람에 날리는 먼지(공중 + 지면 두 겹) ---
    this.dust = new DustField();
    this.group.add(this.dust.points, this.dust.ground);

    // --- 흐르는 안개/먼지 뱅크 + 원경 모래 회오리 ---
    this.haze = new HazeBanks();
    this.group.add(this.haze.group);

    // --- 감자밭 생명 보조광(약한 초록) ---
    this.lifeLight = new THREE.PointLight(0x5bd66a, 0.6, 6, 2);
    this.lifeLight.position.set(0, 0.9, -2.7);
    this.group.add(this.lifeLight);

    scene.add(this.group);
  }

  private setupLights(scene: THREE.Scene): void {
    // 환경광: 낮은 채도의 붉은 하늘빛(위) + 어두운 지면 반사(아래).
    // 세기를 낮춰 그림자를 더 짙게 → 골든아워 대비감(사실적).
    const hemi = new THREE.HemisphereLight(0xc78a54, 0x241109, 0.65);
    scene.add(hemi);

    // 태양(그림자 생성). Sky의 sunDirection에서 비추도록 배치.
    const sun = new THREE.DirectionalLight(0xffce9c, 2.6);
    const dir = this.sky.sunDirection;
    sun.position.copy(dir).multiplyScalar(40);
    sun.target.position.set(0, 0, -3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 90;
    const s = 30;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun);
    scene.add(sun.target);

    // 지평선 태양의 따뜻한 채움광(그림자 없음) — 붉은 톤 강화
    const fill = new THREE.DirectionalLight(0xd8663a, 0.35);
    fill.position.set(-dir.x, 2, -dir.z).multiplyScalar(20);
    scene.add(fill);
  }

  update(dt: number): void {
    this.elapsed += dt;
    this.sky.update(dt);
    this.dust.update(dt, this.elapsed);
    this.haze.update(dt, this.elapsed);
    this.dome.update(dt, this.elapsed);

    // 안개 미세 호흡: 먼지가 몰려왔다 걷히는 듯 밀도가 아주 느리게 오르내림.
    this.fog.density = this.fogDensity + Math.sin(this.elapsed * 0.13) * 0.0012;
  }
}
