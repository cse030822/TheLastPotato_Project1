// One Euro Filter — 손 추적에 널리 쓰이는 적응형 스무딩.
// 느린 움직임에선 강하게 떨림을 제거하고, 빠른 움직임에선 지연을 줄인다.
// 참고: Casiez et al., "1€ Filter" (CHI 2012).

class LowPass {
  private s: number | null = null;

  filter(x: number, alpha: number): number {
    this.s = this.s === null ? x : alpha * x + (1 - alpha) * this.s;
    return this.s;
  }

  get hasLast(): boolean {
    return this.s !== null;
  }
  get last(): number {
    return this.s ?? 0;
  }
  reset(): void {
    this.s = null;
  }
}

export class OneEuroFilter {
  private xf = new LowPass();
  private dxf = new LowPass();
  private lastTime: number | null = null;

  constructor(
    private minCutoff = 1.5, // 낮을수록 더 매끄럽지만(지터↓) 지연↑
    private beta = 0.03, // 높을수록 빠른 동작에서 지연↓
    private dCutoff = 1.0,
  ) {}

  private alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  /** @param t 초 단위 타임스탬프 */
  filter(x: number, t: number): number {
    if (this.lastTime === null) {
      this.lastTime = t;
      return this.xf.filter(x, 1);
    }
    let dt = t - this.lastTime;
    this.lastTime = t;
    if (dt <= 0) dt = 1 / 60; // 안전값

    const dx = this.xf.hasLast ? (x - this.xf.last) / dt : 0;
    const edx = this.dxf.filter(dx, this.alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xf.filter(x, this.alpha(cutoff, dt));
  }

  reset(): void {
    this.xf.reset();
    this.dxf.reset();
    this.lastTime = null;
  }
}

/**
 * 한 손의 21개 관절 × (x,y,z)를 각각 One Euro로 스무딩.
 * 손이 사라졌다 다시 잡히면 reset()으로 튐을 방지한다.
 */
export class HandSmoother {
  private filters: OneEuroFilter[] = [];
  private seen = false;

  constructor(minCutoff = 1.5, beta = 0.03) {
    for (let i = 0; i < 21 * 3; i++) {
      this.filters.push(new OneEuroFilter(minCutoff, beta));
    }
  }

  smooth(
    landmarks: { x: number; y: number; z: number }[],
    tSec: number,
  ): { x: number; y: number; z: number }[] {
    this.seen = true;
    return landmarks.map((p, i) => ({
      x: this.filters[i * 3].filter(p.x, tSec),
      y: this.filters[i * 3 + 1].filter(p.y, tSec),
      z: this.filters[i * 3 + 2].filter(p.z, tSec),
    }));
  }

  markAbsent(): void {
    if (!this.seen) return;
    this.seen = false;
    for (const f of this.filters) f.reset();
  }
}
