import { fbm } from "./noise";

/**
 * 화성 지면 높이장(heightfield) — 단일 진실 공급원.
 * 지형 메쉬 변위, 바위 배치, 감자·곤충 배치가 모두 이 함수를 써서
 * 서로 정확히 같은 굴곡 위에 앉는다(오브젝트가 공중에 뜨거나 파묻히지 않게).
 *
 * 설계:
 *  - 근거리(돔·화단)도 완전 평면이 아니라 완만하게 울퉁불퉁(행성 표면감)
 *  - 멀어질수록 큰 기복과 크레이터가 강해짐
 */
export const TERRAIN_CENTER = { x: 0, z: -3 };

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function terrainHeight(x: number, z: number): number {
  const dist = Math.hypot(x - TERRAIN_CENTER.x, z - TERRAIN_CENTER.z);
  const roughen = smoothstep(7, 60, dist); // 0=근거리, 1=원거리

  // -1..1 로 정규화한 노이즈 성분들
  const rolling = (fbm(x * 0.035, z * 0.035, 4, 7) - 0.5) * 2; // 완만한 큰 기복
  const bumps = (fbm(x * 0.12, z * 0.12, 3, 19) - 0.5) * 2; // 중간 울퉁불퉁
  const gravel = (fbm(x * 0.55, z * 0.55, 2, 41) - 0.5) * 2; // 잔자갈 디테일

  // 드문드문 크레이터(원거리에서만 깊게 파임)
  const craterField = fbm(x * 0.05 + 40, z * 0.05 - 25, 2, 88);
  const crater = craterField > 0.74 ? -(craterField - 0.74) * 10 : 0;

  // 원경 모래 언덕(dune): 바람에 쓸린 매끄러운 긴 능선. 원거리에서만 크게 솟는다.
  const dune = Math.sin(x * 0.05 + fbm(x * 0.02, z * 0.02, 2, 5) * 5) * 3.2 * roughen;

  const h =
    rolling * (0.22 + roughen * 4.2) + // 근거리 약, 원거리 강
    bumps * (0.13 + roughen * 1.3) +
    gravel * 0.05 +
    crater * roughen +
    dune;

  return h;
}
