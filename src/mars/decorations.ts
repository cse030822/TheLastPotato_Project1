import * as THREE from "three";

// 3단계 장식용(정적) 감자와 곤충. 성장/이동 로직은 6단계에서 구현.

export function createPotato(): THREE.Group {
  const g = new THREE.Group();

  // 1) 젖은 흙 두둑 — 감자를 심은 흙 무더기(지면 위에 얹힘)
  const moundMat = new THREE.MeshStandardMaterial({
    color: 0x3a2414,
    roughness: 1,
    metalness: 0,
  });
  const mound = new THREE.Mesh(
    // 윗 반구(돔) → 밑면이 평평해 지면에 딱 붙는다
    new THREE.SphereGeometry(0.44, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    moundMat,
  );
  mound.scale.set(1, 0.42, 1);
  mound.receiveShadow = true;
  mound.castShadow = true;
  g.add(mound);

  // 두둑 위 작은 흙덩이 몇 개(디테일)
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const clump = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.045 + Math.random() * 0.03, 0),
      moundMat,
    );
    const r = 0.22 + Math.random() * 0.12;
    clump.position.set(Math.cos(a) * r, 0.04, Math.sin(a) * r);
    clump.rotation.set(Math.random(), Math.random(), Math.random());
    clump.castShadow = true;
    g.add(clump);
  }

  // 2) 감자 덩이 — 흙에 절반쯤 박혀 윗부분만 드러남
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x9c7a4d, roughness: 0.95 }),
  );
  body.scale.set(1.25, 0.9, 1.05);
  body.position.y = 0.11; // 두둑 표면(≈0.176) 위로 윗머리만 노출
  body.castShadow = true;
  g.add(body);

  // 3) 덩이 꼭대기에서 돋는 새싹 두 장
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x4f7a3a,
    roughness: 0.8,
    side: THREE.DoubleSide,
  });
  for (const s of [-1, 1]) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.24, 8), leafMat);
    leaf.position.set(s * 0.07, 0.34, 0);
    leaf.rotation.z = s * 0.4;
    leaf.castShadow = true;
    g.add(leaf);
  }

  return g;
}

export function createBug(): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x223018,
    metalness: 0.3,
    roughness: 0.5,
    emissive: 0x0a1e0a,
    emissiveIntensity: 0.3,
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), bodyMat);
  body.scale.set(1, 0.7, 1.5);
  body.position.y = 0.13;
  body.castShadow = true;
  // 다리(장식)
  const legMat = new THREE.MeshStandardMaterial({ color: 0x111a0d });
  for (let i = 0; i < 6; i++) {
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.18, 6),
      legMat,
    );
    const side = i < 3 ? 1 : -1;
    leg.position.set(side * 0.12, 0.06, (i % 3) * 0.1 - 0.1);
    leg.rotation.z = side * 0.9;
    g.add(leg);
  }
  g.add(body);
  return g;
}
