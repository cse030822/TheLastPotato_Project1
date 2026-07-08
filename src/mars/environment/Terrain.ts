import * as THREE from "three";
import { fbm } from "./noise";
import { terrainHeight } from "./heightfield";
import { makeSoilAlbedo, makeSoilNormal, makeSoilRoughness } from "./soil";

/**
 * 화성 지면(3단 레이어 중 중·후경 담당).
 *  - 근거리(화단·돔)도 완만하게 울퉁불퉁한 행성 표면
 *  - 멀어질수록 굴곡·크레이터가 강해짐
 *  - 색은 단색 빨강이 아니라 적갈색·황토색·어두운 갈색 노이즈 혼합
 *
 * 높낮이는 heightfield.terrainHeight()로 계산해 바위·감자 배치와 정확히 일치한다.
 */
export function createTerrain(): THREE.Mesh {
  const size = 220;
  const seg = 220; // 근거리 잔굴곡까지 표현하도록 촘촘히
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors: number[] = [];

  // 색 팔레트(콘셉트 아트): 어두운 갈색 골 → 적갈색 → 밝은 모래빛 황토(원경 언덕)
  const cLow = new THREE.Color(0x351812); // 골(어두운 갈색)
  const cMid = new THREE.Color(0x8b3a0f); // 적갈색
  const cHigh = new THREE.Color(0xc98a52); // 밝은 모래빛(언덕/원경)
  const tmp = new THREE.Color();
  const WHITE = new THREE.Color(0xffffff); // 정점색을 옅게 만들 때 섞는 기준색

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);

    const h = terrainHeight(x, z);
    pos.setY(i, h);

    // 색: 높이 + 노이즈로 얼룩. 낮으면 어둡게, 높으면 황토빛.
    const cn = fbm(x * 0.09 + 5, z * 0.09 - 8, 3, 33);
    const t = THREE.MathUtils.clamp((h + 1.5) / 5 + (cn - 0.5) * 0.9, 0, 1);
    if (t < 0.5) tmp.copy(cLow).lerp(cMid, t * 2);
    else tmp.copy(cMid).lerp(cHigh, (t - 0.5) * 2);
    // 미세한 밝기 노이즈(자갈 느낌)
    const grain = 0.85 + fbm(x * 0.9, z * 0.9, 2, 3) * 0.3;
    // 실사 알베도 텍스처가 색을 주도하도록, 높이 기반 색은 흰색 쪽으로 당겨
    // "은은한 원근 톤(먼 언덕은 밝게, 골은 어둡게)"만 남긴다(과한 이중 어두워짐 방지).
    tmp.multiplyScalar(grain).lerp(WHITE, 0.5);
    colors.push(tmp.r, tmp.g, tmp.b);
  }

  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  // 실사 화성 토양 재질(다른 환경 프로젝트에서 이식): 산화철 알베도 + 노멀(요철) +
  // 러프니스 맵. 낮게 깔린 붉은 태양에 미세 요철이 살아나 흙바닥이 사실적으로 보인다.
  // 지면 색의 원근 그라데이션은 위의 (옅어진) 정점색이 곱해져 은은하게 유지된다.
  const albedo = makeSoilAlbedo(1024);
  const normal = makeSoilNormal(512);
  const rough = makeSoilRoughness(512);
  const repeat = 40; // 220m 지면에 ~5.5m 간격 타일(RepeatWrapping)
  for (const tx of [albedo, normal, rough]) {
    tx.repeat.set(repeat, repeat);
    tx.anisotropy = 8;
  }

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, // 위에서 옅게 만든 높이 기반 원근 톤
    map: albedo,
    normalMap: normal,
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughnessMap: rough,
    roughness: 1,
    metalness: 0,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}
