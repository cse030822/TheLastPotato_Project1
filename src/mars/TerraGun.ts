import * as THREE from "three";
import type { HandState } from "../hands/gestures";

const _q = new THREE.Quaternion();

/**
 * 관절형 테라-건.
 *  - body: 고정 손잡이/본체
 *  - nozzle: 상하좌우로 회전하는 총구(회전 노즐)
 *  - valve/gauge: 압력 밸브·게이지 장식
 *  - tipGlow: 노즐 끝 표시등(emissive, GUN_POSE=약/FIRE=강). 광원(PointLight) 없음.
 * 손 좌표로 노즐이 조준 방향을 향하고, 손이 사라지면 정면으로 서서히 복귀한다.
 */
export class TerraGun {
  readonly root = new THREE.Group();
  private nozzle = new THREE.Group();
  private tipGlow: THREE.Mesh;
  private glowMat: THREE.MeshStandardMaterial;

  // 목표 조준각(라디안). 매 프레임 부드럽게 보간.
  private targetYaw = 0;
  private targetPitch = 0;

  constructor(accent: number) {
    const metal = new THREE.MeshStandardMaterial({
      color: 0x6b6f73,
      metalness: 0.85,
      roughness: 0.45,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x2b2d30,
      metalness: 0.7,
      roughness: 0.6,
    });
    const accentMat = new THREE.MeshStandardMaterial({
      color: accent,
      metalness: 0.5,
      roughness: 0.35,
      emissive: accent,
      emissiveIntensity: 0.15,
    });

    // 본체(손잡이 + 몸통)
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.5, 0.22), dark);
    grip.position.set(0, -0.25, 0);
    grip.rotation.x = 0.25;
    const bodyBox = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.6), metal);
    this.root.add(grip, bodyBox);

    // 압력 게이지 + 밸브(장식)
    const gauge = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.1, 0.05, 20),
      accentMat,
    );
    gauge.rotation.x = Math.PI / 2;
    gauge.position.set(0.17, 0.12, 0.05);
    const valve = new THREE.Mesh(
      new THREE.TorusGeometry(0.09, 0.03, 10, 20),
      metal,
    );
    valve.position.set(-0.18, 0.08, 0.0);
    valve.rotation.y = Math.PI / 2;
    this.root.add(gauge, valve);

    // 회전 노즐 (본체 앞쪽에 피벗)
    this.nozzle.position.set(0, 0.05, 0.3);
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.12, 0.7, 24),
      metal,
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = 0.35;
    const muzzle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.09, 0.14, 24),
      dark,
    );
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.z = 0.72;
    this.nozzle.add(barrel, muzzle);

    // 노즐 끝 발광
    this.glowMat = new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: 0,
      transparent: true,
      opacity: 0.9,
    });
    this.tipGlow = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 16, 16),
      this.glowMat,
    );
    this.tipGlow.position.z = 0.8;
    // PointLight 제거: 액체 분사에는 광원이 불필요하고, 지면을 파랗게 물들이는
    // 큰 광원처럼 보이던 문제를 없앤다. 노즐 끝은 emissive 표시등만 남긴다.
    this.nozzle.add(this.tipGlow);

    this.root.add(this.nozzle);
  }

  /** 노즐 끝 월드 좌표 (파티클 분사 지점) */
  getMuzzleWorldPosition(target = new THREE.Vector3()): THREE.Vector3 {
    return this.tipGlow.getWorldPosition(target);
  }

  /** 노즐이 겨누는 월드 방향(발사 방향). 노즐 로컬 +z가 총구 방향. */
  getMuzzleWorldDirection(target = new THREE.Vector3()): THREE.Vector3 {
    return target
      .set(0, 0, 1)
      .applyQuaternion(this.nozzle.getWorldQuaternion(_q))
      .normalize();
  }

  /**
   * 손 상태 반영.
   * @param present 손 인식 여부
   * @param screenX 화면 기준 0~1 (0 왼쪽, 1 오른쪽)
   * @param screenY 화면 기준 0~1 (0 위, 1 아래)
   * @param state  IDLE / GUN_POSE / FIRE
   */
  setHand(present: boolean, screenX: number, screenY: number, state: HandState): void {
    if (present) {
      // 화면 좌우/상하를 노즐 회전각으로 매핑
      this.targetYaw = (screenX - 0.5) * -1.0; // 좌우 ±0.5rad
      this.targetPitch = (screenY - 0.5) * -0.8; // 위로 올리면 노즐도 들림
    } else {
      // 손이 사라지면 정면 복귀
      this.targetYaw = 0;
      this.targetPitch = 0;
    }

    // 노즐 끝 표시등 세기: GUN_POSE 약, FIRE 조금 강(광원 없이 은은하게만).
    const glow =
      state === "FIRE" ? 1.0 : state === "GUN_POSE" ? 0.28 : 0.0;
    this.glowMat.emissiveIntensity = glow * 0.7;
  }

  /** 매 프레임 부드러운 보간 */
  update(dt: number): void {
    const k = 1 - Math.pow(0.001, dt); // 프레임레이트 독립 감쇠
    this.nozzle.rotation.y += (this.targetYaw - this.nozzle.rotation.y) * k;
    this.nozzle.rotation.x += (this.targetPitch - this.nozzle.rotation.x) * k;
  }
}
