/**
 * 节点树（FR-43）
 *
 * 把当前画布上的所有节点整理成可查看、可排序、可过滤的一棵树：
 * **机柜作为父节点，柜内设备挂在它下面并按 U 位排列**，其余设备按画布上的独立节点罗列。
 *
 * 全是纯函数（只读 World），因此排序/过滤/嵌套这些容易出错的地方可以直接单测。
 */

import { isRackable } from '@toposmith/catalog';
import {
  DEVICE_KIND_LABEL,
  DEVICE_SUBTYPE_LABEL,
  type DeviceKind,
  type DeviceSubtype,
} from '@toposmith/schema';
import { addressesOf, parseIp, type World } from '@toposmith/engine';
import { rackUnitsOf } from './geometry';

export interface NodeRow {
  deviceId: string;
  name: string;
  kind: DeviceKind;
  subtype?: DeviceSubtype;
  model?: string;
  /** 主地址（无地址时 undefined，例如交换机只配了管理地址的情况也会命中） */
  ip?: string;
  portCount: number;
  linkCount: number;
  /** 已上架设备：所属机柜名与 U 区间 */
  rackName?: string;
  rackStartU?: number;
  rackUnits?: number;
  /** 机柜自身：高度与已用 U 数 */
  rackHeightU?: number;
  rackUsedU?: number;
  /** 该行是否可上架（用于在树上给出提示） */
  rackable: boolean;
  /** 缩进层级：0 = 顶层，1 = 机柜内设备 */
  depth: number;
  x: number;
  y: number;
}

function linkCountOf(world: World, deviceId: string): number {
  const device = world.devices.get(deviceId);
  if (!device) return 0;
  let count = 0;
  for (const port of device.ports) {
    count += (world.linksByPort.get(`${deviceId}:${port.id}`) ?? []).length;
  }
  return count;
}

function baseRow(world: World, deviceId: string, depth: number): NodeRow | null {
  const device = world.devices.get(deviceId);
  if (!device) return null;
  return {
    deviceId: device.id,
    name: device.name,
    kind: device.kind,
    subtype: device.subtype,
    model: device.model,
    ip: addressesOf(world, device.id)[0]?.ip,
    portCount: device.ports.length,
    linkCount: linkCountOf(world, device.id),
    rackable: isRackable(device),
    depth,
    x: device.x,
    y: device.y,
  };
}

/** 构建节点树：机柜在前、柜内设备紧随其后（按 U 位），其余设备按画布顺序 */
export function buildNodeRows(world: World): NodeRow[] {
  const racks = world.ordered.filter((device) => device.kind === 'rack');
  const rows: NodeRow[] = [];
  const consumed = new Set<string>();

  for (const rack of racks) {
    const row = baseRow(world, rack.id, 0);
    if (!row) continue;
    const mounted = world.ordered
      .filter((device) => device.mount?.rackId === rack.id)
      .sort((a, b) => (a.mount?.startU ?? 0) - (b.mount?.startU ?? 0));
    const usedU = mounted.reduce((sum, device) => sum + rackUnitsOf(device), 0);

    rows.push({
      ...row,
      rackHeightU: rack.rack?.heightU ?? 0,
      rackUsedU: usedU,
    });
    consumed.add(rack.id);

    for (const child of mounted) {
      const childRow = baseRow(world, child.id, 1);
      if (!childRow) continue;
      rows.push({
        ...childRow,
        rackName: rack.name,
        rackStartU: child.mount?.startU,
        rackUnits: rackUnitsOf(child),
      });
      consumed.add(child.id);
    }
  }

  for (const device of world.ordered) {
    if (consumed.has(device.id)) continue;
    const row = baseRow(world, device.id, 0);
    if (row) rows.push(row);
  }

  return rows;
}

export type NodeSortKey = 'name' | 'kind' | 'ip' | 'links' | 'position' | 'rack';
export type SortDirection = 'asc' | 'desc';

export const NODE_SORT_OPTIONS: { value: NodeSortKey; label: string }[] = [
  { value: 'name', label: '名称' },
  { value: 'kind', label: '类型' },
  { value: 'ip', label: 'IP 地址' },
  { value: 'links', label: '连接数' },
  { value: 'rack', label: '机柜 / U 位' },
  { value: 'position', label: '画布位置' },
];

export function nodeSortLabel(key: NodeSortKey): string {
  return NODE_SORT_OPTIONS.find((option) => option.value === key)?.label ?? key;
}

function kindLabel(row: NodeRow): string {
  const kind = DEVICE_KIND_LABEL[row.kind];
  const subtype = row.subtype ? DEVICE_SUBTYPE_LABEL[row.subtype] : '';
  return `${kind}${subtype ? ` ${subtype}` : ''}`;
}

/**
 * 排序。
 *
 * 说明：**机柜与它的子设备始终相邻**，排序只在同级内进行 —— 否则"按 IP 排序"会把
 * 柜内设备从机柜下面拆散，树就失去意义了。同级内一律以名称做稳定兜底。
 */
export function sortNodeRows(
  rows: NodeRow[],
  key: NodeSortKey,
  direction: SortDirection = 'asc',
): NodeRow[] {
  const sign = direction === 'asc' ? 1 : -1;
  const compare = (a: NodeRow, b: NodeRow): number => {
    let result = 0;
    switch (key) {
      case 'name':
        result = a.name.localeCompare(b.name, 'zh-Hans-CN');
        break;
      case 'kind':
        result = kindLabel(a).localeCompare(kindLabel(b), 'zh-Hans-CN');
        break;
      case 'ip': {
        // 无地址的排在最后（不随方向翻转，避免"没地址的跑到最前面"）
        const av = a.ip ? (parseIp(a.ip) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
        const bv = b.ip ? (parseIp(b.ip) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
        if (av !== bv) return av - bv;
        result = 0;
        break;
      }
      case 'links':
        result = a.linkCount - b.linkCount;
        break;
      case 'rack':
        result = (a.rackName ?? a.name).localeCompare(b.rackName ?? b.name, 'zh-Hans-CN');
        if (result === 0) result = (a.rackStartU ?? 0) - (b.rackStartU ?? 0);
        break;
      case 'position':
        result = a.y - b.y || a.x - b.x;
        break;
      default:
        break;
    }
    if (result !== 0) return result * sign;
    return a.name.localeCompare(b.name, 'zh-Hans-CN');
  };

  // 分组：机柜行 + 其后紧跟的柜内设备行
  const groups: NodeRow[][] = [];
  for (const row of rows) {
    if (row.depth === 0) groups.push([row]);
    else if (groups.length > 0) (groups[groups.length - 1] as NodeRow[]).push(row);
    else groups.push([row]);
  }

  const sortedGroups = groups
    .map((group) => {
      const [head, ...children] = group as [NodeRow, ...NodeRow[]];
      const sortedChildren =
        key === 'rack' || key === 'position'
          ? [...children].sort(compare)
          : [...children].sort(compare);
      return [head, ...sortedChildren];
    })
    .sort((a, b) => compare(a[0] as NodeRow, b[0] as NodeRow));

  return sortedGroups.flat();
}

/** 关键字过滤：名称 / IP / 类型 / 型号 / 机柜名 */
export function filterNodeRows(rows: NodeRow[], query: string): NodeRow[] {
  const text = query.trim().toLowerCase();
  if (text === '') return rows;
  const matched = rows.filter((row) =>
    [row.name, row.ip ?? '', kindLabel(row), row.model ?? '', row.rackName ?? '']
      .join(' ')
      .toLowerCase()
      .includes(text),
  );
  // 子设备命中时，把它的机柜也带出来（否则看不出它在哪）
  const withParents = new Set(matched.map((row) => row.deviceId));
  const parentOf = new Map<string, string>();
  for (const row of rows) {
    if (row.depth === 0) {
      for (const child of rows) {
        if (child.depth === 1 && child.rackName === row.name) parentOf.set(child.deviceId, row.deviceId);
      }
    }
  }
  for (const row of matched) {
    const parent = parentOf.get(row.deviceId);
    if (parent) withParents.add(parent);
  }
  return rows.filter((row) => withParents.has(row.deviceId));
}

/** 行高亮判定：该设备是否被选中 */
export function rowSelected(selectedDeviceIds: string[], deviceId: string): boolean {
  return selectedDeviceIds.includes(deviceId);
}

/** 机柜行的占用摘要文本 */
export function rackUsageText(row: NodeRow): string {
  if (row.rackHeightU === undefined) return '';
  return `${row.rackUsedU ?? 0}/${row.rackHeightU}U 已用`;
}

/** U 区间文本，如 "9–12U" */
export function rackRangeText(row: NodeRow): string {
  if (row.rackStartU === undefined) return '';
  const units = row.rackUnits ?? 1;
  return units > 1 ? `${row.rackStartU}–${row.rackStartU + units - 1}U` : `${row.rackStartU}U`;
}
