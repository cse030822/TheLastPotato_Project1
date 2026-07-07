import { HAND_CONNECTIONS } from "./handConstants";
import type { HandReading } from "./gestures";

/**
 * 웹캠 위에 손 뼈대(점 + 반투명 흰 선)를 그리는 2D 오버레이.
 * [D] 키로 켜고 끌 수 있다. 거울 표시는 CSS transform(scaleX)이 담당하므로
 * 여기서는 원본 좌표를 그대로 캔버스에 그린다.
 */
export class HandSkeletonOverlay {
  private ctx: CanvasRenderingContext2D;
  visible = true;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
  }

  toggle(): void {
    this.visible = !this.visible;
  }

  draw(hands: HandReading[]): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.visible) return;

    const w = this.canvas.width;
    const h = this.canvas.height;

    for (const hand of hands) {
      const color =
        hand.side === "right" ? "rgba(70,200,255," : "rgba(255,106,77,";

      // 점과 점 사이 반투명 흰색 선
      ctx.lineWidth = Math.max(2, w * 0.004);
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      for (const [a, b] of HAND_CONNECTIONS) {
        const pa = hand.landmarks[a];
        const pb = hand.landmarks[b];
        ctx.beginPath();
        ctx.moveTo(pa.x * w, pa.y * h);
        ctx.lineTo(pb.x * w, pb.y * h);
        ctx.stroke();
      }

      // 관절마다 점(손 색상, 발사 시 더 밝게)
      const alpha = hand.state === "FIRE" ? "0.95)" : "0.7)";
      ctx.fillStyle = color + alpha;
      const r = Math.max(3, w * 0.006);
      for (const p of hand.landmarks) {
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
