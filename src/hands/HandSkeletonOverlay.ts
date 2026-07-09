import { HAND_CONNECTIONS } from "./handConstants";
import type { HandReading } from "./gestures";

/**
 * 우하단 PIP 캔버스에 **웹캠 영상 + 손 뼈대**를 함께 그린다.
 *
 * 왜 비디오를 캔버스에 직접 그리나:
 *   Windows/Chrome에서 <video> 위에 transform이 걸린 채 매 프레임 갱신되는
 *   캔버스가 얹히면, 브라우저가 비디오를 하드웨어 오버레이 평면에서 빼내지 못해
 *   비디오만 검게 나오고 그 위 캔버스(뼈대)만 보이는 컴포지팅 버그가 있다.
 *   → 아예 비디오 프레임을 캔버스에 drawImage로 직접 그려서 항상 보이게 한다.
 *   HTML의 <video id="webcam">는 MediaPipe 입력 소스로만 쓰이고, 시각적으로는
 *   이 캔버스가 완전히 덮어 가린다.
 *
 * 거울(좌우 반전) 표시는 CSS transform(scaleX(-1))이 담당하므로 여기서는
 * 원본 좌표를 그대로 캔버스에 그린다(비디오·뼈대가 함께 반전됨).
 */
export class HandSkeletonOverlay {
  private ctx: CanvasRenderingContext2D;
  visible = true; // [D] 키: 손 뼈대 표시 토글(비디오는 항상 보인다)

  constructor(
    private canvas: HTMLCanvasElement,
    private video: HTMLVideoElement,
  ) {
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

  /** 비디오 프레임을 캔버스에 object-fit:cover 방식으로 꽉 채워 그린다. */
  private drawVideoCover(): void {
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth || !v.videoHeight) return;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const scale = Math.max(cw / v.videoWidth, ch / v.videoHeight);
    const dw = v.videoWidth * scale;
    const dh = v.videoHeight * scale;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;
    this.ctx.drawImage(v, dx, dy, dw, dh);
  }

  draw(hands: HandReading[]): void {
    const { ctx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 1) 웹캠 영상(항상) — 캔버스에 직접 그려 컴포지팅 문제와 무관하게 보이게 한다.
    this.drawVideoCover();

    // 2) 손 뼈대(토글 가능) — 비디오 위에 겹쳐 그린다.
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
