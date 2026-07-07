export type ScreenState = "intro" | "camera" | "playing";

interface ScreenHandlers {
  onStart: () => void; // 인트로 START → 카메라 권한 화면으로
  onBack: () => void; // 카메라 화면 "뒤로"(→ 인트로)
  onAllowCamera: () => void; // 카메라 권한 화면의 "카메라 켜고 시작하기"
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
  private state: ScreenState = "intro";

  constructor(handlers: ScreenHandlers) {
    const startA = document.getElementById("btn-start") as HTMLButtonElement;
    this.allowBtn = document.getElementById("btn-allow") as HTMLButtonElement;

    startA.addEventListener("click", handlers.onStart);
    this.allowBtn.addEventListener("click", handlers.onAllowCamera);
    document.getElementById("btn-cam-back")!.addEventListener("click", handlers.onBack);
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
