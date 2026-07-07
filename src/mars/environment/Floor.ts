import * as THREE from "three";
import { makeRng } from "./noise";

/**
 * 화단 주변 전경의 금 간 석판 바닥.
 * 콘셉트 아트처럼 흙바닥이 아니라, 균열이 간 포장 석판 위에 화분이 놓인 느낌.
 * 절차적 캔버스 텍스처(석판 얼룩 + 이음새 + 균열)를 입힌 얇은 슬래브.
 */
export function createCrackedFloor(): THREE.Group {
  const group = new THREE.Group();

  const tex = makeStoneTexture();
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(15, 0.14, 11),
    new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.95,
      metalness: 0,
    }),
  );
  // 화단(중심 0,-3) 아래에 얕게 깔고, 윗면이 지면 살짝 위로 오게
  slab.position.set(0, 0.02, -3.2);
  slab.receiveShadow = true;
  slab.castShadow = false;
  group.add(slab);

  return group;
}

/** 금 간 석판 바닥용 절차적 텍스처. */
function makeStoneTexture(): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const rng = makeRng(7788);

  // 바탕: 햇빛 받는 밝은 회갈색 석재(콘셉트 아트의 밝은 포장 바닥)
  ctx.fillStyle = "#93785a";
  ctx.fillRect(0, 0, S, S);

  // 석재 얼룩(밝기·색 편차)
  for (let i = 0; i < 380; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 6 + rng() * 34;
    const shade = 110 + rng() * 70;
    ctx.fillStyle = `rgba(${shade | 0},${(shade * 0.83) | 0},${(shade * 0.66) | 0},0.16)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 큰 석판 이음새(불규칙 격자) — 두껍고 어두운 홈
  ctx.strokeStyle = "rgba(24,16,11,0.85)";
  ctx.lineWidth = 5;
  const seams = [0.33, 0.66];
  for (const t of seams) {
    // 세로 이음새(구불)
    ctx.beginPath();
    ctx.moveTo(t * S + (rng() - 0.5) * 20, 0);
    for (let y = 0; y <= S; y += 32) {
      ctx.lineTo(t * S + (rng() - 0.5) * 26, y);
    }
    ctx.stroke();
    // 가로 이음새
    ctx.beginPath();
    ctx.moveTo(0, t * S + (rng() - 0.5) * 20);
    for (let x = 0; x <= S; x += 32) {
      ctx.lineTo(x, t * S + (rng() - 0.5) * 26);
    }
    ctx.stroke();
  }

  // 가는 균열(가지치며 뻗는 잔금)
  ctx.strokeStyle = "rgba(15,10,7,0.7)";
  for (let i = 0; i < 46; i++) {
    let x = rng() * S;
    let y = rng() * S;
    let ang = rng() * Math.PI * 2;
    ctx.lineWidth = 0.8 + rng() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = 3 + ((rng() * 5) | 0);
    for (let s = 0; s < segs; s++) {
      ang += (rng() - 0.5) * 1.1;
      x += Math.cos(ang) * (10 + rng() * 30);
      y += Math.sin(ang) * (10 + rng() * 30);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1.4, 1.0);
  t.anisotropy = 4;
  return t;
}
