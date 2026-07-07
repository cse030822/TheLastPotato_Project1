import * as THREE from "three";
import type { Garden } from "./Garden";

/** 원형 링 반지름(뷰박스 44 기준) → 둘레(스트로크 대시). */
const RING_R = 19;
const RING_C = 2 * Math.PI * RING_R;
const MAX_WAVE = 8;
const WAVE_SECONDS = 7.5; // 이 간격마다 WAVE 1 상승 → 60초 방어 동안 1~8까지 상승

/**
 * 게임 HUD(레퍼런스 UI/UX 기준 레이아웃).
 *  - 목표(좌상단) · 타이머(중앙) · WAVE + 남은 적(우상단)
 *  - 감자별 원형 성장 링(월드→화면 투영)
 *  - 에너지(좌하단) · 조작 방법(우하단)
 *  - 승리/패배 오버레이
 */
export class GameHUD {
  private timerEl = document.getElementById("timer-val")!;
  private timerPill = document.getElementById("timer-pill")!;
  private objDefendEl = document.getElementById("obj-defend")!;
  private waveEl = document.getElementById("wave-val")!;
  private enemyEl = document.getElementById("enemy-val")!;
  private energyValEl = document.getElementById("energy-val")!;
  private energyFillEl = document.getElementById("energy-fill") as HTMLElement;
  private controlsTextEl = document.getElementById("controls-text")!;
  private objGrowEl = document.getElementById("obj-grow")!;
  private gaugeLayer = document.getElementById("potato-gauges")!;
  private overlayEl = document.getElementById("result-overlay")!;
  private overlayTitle = document.getElementById("result-title")!;
  private overlaySub = document.getElementById("result-sub")!;

  // 감자 인덱스별 원형 링 DOM(재사용).
  private gauges: { root: HTMLDivElement; prog: SVGCircleElement; pct: HTMLSpanElement }[] = [];
  private lastResult: string | null = null;
  private readonly _wp = new THREE.Vector3();

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  private ensureGauge(i: number) {
    if (this.gauges[i]) return this.gauges[i];
    const root = document.createElement("div");
    root.className = "potato-gauge";
    root.innerHTML = `
      <svg class="pg-ring" viewBox="0 0 44 44">
        <circle class="pg-track" cx="22" cy="22" r="${RING_R}"></circle>
        <circle class="pg-prog" cx="22" cy="22" r="${RING_R}"
          stroke-dasharray="${RING_C.toFixed(2)}" stroke-dashoffset="${RING_C.toFixed(2)}"></circle>
      </svg>
      <span class="pg-pct">0%</span>`;
    this.gaugeLayer.appendChild(root);
    const g = {
      root,
      prog: root.querySelector(".pg-prog") as SVGCircleElement,
      pct: root.querySelector(".pg-pct") as HTMLSpanElement,
    };
    this.gauges[i] = g;
    return g;
  }

  /**
   * @param energyPct 0~100 에너지 미터 값
   */
  update(garden: Garden, bugCount: number, energyPct: number): void {
    // 타이머(60초 방어 카운트다운)
    const tl = Math.ceil(garden.timeLeft);
    this.timerEl.textContent = `${String(Math.floor(tl / 60)).padStart(2, "0")}:${String(tl % 60).padStart(2, "0")}`;
    // 남은 10초 이하면 긴급(빨강·펄스) 표시
    this.timerPill.classList.toggle("urgent", garden.phase === "energy" && tl <= 10);

    // WAVE(시간 기반) + 남은 적
    const wave = garden.energyStarted
      ? Math.min(MAX_WAVE, 1 + Math.floor(garden.elapsedSec / WAVE_SECONDS))
      : 1;
    this.waveEl.textContent = `${wave} / ${MAX_WAVE}`;
    this.enemyEl.textContent = String(bugCount);

    // 에너지 미터
    const e = Math.round(energyPct);
    this.energyValEl.textContent = `${e}%`;
    this.energyFillEl.style.width = `${e}%`;

    // 목표 진행: ① 3개 모두 100% 성장(3개 전부 심고 살려야 완료) ② 60초 방어
    const grownCount = garden.potatoes.filter((p) => p.alive && p.grown).length;
    const total = garden.maxPotatoes;
    this.objGrowEl.textContent = `식물 ${total}개 모두 100% 성장 (${grownCount}/${total})`;
    this.objGrowEl.classList.toggle("done", grownCount === total);
    this.objDefendEl.textContent = garden.elapsedSec > 0
      ? `60초 동안 방어 (${tl}초 남음)`
      : "60초 동안 외계 생명체로부터 방어";
    this.objDefendEl.classList.toggle("done", tl <= 0 && garden.phase === "won");

    // 조작 안내(단계별)
    this.controlsTextEl.textContent =
      garden.phase === "seed"
        ? "총 자세로 원하는 자리를 조준 → 트리거를 당겨 씨앗 심기!"
        : garden.phase === "compost"
          ? "잠시 대기… 곧 에너지가 흐릅니다."
          : garden.phase === "energy"
            ? "오른손 트리거로 에너지 분사 → 감자를 키우세요! 왼손으로 곤충 격퇴."
            : "[R] 키로 다시 시작.";

    // 감자별 원형 링(월드→화면 투영)
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pots = garden.potatoes;
    for (let i = 0; i < this.gauges.length; i++) {
      if (i >= pots.length) this.gauges[i].root.style.display = "none";
    }
    for (let i = 0; i < pots.length; i++) {
      const pot = pots[i];
      const g = this.ensureGauge(i);
      if (!pot.alive || !pot.planted || !garden.energyStarted) {
        g.root.style.display = "none";
        continue;
      }
      this._wp.copy(pot.position);
      this._wp.y += 2.0;
      this._wp.project(this.camera);
      if (this._wp.z > 1) {
        g.root.style.display = "none"; // 카메라 뒤
        continue;
      }
      const x = (this._wp.x * 0.5 + 0.5) * w;
      const y = (-this._wp.y * 0.5 + 0.5) * h;
      g.root.style.display = "block";
      g.root.style.left = `${x}px`;
      g.root.style.top = `${y}px`;
      const pct = Math.round(pot.growth * 100);
      g.prog.style.strokeDashoffset = `${(RING_C * (1 - pot.growth)).toFixed(2)}`;
      g.pct.textContent = `${pct}%`;
      g.root.classList.toggle("done", pot.grown);
    }

    // 결과 오버레이
    const result = garden.phase === "won" ? "won" : garden.phase === "lost" ? "lost" : null;
    if (result !== this.lastResult) {
      this.lastResult = result;
      if (result === "won") {
        this.overlayEl.dataset.kind = "won";
        const survived = garden.winReason === "survived";
        this.overlayTitle.textContent = survived ? "방어 성공!" : "수확 성공!";
        this.overlaySub.textContent = survived
          ? `60초 방어에 성공했습니다 · 감자알 ${garden.totalHarvest}개 수확 · [R] 다시 시작`
          : `감자를 모두 키워냈습니다 · 감자알 ${garden.totalHarvest}개 · [R] 다시 시작`;
        this.overlayEl.classList.add("visible");
      } else if (result === "lost") {
        this.overlayEl.dataset.kind = "lost";
        this.overlayTitle.textContent = "밭이 전멸했습니다";
        this.overlaySub.textContent = "곤충이 감자를 모두 삼켰습니다 · [R] 다시 시작";
        this.overlayEl.classList.add("visible");
      } else {
        this.overlayEl.classList.remove("visible");
      }
    }
  }

  /** 재시작: 게이지·오버레이 숨김. */
  reset(): void {
    this.lastResult = null;
    this.overlayEl.classList.remove("visible");
    for (const g of this.gauges) g.root.style.display = "none";
  }
}
