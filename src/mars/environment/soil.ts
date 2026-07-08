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
      const n = fbm(x * scale, y * scale, 6, 11); // 0~1 큰 얼룩
      const grain = (fbm(x * scale * 8, y * scale * 8, 3, 27) - 0.5) * 0.24; // ±0.12 잔알갱이
      // 큰 얼룩(저주파)의 진폭을 절반으로 줄여 타일 반복이 눈에 덜 띄게 한다.
      // 지면의 큰 색 변화(원근 톤)는 Terrain의 정점색이 담당하므로 알베도는 잔결 위주.
      const t = THREE.MathUtils.clamp(0.5 + (n - 0.5) * 0.5 + grain, 0, 1);
      const r = 74 + t * 150;
      const g = 30 + t * 66;
      const b = 18 + t * 34;
      const i = (y * size + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
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
      const v = Math.floor(180 + n * 70);
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
