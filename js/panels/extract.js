/** 画像からの色抽出パネル（画像は端末内でのみ処理し、外部に送信しない） */
import { CONFIG } from '../config.js';
import { state, selectedShape, setShapeColor, checkpoint, addShape, changed, emit } from '../store.js';
import { loadImageFile, imageToPixels, extractPalette } from '../extract.js';
import { describeColor } from '../color.js';
import { escapeHtml, toast } from '../ui.js';
import { newId } from '../storage.js';

export function createExtractPanel(root, ctx) {
  let count = CONFIG.EXTRACT_COLOR_COUNT;
  let pixels = null;
  let imageUrl = null;
  let palette = [];
  let busy = false;

  root.innerHTML = `
    <div class="section">
      <div class="dropzone" id="exDrop">
        <p style="margin:0 0 10px">写真やイラストから代表的な色を取り出します。</p>
        <button class="btn primary" id="exPick" data-icon="image" data-icon-size="18"><span>画像を選ぶ</span></button>
        <p class="small" style="margin:10px 0 0">画像はこの端末のブラウザ内だけで解析され、外部へ送信・アップロードされません。</p>
      </div>
    </div>
    <div class="section" id="exResult" hidden>
      <img class="extract-preview" id="exImg" alt="読み込んだ画像">
      <div class="row" style="justify-content:space-between;margin:14px 0 10px">
        <h3 class="section-title" style="margin:0">抽出した色</h3>
        <div class="stepper" aria-label="抽出する色数">
          <button id="exMinus" aria-label="色数を減らす">−</button><span id="exCount"></span><button id="exPlus" aria-label="色数を増やす">＋</button>
        </div>
      </div>
      <div class="extract-colors" id="exColors"></div>
      <p class="small muted" style="margin-top:8px" id="exHint">色をタップすると、選択中の四角形に適用します（未選択の場合は四角形を追加します）。</p>
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
    ctx.extracted = palette;
    if (!palette.length) toast('色を抽出できませんでした（透明な画像の可能性があります）。', { type: 'error' });
    render();
    emit('extract');
  }

  root.querySelector('#exMinus').addEventListener('click', () => { if (count > CONFIG.EXTRACT_MIN) { count--; run(); } });
  root.querySelector('#exPlus').addEventListener('click', () => { if (count < CONFIG.EXTRACT_MAX) { count++; run(); } });

  root.querySelector('#exColors').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hex]');
    if (!b) return;
    const hex = b.dataset.hex;
    const sel = selectedShape();
    if (sel) {
      checkpoint();
      setShapeColor(sel.id, hex);
      toast('選択中の四角形に適用しました');
    } else {
      if (!addShape(hex)) { toast('これ以上四角形を追加できません', { type: 'error' }); return; }
      toast('四角形を追加しました');
    }
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

  function render() {
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
