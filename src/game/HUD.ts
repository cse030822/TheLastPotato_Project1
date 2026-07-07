import type { HandReading, HandState } from "../hands/gestures";

const LABEL: Record<HandState, string> = {
  IDLE: "대기",
  GUN_POSE: "조준(GUN POSE)",
  FIRE: "발사(FIRE)",
};

/**
 * 상단 좌/우 손 상태 텍스트 HUD.
 * (타이머·성장 게이지 등 나머지 HUD는 7단계에서 통합)
 */
export class HUD {
  private leftEl = document.getElementById("hand-left")!;
  private rightEl = document.getElementById("hand-right")!;

  update(left: HandReading | null, right: HandReading | null): void {
    this.set(this.leftEl, "왼손", left);
    this.set(this.rightEl, "오른손", right);
  }

  private set(el: HTMLElement, name: string, hand: HandReading | null): void {
    if (!hand) {
      el.textContent = `${name}: 미인식`;
      el.dataset.state = "NONE";
      return;
    }
    el.textContent = `${name}: ${LABEL[hand.state]}`;
    el.dataset.state = hand.state;
  }
}
