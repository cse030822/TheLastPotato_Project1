/**
 * soil.ts — 실사 화성 토양(regolith) 재질용 절차적 텍스처.
 *
 * 다른 화성 환경 프로젝트(`화성프로젝트3-환경`)의 바닥 재질을 이식한 것.
 * 외부 에셋 없이 canvas로 알베도(산화철 색)·노멀(요철)·러프니스(무광 편차)를
 * 만들어 MeshStandardMaterial에 물려 지면을 한층 사실적으로 만든다.
 *
 * 원본은 simplex 기반 fbm2를 썼지만, 여기서는 이 프로젝트의 값 노이즈 `fbm`
 * (0~1 반환)에 맞춰 동일한 결과 톤이 나오도록 옮겨 담았다(의존성 추가 없음).
 */
import * as THREE from "three";
import { fbm } from "./noise";

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  return [c, ctx];
}

/** 산화철 톤 알베도 맵(어두운 적갈색 → 밝은 산화 주황 사이). */
export function makeSoilAlbedo(size = 1024): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  const scale = 6 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x * scale, y * scale, 6, 11); // 0~1 큰/중 얼룩
      const grain = (fbm(x * scale * 8, y * scale * 8, 3, 27) - 0.5) * 0.24; // ±0.12 잔알갱이
      // 미러랩이 이음새를 잡아주므로 저주파 대비를 어느 정도 살려(0.8) "융털감"을 깬다.
      const t = THREE.MathUtils.clamp(0.5 + (n - 0.5) * 0.8 + grain, 0, 1);
      // 진한 핏빛 대신 밝은 먼지빛 황토-오렌지(더 옅고 채도 낮게 — 물체 구분이 쉽게).
      let r = 120 + t * 120; // 120~240
      let g = 72 + t * 82; //  72~154
      let b = 52 + t * 54; //  52~106
      // 드문 잔돌 스펙클: 밝은 돌 알갱이 / 어두운 그늘돌을 성기게 박아 균일함을 깬다.
      const speck = fbm(x * scale * 22, y * scale * 22, 1, 91);
      if (speck > 0.8) {
        const k = (speck - 0.8) / 0.2; // 밝은 잔돌
        r += 40 * k;
        g += 28 * k;
        b += 20 * k;
      } else if (speck < 0.16) {
        const d = 1 - 0.28 * ((0.16 - speck) / 0.16); // 어두운 돌·그늘(약하게)
        r *= d;
        g *= d;
        b *= d;
      }
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, r);
      img.data[i + 1] = Math.min(255, g);
      img.data[i + 2] = Math.min(255, b);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  // 미러 반복: 타일 경계가 거울처럼 이어져 딱딱한 이음새(seam)가 사라진다.
  tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 러프니스 맵(거친 토양 = 대체로 높은 러프니스, 미세 변화 0.7~0.98). */
export function makeSoilRoughness(size = 512): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  const scale = 10 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x * scale, y * scale, 5, 41); // 0~1
      const fine = (fbm(x * scale * 4, y * scale * 4, 2, 53) - 0.5) * 0.25; // 잔결 편차
      const rr = THREE.MathUtils.clamp(n + fine, 0, 1);
      const v = Math.floor(150 + rr * 95); // 0.59~0.96: 무광~살짝 젖은 반사 편차 확대
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
  return tex;
}

/** 하이트 기반 노멀 맵(Sobel) — 낮은 태양빛에 미세 요철이 살아나게 한다. */
export function makeSoilNormal(size = 512, strength = 2.2): THREE.CanvasTexture {
  const scale = 12 / size;
  const height = (x: number, y: number): number =>
    fbm(x * scale, y * scale, 5, 61) + (fbm(x * scale * 5, y * scale * 5, 3, 83) - 0.5) * 0.3;

  const [canvas, ctx] = makeCanvas(size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hL = height(x - 1, y);
      const hR = height(x + 1, y);
      const hD = height(x, y - 1);
      const hU = height(x, y + 1);
      const dx = (hL - hR) * strength;
      const dy = (hD - hU) * strength;
      const nz = 1.0;
      const len = Math.hypot(dx, dy, nz);
      const i = (y * size + x) * 4;
      img.data[i] = ((dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
  return tex;
}
