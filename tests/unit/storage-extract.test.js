import test from 'node:test';
import assert from 'node:assert/strict';

// LocalStorage のモック（容量超過も再現）
class MockStorage {
  constructor() { this.map = new Map(); this.quota = Infinity; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) {
    const size = [...this.map.entries()].reduce((s, [kk, vv]) => s + (kk === k ? 0 : vv.length), 0) + String(v).length;
    if (size > this.quota) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
    this.map.set(k, String(v));
  }
  removeItem(k) { this.map.delete(k); }
}
const ls = new MockStorage();
globalThis.window = { localStorage: ls };

const { sanitizeWork, loadWorks, saveWorks, KEYS, loadDraft, saveDraft, loadSettings, saveSettings } = await import('../../js/storage.js');
const { extractPalette } = await import('../../js/extract.js');
const { colorDifference } = await import('../../js/color.js');

test('sanitizeWork：不正なデータを修復・除外する', () => {
  assert.equal(sanitizeWork(null), null);
  assert.equal(sanitizeWork('x'), null);
  assert.equal(sanitizeWork([]), null);
  const w = sanitizeWork({
    id: 'abc', name: '  テスト  ', background: 'red', artboard: { h: 'x' },
    shapes: [
      { id: 's1', x: 10, y: 20, w: 100, h: 50, color: '#FF0000' },
      { id: 's1', x: 0, y: 0, w: 5, h: 5, color: '#00ff00' }, // 重複ID・小さすぎ
      { x: 'a', y: 0, w: 10, h: 10, color: '#000' },
      { x: 0, y: 0, w: 10, h: 10, color: 'javascript:alert(1)' },
      null, 42,
    ],
  });
  assert.equal(w.name, 'テスト');
  assert.equal(w.background, '#f4f1ea');
  assert.equal(w.artboard.w, 1000);
  assert.equal(w.shapes.length, 2);
  assert.equal(w.shapes[0].color, '#ff0000');
  assert.notEqual(w.shapes[0].id, w.shapes[1].id);
  assert.ok(w.shapes[1].w >= 24);
});

test('作品の保存と読み込み（重なり順を保持）', () => {
  const works = [{
    id: 'w1', name: '作品1', favorite: true, createdAt: 1, updatedAt: 2, background: '#ffffff', aspect: '1:1', artboard: { w: 1000, h: 1000 },
    shapes: [
      { id: 'a', x: 0, y: 0, w: 100, h: 100, color: '#112233' },
      { id: 'b', x: 50, y: 50, w: 300, h: 120, color: '#445566' },
    ],
  }];
  assert.ok(saveWorks(works).ok);
  const { works: loaded, warning } = loadWorks();
  assert.equal(warning, null);
  assert.deepEqual(loaded, works);
});

test('破損データ：バックアップして初期化、アプリは停止しない', () => {
  ls.setItem(KEYS.works, '{broken json');
  const { works, warning } = loadWorks();
  assert.deepEqual(works, []);
  assert.ok(warning);
  assert.equal(ls.getItem(KEYS.backup), '{broken json');
  // 一部の作品だけ壊れている場合
  ls.setItem(KEYS.works, JSON.stringify([{ id: 'ok', shapes: [] }, 'bad', { noid: true }]));
  const r2 = loadWorks();
  assert.equal(r2.works.length, 1);
  assert.match(r2.warning, /2件/);
});

test('容量超過をエラーとして返す', () => {
  ls.quota = 50;
  const res = saveWorks([{ id: 'x'.repeat(100) }]);
  assert.equal(res.ok, false);
  assert.equal(res.error, 'quota');
  ls.quota = Infinity;
});

test('下書きと設定', () => {
  saveDraft({ id: null, name: 'd', background: '#000000', artboard: { w: 1000, h: 800 }, shapes: [{ id: 'q', x: 1, y: 2, w: 30, h: 40, color: '#abcdef' }] }, 'snap');
  const d = loadDraft();
  assert.equal(d.work.shapes[0].color, '#abcdef');
  assert.equal(d.savedSnapshot, 'snap');
  ls.setItem(KEYS.draft, 'garbage');
  assert.equal(loadDraft(), null);
  saveSettings({ theme: 'dark', hintsShown: { a: true } });
  assert.equal(loadSettings().theme, 'dark');
  ls.setItem(KEYS.settings, '{{{');
  assert.equal(loadSettings().theme, null);
});

test('画像からの色抽出（合成画像）', () => {
  // 70% 赤, 30% 青 の画像 + 透明ピクセル
  const n = 1000;
  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const c = i < 700 ? [220, 30, 40, 255] : i < 1000 - 50 ? [20, 60, 200, 255] : [0, 255, 0, 0];
    data.set(c, i * 4);
  }
  const pal = extractPalette(data, 5);
  assert.equal(pal.length, 2, JSON.stringify(pal));
  assert.ok(colorDifference(pal[0].hex, '#dc1e28') < 1);
  assert.ok(Math.abs(pal[0].ratio - 700 / 950) < 0.01);
  assert.ok(colorDifference(pal[1].hex, '#143cc8') < 1);
  // 同じ入力なら同じ結果（決定的）
  assert.deepEqual(extractPalette(data, 5), pal);
  // 透明のみ
  assert.deepEqual(extractPalette(new Uint8ClampedArray(40), 5), []);
});

test('グラデーション画像から指定数の色を抽出', () => {
  const n = 64 * 64;
  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) data.set([(i % 64) * 4, Math.floor(i / 64) * 4, 128, 255], i * 4);
  const pal = extractPalette(data, 6);
  assert.equal(pal.length, 6);
  const total = pal.reduce((s, c) => s + c.ratio, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  for (let i = 1; i < pal.length; i++) assert.ok(pal[i - 1].ratio >= pal[i].ratio);
});
