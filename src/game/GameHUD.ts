import * as THREE from "three";
import type { Garden } from "./Garden";
import { layout } from "../view/layout";

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
  private overlayBadge = document.getElementById("result-badge")!;
  private overlayTitle = document.getElementById("result-title")!;
  private overlaySub = document.getElementById("result-sub")!;
  private overlayStats = document.getElementById("result-stats")!;
  private scoreValEl = document.getElementById("result-score-val")!;
  private bestTextEl = document.getElementById("result-best-text")!;
  private recordEl = document.getElementById("result-record") as HTMLElement;

  // 감자 인덱스별 원형 링 DOM(재사용).
  private gauges: { root: HTMLDivElement; prog: SVGCircleElement; pct: HTMLSpanElement }[] = [];
  private lastResult: string | null = null;
  private scoreAnim = 0; // 점수 카운트업 rAF id(0=없음).
  private readonly _wp = new THREE.Vector3();

  /** 최고 점수 저장 키(localStorage). */
  private static readonly BEST_KEY = "mars.bestScore.v1";

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
            ? garden.practice
              ? "오른손 트리거로 에너지 분사 → 감자를 마음껏 키워보세요!"
              : "오른손 트리거로 에너지 분사 → 감자를 키우세요! 왼손으로 곤충 격퇴."
            : "[R] 키로 다시 시작.";

    // 감자별 원형 링(월드→화면 투영).
    // 게이지 레이어(#potato-gauges)는 UI 설계 좌표계(메타존이면 2020×1200)에 그려지고,
    // 메타존에서는 래퍼(#play-ui)가 통째로 축소되므로 여기선 설계 좌표계 기준으로 매핑한다.
    // 일반 모드에서는 창 전체와 동일.
    const w = layout.uiWidth;
    const h = layout.uiHeight;
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

    // 결과 오버레이(종료 시점 생존 감자 수로 등급이 갈린다)
    const tier = garden.resultTier; // "perfect" | "partial" | "fail" | null
    if (tier !== this.lastResult) {
      this.lastResult = tier;
      if (tier) this.showResult(garden, tier);
      else this.overlayEl.classList.remove("visible");
    }
  }

  /** 등급별(완전 성공 / 부분 성공 / 실패) 결과 카드 내용을 채우고 표시한다. */
  private showResult(garden: Garden, tier: "perfect" | "partial" | "fail"): void {
    const survivors = garden.survivors;
    const total = garden.maxPotatoes;
    const harvest = garden.totalHarvest;
    this.overlayEl.dataset.kind = tier;

    let badge = "";
    let title = "";
    let sub = "";
    const stats: string[] = [];

    const secs = garden.survivedSec;

    if (tier === "perfect") {
      badge = "🏆";
      const grown = garden.winReason === "grown";
      title = grown ? "완전 성공!" : "완벽한 방어!";
      sub = grown
        ? "감자 3그루를 모두 100%까지 키워냈습니다 — 붉은 화성이 초록으로 물들었습니다."
        : "3그루를 모두 끝까지 지켜냈습니다 — 척박한 화성에 마침내 생명이 뿌리내렸습니다.";
      stats.push(`🥔 생존 ${survivors}/${total}그루`, `🌱 수확한 감자알 ${harvest}개`, `⏱ 버틴 시간 ${secs}초`);
    } else if (tier === "partial") {
      badge = "🌿";
      title = "생명을 지켜냈다";
      sub = `${survivors}그루를 끝까지 지켜냈습니다. 전부는 아니어도, 척박한 화성에서 살려낸 소중한 생명입니다.`;
      stats.push(`🥔 생존 ${survivors}/${total}그루`, `🌱 수확한 감자알 ${harvest}개`, `⏱ 버틴 시간 ${secs}초`);
    } else {
      badge = "🥀";
      title = "밭이 전멸했습니다";
      sub = "곤충이 감자를 모두 삼켰습니다. 하지만 화성 개척은 몇 번이고 다시 도전할 수 있습니다.";
      stats.push(`🌱 수확한 감자알 ${harvest}개`, `⏱ 버틴 시간 ${secs}초`);
    }

    this.overlayBadge.textContent = badge;
    this.overlayTitle.textContent = title;
    this.overlaySub.textContent = sub;
    this.overlayStats.innerHTML = stats
      .map((s) => `<span class="rs-chip">${s}</span>`)
      .join("");
    this.overlayStats.style.display = stats.length ? "flex" : "none";

    // 점수·최고기록: 신기록이면 저장하고 배지를 켠다. 점수는 0에서 카운트업.
    const score = garden.finalScore;
    const prevBest = this.readBest();
    const isRecord = score > prevBest;
    if (isRecord) this.writeBest(score);
    this.recordEl.hidden = !isRecord;
    this.bestTextEl.textContent = `최고 기록 ${Math.max(score, prevBest).toLocaleString()}점`;
    this.animateScore(score);

    this.overlayEl.classList.add("visible");
  }

  /** 저장된 최고 점수(없거나 손상 시 0). */
  private readBest(): number {
    try {
      const v = Number(localStorage.getItem(GameHUD.BEST_KEY));
      return Number.isFinite(v) && v > 0 ? v : 0;
    } catch {
      return 0; // 사생활 보호 모드 등 localStorage 불가 시
    }
  }

  private writeBest(score: number): void {
    try {
      localStorage.setItem(GameHUD.BEST_KEY, String(score));
    } catch {
      /* 저장 불가는 무시 — 이번 판 점수만 표시된다 */
    }
  }

  /** 점수를 0→target으로 약 0.9초간 부드럽게 카운트업(easeOutCubic). */
  private animateScore(target: number): void {
    if (this.scoreAnim) cancelAnimationFrame(this.scoreAnim);
    const dur = 900;
    const start = performance.now();
    const tick = (now: number): void => {
      const k = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      this.scoreValEl.textContent = Math.round(target * eased).toLocaleString();
      if (k < 1) {
        this.scoreAnim = requestAnimationFrame(tick);
      } else {
        this.scoreValEl.textContent = target.toLocaleString();
        this.scoreAnim = 0;
      }
    };
    this.scoreAnim = requestAnimationFrame(tick);
  }

  /** 재시작: 게이지·오버레이 숨김 + 점수 카운트업 중단. */
  reset(): void {
    this.lastResult = null;
    this.overlayEl.classList.remove("visible");
    for (const g of this.gauges) g.root.style.display = "none";
    if (this.scoreAnim) {
      cancelAnimationFrame(this.scoreAnim);
      this.scoreAnim = 0;
    }
    this.scoreValEl.textContent = "0";
    this.recordEl.hidden = true;
  }
}
