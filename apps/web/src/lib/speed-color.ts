/**
 * 链路速率 → 颜色（FR-34）
 *
 * 编码规则（用户指定）：**带宽越高越绿，越低越红**，锚点为
 * 「1 Gbps = 红」「10 Gbps = 绿」，色相在这两者之间**按对数刻度均匀分配**
 * （速率感知是倍率关系而非线性关系：1G→2.5G 的差异应当与 4G→10G 一样明显）。
 *
 * 超出 1G–10G 范围时用**亮度**继续区分，避免所有低速链路挤在同一个红色上：
 *   100M 比 1G 更暗更红；25G/100G 比 10G 更亮更绿。
 *
 * 本模块是纯函数，供连线标签（文字色 + 边框色）、连线本体与端口图元共用。
 */

/** 色相锚点：1 Gbps */
const ANCHOR_LOW_MBPS = 1000;
/** 色相锚点：10 Gbps（一个十倍频程 = 整段红→绿） */
const ANCHOR_HIGH_MBPS = 10000;
const HUE_SPAN = 145; // 0 = 红，145 = 绿

export interface SpeedColor {
  /** 可直接用于 canvas / CSS 的颜色 */
  css: string;
  hue: number;
  lightness: number;
  saturation: number;
  /** 归一化位置：0 = 1G（红），1 = 10G（绿），负值更慢、>1 更快 */
  position: number;
}

export function speedColorOf(speedMbps: number): SpeedColor {
  const mbps = Math.max(1, speedMbps);
  // 对数刻度上的位置：1G → 0，10G → 1
  const position =
    Math.log10(mbps / ANCHOR_LOW_MBPS) / Math.log10(ANCHOR_HIGH_MBPS / ANCHOR_LOW_MBPS);

  const clamped = Math.min(1, Math.max(0, position));
  const hue = clamped * HUE_SPAN;

  // 范围之外靠亮度拉出层次（低速更暗，高速更亮）
  let lightness: number;
  let saturation: number;
  if (position < 0) {
    lightness = Math.max(42, 60 + position * 18);
    saturation = 72;
  } else if (position > 1) {
    lightness = Math.min(74, 60 + (position - 1) * 7);
    saturation = 66;
  } else {
    lightness = 60;
    saturation = 68;
  }

  return {
    css: `hsl(${hue.toFixed(0)} ${saturation}% ${lightness.toFixed(0)}%)`,
    hue,
    lightness,
    saturation,
    position,
  };
}

export function speedColor(speedMbps: number): string {
  return speedColorOf(speedMbps).css;
}

/** 半透明版本，用于连线本体（标签用实色，线体用弱化色） */
export function speedColorAlpha(speedMbps: number, alpha: number): string {
  const { hue, saturation, lightness } = speedColorOf(speedMbps);
  return `hsl(${hue.toFixed(0)} ${saturation}% ${lightness}% / ${alpha})`;
}

/** 图例刻度：覆盖项目支持的主要速率档位 */
export const SPEED_LEGEND_STOPS = [100, 1000, 2500, 10000, 100000] as const;

export function legendLabel(mbps: number): string {
  if (mbps >= 1000) {
    const g = mbps / 1000;
    return `${Number.isInteger(g) ? g : g.toFixed(1)}G`;
  }
  return `${mbps}M`;
}
