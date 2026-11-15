import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHex, hexToRgb, rgbToHex, rgbToHsv, hsvToRgb, hsvToHex, contrastRatio, formatRatio, wcagLevels,
  rgbToLab, deltaE2000, nearestColorName, describeColor, simulateCVD, hueDistance, hueFamily, temperatureOf, isAchromatic, wheelColor,
} from '../../js/color.js';
import { COLOR_NAMES } from '../../js/colornames.js';
import { CONFIG } from '../../js/config.js';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} expected ${b}, got ${a}`);

test('HEXの正規化', () => {
  assert.equal(normalizeHex('#ABC'), '#aabbcc');
  assert.equal(normalizeHex('ff0000'), '#ff0000');
  assert.equal(normalizeHex('#ggg'), null);
  assert.equal(normalizeHex(123), null);
  assert.equal(normalizeHex('<script>'), null);
});

test('RGB ⇔ HEX ⇔ HSV の相互変換', () => {
  assert.deepEqual(hexToRgb('#ff8000'), { r: 255, g: 128, b: 0 });
  assert.equal(rgbToHex({ r: 255, g: 128, b: 0 }), '#ff8000');
  const hsv = rgbToHsv({ r: 255, g: 0, b: 0 });
  assert.deepEqual(hsv, { h: 0, s: 1, v: 1 });
  close(rgbToHsv({ r: 0, g: 0, b: 255 }).h, 240, 1e-9);
  close(rgbToHsv({ r: 0, g: 255, b: 255 }).h, 180, 1e-9);
  assert.deepEqual(hsvToRgb(120, 1, 1), { r: 0, g: 255, b: 0 });
  assert.deepEqual(hsvToRgb(360, 1, 1), { r: 255, g: 0, b: 0 });
  // 全色相で往復誤差が1以内
  for (let h = 0; h < 360; h += 7) {
    const hex = hsvToHex(h, 0.68, 0.9);
    const back = rgbToHsv(hexToRgb(hex));
    assert.ok(hueDistance(back.h, h) < 1.5, `hue ${h} → ${back.h}`);
  }
});

test('色相環の色は CONFIG の彩度・明度で生成される', () => {
  const hsv = rgbToHsv(hexToRgb(wheelColor(200)));
  close(hsv.s, CONFIG.WHEEL_SATURATION, 0.01);
  close(hsv.v, CONFIG.WHEEL_VALUE, 0.01);
});

test('WCAG コントラスト比', () => {
  close(contrastRatio('#000000', '#ffffff'), 21, 1e-9, 'black/white');
  close(contrastRatio('#ffffff', '#ffffff'), 1, 1e-9);
  close(contrastRatio('#777777', '#ffffff'), 4.478, 0.005, '#777 on white');
  close(contrastRatio('#767676', '#ffffff'), 4.542, 0.005, '#767676 on white');
  close(contrastRatio('#0000ff', '#ffffff'), 8.592, 0.005, 'blue on white');
  close(contrastRatio('#ff0000', '#ffffff'), 3.998, 0.005, 'red on white');
  // 順序に依存しない
  assert.equal(contrastRatio('#123456', '#abcdef'), contrastRatio('#abcdef', '#123456'));
  // 表示は切り捨て（基準との矛盾を避ける）
  assert.equal(formatRatio(4.4999), '4.49');
  const lv = wcagLevels(contrastRatio('#777777', '#ffffff'));
  assert.equal(lv.normalAA, false);
  assert.equal(lv.largeAA, true);
  const lv2 = wcagLevels(contrastRatio('#767676', '#ffffff'));
  assert.equal(lv2.normalAA, true);
  assert.equal(lv2.normalAAA, false);
});

test('CIELAB 変換', () => {
  const w = rgbToLab('#ffffff');
  close(w.L, 100, 0.01); close(w.a, 0, 0.01); close(w.b, 0, 0.01);
  const r = rgbToLab('#ff0000');
  close(r.L, 53.24, 0.05); close(r.a, 80.09, 0.1); close(r.b, 67.2, 0.1);
});

test('CIEDE2000（Sharma らの検証データ）', () => {
  const cases = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
    [[90.9257, -0.5406, -0.9208], [88.6381, -0.8985, -0.7239], 1.5381],
  ];
  for (const [a, b, expected] of cases) {
    const d = deltaE2000({ L: a[0], a: a[1], b: a[2] }, { L: b[0], a: b[1], b: b[2] });
    close(d, expected, 1e-4, `ΔE00 ${a} vs ${b}`);
  }
});

test('色名：表に存在する色は完全一致、近い色は近似', () => {
  for (const [name, , hex] of COLOR_NAMES) {
    const n = nearestColorName(hex);
    assert.ok(n.exact, `${name} should be exact`);
    assert.equal(n.deltaE, 0);
  }
  const n = nearestColorName('#ff00ee');
  assert.equal(typeof n.name, 'string');
  assert.ok(n.deltaE > 0);
});

test('色の分類（色相・暖寒・無彩色）', () => {
  assert.equal(hueFamily(0).label, '赤');
  assert.equal(hueFamily(359).label, '赤');
  assert.equal(hueFamily(30).label, '黄赤');
  assert.equal(hueFamily(220).label, '青');
  assert.equal(temperatureOf(10, false).key, 'warm');
  assert.equal(temperatureOf(210, false).key, 'cool');
  assert.equal(temperatureOf(120, false).key, 'neutral');
  assert.equal(temperatureOf(280, false).key, 'neutral');
  assert.ok(isAchromatic('#808080'));
  assert.ok(isAchromatic('#ffffff'));
  assert.ok(!isAchromatic('#e60033'));
  const d = describeColor('#0095d9');
  assert.equal(d.temperature.key, 'cool');
  assert.equal(d.family.label, '青');
  assert.ok(d.images.length > 0);
  assert.equal(describeColor('#ffffff').systematic, '白');
  assert.equal(describeColor('#000000').systematic, '黒');
  // 不正な値でも停止しない
  assert.equal(describeColor('not-a-color').hex, '#000000');
});

test('色覚シミュレーション', () => {
  assert.equal(simulateCVD('#ffffff', 'protan'), '#ffffff');
  assert.equal(simulateCVD('#000000', 'deutan'), '#000000');
  const g = hexToRgb(simulateCVD('#ff0000', 'achroma'));
  assert.equal(g.r, g.g); assert.equal(g.g, g.b);
  assert.equal(simulateCVD('#123456', 'none'), '#123456');
  // P型では赤と緑の差が大きく縮む
  const before = deltaE2000(rgbToLab('#d03030'), rgbToLab('#6a8a2a'));
  const after = deltaE2000(rgbToLab(simulateCVD('#d03030', 'protan')), rgbToLab(simulateCVD('#6a8a2a', 'protan')));
  assert.ok(after < before / 2, `${before} → ${after}`);
});
