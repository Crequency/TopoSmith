/**
 * 节点树（FR-43）
 *
 * 设备目录旁边的第二页：把当前画布上的**所有节点**列出来，支持排序、过滤、
 * 以及"定位到设备"。机柜作为父节点，柜内设备缩进挂在它下面。
 */

import { useMemo, useState } from 'react';
import { DEVICE_KIND_LABEL, DEVICE_SUBTYPE_LABEL } from '@toposmith/schema';
import { deviceIcon, Icon } from '../lib/icons';
import {
  NODE_SORT_OPTIONS,
  buildNodeRows,
  filterNodeRows,
  nodeSortLabel,
  rackRangeText,
  rackUsageText,
  sortNodeRows,
  type NodeRow,
  type NodeSortKey,
  type SortDirection,
} from '../lib/node-tree';
import { useApp } from '../state/store';

export function NodeTree() {
  const world = useApp((s) => s.world);
  const selection = useApp((s) => s.selection);
  const selectOneDevice = useApp((s) => s.selectOneDevice);
  const focusDevice = useApp((s) => s.focusDevice);

  const [sortKey, setSortKey] = useState<NodeSortKey>('position');
  const [direction, setDirection] = useState<SortDirection>('asc');
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const all = buildNodeRows(world);
    return filterNodeRows(sortNodeRows(all, sortKey, direction), query);
  }, [world, sortKey, direction, query]);

  const total = world.ordered.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
        标题与说明在卡片标题栏里（FR-70）：这里只留"过滤 / 排序 / 计数"这些**操作**，
        以及列表本身。列表给一个高度上限，否则 810 行的场景会把整列卡片顶到看不见底。
      */}
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-slate-800 px-3 py-2">
        <input
          type="text"
          value={query}
          placeholder="按名称 / IP / 类型过滤…"
          onChange={(event) => setQuery(event.target.value)}
          className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-sky-500"
        />
        <div className="flex items-center gap-1.5">
          <select
            value={sortKey}
            onChange={(event) => setSortKey(event.target.value as NodeSortKey)}
            title="排序依据"
            className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-1.5 py-1 text-[11px] text-slate-200"
          >
            {NODE_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                按{option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setDirection(direction === 'asc' ? 'desc' : 'asc')}
            title={direction === 'asc' ? '当前升序，点击切换为降序' : '当前降序，点击切换为升序'}
            className="shrink-0 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 hover:border-sky-600 hover:text-sky-300"
          >
            {direction === 'asc' ? '↑ 升序' : '↓ 降序'}
          </button>
        </div>
        <p className="text-[10px] text-slate-600">
          {rows.length === total ? `${total} 个节点` : `${rows.length}/${total} 个节点`} · 按
          {nodeSortLabel(sortKey)}
          {direction === 'asc' ? '升序' : '降序'} · 点击选中，双击定位
        </p>
      </div>

      <div className="max-h-[42vh] min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="p-3 text-[11px] leading-relaxed text-slate-500">
            {total === 0 ? '画布上还没有节点，先从「设备目录」拖入设备。' : '没有匹配的节点。'}
          </p>
        ) : (
          <ul className="flex flex-col">
            {rows.map((row) => (
              <NodeTreeRow
                key={row.deviceId}
                row={row}
                selected={selection.devices.includes(row.deviceId)}
                onSelect={() => selectOneDevice(row.deviceId)}
                onFocus={() => focusDevice(row.deviceId)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function NodeTreeRow({
  row,
  selected,
  onSelect,
  onFocus,
}: {
  row: NodeRow;
  selected: boolean;
  onSelect: () => void;
  onFocus: () => void;
}) {
  const isRack = row.kind === 'rack';
  const kindText = row.subtype
    ? `${DEVICE_KIND_LABEL[row.kind]} · ${DEVICE_SUBTYPE_LABEL[row.subtype]}`
    : DEVICE_KIND_LABEL[row.kind];

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={onFocus}
        title={`${row.name}｜${kindText}${row.ip ? `｜${row.ip}` : ''}（双击定位）`}
        className={`flex w-full items-center gap-1.5 border-l-2 px-2 py-1.5 text-left transition ${
          selected
            ? 'border-amber-400 bg-amber-500/10'
            : 'border-transparent hover:bg-slate-800/60'
        }`}
        style={{ paddingLeft: row.depth > 0 ? 22 : 8 }}
      >
        {row.depth > 0 && <span className="shrink-0 text-[10px] text-slate-600">↳</span>}
        <Icon
          node={deviceIcon(row.kind, row.subtype)}
          size={14}
          className={isRack ? 'shrink-0 text-slate-300' : 'shrink-0 text-sky-300'}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-1">
            <span className="truncate text-[11px] font-medium text-slate-200">{row.name}</span>
            {isRack && row.rackHeightU !== undefined && (
              <span className="shrink-0 rounded bg-slate-800 px-1 text-[9px] text-slate-400">
                {row.rackHeightU}U
              </span>
            )}
            {row.depth > 0 && row.rackStartU !== undefined && (
              <span className="shrink-0 rounded bg-slate-800 px-1 text-[9px] text-sky-300">
                {rackRangeText(row)}
              </span>
            )}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-500">
            <span className="truncate">{kindText}</span>
            {row.ip && <span className="shrink-0 font-mono text-slate-400">{row.ip}</span>}
          </span>
        </span>
        <span className="shrink-0 text-right text-[9px] leading-tight text-slate-500">
          {isRack ? (
            <span className="block text-slate-400">{rackUsageText(row)}</span>
          ) : (
            <>
              <span className="block">{row.portCount} 口</span>
              <span className="block">{row.linkCount} 线</span>
            </>
          )}
        </span>
      </button>
    </li>
  );
}

export type { NodeRow };
