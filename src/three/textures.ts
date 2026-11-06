import * as THREE from 'three';

// Procedurally generated textures (no external downloads needed, works offline).

const cache = new Map<string, THREE.Texture>();

const rand = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

const make = (key: string, size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, srgb = true) => {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
};

const noise = (ctx: CanvasRenderingContext2D, s: number, amount: number, r: () => number) => {
  const img = ctx.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * amount;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
};

/** Timber floorboards – texture covers 1.6 m × 1.6 m. */
export const timberTexture = () =>
  make('timber', 1024, (ctx, s) => {
    const r = rand(7);
    const rows = 12; // 133 mm boards
    const rh = s / rows;
    for (let row = 0; row < rows; row++) {
      let x = -r() * s * 0.6;
      while (x < s) {
        const L = Math.min(s * (0.45 + r() * 0.5), s - x);
        const tone = 0.85 + r() * 0.25;
        const base = [168 * tone, 120 * tone, 78 * tone];
        ctx.fillStyle = `rgb(${base.map((v) => Math.min(255, v | 0)).join(',')})`;
        ctx.fillRect(x, row * rh, L, rh);
        // grain
        for (let g = 0; g < 14; g++) {
          ctx.strokeStyle = `rgba(80,50,25,${0.05 + r() * 0.12})`;
          ctx.lineWidth = 0.6 + r() * 1.4;
          ctx.beginPath();
          const y0 = row * rh + r() * rh;
          ctx.moveTo(x, y0);
          for (let k = 1; k <= 6; k++) ctx.lineTo(x + (L * k) / 6, y0 + (r() - 0.5) * 6);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(40,25,15,0.55)';
        ctx.fillRect(x, row * rh, 2, rh);
        x += L;
      }
      ctx.fillStyle = 'rgba(40,25,15,0.5)';
      ctx.fillRect(0, row * rh, s, 1.5);
    }
    noise(ctx, s, 14, r);
  });

/** Square floor tiles 300 mm with grout – texture covers 1.2 m. */
export const tileTexture = (key = 'tiles', base = [214, 212, 206], grout = 'rgb(160,158,152)', count = 4) =>
  make(key, 1024, (ctx, s) => {
    const r = rand(11);
    const n = count;
    const ts = s / n;
    ctx.fillStyle = grout;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = 0.95 + r() * 0.08;
      ctx.fillStyle = `rgb(${base.map((b) => (b * v) | 0).join(',')})`;
      ctx.fillRect(i * ts + 3, j * ts + 3, ts - 6, ts - 6);
      for (let k = 0; k < 40; k++) {
        ctx.fillStyle = `rgba(120,120,120,${r() * 0.06})`;
        ctx.beginPath();
        ctx.arc(i * ts + r() * ts, j * ts + r() * ts, 4 + r() * 20, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    noise(ctx, s, 8, r);
  });

export const wallTileTexture = () => tileTexture('walltiles', [236, 236, 232], 'rgb(200,200,196)', 8);

export const vinylTexture = () =>
  make('vinyl', 512, (ctx, s) => {
    const r = rand(5);
    ctx.fillStyle = 'rgb(196,190,178)';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 3000; i++) {
      ctx.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '90,85,80'},${r() * 0.12})`;
      ctx.fillRect(r() * s, r() * s, 1 + r() * 3, 1 + r() * 3);
    }
  });

export const carpetTexture = () =>
  make('carpet', 512, (ctx, s) => {
    const r = rand(3);
    ctx.fillStyle = 'rgb(150,140,128)';
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 40, r);
  });

export const fabricTexture = () =>
  make('fabric', 256, (ctx, s) => {
    const r = rand(9);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < s; i += 2) {
      ctx.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.03})`;
      ctx.fillRect(i, 0, 1, s);
      ctx.fillRect(0, i, s, 1);
    }
    noise(ctx, s, 10, r);
  });

export const rugTexture = () =>
  make('rug', 512, (ctx, s) => {
    const r = rand(21);
    ctx.fillStyle = '#7d8f8a';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#e8e0d0';
    ctx.lineWidth = 14;
    ctx.strokeRect(30, 30, s - 60, s - 60);
    ctx.lineWidth = 4;
    ctx.strokeRect(60, 60, s - 120, s - 120);
    ctx.fillStyle = '#c9b48f';
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
      ctx.beginPath();
      const cx = 100 + i * 62, cy = 100 + j * 62;
      ctx.moveTo(cx, cy - 14); ctx.lineTo(cx + 14, cy); ctx.lineTo(cx, cy + 14); ctx.lineTo(cx - 14, cy); ctx.fill();
    }
    noise(ctx, s, 30, r);
  });

export const woodGrain = (key = 'oak', base = [190, 150, 105]) =>
  make(key, 512, (ctx, s) => {
    const r = rand(13);
    ctx.fillStyle = `rgb(${base.join(',')})`;
    ctx.fillRect(0, 0, s, s);
    for (let g = 0; g < 70; g++) {
      ctx.strokeStyle = `rgba(90,60,30,${0.04 + r() * 0.1})`;
      ctx.lineWidth = 1 + r() * 2;
      ctx.beginPath();
      const y0 = r() * s;
      ctx.moveTo(0, y0);
      for (let k = 1; k <= 8; k++) ctx.lineTo((s * k) / 8, y0 + Math.sin(k + g) * 4 + (r() - 0.5) * 4);
      ctx.stroke();
    }
    noise(ctx, s, 10, r);
  });

export const leafTexture = () =>
  make('leaf', 256, (ctx, s) => {
    const r = rand(17);
    ctx.fillStyle = '#3d6b35';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = `rgba(${r() > 0.5 ? '120,170,90' : '25,60,25'},${r() * 0.4})`;
      ctx.beginPath();
      ctx.ellipse(r() * s, r() * s, 3 + r() * 8, 2 + r() * 4, r() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });
