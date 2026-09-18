/**
 * 信道重叠图（FR-83）
 *
 * 无线排障里最有用的一张图：把"测量点能收到的信号"按频段摊在频谱上，
 * 一眼看出谁跟谁挤在一起。
 *
 *  · **2.4 GHz**：每个信道占约 22 MHz（＝ 5 个信道号宽），所以画成**穹顶曲线**，
 *    1 与 3 严重重叠、1 与 6 刚好相接、1 与 11 完全分开 —— 重叠区间用琥珀色底衬标出。
 *  · **5 GHz / 6 GHz**：信道正交，画成离散占用条，同一条上有两台以上＝同频干扰（红点）。
 *  · **蜂窝**：没有信道号，只报"有几个信号、什么制式"。
 *
 * 布局计算全在 `lib/channel-chart.ts`（纯函数，有单测），这里只负责画。
 */

import type { ReactNode } from 'react';
import type { ChannelUsage } from '@toposmith/anvil';
import { buildChannelCharts, channelTicks, type BandChart } from '../lib/channel-chart';

const BAND_TITLE: Record<BandChart['band'], string> = {
  '2.4G': '2.4 GHz（信道互相重叠）',
  '5G': '5 GHz（信道正交）',
  '6G': '6 GHz（信道正交）',
  cellular: '蜂窝（无信道号）',
};

const VIEW_W = 300;
const PAD_X = 10;
const CURVE_H = 44;
const BAR_H = 34;

/** 信道号 → 横轴像素 */
function xOf(chart: BandChart, channel: number): number {
  const [min, max] = chart.range;
  const span = Math.max(1e-6, max - min);
  return PAD_X + ((channel - min) / span) * (VIEW_W - PAD_X * 2);
}

export function ChannelChart({ channels }: { channels: ChannelUsage[] }): ReactNode {
  const charts = buildChannelCharts(channels);
  if (charts.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {charts.map((chart) => (
        <div key={chart.band} className="flex flex-col gap-0.5">
          <div className="flex items-baseline justify-between">
            <span className="text-[10px] text-slate-400">{BAND_TITLE[chart.band]}</span>
            {chart.hasInterference ? (
              <span className="text-[10px] text-amber-300">
                {chart.band === '2.4G' ? '存在信道重叠' : '存在同频干扰'}
              </span>
            ) : (
              <span className="text-[10px] text-emerald-400/80">无重叠</span>
            )}
          </div>

          <svg
            data-band={chart.band}
            role="img"
            aria-label={`${BAND_TITLE[chart.band]}信道占用图`}
            viewBox={`0 0 ${VIEW_W} ${CURVE_H + 14}`}
            className="h-[72px] w-full rounded border border-slate-800 bg-slate-950/60"
          >
            {/* 重叠区间的高亮底衬：先画，曲线压在上面 */}
            {chart.overlaps.map((span) => (
              <rect
                key={`${span.from}-${span.to}`}
                data-overlap={span.kind}
                x={xOf(chart, span.from)}
                y={0}
                width={Math.max(1, xOf(chart, span.to) - xOf(chart, span.from))}
                height={CURVE_H}
                fill={span.kind === 'co-channel' ? 'rgba(244, 63, 94, 0.22)' : 'rgba(245, 158, 11, 0.18)'}
              />
            ))}

            {/* 2.4G：频谱穹顶 */}
            {chart.curves.map((curve, index) => {
              const peak = xOf(chart, curve.channel);
              const left = xOf(chart, curve.from);
              const right = xOf(chart, curve.to);
              return (
                <path
                  key={`${curve.name}-${curve.channel}-${index}`}
                  data-curve={curve.channel}
                  d={`M ${left} ${CURVE_H} Q ${peak} ${CURVE_H - CURVE_H * 0.92} ${right} ${CURVE_H} Z`}
                  fill="rgba(56, 189, 248, 0.28)"
                  stroke="rgba(125, 211, 252, 0.85)"
                  strokeWidth={1}
                />
              );
            })}

            {/* 正交频段：占用条 */}
            {chart.bars.map((bar) => {
              const x = xOf(chart, bar.channel) - (chart.band === 'cellular' ? 24 : 5);
              const width = chart.band === 'cellular' ? 48 : 10;
              const height = chart.band === 'cellular' ? BAR_H * 0.6 : BAR_H * Math.min(1, bar.count / 2 + 0.5);
              return (
                <g key={`${chart.band}-${bar.channel}`} data-bar={bar.channel}>
                  <rect
                    x={x}
                    y={CURVE_H - height}
                    width={width}
                    height={height}
                    rx={2}
                    fill={bar.count > 1 ? 'rgba(244, 63, 94, 0.45)' : 'rgba(56, 189, 248, 0.35)'}
                    stroke={bar.count > 1 ? 'rgba(251, 113, 133, 0.95)' : 'rgba(125, 211, 252, 0.8)'}
                    strokeWidth={1}
                  />
                  {bar.count > 1 && (
                    <text
                      x={x + width / 2}
                      y={CURVE_H - height - 3}
                      textAnchor="middle"
                      className="fill-rose-300"
                      style={{ fontSize: 8 }}
                    >
                      ×{bar.count}
                    </text>
                  )}
                </g>
              );
            })}

            {/* 横轴：信道号 */}
            <line x1={0} y1={CURVE_H} x2={VIEW_W} y2={CURVE_H} stroke="rgba(148, 163, 184, 0.35)" strokeWidth={1} />
            {channelTicks(chart).map((channel) => (
              <text
                key={channel}
                x={xOf(chart, channel)}
                y={CURVE_H + 10}
                textAnchor="middle"
                className="fill-slate-500"
                style={{ fontSize: 8 }}
              >
                {channel}
              </text>
            ))}
          </svg>

          {chart.band === '2.4G' && (
            <span className="text-[10px] leading-snug text-slate-500">
              一个信道约占 5 个信道号宽：琥珀色区间就是两台以上信号互相叠加的频段。
              工程上只用 1 / 6 / 11 三条互不重叠。
            </span>
          )}
          {chart.band !== '2.4G' && chart.bars.some((bar) => bar.count > 1) && (
            <span className="text-[10px] leading-snug text-rose-300/90">
              同一信道上有多台设备（标 ×N）：正交信道不会重叠，但同频会互相等待。
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
