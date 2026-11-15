/**
 * 配色の解説（色相関係・暖寒バランス・明度/彩度・印象）
 * ※ 配色の良し悪しをスコア化するものではありません。
 */
import { describeColor, hueDistance, hueDelta, colorDifference, simulateCVD, CVD_TYPES, clamp } from './color.js';

/** 見えている面積比を格子サンプリングで求める（重なりを考慮） */
export function visibleAreas(work, includeBackground = true) {
  const W = work.artboard.w, H = work.artboard.h;
  const cols = 72, rows = Math.max(8, Math.round((72 * H) / W));
  const counts = new Map();
  let total = 0;
  const shapes = work.shapes;
  for (let j = 0; j < rows; j++) {
    const y = ((j + 0.5) / rows) * H;
    for (let i = 0; i < cols; i++) {
      const x = ((i + 0.5) / cols) * W;
      let hex = null;
      for (let k = shapes.length - 1; k >= 0; k--) {
        const s = shapes[k];
        if (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) { hex = s.color; break; }
      }
      if (!hex) {
        if (!includeBackground || work.background === 'transparent') continue;
        hex = `bg:${work.background}`;
      }
      counts.set(hex, (counts.get(hex) || 0) + 1);
      total++;
    }
  }
  const result = [];
  for (const [key, n] of counts) {
    const isBg = key.startsWith('bg:');
    result.push({ hex: isBg ? key.slice(3) : key, isBackground: isBg, weight: total ? n / total : 0 });
  }
  // キャンバス外に完全に隠れた四角形も色としては列挙する（面積0）
  for (const s of shapes) {
    if (!result.some((r) => !r.isBackground && r.hex === s.color)) result.push({ hex: s.color, isBackground: false, weight: 0 });
  }
  // 背景と同じ色の四角形は統合
  const merged = [];
  for (const r of result) {
    const same = merged.find((m) => m.hex === r.hex);
    if (same) { same.weight += r.weight; same.isBackground = same.isBackground && r.isBackground; same.alsoBackground = true; }
    else merged.push({ ...r });
  }
  return merged.sort((a, b) => b.weight - a.weight);
}

export function relationOf(d) {
  if (d <= 15) return { key: 'same', label: '同一色相', text: 'ほぼ同じ色相。まとまりが生まれやすい関係です。' };
  if (d <= 45) return { key: 'analogous', label: '類似色相', text: '色相環で近い関係。自然で調和しやすい組み合わせです。' };
  if (d <= 105) return { key: 'intermediate', label: '中差色相', text: '近すぎず遠すぎない関係。変化と統一のバランスがとれます。' };
  if (d <= 150) return { key: 'contrast', label: '対照色相', text: '離れた関係。メリハリのある、はっきりした印象になります。' };
  return { key: 'complementary', label: '補色', text: '色相環の反対側の関係。互いを最も引き立て合います。' };
}

/** 有彩色の色相をグループ化（20°以内を同一グループとみなす） */
function groupHues(chromatic) {
  const sorted = [...chromatic].sort((a, b) => a.info.hsv.h - b.info.hsv.h);
  const groups = [];
  for (const c of sorted) {
    const h = c.info.hsv.h;
    const g = groups.find((gr) => gr.members.some((m) => hueDistance(m.info.hsv.h, h) <= 20));
    if (g) g.members.push(c);
    else groups.push({ members: [c] });
  }
  for (const g of groups) {
    let x = 0, y = 0;
    for (const m of g.members) {
      const w = m.weight + 0.01;
      x += Math.cos((m.info.hsv.h * Math.PI) / 180) * w;
      y += Math.sin((m.info.hsv.h * Math.PI) / 180) * w;
    }
    g.hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }
  return groups.sort((a, b) => a.hue - b.hue);
}

function maxArc(groups) {
  // すべての色相を含む最小の円弧の大きさ
  if (groups.length < 2) return 0;
  const hs = groups.map((g) => g.hue).sort((a, b) => a - b);
  let maxGap = 0;
  for (let i = 0; i < hs.length; i++) {
    const next = i === hs.length - 1 ? hs[0] + 360 : hs[i + 1];
    maxGap = Math.max(maxGap, next - hs[i]);
  }
  return 360 - maxGap;
}

export function detectScheme(colors) {
  const chromatic = colors.filter((c) => !c.info.achromatic);
  const achro = colors.filter((c) => c.info.achromatic);
  const groups = groupHues(chromatic);
  const n = groups.length;
  const withAchro = achro.length ? '無彩色を組み合わせることで、有彩色が引き立ちやすくなっています。' : '';
  let scheme;

  if (n === 0) {
    scheme = { key: 'achromatic', label: '無彩色配色', text: '白・灰・黒など色みのない色だけの配色です。明度差が印象を大きく左右し、シックで洗練された雰囲気になりやすい配色です。' };
  } else if (n === 1) {
    scheme = groups[0].members.length >= 2
      ? { key: 'mono', label: '同一色相配色（モノクロマティック）', text: '同じ色相の濃淡・明暗で構成された配色です。統一感が強く、まとまりのある印象になります。' }
      : achro.length
        ? { key: 'accent', label: '有彩色＋無彩色の配色', text: '1つの有彩色を無彩色と組み合わせた配色です。有彩色がアクセントとして際立ちます。' }
        : { key: 'single', label: '単色', text: '1色のみです。四角形を追加して色を組み合わせると、配色の関係を解説できます。' };
  } else if (maxArc(groups) <= 60) {
    scheme = { key: 'analogous', label: '類似色相配色（アナロガス）', text: '色相環上で近い色同士の配色です。自然でなじみやすく、穏やかな統一感があります。' };
  } else if (n === 2) {
    const d = hueDistance(groups[0].hue, groups[1].hue);
    if (d >= 150) scheme = { key: 'complementary', label: '補色配色（ダイアード）', text: '色相環で向かい合う2色の配色です。互いを強く引き立て合い、コントラストの強い印象になります。面積差をつけると使いやすくなります。' };
    else if (d > 105) scheme = { key: 'contrast', label: '対照色相配色', text: '色相の離れた2色の配色です。はっきりとした変化があり、活発な印象になります。' };
    else scheme = { key: 'intermediate', label: '中差色相配色', text: '適度に離れた2色の配色です。統一感と変化のバランスがとれた印象になります。' };
  } else if (n === 3) {
    const hs = groups.map((g) => g.hue);
    const gaps = hs.map((h, i) => ((i === 2 ? hs[0] + 360 : hs[i + 1]) - h));
    if (gaps.every((g) => Math.abs(g - 120) <= 25)) {
      scheme = { key: 'triad', label: 'トライアド（3色配色）', text: '色相環を3等分する位置の配色です。バランスがよく、にぎやかで安定感のある印象になります。' };
    } else {
      let split = false;
      for (let i = 0; i < 3; i++) {
        const base = hs[i];
        const others = hs.filter((_, k) => k !== i).map((h) => hueDelta(h, base + 180));
        if (others.every((d) => Math.abs(d) >= 10 && Math.abs(d) <= 55) && Math.sign(others[0]) !== Math.sign(others[1])) split = true;
      }
      scheme = split
        ? { key: 'split', label: 'スプリット・コンプリメンタリー', text: 'ある色と、その補色の両隣の色を組み合わせた配色です。補色配色の力強さを保ちつつ、より柔らかくまとまります。' }
        : { key: 'multi', label: '多色相配色', text: '複数の色相を組み合わせた配色です。明度やトーンをそろえると統一感が出やすくなります。' };
    }
  } else if (n === 4) {
    const hs = groups.map((g) => g.hue);
    const isComp = (a, b) => hueDistance(a, b) >= 155;
    const pairs = (isComp(hs[0], hs[2]) && isComp(hs[1], hs[3]));
    const gaps = hs.map((h, i) => ((i === 3 ? hs[0] + 360 : hs[i + 1]) - h));
    if (pairs && gaps.every((g) => Math.abs(g - 90) <= 25)) scheme = { key: 'square', label: 'テトラード（スクエア）', text: '色相環を4等分する位置の配色です。2組の補色関係を含み、華やかでにぎやかな印象になります。' };
    else if (pairs) scheme = { key: 'tetrad', label: 'テトラード（ダブル・コンプリメンタリー）', text: '2組の補色を組み合わせた配色です。色数が多く華やかなため、主役の色を決めるとまとまりやすくなります。' };
    else scheme = { key: 'multi', label: '多色相配色', text: '複数の色相を組み合わせた配色です。明度やトーンをそろえると統一感が出やすくなります。' };
  } else {
    scheme = { key: 'poly', label: '多色相配色（ポリクロマティック）', text: '多くの色相を使ったカラフルな配色です。トーン（明るさ・鮮やかさ）をそろえるとまとまりやすくなります。' };
  }

  // トーンの観点からの補足
  const notes = [];
  if (chromatic.length >= 2) {
    const ss = chromatic.map((c) => c.info.hsv.s), vs = chromatic.map((c) => c.info.hsv.v);
    const sameTone = Math.max(...ss) - Math.min(...ss) <= 0.12 && Math.max(...vs) - Math.min(...vs) <= 0.12;
    if (sameTone && n >= 2) notes.push('トーン（明るさ・鮮やかさ）がそろっているため「トーン・イン・トーン配色」の性格もあります。色相が違ってもまとまりやすい配色です。');
    if (n === 1 && !sameTone) notes.push('同じ色相で明暗・濃淡を変えた「トーン・オン・トーン配色」になっています。');
  }
  if (withAchro && n > 0) notes.push(withAchro);
  return { ...scheme, notes, groups };
}

function weightedMean(colors, fn) {
  const tw = colors.reduce((s, c) => s + c.w, 0) || 1;
  return colors.reduce((s, c) => s + fn(c) * c.w, 0) / tw;
}

/** 組み合わせから受ける一般的な印象（理由つき）。数値スコアは表示しない。 */
export function impressions(colors, scheme) {
  // 面積の極端な偏りで印象が消えないよう、面積と色数の両方を考慮した重み
  const n = colors.length;
  const cs = colors.map((c) => ({ ...c, w: 0.5 * c.weight + 0.5 / n }));
  const W = (pred) => cs.filter(pred).reduce((s, c) => s + c.w, 0) / (cs.reduce((s, c) => s + c.w, 0) || 1);
  const L = (c) => c.info.lab.L, C = (c) => c.info.chroma, h = (c) => c.info.hsv.h, A = (c) => c.info.achromatic;

  const meanL = weightedMean(cs, L);
  const meanC = weightedMean(cs, C);
  const Ls = cs.map(L);
  const Lrange = Math.max(...Ls) - Math.min(...Ls);
  const hueGroups = scheme.groups.length;
  const warmW = W((c) => c.info.temperature.key === 'warm');
  const coolW = W((c) => c.info.temperature.key === 'cool');
  const purpleW = W((c) => !A(c) && h(c) >= 245 && h(c) < 320);
  const greenW = W((c) => !A(c) && h(c) >= 70 && h(c) < 160 && C(c) < 70);
  const earthW = W((c) => !A(c) && h(c) >= 10 && h(c) < 60 && L(c) < 75 && C(c) < 60);
  const beigeW = W((c) => !A(c) && h(c) >= 20 && h(c) < 60 && L(c) >= 75 && C(c) < 35);
  const darkW = W((c) => L(c) < 30);
  const blackW = W((c) => L(c) < 15);
  const lightW = W((c) => L(c) > 78);
  const whiteW = W((c) => A(c) && L(c) > 90);
  const vividW = W((c) => C(c) > 60);
  const paleW = W((c) => !A(c) && L(c) > 75 && C(c) < 40);
  const mutedW = W((c) => !A(c) && C(c) < 35);
  const goldW = W((c) => !A(c) && h(c) >= 35 && h(c) < 58 && L(c) >= 55 && L(c) < 80 && C(c) >= 35 && C(c) < 75);
  const redW = W((c) => !A(c) && (h(c) >= 345 || h(c) < 15) && C(c) > 50);
  const hasComp = ['complementary', 'split', 'tetrad', 'square', 'contrast'].includes(scheme.key);
  const c01 = (v) => clamp(v, 0, 1);

  const defs = [
    {
      key: 'luxury', label: '高級感',
      score: 0.45 * c01(darkW * 1.6) + 0.25 * (meanC < 45 ? 1 : 0.3) + 0.3 * c01((purpleW + goldW + blackW) * 2) - 0.35 * c01(vividW * lightW * 4),
      reason: () => [darkW > 0.2 && '深く暗い色が画面を引き締めている', goldW > 0.05 && '金色を思わせる色が含まれている', purpleW > 0.1 && '紫系の色が含まれている', blackW > 0.1 && '黒に近い色が格調を添えている', meanC < 45 && '彩度が抑えられている'],
    },
    {
      key: 'fresh', label: '爽やかさ',
      score: 0.5 * c01(coolW * 1.5) + 0.35 * c01((lightW + whiteW) * 1.6) + 0.15 * (meanL > 65 ? 1 : 0) - 0.45 * warmW - 0.3 * darkW,
      reason: () => [coolW > 0.25 && '青や青緑などの寒色が中心', (lightW + whiteW) > 0.2 && '明るい色・白が軽さを出している', meanL > 65 && '全体の明度が高い'],
    },
    {
      key: 'warm', label: '温かみ',
      score: 0.6 * c01(warmW * 1.5) + 0.2 * (meanL > 40 && meanL < 88 ? 1 : 0) + 0.2 * c01((earthW + beigeW) * 2) - 0.45 * coolW,
      reason: () => [warmW > 0.3 && '赤・橙・黄などの暖色が多い', (earthW + beigeW) > 0.1 && '茶色やベージュ系の色が含まれている', meanL > 40 && meanL < 88 && '明るすぎず暗すぎない明度'],
    },
    {
      key: 'calm', label: '落ち着き',
      score: (meanC < 35 ? 0.4 : meanC < 50 ? 0.2 : 0) + (Lrange < 40 ? 0.2 : 0) + (hueGroups <= 2 ? 0.15 : 0) + 0.25 * c01(mutedW * 1.5) - 0.45 * vividW,
      reason: () => [meanC < 45 && '彩度が控えめ', Lrange < 40 && '明度差が穏やか', hueGroups <= 2 && '色相の数が少なくまとまっている', mutedW > 0.2 && 'くすみのある色が含まれている'],
    },
    {
      key: 'pop', label: 'ポップさ',
      score: 0.4 * c01(vividW * 1.4) + 0.35 * c01((hueGroups - 1) / 3) + 0.25 * (meanL > 55 ? 1 : 0) - 0.5 * darkW,
      reason: () => [vividW > 0.25 && '鮮やかな色が多い', hueGroups >= 3 && '多くの色相が使われている', meanL > 55 && '全体が明るい'],
    },
    {
      key: 'strong', label: '力強さ',
      score: 0.35 * c01(vividW * 1.4) + 0.35 * c01(Lrange / 70) + 0.15 * c01((redW + blackW) * 3) + (hasComp ? 0.15 : 0) - 0.4 * paleW,
      reason: () => [vividW > 0.25 && '鮮やかな色が使われている', Lrange >= 45 && '明暗の差が大きい', redW > 0.05 && '鮮やかな赤が含まれている', blackW > 0.05 && '黒に近い色が含まれている', hasComp && '色相の離れた色同士の対比がある'],
    },
    {
      key: 'mystic', label: '神秘的な印象',
      score: 0.5 * c01(purpleW * 2) + 0.25 * c01(darkW * 1.6) + 0.15 * c01(coolW * 1.2) + (meanC > 20 && meanC < 75 ? 0.1 : 0) - 0.3 * warmW,
      reason: () => [purpleW > 0.1 && '紫・青紫系の色が含まれている', darkW > 0.15 && '暗い色が深みを出している', coolW > 0.2 && '寒色が静けさを加えている'],
    },
    {
      key: 'gentle', label: 'やさしさ',
      score: 0.6 * c01(paleW * 1.6) + 0.25 * (meanL > 70 ? 1 : 0) + 0.15 * (Lrange < 35 ? 1 : 0) - 0.6 * darkW - 0.3 * vividW,
      reason: () => [paleW > 0.2 && '淡いパステル調の色が中心', meanL > 70 && '明度が高い', Lrange < 35 && '明度差が小さく柔らかい'],
    },
    {
      key: 'natural', label: 'ナチュラルさ',
      score: 0.6 * c01((greenW + earthW + beigeW) * 1.4) + 0.25 * (meanC > 12 && meanC < 55 ? 1 : 0) + 0.15 * (hueGroups <= 3 ? 1 : 0) - 0.4 * vividW,
      reason: () => [greenW > 0.1 && '緑系の色が含まれている', (earthW + beigeW) > 0.1 && '土や木を思わせる茶・ベージュ系の色', meanC > 12 && meanC < 55 && '彩度が中程度'],
    },
  ];

  const scored = defs.map((d) => ({ ...d, score: d.score })).sort((a, b) => b.score - a.score);
  let picked = scored.filter((d) => d.score >= 0.45).slice(0, 3);
  let tentative = false;
  if (!picked.length) { picked = scored.slice(0, 1); tentative = true; }
  return {
    tentative,
    items: picked.map((d) => {
      const reasons = d.reason().filter(Boolean);
      return { key: d.key, label: d.label, reason: reasons.length ? `${reasons.slice(0, 3).join('、')}ため、${d.label}が感じられる可能性があります。` : `全体の色調から、${d.label}が感じられる可能性があります。` };
    }),
    metrics: { meanL, meanC, Lrange, warmW, coolW },
  };
}

/** キャンバス全体の解説 */
export function analyzeWork(work, { includeBackground = true } = {}) {
  const areas = visibleAreas(work, includeBackground);
  const colors = areas.map((a) => ({ ...a, info: describeColor(a.hex) }));
  if (!colors.length) return { empty: true, colors: [] };
  const scheme = detectScheme(colors);

  // 色相の関係（有彩色の組み合わせ）
  const chromatic = colors.filter((c) => !c.info.achromatic);
  const relations = [];
  for (let i = 0; i < chromatic.length; i++) {
    for (let j = i + 1; j < chromatic.length; j++) {
      const d = hueDistance(chromatic[i].info.hsv.h, chromatic[j].info.hsv.h);
      relations.push({ a: chromatic[i], b: chromatic[j], diff: d, relation: relationOf(d) });
    }
  }
  relations.sort((x, y) => (y.a.weight + y.b.weight) - (x.a.weight + x.b.weight));

  // 暖寒バランス（見えている面積比）
  const temp = { warm: 0, cool: 0, neutral: 0, achromatic: 0 };
  const tw = colors.reduce((s, c) => s + c.weight, 0) || 1;
  for (const c of colors) temp[c.info.temperature.key] += c.weight / tw;
  let tempSummary;
  if (temp.warm >= 0.6) tempSummary = '暖色が中心の配色です。温かく、活動的・親しみやすい方向の印象になりやすい傾向があります。';
  else if (temp.cool >= 0.6) tempSummary = '寒色が中心の配色です。涼しげで、静か・知的な方向の印象になりやすい傾向があります。';
  else if (temp.warm > 0.15 && temp.cool > 0.15) tempSummary = '暖色と寒色が混在しています。温度感の対比により、互いの色が引き立ちやすくなります。';
  else if (temp.achromatic >= 0.6) tempSummary = '無彩色が大部分を占めます。温度感は控えめで、有彩色があればアクセントとして目立ちます。';
  else tempSummary = '中性色（緑・紫系）や無彩色を含む、温度感の偏りが少ない配色です。';

  // 明度・彩度の特徴
  const Ls = colors.map((c) => c.info.lab.L), Cs = colors.map((c) => c.info.chroma);
  const Lrange = Math.max(...Ls) - Math.min(...Ls);
  const meanL = colors.reduce((s, c) => s + c.info.lab.L * c.weight, 0) / tw;
  const meanC = colors.reduce((s, c) => s + c.info.chroma * c.weight, 0) / tw;
  const toneLines = [];
  toneLines.push(Lrange >= 50 ? `明度差が大きく（L* 差 約${Math.round(Lrange)}）、メリハリのはっきりした配色です。` : Lrange >= 25 ? `適度な明度差（L* 差 約${Math.round(Lrange)}）があり、形が見分けやすい配色です。` : `明度差が小さく（L* 差 約${Math.round(Lrange)}）、柔らかく溶け合うような配色です。色同士の境界が見えにくくなる場合があります。`);
  toneLines.push(meanL >= 70 ? '全体として明るく、軽やかな印象です。' : meanL >= 40 ? '全体の明るさは中程度です。' : '全体として暗めで、重厚・落ち着いた印象です。');
  toneLines.push(meanC >= 60 ? '鮮やかな色が多く、目を引く配色です。' : meanC >= 30 ? '彩度は中程度で、ほどよい華やかさがあります。' : '彩度が低めで、穏やか・上品な方向の配色です。');
  if (Math.max(...Cs) - Math.min(...Cs) > 50) toneLines.push('鮮やかな色と控えめな色の差が大きく、鮮やかな色がアクセントとして際立ちます。');

  // 面積のバランス
  let dominance = '';
  const top = colors[0];
  if (colors.length >= 2) {
    if (top.weight >= 0.5) dominance = `最も面積の大きい色（${top.info.name.name}系${top.isBackground ? '・背景' : ''}）がベースカラーとして全体の印象を決めています。`;
    else dominance = '各色の面積が比較的均等です。主役となる色の面積を大きくすると、印象の方向性がはっきりしやすくなります。';
    const accent = colors.find((c) => c.weight > 0 && c.weight <= 0.12 && c.info.chroma > 45);
    if (accent) dominance += `小さな面積の鮮やかな色（${accent.info.name.name}系）がアクセントカラーとして働いています。`;
  }

  return {
    empty: false,
    colors, scheme, relations, temp, tempSummary, toneLines, dominance,
    impressions: impressions(colors, scheme),
  };
}

/** 色覚シミュレーション時に区別しにくくなる組み合わせ */
export function cvdConfusions(hexes, threshold = 8) {
  const out = {};
  const uniq = [...new Set(hexes)];
  for (const type of Object.keys(CVD_TYPES)) {
    if (type === 'none') continue;
    const pairs = [];
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const orig = colorDifference(uniq[i], uniq[j]);
        const sim = colorDifference(simulateCVD(uniq[i], type), simulateCVD(uniq[j], type));
        if (orig >= threshold && sim < threshold) pairs.push({ a: uniq[i], b: uniq[j], orig, sim });
      }
    }
    out[type] = pairs;
  }
  return out;
}
