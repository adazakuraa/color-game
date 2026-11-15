/**
 * PNG出力（キャンバス部分のみ、ブラウザ内で描画）
 */
import { CONFIG } from './config.js';
import { simulateCVD } from './color.js';

export function renderWorkToCanvas(work, { longSide = CONFIG.EXPORT_LONG_SIDE, background = work.background, cvd = 'none' } = {}) {
  const W = work.artboard.w, H = work.artboard.h;
  const scale = longSide / Math.max(W, H);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  if (background && background !== 'transparent') {
    ctx.fillStyle = simulateCVD(background, cvd);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  for (const s of work.shapes) {
    ctx.fillStyle = simulateCVD(s.color, cvd);
    // ピクセル境界にそろえて、隣接する四角形の間に隙間が出ないようにする
    const x0 = Math.round(s.x * scale), y0 = Math.round(s.y * scale);
    const x1 = Math.round((s.x + s.w) * scale), y1 = Math.round((s.y + s.h) * scale);
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  }
  return canvas;
}

export function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    if (canvas.toBlob) {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNGの生成に失敗しました。'))), 'image/png');
    } else {
      try {
        const data = canvas.toDataURL('image/png');
        const bin = atob(data.split(',')[1]);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        resolve(new Blob([arr], { type: 'image/png' }));
      } catch (e) { reject(e); }
    }
  });
}

export function safeFileName(name) {
  // 一部のブラウザで日本語のファイル名が無視される場合があるため、英数字のみ使用
  const ascii = String(name || '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
  const base = ascii ? `iroawase_${ascii}` : 'iroawase';
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  return `${base}_${stamp}.png`;
}

/** 作品のサムネイルSVG（保存容量を使わないよう表示時に生成） */
export function workThumbnailSVG(work) {
  const W = work.artboard.w, H = work.artboard.h;
  const bg = work.background === 'transparent' ? '' : `<rect width="${W}" height="${H}" fill="${work.background}"/>`;
  const rects = work.shapes.map((s) => `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="${s.color}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${bg}${rects}</svg>`;
}
