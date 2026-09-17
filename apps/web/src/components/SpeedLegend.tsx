/** 速率配色图例：说明"带宽越高越绿"的映射（FR-34） */

import { SPEED_LEGEND_STOPS, legendLabel, speedColor } from '../lib/speed-color';

const MIN_LOG = Math.log10(SPEED_LEGEND_STOPS[0]);
const MAX_LOG = Math.log10(SPEED_LEGEND_STOPS[SPEED_LEGEND_STOPS.length - 1]!);

/** 每个刻度在 0–100% 上的位置（对数刻度） */
function stopPercent(speedMbps: number): number {
  return ((Math.log10(speedMbps) - MIN_LOG) / (MAX_LOG - MIN_LOG)) * 100;
}

export function SpeedLegend({ compact = false }: { compact?: boolean }) {
  const gradient = SPEED_LEGEND_STOPS.map(
    (speed) => `${speedColor(speed)} ${stopPercent(speed).toFixed(1)}%`,
  ).join(', ');

  return (
    <div className={compact ? 'w-40' : 'w-52'}>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[10px] font-medium text-slate-400">链路速率配色</span>
        <span className="text-[9px] text-slate-600">越高越绿</span>
      </div>
      <div
        className="h-2 w-full rounded-full border border-slate-700/60"
        style={{ background: `linear-gradient(90deg, ${gradient})` }}
      />
      <div className="relative mt-0.5 h-3">
        {SPEED_LEGEND_STOPS.map((speed) => (
          <span
            key={speed}
            className="absolute -translate-x-1/2 font-mono text-[9px] text-slate-500"
            style={{ left: `${stopPercent(speed)}%` }}
          >
            {legendLabel(speed)}
          </span>
        ))}
      </div>
    </div>
  );
}
