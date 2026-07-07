import type { HandState } from "../hands/gestures";

/** 보간된 조준점 정보(화면 0~1 좌표 + 상태). */
export interface AimPoint {
  present: boolean;
  x: number;
  y: number;
  state: HandState;
}

/**
 * 손 조준점(크로스헤어) — 총기 모델 없이 손이 겨누는 화면 위치에 표시.
 *  - 오른손: 시안 원형 / 왼손: 붉은주황 십자
 *  - 위치는 main에서 프레임 간 보간(smooth)한 좌표를 받아 부드럽게 이동
 *  - 상태(IDLE/GUN_POSE/FIRE)에 따라 CSS로 흐림/회전/발사 연출
 *  - 손이 인식되지 않으면 즉시 숨김
 */
export class Crosshair {
  private readonly rightEl = document.getElementById("ch-right") as HTMLDivElement;
  private readonly leftEl = document.getElementById("ch-left") as HTMLDivElement;

  update(left: AimPoint, right: AimPoint): void {
    this.place(this.leftEl, left);
    this.place(this.rightEl, right);
  }

  private place(el: HTMLDivElement, a: AimPoint): void {
    if (!a.present) {
      el.style.display = "none";
      return;
    }
    el.style.display = "block";
    el.style.left = `${(a.x * 100).toFixed(2)}%`;
    el.style.top = `${(a.y * 100).toFixed(2)}%`;
    el.dataset.state = a.state;
  }
}
