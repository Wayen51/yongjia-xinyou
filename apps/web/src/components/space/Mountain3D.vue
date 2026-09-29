<template>
  <canvas ref="canvasRef" class="mountain-3d" aria-hidden="true"></canvas>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";

const canvasRef = ref<HTMLCanvasElement | null>(null);

let raf = 0;
let cleanup: (() => void) | null = null;

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Face {
  a: number;
  b: number;
  c: number;
}

function createMountain() {
  const verts: Vec3[] = [];
  const faces: Face[] = [];

  const rings = 7;
  const sectors = 10;
  const baseRadius = 1.55;
  const height = 2.35;

  const bottomCenterIdx = 0;
  verts.push({ x: 0, y: 0, z: 0 });

  const ringIndices: number[][] = [];

  for (let r = 0; r <= rings; r++) {
    const t = r / rings;
    const y = t * height;
    const ringRadius =
      baseRadius *
      (1 - Math.pow(t, 0.85)) *
      (1 + 0.06 * Math.sin(t * Math.PI));

    const ring: number[] = [];
    for (let s = 0; s < sectors; s++) {
      const theta = (s / sectors) * Math.PI * 2;
      const noise =
        0.16 * Math.sin(theta * 3 + t * 5) +
        0.12 * Math.cos(theta * 5 - t * 3) +
        0.08 * Math.sin(theta * 7 + t * 2);
      const rActual = Math.max(0.08, ringRadius + noise);

      verts.push({
        x: Math.cos(theta) * rActual,
        y,
        z: Math.sin(theta) * rActual,
      });
      ring.push(verts.length - 1);
    }
    ringIndices.push(ring);
  }

  const apexIdx = verts.length;
  verts.push({ x: 0, y: height + 0.2, z: 0 });

  // 底部圆面
  for (let s = 0; s < sectors; s++) {
    const next = (s + 1) % sectors;
    faces.push({
      a: bottomCenterIdx,
      b: ringIndices[0][next],
      c: ringIndices[0][s],
    });
  }

  // 侧面网格
  for (let r = 0; r < rings; r++) {
    const ringA = ringIndices[r];
    const ringB = ringIndices[r + 1];
    for (let s = 0; s < sectors; s++) {
      const next = (s + 1) % sectors;
      faces.push({ a: ringA[s], b: ringB[s], c: ringB[next] });
      faces.push({ a: ringA[s], b: ringB[next], c: ringA[next] });
    }
  }

  // 封顶
  const topRing = ringIndices[rings];
  for (let s = 0; s < sectors; s++) {
    const next = (s + 1) % sectors;
    faces.push({ a: apexIdx, b: topRing[next], c: topRing[s] });
  }

  return { verts, faces };
}

function rotateY(v: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: v.x * cos - v.z * sin, y: v.y, z: v.x * sin + v.z * cos };
}

function rotateX(v: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: v.x, y: v.y * cos - v.z * sin, z: v.y * sin + v.z * cos };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function project(v: Vec3, baseScale: number, cx: number, cy: number) {
  const distance = 8;
  const s = baseScale * (distance / Math.max(0.5, distance - v.z));
  return {
    x: v.x * s + cx,
    y: cy - v.y * s,
    scale: s,
    z: v.z,
  };
}

onMounted(() => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let dpr = window.devicePixelRatio || 1;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  resize();
  window.addEventListener("resize", resize);

  const { verts, faces } = createMountain();

  // 粒子：围绕山体漂浮
  const particles: Vec3[] = [];
  for (let i = 0; i < 40; i++) {
    const theta = Math.random() * Math.PI * 2;
    const r = 1.2 + Math.random() * 2.2;
    const y = 0.3 + Math.random() * 2.6;
    particles.push({
      x: Math.cos(theta) * r,
      y,
      z: Math.sin(theta) * r,
    });
  }

  const light = normalize({ x: 0.5, y: 0.85, z: 0.35 });
  let angle = 0;

  const draw = () => {
    const rect = canvas.getBoundingClientRect();
    const W = rect.width;
    const H = rect.height;
    ctx.clearRect(0, 0, W, H);

    angle += 0.0025;

    const transformed = verts.map((v) => {
      let p = rotateY(v, angle);
      p = rotateX(p, 0.1);
      return p;
    });

    // 投影参数：按 hero 高度固定山体比例，宽屏不再无限放大
    const modelHeight = 2.55;
    const baseScale = (H * 0.5) / modelHeight;
    const cx = W * 0.55;
    const cy = H * 0.62;
    const groundGlowR = Math.max(140, baseScale * 2);
    const topGlowR = Math.max(50, baseScale * 0.65);

    const projected = transformed.map((v) => project(v, baseScale, cx, cy));

    // 山体底部辉光
    ctx.save();
    ctx.translate(cx, cy + H * 0.02);
    ctx.scale(1, 0.28);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, groundGlowR);
    glow.addColorStop(0, "rgba(62, 198, 184, 0.22)");
    glow.addColorStop(0.45, "rgba(62, 198, 184, 0.06)");
    glow.addColorStop(1, "rgba(62, 198, 184, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, groundGlowR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 面片 +  painters 排序
    const renderFaces = faces
      .map((f) => {
        const a = transformed[f.a];
        const b = transformed[f.b];
        const c = transformed[f.c];
        const n = normalize(cross(sub(b, a), sub(c, a)));
        const shade = dot(n, light);
        const avgZ = (a.z + b.z + c.z) / 3;
        return { f, shade, avgZ, n };
      })
      .filter((it) => it.n.z > -0.2)
      .sort((a, b) => a.avgZ - b.avgZ);

    for (const it of renderFaces) {
      const { f, shade } = it;
      const pa = projected[f.a];
      const pb = projected[f.b];
      const pc = projected[f.c];
      if (pa.scale <= 0 || pb.scale <= 0 || pc.scale <= 0) continue;

      const base = { r: 8, g: 40, b: 52 };
      const lit = { r: 50, g: 198, b: 184 };
      const intensity = Math.max(0.06, Math.min(1, shade * 0.85 + 0.2));
      const r = Math.floor(base.r + (lit.r - base.r) * intensity);
      const g = Math.floor(base.g + (lit.g - base.g) * intensity);
      const b = Math.floor(base.b + (lit.b - base.b) * intensity);

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.58)`;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.lineTo(pc.x, pc.y);
      ctx.closePath();
      ctx.fill();
    }

    // 线框
    ctx.strokeStyle = "rgba(62, 198, 184, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const it of renderFaces) {
      const f = it.f;
      const pa = projected[f.a];
      const pb = projected[f.b];
      const pc = projected[f.c];
      if (pa.scale <= 0 || pb.scale <= 0 || pc.scale <= 0) continue;
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.lineTo(pc.x, pc.y);
      ctx.lineTo(pa.x, pa.y);
    }
    ctx.stroke();

    // 顶部高光
    const apexP = projected[verts.length - 1];
    if (apexP.scale > 0) {
      const topGlow = ctx.createRadialGradient(
        apexP.x,
        apexP.y,
        0,
        apexP.x,
        apexP.y,
        topGlowR
      );
      topGlow.addColorStop(0, "rgba(62, 198, 184, 0.32)");
      topGlow.addColorStop(1, "rgba(62, 198, 184, 0)");
      ctx.fillStyle = topGlow;
      ctx.beginPath();
      ctx.arc(apexP.x, apexP.y, topGlowR, 0, Math.PI * 2);
      ctx.fill();
    }

    // 漂浮粒子
    for (const p of particles) {
      const rp = rotateX(rotateY(p, angle), 0.1);
      if (rp.z >= 7.5) continue;
      const pp = project(rp, baseScale, cx, cy);
      if (pp.scale <= 0) continue;
      const a = 0.25 + 0.4 * Math.max(0, rp.y / 3);
      const r = 1 + (pp.scale / W) * 3;
      ctx.fillStyle = `rgba(232, 184, 75, ${a})`;
      ctx.beginPath();
      ctx.arc(pp.x, pp.y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    raf = requestAnimationFrame(draw);
  };

  draw();

  cleanup = () => {
    window.removeEventListener("resize", resize);
    cancelAnimationFrame(raf);
  };
});

onUnmounted(() => {
  cleanup?.();
});
</script>

<style scoped>
.mountain-3d {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
</style>
