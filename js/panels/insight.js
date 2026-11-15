/** 解説パネル：配色解説・コントラスト・色覚・色彩理論 */
import { state, selectedShape } from '../store.js';
import { analyzeWork, cvdConfusions, visibleAreas } from '../harmony.js';
import { contrastRatio, formatRatio, wcagLevels, simulateCVD, CVD_TYPES, describeColor, hsvToHex, readableTextColor } from '../color.js';
import { CONFIG } from '../config.js';
import { escapeHtml } from '../ui.js';

/** 小さな色相環のSVG（色相の位置関係を示す） */
export function miniWheel(points, { size = 76, lines = true } = {}) {
  const c = size / 2, r = c - 6, inner = r - 7;
  let ring = '';
  for (let h = 0; h < 360; h += 10) {
    const a0 = ((h - 90 - 5) * Math.PI) / 180, a1 = ((h - 90 + 5.5) * Math.PI) / 180;
    const p = (a, rr) => `${(c + Math.cos(a) * rr).toFixed(2)} ${(c + Math.sin(a) * rr).toFixed(2)}`;
    ring += `<path d="M${p(a0, r)} A${r} ${r} 0 0 1 ${p(a1, r)} L${p(a1, inner)} A${inner} ${inner} 0 0 0 ${p(a0, inner)}Z" fill="${hsvToHex(h, CONFIG.WHEEL_SATURATION, CONFIG.WHEEL_VALUE)}"/>`;
  }
  const pos = (h, rr) => { const a = ((h - 90) * Math.PI) / 180; return [c + Math.cos(a) * rr, c + Math.sin(a) * rr]; };
  const pr = inner - 9;
  let poly = '';
  if (lines && points.length >= 2) {
    const pts = points.map((p) => pos(p.hue, pr).map((v) => v.toFixed(1)).join(',')).join(' ');
    poly = `<polygon points="${pts}" fill="none" stroke="currentColor" stroke-opacity=".45" stroke-width="1.2" stroke-linejoin="round"/>`;
  }
  const dots = points.map((p) => { const [x, y] = pos(p.hue, pr); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${p.color || hsvToHex(p.hue, CONFIG.WHEEL_SATURATION, CONFIG.WHEEL_VALUE)}" stroke="var(--surface)" stroke-width="2"/>`; }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">${ring}${poly}${dots}</svg>`;
}

const sw = (hex) => `<i style="background:${hex}"></i>`;
const nameOf = (c) => `${escapeHtml(c.info.name.name)}${c.isBackground ? '（背景）' : ''}`;

const THEORY = [
  { title: '色の三属性', hues: [], text: '色は「色相（色み）」「明度（明るさ）」「彩度（鮮やかさ）」の3つで表せます。白・灰・黒のように色みのない色を無彩色、それ以外を有彩色と呼びます。' },
  { title: '色相環', hues: [0, 60, 120, 180, 240, 300], text: '色相を円状に並べたものです。このアプリの色相環はRGB（HSV）の色相に基づいています。PCCSやマンセルなど他の色相環とは、補色の位置などが少し異なります。' },
  { title: '補色（コンプリメンタリー）', hues: [20, 200], text: '色相環で向かい合う2色。互いを最も引き立て合い、強い対比を生みます。どちらかの面積を小さくしてアクセントにすると扱いやすくなります。' },
  { title: '類似色（アナロガス）', hues: [190, 220, 250], text: '色相環で隣り合う、近い色同士。自然界にも多い組み合わせで、穏やかにまとまります。明度差をつけるとメリハリが出ます。' },
  { title: 'トライアド', hues: [0, 120, 240], text: '色相環を3等分する3色。バランスが良く、にぎやかで安定した印象。1色を主役にすると整理しやすくなります。' },
  { title: 'スプリット・コンプリメンタリー', hues: [30, 180, 240], text: 'ある色と、その補色の両隣の2色を組み合わせます。補色ほど強すぎず、変化のある配色になります。' },
  { title: 'テトラード', hues: [30, 120, 210, 300], text: '2組の補色、または色相環を4等分する4色。華やかですが色数が多いため、主役・脇役の面積差が鍵になります。' },
  { title: 'トーン・オン・トーン／トーン・イン・トーン', hues: [210, 210], text: '同じ色相で明暗を変える「トーン・オン・トーン」、色相は変えてトーンをそろえる「トーン・イン・トーン」。どちらも統一感を出しやすい手法です。' },
  { title: '暖色・寒色・中性色', hues: [10, 40, 200, 230], text: '赤〜黄の暖色は温かく、青緑〜青紫の寒色は涼しく感じられやすいとされます。緑・紫は中性色と呼ばれます。感じ方には個人差・文化差があります。' },
  { title: '明度対比と可読性', hues: [], text: '色の見分けやすさには、色相よりも明度差が大きく影響します。文字と背景には十分な明度差（コントラスト比）を確保することが大切です。' },
  { title: '面積比（70:25:5）', hues: [], text: 'ベースカラー70%、メインカラー25%、アクセントカラー5%という配分は、配色を整理するための目安としてよく紹介されます。絶対的な規則ではありません。' },
];

export function createInsightPanel(root, ctx) {
  root.innerHTML = `
    <div class="seg sticky" id="insTabs" role="tablist">
      <button data-tab="harmony" class="is-on" role="tab">配色解説</button>
      <button data-tab="contrast" role="tab">コントラスト</button>
      <button data-tab="cvd" role="tab">色覚</button>
      <button data-tab="theory" role="tab">色彩理論</button>
    </div>
    <div id="insBody"></div>`;
  let tab = 'harmony';
  let includeBg = true;
  let pickA = null, pickB = null;
  const body = root.querySelector('#insBody');

  root.querySelector('#insTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    root.querySelectorAll('#insTabs button').forEach((x) => x.classList.toggle('is-on', x === b));
    render();
    root.closest('.sheet-body').scrollTop = 0;
  });

  body.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'toggle-bg') { includeBg = !includeBg; render(); }
    else if (act === 'pick-a') { pickA = t.dataset.hex; render(); }
    else if (act === 'pick-b') { pickB = t.dataset.hex; render(); }
    else if (act === 'swap') { [pickA, pickB] = [pickB, pickA]; render(); }
    else if (act === 'cvd') { ctx.setCvd(t.dataset.type); render(); }
  });

  /* ---- 配色解説 ---- */
  function renderHarmony() {
    const a = analyzeWork(state.work, { includeBackground: includeBg });
    if (a.empty) return '<div class="empty-state">キャンバスに色がありません。</div>';
    const strip = a.colors.filter((c) => c.weight > 0).map((c) => `<span style="background:${c.hex};flex:${Math.max(0.02, c.weight)}" title="${nameOf(c)}"></span>`).join('');
    const pts = a.scheme.groups.map((g) => ({ hue: g.hue, color: g.members[0].hex }));
    const chromaticCount = a.colors.filter((c) => !c.info.achromatic).length;
    let html = `
      <div class="section">
        <div class="row" style="justify-content:space-between;margin-bottom:8px">
          <h3 class="section-title" style="margin:0">使われている色（見えている面積比）</h3>
          <button class="btn small" data-act="toggle-bg">${includeBg ? '背景を除く' : '背景を含める'}</button>
        </div>
        <div class="palette-strip">${strip}</div>
        <p class="small muted" style="margin-top:6px">${a.colors.map((c) => `${nameOf(c)} ${Math.round(c.weight * 100)}%`).join(' ・ ')}</p>
      </div>
      <div class="section">
        <h3 class="section-title">配色の型</h3>
        <div class="card">
          <div class="scheme-head">${miniWheel(pts, { size: 84 })}<div><p class="scheme-name">${escapeHtml(a.scheme.label)}</p><p class="small" style="margin:0">${escapeHtml(a.scheme.text)}</p></div></div>
          ${a.scheme.notes.map((n) => `<p class="note">${escapeHtml(n)}</p>`).join('')}
        </div>
      </div>`;
    if (a.relations.length) {
      const rels = a.relations.slice(0, 8);
      html += `<div class="section"><h3 class="section-title">色相の関係</h3><div class="card relation-list">${rels.map((r) => `
        <div class="relation"><span class="pair">${sw(r.a.hex)}${sw(r.b.hex)}</span>
          <div><b>${escapeHtml(r.relation.label)}</b> <span class="muted mono">${Math.round(r.diff)}°</span><br><span class="muted">${nameOf(r.a)} × ${nameOf(r.b)}：${escapeHtml(r.relation.text)}</span></div>
        </div>`).join('')}${a.relations.length > rels.length ? `<p class="small muted" style="margin:0">ほか ${a.relations.length - rels.length} 組</p>` : ''}</div></div>`;
    } else if (chromaticCount <= 1) {
      html += `<div class="section"><p class="small muted">有彩色が2色以上になると、色相の関係（類似色・補色など）を解説します。</p></div>`;
    }
    const t = a.temp;
    const pct = (v) => `${Math.round(v * 100)}%`;
    html += `
      <div class="section"><h3 class="section-title">暖色・寒色のバランス</h3><div class="card">
        <div class="temp-bar"><span style="width:${pct(t.warm)};background:#e0744f"></span><span style="width:${pct(t.neutral)};background:#8fae6a"></span><span style="width:${pct(t.cool)};background:#4f86c6"></span><span style="width:${pct(t.achromatic)};background:#a3a09a"></span></div>
        <div class="temp-legend"><span><i style="background:#e0744f"></i>暖色 ${pct(t.warm)}</span><span><i style="background:#8fae6a"></i>中性色 ${pct(t.neutral)}</span><span><i style="background:#4f86c6"></i>寒色 ${pct(t.cool)}</span><span><i style="background:#a3a09a"></i>無彩色 ${pct(t.achromatic)}</span></div>
        <p class="small" style="margin:8px 0 0">${escapeHtml(a.tempSummary)}</p>
      </div></div>
      <div class="section"><h3 class="section-title">明度・彩度の特徴</h3><div class="card">
        ${a.toneLines.map((l) => `<p class="small" style="margin:0 0 4px">${escapeHtml(l)}</p>`).join('')}
        ${a.dominance ? `<p class="small" style="margin:6px 0 0">${escapeHtml(a.dominance)}</p>` : ''}
      </div></div>
      <div class="section"><h3 class="section-title">組み合わせから受ける印象</h3>
        ${a.impressions.items.map((i) => `<div class="impression"><h4>${a.impressions.tentative ? 'やや' : ''}${escapeHtml(i.label)}</h4><p>${escapeHtml(i.reason)}</p></div>`).join('')}
        <p class="note">印象は一般的な色彩イメージにもとづく目安です。配色の良し悪しを判定するものではなく、文化・用途・個人の感じ方によって変わります。</p>
      </div>`;
    return html;
  }

  /* ---- コントラスト ---- */
  function contrastColors() {
    const list = visibleAreas(state.work, true).map((c) => ({ hex: c.hex, isBackground: c.isBackground || c.alsoBackground }));
    const sel = selectedShape();
    if (sel && !list.some((c) => c.hex === sel.color)) list.unshift({ hex: sel.color });
    return list;
  }

  function renderContrast() {
    const colors = contrastColors();
    const hexes = colors.map((c) => c.hex);
    if (!hexes.length) return '<div class="empty-state">色がありません。</div>';
    const sel = selectedShape();
    if (!pickA || !hexes.includes(pickA)) pickA = sel ? sel.color : hexes[0];
    if (!pickB || !hexes.includes(pickB) || pickB === pickA) {
      const bg = state.work.background !== 'transparent' ? state.work.background : null;
      pickB = bg && bg !== pickA && hexes.includes(bg) ? bg : (hexes.find((h) => h !== pickA) || '#ffffff');
    }
    const ratio = contrastRatio(pickA, pickB);
    const lv = wcagLevels(ratio);
    const badge = (ok) => `<span class="badge ${ok ? 'pass' : 'fail'}">${ok ? '適合' : '不足'}</span>`;
    const picker = (which, cur) => hexes.map((h) => `<button class="swatch${h === cur ? ' is-on' : ''}" style="background:${h}" data-act="pick-${which}" data-hex="${h}" aria-label="${which.toUpperCase()}: ${h}"></button>`).join('');

    let html = `
      <div class="section">
        <h3 class="section-title">2色のコントラスト比（WCAG 2.x）</h3>
        <div class="pick-row"><b>A</b><div class="swatch-row">${picker('a', pickA)}</div></div>
        <div class="pick-row"><b>B</b><div class="swatch-row">${picker('b', pickB)}</div></div>
        <div class="card">
          <div class="row" style="justify-content:space-between;align-items:flex-end;margin-bottom:10px">
            <div class="ratio-big">${formatRatio(ratio)}<small> : 1</small></div>
            <button class="btn small" data-act="swap">A⇄B</button>
          </div>
          <div class="contrast-hero">
            <div class="sample" style="background:${pickB};color:${pickA}"><span class="big">Aa あ</span><span class="body">背景B × 文字A</span></div>
            <div class="sample" style="background:${pickA};color:${pickB}"><span class="big">Aa あ</span><span class="body">背景A × 文字B</span></div>
          </div>
          <table class="wcag-table">
            <tr><td>通常の文字 AA</td><td>4.5:1</td><td>${badge(lv.normalAA)}</td></tr>
            <tr><td>通常の文字 AAA</td><td>7:1</td><td>${badge(lv.normalAAA)}</td></tr>
            <tr><td>大きな文字 AA</td><td>3:1</td><td>${badge(lv.largeAA)}</td></tr>
            <tr><td>大きな文字 AAA</td><td>4.5:1</td><td>${badge(lv.largeAAA)}</td></tr>
            <tr><td>図形・UI部品（非テキスト）</td><td>3:1</td><td>${badge(lv.nonText)}</td></tr>
          </table>
        </div>
      </div>
      <div class="section">
        <h3 class="section-title">黒文字・白文字の見え方</h3>
        <div class="bw-grid">${hexes.map((h) => {
          const b = contrastRatio(h, '#000000'), w = contrastRatio(h, '#ffffff');
          return `<div class="bw-card" style="background:${h}">
            <div style="color:#000"><span class="${b >= w ? 'best' : ''}">黒 Aa</span><small>${formatRatio(b)}</small></div>
            <div style="color:#fff"><span class="${w > b ? 'best' : ''}">白 Aa</span><small>${formatRatio(w)}</small></div></div>`;
        }).join('')}</div>
        <p class="small muted" style="margin-top:6px">下線はコントラスト比が高い方です。</p>
      </div>`;
    if (hexes.length >= 2 && hexes.length <= 10) {
      const cls = (r) => (r >= 7 ? 'lv-aaa' : r >= 4.5 ? 'lv-aa' : r >= 3 ? 'lv-large' : 'lv-fail');
      html += `<div class="section"><h3 class="section-title">すべての組み合わせ</h3><div class="scroll-x"><table class="matrix">
        <tr><th></th>${hexes.map((h) => `<th>${sw(h)}</th>`).join('')}</tr>
        ${hexes.map((a) => `<tr><th>${sw(a)}</th>${hexes.map((b) => (a === b ? '<td class="self">—</td>' : `<td class="${cls(contrastRatio(a, b))}">${formatRatio(contrastRatio(a, b))}</td>`)).join('')}</tr>`).join('')}
      </table></div>
      <p class="small muted" style="margin-top:6px">緑: 4.5以上 ／ 橙: 3以上4.5未満（大きな文字・図形向け）／ 赤: 3未満</p></div>`;
    }
    html += `<p class="note">コントラスト比はWCAG 2.x の相対輝度の式で計算しています。実際の読みやすさは文字の大きさ・太さ・書体・表示環境・閲覧者の視覚特性などにも左右されるため、この数値だけでアクセシビリティへの適合を断定することはできません。</p>`;
    return html;
  }

  /* ---- 色覚 ---- */
  function renderCvd() {
    const colors = visibleAreas(state.work, true).filter((c) => c.weight > 0 || !c.isBackground);
    const hexes = [...new Set(colors.map((c) => c.hex))];
    const conf = cvdConfusions(hexes);
    const types = Object.entries(CVD_TYPES);
    let html = `
      <div class="section">
        <h3 class="section-title">キャンバスの表示を切り替え</h3>
        <div class="seg">${types.map(([k, v]) => `<button data-act="cvd" data-type="${k}" class="${state.cvd === k ? 'is-on' : ''}">${v.short}</button>`).join('')}</div>
        <p class="small muted" style="margin-top:8px">${state.cvd === 'none' ? '選ぶとキャンバス全体がシミュレーション表示になります（作品の色は変わりません）。' : `${escapeHtml(CVD_TYPES[state.cvd].label)}：${escapeHtml(CVD_TYPES[state.cvd].note)}で表示中。`}</p>
      </div>
      <div class="section"><h3 class="section-title">見え方の比較</h3><div class="card cvd-rows">
        ${types.map(([k, v]) => `<div class="cvd-row"><h4>${escapeHtml(v.label)}${v.note ? `<small>${escapeHtml(v.note)}</small>` : ''}</h4>
          <div class="palette-strip" style="height:34px">${colors.map((c) => `<span style="background:${simulateCVD(c.hex, k)};flex:${Math.max(0.06, c.weight)}"></span>`).join('')}</div>
          ${k !== 'none' && conf[k] && conf[k].length ? conf[k].slice(0, 3).map((p) => `<div class="confuse"><span class="pair">${sw(p.a)}${sw(p.b)}</span>区別しにくくなる可能性があります</div>`).join('') : ''}
        </div>`).join('')}
      </div></div>
      <p class="note">Machado ら（2009）のモデルによる2色覚（重度）の近似シミュレーションです。色覚の特性には個人差・程度差があり、実際の見え方を正確に再現するものではありません。色だけに頼らず、明度差・形・文字などで情報を区別できるようにすると、より多くの人に伝わりやすくなります。</p>`;
    return html;
  }

  /* ---- 理論 ---- */
  function renderTheory() {
    return `<div class="section">${THEORY.map((t) => `
      <div class="card theory-card">
        ${t.hues.length ? miniWheel(t.hues.map((h, i) => ({ hue: h, color: t.title.startsWith('トーン') ? hsvToHex(h, i ? 0.35 : 0.85, i ? 0.95 : 0.55) : undefined })), { size: 76, lines: t.hues.length >= 2 && !t.title.startsWith('色相環') }) : `<svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true"><rect x="8" y="14" width="34" height="48" rx="3" fill="${t.title.startsWith('面積') ? '#d9d2c3' : '#2b2b2b'}"/><rect x="34" y="24" width="30" height="30" rx="3" fill="${t.title.startsWith('面積') ? '#4c6cb3' : '#f3efe6'}"/><rect x="52" y="44" width="12" height="12" rx="2" fill="#e0644f"/></svg>`}
        <div><h4>${escapeHtml(t.title)}</h4><p>${escapeHtml(t.text)}</p></div>
      </div>`).join('')}
      <p class="note">これらの配色理論は、配色を考えるための「手がかり」です。理論に当てはまらない組み合わせにも魅力的なものはたくさんあります。このアプリでは色を自動で変更せず、自由な創作を優先しています。</p></div>`;
  }

  function render() {
    if (!state.work) return;
    try {
      body.innerHTML = tab === 'harmony' ? renderHarmony() : tab === 'contrast' ? renderContrast() : tab === 'cvd' ? renderCvd() : renderTheory();
    } catch (e) {
      console.error(e);
      body.innerHTML = '<div class="empty-state">解説を表示できませんでした。</div>';
    }
  }

  return {
    title: '色と配色の解説',
    height: 'min(64dvh, calc(100dvh - 290px))',
    onOpen(opts = {}) {
      if (opts.tab) {
        tab = opts.tab;
        root.querySelectorAll('#insTabs button').forEach((x) => x.classList.toggle('is-on', x.dataset.tab === tab));
      }
      render();
    },
    update(reasons) {
      // ドラッグ中は終了後にまとめて更新
      if ([...reasons].every((r) => r === 'drag' || r === 'history' || r === 'tap')) return;
      if (tab === 'theory') return;
      render();
    },
  };
}
