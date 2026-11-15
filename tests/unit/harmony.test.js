import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWork, visibleAreas, relationOf, detectScheme, cvdConfusions } from '../../js/harmony.js';
import { describeColor, hsvToHex } from '../../js/color.js';

const work = (colors, bg = '#ffffff') => ({
  background: bg,
  artboard: { w: 1000, h: 1000 },
  shapes: colors.map((c, i) => ({ id: `s${i}`, x: (i % 4) * 250, y: Math.floor(i / 4) * 250, w: 250, h: 250, color: c })),
});
const hue = (h, s = 0.7, v = 0.9) => hsvToHex(h, s, v);
const schemeOf = (hexes) => detectScheme(hexes.map((hex) => ({ hex, weight: 1 / hexes.length, info: describeColor(hex) })));

test('色相差による関係の分類', () => {
  assert.equal(relationOf(5).key, 'same');
  assert.equal(relationOf(30).key, 'analogous');
  assert.equal(relationOf(90).key, 'intermediate');
  assert.equal(relationOf(130).key, 'contrast');
  assert.equal(relationOf(180).key, 'complementary');
});

test('配色の型の判定', () => {
  assert.equal(schemeOf([hue(20), hue(200)]).key, 'complementary');
  assert.equal(schemeOf([hue(0), hue(120), hue(240)]).key, 'triad');
  assert.equal(schemeOf([hue(200), hue(225), hue(245)]).key, 'analogous');
  assert.equal(schemeOf([hue(210, 0.8, 0.4), hue(210, 0.3, 0.95)]).key, 'mono');
  assert.equal(schemeOf(['#ffffff', '#222222', '#888888']).key, 'achromatic');
  assert.equal(schemeOf([hue(30), hue(170), hue(230)]).key, 'split');
  assert.equal(schemeOf([hue(0), hue(90), hue(180), hue(270)]).key, 'square');
  assert.equal(schemeOf([hue(0), hue(60), hue(180), hue(240)]).key, 'tetrad');
  assert.equal(schemeOf([hue(10), '#ffffff']).key, 'accent');
});

test('トーン・イン・トーンの補足', () => {
  const s = schemeOf([hue(0), hue(120), hue(240)]);
  assert.ok(s.notes.some((n) => n.includes('トーン・イン・トーン')));
});

test('重なりを考慮した見えている面積', () => {
  const w = {
    background: '#ffffff', artboard: { w: 100, h: 100 },
    shapes: [
      { id: 'a', x: 0, y: 0, w: 100, h: 100, color: '#ff0000' },
      { id: 'b', x: 0, y: 0, w: 50, h: 100, color: '#0000ff' }, // 上に重なる
    ],
  };
  const areas = visibleAreas(w);
  const red = areas.find((a) => a.hex === '#ff0000');
  const blue = areas.find((a) => a.hex === '#0000ff');
  assert.ok(Math.abs(red.weight - 0.5) < 0.03);
  assert.ok(Math.abs(blue.weight - 0.5) < 0.03);
  assert.ok(!areas.some((a) => a.isBackground && a.weight > 0));
});

test('配色解説の総合結果', () => {
  const a = analyzeWork(work([hue(20), hue(200), '#1b1b1d']));
  assert.equal(a.empty, false);
  assert.ok(a.colors.length >= 3);
  assert.ok(a.relations.length >= 1);
  assert.ok(a.impressions.items.length >= 1);
  assert.ok(a.tempSummary.length > 0);
  assert.ok(a.toneLines.length >= 3);
  const sum = a.temp.warm + a.temp.cool + a.temp.neutral + a.temp.achromatic;
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test('印象：典型的な配色で期待される印象が含まれる', () => {
  const labels = (colors, bg) => analyzeWork(work(colors, bg)).impressions.items.map((i) => i.key);
  assert.ok(labels(['#0f2350', '#c9a227', '#141414'], '#141414').includes('luxury'), 'navy+gold+black → 高級感');
  assert.ok(labels(['#00a3af', '#a0d8ef', '#ffffff'], '#ffffff').includes('fresh'), 'cyan+sky+white → 爽やかさ');
  assert.ok(labels(['#ee7800', '#e95464', '#f8b500'], '#fbdac8').includes('warm'), '暖色 → 温かみ');
  assert.ok(labels(['#674598', '#2a1a4a', '#1e50a2'], '#120e20').includes('mystic'), '紫+暗色 → 神秘的');
  assert.ok(labels(['#ff2d55', '#ffd60a', '#30d158', '#0a84ff'], '#ffffff').includes('pop'), '多色鮮やか → ポップ');
  assert.ok(labels(['#f4b3c2', '#cab8d9', '#bce2e8'], '#fef4f4').includes('gentle'), 'パステル → やさしさ');
});

test('空のキャンバス・背景透明でも停止しない', () => {
  const a = analyzeWork({ background: 'transparent', artboard: { w: 100, h: 100 }, shapes: [] });
  assert.equal(a.empty, true);
});

test('色覚で区別しにくい組み合わせの検出', () => {
  const res = cvdConfusions(['#d03030', '#5a8a2a', '#1e50a2']);
  assert.ok(res.protan.length + res.deutan.length >= 1);
});
