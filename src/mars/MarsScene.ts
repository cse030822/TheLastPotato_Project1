import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { VignetteShader } from "three/examples/jsm/shaders/VignetteShader.js";
import { MarsEnvironment } from "./environment/MarsEnvironment";

/**
 * 화성 메인 3D 공간.
 * 환경(하늘·지형·에덴 돔·먼지·조명)은 MarsEnvironment가 담당하고,
 * 여기서는 카메라/렌더러만 조립한다. 조준·발사는 화면 밖 플레이어의 손동작으로
 * 직접 처리하므로 화면에 보이는 테라건 모델은 두지 않는다.
 */
export class MarsScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly env: MarsEnvironment;

  // [2단계] 포스트프로세싱 파이프라인
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // [0단계] 하이엔드 SF 룩을 위한 렌더러 기본 설정
    //  - ACES 필름 톤매핑 + 노출 1.2 → 노을빛 붉은 대비와 발광을 자연스럽게
    //  - 그림자: PCFSoft (위에서 설정)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // --- 카메라: 정원사가 눈앞 화단을 살짝 내려다보는 1인칭 시점 ---
    this.camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.1,
      600,
    );
    this.camera.position.set(0, 1.75, 3.6);
    this.camera.lookAt(0, 0.2, -2.5);

    // --- 화성 환경 전체(하늘·지형·바위·에덴 돔·먼지·조명) ---
    this.env = new MarsEnvironment(this.scene);

    // 테라건 모델 없음: 조준·발사는 손동작으로 직접(빔이 손 위치를 따라 즉시 나감).
    // 감자·곤충은 게임 로직(Garden/BugManager)이 소유하며 main에서 조립한다.

    // [2단계] 포스트프로세싱 구성
    this.setupPostProcessing();

    window.addEventListener("resize", () => this.onResize());
  }

  /**
   * [2단계] Bloom + 비네팅 포스트프로세싱.
   *  - UnrealBloomPass(threshold 0.3, strength 1.3, radius 0.4):
   *    에너지 파티클·감자 발광·노즐 라이트만 네온처럼 번지고 배경은 과하지 않게.
   *  - VignetteShader: 화면 가장자리를 살짝 어둡게 → 중앙(손·감자·테라건)에 시선 집중.
   *  - OutputPass: 컴포저 마지막에서 톤매핑(ACES) + sRGB 변환을 올바르게 적용.
   */
  private setupPostProcessing(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;

    // 중요: 렌더러 크기를 초기화한다. (컴포저 렌더 경로로 바꾸면서 매 프레임
    // renderer.setSize 호출이 사라졌고, EffectComposer.setSize는 렌더러 크기를
    // 바꾸지 않는다. 이걸 빼먹으면 렌더러가 기본 300×150에 머물러 화면이 깨진다.)
    this.renderer.setSize(w, h);

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer.setSize(w, h);

    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      0.7, // strength: 화면 전체 번짐을 줄여 선명하게(1.3→0.7)
      0.3, // radius: 번짐 반경 축소(0.4→0.3)
      0.5, // threshold: 밝은 발광(에너지·감자빛)만 번지도록 문턱 상향(0.3→0.5)
    );
    this.composer.addPass(this.bloomPass);

    const vignette = new ShaderPass(VignetteShader);
    vignette.uniforms.offset.value = 0.95; // 클수록 어두운 영역이 가장자리로 좁아짐
    vignette.uniforms.darkness.value = 1.15; // 가장자리 어둠 강도
    this.composer.addPass(vignette);

    // 톤매핑·색공간 최종 처리(컴포저 사용 시 필수)
    this.composer.addPass(new OutputPass());
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(w, h);
  }

  /** 매 프레임 환경 애니메이션(먼지·모래·위성·스파크). */
  update(dt: number): void {
    this.env.update(dt);
  }

  render(): void {
    // 렌더러 대신 컴포저를 통해 렌더링(Bloom·비네팅·톤매핑 적용).
    this.composer.render();
  }
}
