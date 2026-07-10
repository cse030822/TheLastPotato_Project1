/**
 * 메타존(4면 몰입형 디스플레이) 뷰 레이아웃.
 *
 * 실제 설치 환경은 좌측·정면·우측·바닥 네 개의 패널이 가로로 하나의 긴
 * 디스플레이로 이어져 있다(전체 6806×1200). 이 모듈은 창 크기를 그 비율대로
 * 네 영역으로 나누고, 모든 UI/투영이 기준으로 삼을 "정면 영역" 사각형을 계산한다.
 *
 * meta=false면 기존처럼 창 전체가 정면 한 화면이다(정면 영역 = 창 전체).
 * 따라서 일반 플레이는 이 모듈이 있어도 동작이 전혀 바뀌지 않는다.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type RegionName = "left" | "front" | "right" | "floor";

/** 메타존 각 면의 픽셀 폭(세로는 공통 1200). 좌 → 정면 → 우 → 바닥 순. */
export const META_WIDTHS: Record<RegionName, number> = {
  left: 1666,
  front: 2020,
  right: 1666,
  floor: 1454,
};
const META_ORDER: RegionName[] = ["left", "front", "right", "floor"];
const META_TOTAL = META_ORDER.reduce((s, n) => s + META_WIDTHS[n], 0); // 6806
const META_HEIGHT = 1200;
/** 메타존 화면을 가로로만 늘리는 배율(1.0 = 원본, 1.15 = 15% 확대). */
const META_H_STRETCH = 1.15;
/** 메타존 전체 화면 비율(가로÷세로 ≈ 5.67 — 아주 가로로 긴 띠). */
const META_ASPECT = (META_TOTAL / META_HEIGHT) * META_H_STRETCH;

/**
 * 플레이 UI를 그리는 '설계 해상도'. 정면 패널의 실제 픽셀(2020×1200)을 그대로 쓴다.
 * UI는 항상 이 좌표계로 배치하고, 메타존에서는 정면 패널 실제 크기에 맞춰 통째로
 * 축소(scale)한다 → "원래 전체화면 UI가 그대로 작아진" 배치가 된다.
 */
const DESIGN_W = META_WIDTHS.front; // 2020
const DESIGN_H = META_HEIGHT; // 1200

class ViewLayout {
  /** 메타존(4면) 모드 여부. false면 정면 한 화면. */
  meta = false;

  /**
   * 각 면의 화면 사각형(WebGL 뷰포트 기준: 좌하단 원점, x는 오른쪽으로 증가).
   * y는 항상 0, h는 전체 창 높이. meta=false에서는 사용하지 않는다.
   */
  regions: Record<RegionName, Rect> = {
    left: { x: 0, y: 0, w: 0, h: 0 },
    front: { x: 0, y: 0, w: 0, h: 0 },
    right: { x: 0, y: 0, w: 0, h: 0 },
    floor: { x: 0, y: 0, w: 0, h: 0 },
  };

  /** UI·월드→화면 투영이 기준으로 삼는 정면 영역(meta=false면 창 전체). */
  front: Rect = { x: 0, y: 0, w: 0, h: 0 };

  /**
   * 메타존 전체 띠(6806:1200 비율)를 창 안에 레터박스로 맞춘 사각형.
   * 이 띠 바깥(위·아래 또는 좌·우 여백)은 검게 비운다. meta=false면 창 전체.
   */
  stage: Rect = { x: 0, y: 0, w: 0, h: 0 };

  /** 창 크기·모드로부터 영역들을 다시 계산하고 CSS 변수에 반영한다. */
  recompute(): void {
    const W = window.innerWidth;
    const H = window.innerHeight;

    if (!this.meta) {
      this.front = { x: 0, y: 0, w: W, h: H };
      this.stage = { x: 0, y: 0, w: W, h: H };
      this.applyCssVars();
      return;
    }

    // 6806:1200 비율의 띠를 창 안에 최대한 크게 넣는다(레터박스).
    //  - 창이 띠보다 가로로 더 길면 높이에 맞추고, 아니면(보통 16:9) 폭에 맞춘다.
    let sw: number;
    let sh: number;
    if (W / H > META_ASPECT) {
      sh = H;
      sw = H * META_ASPECT;
    } else {
      sw = W;
      sh = W / META_ASPECT;
    }
    const offX = (W - sw) / 2; // 좌우 여백(창이 더 넓을 때)
    const offY = (H - sh) / 2; // 위아래 여백(보통 이쪽)
    this.stage = { x: offX, y: offY, w: sw, h: sh };

    // 띠 안을 좌 → 정면 → 우 → 바닥 순으로 가로 분할.
    // regions는 WebGL 뷰포트용(좌하단 원점) — y는 아래쪽 여백(=offY, 상하 대칭).
    let x = offX;
    for (const name of META_ORDER) {
      const w = (META_WIDTHS[name] / META_TOTAL) * sw;
      this.regions[name] = { x, y: offY, w, h: sh };
      x += w;
    }
    // front은 UI 배치용(좌상단 원점 CSS 좌표): 위쪽 여백도 offY로 대칭.
    const fr = this.regions.front;
    this.front = { x: fr.x, y: offY, w: fr.w, h: sh };
    this.applyCssVars();
  }

  /** 각 면 종횡비(카메라 aspect용). */
  aspect(name: RegionName): number {
    const r = this.regions[name];
    return r.h > 0 ? r.w / r.h : 1;
  }

  /** UI(월드→화면 투영 포함)를 배치하는 좌표계 너비. 메타존이면 설계 해상도. */
  get uiWidth(): number {
    return this.meta ? DESIGN_W : window.innerWidth;
  }

  /** UI를 배치하는 좌표계 높이. 메타존이면 설계 해상도. */
  get uiHeight(): number {
    return this.meta ? DESIGN_H : window.innerHeight;
  }

  /**
   * 정면 영역의 위치·폭을 CSS 변수로 노출한다.
   * body.meta 규칙이 이 값으로 HUD·크로스헤어 등 오버레이를 정면(가운데)으로 모은다.
   */
  private applyCssVars(): void {
    const s = document.documentElement.style;
    const f = this.front;
    s.setProperty("--front-x", `${f.x}px`);
    s.setProperty("--front-y", `${f.y}px`);
    s.setProperty("--front-w", `${f.w}px`);
    s.setProperty("--front-h", `${f.h}px`);
    // 창 오른쪽/아래 끝에서 정면 영역 끝까지의 거리(우·하단 고정 요소용: PIP·바 등).
    s.setProperty("--front-right", `${window.innerWidth - (f.x + f.w)}px`);
    s.setProperty("--front-bottom", `${window.innerHeight - (f.y + f.h)}px`);
    // 플레이 UI 설계 해상도 + 정면 패널에 맞춘 축소 배율.
    s.setProperty("--design-w", `${DESIGN_W}px`);
    s.setProperty("--design-h", `${DESIGN_H}px`);
    s.setProperty("--front-scale", `${this.meta ? f.w / DESIGN_W : 1}`);
  }
}

/** 전역 뷰 레이아웃(렌더러·HUD·입력이 공유). */
export const layout = new ViewLayout();
