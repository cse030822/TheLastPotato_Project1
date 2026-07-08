/**
 * 손 조준점(화면 픽셀 좌표)을 커서로 삼아 DOM 버튼을 '가리켜서' 누르는 선택기.
 * 마우스가 없는 손 트래킹 UI의 표준 방식 — 버튼 위에 일정 시간(dwell) 머무르면
 * 자동으로 click()을 발생시킨다(마우스 클릭 핸들러와 동일 경로 재사용).
 * 진행 상태는 각 버튼의 CSS 변수 --dwell(0~1)로 노출해 채움 애니메이션을 그린다.
 */
export class PointerSelect {
  private hovered: HTMLElement | null = null;
  private dwell = 0;

  constructor(private readonly dwellSec = 1.1) {}

  /** 호버 표식·진행값 초기화(선택 UI가 사라지거나 손이 없을 때). */
  reset(): void {
    this.clear(this.hovered);
    this.hovered = null;
    this.dwell = 0;
  }

  private clear(el: HTMLElement | null): void {
    if (!el) return;
    el.style.setProperty("--dwell", "0");
    delete el.dataset.hover;
  }

  /**
   * @param active   선택 UI가 보이는가(결과 오버레이 표시 중)
   * @param present  손 커서가 화면에 있는가
   * @param px,py    커서 화면 픽셀 좌표
   * @param buttons  대상 버튼들(가장 앞에서 히트되는 하나만 활성)
   * @param dt       프레임 시간(초)
   */
  update(
    active: boolean,
    present: boolean,
    px: number,
    py: number,
    buttons: HTMLElement[],
    dt: number,
  ): void {
    if (!active || !present) {
      this.reset();
      return;
    }
    const hit =
      buttons.find((b) => {
        const r = b.getBoundingClientRect();
        return px >= r.left && px <= r.right && py >= r.top && py <= r.bottom;
      }) ?? null;

    // 다른 버튼(또는 허공)으로 옮겨가면 진행을 리셋하고 새 대상으로 전환.
    if (hit !== this.hovered) {
      this.clear(this.hovered);
      this.hovered = hit;
      this.dwell = 0;
      if (hit) hit.dataset.hover = "1";
    }
    if (!hit) return;

    // 머무는 동안 진행값 축적 → 100%면 클릭 발생(마우스와 동일 핸들러).
    this.dwell += dt;
    const t = Math.min(1, this.dwell / this.dwellSec);
    hit.style.setProperty("--dwell", t.toFixed(3));
    if (t >= 1) {
      const target = hit;
      this.reset();
      target.click();
    }
  }
}
