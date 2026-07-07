import * as THREE from "three";
import { fbm } from "./noise";

/**
 * 화성 하늘 + 천체.
 *  - 그라데이션 스카이돔: 지평선 살구빛 → 위쪽 자줏빛 암적색
 *  - 작고 흐릿한 저위도 태양(긴 그림자를 만드는 광원 방향과 일치)
 *  - 두 위성 포보스·데이모스(대사 없이 "여긴 화성" 각인)
 *  - 지평선의 각진 산/화산 실루엣
 * update()에서 위성이 아주 느리게 흐른다.
 */
export class Sky {
  readonly group = new THREE.Group();
  /** 태양 방향(정규화). 콘셉트 아트처럼 오른쪽에서 낮게 들어온다. DirectionalLight도 이 방향. */
  readonly sunDirection = new THREE.Vector3(0.62, 0.3, -0.72).normalize();

  private phobos: THREE.Sprite;
  private deimos: THREE.Sprite;
  private moonAngle = 0;

  private static readonly SKY_RADIUS = 500;

  constructor() {
    this.group.add(this.buildSkyDome());
    this.group.add(this.buildStars());
    this.group.add(this.buildSun());
    // 위성: 스펙의 회백색(#CCBBAA) 위성을 상단 우측 높이 배치(deimos = 주 위성).
    // 두 번째(phobos)는 더 작고 흐리게 남겨 "여긴 화성"의 두 위성 각인을 유지.
    this.deimos = this.buildMoon(1.5, 0xccbbaa);
    this.phobos = this.buildMoon(0.7, 0xb3a596);
    this.group.add(this.deimos, this.phobos);
    this.group.add(this.buildMountains());
  }

  /**
   * ShaderMaterial 그라데이션 스카이돔(반경 500, BackSide).
   * 지평선(#C4622D) → 중간(#7A2E1A) → 상단(#0D0508).
   * 캔버스 텍스처보다 이음새·밴딩 없이 매끄럽고, 색을 균일하게 제어할 수 있다.
   */
  private buildSkyDome(): THREE.Mesh {
    const R = Sky.SKY_RADIUS;
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        // THREE.Color는 sRGB 입력을 선형 작업공간으로 변환해 보관 → 셰이더는 선형 출력.
        // 콘셉트 아트 기준: 따뜻한 주황 하늘(검정 아님) + 오른쪽 태양 글로우.
        cHorizon: { value: new THREE.Color(0xdb8b4e) }, // 지평선 밝은 주황
        cMid: { value: new THREE.Color(0x9c4526) }, // 중간 따뜻한 적갈
        cTop: { value: new THREE.Color(0x3a1712) }, // 상단 어두운 적갈(검정 아님)
        sunColor: { value: new THREE.Color(0xffe0a8) },
        sunDir: { value: this.sunDirection },
        radius: { value: R },
      },
      vertexShader: /* glsl */ `
        varying float vY;
        varying vec3 vDir;
        void main() {
          vY = position.y;
          vDir = normalize(position); // 스카이돔은 원점 중심 → 정점 방향 = 하늘 방향
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 cHorizon;
        uniform vec3 cMid;
        uniform vec3 cTop;
        uniform vec3 sunColor;
        uniform vec3 sunDir;
        uniform float radius;
        varying float vY;
        varying vec3 vDir;
        void main() {
          float h = clamp(vY / radius, -1.0, 1.0);
          float up = clamp(h, 0.0, 1.0);
          vec3 col = mix(cHorizon, cMid, smoothstep(0.0, 0.30, up));
          col = mix(col, cTop, smoothstep(0.22, 0.75, up));
          // 지평선 아래는 살짝 어둡게 가라앉힘
          col = mix(col, cHorizon * 0.55, smoothstep(0.0, -0.25, h));
          // 태양 방향 글로우: 좁은 코어 + 넓은 헤일로
          float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          col += sunColor * (pow(s, 8.0) * 0.7 + pow(s, 2.0) * 0.14);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    return new THREE.Mesh(new THREE.SphereGeometry(R, 48, 24), mat);
  }

  /** 상단 하늘에 작은 별 200개(어두운 천정에서만 보임). */
  private buildStars(): THREE.Points {
    const count = 200;
    const R = Sky.SKY_RADIUS * 0.94;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // 상반구에 분포(고도각을 위쪽으로 편향)
      const u = Math.random();
      const theta = Math.acos(0.15 + u * 0.85); // 천정 쪽으로 치우침
      const phi = Math.random() * Math.PI * 2;
      positions[i * 3] = R * Math.sin(theta) * Math.cos(phi);
      positions[i * 3 + 1] = R * Math.cos(theta);
      positions[i * 3 + 2] = R * Math.sin(theta) * Math.sin(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xcfc8bf,
      size: 1.4,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      fog: false,
    });
    const stars = new THREE.Points(geo, mat);
    stars.frustumCulled = false;
    return stars;
  }

  /** 작고 흐릿한 태양(부드러운 헤일로). */
  private buildSun(): THREE.Group {
    const g = new THREE.Group();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0.0, "rgba(255, 236, 205, 1)");
    grad.addColorStop(0.25, "rgba(255, 205, 150, 0.85)");
    grad.addColorStop(0.55, "rgba(214, 130, 80, 0.35)");
    grad.addColorStop(1.0, "rgba(180, 90, 60, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(canvas);

    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    // 태양은 광원 방향(sunDirection) 하늘 위에 배치. 지구보다 작게.
    const dist = 260;
    sprite.position.copy(this.sunDirection).multiplyScalar(dist);
    sprite.scale.setScalar(46);
    g.add(sprite);
    return g;
  }

  private buildMoon(size: number, color: number): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    // 살짝 명암이 있는 작은 원반(감자 모양 위성 느낌으로 약간 비대칭).
    const grad = ctx.createRadialGradient(26, 24, 2, 32, 32, 30);
    const c = new THREE.Color(color);
    grad.addColorStop(0, `rgba(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0},0.95)`);
    grad.addColorStop(0.7, `rgba(${(c.r * 160) | 0},${(c.g * 150) | 0},${(c.b * 140) | 0},0.75)`);
    grad.addColorStop(1, "rgba(60,45,40,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(32, 32, 30, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        opacity: 0.85,
        fog: false,
      }),
    );
    sprite.scale.setScalar(size * 10);
    return sprite;
  }

  /** 지평선을 두르는 각진 산·화산 실루엣(먼 후경). */
  private buildMountains(): THREE.Mesh {
    const radius = 240;
    const segments = 96;
    const height = 55;
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    // 검은 하늘을 배경으로 한 어두운 실루엣(사실적인 원경 능선).
    const baseColor = new THREE.Color(0x140a06);
    const tipColor = new THREE.Color(0x33180f);

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const ang = t * Math.PI * 2;
      const x = Math.cos(ang) * radius;
      const z = Math.sin(ang) * radius;
      // 봉우리 높이를 노이즈로 들쭉날쭉하게.
      const n = fbm(t * 7.3, 0.5, 4, 21);
      const spike = fbm(t * 23.0, 3.1, 2, 55);
      const h = height * (0.25 + n * 0.75) * (0.7 + spike * 0.5);

      // 밑변 정점
      positions.push(x, -6, z);
      colors.push(baseColor.r, baseColor.g, baseColor.b);
      // 봉우리 정점
      positions.push(x, h, z);
      const cc = baseColor.clone().lerp(tipColor, 0.3 + spike * 0.5);
      colors.push(cc.r, cc.g, cc.b);
    }
    for (let i = 0; i < segments; i++) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = (i + 1) * 2;
      const d = (i + 1) * 2 + 1;
      // 안쪽(카메라)을 향하도록 감김 방향 지정
      indices.push(a, c, b, b, c, d);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    return new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.BackSide,
        // 하늘 너머 실루엣이라 안개에 완전히 먹히지 않도록 fog 제외
        fog: false,
      }),
    );
  }

  update(dt: number): void {
    // 위성은 눈치채기 힘들 만큼 아주 느리게 하늘을 가로지른다.
    this.moonAngle += dt * 0.01;
    const r = 200;
    this.phobos.position.set(
      Math.cos(this.moonAngle + 1.2) * r * 0.6,
      120 + Math.sin(this.moonAngle * 0.7) * 8,
      Math.sin(this.moonAngle + 1.2) * r,
    );
    this.deimos.position.set(
      Math.cos(this.moonAngle * 0.6 + 3.0) * r,
      150,
      Math.sin(this.moonAngle * 0.6 + 3.0) * r * 0.7,
    );
  }
}
