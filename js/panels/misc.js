/** 画像出力・キャンバス設定・使い方パネル */
import { CONFIG } from '../config.js';
import { state, setBackground, checkpoint, setAspect, changed } from '../store.js';
import { renderWorkToCanvas, canvasToBlob, safeFileName } from '../exporter.js';
import { toast, debounce } from '../ui.js';

function backgroundSwatches(withTransparent = true) {
  const cur = state.work.background;
  const presets = [...CONFIG.BACKGROUND_PRESETS];
  const used = [...new Set(state.work.shapes.map((s) => s.color))].filter((h) => !presets.includes(h)).slice(0, 8);
  let html = presets.map((h) => `<button class="swatch${cur === h ? ' is-on' : ''}" style="background:${h}" data-bg="${h}" aria-label="背景色 ${h}"></button>`).join('');
  if (withTransparent) html += `<button class="swatch transparent is-transparent-bg${cur === 'transparent' ? ' is-on' : ''}" data-bg="transparent" aria-label="透明（PNGのみ）" title="透明"></button>`;
  if (!presets.includes(cur) && cur !== 'transparent' && !used.includes(cur)) used.unshift(cur);
  html += used.map((h) => `<button class="swatch${cur === h ? ' is-on' : ''}" style="background:${h}" data-bg="${h}" aria-label="背景色 ${h}"></button>`).join('');
  return html;
}

function bindBackground(el) {
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-bg]');
    if (!b) return;
    if (state.work.background === b.dataset.bg) return;
    checkpoint();
    setBackground(b.dataset.bg);
  });
}

/* ---------- 画像出力 ---------- */

export function createExportPanel(root, ctx) {
  root.innerHTML = `
    <div class="section">
      <div class="export-wrap"><img class="export-preview" id="xPreview" alt="出力プレビュー"></div>
      <p class="small muted" style="margin-top:8px" id="xInfo"></p>
    </div>
    <div class="section">
      <h3 class="section-title">背景色</h3>
      <div class="swatch-row bg-swatches" id="xBg"></div>
      <div class="row" style="margin-top:10px"><button class="btn small" id="xBgWheel">色相環で背景色を選ぶ</button></div>
    </div>
    <div class="section">
      <div class="row wrap">
        <button class="btn primary grow" id="xDownload" data-icon="download" data-icon-size="18"><span>PNGを保存</span></button>
        <button class="btn grow" id="xShare" data-icon="share" data-icon-size="18" hidden><span>共有・写真に保存</span></button>
      </div>
      <p class="note">キャンバス部分のみを PNG 画像として書き出します（端末内で生成し、外部には送信しません）。iPhone では「共有・写真に保存」から写真アプリに保存できます。うまく保存できない場合は、プレビュー画像を長押しして保存してください。</p>
    </div>`;

  const preview = root.querySelector('#xPreview');
  const bgEl = root.querySelector('#xBg');
  bindBackground(bgEl);
  root.querySelector('#xBgWheel').addEventListener('click', () => ctx.openPanel('color', { target: 'background' }));

  let previewUrl = null;
  async function renderPreview() {
    try {
      const canvas = renderWorkToCanvas(state.work, { longSide: 900 });
      const blob = await canvasToBlob(canvas);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      preview.src = previewUrl;
      const W = state.work.artboard.w, H = state.work.artboard.h, s = CONFIG.EXPORT_LONG_SIDE / Math.max(W, H);
      root.querySelector('#xInfo').textContent = `出力サイズ：${Math.round(W * s)} × ${Math.round(H * s)} px ／ 四角形 ${state.work.shapes.length} 個${state.work.background === 'transparent' ? ' ／ 背景透明' : ''}`;
    } catch (e) {
      console.error(e);
    }
  }
  const renderPreviewSoon = debounce(renderPreview, 200);

  async function makeFile() {
    const canvas = renderWorkToCanvas(state.work);
    const blob = await canvasToBlob(canvas);
    const name = safeFileName(state.work.name);
    return { blob, name };
  }

  const shareBtn = root.querySelector('#xShare');
  try {
    const probe = new File([new Blob(['x'], { type: 'image/png' })], 'probe.png', { type: 'image/png' });
    shareBtn.hidden = !(navigator.canShare && navigator.canShare({ files: [probe] }));
  } catch { shareBtn.hidden = true; }

  root.querySelector('#xDownload').addEventListener('click', async () => {
    try {
      const { blob, name } = await makeFile();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      toast('PNG画像を書き出しました');
    } catch (e) {
      console.error(e);
      toast('画像の書き出しに失敗しました', { type: 'error' });
    }
  });

  shareBtn.addEventListener('click', async () => {
    try {
      const { blob, name } = await makeFile();
      const file = new File([blob], name, { type: 'image/png' });
      await navigator.share({ files: [file], title: state.work.name });
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      console.error(e);
      toast('共有できませんでした。「PNGを保存」をお試しください。', { type: 'error' });
    }
  });

  function update(reasons) {
    if (reasons && reasons.has('drag')) return;
    bgEl.innerHTML = backgroundSwatches(true);
    renderPreviewSoon();
  }

  return { title: '画像として書き出す', height: 'min(64dvh, calc(100dvh - 290px))', onOpen() { update(); renderPreview(); }, update };
}

/* ---------- キャンバス設定 ---------- */

export function createCanvasPanel(root, ctx) {
  const aspects = [['fit', '画面に合わせる'], ['1:1', '1:1'], ['4:5', '4:5'], ['3:4', '3:4'], ['9:16', '9:16'], ['16:9', '16:9']];
  root.innerHTML = `
    <div class="section">
      <h3 class="section-title">背景色</h3>
      <div class="swatch-row bg-swatches" id="kBg"></div>
      <div class="row" style="margin-top:10px"><button class="btn small" id="kBgWheel">色相環で背景色を選ぶ</button></div>
    </div>
    <div class="section">
      <h3 class="section-title">キャンバスの縦横比</h3>
      <div class="seg" id="kAspect">${aspects.map(([k, l]) => `<button data-aspect="${k}">${l}</button>`).join('')}</div>
      <p class="small muted" style="margin-top:8px">縦横比を変えると、四角形の大きさを保ったまま位置を調整します。「画面に合わせる」は現在の画面の比率になります。</p>
    </div>
    <div class="section">
      <h3 class="section-title">キャンバスの操作</h3>
      <div class="row wrap">
        <button class="btn" id="kClear" data-icon="trash" data-icon-size="18"><span>すべての四角形を削除</span></button>
        <button class="btn" id="kNew" data-icon="newdoc" data-icon-size="18"><span>新しい作品</span></button>
      </div>
    </div>`;
  const bgEl = root.querySelector('#kBg');
  bindBackground(bgEl);
  root.querySelector('#kBgWheel').addEventListener('click', () => ctx.openPanel('color', { target: 'background' }));
  root.querySelector('#kAspect').addEventListener('click', (e) => {
    const b = e.target.closest('[data-aspect]');
    if (!b) return;
    const s = ctx.stageSize();
    setAspect(b.dataset.aspect, s.w, s.h);
  });
  root.querySelector('#kClear').addEventListener('click', () => {
    if (!state.work.shapes.length) return;
    if (!window.confirm('すべての四角形を削除しますか？（「元に戻す」で復元できます）')) return;
    checkpoint();
    state.work.shapes = [];
    state.selectedId = null;
    changed('shapes');
  });
  root.querySelector('#kNew').addEventListener('click', () => ctx.newWork());

  function update(reasons) {
    if (reasons && reasons.has('drag')) return;
    bgEl.innerHTML = backgroundSwatches(true);
    root.querySelectorAll('[data-aspect]').forEach((b) => b.classList.toggle('is-on', b.dataset.aspect === state.work.aspect));
  }
  return { title: 'キャンバス設定', height: '52dvh', onOpen: () => update(), update };
}

/* ---------- 使い方 ---------- */

export function createHelpPanel(root) {
  root.innerHTML = `
    <div class="section">
      <h3 class="section-title">基本の操作</h3>
      <ol class="help-list">
        <li><b>追加</b>で四角形を増やし、タップで選択します。</li>
        <li>ドラッグで移動、四隅・辺の<b>白い丸</b>をドラッグでサイズ変更（縦長・横長も自由）。</li>
        <li>選択中の四角形は<b>2本指のピンチ</b>でも拡大・縮小できます。</li>
        <li>重なっている場所で選択中の四角形を<b>もう一度タップ</b>すると、下にある四角形を順に選択できます。</li>
        <li>下のバーから<b>複製・前面・背面・削除</b>ができます。</li>
        <li><b>色</b>を開き、色相環の円周をなぞって色を選びます。キャンバスを見ながら調整できます。</li>
      </ol>
    </div>
    <div class="section">
      <h3 class="section-title">便利な機能</h3>
      <ul class="help-list">
        <li><b>解説</b>：配色の型・色相の関係・暖寒バランス・印象・コントラスト比・色覚シミュレーション・色彩理論。</li>
        <li><b>抽出</b>：写真から代表的な色を取り出して使えます（端末内で処理）。</li>
        <li><b>作品</b>：名前を付けて保存、お気に入り登録、再編集ができます。</li>
        <li><b>画像</b>：PNG画像として保存・共有できます。</li>
        <li>編集内容は自動で下書き保存され、ページを再読み込みしても続きから再開できます。</li>
      </ul>
    </div>
    <div class="section">
      <h3 class="section-title">キーボード（PC）</h3>
      <ul class="help-list">
        <li><kbd>Delete</kbd> 削除 ／ <kbd>Ctrl</kbd>+<kbd>D</kbd> 複製 ／ <kbd>矢印</kbd> 移動（<kbd>Shift</kbd>で大きく）</li>
        <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> 元に戻す ／ <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> やり直す ／ <kbd>Esc</kbd> 選択解除</li>
      </ul>
    </div>
    <p class="note">色相環で選ぶ色の彩度・明度は一定です（js/config.js の定数で変更できます）。画像から抽出した色はそのままの彩度・明度で使えます。</p>`;
  return { title: '使い方', height: 'min(64dvh, calc(100dvh - 290px))', onOpen() {}, update() {} };
}

