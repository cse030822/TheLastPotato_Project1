/**
 * 아주 가벼운 WebAudio 신스 효과음(에셋 없이 코드로 합성).
 *  - harvest(): 감자알이 돋을 때 맑은 종소리(수확할수록 음이 올라감)
 *  - win()/lose(): 승리·패배 짧은 모티프
 * 브라우저 자동재생 정책 때문에 첫 사용자 제스처 후 resume()이 필요하다.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  // 우주 앰비언스(지속 재생) 핸들 — 중복 시작 방지 + 페이드아웃 정지용.
  private ambience: { stop: () => void } | null = null;

  // --- 배경음악(mp3 파일) ---
  // menu: 인트로·카메라 화면(후보 2), game: 플레이 화면(후보 1). 화면 전환 때 크로스페이드.
  private menuAudio: HTMLAudioElement | null = null;
  private gameAudio: HTMLAudioElement | null = null;
  private currentMusic: "menu" | "game" | null = null;
  private readonly musicVol = 0.55; // 배경음악 최대 음량(효과음보다 은은하게)
  private fadeTimers = new WeakMap<HTMLAudioElement, number>();

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
    // 자동재생 정책으로 막혀 있던 배경음악을 이 사용자 제스처에서 재개.
    if (this.currentMusic) {
      const a = this.currentMusic === "menu" ? this.menuAudio : this.gameAudio;
      if (a && a.paused) void a.play().catch(() => {});
    }
  }

  /** 배경음악 엘리먼트 준비(최초 1회). public/ 파일이라 사이트 루트에서 서빙된다. */
  private ensureMusic(): void {
    if (!this.menuAudio) {
      this.menuAudio = new Audio(encodeURI("/후보 2.mp3"));
      this.menuAudio.loop = true;
      this.menuAudio.volume = 0;
      this.menuAudio.preload = "auto";
    }
    if (!this.gameAudio) {
      this.gameAudio = new Audio(encodeURI("/후보 1.mp3"));
      this.gameAudio.loop = true;
      this.gameAudio.volume = 0;
      this.gameAudio.preload = "auto";
    }
  }

  /** 지정 오디오의 음량을 to까지 ms 동안 선형 페이드(끝나면 0이면 정지 선택). */
  private fadeTo(a: HTMLAudioElement, to: number, ms: number, pauseAtEnd: boolean): void {
    const prev = this.fadeTimers.get(a);
    if (prev) clearInterval(prev);
    const from = a.volume;
    const steps = Math.max(1, Math.round(ms / 40));
    let i = 0;
    const id = window.setInterval(() => {
      i++;
      a.volume = Math.max(0, Math.min(1, from + (to - from) * (i / steps)));
      if (i >= steps) {
        clearInterval(id);
        this.fadeTimers.delete(a);
        if (pauseAtEnd && to === 0) a.pause();
      }
    }, 40);
    this.fadeTimers.set(a, id);
  }

  /** 배경음악 전환(menu/game/null). 현재 곡은 페이드아웃, 새 곡은 페이드인. */
  private switchMusic(which: "menu" | "game" | null): void {
    this.ensureMusic();
    if (this.currentMusic === which) return;
    this.currentMusic = which;
    const target = which === "menu" ? this.menuAudio : which === "game" ? this.gameAudio : null;
    // 대상이 아닌 곡은 모두 페이드아웃 후 정지.
    for (const a of [this.menuAudio, this.gameAudio]) {
      if (a && a !== target) this.fadeTo(a, 0, 600, true);
    }
    if (target) {
      void target.play().catch(() => {}); // 막히면 다음 unlock()에서 재개
      this.fadeTo(target, this.musicVol, 900, false);
    }
  }

  /** 인트로·카메라 화면 배경음악(후보 2). */
  playMenuMusic(): void {
    this.switchMusic("menu");
  }

  /** 플레이 화면 배경음악(후보 1). */
  playGameMusic(): void {
    this.switchMusic("game");
  }

  /** 배경음악 전체 정지(페이드아웃). */
  stopMusic(): void {
    this.switchMusic(null);
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

  /** 화이트노이즈 버스트(벌레 기척·격파 파열 등 유기적 텍스처용). */
  private noise(
    dur: number,
    gain: number,
    opts: { hp?: number; lp?: number; delay?: number } = {},
  ): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + (opts.delay ?? 0);
    const frames = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    let node: AudioNode = src;
    if (opts.hp) {
      const f = this.ctx.createBiquadFilter();
      f.type = "highpass";
      f.frequency.value = opts.hp;
      node.connect(f);
      node = f;
    }
    if (opts.lp) {
      const f = this.ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = opts.lp;
      node.connect(f);
      node = f;
    }
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    node.connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /** 주파수가 미끄러지는 톤(글라이드). 벌레 울음·격파 지익 등에. */
  private glide(
    f0: number,
    f1: number,
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
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** 곤충 출현: 낮게 지직대는 외계 벌레 울음(하강 글라이드 2연 + 사각사각 기척). */
  bugSpawn(): void {
    this.unlock();
    this.glide(210, 90, 0.16, "sawtooth", 0.16);
    this.glide(180, 80, 0.16, "sawtooth", 0.12, 0.09);
    this.noise(0.12, 0.05, { hp: 1600, lp: 5200 });
  }

  /**
   * 곤충이 감자(잎·줄기)를 씹는 소리 — 아삭아삭한 유기적 씹힘.
   * 잎이 부서지는 짧은 crunch 노이즈 2~3연타 + 촉촉한 저역 "촵" 물림.
   */
  bugBite(): void {
    this.unlock();
    if (!this.ctx || !this.master) return;
    // 아삭! 하는 crunch: 중역대 밴드로 좁힌 노이즈를 빠른 감쇠로 2~3번 톡톡.
    const crunches = 2 + (Math.random() < 0.5 ? 1 : 0);
    for (let k = 0; k < crunches; k++) {
      const delay = k * (0.045 + Math.random() * 0.03);
      const hp = 800 + Math.random() * 500; // 씹을 때마다 미세하게 달라지는 결
      this.noise(0.035 + Math.random() * 0.02, 0.06, { hp, lp: hp + 2200, delay });
    }
    // 촉촉하게 물어뜯는 저역 body("촵").
    this.glide(150, 60, 0.09, "sine", 0.09);
  }

  /** 곤충 격파: 하강 지익(zap) + 팟! 하는 노이즈 파열. */
  bugKilled(): void {
    this.unlock();
    this.glide(620, 80, 0.2, "sawtooth", 0.22);
    this.noise(0.14, 0.12, { hp: 1000 });
  }

  /** 감자 자라는 소리: 부드럽게 올라가는 생명의 shimmer(아주 조용하게, 배음 반짝). */
  grow(): void {
    this.unlock();
    this.glide(440, 660, 0.55, "sine", 0.06);
    this.glide(880, 1320, 0.5, "sine", 0.022);
  }

  /** 씨앗 심기: 씨감자가 흙에 툭 박히는 소리(둔탁한 저역 thump + 흙 뿌려지는 기척). */
  plant(): void {
    this.unlock();
    this.glide(180, 70, 0.16, "sine", 0.28); // 툭! 하강하는 흙 박힘
    this.noise(0.14, 0.05, { hp: 500, lp: 2600, delay: 0.02 }); // 흙 흩어지는 사각거림
  }

  /**
   * 빔 발사(FIRE 상승엣지에서 1회). kind로 손 색을 구분:
   *  - "energy"(오른손 시안): 위로 쏘아 올리는 맑은 에너지 지익
   *  - "defense"(왼손 붉은): 아래로 내리꽂는 공격적인 방어 지익
   */
  beamFire(kind: "energy" | "defense"): void {
    this.unlock();
    if (kind === "energy") {
      this.glide(520, 1180, 0.14, "sawtooth", 0.13); // 상승 지익
      this.tone(1760, 0.08, "sine", 0.05, 0.01); // 반짝 배음
    } else {
      this.glide(900, 200, 0.16, "sawtooth", 0.15); // 하강 지익
      this.noise(0.08, 0.05, { hp: 1200 }); // 파열 기척
    }
  }

  /**
   * 화면 이벤트 알림음(이팩트 팝업과 동시에). tone별 정서:
   *  - "life": 생명이 돋는 밝은 상승 2음
   *  - "warn": 주의를 끄는 중립 2연 비프
   *  - "danger": 긴장을 주는 낮은 경보(살짝 디튠된 2음)
   */
  event(tone: "life" | "warn" | "danger"): void {
    this.unlock();
    if (tone === "life") {
      this.tone(659.25, 0.22, "triangle", 0.22); // E5
      this.tone(987.77, 0.3, "triangle", 0.2, 0.11); // B5
    } else if (tone === "warn") {
      this.tone(587.33, 0.14, "square", 0.16); // D5
      this.tone(587.33, 0.16, "square", 0.16, 0.16);
    } else {
      this.tone(220, 0.26, "sawtooth", 0.2); // A3
      this.tone(233.08, 0.3, "sawtooth", 0.18, 0.02); // Bb3(디튠 → 불안한 맥놀이)
    }
  }

  /**
   * 우주 앰비언스 시작(지속 루프) — 배경음악 대체용 임시 분위기.
   * 깊은 저역 드론 2개를 살짝 디튠해 "웅…웅…" 맥놀이를 만들고, 아주 느린 LFO로
   * 전체 음량을 호흡시키며, 저역으로 거른 노이즈로 우주 바람 텍스처를 깐다.
   * 여러 번 불러도 한 번만 시작한다.
   */
  startAmbience(): void {
    this.unlock();
    if (!this.ctx || !this.master || this.ambience) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;

    // 앰비언스 전용 버스 — SFX 아래에 은은하게 깔리도록 페이드 인.
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t0);
    out.gain.linearRampToValueAtTime(0.14, t0 + 3.0);
    out.connect(this.master);

    const started: { stop: (t: number) => void }[] = [];
    const drone = (freq: number, gain: number, type: OscillatorType): void => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.value = gain;
      o.connect(g).connect(out);
      o.start(t0);
      started.push({ stop: (t) => o.stop(t) });
    };
    drone(55.0, 0.32, "sine"); // A1
    drone(55.45, 0.32, "sine"); // 살짝 디튠 → ~0.45Hz 맥놀이("웅…웅…")
    drone(82.41, 0.16, "triangle"); // E2 — 배음감으로 두께 추가

    // 아주 느린 LFO로 버스 음량을 은은하게 물결(우주적 호흡).
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = "sine";
    lfo.frequency.value = 0.12; // ~8초 주기
    lfoGain.gain.value = 0.05;
    lfo.connect(lfoGain).connect(out.gain);
    lfo.start(t0);
    started.push({ stop: (t) => lfo.stop(t) });

    // 우주 바람: 저역만 남긴 루프 노이즈 + 느린 필터 스윕으로 움직임.
    const frames = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = "lowpass";
    nf.frequency.value = 300;
    nf.Q.value = 1.5;
    const ng = ctx.createGain();
    ng.gain.value = 0.05;
    noise.connect(nf).connect(ng).connect(out);
    noise.start(t0);
    started.push({ stop: (t) => noise.stop(t) });

    const flfo = ctx.createOscillator();
    const flfoGain = ctx.createGain();
    flfo.type = "sine";
    flfo.frequency.value = 0.05; // ~20초 주기의 필터 스윕
    flfoGain.gain.value = 130;
    flfo.connect(flfoGain).connect(nf.frequency);
    flfo.start(t0);
    started.push({ stop: (t) => flfo.stop(t) });

    this.ambience = {
      stop: () => {
        const t = ctx.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(out.gain.value, t);
        out.gain.linearRampToValueAtTime(0.0001, t + 1.2); // 부드럽게 사라짐
        started.forEach((s) => s.stop(t + 1.3));
      },
    };
  }

  /** 우주 앰비언스 정지(페이드아웃). */
  stopAmbience(): void {
    if (!this.ambience) return;
    this.ambience.stop();
    this.ambience = null;
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
