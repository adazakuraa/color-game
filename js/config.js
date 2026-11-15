/**
 * アプリ全体の調整用定数。
 * 彩度・明度は色相環内の四角で調整できます。下の値は、無彩色から色相を選び直したときなどに使う初期値です。
 */
export const CONFIG = Object.freeze({
  /** 彩度の初期値 (HSVのS, 0〜1) */
  WHEEL_SATURATION: 0.68,
  /** 明度の初期値 (HSVのV, 0〜1) */
  WHEEL_VALUE: 0.9,

  /** アートボードの論理幅（保存データ・PNG出力の基準座標系） */
  ARTBOARD_WIDTH: 1000,
  /** アートボードの論理高さの下限・上限（画面に合わせる場合） */
  ARTBOARD_MIN_HEIGHT: 560,
  ARTBOARD_MAX_HEIGHT: 2200,

  /** 四角形の最小サイズ（論理単位） */
  MIN_SHAPE_SIZE: 24,
  /** 追加時の四角形のサイズ（論理単位） */
  DEFAULT_SHAPE_SIZE: 300,
  /** 四角形の最大数（過剰な保存容量を避けるため） */
  MAX_SHAPES: 120,
  /** 画面外に出しても最低限残す可視幅（論理単位） */
  KEEP_VISIBLE: 40,

  /** 画像から抽出する色数の初期値 */
  EXTRACT_COLOR_COUNT: 5,
  EXTRACT_MIN: 2,
  EXTRACT_MAX: 10,

  /** 元に戻す履歴の最大数 */
  HISTORY_LIMIT: 80,

  /** PNG出力時の長辺ピクセル数 */
  EXPORT_LONG_SIDE: 2400,

  /** 色名の「近似」表示に切り替える色差 (CIEDE2000) */
  NAME_APPROX_THRESHOLD: 2.5,

  /** タップとドラッグを区別する移動量（px） */
  DRAG_THRESHOLD: 6,

  /** 背景色のプリセット */
  BACKGROUND_PRESETS: [
    '#ffffff', '#f4f1ea', '#e6e2da', '#9a958c', '#3a3a3c', '#1b1b1d', '#0b0b0c',
  ],
});
