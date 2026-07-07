import * as THREE from "three";

/**
 * 감자(라스트 포테이토) 한 그루.
 *  - 씨감자(seed) → 성장(growth 0~1)으로 잎/줄기가 자라며 커진다.
 *  - 에너지를 받는 동안(glowing) 초록빛을 강하게 내고, 그 동안 곤충이 접근하지 못한다.
 *  - 다 자라면(growth>=1) 성숙 상태로 항상 은은히 빛나며 보호된다.
 *  - 곤충이 닿으면(비보호 상태) health가 깎이고, 0이면 파괴.
 * 크기는 이전보다 크게 키웠다.
 */
export class Potato {
  readonly group = new THREE.Group();
  readonly position: THREE.Vector3;

  health = 100;
  alive = true;
  growth = 0; // 0(씨감자) ~ 1(완전 성장)
  planted = false; // 씨감자가 심어졌는지(등장 연출 후)
  glowing = false; // 이번 프레임 에너지를 받는 중(보호막)
  readonly protectRadius = 2.2; // 빛날 때 곤충 접근 차단 반경

  private tuber: THREE.Mesh;
  private foliage = new THREE.Group();
  private leafMat: THREE.MeshStandardMaterial;
  private moundMat: THREE.MeshStandardMaterial;
  private glowLight: THREE.PointLight;
  private glow = 0; // 현재 발광(보간)

  constructor(pos: THREE.Vector3) {
    this.position = pos.clone();
    this.group.position.copy(pos);

    // --- 젖은 흙 두둑(항상 표시) ---
    this.moundMat = new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 1 });
    const mound = new THREE.Mesh(
      new THREE.SphereGeometry(0.62, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      this.moundMat,
    );
    mound.scale.set(1, 0.4, 1);
    mound.receiveShadow = true;
    mound.castShadow = true;
    this.group.add(mound);

    // --- 씨감자 덩이(흙에 절반쯤 박힘) ---
    this.tuber = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 18, 14),
      new THREE.MeshStandardMaterial({ color: 0x9c7a4d, roughness: 0.95 }),
    );
    this.tuber.scale.set(1.25, 0.9, 1.05);
    this.tuber.position.y = 0.16;
    this.tuber.castShadow = true;
    this.tuber.visible = false; // 심기 전에는 숨김
    this.group.add(this.tuber);

    // --- 잎·줄기(성장에 따라 커짐) ---
    this.leafMat = new THREE.MeshStandardMaterial({
      color: 0x4f8a3a,
      emissive: 0x0c3a10,
      emissiveIntensity: 0.2,
      roughness: 0.7,
      side: THREE.DoubleSide,
    });
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x3f6a2c, roughness: 0.8 });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.7, 6), stemMat);
    stem.position.y = 0.5;
    stem.castShadow = true;
    this.foliage.add(stem);
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.42, 6), this.leafMat);
      const a = (i / 7) * Math.PI * 2;
      const h = 0.35 + (i % 3) * 0.22;
      leaf.position.set(Math.cos(a) * 0.16, h, Math.sin(a) * 0.16);
      leaf.rotation.set(Math.cos(a) * 0.5, -a, 0.9 + Math.sin(a) * 0.3);
      leaf.castShadow = true;
      this.foliage.add(leaf);
    }
    this.foliage.position.y = 0.2;
    this.foliage.visible = false;
    this.group.add(this.foliage);

    // --- 생명 발광(초록 포인트 라이트) ---
    this.glowLight = new THREE.PointLight(0x5bff7a, 0, 4.5, 2);
    this.glowLight.position.set(0, 0.7, 0);
    this.group.add(this.glowLight);
  }

  /** 씨감자 심기(등장 연출 도착 시 호출). */
  plantSeed(): void {
    this.planted = true;
    this.tuber.visible = true;
  }

  /** 퇴비 적용(흙이 촉촉·비옥해 보이게 어둡게). */
  compost(): void {
    this.moundMat.color.set(0x2c1c0e);
  }

  /** 완전 성장 여부. */
  get grown(): boolean {
    return this.growth >= 1;
  }

  destroy(): void {
    this.alive = false;
    this.health = 0;
    this.group.visible = false;
  }

  update(dt: number): void {
    if (!this.alive) return;

    // 성장 시각화
    const g = this.growth;
    this.foliage.visible = g > 0.02;
    this.foliage.scale.setScalar(0.2 + g * 1.4); // 작게 시작 → 크게
    this.tuber.scale.set(1.25 + g * 0.5, 0.9 + g * 0.4, 1.05 + g * 0.4);

    // 발광: 에너지 받는 중이면 강하게, 다 자랐으면 은은히 상시.
    const target = this.glowing ? 1 : this.grown ? 0.35 : 0;
    this.glow += (target - this.glow) * Math.min(1, dt * 6);
    this.glowLight.intensity = this.glow * 3.2;
    this.leafMat.emissiveIntensity = 0.2 + this.glow * 2.2;
  }
}
