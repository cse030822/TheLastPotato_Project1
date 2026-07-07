import * as THREE from "three";
import { makeRng } from "./noise";

/**
 * 바람에 흐르는 안개/흙먼지 뱅크.
 * 선형 안개(scene.fog)는 "흐를" 수 없으므로, 지면을 가로질러 드리프트하는
 * 크고 부드러운 반투명 먼지 스프라이트로 "휘날리는 먼지 벽/띠"를 연출한다.
 *  - 저채도 적갈색 + 낮은 불투명도(발광 아님)
 *  - 근·중경 뱅크: 낮게 깔려 옆으로 흐름
 */
export class HazeBanks {
  readonly group = new THREE.Group();
  private banks: { sprite: THREE.Sprite; speed: number; baseScale: number; phase: number }[] = [];
  private readonly span = 120;

  constructor() {
    const puff = this.makePuffTexture();
    const rng = makeRng(4242);

    // 낮게 깔려 흐르는 먼지 뱅크
    for (let i = 0; i < 9; i++) {
      const mat = new THREE.SpriteMaterial({
        map: puff,
        color: 0x7a4a30,
        transparent: true,
        opacity: 0.04 + rng() * 0.03, // 선명도 우선: 뿌연 뱅크를 옅게
        depthWrite: false,
        blending: THREE.NormalBlending,
        fog: true,
      });
      const sprite = new THREE.Sprite(mat);
      const baseScale = 14 + rng() * 22;
      sprite.scale.set(baseScale * (1.4 + rng()), baseScale * (0.5 + rng() * 0.3), 1);
      sprite.position.set(
        (rng() - 0.5) * this.span,
        1.5 + rng() * 4,
        -8 - rng() * 55,
      );
      this.group.add(sprite);
      this.banks.push({ sprite, speed: 1.2 + rng() * 2.4, baseScale, phase: rng() * 6.28 });
    }
  }

  /** 부드러운 방사형 먼지 뭉치 텍스처. */
  private makePuffTexture(): THREE.CanvasTexture {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    const rng = makeRng(11);
    // 여러 겹의 흐릿한 원으로 뭉게진 먼지 구름
    for (let i = 0; i < 22; i++) {
      const x = 64 + (rng() - 0.5) * 70;
      const y = 64 + (rng() - 0.5) * 50;
      const r = 12 + rng() * 40;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(200,150,110,${0.05 + rng() * 0.06})`);
      g.addColorStop(1, "rgba(200,150,110,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
    }
    return new THREE.CanvasTexture(c);
  }

  update(dt: number, elapsed: number): void {
    const half = this.span / 2;
    for (const b of this.banks) {
      b.sprite.position.x += b.speed * dt;
      if (b.sprite.position.x > half) b.sprite.position.x -= this.span;
      // 흐르며 부풀었다 줄어드는 호흡
      const pulse = 1 + Math.sin(elapsed * 0.4 + b.phase) * 0.12;
      b.sprite.scale.x = b.baseScale * (1.4) * pulse;
    }
  }
}
