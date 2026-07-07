import * as THREE from "three";
import { fbm } from "./noise";
import { terrainHeight } from "./heightfield";

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
    colors.push(tmp.r * grain, tmp.g * grain, tmp.b * grain);
  }

  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  // 절차적 레골리스 디테일: 지오메트리 변경 없이 표면에 자잘한 요철(bump)과
  // 무광/촉촉 반사 편차(roughness)를 더해 실사감을 올린다.
  const detail = makeRegolithTexture();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    bumpMap: detail,
    bumpScale: 0.045,
    roughnessMap: detail, // 텍스처 명도로 roughness를 변조(어두운 곳=촉촉하게 반짝)
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

/**
 * 화성 표토(regolith)용 절차적 그레이스케일 노이즈 텍스처.
 * bumpMap + roughnessMap 공용. MirroredRepeat로 타일 이음새를 숨긴다.
 */
function makeRegolithTexture(): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // 두 스케일 노이즈를 섞어 뭉친 자갈감(경계 없이 자잘한 알갱이)
      const n1 = fbm(x * 0.08, y * 0.08, 3, 71); // 큰 얼룩
      const n2 = fbm(x * 0.32, y * 0.32, 2, 12); // 잔알갱이
      const v = Math.min(1, Math.max(0, 0.55 + n1 * 0.5 + (n2 - 0.5) * 0.28));
      const g = (v * 255) | 0;
      const idx = (y * S + x) * 4;
      img.data[idx] = g;
      img.data[idx + 1] = g;
      img.data[idx + 2] = g;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
  tex.repeat.set(64, 64); // 220m 지면에 ~3.4m 간격으로 반복(미러링으로 이음새 은폐)
  tex.anisotropy = 4;
  return tex;
}
