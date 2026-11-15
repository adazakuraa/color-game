/** 画像からの色抽出パネル（画像は端末内でのみ処理し、外部に送信しない） */
import { CONFIG } from '../config.js';
import { state, selectedShape, setShapeColor, checkpoint, addShape, changed, emit } from '../store.js';
import { loadImageFile, imageToPixels, extractPalette, createSampler } from '../extract.js';
import { describeColor } from '../color.js';
import { escapeHtml, toast } from '../ui.js';
import { newId } from '../storage.js';

export function createExtractPanel(root, ctx) {
  let count = CONFIG.EXTRACT_COLOR_COUNT;
  let pixels = null;
  let imageUrl = null;
  let palette = [];
  let busy = false;
  let sampler = null;
  let picks = []; // スポイトで取った色（新しい順）
  let current = null; // 現在のスポイトの色

  root.innerHTML = `
    <div class="section">
      <div class="dropzone" id="exDrop">
        <p style="margin:0 0 10px">写真やイラストから代表的な色を取り出します。</p>
        <button class="btn primary" id="exPick" data-icon="image" data-icon-size="18"><span>画像を選ぶ</span></button>
        <p class="small" style="margin:10px 0 0">画像はこの端末のブラウザ内だけで解析され、外部へ送信・アップロードされません。</p>
      </div>
    </div>
    <div class="section" id="exResult" hidden>
      <div class="eyedrop" id="exEye">
        <img class="extract-preview" id="exImg" alt="読み込んだ画像。タップ・なぞると色を取れます" draggable="false">
        <div class="eyedrop-cursor" id="exCursor" hidden></div>
        <div class="loupe" id="exLoupe" hidden><canvas width="96" height="96"></canvas><span></span></div>
      </div>
      <p class="small muted" style="margin:8px 0 0;text-align:center">画像をタップ・なぞると、スポイトで好きな色を取れます</p>
      <div class="section" id="exPickBox" hidden>
        <h3 class="section-title">スポイトで取った色</h3>
        <div class="pick-card">
          <i class="pick-swatch" id="exPickSwatch"></i>
          <div class="grow"><b id="exPickName"></b><span class="mono muted" id="exPickHex"></span></div>
        </div>
        <div class="row" style="margin-top:8px">
          <button class="btn primary grow" id="exPickApply">選択中の四角形に適用</button>
          <button class="btn grow" id="exPickAdd">四角形として追加</button>
        </div>
        <div class="swatch-row" id="exPicks" style="margin-top:10px"></div>
      </div>
      <div class="row" style="justify-content:space-between;margin:18px 0 10px">
        <h3 class="section-title" style="margin:0">自動で抽出した色</h3>
        <div class="stepper" aria-label="抽出する色数">
          <button id="exMinus" aria-label="色数を減らす">−</button><span id="exCount"></span><button id="exPlus" aria-label="色数を増やす">＋</button>
        </div>
      </div>
      <div class="extract-colors" id="exColors"></div>
      <p class="small muted" style="margin-top:8px" id="exHint">自動で選んだ代表色です。色をタップすると、選択中の四角形に適用します（未選択の場合は四角形を追加します）。</p>
      <div class="row" style="margin-top:12px">
        <button class="btn grow" id="exAddAll">すべてを四角形として追加</button>
        <button class="btn" id="exAgain">別の画像</button>
      </div>
    </div>`;

  const fileInput = document.getElementById('fileInput');
  const drop = root.querySelector('#exDrop');

  const pick = () => { fileInput.value = ''; fileInput.click(); };
  root.querySelector('#exPick').addEventListener('click', pick);
  root.querySelector('#exAgain').addEventListener('click', pick);
  fileInput.addEventListener('change', () => { if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]); });

  // PCではドラッグ＆ドロップにも対応
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('is-over');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  async function handleFile(file) {
    if (busy) return;
    busy = true;
    const pickBtn = root.querySelector('#exPick');
    pickBtn.disabled = true;
    try {
      const { img, url } = await loadImageFile(file);
      pixels = imageToPixels(img);
      sampler = createSampler(img);
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = url;
      root.querySelector('#exImg').src = url;
      run();
      root.querySelector('#exResult').hidden = false;
      drop.hidden = true;
    } catch (e) {
      console.warn(e);
      toast(e && e.message ? e.message : '画像を読み込めませんでした。', { type: 'error', duration: 4500 });
    } finally {
      busy = false;
      pickBtn.disabled = false;
    }
  }

  function run() {
    if (!pixels) return;
    try {
      palette = extractPalette(pixels, count);
    } catch (e) {
      console.error(e);
      palette = [];
      toast('色の抽出に失敗しました。', { type: 'error' });
    }
    syncShared();
    if (!palette.length) toast('色を抽出できませんでした（透明な画像の可能性があります）。', { type: 'error' });
    render();
    emit('extract');
  }

  root.querySelector('#exMinus').addEventListener('click', () => { if (count > CONFIG.EXTRACT_MIN) { count--; run(); } });
  root.querySelector('#exPlus').addEventListener('click', () => { if (count < CONFIG.EXTRACT_MAX) { count++; run(); } });

  root.querySelector('#exColors').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hex]');
    if (!b) return;
    applyColor(b.dataset.hex);
    render();
  });

  root.querySelector('#exAddAll').addEventListener('click', () => {
    if (!palette.length) return;
    const work = state.work;
    const room = CONFIG.MAX_SHAPES - work.shapes.length;
    if (room < palette.length) { toast('四角形の数が上限に達するため追加できません', { type: 'error' }); return; }
    checkpoint();
    // 面積比に応じた帯状のパレットとして並べる
    const W = work.artboard.w, H = work.artboard.h;
    const margin = Math.round(W * 0.08);
    const bandH = Math.round(Math.min(H * 0.3, W * 0.36));
    const y = Math.round((H - bandH) / 2);
    let x = margin;
    const total = W - margin * 2;
    const minW = Math.max(CONFIG.MIN_SHAPE_SIZE, Math.round(total * 0.06));
    const weights = palette.map((c) => Math.max(c.ratio, 0.06));
    const sum = weights.reduce((a, b) => a + b, 0);
    let last = null;
    palette.forEach((c, i) => {
      const w = i === palette.length - 1 ? W - margin - x : Math.max(minW, Math.round((weights[i] / sum) * total));
      last = { id: newId(), x, y, w: Math.max(CONFIG.MIN_SHAPE_SIZE, w), h: bandH, color: c.hex };
      work.shapes.push(last);
      x += w;
    });
    state.selectedId = last ? last.id : null;
    changed('shapes');
    toast(`${palette.length}色を追加しました`);
  });

  /** 色パネルのパレットにも、スポイトの色・抽出した色を表示する */
  function syncShared() {
    const seen = new Set();
    ctx.extracted = [...picks.map((hex) => ({ hex })), ...palette].filter((c) => !seen.has(c.hex) && seen.add(c.hex));
  }

  /* ---------- スポイト ---------- */
  const eye = root.querySelector('#exEye');
  const imgEl = root.querySelector('#exImg');
  const cursor = root.querySelector('#exCursor');
  const loupe = root.querySelector('#exLoupe');
  const loupeCtx = loupe.querySelector('canvas').getContext('2d');
  let eyePointer = null;
  let live = null;

  function eyeAt(e) {
    const r = imgEl.getBoundingClientRect();
    if (!r.width || !r.height || !sampler) return null;
    const nx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const ny = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    const hex = sampler.sample(nx, ny);
    const er = eye.getBoundingClientRect();
    const x = r.left - er.left + nx * r.width, y = r.top - er.top + ny * r.height;
    cursor.hidden = false;
    cursor.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    // 指で隠れないよう、ルーペは指の上（上端付近では下）に表示
    const above = y > 80;
    loupe.hidden = false;
    loupe.style.transform = `translate(${x}px, ${above ? y - 70 : y + 70}px) translate(-50%, -50%)`;
    loupe.style.borderColor = hex || 'transparent';
    loupe.querySelector('span').textContent = hex ? hex.toUpperCase() : '透明';
    // 周辺を拡大して描画（1ピクセルずつ見えるように）
    const p = sampler.toPx(nx, ny);
    const span = 12;
    loupeCtx.imageSmoothingEnabled = false;
    loupeCtx.clearRect(0, 0, 96, 96);
    loupeCtx.drawImage(sampler.canvas, p.x - span / 2, p.y - span / 2, span, span, 0, 0, 96, 96);
    loupeCtx.strokeStyle = 'rgba(255,255,255,.9)';
    loupeCtx.lineWidth = 2;
    loupeCtx.strokeRect(48 - 8, 48 - 8, 16, 16);
    return hex;
  }

  eye.addEventListener('pointerdown', (e) => {
    if (!sampler || eyePointer !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    eyePointer = e.pointerId;
    try { eye.setPointerCapture(e.pointerId); } catch { /* noop */ }
    eye.classList.add('is-active');
    live = eyeAt(e);
  });
  eye.addEventListener('pointermove', (e) => {
    if (e.pointerId !== eyePointer) return;
    e.preventDefault();
    live = eyeAt(e);
  });
  const eyeEnd = (e) => {
    if (e.pointerId !== eyePointer) return;
    eyePointer = null;
    eye.classList.remove('is-active');
    loupe.hidden = true;
    if (e.type === 'pointercancel') { cursor.hidden = true; return; }
    if (!live) { toast('透明な部分です。別の場所を選んでください'); return; }
    setCurrent(live);
  };
  eye.addEventListener('pointerup', eyeEnd);
  eye.addEventListener('pointercancel', eyeEnd);
  eye.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  eye.addEventListener('contextmenu', (e) => e.preventDefault());

  function setCurrent(hex) {
    current = hex;
    picks = [hex, ...picks.filter((h) => h !== hex)].slice(0, 12);
    syncShared();
    renderPick();
    emit('extract');
  }

  function applyColor(hex, forceAdd = false) {
    const sel = selectedShape();
    if (sel && !forceAdd) {
      checkpoint();
      setShapeColor(sel.id, hex);
      toast('選択中の四角形に適用しました');
    } else {
      if (!addShape(hex)) { toast('これ以上四角形を追加できません', { type: 'error' }); return; }
      toast('四角形を追加しました');
    }
  }
  root.querySelector('#exPickApply').addEventListener('click', () => { if (current) applyColor(current); });
  root.querySelector('#exPickAdd').addEventListener('click', () => { if (current) applyColor(current, true); });
  root.querySelector('#exPicks').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hex]');
    if (b) { current = b.dataset.hex; renderPick(); }
  });

  function renderPick() {
    const box = root.querySelector('#exPickBox');
    box.hidden = !current;
    if (!current) return;
    const info = describeColor(current);
    root.querySelector('#exPickSwatch').style.background = current;
    root.querySelector('#exPickName').textContent = `${info.name.name}${info.name.exact ? '' : '（近似）'}`;
    root.querySelector('#exPickHex').textContent = `${current.toUpperCase()}　RGB ${info.rgb.r} ${info.rgb.g} ${info.rgb.b}`;
    const hasSel = !!selectedShape();
    root.querySelector('#exPickApply').hidden = !hasSel;
    const list = root.querySelector('#exPicks');
    const sig = picks.join(',') + '|' + current;
    if (list.dataset.sig !== sig) {
      list.dataset.sig = sig;
      list.innerHTML = picks.length > 1 ? picks.map((h) => `<button class="swatch${h === current ? ' is-on' : ''}" style="background:${h}" data-hex="${h}" aria-label="スポイトの色 ${h}"></button>`).join('') : '';
    }
  }

  function render() {
    renderPick();
    root.querySelector('#exCount').textContent = `${count}色`;
    root.querySelector('#exMinus').disabled = count <= CONFIG.EXTRACT_MIN;
    root.querySelector('#exPlus').disabled = count >= CONFIG.EXTRACT_MAX;
    const sel = selectedShape();
    const box = root.querySelector('#exColors');
    // 内容が変わらない場合は描き直さない（タップ中の要素が置き換わるのを防ぐ）
    const sig = palette.map((c) => `${c.hex}:${c.ratio}`).join(',') + '|' + (sel ? sel.color : '');
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.innerHTML = palette.map((c) => {
      const info = describeColor(c.hex);
      return `<button class="extract-color${sel && sel.color === c.hex ? ' is-applied' : ''}" data-hex="${c.hex}" aria-label="${escapeHtml(info.name.name)} ${c.hex}">
        <i style="background:${c.hex}"></i><span>${c.hex.toUpperCase()}<br>${Math.round(c.ratio * 100)}%</span></button>`;
    }).join('');
  }

  return {
    title: '画像から色を抽出',
    height: 'min(64dvh, calc(100dvh - 290px))',
    onOpen() { render(); },
    update(reasons) { if (palette.length && !reasons.has('drag')) render(); },
    handleFile,
  };
}
