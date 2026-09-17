/**
 * 二层：广播域（VLAN 感知）
 *
 * 广播域的**边界是三层设备**，不是"线的尽头"——这条规则决定了
 * "跨网段必须配网关"是推演的必然结论，而不是一条硬编码的特例。
 * 见 docs/05-engine.md §2。
 */

import type { Device, Port } from '@toposmith/schema';
import { portCarriesVlan } from '@toposmith/catalog';
import type { World } from '../model';
import { LAN_BRIDGE_VLAN, bridgesLanPorts, isL2Forwarder, isLanSidePort } from '../behavior';
import { addressesOf, linksOfPort, portKey, portOf } from '../graph';
import type { Address, DerivedLink } from '../model';

export interface DomainEntry {
  deviceId: string;
  portId: string;
}

/** 设备内部的转发面：从入口端口出发，还能把帧送到本设备的哪些端口 */
function forwardPortsWithin(device: Device, inPort: Port, vlan: number): Port[] {
  // 交换机 / AP / 桥接模式网关：在承载同一 VLAN 的端口之间转发
  if (isL2Forwarder(device)) {
    return device.ports.filter((p) => p.id !== inPort.id && portCarriesVlan(p, vlan));
  }
  // 路由模式的家用网关：LAN 口与 WLAN 内部桥接在 VLAN 1
  if (bridgesLanPorts(device) && isLanSidePort(inPort) && vlan === LAN_BRIDGE_VLAN) {
    return device.ports.filter((p) => p.id !== inPort.id && isLanSidePort(p));
  }
  return [];
}

/**
 * 从一个端口出发，求它在指定 VLAN 下的广播域成员。
 *
 * 无线关联被建模为一根线缆，因此**无线与有线走同一条代码路径**（D-12）。
 */
export function broadcastDomain(world: World, seed: DomainEntry, vlan: number): DomainEntry[] {
  const seen = new Set<string>();
  const entries: DomainEntry[] = [];
  const queue: DomainEntry[] = [];

  const push = (entry: DomainEntry) => {
    const key = portKey(entry.deviceId, entry.portId);
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(entry);
    queue.push(entry);
  };

  push(seed);

  while (queue.length > 0) {
    const current = queue.shift() as DomainEntry;
    const currentPort = portOf(world, current.deviceId, current.portId);
    if (!currentPort) continue;

    // 1. 跨线缆到对端端口（无线 radio 可有多条关联）
    for (const link of linksOfPort(world, current.deviceId, current.portId)) {
      if (!link.up) continue;
      const onA = link.a.deviceId === current.deviceId && link.a.portId === current.portId;
      const peer: DomainEntry = onA
        ? { deviceId: link.b.deviceId, portId: link.b.portId }
        : { deviceId: link.a.deviceId, portId: link.a.portId };
      const peerPort = portOf(world, peer.deviceId, peer.portId);
      if (!peerPort) continue;
      // 对端端口必须同样承载该 VLAN，否则它不属于这个广播域 —— VLAN 不匹配的根源
      if (!portCarriesVlan(peerPort, vlan)) continue;
      push(peer);
    }

    // 2. 在设备内部继续传播
    const device = world.devices.get(current.deviceId);
    if (!device) continue;
    for (const port of forwardPortsWithin(device, currentPort, vlan)) {
      push({ deviceId: device.id, portId: port.id });
    }
  }

  return entries;
}

/** 域内"真的接了线"的端口数（用于给人看的解释文本，不参与判定） */
export function linkedPortCount(world: World, entries: DomainEntry[]): number {
  return entries.filter((e) => linksOfPort(world, e.deviceId, e.portId).length > 0).length;
}

/** 域内涉及的设备名（去重、按 id 字典序，保证确定性） */
export function domainDeviceNames(world: World, entries: DomainEntry[]): string[] {
  const ids = new Set(entries.map((e) => e.deviceId));
  return world.ordered.filter((d) => ids.has(d.id)).map((d) => d.name);
}

/**
 * ARP 解析：在域内查找持有目标 IP 的设备。
 *
 * 判定必须同时满足「IP 命中」与「地址所挂端口在该域内」——
 * 少了后者，就会把路由器 WAN 口的地址误判成 LAN 广播域内可达。
 */
export function findAddressInDomain(
  world: World,
  seed: DomainEntry,
  vlan: number,
  ipValue: number,
): { deviceId: string; portId: string; address: Address } | null {
  return traceDomainPath(world, seed, vlan, ipValue).target;
}

/* ────────────────────────────── 二层路径追踪 ────────────────────────────── */

export interface DomainPathLink {
  link: DerivedLink;
  /** 从哪台设备出发经过这条链路（用于确定方向） */
  fromDeviceId: string;
}

export interface DomainPathResult {
  /** 命中目标 IP 的设备与端口；未命中为 null */
  target: { deviceId: string; portId: string; address: Address } | null;
  /** 从种子端口到目标端口**实际经过**的链路（含中间交换机两侧的链路） */
  links: DomainPathLink[];
}

function addressOnPort(world: World, entry: DomainEntry, ipValue: number): Address | null {
  for (const address of addressesOf(world, entry.deviceId)) {
    if (address.ipValue === ipValue && address.portId === entry.portId) return address;
  }
  return null;
}

/**
 * 在广播域内做 BFS，既解析出"目标 IP 由谁持有"，也记录**走过的链路序列**。
 *
 * 与 `broadcastDomain` 的区别：后者只回答"域内有哪些端口"，本函数回答
 * "从 A 到 B 具体走了哪几根线" —— 这正是带宽瓶颈判定与流向动画需要的。
 * BFS 保证最短跳数，链路迭代按 id 字典序保证结果确定（D-07）。
 */
export function traceDomainPath(
  world: World,
  seed: DomainEntry,
  vlan: number,
  ipValue: number,
): DomainPathResult {
  const seen = new Set<string>();
  const parent = new Map<string, { prev: string | null; via: DomainPathLink | null }>();
  const queue: DomainEntry[] = [];

  const push = (entry: DomainEntry, prev: string | null, via: DomainPathLink | null) => {
    const key = portKey(entry.deviceId, entry.portId);
    if (seen.has(key)) return;
    seen.add(key);
    parent.set(key, { prev, via });
    queue.push(entry);
  };

  push(seed, null, null);

  while (queue.length > 0) {
    const current = queue.shift() as DomainEntry;
    const currentKey = portKey(current.deviceId, current.portId);

    const address = addressOnPort(world, current, ipValue);
    if (address) {
      const links: DomainPathLink[] = [];
      let cursor: string | null = currentKey;
      while (cursor) {
        const node: { prev: string | null; via: DomainPathLink | null } | undefined =
          parent.get(cursor);
        if (!node) break;
        if (node.via) links.push(node.via);
        cursor = node.prev;
      }
      return {
        target: { deviceId: current.deviceId, portId: current.portId, address },
        links: links.reverse(),
      };
    }

    const currentPort = portOf(world, current.deviceId, current.portId);
    if (!currentPort) continue;

    // 1. 跨线缆（无线 radio 可有多条关联；按 id 排序保证确定性）
    const links = [...linksOfPort(world, current.deviceId, current.portId)].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
    for (const link of links) {
      if (!link.up) continue;
      const onA = link.a.deviceId === current.deviceId && link.a.portId === current.portId;
      const peer: DomainEntry = onA
        ? { deviceId: link.b.deviceId, portId: link.b.portId }
        : { deviceId: link.a.deviceId, portId: link.a.portId };
      const peerPort = portOf(world, peer.deviceId, peer.portId);
      if (!peerPort) continue;
      if (!portCarriesVlan(peerPort, vlan)) continue;
      push(peer, currentKey, { link, fromDeviceId: current.deviceId });
    }

    // 2. 设备内部转发（交换机/AP 桥接、家用网关的 LAN 桥）
    const device = world.devices.get(current.deviceId);
    if (!device) continue;
    for (const port of forwardPortsWithin(device, currentPort, vlan)) {
      push({ deviceId: device.id, portId: port.id }, currentKey, null);
    }
  }

  return { target: null, links: [] };
}
