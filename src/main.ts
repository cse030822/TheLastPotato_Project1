import "./styles.css";
import { MarsScene } from "./mars/MarsScene";
import { HandTracker } from "./hands/HandTracker";
import type { HandReading } from "./hands/gestures";
import { HandSkeletonOverlay } from "./hands/HandSkeletonOverlay";
import { HUD } from "./game/HUD";
import { Crosshair, type AimPoint } from "./game/Crosshair";
import { JetController } from "./particles/JetController";
import { Beam } from "./particles/Beam";
import { BugManager } from "./game/BugManager";
import { Garden } from "./game/Garden";
import { GameHUD } from "./game/GameHUD";
import { EventFx } from "./game/EventFx";
import { HarvestFx } from "./game/HarvestFx";
import { Sound } from "./game/Sound";
import { Screens } from "./game/Screens";
import * as THREE from "three";

// --- DOM 참조 ---
const sceneCanvas = document.getElementById("scene") as HTMLCanvasElement;
const video = document.getElementById("webcam") as HTMLVideoElement;
const overlayCanvas = document.getElementById("overlay") as HTMLCanvasElement;
const pip = document.getElementById("cam-pip") as HTMLDivElement;

// --- 모듈 구성 ---
const mars = new MarsScene(sceneCanvas);
const tracker = new HandTracker(video);
const overlay = new HandSkeletonOverlay(overlayCanvas);
const hud = new HUD();
const jets = new JetController(mars.scene);

// 얇은 에너지 광선(빔) — 오른손=시안(물), 왼손=붉은(불꽃). 큰 광원 대신 가느다란 직선.
const beamRight = new Beam(0x46c8ff);
const beamLeft = new Beam(0xff5a3c);
mars.scene.add(beamRight.group, beamLeft.group);

// 화면 밖 플레이어의 손 → 조준 원점(화면 하단 좌/우). 테라건 모델은 없다.
const originRight = new THREE.Vector3(0.8, 0.7, 3.0); // 오른손 = 시안(에너지)
const originLeft = new THREE.Vector3(-0.8, 0.7, 3.0); // 왼손 = 붉은(방어)
const emitOrigin = new THREE.Vector3(0, 0.7, 3.0); // 씨앗·퇴비가 날아오는 지점

// 수확 연출(생명빛 입자) + 효과음(WebAudio 신스).
const harvestFx = new HarvestFx(mars.scene);
const sound = new Sound();

// 감자는 플레이어가 씨앗을 쏴서 직접 배치한다(고정 위치 없음).
const garden = new Garden(
  mars.scene,
  () => emitOrigin.clone(),
  () => {
    console.warn("[화성 정원사] 승리: 감자를 모두 키워냈습니다!");
    sound.win();
  },
  () => {
    console.warn("[화성 정원사] 실패: 감자가 모두 파괴되었습니다.");
    sound.lose();
  },
);

// 감자알이 돋을 때마다 그 자리에 입자 버스트 + 상승하는 수확음.
garden.onHarvest = (wp) => {
  harvestFx.pop(wp);
  sound.harvest(garden.totalHarvest);
};

// 7단계 게임 HUD(상태 패널·감자별 성장 게이지·결과 오버레이).
const gameHud = new GameHUD(mars.camera);

// 게임 중 이벤트 이팩트(곤충 출현·시간 기점·완전 성장). 게임을 멈추지 않는 연출.
const eventFx = new EventFx();
// 각 이팩트를 한 번씩만 띄우기 위한 플래그(재시작 시 초기화).
let fxFirstBug = false;
let fx30 = false;
let fx10 = false;
let fxGrown = false;

// 외계 곤충 웨이브. 에너지 단계부터 등장 → 가장 가까운(비보호) 감자로 접근.
const bugs = new BugManager(mars.scene, garden.potatoes, () => {});

// 손 조준점(크로스헤어) + 지면 목표점 계산용
const crosshair = new Crosshair();
const _aimRay = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _target = new THREE.Vector3();
const _plantPt = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.12);

// 에너지 미터(레퍼런스 좌하단 패널). 오른손 에너지 분사 중엔 서서히 줄고, 쉬면 빠르게 회복.
// 순전히 연출용 — 발사를 막지는 않는다(0%여도 분사 가능).
let energy = 100;
const ENERGY_DRAIN = 26; // %/초(분사 중)
const ENERGY_RECHARGE = 34; // %/초(비분사)

// 프레임 간 보간된 조준점(웹캠 프레임레이트로 인한 뚝뚝 끊김 제거).
const aimLeft: AimPoint = { present: false, x: 0.5, y: 0.5, state: "IDLE" };
const aimRight: AimPoint = { present: false, x: 0.5, y: 0.5, state: "IDLE" };
let prevRightFire = false;

/** 손 화면좌표를 부드럽게 따라가도록 보간(등장 순간에는 스냅). */
function updateAim(hand: HandReading | null, a: AimPoint, dt: number): void {
  if (!hand) {
    a.present = false;
    return;
  }
  if (!a.present) {
    a.x = hand.screenX;
    a.y = hand.screenY;
  } else {
    const k = 1 - Math.exp(-dt / 0.05); // ~0.05s 시정수의 부드러운 추종
    a.x += (hand.screenX - a.x) * k;
    a.y += (hand.screenY - a.y) * k;
  }
  a.present = true;
  a.state = hand.state;
}

/** 보간 조준점 → 카메라 레이 → 지면 목표점(out). 손이 없으면 false. */
function aimGround(a: AimPoint, out: THREE.Vector3): boolean {
  if (!a.present) return false;
  _ndc.set(a.x * 2 - 1, -(a.y * 2 - 1));
  _aimRay.setFromCamera(_ndc, mars.camera);
  if (!_aimRay.ray.intersectPlane(_groundPlane, out)) {
    out.copy(_aimRay.ray.origin).addScaledVector(_aimRay.ray.direction, 40);
  }
  return true;
}

/** 손동작(FIRE) 즉시 그 방향(지면 목표점)으로 빔을 쏘고 곤충을 타격한다. */
function aimFire(a: AimPoint, beam: Beam, origin: THREE.Vector3, dt: number): void {
  if (!a.present || a.state !== "FIRE" || !aimGround(a, _target)) {
    beam.set(false, origin, origin);
    return;
  }
  sound.unlock(); // 손 발사도 사용자 제스처 — 오디오 준비
  _dir.copy(_target).sub(origin).normalize();
  beam.set(true, origin, _dir);
  bugs.hitBeam(origin, _dir, 45, 13 * dt); // 초당 13 데미지(체력 3 → 약 0.23초 접촉이면 격파)
}

// 제스처(FIRE)가 잘 안 될 때 대비: [Space]로 씨앗 심기.
// 오른손 조준 위치가 있으면 그곳, 없으면 앞쪽에 순서대로 벌려 심는다.
const _kbPlant = new THREE.Vector3();
window.addEventListener("keydown", (e) => {
  if (appState !== "playing") return;
  if (e.code !== "Space" || garden.phase !== "seed") return;
  e.preventDefault();
  if (aimRight.present && aimGround(aimRight, _kbPlant)) {
    garden.plantAt(_kbPlant);
  } else {
    const n = garden.placedCount;
    garden.plantAt(new THREE.Vector3((n - 1) * 1.6, 0, -3));
  }
});

// [D] 손 뼈대 토글 / [H] 도움말 열고닫기 / [Esc] 도움말 닫기 / [R] 재시작 (게임 중에만)
window.addEventListener("keydown", (e) => {
  if (appState !== "playing") return;
  sound.unlock(); // 첫 사용자 제스처에서 오디오 컨텍스트 준비
  if (e.key === "Escape") {
    setHelp(false);
    return;
  }
  const k = e.key.toLowerCase();
  if (k === "d") overlay.toggle();
  else if (k === "h") setHelp(!helpOpen);
  else if (k === "r") restart();
});

/** 게임 전체 초기화(승리·패배 후 또는 언제든 [R]). */
function restart(): void {
  setHelp(false); // 도움말이 열려 있으면 닫고 재시작
  garden.reset();
  bugs.reset();
  gameHud.reset();
  harvestFx.clear();
  eventFx.reset();
  fxFirstBug = fx30 = fx10 = fxGrown = false;
  energy = 100;
  aimLeft.present = false;
  aimRight.present = false;
  prevRightFire = false;
}

// PIP 창은 웹캠 로드 후 크기가 확정되므로 오버레이 캔버스도 그때 맞춘다.
window.addEventListener("resize", () => overlay.resize());

// --- 화면 상태(인트로 → 카메라 권한 → 게임) ---
type AppState = "intro" | "camera" | "playing";
let appState: AppState = "intro";
let startingGame = false;

const screens = new Screens({
  onStart: () => screens.show("camera"), // START → 카메라 권한 안내 화면
  onBack: () => screens.show("intro"),
  onAllowCamera: () => void startGame(), // 카메라 권한 화면에서 실제 권한 요청 + 플레이 진입
});
screens.show("intro");

// --- 게임 중 도움말(플레이 방법) 오버레이 ---
// 옛 '플레이 방법' 텍스트 화면을 게임 도중 언제든 열어보는 창으로 재사용한다.
// 열려 있는 동안 게임은 일시정지된다(아래 루프에서 플레이 갱신을 건너뜀).
const helpScreen = document.getElementById("help-screen")!;
let helpOpen = false;
function setHelp(open: boolean): void {
  helpOpen = open;
  helpScreen.classList.toggle("visible", open);
}
document.getElementById("btn-help-open")!.addEventListener("click", () => setHelp(true));
document.getElementById("btn-help-close")!.addEventListener("click", () => setHelp(false));

/** "게임 시작"에서 웹캠+모델을 로드한 뒤 실제 플레이로 진입. */
async function startGame(): Promise<void> {
  if (startingGame || appState === "playing") return;
  startingGame = true;
  sound.unlock(); // 사용자 제스처(클릭) 시점에 오디오 컨텍스트 준비
  screens.setBusy(true);
  screens.setStatus("카메라 준비 중…", "loading");
  try {
    await tracker.startWebcam(); // 웹캠 권한 요청 + 스트림
    await tracker.loadModel(); // MediaPipe HandLandmarker 로드
    overlay.resize();
    appState = "playing";
    screens.setStatus("");
    screens.show("playing");
    console.log("[화성 정원사] 준비 완료. 손을 화면에 비춰보세요.");
  } catch (err) {
    console.error("[화성 정원사] 카메라/모델 초기화 실패:", err);
    screens.setStatus(
      "카메라를 사용할 수 없습니다. 브라우저 권한을 허용한 뒤 다시 시도해 주세요.",
      "error",
    );
    screens.setBusy(false);
  } finally {
    startingGame = false;
  }
}

let prev = performance.now();
let lastLog = 0;

function loop(now: number): void {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;

  // 게임 플레이 갱신은 실제 플레이 중이면서 도움말이 닫혀 있을 때만.
  // (인트로/카메라/도움말 화면에서는 화성 씬만 배경으로 렌더되고 게임은 멈춘다.)
  if (appState === "playing" && !helpOpen) {
  // 1) 손 감지 + 제스처 상태
  const frame = tracker.detect(now);

  // 손 좌표를 콘솔에 출력(1단계 완료 기준). 매 프레임은 과하므로 ~0.4초 간격.
  if (frame.hands.length > 0 && now - lastLog > 400) {
    lastLog = now;
    for (const h of frame.hands) {
      const w = h.landmarks[0];
      console.log(
        `[${h.side}] ${h.state}  손목=(${w.x.toFixed(2)}, ${w.y.toFixed(2)})`,
      );
    }
  }

  // 2) 손 뼈대 오버레이
  overlay.draw(frame.hands);

  // 3) HUD 손 상태 텍스트 + 조준점 보간 + 크로스헤어
  hud.update(frame.left, frame.right);
  updateAim(frame.left, aimLeft, dt);
  updateAim(frame.right, aimRight, dt);
  crosshair.update(aimLeft, aimRight);

  // 4) seed 단계: 오른손 발사 상승엣지에 조준점 지면에 씨앗을 심는다(플레이어가 위치 결정).
  const rightFire = aimRight.present && aimRight.state === "FIRE";
  if (
    garden.phase === "seed" &&
    rightFire &&
    !prevRightFire &&
    aimGround(aimRight, _plantPt)
  ) {
    garden.plantAt(_plantPt);
  }
  prevRightFire = rightFire;

  // 5) 손동작 → 즉시 조준·발사. 오른손 = 시안 에너지, 왼손 = 붉은 방어. 둘 다 곤충 타격.
  aimFire(aimRight, beamRight, originRight, dt);
  aimFire(aimLeft, beamLeft, originLeft, dt);

  // 에너지 미터: 오른손 분사 중엔 감소, 아니면 회복(연출용, 0~100 클램프).
  const emitting = aimRight.present && aimRight.state === "FIRE";
  energy = Math.max(0, Math.min(100, energy + (emitting ? -ENERGY_DRAIN : ENERGY_RECHARGE) * dt));

  // 6) 감자밭 진행(씨앗→퇴비→에너지, 오른손 빔으로 에너지 공급 시 성장·발광).
  garden.update(dt, beamRight);

  // 7) 곤충 웨이브. 퇴비(compost) 단계부터 스폰 활성화.
  bugs.setEnabled(garden.threatsActive);
  bugs.update(dt);

  // 8) 수확 입자 연출 + 게임 HUD(목표·타이머·WAVE·에너지·성장 링·조작·결과).
  harvestFx.update(dt);
  gameHud.update(garden, bugs.count, energy);

  // 9) 이벤트 이팩트(각각 한 번씩): 곤충 첫 등장 · 30초/10초 기점 · 첫 완전 성장.
  //    이미지는 play({..., image: "/파일.png"})로 넣으면 이팩트 중앙에 크게 박힌다.
  if (!fxFirstBug && garden.threatsActive && bugs.count > 0) {
    fxFirstBug = true;
    eventFx.play({ tone: "danger", title: "외계 곤충 출현!", sub: "왼손 붉은 에너지로 격퇴하라!" });
  }
  if (garden.phase === "energy") {
    if (!fx30 && garden.timeLeft <= 30) {
      fx30 = true;
      eventFx.play({ tone: "warn", title: "절반 지점!", sub: "30초 남았다 — 감자를 지켜라" });
    }
    if (!fx10 && garden.timeLeft <= 10) {
      fx10 = true;
      eventFx.play({ tone: "danger", title: "마지막 10초!", sub: "끝까지 버텨라!" });
    }
    if (!fxGrown && garden.potatoes.some((p) => p.grown)) {
      fxGrown = true;
      eventFx.play({ tone: "life", title: "감자 완전 성장!", sub: "화성에 생명이 뿌리내렸다" });
    }
  }
  }

  // 화성 환경 애니메이션(먼지·모래 폭포·위성·스파크) — 배경으로 항상 갱신
  mars.update(dt);

  // 렌더
  mars.render();

  requestAnimationFrame(loop);
}

// PIP 모드로 시작(3단계 이후 상태). 필요 시 data-mode="full"로 전체화면 전환 가능.
pip.dataset.mode = "pip";

// 개발 편의용 디버그 훅(프로덕션 번들에는 포함되지 않음).
if (import.meta.env.DEV) {
  (window as unknown as { __mars: unknown }).__mars = { mars, tracker, jets, beamRight, beamLeft, bugs, garden, gameHud, harvestFx, eventFx, screens, THREE };
}

// 렌더 루프는 즉시 시작(인트로 화면 뒤로 화성 씬이 바로 보인다).
// 웹캠·손추적은 "게임 시작"을 눌러 startGame()에서 로드한다.
requestAnimationFrame(loop);
