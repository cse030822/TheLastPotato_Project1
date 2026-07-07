/**
 * 의존성 없는 결정론적 2D 값 노이즈(value noise).
 * 지형 높낮이, 바위 배치, 색 얼룩 등 화성 환경의 "자연스러운 불규칙함"에 쓴다.
 * 시드 기반이라 새로고침해도 같은 지형이 나온다.
 */

function hash2(x: number, y: number, seed: number): number {
  // sin 해시 — 라이브러리 없이 0~1 유사난수. 화질용이 아니라 배치용이라 충분.
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return s - Math.floor(s);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t); // smoothstep
}

/** 격자 보간 값 노이즈. 반환 0~1. */
export function valueNoise(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;

  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);

  const u = smooth(xf);
  const v = smooth(yf);

  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}

/** 여러 옥타브를 겹친 프랙탈 노이즈. 큰 굴곡 + 잔디테일. 반환 0~1. */
export function fbm(x: number, y: number, octaves = 4, seed = 0): number {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    value += amp * valueNoise(x * freq, y * freq, seed + i * 13.1);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return value / norm;
}

/** 시드 기반 결정론적 난수 생성기(장식 배치용). */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}
