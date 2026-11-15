/** 色選択パネル（色相環＋色の情報） */
import { HueWheel } from '../wheel.js';
import { state, selectedShape, setShapeColor, setBackground, checkpoint, select } from '../store.js';
import { describeColor, formatRatio, isAchromatic, hsvToHex } from '../color.js';
import { CONFIG } from '../config.js';
import { escapeHtml, toast } from '../ui.js';

export function createColorPanel(root, ctx) {
  root.innerHTML = `
    <div class="seg target-seg" role="tablist" aria-label="色を適用する対象">
      <button data-target="shape" class="is-on" role="tab">選択中の四角形</button>
      <button data-target="background" role="tab">背景</button>
    </div>
    <div class="color-layout">
      <div id="hueWheel"></div>
      <div class="color-info">
        <span class="color-preview" id="cPreview" aria-hidden="true"></span>
        <p class="color-name" id="cName"></p>
        <p class="color-sys" id="cSys"></p>
        <div class="color-tags" id="cQuick"></div>
      </div>
    </div>
    <div class="values">
      <div class="value-cell"><b>HEX</b><span id="cHex"></span></div>
      <div class="value-cell"><b>RGB</b><span id="cRgb"></span></div>
      <div class="value-cell"><b>HSV</b><span id="cHsv"></span></div>
    </div>
    <div class="section">
      <h3 class="section-title">パレット</h3>
      <div class="swatch-row" id="cPalette"></div>
      <p class="palette-hint" id="cPaletteHint">キャンバス内の色・画像から抽出した色をタップして適用できます。</p>
    </div>
    <div class="section">
      <h3 class="section-title">色の特徴（色彩学上の分類）</h3>
      <div class="card"><dl class="kv" id="cTheory"></dl></div>
    </div>
    <div class="section">
      <h3 class="section-title">視覚的な効果（一般に知られる傾向）</h3>
      <div class="card"><ul class="feature-list" id="cVisual"></ul></div>
    </div>
    <div class="section">
      <h3 class="section-title">一般的なイメージ</h3>
      <div id="cImages"></div>
      <p class="note">色から連想されるイメージは文化・地域・個人の経験・使われる場面によって大きく異なります。ここに示すのは一般的によく語られる連想の例であり、科学的に確定した効果ではありません。</p>
    </div>`;

  let target = 'shape';
  const segBtns = root.querySelectorAll('[data-target]');
  segBtns.forEach((b) => b.addEventListener('click', () => setTarget(b.dataset.target)));

  function setTarget(t) {
    target = t;
    segBtns.forEach((b) => b.classList.toggle('is-on', b.dataset.target === t));
    syncWheel(true);
    update();
  }

  let gestureStarted = false;
  let gestureMode = null;
  const wheel = new HueWheel(root.querySelector('#hueWheel'), {
    onStart: (mode) => {
      gestureStarted = false;
      gestureMode = mode;
      // 無彩色（白・灰・黒）の状態で色相を回したときは、色が見えるよう彩度・明度を初期値に戻す
      if (mode === 'hue' && (wheel.sat < 0.05 || wheel.val < 0.08)) wheel.setHSV(null, CONFIG.WHEEL_SATURATION, Math.max(wheel.val, CONFIG.WHEEL_VALUE));
    },
    onInput: (h, sat, val) => applyHSV(h, sat, val),
    onCommit: () => { gestureStarted = false; gestureMode = null; },
  });

  function ensureTarget() {
    if (target === 'background') return true;
    if (selectedShape()) return true;
    const shapes = state.work.shapes;
    if (shapes.length) { select(shapes[shapes.length - 1].id); return true; }
    toast('先に「追加」で四角形を作成してください');
    return false;
  }

  function applyHSV(h, sat, val) {
    if (!ensureTarget()) return;
    if (!gestureStarted) { checkpoint(); gestureStarted = true; }
    const hex = hsvToHex(h, sat, val);
    if (target === 'background') setBackground(hex);
    else setShapeColor(state.selectedId, hex);
  }

  function applyHex(hex) {
    if (!ensureTarget()) return;
    checkpoint();
    if (target === 'background') setBackground(hex);
    else setShapeColor(state.selectedId, hex);
    syncWheel(true);
  }

  function currentHex() {
    if (target === 'background') return state.work.background === 'transparent' ? '#ffffff' : state.work.background;
    const s = selectedShape();
    return s ? s.color : null;
  }

  let lastSyncKey = '';
  /** 選択対象が変わったら、色相環と四角のつまみを対象の色に合わせる */
  function syncWheel(force = false) {
    const hex = currentHex();
    const key = `${target}:${target === 'shape' ? state.selectedId : 'bg'}:${hex}`;
    if (gestureMode) return; // 操作中は自分の入力を優先
    if (!force && key === lastSyncKey) return;
    lastSyncKey = key;
    if (!hex) return;
    const { h, s, v } = describeColor(hex).hsv;
    // 無彩色は色相が定まらないので、色相は現在の位置のまま
    wheel.setHSV(s < 0.01 || v < 0.01 ? null : h, s, v);
  }

  function renderPalette() {
    const colors = [];
    const seen = new Set();
    const push = (hex, label) => { if (hex && hex !== 'transparent' && !seen.has(hex)) { seen.add(hex); colors.push({ hex, label }); } };
    state.work.shapes.forEach((s) => push(s.color, 'キャンバスの色'));
    (ctx.extracted || []).forEach((c) => push(c.hex, '画像から抽出'));
    ['#ffffff', '#1b1b1d'].forEach((h) => push(h, '基本色'));
    const cur = currentHex();
    const sig = colors.map((c) => c.hex).join(',') + '|' + cur;
    const el = root.querySelector('#cPalette');
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.innerHTML = colors.map((c) => `<button class="swatch${c.hex === cur ? ' is-on' : ''}" style="background:${c.hex}" data-hex="${c.hex}" aria-label="${escapeHtml(c.label)} ${c.hex}" title="${escapeHtml(c.label)}"></button>`).join('');
  }
  root.querySelector('#cPalette').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hex]');
    if (b) applyHex(b.dataset.hex);
  });

  function update() {
    if (!state.work) return;
    syncWheel();
    const hex = currentHex();
    // 他の四角形の色相を色相環上に点で表示
    wheel.setMarkers(state.work.shapes.filter((s) => s.id !== state.selectedId && !isAchromatic(s.color)).slice(-24).map((s) => ({ hue: Math.round(describeColor(s.color).hsv.h), color: s.color })));
    renderPalette();
    const nameEl = root.querySelector('#cName');
    if (!hex) {
      root.querySelector('#cPreview').style.background = 'transparent';
      nameEl.textContent = '未選択';
      root.querySelector('#cSys').textContent = '四角形をタップして選択してください';
      ['#cHex', '#cRgb', '#cHsv'].forEach((s) => { root.querySelector(s).textContent = '—'; });
      root.querySelector('#cTheory').innerHTML = '';
      root.querySelector('#cVisual').innerHTML = '';
      root.querySelector('#cImages').innerHTML = '';
      root.querySelector('#cQuick').innerHTML = '';
      return;
    }
    const info = describeColor(hex);
    root.querySelector('#cPreview').style.background = hex;
    nameEl.innerHTML = `${escapeHtml(info.name.name)}<small>${info.name.exact ? '' : '≈ 近似'}</small>`;
    root.querySelector('#cSys').textContent = `系統色名：${info.systematic}`;
    root.querySelector('#cHex').textContent = info.hex.toUpperCase();
    root.querySelector('#cRgb').textContent = `${info.rgb.r} ${info.rgb.g} ${info.rgb.b}`;
    root.querySelector('#cHsv').textContent = `${Math.round(info.hsv.h)}° ${Math.round(info.hsv.s * 100)}% ${Math.round(info.hsv.v * 100)}%`;

    const rows = [
      ['温度感', info.achromatic ? '無彩色（暖色・寒色に属さない）' : `${info.temperature.label}`],
      ['色相', info.achromatic ? '—（色みなし）' : `${info.family.label}系（${Math.round(info.hsv.h)}°）`],
      ['トーン', info.achromatic ? '無彩色' : `${info.tone.label}トーン`],
      ['明度', `${info.lightnessLabel}（L* ${info.lab.L.toFixed(1)}）`],
      ['彩度', `${info.chromaLabel}（C* ${info.chroma.toFixed(1)}）`],
      ['相対輝度', info.luminance.toFixed(3)],
      ['文字との対比', `白 ${formatRatio(info.onWhite)} : 1 ／ 黒 ${formatRatio(info.onBlack)} : 1`],
    ];
    root.querySelector('#cTheory').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('');
    root.querySelector('#cVisual').innerHTML = info.visual.map((v) => `<li><b>${escapeHtml(v.label)}</b>${escapeHtml(v.text)}</li>`).join('');
    root.querySelector('#cQuick').innerHTML = [info.achromatic ? '無彩色' : info.temperature.label, info.achromatic ? info.lightnessLabel : `${info.tone.label}トーン`].map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');
    root.querySelector('#cImages').innerHTML = info.images.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');
  }

  return {
    title: '色を選ぶ',
    height: 'min(58dvh, calc(100dvh - 250px))',
    onOpen(opts = {}) {
      if (opts.target) setTarget(opts.target);
      else if (target === 'shape' && !selectedShape() && state.work.shapes.length) select(state.work.shapes[state.work.shapes.length - 1].id);
      lastSyncKey = '';
      update();
    },
    update,
    get target() { return target; },
  };
}
