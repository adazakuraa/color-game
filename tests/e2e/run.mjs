/**
 * E2Eテスト（Playwright / Chromium）
 * - GitHub Pages と同じく「/color-game/」のサブパスで静的配信して検証
 * - スマートフォンのタッチ操作は CDP の Input.dispatchTouchEvent で実際のタッチイベントとして送信
 *
 * 実行: node tests/e2e/run.mjs   （playwright が必要）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'tests/e2e/output');
fs.mkdirSync(OUT, { recursive: true });
const BASE = '/color-game/';

/* ---------- GitHub Pages を模した静的サーバー ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.md': 'text/markdown' };
const requested = [];
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  requested.push(url);
  if (!url.startsWith(BASE)) { res.writeHead(404); res.end('not found'); return; }
  let file = path.join(ROOT, url.slice(BASE.length));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const URL_APP = ORIGIN + BASE;

/* ---------- 小さなテストフレームワーク ---------- */
const results = [];
let currentDevice = '';
async function check(id, name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ device: currentDevice, id, name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✔ [${id}] ${name}`);
  } catch (e) {
    results.push({ device: currentDevice, id, name, ok: false, err: e.message.split('\n')[0] });
    console.log(`  ✘ [${id}] ${name}\n      ${e.message.split('\n')[0]}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
const near = (a, b, eps) => Math.abs(a - b) <= eps;

/* ---------- 独立実装（アプリのコードを使わずに検証するため） ---------- */
function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function hueOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 0;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60; return h < 0 ? h + 360 : h;
}
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/* ---------- タッチ操作ヘルパー ---------- */
async function touchDrag(cdp, from, to, steps = 10) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, id: 1 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function touchPath(cdp, pts) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...pts[0], id: 1 }] });
  for (const p of pts.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...p, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function pinch(cdp, c, d0, d1, steps = 8) {
  const pts = (d) => [{ x: c.x - d / 2, y: c.y, id: 1 }, { x: c.x + d / 2, y: c.y, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(d0) });
  for (let i = 1; i <= steps; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d0 + ((d1 - d0) * i) / steps) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const center = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const tick = (page, ms = 120) => page.waitForTimeout(ms);
const work = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__iroawase.state.work)));
const selectedId = (page) => page.evaluate(() => window.__iroawase.state.selectedId);
const shapeBox = async (page, id) => page.locator(`.shape[data-id="${id}"]`).boundingBox();
const selectShape = (page, id) => page.evaluate((x) => window.__iroawase.select(x), id);

async function tapEl(page, selector) {
  const loc = page.locator(selector).first();
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  assert(b, `not visible: ${selector}`);
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await tick(page);
}
async function wheelPoint(page, hue) {
  const b = await page.locator('#hueWheel').boundingBox();
  const size = b.width, ring = Math.max(18, size * 0.11), r = size / 2 - ring / 2 - 2;
  const a = ((hue - 90) * Math.PI) / 180;
  return { x: b.x + size / 2 + Math.cos(a) * r, y: b.y + size / 2 + Math.sin(a) * r };
}

/* ---------- スマートフォン（タッチ）での総合テスト ---------- */
async function mobileSuite(browser, deviceName) {
  currentDevice = deviceName;
  console.log(`\n■ ${deviceName}`);
  const context = await browser.newContext({ ...devices[deviceName], acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  const external = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith(ORIGIN) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) external.push(r.url()); });
  const cdp = await context.newCDPSession(page);
  await page.goto(URL_APP);
  await page.waitForSelector('.shape');
  await tick(page, 400);
  const slug = deviceName.replace(/\s+/g, '-');
  await page.screenshot({ path: `${OUT}/${slug}-01-initial.png` });

  await check(3, '四角形を追加・削除できる', async () => {
    const n0 = (await work(page)).shapes.length;
    await tapEl(page, '#addBtn');
    await tapEl(page, '#addBtn');
    let w = await work(page);
    assert(w.shapes.length === n0 + 2, `add: ${n0} → ${w.shapes.length}`);
    assert((await selectedId(page)) === w.shapes.at(-1).id, '追加した四角形が選択される');
    await tapEl(page, '[data-act="delete"]');
    w = await work(page);
    assert(w.shapes.length === n0 + 1, `delete: → ${w.shapes.length}`);
    assert((await selectedId(page)) === null, '削除後は未選択');
  });

  await check(4, 'ドラッグで四角形を移動できる（タッチ）', async () => {
    const w = await work(page);
    const s = w.shapes[0];
    await selectShape(page, s.id); // 下にある四角形でも、選択中なら優先してドラッグできる
    await tick(page);
    const b = await shapeBox(page, s.id);
    const c = center(b);
    await touchDrag(cdp, c, { x: c.x + 50, y: c.y - 40 });
    await tick(page);
    const s2 = (await work(page)).shapes.find((x) => x.id === s.id);
    const scale = b.width / s.w;
    assert(near(s2.x - s.x, 50 / scale, 3) && near(s2.y - s.y, -40 / scale, 3), `moved by ${s2.x - s.x},${s2.y - s.y} expected ${50 / scale},${-40 / scale}`);
    assert((await selectedId(page)) === s.id, 'ドラッグした四角形が選択される');
    assert(await page.evaluate(() => window.scrollY === 0 && document.scrollingElement.scrollTop === 0), 'ページがスクロールしない');
  });

  await check(5, 'ハンドル・ピンチでサイズ変更（縦長・横長も可）', async () => {
    const id = await selectedId(page);
    const s = (await work(page)).shapes.find((x) => x.id === id);
    const scale = (await shapeBox(page, id)).width / s.w;
    // 右辺ハンドル：幅のみ変更 → 横長
    const e = center(await page.locator('.handle-e').boundingBox());
    await touchDrag(cdp, e, { x: e.x + 40, y: e.y });
    await tick(page);
    let s2 = (await work(page)).shapes.find((x) => x.id === id);
    assert(near(s2.w - s.w, 40 / scale, 3) && s2.h === s.h, `east: w ${s.w}→${s2.w}, h ${s.h}→${s2.h}`);
    // 下辺ハンドル：高さのみ変更 → 縦長
    const so = center(await page.locator('.handle-s').boundingBox());
    await touchDrag(cdp, so, { x: so.x, y: so.y + 70 });
    await tick(page);
    let s3 = (await work(page)).shapes.find((x) => x.id === id);
    assert(near(s3.h - s2.h, 70 / scale, 3) && s3.w === s2.w, `south: h ${s2.h}→${s3.h}`);
    // 左上の角ハンドル：位置とサイズを同時に変更
    const nw = center(await page.locator('.handle-nw').boundingBox());
    await touchDrag(cdp, nw, { x: nw.x + 20, y: nw.y + 20 });
    await tick(page);
    const s4 = (await work(page)).shapes.find((x) => x.id === id);
    assert(s4.w < s3.w && s4.h < s3.h && s4.x > s3.x && s4.y > s3.y, 'nw handle');
    assert(near(s4.x + s4.w, s3.x + s3.w, 1) && near(s4.y + s4.h, s3.y + s3.h, 1), '反対側の辺は固定');
    // 最小サイズ
    const se = center(await page.locator('.handle-se').boundingBox());
    await touchDrag(cdp, se, { x: se.x - 600, y: se.y - 600 });
    await tick(page);
    const s5 = (await work(page)).shapes.find((x) => x.id === id);
    assert(s5.w >= 24 && s5.h >= 24, `min size ${s5.w}x${s5.h}`);
    await page.click('#undoBtn');
    await tick(page);
    const s6 = (await work(page)).shapes.find((x) => x.id === id);
    assert(s6.w === s4.w && s6.h === s4.h, '元に戻す');
    // 2本指ピンチで拡大
    const c = center(await shapeBox(page, id));
    await pinch(cdp, c, 60, 120);
    await tick(page);
    const s7 = (await work(page)).shapes.find((x) => x.id === id);
    assert(s7.w > s6.w * 1.5 && near(s7.w / s7.h, s6.w / s6.h, 0.05), `pinch ${s6.w}x${s6.h} → ${s7.w}x${s7.h}`);
    // ハンドルのタッチ領域が十分な大きさ
    const hb = await page.locator('.handle-se').boundingBox();
    assert(hb.width >= 44 && hb.height >= 44, 'handle hit area >= 44px');
  });

  await check(6, '四角形を複製できる', async () => {
    const w0 = await work(page);
    const id = await selectedId(page);
    const src = w0.shapes.find((x) => x.id === id);
    await tapEl(page, '[data-act="duplicate"]');
    const w1 = await work(page);
    const nid = await selectedId(page);
    const dup = w1.shapes.find((x) => x.id === nid);
    assert(w1.shapes.length === w0.shapes.length + 1, 'count +1');
    assert(nid !== id && dup.color === src.color && dup.w === src.w && dup.h === src.h, '同じ色・サイズ');
    assert(dup.x !== src.x || dup.y !== src.y, '少しずらして配置');
    assert(w1.shapes.indexOf(dup) === w1.shapes.findIndex((x) => x.id === id) + 1, '元の直上に配置');
  });

  await check(7, '四角形同士を重ねられる／重なった四角形をタップで選択できる', async () => {
    let w = await work(page);
    const top = w.shapes.at(-1);
    const under = w.shapes.at(-2);
    // 2つは重なっているはず（複製直後）
    const ov = top.x < under.x + under.w && under.x < top.x + top.w && top.y < under.y + under.h && under.y < top.y + top.h;
    assert(ov, '重なっている');
    const tb = await shapeBox(page, top.id), ub = await shapeBox(page, under.id);
    // 重なり部分の中心をタップ
    const ox = (Math.max(tb.x, ub.x) + Math.min(tb.x + tb.width, ub.x + ub.width)) / 2;
    const oy = (Math.max(tb.y, ub.y) + Math.min(tb.y + tb.height, ub.y + ub.height)) / 2;
    // その点にある四角形（上から順）をデータから求め、タップごとに順に選択されることを確認
    const pt = await page.evaluate(({ ox, oy }) => {
      const st = window.__iroawase.state; const r = document.querySelector('#artboard').getBoundingClientRect();
      const sc = r.width / st.work.artboard.w; return { x: (ox - r.left) / sc, y: (oy - r.top) / sc };
    }, { ox, oy });
    const hits = w.shapes.filter((q) => pt.x >= q.x && pt.x <= q.x + q.w && pt.y >= q.y && pt.y <= q.y + q.h).reverse().map((q) => q.id);
    const start = hits.indexOf(await selectedId(page));
    assert(start >= 0 && hits.length >= 2, `hits ${hits.length}`);
    for (let i = 1; i <= hits.length; i++) {
      await page.touchscreen.tap(ox, oy); await tick(page);
      const now = await selectedId(page);
      assert(now === hits[(start + i) % hits.length], `tap ${i}: 下の四角形を順に選択 now=${hits.indexOf(now)} hits=${hits.length} pt=${Math.round(pt.x)},${Math.round(pt.y)} sel=${JSON.stringify(w.shapes.map((q) => [q.x, q.y, q.w, q.h]))}`);
    }
    // 背面・前面
    const cur = await selectedId(page);
    await tapEl(page, '[data-act="back"]');
    w = await work(page);
    assert(w.shapes[0].id === cur, '最背面へ');
    await tapEl(page, '[data-act="front"]');
    w = await work(page);
    assert(w.shapes.at(-1).id === cur, '最前面へ');
    // DOMの重なり順も一致
    const order = await page.$$eval('#artboard .shape', (els) => els.map((e) => e.dataset.id));
    assert(JSON.stringify(order) === JSON.stringify(w.shapes.map((s) => s.id)), 'DOM順 = データ順');
    // 何もない所をタップで選択解除
    const ab = await page.locator('#artboard').boundingBox();
    await page.touchscreen.tap(ab.x + 6, ab.y + 6); await tick(page);
    assert((await selectedId(page)) === null, '選択解除');
  });

  await check(1, '色相環をタップ・ドラッグして色を選択できる（画面はスクロールしない）', async () => {
    const w = await work(page);
    const target = w.shapes[0];
    await selectShape(page, target.id);
    await tick(page);
    await tapEl(page, '.tool[data-open="color"]');
    await page.waitForSelector('#hueWheel canvas');
    await tick(page, 300);
    await page.screenshot({ path: `${OUT}/${slug}-02-color.png` });
    const p = await wheelPoint(page, 200);
    await page.touchscreen.tap(p.x, p.y); await tick(page);
    let s = (await work(page)).shapes.find((x) => x.id === target.id);
    assert(hueDist(hueOf(s.color), 200) <= 3, `tap hue ${hueOf(s.color)}`);
    // 円周に沿ってドラッグ (200° → 320°)
    const pts = [];
    for (let h = 200; h <= 320; h += 10) pts.push(await wheelPoint(page, h));
    await touchPath(cdp, pts); await tick(page);
    s = (await work(page)).shapes.find((x) => x.id === target.id);
    assert(hueDist(hueOf(s.color), 320) <= 3, `drag hue ${hueOf(s.color)}`);
    assert(await page.evaluate(() => window.scrollY === 0 && document.querySelector('#sheetBody').scrollTop === 0), 'スクロールしない');
    const knob = await page.locator('.wheel-knob').boundingBox();
    const kp = await wheelPoint(page, 320);
    assert(near(center(knob).x, kp.x, 4) && near(center(knob).y, kp.y, 4), 'インジケーターが選択位置に表示');
  });

  await check('1b', '色相環内の四角で彩度・明度を調整できる（タップ・ドラッグ）', async () => {
    const id = await selectedId(page);
    const hsvOf = (hex) => {
      const n = parseInt(hex.slice(1), 16);
      const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      return { h: hueOf(hex), s: max ? (max - min) / max : 0, v: max };
    };
    const sq = await page.locator('.sv-square').boundingBox();
    assert(sq.width >= 90, `四角が十分な大きさ ${sq.width}`);
    // タップ：左から25%（彩度25%）、上から20%（明度80%）
    await page.touchscreen.tap(sq.x + sq.width * 0.25, sq.y + sq.height * 0.2); await tick(page);
    let c = hsvOf((await work(page)).shapes.find((x) => x.id === id).color);
    assert(near(c.s, 0.25, 0.03) && near(c.v, 0.8, 0.03), `tap s=${c.s} v=${c.v}`);
    assert(hueDist(c.h, 320) <= 4, `色相は維持 ${c.h}`);
    // ドラッグ：右上（彩度100%・明度100%）へ
    await touchDrag(cdp, { x: sq.x + sq.width * 0.25, y: sq.y + sq.height * 0.2 }, { x: sq.x + sq.width * 0.9, y: sq.y + sq.height * 0.1 });
    await tick(page);
    c = hsvOf((await work(page)).shapes.find((x) => x.id === id).color);
    assert(near(c.s, 0.9, 0.03) && near(c.v, 0.9, 0.03), `drag s=${c.s} v=${c.v}`);
    const k = center(await page.locator('.sv-knob').boundingBox());
    assert(near(k.x, sq.x + sq.width * 0.9, 4) && near(k.y, sq.y + sq.height * 0.1, 4), 'つまみが指の位置');
    // 色相を変えても彩度・明度は保たれる
    const p = await wheelPoint(page, 200);
    await page.touchscreen.tap(p.x, p.y); await tick(page);
    c = hsvOf((await work(page)).shapes.find((x) => x.id === id).color);
    assert(hueDist(c.h, 200) <= 3 && near(c.s, 0.9, 0.03) && near(c.v, 0.9, 0.03), `hue change keeps s/v ${JSON.stringify(c)}`);
    // 元に戻すで直前の色に戻り、つまみも追従
    await page.click('#undoBtn'); await tick(page, 200);
    c = hsvOf((await work(page)).shapes.find((x) => x.id === id).color);
    assert(hueDist(c.h, 320) <= 4 && near(c.s, 0.9, 0.03), `undo ${JSON.stringify(c)}`);
    const k2 = center(await page.locator('.sv-knob').boundingBox());
    assert(near(k2.x, sq.x + sq.width * c.s, 5) && near(k2.y, sq.y + sq.height * (1 - c.v), 5), 'undo後のつまみ位置');
    assert(await page.evaluate(() => window.scrollY === 0 && document.querySelector('#sheetBody').scrollTop === 0), 'スクロールしない');
    await page.screenshot({ path: `${OUT}/${slug}-02b-sv.png` });
  });

  await check(2, '選択した色が正しい四角形にのみ反映される／パネル表示中もキャンバスを維持', async () => {
    const w0 = await work(page);
    const other = w0.shapes[1];
    // パネルを開いたまま別の四角形をタップ
    await page.touchscreen.tap(...Object.values(center(await shapeBox(page, other.id))));
    await tick(page);
    // 重なりで別の四角形が選ばれた場合に備え、選択中IDを基準にする
    const sel = await selectedId(page);
    const before = await work(page);
    const p = await wheelPoint(page, 100);
    await page.touchscreen.tap(p.x, p.y); await tick(page);
    const after = await work(page);
    for (const s of after.shapes) {
      const b = before.shapes.find((x) => x.id === s.id);
      if (s.id === sel) assert(hueDist(hueOf(s.color), 100) <= 3, 'selected changed');
      else assert(s.color === b.color && s.x === b.x && s.w === b.w, `other shape changed: ${s.id}`);
    }
    // 画面上の表示色も一致
    const bg = await page.locator(`.shape[data-id="${sel}"]`).evaluate((e) => getComputedStyle(e).backgroundColor);
    const hex = after.shapes.find((x) => x.id === sel).color;
    const rgb = `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
    assert(bg === rgb, `${bg} vs ${rgb}`);
  });

  await check(8, '色の情報（色名・RGB・HSV・印象）が正しく表示される', async () => {
    const sel = await selectedId(page);
    const hex = (await work(page)).shapes.find((x) => x.id === sel).color;
    const t = async (s) => (await page.locator(s).textContent()).trim();
    assert((await t('#cHex')) === hex.toUpperCase(), 'HEX');
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    assert((await t('#cRgb')) === `${r} ${g} ${b}`, `RGB ${await t('#cRgb')}`);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const hsv = `${Math.round(hueOf(hex))}° ${Math.round(((max - min) / max) * 100)}% ${Math.round((max / 255) * 100)}%`;
    assert((await t('#cHsv')) === hsv, `HSV ${await t('#cHsv')} vs ${hsv}`);
    assert((await t('#cName')).length > 0, '色名');
    assert((await t('#cSys')).startsWith('系統色名'), '系統色名');
    assert(/暖色|寒色|中性色|無彩色/.test(await t('#cTheory')), '暖色・寒色');
    assert((await page.locator('#cImages .tag').count()) > 0, 'イメージ');
    assert((await t('[data-panel="color"] .note')).includes('科学的に確定した効果ではありません'), '心理的印象の注意書き');
  });

  await check(10, 'コントラスト比が正しく計算・表示される（WCAG）', async () => {
    // 背景を白に、選択中の四角形を基本色 #1b1b1d に設定
    const sel = await selectedId(page);
    await tapEl(page, '#cPalette [data-hex="#1b1b1d"]');
    await tapEl(page, '[data-target="background"]');
    await tapEl(page, '#cPalette [data-hex="#ffffff"]');
    await tapEl(page, '[data-target="shape"]');
    const w = await work(page);
    assert(w.background === '#ffffff' && w.shapes.find((s) => s.id === sel).color === '#1b1b1d', 'colors set');
    await page.evaluate(() => window.__iroawase.openPanel('insight', { tab: 'contrast' }));
    await tick(page, 200);
    const txt = (await page.locator('.ratio-big').textContent()).replace(/\s/g, '');
    const expected = Math.floor(ratio('#1b1b1d', '#ffffff') * 100) / 100;
    assert(txt === `${expected.toFixed(2)}:1`, `${txt} vs ${expected}`);
    const badges = await page.$$eval('.wcag-table .badge', (els) => els.map((e) => e.textContent));
    assert(badges.every((b) => b === '適合'), `badges ${badges}`);
    // 黒文字・白文字の比較
    const bw = await page.locator('.bw-card').count();
    assert(bw >= 2, 'black/white cards');
    assert((await page.locator('[data-panel="insight"] .note').last().textContent()).includes('断定することはできません'), '注意書き');
    // 色覚シミュレーションでキャンバス表示が切り替わる（データは不変）
    await tapEl(page, '[data-tab="cvd"]');
    await tapEl(page, '[data-type="achroma"]');
    const shapeColors = await page.$$eval('#artboard .shape', (els) => els.map((e) => getComputedStyle(e).backgroundColor));
    assert(shapeColors.every((c) => { const m = c.match(/\d+/g).map(Number); return m[0] === m[1] && m[1] === m[2]; }), '1色覚表示はグレー');
    assert(await page.locator('#cvdBadge').isVisible(), 'バッジ表示');
    await page.screenshot({ path: `${OUT}/${slug}-04-cvd.png` });
    const w2 = await work(page);
    assert(JSON.stringify(w2) === JSON.stringify(w), '作品データは変わらない');
    await tapEl(page, '[data-type="none"]');
  });

  await check(9, '配色の解説（型・関係・暖寒・明度彩度・印象）が表示される', async () => {
    // 補色関係の2色を作る
    const w = await work(page);
    const a = w.shapes[0].id, b = w.shapes[1].id;
    await page.evaluate(() => window.__iroawase.openPanel('color', { target: 'shape' }));
    await selectShape(page, a); await tick(page);
    let s = await selectedId(page);
    let p = await wheelPoint(page, 20); await page.touchscreen.tap(p.x, p.y); await tick(page);
    const ids = (await work(page)).shapes.map((x) => x.id).filter((x) => x !== s);
    await selectShape(page, ids[0]);
    await page.evaluate(() => window.__iroawase.openPanel('color', { target: 'shape' }));
    p = await wheelPoint(page, 200); await page.touchscreen.tap(p.x, p.y); await tick(page);
    for (const id of ids.slice(1)) {
      await selectShape(page, id);
      await page.evaluate(() => window.__iroawase.openPanel('color', { target: 'shape' }));
      p = await wheelPoint(page, 200); await page.touchscreen.tap(p.x, p.y); await tick(page);
    }
    await page.evaluate(() => window.__iroawase.openPanel('insight', { tab: 'harmony' }));
    await tick(page, 250);
    const body = await page.locator('#insBody').textContent();
    for (const k of ['配色の型', '色相の関係', '暖色・寒色のバランス', '明度・彩度の特徴', '組み合わせから受ける印象']) assert(body.includes(k), `missing ${k}`);
    assert(body.includes('補色'), `補色が判定される: ${(await page.locator('.scheme-name').textContent())}`);
    assert((await page.locator('.impression').count()) >= 1, '印象');
    assert(!/\d+点|スコア/.test(body), 'スコア化しない');
    await page.screenshot({ path: `${OUT}/${slug}-03-insight.png` });
    await tapEl(page, '[data-tab="theory"]');
    const th = await page.locator('#insBody').textContent();
    for (const k of ['補色', '類似色', 'トライアド']) assert(th.includes(k), `theory ${k}`);
  });

  await check(11, '作品を保存・読み込みできる（名前付き）', async () => {
    await page.evaluate(() => window.__iroawase.openPanel('works'));
    await page.fill('#wName', 'テスト作品A');
    await tapEl(page, '#wSave');
    const saved = await work(page);
    assert(saved.id && saved.name === 'テスト作品A', 'saved id/name');
    assert((await page.locator('.work-card').count()) === 1, 'list 1');
    assert((await page.inputValue('#workName')) === 'テスト作品A', 'ヘッダーの作品名');
    // 別名で保存 → 2件
    await tapEl(page, '#wSaveAs');
    assert((await page.locator('.work-card').count()) === 2, 'save as → 2');
    // 編集してから保存済み作品を開く
    await page.evaluate(() => window.__iroawase.closeSheet());
    await tapEl(page, '#addBtn');
    await tapEl(page, '#addBtn');
    assert(await page.locator('#dirtyDot').isVisible(), '未保存マーク');
    page.once('dialog', (d) => d.accept());
    await page.evaluate(() => window.__iroawase.openPanel('works'));
    const card = page.locator('.work-card', { hasText: 'テスト作品A' }).last();
    await card.locator('.work-thumb').scrollIntoViewIfNeeded();
    const tb = await card.locator('.work-thumb').boundingBox();
    await page.touchscreen.tap(tb.x + tb.width / 2, tb.y + tb.height / 2);
    await tick(page, 200);
    const loaded = await work(page);
    assert(loaded.shapes.length === saved.shapes.length, `shapes ${loaded.shapes.length} vs ${saved.shapes.length}`);
    assert(JSON.stringify(loaded.shapes) === JSON.stringify(saved.shapes), '位置・サイズ・色・重なり順が一致');
  });

  await check(12, 'お気に入り登録ができる', async () => {
    await page.evaluate(() => window.__iroawase.openPanel('works'));
    await tick(page, 150);
    await tapEl(page, '.work-card .fav');
    assert((await page.locator('.work-card .fav.is-on').count()) === 1, 'star on');
    await tapEl(page, '[data-filter="fav"]');
    assert((await page.locator('.work-card').count()) === 1, 'filter favorites');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('iroawase:works:v1')));
    assert(stored.filter((w) => w.favorite).length === 1, 'LocalStorageに保存');
    await tapEl(page, '[data-filter="all"]');
  });

  let pngPath = null;
  await check(13, 'PNG画像を出力できる（位置・大きさ・色を正確に反映）', async () => {
    await page.evaluate(() => window.__iroawase.openPanel('export'));
    await tick(page, 300);
    await page.screenshot({ path: `${OUT}/${slug}-05-export.png` });
    await page.locator('#xDownload').scrollIntoViewIfNeeded();
    const dlP = page.waitForEvent('download', { timeout: 10000 });
    await tapEl(page, '#xDownload');
    let dl;
    try { dl = await dlP; } catch (e) { throw new Error(`download not started; toasts=${await page.locator('.toast').allTextContents()} ${e.message.split('\n')[0]}`); }
    assert(dl.suggestedFilename().endsWith('.png'), dl.suggestedFilename());
    pngPath = `${OUT}/${slug}-export.png`;
    await dl.saveAs(pngPath);
    const buf = fs.readFileSync(pngPath);
    assert(buf.slice(1, 4).toString() === 'PNG', 'PNG signature');
    const w = await work(page);
    const pw = buf.readUInt32BE(16), ph = buf.readUInt32BE(20);
    const sc = 2400 / Math.max(w.artboard.w, w.artboard.h);
    assert(pw === Math.round(w.artboard.w * sc) && ph === Math.round(w.artboard.h * sc), `size ${pw}x${ph}`);
    // 画像の各点の色が、データ上で一番上にある四角形（または背景）の色と一致するか
    const b64 = buf.toString('base64');
    const samples = [];
    for (let i = 0; i < 40; i++) {
      const x = ((i * 37) % 97 + 1.5) / 100 * w.artboard.w, y = ((i * 53) % 89 + 1.5) / 92 * w.artboard.h;
      let col = w.background;
      for (const s of w.shapes) if (x >= s.x + 2 && x < s.x + s.w - 2 && y >= s.y + 2 && y < s.y + s.h - 2) col = s.color;
      const edge = w.shapes.some((s) => Math.abs(x - s.x) < 3 || Math.abs(x - s.x - s.w) < 3 || Math.abs(y - s.y) < 3 || Math.abs(y - s.y - s.h) < 3);
      if (!edge) samples.push({ px: Math.floor(x * sc), py: Math.floor(y * sc), col });
    }
    const got = await page.evaluate(async ({ b64, samples }) => {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      return samples.map((s) => { const d = ctx.getImageData(s.px, s.py, 1, 1).data; return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join(''); });
    }, { b64, samples });
    samples.forEach((s, i) => assert(got[i] === s.col, `pixel (${s.px},${s.py}) ${got[i]} vs ${s.col}`));
    // 背景色の設定（プリセット）
    await tapEl(page, '#xBg [data-bg="#1b1b1d"]');
    assert((await work(page)).background === '#1b1b1d', 'background set');
    await page.click('#undoBtn');
  });

  await check(14, '画像から色を抽出し、四角形に適用できる（失敗時はエラー表示）', async () => {
    await page.evaluate(() => window.__iroawase.openPanel('extract'));
    await tick(page, 200);
    // 不正なファイル → エラー表示（アプリは継続）
    await page.setInputFiles('#fileInput', { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('this is not an image') });
    await page.waitForSelector('.toast.error', { timeout: 5000 });
    assert(await page.locator('#exDrop').isVisible(), 'エラー後も選択画面のまま');
    // 正しい画像（先ほど出力したPNG）
    await page.setInputFiles('#fileInput', pngPath);
    await page.waitForSelector('.extract-color', { timeout: 8000 });
    const n = await page.locator('.extract-color').count();
    assert(n >= 2 && n <= 5, `extracted ${n}`);
    const w = await work(page);
    const used = new Set([w.background, ...w.shapes.map((s) => s.color)]);
    const ex = await page.$$eval('.extract-color', (els) => els.map((e) => e.dataset.hex));
    assert(ex.some((h) => used.has(h)), `抽出色がキャンバスの色を含む ${ex}`);
    // 色数を変更
    await tapEl(page, '#exPlus');
    const ex2 = await page.$$eval('.extract-color', (els) => els.map((e) => e.dataset.hex));
    assert(ex2.length >= ex.length, `色数変更 ${ex.length} → ${ex2.length}`);
    // 選択中の四角形に適用
    const sel = w.shapes[0].id;
    await selectShape(page, sel);
    await tick(page, 150); // 選択の反映（ボタンの再描画）を待つ
    const hex = ex2[ex2.length - 1];
    await tapEl(page, `.extract-color[data-hex="${hex}"]`);
    assert((await work(page)).shapes.find((s) => s.id === sel).color === hex, 'applied');
    // すべて追加
    const before = (await work(page)).shapes.length;
    await tapEl(page, '#exAddAll');
    const cnt = await page.locator('.extract-color').count();
    assert((await work(page)).shapes.length === before + cnt, 'add all');
    await page.screenshot({ path: `${OUT}/${slug}-06-extract.png` });
    // 外部への送信がない
    assert(external.length === 0, `external requests: ${external}`);
  });

  await check(15, 'ライト・ダークモードを切り替えられる（設定を保存）', async () => {
    await page.evaluate(() => window.__iroawase.closeSheet());
    const t0 = await page.evaluate(() => document.documentElement.dataset.theme);
    await tapEl(page, '#themeBtn');
    const t1 = await page.evaluate(() => document.documentElement.dataset.theme);
    assert(t0 !== t1, 'theme toggled');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert(t1 === 'dark' ? bg === 'rgb(18, 18, 20)' : bg === 'rgb(243, 241, 236)', `bg ${bg}`);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('iroawase:settings:v1')).theme);
    assert(saved === t1, 'saved');
    await page.screenshot({ path: `${OUT}/${slug}-07-${t1}.png` });
  });

  await check(17, 'LocalStorage：再読み込み後も作品・下書き・テーマを復元', async () => {
    const w = await work(page);
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.waitForTimeout(600); // 下書きの自動保存を待つ
    await page.reload();
    await page.waitForSelector('.shape');
    await tick(page, 300);
    const w2 = await work(page);
    assert(JSON.stringify(w2.shapes) === JSON.stringify(w.shapes), '下書き復元');
    assert((await page.evaluate(() => document.documentElement.dataset.theme)) === theme, 'テーマ復元');
    await page.evaluate(() => window.__iroawase.openPanel('works'));
    assert((await page.locator('.work-card').count()) === 2, '作品一覧');
    // 容量超過 → エラー表示、アプリ継続
    await page.evaluate(() => {
      const orig = Storage.prototype.setItem;
      window.__restore = () => { Storage.prototype.setItem = orig; };
      Storage.prototype.setItem = function () { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; };
    });
    await tapEl(page, '#wSaveAs');
    await page.waitForSelector('.toast.error', { timeout: 3000 });
    assert((await page.locator('.toast.error').last().textContent()).includes('容量'), 'quota message');
    assert((await page.locator('.work-card').count()) === 2, '一覧は変化しない');
    await page.evaluate(() => window.__restore());
    // 破損データ → 起動できる
    // 再読み込み時は pagehide で下書きが保存されるため、起動直前（document start）に破損データを書き込む
    await page.addInitScript(() => {
      if (sessionStorage.getItem('__corrupted')) return;
      sessionStorage.setItem('__corrupted', '1');
      localStorage.setItem('iroawase:works:v1', '{not json');
      localStorage.setItem('iroawase:draft:v1', '[[[');
    });
    await page.reload();
    await page.waitForSelector('.shape');
    await page.waitForSelector('.toast.error', { timeout: 3000 });
    assert((await page.locator('.shape').count()) === 1, '新しい作品で起動');
    await tapEl(page, '#addBtn');
    assert((await page.locator('.shape').count()) === 2, '操作できる');
  });

  await check(16, 'スマートフォン：画面サイズへの適応・誤操作防止', async () => {
    await page.evaluate(() => window.__iroawase.closeSheet());
    const m = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth, iw: innerWidth, sh: document.documentElement.scrollHeight, ih: innerHeight,
      ta: getComputedStyle(document.querySelector('#stage')).touchAction,
    }));
    assert(m.sw <= m.iw && m.sh <= m.ih, `no overflow ${JSON.stringify(m)}`);
    assert(m.ta === 'none', 'stage touch-action');
    const ab = await page.locator('#artboard').boundingBox();
    const vp = page.viewportSize();
    assert(ab.width * ab.height > vp.width * vp.height * 0.45, 'キャンバスが十分な面積');
    for (const sel of ['.tool', '.icon-btn', '.chip-btn']) {
      const boxes = await page.$$eval(sel, (els) => els.filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; }));
      assert(boxes.every(([w, h]) => w >= 36 && h >= 36), `${sel} too small: ${JSON.stringify(boxes)}`);
    }
    // シートを開いた状態でもページ全体がはみ出さない
    for (const p of ['color', 'insight', 'works', 'export', 'extract', 'canvas', 'help']) {
      await page.evaluate((x) => window.__iroawase.openPanel(x), p);
      await tick(page, 80);
      const ok = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('#stage').clientHeight > 120);
      assert(ok, `panel ${p} layout`);
    }
    // シートを下にスワイプして閉じる
    const head = center(await page.locator('#sheetTitle').boundingBox());
    await touchDrag(cdp, head, { x: head.x, y: vp.height - 10 }, 12);
    await tick(page, 150);
    assert(await page.locator('#sheet').isHidden(), 'swipe down closes sheet');
    assert(errors.length === 0, `console errors: ${errors.join(' | ')}`);
  });

  await context.close();
}

/* ---------- タブレット・PC ---------- */
async function layoutSuite(browser, name, opts) {
  currentDevice = name;
  console.log(`\n■ ${name}`);
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL_APP);
  await page.waitForSelector('.shape');
  const slug = name.replace(/\s+/g, '-');
  await check(16, `${name}：レイアウトと基本操作`, async () => {
    // マウスでドラッグ移動
    const w = await work(page);
    const b = await shapeBox(page, w.shapes[0].id);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 80, b.y + b.height / 2 + 30, { steps: 6 });
    await page.mouse.up();
    const s = (await work(page)).shapes[0];
    assert(s.x > w.shapes[0].x && s.y > w.shapes[0].y, 'mouse drag');
    // キーボード
    await page.keyboard.press('Control+d');
    assert((await work(page)).shapes.length === 2, 'Ctrl+D');
    await page.keyboard.press('Delete');
    assert((await work(page)).shapes.length === 1, 'Delete');
    await page.keyboard.press('Control+z');
    assert((await work(page)).shapes.length === 2, 'Ctrl+Z');
    await page.click('.tool[data-open="color"]');
    await tick(page, 300);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    assert(m.sw <= m.iw, 'no overflow');
    const sheet = await page.locator('#sheet').boundingBox();
    const stage = await page.locator('#stage').boundingBox();
    if ((opts.viewport.width) >= 900) assert(sheet.x >= stage.x + stage.width - 1, 'PCではサイドパネル');
    // マウスで色相環ドラッグ
    const p0 = await wheelPoint(page, 30), p1 = await wheelPoint(page, 90);
    await page.mouse.move(p0.x, p0.y); await page.mouse.down(); await page.mouse.move(p1.x, p1.y, { steps: 5 }); await page.mouse.up();
    const sel = await selectedId(page);
    const c = (await work(page)).shapes.find((x) => x.id === sel).color;
    assert(hueDist(hueOf(c), 90) <= 3, `wheel mouse ${hueOf(c)}`);
    await page.screenshot({ path: `${OUT}/${slug}-color.png` });
    await page.evaluate(() => window.__iroawase.openPanel('insight'));
    await tick(page, 300);
    await page.screenshot({ path: `${OUT}/${slug}-insight.png` });
    assert(errors.length === 0, errors.join(' | '));
  });
  await context.close();
}

/* ---------- GitHub Pages 互換 ---------- */
async function pagesSuite(browser) {
  currentDevice = 'GitHub Pages 互換';
  console.log(`\n■ ${currentDevice}`);
  await check(18, 'サブパス配信で全リソースを相対パスで読み込み、外部通信なし', async () => {
    requested.length = 0;
    const context = await browser.newContext();
    const page = await context.newPage();
    const failed = [], external = [];
    page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
    page.on('request', (r) => { if (!r.url().startsWith(ORIGIN) && !/^(blob|data):/.test(r.url())) external.push(r.url()); });
    await page.goto(URL_APP);
    await page.waitForSelector('.shape');
    await tick(page, 300);
    assert(failed.length === 0, `failed: ${failed}`);
    assert(external.length === 0, `external: ${external}`);
    assert(requested.every((u) => u.startsWith(BASE)), `absolute path outside base: ${requested.filter((u) => !u.startsWith(BASE))}`);
    assert(fs.existsSync(path.join(ROOT, '.nojekyll')), '.nojekyll');
    assert(fs.existsSync(path.join(ROOT, 'index.html')), 'index.html at root');
    await context.close();
  });
}

const only = process.env.ONLY;
const want = (n) => !only || n.includes(only);
const browser = await chromium.launch();
try {
  if (want('Pages')) await pagesSuite(browser);
  for (const d of ['iPhone 13', 'Pixel 7', 'iPhone SE']) if (want(d)) await mobileSuite(browser, d);
  if (want('iPad')) await layoutSuite(browser, 'iPad Mini', { ...devices['iPad Mini'], hasTouch: false, isMobile: false });
  if (want('Desktop')) await layoutSuite(browser, 'Desktop 1440', { viewport: { width: 1440, height: 900 } });
} finally {
  await browser.close();
  server.close();
}

const passed = results.filter((r) => r.ok).length;
console.log(`\n結果: ${passed} / ${results.length} passed`);
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
process.exit(passed === results.length ? 0 : 1);
