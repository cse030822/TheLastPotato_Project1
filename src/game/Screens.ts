export type ScreenState = "intro" | "camera" | "playing" | "practice";

interface ScreenHandlers {
  onStart: () => void; // 인트로 START → 카메라 권한 화면으로
  onBack: () => void; // 카메라 화면 "뒤로"(→ 인트로)
  onAllowCamera: () => void; // 카메라 권한 화면의 "카메라 켜고 시작하기"
  onRefreshCameras: () => void; // "카메라 찾기"(권한 허용 후 목록 채우기)
  onPractice: () => void; // "먼저 연습하기"(→ 연습 모드)
}

/**
 * 인트로 → 카메라 권한 → 플레이 화면 전환과 버튼, 로딩/에러 상태 표시를 관리한다.
 * (플레이 방법은 게임 중 도움말 오버레이로 분리되어 main에서 직접 다룬다.)
 * 화면 뒤에는 화성 3D 씬이 배경으로 계속 렌더된다(main의 루프가 담당).
 */
export class Screens {
  private intro = document.getElementById("intro-screen")!;
  private camera = document.getElementById("camera-screen")!;
  private introStatus = document.getElementById("intro-status")!;
  private cameraStatus = document.getElementById("camera-status")!;
  private allowBtn: HTMLButtonElement;
  private refreshBtn: HTMLButtonElement;
  private cameraSelect: HTMLSelectElement;
  private state: ScreenState = "intro";

  constructor(handlers: ScreenHandlers) {
    const startA = document.getElementById("btn-start") as HTMLButtonElement;
    this.allowBtn = document.getElementById("btn-allow") as HTMLButtonElement;
    this.refreshBtn = document.getElementById("btn-cam-refresh") as HTMLButtonElement;
    this.cameraSelect = document.getElementById("camera-select") as HTMLSelectElement;

    startA.addEventListener("click", handlers.onStart);
    this.allowBtn.addEventListener("click", handlers.onAllowCamera);
    this.refreshBtn.addEventListener("click", handlers.onRefreshCameras);
    document.getElementById("btn-cam-back")!.addEventListener("click", handlers.onBack);
    document.getElementById("btn-practice")!.addEventListener("click", handlers.onPractice);
  }

  /** 현재 선택된 카메라 deviceId(빈 문자열이면 기본 카메라). */
  get selectedCameraId(): string {
    return this.cameraSelect.value;
  }

  /** "카메라 찾기" 버튼 비활성/활성(로딩 중 중복 클릭 방지). */
  setRefreshBusy(busy: boolean): void {
    this.refreshBtn.disabled = busy;
  }

  /** 카메라 목록으로 선택 상자를 채운다(이전 선택은 가능하면 유지). */
  setCameras(devices: MediaDeviceInfo[]): void {
    const sel = this.cameraSelect;
    const prev = sel.value;
    sel.textContent = "";
    const def = document.createElement("option");
    def.value = "";
    def.textContent = "기본 카메라 (자동)";
    sel.appendChild(def);
    devices.forEach((d, i) => {
      const o = document.createElement("option");
      o.value = d.deviceId;
      o.textContent = d.label || `카메라 ${i + 1}`;
      sel.appendChild(o);
    });
    if (Array.from(sel.options).some((o) => o.value === prev)) sel.value = prev;
  }

  get current(): ScreenState {
    return this.state;
  }

  /** 지정 화면으로 전환(body[data-screen] + 오버레이 visible 클래스). */
  show(state: ScreenState): void {
    this.state = state;
    document.body.dataset.screen = state;
    this.intro.classList.toggle("visible", state === "intro");
    this.camera.classList.toggle("visible", state === "camera");
  }

  /** 카메라 허용 버튼 비활성/활성(웹캠 로딩 중 중복 클릭 방지). */
  setBusy(busy: boolean): void {
    this.allowBtn.disabled = busy;
  }

  /** 현재 화면의 상태 텍스트(로딩/에러) 표시. 다른 화면의 텍스트는 비운다. */
  setStatus(msg: string, kind: "" | "loading" | "error" = ""): void {
    const el = this.state === "camera" ? this.cameraStatus : this.introStatus;
    const other = this.state === "camera" ? this.introStatus : this.cameraStatus;
    other.textContent = "";
    other.className = "screen-status";
    el.textContent = msg;
    el.className = "screen-status" + (kind ? ` ${kind}` : "");
  }
}
