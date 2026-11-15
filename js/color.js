/**
 * 色の変換・計算ユーティリティ（DOM非依存・単体テスト可能）
 */
import { COLOR_NAMES } from './colornames.js';
import { CONFIG } from './config.js';

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/* ---------- 基本変換 ---------- */

export function normalizeHex(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) s = s.split('').map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/.test(s) ? `#${s}` : null;
}

export function hexToRgb(hex) {
  const h = normalizeHex(hex);
  if (!h) return null;
  const n = parseInt(h.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}

/** RGB(0-255) → HSV (h:0-360, s:0-1, v:0-1) */
export function rgbToHsv({ r, g, b }) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** HSV → RGB(0-255, 整数) */
export function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 1); v = clamp(v, 0, 1);
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

export const hsvToHex = (h, s, v) => rgbToHex(hsvToRgb(h, s, v));

/** 色相環で選んだ色相から色を生成（彩度・明度は CONFIG の定数） */
export const wheelColor = (hue) => hsvToHex(hue, CONFIG.WHEEL_SATURATION, CONFIG.WHEEL_VALUE);

/* ---------- 輝度・コントラスト (WCAG 2.x) ---------- */

export function srgbToLinear(c8) {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(v) {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return clamp(Math.round(c * 255), 0, 255);
}

/** WCAG 2.x 相対輝度 (0〜1) */
export function relativeLuminance(color) {
  const rgb = typeof color === 'string' ? hexToRgb(color) : color;
  if (!rgb) return 0;
  return 0.2126 * srgbToLinear(rgb.r) + 0.7152 * srgbToLinear(rgb.g) + 0.0722 * srgbToLinear(rgb.b);
}

/** WCAG 2.x コントラスト比 (1〜21) */
export function contrastRatio(a, b) {
  const l1 = relativeLuminance(a), l2 = relativeLuminance(b);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** 表示用：基準の判定と矛盾しないよう切り捨てで小数2桁 */
export const formatRatio = (r) => (Math.floor(r * 100) / 100).toFixed(2);

/** WCAG 2.x の基準値との比較 */
export function wcagLevels(ratio) {
  return {
    normalAA: ratio >= 4.5,
    normalAAA: ratio >= 7,
    largeAA: ratio >= 3,
    largeAAA: ratio >= 4.5,
    nonText: ratio >= 3,
  };
}

/* ---------- CIELAB / 色差 ---------- */

export function rgbToLab(color) {
  const rgb = typeof color === 'string' ? hexToRgb(color) : color;
  const R = srgbToLinear(rgb.r), G = srgbToLinear(rgb.g), B = srgbToLinear(rgb.b);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const e = 216 / 24389, k = 24389 / 27;
  const f = (t) => (t > e ? Math.cbrt(t) : (k * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export const labChroma = (lab) => Math.hypot(lab.a, lab.b);

/** CIEDE2000 色差 */
export function deltaE2000(l1, l2) {
  const rad = Math.PI / 180;
  const { L: L1, a: a1, b: b1 } = l1;
  const { L: L2, a: a2, b: b2 } = l2;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const Cb7 = Cb ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hp = (b, a) => {
    if (a === 0 && b === 0) return 0;
    const x = Math.atan2(b, a) / rad;
    return x < 0 ? x + 360 : x;
  };
  const h1p = hp(b1, a1p), h2p = hp(b2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp;
  if (C1p * C2p === 0) hbp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
  else hbp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad)
    + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Cbp7 = Cbp ** 7;
  const RC = 2 * Math.sqrt(Cbp7 / (Cbp7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(2 * dTheta * rad) * RC;
  return Math.sqrt((dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH));
}

export const colorDifference = (hexA, hexB) => deltaE2000(rgbToLab(hexA), rgbToLab(hexB));

/* ---------- 色名 ---------- */

const NAME_TABLE = COLOR_NAMES.map(([name, reading, hex]) => ({ name, reading, hex, lab: rgbToLab(hex) }));

export function nearestColorName(hex) {
  const lab = rgbToLab(hex);
  let best = null, bestD = Infinity;
  for (const entry of NAME_TABLE) {
    const d = deltaE2000(lab, entry.lab);
    if (d < bestD) { bestD = d; best = entry; }
  }
  return { name: best.name, reading: best.reading, hex: best.hex, deltaE: bestD, exact: bestD < CONFIG.NAME_APPROX_THRESHOLD };
}

/* ---------- 色の分類 ---------- */

export const HUE_FAMILIES = [
  { key: 'red', label: '赤', from: 345, to: 15 },
  { key: 'orange', label: '黄赤', from: 15, to: 45 },
  { key: 'yellow', label: '黄', from: 45, to: 70 },
  { key: 'yellowGreen', label: '黄緑', from: 70, to: 100 },
  { key: 'green', label: '緑', from: 100, to: 150 },
  { key: 'blueGreen', label: '青緑', from: 150, to: 190 },
  { key: 'blue', label: '青', from: 190, to: 245 },
  { key: 'blueViolet', label: '青紫', from: 245, to: 270 },
  { key: 'purple', label: '紫', from: 270, to: 300 },
  { key: 'redPurple', label: '赤紫', from: 300, to: 345 },
];

export function hueFamily(h) {
  h = ((h % 360) + 360) % 360;
  for (const f of HUE_FAMILIES) {
    if (f.from > f.to ? (h >= f.from || h < f.to) : (h >= f.from && h < f.to)) return f;
  }
  return HUE_FAMILIES[0];
}

/** 色相差 (0〜180) */
export function hueDistance(a, b) {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/** 符号付き色相差 (-180〜180)：b から見た a の位置 */
export function hueDelta(a, b) {
  let d = (((a - b) % 360) + 360) % 360;
  if (d > 180) d -= 360;
  return d;
}

export function isAchromatic(hex) {
  const rgb = hexToRgb(hex);
  const hsv = rgbToHsv(rgb);
  const C = labChroma(rgbToLab(rgb));
  return C < 6 || hsv.s < 0.08 || hsv.v < 0.06;
}

/** トーン（PCCSトーンを参考にした簡易分類） */
export const TONES = {
  vivid: { label: 'あざやかな', keywords: ['活発', '派手', 'エネルギッシュ'] },
  bright: { label: '明るい', keywords: ['陽気', '健康的', '華やか'] },
  light: { label: '浅い', keywords: ['爽やか', '軽やか', '若々しい'] },
  pale: { label: '薄い', keywords: ['やさしい', '繊細', '軽やか'] },
  strong: { label: '強い', keywords: ['力強い', '情熱的', '動的'] },
  soft: { label: 'やわらかい', keywords: ['穏やか', 'ナチュラル', '親しみ'] },
  lightGrayish: { label: '明るい灰みの', keywords: ['上品', '落ち着いた', 'シック'] },
  deep: { label: '濃い', keywords: ['深み', '伝統的', '充実'] },
  dull: { label: 'くすんだ', keywords: ['渋い', '落ち着いた', '大人っぽい'] },
  grayish: { label: '灰みの', keywords: ['地味', '都会的', '控えめ'] },
  dark: { label: '暗い', keywords: ['重厚', '堅実', '円熟'] },
  darkGrayish: { label: '暗い灰みの', keywords: ['重い', '渋い', '静か'] },
  veryDark: { label: 'ごく暗い', keywords: ['重厚', '格調', '厳か'] },
};

export function toneOf(hsv) {
  const { s, v } = hsv;
  if (v >= 0.8) return s >= 0.75 ? 'vivid' : s >= 0.5 ? 'bright' : s >= 0.28 ? 'light' : 'pale';
  if (v >= 0.6) return s >= 0.7 ? 'strong' : s >= 0.4 ? 'soft' : 'lightGrayish';
  if (v >= 0.38) return s >= 0.6 ? 'deep' : s >= 0.3 ? 'dull' : 'grayish';
  if (v >= 0.18) return s >= 0.3 ? 'dark' : 'darkGrayish';
  return 'veryDark';
}

function achromaticName(L) {
  if (L >= 92) return '白';
  if (L >= 70) return '明るい灰色';
  if (L >= 45) return '灰色';
  if (L >= 20) return '暗い灰色';
  return '黒';
}

/** 暖色・寒色・中性色（色彩教育で一般的な分類） */
export function temperatureOf(h, achromatic) {
  if (achromatic) return { key: 'achromatic', label: '無彩色' };
  h = ((h % 360) + 360) % 360;
  if (h >= 330 || h < 70) return { key: 'warm', label: '暖色' };
  if (h >= 160 && h < 260) return { key: 'cool', label: '寒色' };
  return { key: 'neutral', label: '中性色' };
}

const FAMILY_IMAGES = {
  red: ['情熱', '活力', '興奮', '注目'],
  orange: ['陽気', '親しみ', '元気', '温かさ'],
  yellow: ['明るさ', '希望', '軽快', '注意喚起'],
  yellowGreen: ['若々しさ', '新鮮', '成長'],
  green: ['自然', '安らぎ', '調和', '安心'],
  blueGreen: ['清涼', '爽快', '知的'],
  blue: ['冷静', '誠実', '信頼', '爽やか'],
  blueViolet: ['神秘', '静寂', '深遠'],
  purple: ['高貴', '優雅', '神秘'],
  redPurple: ['華やか', '艶やか', '個性的'],
};
const ACHRO_IMAGES = {
  '白': ['清潔', '純粋', '簡潔'],
  '明るい灰色': ['穏やか', '控えめ', '洗練'],
  '灰色': ['中立', '控えめ', '都会的'],
  '暗い灰色': ['落ち着き', '堅実', 'モダン'],
  '黒': ['重厚', '高級', '力強さ', '格式'],
};

/**
 * 色の総合的な情報。
 * - theory: 色彩学上の客観的な指標・分類
 * - visual: 一般に知られる視覚的な傾向（見え方の個人差・条件差あり）
 * - images: 一般的な連想イメージ（文化・個人差が大きく、科学的に確定したものではない）
 */
export function describeColor(hex) {
  const norm = normalizeHex(hex) || '#000000';
  const rgb = hexToRgb(norm);
  const hsv = rgbToHsv(rgb);
  const lab = rgbToLab(rgb);
  const chroma = labChroma(lab);
  const achro = isAchromatic(norm);
  const family = achro ? null : hueFamily(hsv.h);
  const toneKey = achro ? null : toneOf(hsv);
  const tone = toneKey ? TONES[toneKey] : null;
  const systematic = achro ? achromaticName(lab.L) : `${tone.label}${family.label}`;
  const temp = temperatureOf(hsv.h, achro);
  const name = nearestColorName(norm);
  const L = lab.L;

  const visual = [];
  if (L >= 70) visual.push({ label: '膨張色寄り', text: '明るい色は実際より大きく、軽く見えやすい傾向があります。' });
  else if (L <= 35) visual.push({ label: '収縮色寄り', text: '暗い色は引き締まって小さく、重く見えやすい傾向があります。' });
  else visual.push({ label: '中明度', text: '大きさ・重さの印象への影響は比較的中立的です。' });
  if (!achro && temp.key === 'warm' && chroma > 40) visual.push({ label: '進出色寄り', text: '暖色系の鮮やかな色は手前に迫って見えやすいとされます（効果の大きさは条件により異なります）。' });
  if (!achro && temp.key === 'cool') visual.push({ label: '後退色寄り', text: '寒色系の色は奥に退いて見えやすいとされます（効果の大きさは条件により異なります）。' });

  let images;
  if (achro) images = ACHRO_IMAGES[systematic] || [];
  else images = [...FAMILY_IMAGES[family.key].slice(0, 3), ...tone.keywords.slice(0, 2)];
  images = [...new Set(images)];

  const lightnessLabel = L >= 80 ? '高明度' : L >= 55 ? 'やや高明度' : L >= 35 ? '中明度' : L >= 18 ? '低明度' : 'ごく低明度';
  const chromaLabel = achro ? '無彩色' : chroma >= 70 ? '高彩度' : chroma >= 40 ? '中彩度' : '低彩度';

  return {
    hex: norm, rgb, hsv, lab, chroma, achromatic: achro,
    family, toneKey, tone, systematic, temperature: temp, name,
    lightnessLabel, chromaLabel, visual, images,
    luminance: relativeLuminance(rgb),
    onWhite: contrastRatio(norm, '#ffffff'),
    onBlack: contrastRatio(norm, '#000000'),
  };
}

/** 文字色として黒・白のどちらが読みやすいか（コントラスト比の大きい方） */
export const readableTextColor = (hex) => (contrastRatio(hex, '#000000') >= contrastRatio(hex, '#ffffff') ? '#000000' : '#ffffff');

/* ---------- 色覚シミュレーション (Machado et al. 2009, severity 1.0) ---------- */

export const CVD_TYPES = {
  none: { label: '通常', short: '通常', note: '' },
  protan: { label: 'P型（1型）色覚', short: 'P型', note: '赤の感度に関わる錐体が働かない場合の近似' },
  deutan: { label: 'D型（2型）色覚', short: 'D型', note: '緑の感度に関わる錐体が働かない場合の近似' },
  tritan: { label: 'T型（3型）色覚', short: 'T型', note: '青の感度に関わる錐体が働かない場合の近似' },
  achroma: { label: '1色覚（全色盲）', short: '1色覚', note: '明暗のみで見える場合の近似' },
};

const CVD_MATRICES = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

export function simulateCVD(hex, type) {
  if (!type || type === 'none') return normalizeHex(hex);
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const r = srgbToLinear(rgb.r), g = srgbToLinear(rgb.g), b = srgbToLinear(rgb.b);
  if (type === 'achroma') {
    const y = linearToSrgb(0.2126 * r + 0.7152 * g + 0.0722 * b);
    return rgbToHex({ r: y, g: y, b: y });
  }
  const m = CVD_MATRICES[type];
  if (!m) return normalizeHex(hex);
  const c = (v) => clamp(v, 0, 1);
  return rgbToHex({
    r: linearToSrgb(c(m[0] * r + m[1] * g + m[2] * b)),
    g: linearToSrgb(c(m[3] * r + m[4] * g + m[5] * b)),
    b: linearToSrgb(c(m[6] * r + m[7] * g + m[8] * b)),
  });
}
