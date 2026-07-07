/**
 * 아주 가벼운 WebAudio 신스 효과음(에셋 없이 코드로 합성).
 *  - harvest(): 감자알이 돋을 때 맑은 종소리(수확할수록 음이 올라감)
 *  - win()/lose(): 승리·패배 짧은 모티프
 * 브라우저 자동재생 정책 때문에 첫 사용자 제스처 후 resume()이 필요하다.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  /** 첫 사용자 제스처(키 입력·발사 등)에서 호출 — 오디오 컨텍스트 준비/재개. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    delay = 0,
  ): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** 감자알 수확음. index가 커질수록(더 많이 수확) 반음씩 올라가 성취감을 준다. */
  harvest(index: number): void {
    this.unlock();
    const base = 523.25; // C5
    const f = base * Math.pow(2, (index % 8) / 12);
    this.tone(f, 0.28, "triangle", 0.35);
    this.tone(f * 2, 0.18, "sine", 0.15, 0.01); // 배음 살짝
  }

  win(): void {
    this.unlock();
    const seq = [523.25, 659.25, 783.99, 1046.5]; // C-E-G-C 상승
    seq.forEach((f, i) => this.tone(f, 0.5, "triangle", 0.3, i * 0.13));
  }

  lose(): void {
    this.unlock();
    const seq = [392.0, 311.13, 233.08]; // G-Eb-Bb 하강
    seq.forEach((f, i) => this.tone(f, 0.6, "sawtooth", 0.22, i * 0.18));
  }
}
