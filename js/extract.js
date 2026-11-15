/**
 * 画像からの色抽出（ブラウザ内で完結。外部送信なし）
 * k-means++ を CIELAB 空間で実行し、代表色を求める。
 */
import { rgbToLab, rgbToHex, colorDifference } from './color.js';

/** 乱数を固定し、同じ画像からは同じ結果になるようにする */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** File → HTMLImageElement（読み込み失敗時は分かりやすいエラー） */
export function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('画像が選択されていません。')); return; }
    if (file.type && !file.type.startsWith('image/')) { reject(new Error('画像ファイルを選択してください。')); return; }
    if (file.size > 60 * 1024 * 1024) { reject(new Error('画像サイズが大きすぎます（60MBまで）。')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    const timer = setTimeout(() => { cleanup(); reject(new Error('画像の読み込みがタイムアウトしました。')); }, 20000);
    const cleanup = () => { clearTimeout(timer); };
    img.onload = () => { cleanup(); resolve({ img, url }); };
    img.onerror = () => { cleanup(); URL.revokeObjectURL(url); reject(new Error('画像を読み込めませんでした。対応していない形式か、ファイルが破損している可能性があります。')); };
    img.decoding = 'async';
    img.src = url;
  });
}

/** 画像を縮小してピクセル配列を取得 */
export function imageToPixels(img, maxSide = 160) {
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  if (!w0 || !h0) throw new Error('画像のサイズを取得できませんでした。');
  const scale = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

/**
 * RGBA配列から代表色を抽出
 * @returns {{hex: string, ratio: number}[]} 面積の大きい順
 */
export function extractPalette(data, k = 5, seed = 7) {
  const pts = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const rgb = { r: data[i], g: data[i + 1], b: data[i + 2] };
    const lab = rgbToLab(rgb);
    pts.push({ L: lab.L, a: lab.a, b: lab.b, r: rgb.r, g: rgb.g, bl: rgb.b });
  }
  if (!pts.length) return [];
  const rand = mulberry32(seed);
  const d2 = (p, c) => (p.L - c.L) ** 2 + (p.a - c.a) ** 2 + (p.b - c.b) ** 2;

  // k-means++ 初期化
  const centers = [{ ...pts[Math.floor(rand() * pts.length)] }];
  const dist = new Float64Array(pts.length).fill(Infinity);
  while (centers.length < k) {
    let sum = 0;
    const last = centers[centers.length - 1];
    for (let i = 0; i < pts.length; i++) {
      dist[i] = Math.min(dist[i], d2(pts[i], last));
      sum += dist[i];
    }
    if (sum === 0) break; // 異なる色がもうない
    let r = rand() * sum, idx = 0;
    for (; idx < pts.length - 1; idx++) { r -= dist[idx]; if (r <= 0) break; }
    centers.push({ ...pts[idx] });
  }

  const assign = new Int32Array(pts.length);
  for (let iter = 0; iter < 16; iter++) {
    let moved = 0;
    for (let i = 0; i < pts.length; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = d2(pts[i], centers[c]);
        if (d < bd) { bd = d; best = c; }
      }
      if (assign[i] !== best) { assign[i] = best; moved++; }
    }
    const acc = centers.map(() => ({ L: 0, a: 0, b: 0, n: 0 }));
    for (let i = 0; i < pts.length; i++) {
      const s = acc[assign[i]], p = pts[i];
      s.L += p.L; s.a += p.a; s.b += p.b; s.n++;
    }
    acc.forEach((s, c) => { if (s.n) { centers[c].L = s.L / s.n; centers[c].a = s.a / s.n; centers[c].b = s.b / s.n; } });
    if (iter > 0 && moved === 0) break;
  }

  // 代表色：クラスタの平均RGB
  const sums = centers.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
  for (let i = 0; i < pts.length; i++) {
    const s = sums[assign[i]], p = pts[i];
    s.r += p.r; s.g += p.g; s.b += p.bl; s.n++;
  }
  let result = sums.filter((s) => s.n > 0).map((s) => ({
    hex: rgbToHex({ r: s.r / s.n, g: s.g / s.n, b: s.b / s.n }),
    ratio: s.n / pts.length,
  }));
  // ほぼ同じ色は統合
  const merged = [];
  for (const c of result.sort((a, b) => b.ratio - a.ratio)) {
    const same = merged.find((m) => colorDifference(m.hex, c.hex) < 3);
    if (same) same.ratio += c.ratio; else merged.push({ ...c });
  }
  result = merged.sort((a, b) => b.ratio - a.ratio);
  return result;
}

/**
 * スポイト用のサンプラー
 * 画像を最大 maxSide px の作業用キャンバスに描き、指定位置の色を取得する。
 * nx, ny は画像内の相対位置（0〜1）。radius 内の平均色を返す（ノイズ対策）。
 */
export function createSampler(img, maxSide = 1600) {
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  if (!w0 || !h0) throw new Error('画像のサイズを取得できませんでした。');
  const scale = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale)), h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const toPx = (nx, ny) => ({ x: Math.min(w - 1, Math.max(0, Math.floor(nx * w))), y: Math.min(h - 1, Math.max(0, Math.floor(ny * h))) });
  return {
    canvas, width: w, height: h,
    toPx,
    /** @returns {string|null} 透明部分は null */
    sample(nx, ny, radius = 1) {
      const p = toPx(nx, ny);
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = p.y - radius; y <= p.y + radius; y++) {
        for (let x = p.x - radius; x <= p.x + radius; x++) {
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const i = (y * w + x) * 4;
          if (data[i + 3] < 128) continue;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
      }
      return n ? rgbToHex({ r: r / n, g: g / n, b: b / n }) : null;
    },
  };
}
