import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { type Landmark } from "./handConstants";
import {
  GestureFilter,
  GunGesture,
  type HandReading,
  type HandSide,
} from "./gestures";
import { HandSmoother } from "./OneEuroFilter";

// tasks-vision의 wasm 런타임과 손 모델(.task)을 CDN에서 로드.
const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export interface FrameResult {
  hands: HandReading[];
  left: HandReading | null;
  right: HandReading | null;
}

/**
 * 웹캠 스트림을 받아 MediaPipe HandLandmarker로 양손을 추적하고,
 * 화면(거울) 기준 좌/우 손을 확정한 뒤 제스처 상태까지 계산한다.
 */
export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private lastVideoTime = -1;
  private readonly filters: Record<HandSide, GestureFilter> = {
    left: new GestureFilter(),
    right: new GestureFilter(),
  };
  // 좌/우 손 각각의 '두 손가락 총' 제스처 판정(적응형 트리거 상태 유지).
  private readonly gestures: Record<HandSide, GunGesture> = {
    left: new GunGesture(),
    right: new GunGesture(),
  };
  // 좌/우 손 각각의 관절 좌표 스무딩(One Euro).
  private readonly smoothers: Record<HandSide, HandSmoother> = {
    left: new HandSmoother(),
    right: new HandSmoother(),
  };
  // 웹캠 프레임이 갱신되지 않은 렌더 프레임에서 재사용할 마지막 결과(깜빡임 방지).
  private lastResult: FrameResult = { hands: [], left: null, right: null };

  // 현재 사용 중인 카메라 deviceId(전환 여부 판단용).
  private currentDeviceId: string | null = null;

  constructor(private readonly video: HTMLVideoElement) {}

  /** 현재 연결된 카메라의 deviceId(없으면 null). */
  get deviceId(): string | null {
    return this.currentDeviceId;
  }

  /**
   * 웹캠 권한 요청 + 비디오 스트림 연결.
   * deviceId를 주면 그 카메라(외장 웹캠 등)로, 없으면 기본 전면 카메라로 연결한다.
   * 카메라 전환 시 이전 스트림의 트랙은 정리한다.
   */
  async startWebcam(deviceId?: string): Promise<void> {
    const old = this.video.srcObject as MediaStream | null;
    if (old) old.getTracks().forEach((t) => t.stop());

    const video: MediaTrackConstraints = deviceId
      ? { width: 1280, height: 720, deviceId: { exact: deviceId } }
      : { width: 1280, height: 720, facingMode: "user" };
    const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    this.video.srcObject = stream;
    // 실제로 열린 트랙의 deviceId를 기록(제약이 근사 매칭될 수 있으므로 설정값 우선).
    this.currentDeviceId =
      stream.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId ?? null;
    await this.video.play();
    await new Promise<void>((resolve) => {
      if (this.video.readyState >= 2) return resolve();
      this.video.onloadeddata = () => resolve();
    });
  }

  /** 사용 가능한 카메라(비디오 입력) 목록. 라벨·deviceId는 권한 허용 후에만 채워진다. */
  async listCameras(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "videoinput");
  }

  /** 카메라 라벨을 얻기 위해 임시로 권한만 확보한다(스트림은 즉시 정리). */
  async ensureCameraPermission(): Promise<void> {
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    tmp.getTracks().forEach((t) => t.stop());
  }

  /** MediaPipe 모델 로드 */
  async loadModel(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    this.landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2,
      // 한 번 잡은 손을 잘 놓치지 않도록 추적/존재 임계값은 낮게,
      // 오검출은 막도록 첫 감지 임계값은 적당히.
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
    });
  }

  /** 매 프레임 호출: 손 감지 → 좌/우 확정 → 스무딩 → 제스처 상태 계산 */
  detect(nowMs: number): FrameResult {
    if (!this.landmarker || this.video.readyState < 2) return this.lastResult;
    // 웹캠이 새 프레임을 내놓지 않았으면(렌더가 더 빠른 경우) 마지막 결과를 재사용.
    // 매 프레임 empty를 돌려주던 예전 방식은 뼈대·HUD 깜빡임의 원인이었다.
    if (this.video.currentTime === this.lastVideoTime) {
      return this.lastResult;
    }
    this.lastVideoTime = this.video.currentTime;
    const tSec = nowMs / 1000;

    const result: HandLandmarkerResult = this.landmarker.detectForVideo(
      this.video,
      nowMs,
    );

    // 좌/우는 화면 위치가 아니라 MediaPipe의 **해부학적 handedness**로 판별한다.
    // → 오른손을 화면 왼쪽으로 가져가거나 각도를 틀어도 오른손으로 인식된다(위치 무관).
    // 웹캠 원본(비반전)을 모델에 넣고 화면만 거울로 뒤집으므로, 라벨은 스왑한다
    // (MediaPipe handedness는 입력이 거울이라고 가정 → 비반전이면 Left↔Right 교체).
    const raw: { side: HandSide; lm: Landmark[]; score: number }[] = [];
    for (let i = 0; i < result.landmarks.length; i++) {
      const lm = result.landmarks[i] as Landmark[];
      const cat = result.handednesses?.[i]?.[0];
      const side: HandSide = cat
        ? cat.categoryName === "Left"
          ? "left"
          : "right"
        : 1 - lm[9].x >= 0.5
          ? "right"
          : "left"; // handedness가 없을 때만 위치로 폴백
      raw.push({ side, lm, score: cat?.score ?? 0.5 });
    }

    // 같은 쪽으로 분류된 후보가 둘이면(드문 오분류) 신뢰도 높은 쪽을 채택.
    const chosen: Partial<Record<HandSide, Landmark[]>> = {};
    for (const side of ["left", "right"] as HandSide[]) {
      const cands = raw.filter((r) => r.side === side);
      if (cands.length === 0) continue;
      chosen[side] = cands.reduce((a, b) => (b.score > a.score ? b : a)).lm;
    }

    const build = (side: HandSide): HandReading | null => {
      const rawLm = chosen[side];
      if (!rawLm) {
        this.smoothers[side].markAbsent();
        this.gestures[side].reset(); // 손 사라짐 → 트리거 기준 초기화
        this.filters[side].update("IDLE"); // 손 사라짐 → 노즐 복귀
        return null;
      }
      const lm = this.smoothers[side].smooth(rawLm, tSec); // 지터 제거
      const screenX = 1 - lm[9].x;
      const screenY = lm[9].y;
      const state = this.filters[side].update(this.gestures[side].update(lm));
      return { side, state, screenX, screenY, landmarks: lm };
    };

    const left = build("left");
    const right = build("right");
    const hands = [left, right].filter((h): h is HandReading => h !== null);

    this.lastResult = { hands, left, right };
    return this.lastResult;
  }
}
