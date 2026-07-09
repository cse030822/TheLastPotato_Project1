import * as THREE from "three";

/** 한 그루에 맺히는 감자알(덩이) 최대 개수. */
export const TUBERS_PER_PLANT = 5;

/**
 * 감자(라스트 포테이토) 한 그루.
 *  - 씨감자(seed) → 성장(growth 0~1)으로 줄기·잎이 길게 자란다.
 *  - 성장 후반부(≈50% 이후)부터 두둑 둘레로 **감자알**이 하나씩 돋아난다.
 *  - 감자알이 모두(5개) 돋으면 성숙(grown) — 수확 완료로 승리에 기여.
 *  - 에너지를 받는 동안(glowing) 초록빛을 강하게 내고, 그 동안'만' 곤충이 접근하지 못한다.
 *  - 다 자란 감자도 방치하면 곤충이 갉아먹어 성장(growth)이 되돌아가고 감자알이 흙 속으로 다시 들어간다.
 *  - 성장이 0까지 깎인 뒤에도 계속 갉아먹히면 씨감자 health가 깎이고, 0이면 파괴.
 */
export class Potato {
  readonly group = new THREE.Group();
  readonly position: THREE.Vector3;

  health = 100;
  alive = true;
  growth = 0; // 0(씨감자) ~ 1(완전 성장)
  planted = false; // 씨감자가 심어졌는지(등장 연출 후)
  glowing = false; // 지금 보호막이 켜져 있는지(shield>0에서 파생) — 곤충 접근 차단·발광
  shield = 0; // 남은 보호막 지속 시간(초). 빔이 이 그루를 겨눌 때 리필된다.
  readonly protectRadius = 2.2; // 빛날 때 곤충 접근 차단 반경

  /** 감자알이 새로 돋을 때(월드 좌표) 호출 — 수확 연출·사운드용. Garden이 주입. */
  onTuberPop: ((worldPos: THREE.Vector3) => void) | null = null;

  private tuber: THREE.Mesh; // 씨감자(중앙, 흙 속)
  private foliage = new THREE.Group();
  private leafMat: THREE.MeshStandardMaterial;
  private moundMat: THREE.MeshStandardMaterial;
  private glowLight: THREE.PointLight;
  private glow = 0; // 현재 발광(보간)

  // --- 감자알(덩이) ---
  private tubers: THREE.Mesh[] = [];
  private tuberMat: THREE.MeshStandardMaterial;
  private tuberPop: number[] = []; // 각 감자알의 팝 진행(0=숨김 → 1=완전히 돋음)
  private tuberSpawned: boolean[] = []; // 팝 시작(콜백 1회) 여부
  // 각 감자알이 돋기 시작하는 성장 임계값(50% → 100%에 고르게 분포).
  private readonly tuberThreshold: number[] = Array.from(
    { length: TUBERS_PER_PLANT },
    (_, i) => 0.5 + (i * 0.5) / TUBERS_PER_PLANT,
  );
  private readonly _wp = new THREE.Vector3();

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
      new THREE.MeshStandardMaterial({ color: 0xc8a550, roughness: 0.95 }),
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
    // 꼭대기 새순(성장 신호) — 다 자라면 감자꽃처럼 살짝 밝게.
    const bud = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.3, 6),
      this.leafMat,
    );
    bud.position.y = 0.92;
    this.foliage.add(bud);
    this.foliage.position.y = 0.2;
    this.foliage.visible = false;
    this.group.add(this.foliage);

    // --- 감자알(덩이): 두둑 둘레에 반쯤 파묻힌 채 돋아난다 ---
    this.tuberMat = new THREE.MeshStandardMaterial({
      color: 0xd8b45c,
      emissive: 0x2e5a1c,
      emissiveIntensity: 0.0,
      roughness: 0.9,
    });
    const tuberGeo = new THREE.SphereGeometry(0.17, 14, 12);
    for (let i = 0; i < TUBERS_PER_PLANT; i++) {
      const t = new THREE.Mesh(tuberGeo, this.tuberMat);
      const a = (i / TUBERS_PER_PLANT) * Math.PI * 2 + 0.4;
      const r = 0.5;
      t.position.set(Math.cos(a) * r, 0.06, Math.sin(a) * r);
      t.scale.set(1.15, 0.85, 0.95);
      t.rotation.y = a;
      t.castShadow = true;
      t.visible = false;
      this.group.add(t);
      this.tubers.push(t);
      this.tuberPop.push(0);
      this.tuberSpawned.push(false);
    }

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

  /** 현재까지 돋아난 감자알 수(수확 카운트). */
  get harvestCount(): number {
    let n = 0;
    for (const s of this.tuberSpawned) if (s) n++;
    return n;
  }

  /** 완전 성장(감자알을 모두 맺음) 여부. */
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

    // 성장 시각화(줄기·잎이 위로 길게 자람)
    const g = this.growth;
    this.foliage.visible = g > 0.02;
    // 세로로 더 길게 뻗도록 Y를 크게, 옆폭은 완만하게.
    const spread = 0.2 + g * 1.35;
    this.foliage.scale.set(spread, 0.2 + g * 1.9, spread);
    this.tuber.scale.set(1.25 + g * 0.5, 0.9 + g * 0.4, 1.05 + g * 0.4);

    // 감자알: 임계값을 넘으면 하나씩 팝(0→1 이징). 팝 시작 시 콜백 1회.
    for (let i = 0; i < this.tubers.length; i++) {
      if (g >= this.tuberThreshold[i]) {
        if (!this.tuberSpawned[i]) {
          this.tuberSpawned[i] = true;
          this.tubers[i].getWorldPosition(this._wp);
          this.onTuberPop?.(this._wp.clone());
        }
        // 팝 진행: 약 0.7초에 완전히 돋음.
        this.tuberPop[i] = Math.min(1, this.tuberPop[i] + dt / 0.7);
      } else if (this.tuberPop[i] > 0) {
        // 성장이 임계값 아래로 깎이면(곤충이 갉아먹음) 감자알이 흙 속으로 되돌아간다.
        this.tuberPop[i] = Math.max(0, this.tuberPop[i] - dt / 0.7);
        // 완전히 들어가면 "돋지 않은" 상태로 복귀 → 다시 키우면 수확 연출이 재생된다.
        if (this.tuberPop[i] <= 0) this.tuberSpawned[i] = false;
      }
      const p = this.tuberPop[i];
      const t = this.tubers[i];
      t.visible = p > 0.001;
      // 살짝 튀어오르는 오버슈트(1.15 → 1.0).
      const s = p < 0.7 ? (p / 0.7) * 1.15 : 1.15 - ((p - 0.7) / 0.3) * 0.15;
      t.scale.set(1.15 * s, 0.85 * s, 0.95 * s);
      // 흙에서 살짝 솟아오름.
      t.position.y = 0.02 + p * 0.06;
    }

    // 발광: 에너지 받는 중이면 강하게, 다 자랐으면 은은히 상시.
    const target = this.glowing ? 1 : this.grown ? 0.35 : 0;
    this.glow += (target - this.glow) * Math.min(1, dt * 6);
    this.glowLight.intensity = this.glow * 3.2;
    this.leafMat.emissiveIntensity = 0.2 + this.glow * 2.2;
    // 감자알도 생명빛을 머금음(수확할수록 은은한 초록).
    this.tuberMat.emissiveIntensity = 0.15 + this.glow * 0.9;
  }

  /** 재시작: 완전히 심기 전(seed) 상태로 되돌린다. */
  reset(): void {
    this.alive = true;
    this.health = 100;
    this.growth = 0;
    this.planted = false;
    this.glowing = false;
    this.shield = 0;
    this.glow = 0;
    this.tuber.visible = false;
    this.foliage.visible = false;
    this.moundMat.color.set(0x4a3220);
    for (let i = 0; i < this.tubers.length; i++) {
      this.tuberPop[i] = 0;
      this.tuberSpawned[i] = false;
      this.tubers[i].visible = false;
    }
    this.group.visible = true;
  }
}
