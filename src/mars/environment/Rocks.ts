import * as THREE from "three";
import { makeRng } from "./noise";
import { terrainHeight } from "./heightfield";

/**
 * 각지고 날카로운 다면체 바위들. 화성 특유의 거친 지질감.
 * 둥근 형태 대신 정점을 흩뜨린 저폴리 다면체를 flatShading으로 표현.
 * 게임플레이 구역(돔 중심 반경) 안쪽에는 배치하지 않아 시야를 막지 않는다.
 */
export function createRocks(count = 46): THREE.Group {
  const group = new THREE.Group();
  const rng = makeRng(1337);

  const rockMats = [
    new THREE.MeshStandardMaterial({ color: 0x5a2c1c, roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x743c22, roughness: 0.95, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x3e2015, roughness: 1, flatShading: true }),
  ];

  const centerX = 0;
  const centerZ = -3;

  for (let i = 0; i < count; i++) {
    // 게임 구역(반경 ~7) 밖 링 안에 배치
    const ang = rng() * Math.PI * 2;
    const radius = 8 + rng() * 60;
    const x = centerX + Math.cos(ang) * radius;
    const z = centerZ + Math.sin(ang) * radius;

    // 원경일수록 큰 바위가 나오도록
    const far = THREE.MathUtils.smoothstep(radius, 8, 60);
    const scale = 0.35 + rng() * (0.9 + far * 3.2);

    const geo = new THREE.DodecahedronGeometry(scale, 0);
    // 정점을 무작위로 밀어 각진 파편처럼
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < p.count; v++) {
      const jitter = 0.55;
      p.setX(v, p.getX(v) * (1 + (rng() - 0.5) * jitter));
      p.setY(v, p.getY(v) * (1 + (rng() - 0.5) * jitter));
      p.setZ(v, p.getZ(v) * (1 + (rng() - 0.5) * jitter));
    }
    geo.computeVertexNormals();

    const rock = new THREE.Mesh(geo, rockMats[(rng() * rockMats.length) | 0]);
    // 지형 높이에 맞춰 살짝 파묻히게(지형·감자와 동일한 높이장 사용)
    const groundH = terrainHeight(x, z);
    rock.position.set(x, groundH + scale * (0.15 + rng() * 0.3), z);
    rock.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    rock.scale.set(1, 0.7 + rng() * 0.6, 1); // 납작하거나 뾰족하거나
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);
  }

  return group;
}

/**
 * 근경 자갈(gravel). 화단 주변에 작은 다면체 돌멩이를 흩뿌려 지면 디테일을 채운다.
 * 스펙: DodecahedronGeometry radius 0.1~0.5, 색 #6B2E0A~#4A1F05, roughness 1.0.
 */
export function createGravel(count = 44): THREE.Group {
  const group = new THREE.Group();
  const rng = makeRng(90210);

  const cA = new THREE.Color(0x6b2e0a);
  const cB = new THREE.Color(0x4a1f05);

  const centerX = 0;
  const centerZ = -3;

  for (let i = 0; i < count; i++) {
    const ang = rng() * Math.PI * 2;
    // 화단(반경 ~1.5)은 피하되 근·중경에 골고루
    const radius = 1.8 + rng() * 26;
    const x = centerX + Math.cos(ang) * radius;
    const z = centerZ + Math.sin(ang) * radius;

    const r = 0.1 + rng() * 0.4; // 0.1~0.5
    const geo = new THREE.DodecahedronGeometry(r, 0);
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < p.count; v++) {
      const j = 0.4;
      p.setX(v, p.getX(v) * (1 + (rng() - 0.5) * j));
      p.setY(v, p.getY(v) * (1 + (rng() - 0.5) * j));
      p.setZ(v, p.getZ(v) * (1 + (rng() - 0.5) * j));
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color: cA.clone().lerp(cB, rng()),
      roughness: 1,
      metalness: 0,
      flatShading: true,
    });
    const pebble = new THREE.Mesh(geo, mat);
    pebble.position.set(x, terrainHeight(x, z) + r * 0.35, z);
    pebble.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    pebble.scale.set(1, 0.6 + rng() * 0.5, 1);
    pebble.castShadow = true;
    pebble.receiveShadow = true;
    group.add(pebble);
  }

  return group;
}
