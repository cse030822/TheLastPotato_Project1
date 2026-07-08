/**
 * 게임 중 "이벤트 이팩트" — 안내창(박스)이 아니라 화면에 쾅 나타나 번쩍이고
 * 사라지는 연출. 곤충 출현·시간 기점·완전 성장 같은 순간에 게임을 멈추지 않고 띄운다.
 *  - tone: danger(붉음)·warn(호박빛)·life(생명빛 초록)로 색이 갈린다.
 *  - image: 있으면 이팩트 안에 크게 박힌다(플레이어가 준 이미지 슬롯).
 * 애니메이션은 전부 CSS(#event-fx.show)가 담당하고, 여기선 내용 세팅 + 재생만 한다.
 */
export type EfxTone = "danger" | "warn" | "life";

export interface EfxOptions {
  tone: EfxTone;
  title: string;
  sub?: string;
  /** 이팩트 중앙에 크게 표시할 이미지 경로(public 기준, 예: "/bug-alert.png"). */
  image?: string;
}

export class EventFx {
  private root = document.getElementById("event-fx") as HTMLDivElement;
  private efx: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private subEl: HTMLDivElement;
  private imgEl: HTMLImageElement;
  private hideTimer = 0;
  private readonly durationMs = 2400; // CSS efx-pop 총 길이와 맞춘다

  constructor() {
    this.root.innerHTML = `
      <div class="efx-flash"></div>
      <div class="efx" data-tone="danger">
        <div class="efx-streak"></div>
        <img class="efx-img" alt="" />
        <div class="efx-title"></div>
        <div class="efx-sub"></div>
      </div>`;
    this.efx = this.root.querySelector(".efx") as HTMLDivElement;
    this.titleEl = this.root.querySelector(".efx-title") as HTMLDivElement;
    this.subEl = this.root.querySelector(".efx-sub") as HTMLDivElement;
    this.imgEl = this.root.querySelector(".efx-img") as HTMLImageElement;
  }

  /** 이팩트 재생(같은 게 재생 중이면 새 내용으로 즉시 다시 튄다). */
  play(o: EfxOptions): void {
    this.efx.dataset.tone = o.tone;
    this.titleEl.textContent = o.title;
    this.subEl.textContent = o.sub ?? "";
    this.subEl.style.display = o.sub ? "block" : "none";
    if (o.image) {
      this.imgEl.src = o.image;
      this.imgEl.classList.add("has");
    } else {
      this.imgEl.classList.remove("has");
      this.imgEl.removeAttribute("src");
    }

    // 애니메이션 재시작: show 제거 → 강제 리플로우 → 다시 추가.
    this.root.classList.remove("show");
    void this.root.offsetWidth;
    this.root.classList.add("show");

    clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(
      () => this.root.classList.remove("show"),
      this.durationMs,
    );
  }

  /** 재시작 시 진행 중인 이팩트를 즉시 끈다. */
  reset(): void {
    clearTimeout(this.hideTimer);
    this.root.classList.remove("show");
  }
}
