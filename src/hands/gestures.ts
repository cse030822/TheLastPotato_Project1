import { LM, type Landmark } from "./handConstants";

// 손의 세 가지 상태
export type HandState = "IDLE" | "GUN_POSE" | "FIRE";

// 어느 손인지(화면상 위치 기준으로 확정 → 거울 모드에서도 안정적)
export type HandSide = "left" | "right";

export interface HandReading {
  side: HandSide;
  state: HandState;
  // 화면(거울 반영) 기준 좌표 0~1. 노즐 조준에 사용.
  screenX: number;
  screenY: number;
  landmarks: Landmark[];
}

function dist(a: Landmark, b: Landmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// 손 전체 크기(손목 ~ 중지 뿌리). 손을 기울여도 안정적인 기준 스케일.
function handScale(lm: Landmark[]): number {
  return Math.max(1e-4, dist(lm[LM.WRIST], lm[LM.MIDDLE_MCP]));
}

// 손가락 끝-뿌리 거리 / 손 크기 비율. 펴짐(큼) vs 접힘(작음) 판별.
function fingerExtension(lm: Landmark[], tip: number, mcp: number): number {
  return dist(lm[tip], lm[mcp]) / handScale(lm);
}

// 임계값(비율). 실측하며 튜닝하기 쉽게 상수로 분리.
// 빔이 더 잘 나가도록 발사·총자세 인식을 전반적으로 완화했다(값이 클수록 관대).
const TH = {
  INDEX_STRAIGHT: 0.82, // 이 이상이면 검지가 곧게 펴진 상태(조준)
  INDEX_BENT: 0.75, // 이 이하이면 발사. 0.68→0.75로 올려 검지를 조금만 당겨도 즉시 발사.
  THUMB_UP: 0.48, // 엄지가 세워진 상태. 0.55→0.48로 완화(엄지가 완전히 안 서도 총 자세 인정).
  FINGER_CURLED: 0.66, // 중지/약지/새끼가 말린 상태. 0.6→0.66로 완화 → 손가락이 느슨해도 총 자세가 유지돼 발사 중 끊기지 않음.
};

// 순간(프레임 단위) 후보 상태를 계산. 완충(디바운스)은 GestureFilter가 담당.
function classifyInstant(lm: Landmark[]): HandState {
  const index = fingerExtension(lm, LM.INDEX_TIP, LM.INDEX_MCP);
  const thumb = fingerExtension(lm, LM.THUMB_TIP, LM.THUMB_MCP);
  const middle = fingerExtension(lm, LM.MIDDLE_TIP, LM.MIDDLE_MCP);
  const ring = fingerExtension(lm, LM.RING_TIP, LM.RING_MCP);
  const pinky = fingerExtension(lm, LM.PINKY_TIP, LM.PINKY_MCP);

  const othersCurled =
    middle < TH.FINGER_CURLED &&
    ring < TH.FINGER_CURLED &&
    pinky < TH.FINGER_CURLED;
  const thumbUp = thumb > TH.THUMB_UP;

  // 총 쏘는 자세의 기본 골격: 엄지 세움 + 나머지 세 손가락 말아 쥠
  const gunFrame = thumbUp && othersCurled;
  if (!gunFrame) return "IDLE";

  if (index >= TH.INDEX_STRAIGHT) return "GUN_POSE"; // 검지 곧게 → 조준
  if (index <= TH.INDEX_BENT) return "FIRE"; // 검지 당김 → 발사
  return "GUN_POSE"; // 히스테리시스 중간 구간은 조준 유지
}

// 몇 프레임 연속 같은 후보가 유지될 때만 실제 상태 전환(오탐 방지).
// 발사 진입은 빠르게(onFrames), 발사 이탈은 느리게(offFrames) → 즉각 발사 + 빔이 잘 안 끊김.
export class GestureFilter {
  private current: HandState = "IDLE";
  private candidate: HandState = "IDLE";
  private count = 0;
  constructor(
    private readonly onFrames = 2, // FIRE로 들어갈 때 필요한 연속 프레임(작을수록 즉각 발사)
    private readonly offFrames = 4, // FIRE에서 빠져나올 때 필요한 연속 프레임(클수록 빔 안 끊김)
  ) {}

  update(instant: HandState): HandState {
    if (instant === this.candidate) {
      this.count++;
    } else {
      this.candidate = instant;
      this.count = 1;
    }
    // FIRE 진입은 빠르게, FIRE 이탈은 느리게(빔 깜빡임·순간 끊김 방지).
    const need =
      this.candidate === "FIRE"
        ? this.onFrames
        : this.current === "FIRE"
          ? this.offFrames
          : this.onFrames;
    if (this.count >= need && this.candidate !== this.current) {
      this.current = this.candidate;
    }
    return this.current;
  }

  get state(): HandState {
    return this.current;
  }
}

export { classifyInstant };
