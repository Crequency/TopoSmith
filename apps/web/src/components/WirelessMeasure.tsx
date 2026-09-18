/**
 * 无线信号测量面板（FR-80）
 *
 * 右键任意一点 →「测量此点的无线信号」，这里如实摊开**推演内核算出来的东西**：
 *   · 能收到哪些信号（谁提供的、什么制式/频段/信道、SSID 或 PLMN）；
 *   · 每一条的距离、覆盖余量、几何质量档位、**自由空间估算电平**、标称与估算速率；
 *   · 这些信号的信道占用情况：哪些挤在同一信道（同频干扰）、2.4G 哪些相邻信道互相重叠；
 *   · 内核给出的**口径与简化披露**（照抄，不加工）。
 *
 * 面板本身不算任何东西：数值全部来自 `measureWireless`（引擎纯函数，有单测）。
 * 这样"面板上写的"与"诊断里算的"是同一套口径，不会出现两处各说一套。
 */

import { useMemo, type ReactNode } from 'react';
import { formatDistanceM, measureWireless, type MeasuredSignal } from '@toposmith/anvil';
import { RADIO_STANDARD_LABEL, formatSpeed } from '@toposmith/catalog';
import { DEVICE_KIND_LABEL, type Point } from '@toposmith/schema';
import { useApp } from '../state/store';
import { Icon, uiIcon } from '../lib/icons';
import { ChannelChart } from './ChannelChart';
import {
  BAND_LABEL,
  INTERFERENCE_LABEL,
  QUALITY_COLOR,
  QUALITY_LABEL,
  QUALITY_RATIO,
  QUALITY_TEXT,
} from '../lib/wireless-labels';

function bandLabel(signal: MeasuredSignal): string {
  if (signal.isCellular) return '蜂窝';
  return signal.band ? BAND_LABEL[signal.band] : '—';
}

/** 一条信号的"身份"：WiFi 看 SSID，蜂窝看 PLMN */
function identityOf(signal: MeasuredSignal): string {
  if (signal.isCellular) return signal.plmn ? `PLMN ${signal.plmn}` : '未填 PLMN';
  return signal.ssid ? `SSID ${signal.ssid}` : '未填 SSID';
}

export function WirelessMeasurePanel({
  point,
  at,
  bounds,
  onClose,
}: {
  point: Point;
  /** 容器内坐标：面板贴着测量点弹出 */
  at: { x: number; y: number };
  bounds: { width: number; height: number };
  onClose: () => void;
}): ReactNode {
  const world = useApp((s) => s.world);
  const result = useMemo(() => measureWireless(world, point), [world, point]);

  /*
   * 尺寸与位置：面板贴着测量点弹出，但要**始终完整落在画布区域内** ——
   * 在画布下缘右键时不能把面板顶出窗口（那会让"信道情况"与简化披露看不到）。
   */
  const width = 340;
  const height = Math.min(520, Math.max(240, bounds.height - 16));
  const left = Math.max(8, Math.min(at.x + 14, bounds.width - width - 8));
  const top = Math.max(8, Math.min(at.y + 14, bounds.height - height - 8));

  return (
    <div
      role="dialog"
      aria-label="无线信号测量"
      className="absolute z-30 flex w-[340px] flex-col rounded-lg border border-slate-700 bg-slate-900/97 shadow-2xl backdrop-blur"
      style={{ left, top, height }}
    >
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
        <Icon node={uiIcon('measure')} size={14} />
        <span className="flex-1 text-xs font-semibold text-slate-200">无线信号测量</span>
        <button
          type="button"
          aria-label="关闭测量面板"
          onClick={onClose}
          className="rounded px-1 text-slate-500 transition hover:text-slate-200"
        >
          ✕
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2 text-[11px]">
        {/* 概览 */}
        <div className="rounded border border-slate-800 bg-slate-950/60 p-2 leading-snug text-slate-300">
          {result.signals.length === 0 ? (
            <>
              这一点收不到任何无线信号：附近没有启用覆盖的无线设备，或者测量点落在它们的覆盖范围之外。
            </>
          ) : (
            <>
              可收到 <span className="font-mono text-sky-300">{result.signals.length}</span> 个信号
              {result.best && (
                <>
                  ，其中最强的是{' '}
                  <span className="text-slate-100">{result.best.deviceName}</span>
                  （{QUALITY_LABEL[result.best.quality]} · {bandLabel(result.best)}
                  {result.best.channel ? ` · 信道 ${result.best.channel}` : ''}）
                </>
              )}
              。
            </>
          )}
        </div>

        {/* 信号列表 */}
        {result.signals.map((signal) => (
          <div
            key={signal.deviceId}
            data-signal={signal.deviceId}
            className="flex flex-col gap-1 rounded border border-slate-800 bg-slate-950/40 p-2"
          >
            <div className="flex items-baseline gap-2">
              <span className="flex-1 truncate text-slate-100" title={signal.deviceName}>
                {signal.deviceName}
              </span>
              <span className={`font-mono text-[10px] ${QUALITY_TEXT[signal.quality]}`}>
                {QUALITY_LABEL[signal.quality]}
              </span>
              <span className="font-mono text-[10px] text-slate-400">
                {signal.estimatedRssiDbm} dBm
              </span>
            </div>

            {/* 质量条：几何余量的可视化（不是 RSSI 柱） */}
            <div className="h-1 w-full overflow-hidden rounded bg-slate-800">
              <div
                className={`h-full ${QUALITY_COLOR[signal.quality]}`}
                style={{ width: `${Math.round(QUALITY_RATIO[signal.quality] * 100)}%` }}
              />
            </div>

            <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-slate-400">
              <span>{DEVICE_KIND_LABEL[world.devices.get(signal.deviceId)?.kind ?? 'ap']}</span>
              <span>{RADIO_STANDARD_LABEL[signal.standard]}</span>
              <span>{bandLabel(signal)}</span>
              {signal.channel ? <span>信道 {signal.channel}</span> : null}
              <span>{identityOf(signal)}</span>
            </div>

            <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-slate-500">
              <span>距离 {formatDistanceM(signal.distanceM)}</span>
              <span>覆盖 {signal.radiusM} m</span>
              <span>余量 {formatDistanceM(signal.marginM)}</span>
              <span>
                标称 {formatSpeed(signal.nominalMbps)} → 估算 {formatSpeed(signal.estimatedMbps)}
              </span>
              {signal.peers > 0 && <span className="text-amber-300/90">同一提供方已连 {signal.peers} 台</span>}
            </div>
          </div>
        ))}

        {/* 信道占用与重叠图 */}
        {result.channels.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="text-[10px] font-semibold tracking-wide text-slate-400">信道情况</div>
            <ChannelChart channels={result.channels} />
            <table className="w-full border-collapse text-[10px]">
              <thead>
                <tr className="text-slate-500">
                  <th className="py-0.5 text-left font-normal">频段</th>
                  <th className="py-0.5 text-left font-normal">信道</th>
                  <th className="py-0.5 text-left font-normal">频点</th>
                  <th className="py-0.5 text-right font-normal">信号</th>
                  <th className="py-0.5 text-right font-normal">干扰</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {result.channels.map((usage) => (
                  <tr key={`${usage.band}-${usage.channel}`} className="border-t border-slate-800/70">
                    <td className="py-0.5 text-slate-300">{usage.band === 'cellular' ? '蜂窝' : usage.band}</td>
                    <td className="py-0.5 text-slate-300">{usage.channel === 0 ? '—' : usage.channel}</td>
                    <td className="py-0.5 text-slate-500">{usage.frequencyMhz} MHz</td>
                    <td className="py-0.5 text-right text-slate-300">{usage.signals.length}</td>
                    <td
                      className={`py-0.5 text-right ${
                        usage.interference === 'none' ? 'text-slate-500' : 'text-amber-300'
                      }`}
                    >
                      {INTERFERENCE_LABEL[usage.interference]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 简化披露 */}
        <div className="flex flex-col gap-0.5 rounded border border-slate-800 bg-slate-950/30 p-2 text-[10px] leading-snug text-slate-500">
          {result.notes.map((note) => (
            <p key={note}>· {note}</p>
          ))}
        </div>
      </div>
    </div>
  );
}
