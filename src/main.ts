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
import { PointerSelect } from "./game/PointerSelect";
import { layout } from "./view/layout";
import * as THREE from "three";

// --- DOM 참조 ---
const sceneCanvas = document.getElementById("scene") as HTMLCanvasElement;
const video = document.getElementById("webcam") as HTMLVideoElement;
const overlayCanvas = document.getElementById("overlay") as HTMLCanvasElement;
const pip = document.getElementById("cam-pip") as HTMLDivElement;

// --- 모듈 구성 ---
const mars = new MarsScene(sceneCanvas);

// 메타존(4면 몰입형 디스플레이) 모드.
//  - 주소에 ?meta 를 붙이면 켜진 채로 시작(예: http://localhost:5173/?meta ).
//  - 플레이 중 언제든 [M] 키로 켜고 끌 수 있다. 기본은 꺼짐(정면 한 화면).
mars.applyMeta(new URLSearchParams(location.search).has("meta"));
window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "m") mars.applyMeta(!layout.meta);
});
const tracker = new HandTracker(video);
const overlay = new HandSkeletonOverlay(overlayCanvas, video);
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
let fxSeed = false;
let fxCompost = false;
let fxFirstBug = false;
let fx30 = false;
let fx10 = false;
let fxGrown = false;

// 외계 곤충 웨이브. 에너지 단계부터 등장 → 가장 가까운(비보호) 감자로 접근.
const bugs = new BugManager(mars.scene, garden.potatoes, () => {});
// 곤충 효과음: 출현·갉아먹기·격파.
bugs.onSpawn = () => sound.bugSpawn();
bugs.onBite = () => sound.bugBite();
bugs.onKill = () => sound.bugKilled();

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
// absent: 손이 감지되지 않은 누적 시간 — 짧은 드롭아웃은 유예(grace)로 흡수한다.
type AimState = AimPoint & { absent: number };
const aimLeft: AimState = { present: false, x: 0.5, y: 0.5, state: "IDLE", absent: 0 };
const aimRight: AimState = { present: false, x: 0.5, y: 0.5, state: "IDLE", absent: 0 };
let plantCooldown = 0; // 씨앗 연발 방지 타이머(초). 0 이하일 때만 다음 씨앗 심기.
let prevBeamR = false; // 오른손 빔 발사 상태(상승엣지에 발사음)
let prevBeamL = false; // 왼손 빔 발사 상태(상승엣지에 발사음)

// 손이 순간적으로(1~3프레임) 사라져도 이 시간 동안은 마지막 조준·상태를 유지한다.
// 두 손이 동시에 있을 때 한쪽 손의 미세한 감지 드롭아웃으로 빔이 깜빡이는 것을 막는다.
const AIM_GRACE = 0.12;

/** 손 화면좌표를 부드럽게 따라가도록 보간(등장 순간에는 스냅). */
function updateAim(hand: HandReading | null, a: AimState, dt: number): void {
  if (!hand) {
    // 감지가 잠깐 끊긴 것일 수 있으므로 유예시간 동안은 마지막 조준/상태를 그대로 유지.
    // (유예 중엔 present=true, x/y·state 불변 → 빔이 끊기지 않는다.)
    if (a.present) {
      a.absent += dt;
      if (a.absent > AIM_GRACE) a.present = false;
    }
    return;
  }
  a.absent = 0;
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

/**
 * 손동작(FIRE) 즉시 그 방향(지면 목표점)으로 빔을 쏜다.
 *  - 오른손(에너지): 감자 성장 전용 — 곤충을 타격하지 않는다.
 *  - 왼손(방어): 곤충 격퇴 전용 — hitsBugs=true일 때만 곤충에 데미지.
 * @returns 이번 프레임에 실제로 발사했는지(발사음 상승엣지 판정용).
 */
function aimFire(
  a: AimPoint,
  beam: Beam,
  origin: THREE.Vector3,
  dt: number,
  hitsBugs: boolean,
): boolean {
  if (!a.present || a.state !== "FIRE" || !aimGround(a, _target)) {
    beam.set(false, origin, origin);
    return false;
  }
  sound.unlock(); // 손 발사도 사용자 제스처 — 오디오 준비
  _dir.copy(_target).sub(origin).normalize();
  beam.set(true, origin, _dir);
  if (hitsBugs) bugs.hitBeam(origin, _dir, 45, 13 * dt); // 초당 13 데미지(체력 3 → 약 0.23초 접촉이면 격파)
  return true;
}

// 제스처(FIRE)가 잘 안 될 때 대비: [Space]로 씨앗 심기.
// 오른손 조준 위치가 있으면 그곳, 없으면 앞쪽에 순서대로 벌려 심는다.
const _kbPlant = new THREE.Vector3();
window.addEventListener("keydown", (e) => {
  if (appState !== "playing" && appState !== "practice") return;
  if (e.code !== "Space" || garden.phase !== "seed") return;
  e.preventDefault();
  let planted: boolean;
  if (aimRight.present && aimGround(aimRight, _kbPlant)) {
    planted = garden.plantAt(_kbPlant);
  } else {
    const n = garden.placedCount;
    planted = garden.plantAt(new THREE.Vector3((n - 1) * 1.6, 0, -3));
  }
  if (planted) sound.plant(); // 실제로 심겼을 때만 심기음
});

// [D] 손 뼈대 토글 / [H] 도움말 열고닫기 / [Esc] 도움말 닫기 / [R] 재시작 (게임·연습 중)
// 연습 모드 추가: [Enter] 실전 시작 / [Esc]로 도움말이 안 열려 있으면 연습 종료(→ 인트로)
window.addEventListener("keydown", (e) => {
  if (appState !== "playing" && appState !== "practice") return;
  sound.unlock(); // 첫 사용자 제스처에서 오디오 컨텍스트 준비
  if (e.key === "Escape") {
    if (helpOpen) setHelp(false);
    else if (appState === "practice") exitPracticeToHowto(); // 연습 중 Esc → 플레이 방법 안내로
    return;
  }
  if (appState === "practice" && e.key === "Enter") {
    void startGame(); // 연습 → 실전 시작
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
  fxSeed = fxCompost = fxFirstBug = fx30 = fx10 = fxGrown = false;
  energy = 100;
  aimLeft.present = false;
  aimRight.present = false;
  aimLeft.absent = 0;
  aimRight.absent = 0;
  plantCooldown = 0;
  prevBeamR = false;
  prevBeamL = false;
}

// PIP 창은 웹캠 로드 후 크기가 확정되므로 오버레이 캔버스도 그때 맞춘다.
window.addEventListener("resize", () => overlay.resize());

// --- 화면 상태(인트로 → 카메라 권한 → 게임) ---
type AppState = "intro" | "camera" | "playing" | "practice";
let appState: AppState = "intro";
let startingGame = false;
let mediaReady = false; // 웹캠+모델을 한 번 로드했는지(종료 후 재시작 시 즉시 복귀).

const screens = new Screens({
  onStart: () => {
    sound.unlock(); // 첫 사용자 제스처 — 막혀 있던 메뉴 배경음악을 여기서 재개
    screens.show("camera"); // START → 카메라 권한 안내 화면
    void autoListCameras(); // 이미 권한이 있으면 카메라 목록을 조용히 채운다
  },
  onBack: () => screens.show("intro"),
  onAllowCamera: () => void startGame(), // 카메라 권한 화면에서 실제 권한 요청 + 플레이 진입
  onRefreshCameras: () => void refreshCameras(), // "카메라 찾기" — 권한 허용 후 목록 채우기
  onPractice: () => void startPractice(), // "먼저 연습하기" — 압박 없는 연습 모드 진입
});
screens.show("intro");
sound.playMenuMusic(); // 인트로·카메라 배경음악(후보 2) — 자동재생이 되면 즉시 재생

// 브라우저 자동재생 정책상 소리는 첫 사용자 조작 후에만 허용된다.
// 그래서 타이틀 화면에서의 첫 조작(어디를 클릭·탭하거나 아무 키나 누르면)에
// 곧바로 후보 2 음악이 시작되도록 한 번만 듣는 리스너를 건다(START 버튼을 굳이 안 눌러도 됨).
function kickMenuMusicOnFirstGesture(): void {
  const kick = (): void => {
    sound.unlock(); // 오디오 컨텍스트 재개 + 막혀 있던 메뉴 음악 재생
    window.removeEventListener("pointerdown", kick);
    window.removeEventListener("keydown", kick);
  };
  window.addEventListener("pointerdown", kick);
  window.addEventListener("keydown", kick);
}
kickMenuMusicOnFirstGesture();

/** 이미 카메라 권한이 있으면(라벨이 보이면) 목록을 조용히 채운다. 권한 요청은 하지 않음. */
async function autoListCameras(): Promise<void> {
  try {
    const cams = await tracker.listCameras();
    if (cams.some((c) => c.label)) screens.setCameras(cams);
  } catch {
    /* 목록 조회 실패는 무시 — 사용자가 '카메라 찾기'로 다시 시도할 수 있다 */
  }
}

/** "카메라 찾기": 권한을 확보하고 실제 카메라 이름으로 선택 목록을 채운다. */
async function refreshCameras(): Promise<void> {
  sound.unlock();
  screens.setRefreshBusy(true);
  screens.setStatus("카메라 목록을 불러오는 중…", "loading");
  try {
    await tracker.ensureCameraPermission(); // 라벨 확보용 임시 권한
    const cams = await tracker.listCameras();
    screens.setCameras(cams);
    screens.setStatus(
      cams.length
        ? `카메라 ${cams.length}대를 찾았어요. 원하는 카메라를 고른 뒤 시작하세요.`
        : "사용 가능한 카메라를 찾지 못했습니다.",
      "",
    );
  } catch (err) {
    console.error("[화성 정원사] 카메라 목록 로드 실패:", err);
    screens.setStatus(
      "카메라 권한이 필요합니다. 브라우저에서 카메라 사용을 허용해 주세요.",
      "error",
    );
  } finally {
    screens.setRefreshBusy(false);
  }
}

// --- 게임 중 도움말(플레이 방법) 오버레이 ---
// 옛 '플레이 방법' 텍스트 화면을 게임 도중 언제든 열어보는 창으로 재사용한다.
// 열려 있는 동안 게임은 일시정지된다(아래 루프에서 플레이 갱신을 건너뜀).
const helpScreen = document.getElementById("help-screen")!;
let helpOpen = false;
function setHelp(open: boolean): void {
  helpOpen = open;
  helpScreen.classList.toggle("visible", open);
}
const btnHelpOpen = document.getElementById("btn-help-open")!;
btnHelpOpen.addEventListener("click", () => setHelp(true));
document.getElementById("btn-help-close")!.addEventListener("click", () => setHelp(false));

// --- 본게임 상단 바 버튼(재시작 / 도움말 / 종료) — 마우스 클릭 + 손 포인터(dwell) 공용 ---
const btnGameRestart = document.getElementById("btn-game-restart")!;
const btnGameQuit = document.getElementById("btn-game-quit")!;
// 플레이 도중 실수 선택을 줄이려 dwell 시간을 조금 길게(기본 1.1초 → 1.6초).
const gamePointer = new PointerSelect(1.6);
// 재시작·도움말·종료를 손 조준점(dwell)으로도 고를 수 있게 한 묶음으로.
const gameButtons: HTMLElement[] = [btnGameRestart, btnHelpOpen, btnGameQuit];
btnGameRestart.addEventListener("click", () => {
  sound.unlock();
  gamePointer.reset();
  restart();
});
btnGameQuit.addEventListener("click", () => {
  sound.unlock();
  gamePointer.reset();
  quit();
});

// --- 결과 화면 버튼(다시하기 / 종료) — 마우스 클릭 + 손 포인터(dwell) 공용 ---
const btnResultRestart = document.getElementById("btn-result-restart")!;
const btnResultQuit = document.getElementById("btn-result-quit")!;
const resultButtons: HTMLElement[] = [btnResultRestart, btnResultQuit];
const resultPointer = new PointerSelect(); // 조준점이 버튼 위에 머물면 자동 선택

// --- 연습 바 버튼(실전 시작 / 나가기) — 마우스 클릭 + 손 포인터(dwell) 공용 ---
const btnPracticeStart = document.getElementById("btn-practice-start")!;
const btnPracticeExit = document.getElementById("btn-practice-exit")!;
const practiceButtons: HTMLElement[] = [btnPracticeStart, btnPracticeExit];
const practicePointer = new PointerSelect(); // 연습 중 조준점을 버튼에 머물러 선택

btnResultRestart.addEventListener("click", () => {
  sound.unlock();
  resultPointer.reset();
  restart();
});
btnResultQuit.addEventListener("click", () => {
  sound.unlock();
  quit();
});

/** 종료: 게임 상태를 초기화하고 타이틀(인트로) 화면으로 돌아간다. */
function quit(): void {
  resultPointer.reset();
  restart();
  garden.practice = false; // 연습 모드였다면 해제
  sound.playMenuMusic(); // 타이틀로 돌아가면 메뉴 배경음악(후보 2)으로 복귀
  appState = "intro";
  screens.show("intro");
}

/** 연습 종료: 상태를 초기화하고 '플레이 방법 안내'(카메라) 화면으로 돌아간다. */
function exitPracticeToHowto(): void {
  resultPointer.reset();
  practicePointer.reset();
  restart();
  garden.practice = false;
  appState = "intro"; // 카메라(플레이 방법 안내) 화면에서는 게임 루프 정지
  screens.show("camera");
  sound.playMenuMusic(); // 안내 화면 배경음악(후보 2)으로 복귀
}

/**
 * 웹캠+모델을 확보한다(이미 로드했으면 즉시, 다른 카메라를 골랐으면 스트림만 교체).
 * "게임 시작"과 "연습하기"가 공유한다.
 * @returns 준비 성공 여부. 실패 시 카메라 화면에 에러를 남긴다.
 */
async function ensureMedia(wantId: string): Promise<boolean> {
  if (mediaReady) {
    // 이미 로드됨: 다른 카메라를 새로 골랐다면 그 카메라로 스트림만 교체.
    if (wantId && wantId !== tracker.deviceId) {
      screens.setBusy(true);
      screens.setStatus("카메라 전환 중…", "loading");
      try {
        await tracker.startWebcam(wantId);
        overlay.resize();
        screens.setStatus("");
      } catch (err) {
        console.error("[화성 정원사] 카메라 전환 실패:", err);
        screens.setStatus("선택한 카메라를 열 수 없습니다. 다른 카메라를 선택해 주세요.", "error");
        screens.setBusy(false);
        return false;
      }
      screens.setBusy(false);
    }
    return true;
  }
  screens.setBusy(true);
  screens.setStatus("카메라 준비 중…", "loading");
  try {
    await tracker.startWebcam(wantId || undefined); // 선택한 카메라(없으면 기본)로 연결
    await tracker.loadModel(); // MediaPipe HandLandmarker 로드
    overlay.resize();
    mediaReady = true;
    screens.setStatus("");
    return true;
  } catch (err) {
    console.error("[화성 정원사] 카메라/모델 초기화 실패:", err);
    screens.setStatus(
      "카메라를 사용할 수 없습니다. 브라우저 권한을 허용한 뒤 다시 시도해 주세요.",
      "error",
    );
    screens.setBusy(false);
    return false;
  }
}

/** "게임 시작"/"실전 시작"에서 웹캠+모델을 확보한 뒤 실제 플레이로 진입. */
async function startGame(): Promise<void> {
  if (startingGame || appState === "playing") return;
  startingGame = true;
  sound.unlock(); // 사용자 제스처(클릭) 시점에 오디오 컨텍스트 준비
  const ok = await ensureMedia(screens.selectedCameraId);
  if (ok) {
    restart();
    garden.practice = false;
    appState = "playing";
    screens.show("playing");
    sound.playGameMusic(); // 플레이 배경음악(후보 1)
  }
  startingGame = false;
}

/** "먼저 연습하기"에서 웹캠+모델을 확보한 뒤 압박 없는 연습 모드로 진입. */
async function startPractice(): Promise<void> {
  if (startingGame || appState === "practice") return;
  startingGame = true;
  sound.unlock();
  const ok = await ensureMedia(screens.selectedCameraId);
  if (ok) {
    restart();
    garden.practice = true; // 타이머·승패 판정 정지(무한 연습) + 곤충 미등장
    appState = "practice";
    screens.show("practice");
    sound.stopMusic(); // 연습 모드는 배경음악 없이(효과음만)
  }
  startingGame = false;
}

// 연습 모드 하단 바 버튼: 실전 시작 / 나가기 (마우스 클릭 + 손 dwell 공용).
btnPracticeStart.addEventListener("click", () => {
  sound.unlock();
  practicePointer.reset();
  void startGame();
});
btnPracticeExit.addEventListener("click", () => {
  sound.unlock();
  exitPracticeToHowto();
});

let prev = performance.now();
let lastLog = 0;

function loop(now: number): void {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;

  // 게임 플레이 갱신은 실제 플레이·연습 중이면서 도움말이 닫혀 있을 때만.
  // (인트로/카메라/도움말 화면에서는 화성 씬만 배경으로 렌더되고 게임은 멈춘다.)
  if ((appState === "playing" || appState === "practice") && !helpOpen) {
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

  // 결과 화면 표시 중에는 발사·심기를 멈추고, 손 조준점을 버튼 선택 커서로 쓴다.
  const resultActive = garden.resultTier !== null;

  plantCooldown -= dt;
  if (!resultActive) {
    // 4) seed 단계: FIRE 상태로 조준하면 씨앗을 심는다. 상승엣지(한 번의 깔끔한 트리거) 대신
    //    짧은 쿨다운을 써서 감지가 조금 튀어도 잘 심기고, 손을 쓸며 씨앗을 뿌릴 수 있다.
    //    같은 자리 중복 심기는 Garden의 간격 규칙(1.4)이 막아준다.
    if (
      garden.phase === "seed" &&
      aimRight.present &&
      aimRight.state === "FIRE" &&
      plantCooldown <= 0 &&
      aimGround(aimRight, _plantPt)
    ) {
      if (garden.plantAt(_plantPt)) {
        sound.plant();
        plantCooldown = 0.35;
      }
    }

    // 5) 손동작 → 즉시 조준·발사. 오른손 = 시안 에너지(감자 성장 전용), 왼손 = 붉은 방어(곤충 격퇴 전용).
    const beamR = aimFire(aimRight, beamRight, originRight, dt, false); // 오른손은 곤충 타격 안 함
    const beamL = aimFire(aimLeft, beamLeft, originLeft, dt, true); //  왼손만 곤충 격퇴
    // 빔 발사음: 매 프레임이 아니라 발사가 시작되는 순간(상승엣지)에만 한 번.
    if (beamR && !prevBeamR) sound.beamFire("energy");
    if (beamL && !prevBeamL) sound.beamFire("defense");
    prevBeamR = beamR;
    prevBeamL = beamL;
  } else {
    // 빔은 끄고 상태만 리셋(다시 게임하면 즉시 발사음).
    beamRight.set(false, originRight, originRight);
    beamLeft.set(false, originLeft, originLeft);
    prevBeamR = prevBeamL = false;
  }

  // 결과 버튼(다시하기/종료)을 손 조준점으로 가리켜 선택. 오른손 우선, 없으면 왼손.
  const ptr = aimRight.present ? aimRight : aimLeft.present ? aimLeft : null;
  // 조준점(0~1)을 정면 영역의 실제 화면 픽셀로 변환(메타존에서는 가운데 영역).
  // 버튼은 정면 영역에 모여 있고 dwell 선택은 getBoundingClientRect(실좌표)로 판정하므로,
  // 여기서도 정면 영역 기준으로 매핑해야 커서와 버튼이 맞는다. 일반 모드면 창 전체와 동일.
  const ptrX = ptr ? layout.front.x + ptr.x * layout.front.w : 0;
  const ptrY = ptr ? layout.front.y + ptr.y * layout.front.h : 0;
  resultPointer.update(resultActive, ptr !== null, ptrX, ptrY, resultButtons, dt);
  // 연습 중에는 조준점으로 하단 바 버튼(실전 시작/나가기)을 손으로 가리켜 선택.
  practicePointer.update(appState === "practice", ptr !== null, ptrX, ptrY, practiceButtons, dt);
  // 본게임 중(결과 오버레이가 없을 때)에는 상단 바 버튼(재시작/도움말/종료)을 손으로 가리켜 선택.
  gamePointer.update(appState === "playing" && !resultActive, ptr !== null, ptrX, ptrY, gameButtons, dt);

  // 에너지 미터: 오른손 분사 중엔 감소, 아니면 회복(연출용, 0~100 클램프).
  const emitting = aimRight.present && aimRight.state === "FIRE";
  energy = Math.max(0, Math.min(100, energy + (emitting ? -ENERGY_DRAIN : ENERGY_RECHARGE) * dt));

  // 6) 감자밭 진행(씨앗→퇴비→에너지, 오른손 빔으로 에너지 공급 시 성장·발광).
  garden.update(dt, beamRight);

  // 7) 곤충 웨이브. 퇴비(compost) 단계부터 스폰 활성화.
  //    연습 모드에서는 곤충을 등장시키지 않는다(감자 심기·키우기 훈련만).
  bugs.setEnabled(garden.threatsActive && appState !== "practice");
  bugs.update(dt);

  // 8) 수확 입자 연출 + 게임 HUD(목표·타이머·WAVE·에너지·성장 링·조작·결과).
  harvestFx.update(dt);
  gameHud.update(garden, bugs.count, energy);

  // 9) 이벤트 이팩트(각각 한 번씩): 씨앗 발사 · 퇴비 공급 · 곤충 첫 등장 · 30초/10초 기점 · 첫 완전 성장.
  //    이미지는 play({..., image: "/파일.png"})로 넣으면 이팩트 중앙에 크게 박힌다.
  if (!fxSeed && garden.phase === "seed") {
    fxSeed = true;
    eventFx.play({ tone: "life", title: "감자를 발사하라!", sub: "오른손 트리거로 씨앗을 심어라" });
    sound.event("life");
  }
  if (!fxCompost && garden.phase === "compost") {
    fxCompost = true;
    eventFx.play({ tone: "warn", title: "퇴비를 뿌려라!", sub: "감자밭에 영양을 공급한다" });
    sound.event("warn");
  }
  if (!fxFirstBug && garden.threatsActive && bugs.count > 0) {
    fxFirstBug = true;
    eventFx.play({ tone: "danger", title: "외계 곤충 출현!", sub: "왼손 붉은 에너지로 격퇴하라!" });
    sound.event("danger");
  }
  if (garden.phase === "energy") {
    if (!fx30 && garden.timeLeft <= 30) {
      fx30 = true;
      eventFx.play({ tone: "warn", title: "절반 지점!", sub: "30초 남았다 — 감자를 지켜라" });
      sound.event("warn");
    }
    if (!fx10 && garden.timeLeft <= 10) {
      fx10 = true;
      eventFx.play({ tone: "danger", title: "마지막 10초!", sub: "끝까지 버텨라!" });
      sound.event("danger");
    }
    if (!fxGrown && garden.potatoes.some((p) => p.grown)) {
      fxGrown = true;
      eventFx.play({ tone: "life", title: "감자 완전 성장!", sub: "화성에 생명이 뿌리내렸다" });
      sound.event("life");
    }
  }
  }

  // 화성 환경 애니메이션(먼지·모래 폭포·위성·스파크) — 배경으로 항상 갱신
  mars.update(dt);

  // 메타존: 플레이·연습 중에만 4면 서라운드로 그린다.
  // 인트로·플레이 방법 안내에서는 양옆(사실상 전체)이 검정 + 가운데 UI만.
  mars.surround = appState === "playing" || appState === "practice";

  // 렌더
  mars.render();

  requestAnimationFrame(loop);
}

// PIP 모드로 시작(3단계 이후 상태). 필요 시 data-mode="full"로 전체화면 전환 가능.
pip.dataset.mode = "pip";

// 개발 편의용 디버그 훅(프로덕션 번들에는 포함되지 않음).
if (import.meta.env.DEV) {
  (window as unknown as { __mars: unknown }).__mars = { mars, tracker, jets, beamRight, beamLeft, bugs, garden, gameHud, harvestFx, eventFx, screens, sound, resultPointer, resultButtons, THREE };
}

// 렌더 루프는 즉시 시작(인트로 화면 뒤로 화성 씬이 바로 보인다).
// 웹캠·손추적은 "게임 시작"을 눌러 startGame()에서 로드한다.
requestAnimationFrame(loop);
