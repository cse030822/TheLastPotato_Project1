import * as THREE from "three";
import { makeRng } from "./noise";
import { terrainHeight } from "./heightfield";

/**
 * 척박한 화성 지면에 드문드문 난 마른 관목(dry scrub) — 단순한 저폴리 식물.
 * "죽음 속 생명" 톤을 지키려 채도 낮은 마른 올리브·갈색으로 두어, 감자의 네온 초록과
 * 경쟁하지 않게 한다(살아 있는 초록은 오직 감자만). 밑동에서 바깥으로 벌어지는
 * 가느다란 마른 가지 몇 개를 묶은 아주 단순한 형태.
 *
 * 게임 구역(돔 중심 반경 ~6) 밖에만 심어 시야·조작을 방해하지 않는다.
 */
export function createPlants(count = 22): THREE.Group {
  const group = new THREE.Group();
  group.name = "Plants";
  const rng = makeRng(24680);

  const palette = [
    new THREE.Color(0x6b5a34), // 마른 짚색
    new THREE.Color(0x4d4326), // 어두운 올리브갈
    new THREE.Color(0x5c4a2a), // 시든 갈색
  ];

  const centerX = 0;
  const centerZ = -3;

  for (let i = 0; i < count; i++) {
    const ang = rng() * Math.PI * 2;
    const radius = 6 + rng() * 34; // 근·중경(게임 구역 밖)
    const x = centerX + Math.cos(ang) * radius;
    const z = centerZ + Math.sin(ang) * radius;

    const shrub = new THREE.Group();
    const baseCol = palette[(rng() * palette.length) | 0];
    const mat = new THREE.MeshStandardMaterial({
      color: baseCol.clone().multiplyScalar(0.7 + rng() * 0.5),
      roughness: 1,
      metalness: 0,
      flatShading: true,
    });

    // 밑동에서 바깥으로 벌어지는 마른 가지(가느다란 원뿔) 4~6개
    const blades = 4 + ((rng() * 3) | 0);
    const h = 0.3 + rng() * 0.5;
    for (let b = 0; b < blades; b++) {
      const bh = h * (0.7 + rng() * 0.6); // 가지별 길이 편차
      const blade = new THREE.Mesh(
        new THREE.ConeGeometry(0.03 + rng() * 0.02, bh, 5),
        mat,
      );
      const ba = (b / blades) * Math.PI * 2 + rng() * 0.5;
      const lean = 0.25 + rng() * 0.35; // 바깥으로 기운 정도
      blade.position.set(Math.cos(ba) * 0.05, bh * 0.4, Math.sin(ba) * 0.05);
      blade.rotation.z = -Math.cos(ba) * lean;
      blade.rotation.x = Math.sin(ba) * lean;
      blade.castShadow = true;
      shrub.add(blade);
    }

    const s = 0.7 + rng() * 0.8;
    shrub.scale.setScalar(s);
    shrub.position.set(x, terrainHeight(x, z), z);
    shrub.rotation.y = rng() * Math.PI * 2;
    group.add(shrub);
  }

  return group;
}
