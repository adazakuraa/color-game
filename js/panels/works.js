/** 作品の保存・一覧・お気に入り・削除 */
import { state, serialize, setWork, isDirty, flushDraft, createWork, emit } from '../store.js';
import { loadWorks, saveWorks, sanitizeWork, newId } from '../storage.js';
import { workThumbnailSVG } from '../exporter.js';
import { escapeHtml, toast, formatDate } from '../ui.js';
import { icon } from '../icons.js';

export function createWorksPanel(root, ctx) {
  let works = [];
  let filter = 'all';
  const initial = loadWorks();
  works = initial.works;
  if (initial.warning) setTimeout(() => toast(initial.warning, { type: 'error', duration: 5000 }), 600);

  root.innerHTML = `
    <div class="section">
      <h3 class="section-title">現在の作品</h3>
      <div class="row" style="margin-bottom:8px"><input class="input" id="wName" maxlength="60" placeholder="作品名" aria-label="作品名" enterkeyhint="done"></div>
      <div class="row">
        <button class="btn primary grow" id="wSave" data-icon="save" data-icon-size="18"><span>保存</span></button>
        <button class="btn grow" id="wSaveAs">別名で保存</button>
        <button class="btn" id="wNew" data-icon="newdoc" data-icon-size="18" aria-label="新規作成"><span>新規</span></button>
      </div>
      <p class="small muted" id="wStatus" style="margin-top:8px"></p>
    </div>
    <div class="section">
      <div class="row" style="justify-content:space-between;margin-bottom:10px">
        <h3 class="section-title" style="margin:0">保存した作品</h3>
        <div class="seg" style="width:auto"><button data-filter="all" class="is-on">すべて</button><button data-filter="fav">お気に入り</button></div>
      </div>
      <div id="wList"></div>
      <p class="note">作品はこの端末のブラウザ内（LocalStorage）に保存されます。ブラウザのデータを削除すると作品も消えます。別の端末やブラウザとは共有されません。</p>
    </div>`;

  const nameInput = root.querySelector('#wName');
  const list = root.querySelector('#wList');

  function persist(next, successMsg) {
    const res = saveWorks(next);
    if (!res.ok) {
      toast(res.error === 'quota' ? '保存容量が不足しています。不要な作品を削除してから再度お試しください。' : '保存に失敗しました。', { type: 'error', duration: 4500 });
      return false;
    }
    works = next;
    if (res.memoryOnly) toast('このブラウザでは永続保存が使えないため、ページを閉じると作品は消えます。', { type: 'error', duration: 4500 });
    else if (successMsg) toast(successMsg);
    return true;
  }

  function currentName() {
    const v = nameInput.value.trim() || state.work.name || '無題の作品';
    return v.slice(0, 60);
  }

  function save(asNew = false) {
    const w = state.work;
    w.name = currentName();
    const now = Date.now();
    const existing = !asNew && w.id ? works.findIndex((x) => x.id === w.id) : -1;
    const record = JSON.parse(JSON.stringify({ ...w, updatedAt: now }));
    let next;
    if (existing >= 0) {
      record.favorite = works[existing].favorite;
      record.createdAt = works[existing].createdAt;
      next = works.slice();
      next[existing] = record;
    } else {
      record.id = newId();
      record.createdAt = now;
      record.favorite = asNew ? false : !!w.favorite;
      if (asNew && w.id) record.name = uniqueName(record.name);
      next = [record, ...works];
    }
    if (!persist(next, existing >= 0 ? '上書き保存しました' : '保存しました')) return;
    w.id = record.id;
    w.name = record.name;
    w.favorite = record.favorite;
    state.savedSnapshot = serialize(w);
    flushDraft();
    ctx.syncName();
    emit('saved');
    render();
  }

  function uniqueName(name) {
    if (!works.some((w) => w.name === name)) return name;
    let i = 2;
    while (works.some((w) => w.name === `${name} (${i})`)) i++;
    return `${name} (${i})`;
  }

  function confirmDiscard() {
    return !isDirty() || window.confirm('現在の作品には保存されていない変更があります。破棄して続けますか？');
  }

  function open(id) {
    const rec = works.find((w) => w.id === id);
    if (!rec) return;
    if (state.work.id === id && !isDirty()) { toast('この作品を編集中です'); ctx.closeSheet(); return; }
    if (!confirmDiscard()) return;
    const w = sanitizeWork(rec);
    if (!w) { toast('この作品データは読み込めませんでした', { type: 'error' }); return; }
    setWork(w);
    ctx.syncName();
    toast(`「${w.name}」を開きました`);
    ctx.closeSheet();
  }

  function toggleFav(id) {
    const next = works.map((w) => (w.id === id ? { ...w, favorite: !w.favorite } : w));
    if (!persist(next)) return;
    const rec = next.find((w) => w.id === id);
    if (state.work.id === id) state.work.favorite = rec.favorite;
    toast(rec.favorite ? 'お気に入りに追加しました' : 'お気に入りを解除しました');
    render();
  }

  function remove(id) {
    const rec = works.find((w) => w.id === id);
    if (!rec || !window.confirm(`「${rec.name}」を削除しますか？この操作は取り消せません。`)) return;
    if (!persist(works.filter((w) => w.id !== id), '削除しました')) return;
    if (state.work.id === id) { state.work.id = null; state.savedSnapshot = ''; emit('saved'); }
    render();
  }

  function newWork() {
    if (!confirmDiscard()) return;
    const s = ctx.stageSize();
    setWork(createWork(s.w, s.h));
    ctx.syncName();
    toast('新しい作品を作成しました');
    ctx.closeSheet();
  }

  root.querySelector('#wSave').addEventListener('click', () => save(false));
  root.querySelector('#wSaveAs').addEventListener('click', () => save(true));
  root.querySelector('#wNew').addEventListener('click', newWork);
  nameInput.addEventListener('change', () => { state.work.name = currentName(); ctx.syncName(); emit('name'); });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(false); nameInput.blur(); } });
  root.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.filter;
    root.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('is-on', x === b));
    render();
  }));
  list.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const id = t.closest('[data-id]').dataset.id;
    if (t.dataset.act === 'open') open(id);
    else if (t.dataset.act === 'fav') toggleFav(id);
    else if (t.dataset.act === 'delete') remove(id);
  });

  function render() {
    nameInput.value = state.work.name;
    const saved = state.work.id && works.some((w) => w.id === state.work.id);
    root.querySelector('#wSave').querySelector('span').textContent = saved ? '上書き保存' : '保存';
    root.querySelector('#wStatus').textContent = saved ? (isDirty() ? '保存されていない変更があります。' : '保存済みです。') : 'まだ保存されていません。';
    const items = works.filter((w) => filter === 'all' || w.favorite);
    if (!items.length) {
      list.innerHTML = `<div class="empty-state">${filter === 'fav' ? 'お気に入りの作品はまだありません。☆をタップして登録できます。' : '保存した作品はまだありません。'}</div>`;
      return;
    }
    list.innerHTML = `<div class="works-grid">${items.map((w) => `
      <div class="work-card${w.id === state.work.id ? ' is-current' : ''}" data-id="${escapeHtml(w.id)}">
        <button class="work-thumb" data-act="open" aria-label="${escapeHtml(w.name)}を開く">${workThumbnailSVG(w)}</button>
        <div class="work-meta">
          <div class="grow">${escapeHtml(w.name)}<span class="date">${formatDate(w.updatedAt)}</span></div>
          <button class="icon-btn fav${w.favorite ? ' is-on' : ''}" data-act="fav" aria-label="お気に入り" aria-pressed="${w.favorite}">${icon('star', 19)}</button>
          <button class="icon-btn" data-act="delete" aria-label="削除">${icon('trash', 18)}</button>
        </div>
      </div>`).join('')}</div>`;
  }

  return {
    title: '作品',
    height: 'min(64dvh, calc(100dvh - 290px))',
    onOpen: render,
    update(reasons) { if (!reasons.has('drag') && document.activeElement !== nameInput) render(); },
    newWork,
    save,
    get works() { return works; },
  };
}
