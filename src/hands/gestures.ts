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
const TH = {
  THUMB_UP: 0.55, // 엄지가 세워진 상태
  GRIP_CURLED: 0.6, // 약지·새끼가 말려 있는 상태(그립)
  BARREL_ARM: 0.75, // 검지+중지 평균이 이 이상이면 '총구를 겨눔(장전)'으로 인식
  TRIGGER_DROP: 0.1, // 겨눈 기준 대비 10%만 굽혀도 발사(조금만 굽히자마자)
  TRIGGER_RELEASE: 0.05, // 5%까지 다시 펴지면 발사 해제(히스테리시스)
  BASELINE_DECAY: 0.95, // 겨눔 기준을 천천히 추종(발사 중엔 동결)
};

/**
 * '두 손가락 총' 제스처 판정(손별 상태 유지).
 * 총구 = 검지+중지(둘을 함께 봐 신호가 강함), 그립 = 엄지 세움 + 약지·새끼 말아쥠.
 *
 * 발사는 고정 임계값이 아니라 **겨눴을 때의 펴짐 기준 대비 상대적 굽힘**으로 판정한다.
 * → 손 크기·거리·각도와 무관하게 "조금만 굽혀도" 즉시, 일관되게 발사된다.
 */
export class GunGesture {
  private armed = false; // 검지+중지를 충분히 펴서 겨눈 적이 있는가
  private firing = false; // 트리거 히스테리시스 상태
  private baseline = 1; // 겨눴을 때의 검지+중지 평균 펴짐(발사 판정 기준)

  update(lm: Landmark[]): HandState {
    const thumb = fingerExtension(lm, LM.THUMB_TIP, LM.THUMB_MCP);
    const index = fingerExtension(lm, LM.INDEX_TIP, LM.INDEX_MCP);
    const middle = fingerExtension(lm, LM.MIDDLE_TIP, LM.MIDDLE_MCP);
    const ring = fingerExtension(lm, LM.RING_TIP, LM.RING_MCP);
    const pinky = fingerExtension(lm, LM.PINKY_TIP, LM.PINKY_MCP);

    // 총 자세의 골격: 엄지 세움 + 약지·새끼 말아쥠. (검지·중지는 총구=트리거)
    const gunHand =
      thumb > TH.THUMB_UP && ring < TH.GRIP_CURLED && pinky < TH.GRIP_CURLED;
    if (!gunHand) {
      this.reset();
      return "IDLE";
    }

    const barrel = (index + middle) / 2; // 검지+중지 평균 펴짐

    // 장전: 검지+중지를 충분히 펴서 겨눠야 총구로 인식(주먹 등 오탐 방지).
    if (!this.armed) {
      if (barrel >= TH.BARREL_ARM) {
        this.armed = true;
        this.baseline = barrel;
      } else {
        return "IDLE";
      }
    }

    // 발사 중이 아닐 때만 '펴짐 기준'을 추종(발사 중 동결 → 계속 굽히고 있으면 지속 발사).
    if (!this.firing) {
      this.baseline = Math.max(
        barrel,
        this.baseline * TH.BASELINE_DECAY + barrel * (1 - TH.BASELINE_DECAY),
      );
    }

    // 상대적 굽힘으로 발사/해제(히스테리시스).
    if (!this.firing && barrel <= this.baseline * (1 - TH.TRIGGER_DROP)) {
      this.firing = true;
    } else if (this.firing && barrel >= this.baseline * (1 - TH.TRIGGER_RELEASE)) {
      this.firing = false;
    }

    return this.firing ? "FIRE" : "GUN_POSE";
  }

  /** 손이 사라지거나 총 자세를 벗어나면 초기화. */
  reset(): void {
    this.armed = false;
    this.firing = false;
    this.baseline = 1;
  }
}

// 몇 프레임 연속 같은 후보가 유지될 때만 실제 상태 전환(오탐 방지).
// FIRE 진입은 빠르게(onFrames), FIRE 이탈은 천천히(offFrames) → 즉각 발사 + 빔 안 끊김.
export class GestureFilter {
  private current: HandState = "IDLE";
  private candidate: HandState = "IDLE";
  private count = 0;
  constructor(
    private readonly onFrames = 2,
    private readonly offFrames = 4,
  ) {}

  update(instant: HandState): HandState {
    if (instant === this.candidate) {
      this.count++;
    } else {
      this.candidate = instant;
      this.count = 1;
    }
    // 발사로 들어갈 땐 빠르게, 발사에서 빠져나올 땐 느리게(빔 깜빡임 방지).
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
