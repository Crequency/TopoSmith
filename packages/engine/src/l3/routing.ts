/**
 * 三层：路由表与最长前缀匹配
 *
 * 路由表由三类条目合成：直连（从地址推导，用户不可手工编辑）、静态、默认。
 * 同前缀长度时**直连优先于静态**，静态优先于默认 —— 与真机行为一致。
 */

import type { Device } from '@toposmith/schema';
import type { World } from '../model';
import { addressesOf } from '../graph';
import { inSubnet, ipToString, networkAddress, parseIp } from '../ip';

export type RouteKind = 'connected' | 'static' | 'default';

export interface RouteEntry {
  /** 规范化后的目的网络地址 */
  dst: number;
  prefix: number;
  kind: RouteKind;
  ifPortId: string;
  nextHop?: string;
  nextHopValue?: number;
  /** 人类可读描述，证据链直接使用 */
  via: string;
}

const KIND_RANK: Record<RouteKind, number> = { connected: 0, static: 1, default: 2 };

export function routingTable(world: World, device: Device): RouteEntry[] {
  const entries: RouteEntry[] = [];
  const seen = new Set<string>();

  const add = (entry: RouteEntry) => {
    const key = `${entry.dst}/${entry.prefix}->${entry.nextHopValue ?? 'direct'}@${entry.ifPortId}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(entry);
  };

  const addrs = addressesOf(world, device.id);

  // 1. 直连路由
  for (const address of addrs) {
    const net = networkAddress(address.ipValue, address.prefix);
    add({
      dst: net,
      prefix: address.prefix,
      kind: 'connected',
      ifPortId: address.portId,
      via: `直连 ${ipToString(net)}/${address.prefix}`,
    });
  }

  // 2. 默认路由（终端网关 / 设备默认网关）
  for (const address of addrs) {
    if (!address.gateway || address.gatewayValue === undefined) continue;
    add({
      dst: 0,
      prefix: 0,
      kind: 'default',
      ifPortId: address.portId,
      nextHop: address.gateway,
      nextHopValue: address.gatewayValue,
      via: `默认路由 → ${address.gateway}`,
    });
  }
  if (device.l3.defaultGateway) {
    const gatewayValue = parseIp(device.l3.defaultGateway);
    if (gatewayValue !== null) {
      const owner = addrs.find((a) => inSubnet(gatewayValue, a.ipValue, a.prefix));
      if (owner) {
        add({
          dst: 0,
          prefix: 0,
          kind: 'default',
          ifPortId: owner.portId,
          nextHop: device.l3.defaultGateway,
          nextHopValue: gatewayValue,
          via: `默认路由 → ${device.l3.defaultGateway}（出接口 ${owner.portId}）`,
        });
      }
    }
  }

  // 3. 静态路由（出接口由"下一跳所属网段"反推）
  for (const route of device.l3.staticRoutes) {
    const dst = parseIp(route.dst);
    const nextHop = parseIp(route.nextHop);
    if (dst === null || nextHop === null) continue;
    const owner = addrs.find((a) => inSubnet(nextHop, a.ipValue, a.prefix));
    if (!owner) continue;
    const net = networkAddress(dst, route.prefix);
    add({
      dst: net,
      prefix: route.prefix,
      kind: 'static',
      ifPortId: owner.portId,
      nextHop: route.nextHop,
      nextHopValue: nextHop,
      via: `静态路由 ${ipToString(net)}/${route.prefix} → ${route.nextHop}`,
    });
  }

  return entries;
}

/** 最长前缀匹配；同前缀长度按 connected < static < default 决出唯一结果 */
export function lookupRoute(table: RouteEntry[], ipValue: number): RouteEntry | null {
  let best: RouteEntry | null = null;
  for (const route of table) {
    if (route.prefix === 0) continue;
    if (!inSubnet(ipValue, route.dst, route.prefix)) continue;
    if (
      best === null ||
      route.prefix > best.prefix ||
      (route.prefix === best.prefix && KIND_RANK[route.kind] < KIND_RANK[best.kind])
    ) {
      best = route;
    }
  }
  if (best) return best;
  return table.find((r) => r.prefix === 0) ?? null;
}

export function describeRouteTable(table: RouteEntry[]): string {
  if (table.length === 0) return '路由表为空';
  const connected = table.filter((r) => r.kind === 'connected').length;
  const staticCount = table.filter((r) => r.kind === 'static').length;
  const def = table.filter((r) => r.kind === 'default').length;
  return `直连 ${connected} 条、静态 ${staticCount} 条、默认 ${def} 条`;
}
