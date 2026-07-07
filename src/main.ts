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

// 감자는 플레이어가 씨앗을 쏴서 직접 배치한다(고정 위치 없음).
const garden = new Garden(
  mars.scene,
  () => emitOrigin.clone(),
  () => console.warn("[화성 정원사] 승리: 감자를 모두 키워냈습니다!"),
  () => console.warn("[화성 정원사] 실패: 감자가 모두 파괴되었습니다."),
);

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
const hintEl = document.getElementById("hud-hint") as HTMLElement;

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
  _dir.copy(_target).sub(origin).normalize();
  beam.set(true, origin, _dir);
  bugs.hitBeam(origin, _dir, 45, 9 * dt);
}

// 제스처(FIRE)가 잘 안 될 때 대비: [Space]로 씨앗 심기.
// 오른손 조준 위치가 있으면 그곳, 없으면 앞쪽에 순서대로 벌려 심는다.
const _kbPlant = new THREE.Vector3();
window.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || garden.phase !== "seed") return;
  e.preventDefault();
  if (aimRight.present && aimGround(aimRight, _kbPlant)) {
    garden.plantAt(_kbPlant);
  } else {
    const n = garden.placedCount;
    garden.plantAt(new THREE.Vector3((n - 1) * 1.6, 0, -3));
  }
});

// [D] 키: 손 뼈대 오버레이 토글
window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "d") overlay.toggle();
});

// PIP 창은 웹캠 로드 후 크기가 확정되므로 오버레이 캔버스도 그때 맞춘다.
window.addEventListener("resize", () => overlay.resize());

async function boot(): Promise<void> {
  try {
    await tracker.startWebcam(); // 웹캠 권한 요청 + 스트림
    await tracker.loadModel(); // MediaPipe HandLandmarker 로드
    overlay.resize();
    console.log("[화성 정원사] 웹캠 + 손 추적 준비 완료. 손을 화면에 비춰보세요.");
  } catch (err) {
    console.error("[화성 정원사] 초기화 실패:", err);
  }
  requestAnimationFrame(loop);
}

let prev = performance.now();
let lastLog = 0;

function loop(now: number): void {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;

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

  // 하단 힌트: 현재 단계 안내(+ 곤충 수)
  hintEl.textContent =
    garden.phase === "seed"
      ? `감자 심기: 오른손 총 자세로 원하는 곳 조준 → 검지 당겨 발사(또는 [Space]) · (${garden.placedCount}/${garden.maxPotatoes})`
      : garden.phase === "compost"
        ? `퇴비 주는 중… · 곤충 ${bugs.count}`
        : garden.phase === "energy"
          ? `오른손 에너지로 감자 성장 · 왼손으로 곤충 격퇴 · 곤충 ${bugs.count}`
          : garden.phase === "won"
            ? "성공! 감자를 지켜냈습니다"
            : "실패…";

  // 6) 감자밭 진행(씨앗→퇴비→에너지, 오른손 빔으로 에너지 공급 시 성장·발광).
  garden.update(dt, beamRight);

  // 7) 곤충 웨이브. 퇴비(compost) 단계부터 스폰 활성화.
  bugs.setEnabled(garden.threatsActive);
  bugs.update(dt);

  // 7) 화성 환경 애니메이션(먼지·모래 폭포·위성·스파크)
  mars.update(dt);

  // 7) 렌더
  mars.render();

  requestAnimationFrame(loop);
}

// PIP 모드로 시작(3단계 이후 상태). 필요 시 data-mode="full"로 전체화면 전환 가능.
pip.dataset.mode = "pip";

// 개발 편의용 디버그 훅(프로덕션 번들에는 포함되지 않음).
if (import.meta.env.DEV) {
  (window as unknown as { __mars: unknown }).__mars = { mars, tracker, jets, beamRight, beamLeft, bugs, garden, THREE };
}

boot();
