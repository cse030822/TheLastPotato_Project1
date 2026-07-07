import * as THREE from "three";

/**
 * 테라건에서 뻗어 나가는 "얇은 에너지 광선(beam)".
 * 큰 광원/분사 대신, 노즐 → 대상 지점까지 이어지는 가느다란 직선 빔으로 표현한다.
 *  - 바깥 글로우(살짝 굵은 반투명) + 안쪽 코어(아주 얇고 밝음) 두 겹
 *  - 아래로 겨누면 지면과 만나는 지점까지만 뻗어, 어디를 맞히는지(대상)가 보인다
 *  - 끝점엔 작은 임팩트 글로우
 * 손 트래킹/조준 로직은 건드리지 않고, 매 프레임 set()으로 위치만 갱신한다.
 */
export class Beam {
  readonly group = new THREE.Group();

  /** 현재 프레임 발사 여부와 빔이 지면에 닿은 착탄 지점(에너지 공급 판정용). */
  active = false;
  grounded = false;
  readonly impactPoint = new THREE.Vector3();

  private glow: THREE.Mesh;
  private core: THREE.Mesh;
  private glowMat: THREE.MeshBasicMaterial;
  private coreMat: THREE.MeshBasicMaterial;
  private impact: THREE.Sprite;

  private readonly maxLen = 45; // 먼 지평선의 곤충까지 닿도록 길게
  private readonly groundY = 0.08;

  // 재사용 벡터
  private _end = new THREE.Vector3();
  private _mid = new THREE.Vector3();
  private _q = new THREE.Quaternion();
  private static readonly AXIS = new THREE.Vector3(0, 0, 1);

  constructor(color: number) {
    // 단위 실린더(축을 +z로) — 길이/반경은 scale로 조절
    const geo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    geo.rotateX(Math.PI / 2); // 축 Y → Z

    this.glowMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });

    this.glow = new THREE.Mesh(geo, this.glowMat);
    this.core = new THREE.Mesh(geo, this.coreMat);
    this.group.add(this.glow, this.core);

    this.impact = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeImpactTexture(color),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    this.impact.scale.setScalar(0.6);
    this.group.add(this.impact);

    this.group.visible = false;
  }

  /**
   * @param active FIRE 상태 여부
   * @param start  노즐 끝 월드 좌표
   * @param dir    발사 방향(정규화)
   */
  set(active: boolean, start: THREE.Vector3, dir: THREE.Vector3): void {
    this.active = active;
    if (!active) {
      this.group.visible = false;
      this.grounded = false;
      return;
    }
    this.group.visible = true;

    // 아래로 겨누면 지면과 만나는 지점까지, 아니면 최대 길이까지
    let len = this.maxLen;
    let hitGround = false;
    if (dir.y < -0.02) {
      const t = (start.y - this.groundY) / -dir.y;
      if (t > 0 && t < this.maxLen) {
        len = t;
        hitGround = true;
      }
    }
    this.grounded = hitGround;

    this._end.copy(dir).multiplyScalar(len).add(start);
    this.impactPoint.copy(this._end);
    this._mid.copy(start).add(this._end).multiplyScalar(0.5);

    // 미세한 에너지 깜빡임
    const flick = 0.85 + Math.sin(performance.now() * 0.03) * 0.15;

    this._q.setFromUnitVectors(Beam.AXIS, dir);
    this.group.position.set(0, 0, 0);

    for (const [mesh, radius] of [
      [this.glow, 0.05],
      [this.core, 0.018],
    ] as const) {
      mesh.position.copy(this._mid);
      mesh.quaternion.copy(this._q);
      mesh.scale.set(radius * flick, radius * flick, len);
    }
    this.glowMat.opacity = 0.35 * flick;
    this.coreMat.opacity = 0.95 * flick;

    // 임팩트 글로우: 지면에 닿을 때만 끝점에 표시
    this.impact.visible = hitGround;
    if (hitGround) {
      this.impact.position.copy(this._end);
      this.impact.scale.setScalar(0.5 + Math.sin(performance.now() * 0.02) * 0.12);
    }
  }
}

/** 끝점 임팩트용 부드러운 방사형 글로우 텍스처. */
function makeImpactTexture(color: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const col = new THREE.Color(color);
  const r = (col.r * 255) | 0;
  const g = (col.g * 255) | 0;
  const b = (col.b * 255) | 0;
  const grad = ctx.createRadialGradient(32, 32, 1, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.3, `rgba(${r},${g},${b},0.85)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
