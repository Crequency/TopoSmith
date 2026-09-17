/**
 * 二层：环路检测（无 STP/LACP 时，环路 = 广播风暴）
 *
 * 为什么这个模块存在：M0 明确**不做 STP**（D-14），而"成的环"恰恰是用户最需要被指出来的
 * 拓扑错误 —— 以太网帧没有 TTL，一个二层环路会让广播帧永远转下去：
 * 环内链路被打满、交换机 MAC 表在两个口之间抖动（MAC flapping）、
 * 整个广播域（不只是环上的设备）大概率不可用。既然不模拟风暴动力学，
 * 就必须把"这里成了环"这个**结论**算准并说出来，而不是静默地按最短路近似（D-51）。
 *
 * 判定规则（每一条都影响"会不会误报"，所以写清楚）：
 *  1. **只在同一条 VLAN 内成环**：环上所有端口的 PVID/允许列表都要承载该 VLAN。
 *     VLAN 隔开的两个网段即使物理上绕成圈，也不会互相灌广播 —— 不是环路。
 *  2. **只有转发设备参与**：端主机（网卡）不转发帧，所以"主机接了两根线到两台交换机"
 *     不成环；交换机 / AP / 桥接网关之间的并联路径才成环（与 `l2/domain.ts` 同一套
 *     内部转发规则 `forwardPortsWithin`，不允许两处各有一套真相）。
 *  3. **聚合链路收缩成一条逻辑链路**：同一对设备之间勾了 `bonded` 的并联线缆
 *     视为一条（LACP），因此"双上行做了聚合"不报环，"插了两根线却没做聚合"报环
 *     —— 这正是 FR-66/D-50 要区分的那件事。
 *  4. **只算 up 的链路**：介质不匹配、超长的线缆本来就不通帧，不构成环路。
 *  5. 结果**只给结论与代表环，不给风暴动力学**（帧速率、队列、收敛过程都不建模），
 *     并在结论里披露这一点。
 *
 * 算法：把端口图（节点 = 设备内的端口组，边 = 线缆 + 设备内部转发）按 VLAN 建出来，
 * 用 Tarjan 找**非桥边**（不在任何环上的边是桥；非桥边必然在环上），
 * 再对每条非桥边做一次"去掉它之后的最短路"，得到一条代表性环路。
 * 非桥边的集合是完整的（每条卷进环路的线缆都会被标记），代表环的数量有上限，
 * 避免病态拓扑把建世界的时间拖垮。
 */

import type { Device, Port } from '@toposmith/schema';
import { formatSpeed, portCarriesVlan } from '@toposmith/catalog';
import type { DerivedLink, World } from '../model';
import { LAN_BRIDGE_VLAN, bridgesLanPorts, isL2Forwarder, isLanSidePort } from '../behavior';
import { portKey } from '../graph';
import { broadcastDomain, type DomainEntry } from './domain';

/** 最多给出多少条"代表性环路"（非桥边本身不受此限制，全部都会被标记） */
export const MAX_REPORTED_LOOPS = 32;

export interface LoopPort {
  deviceId: string;
  portId: string;
}

export interface L2Loop {
  /** 成环的 VLAN */
  vlan: number;
  /** 环上的线缆（代表性的一根/一组；按 id 字典序，保证结果确定） */
  linkIds: string[];
  /** 环上涉及的设备（去重、按 id 字典序） */
  deviceIds: string[];
  /** 环上经过的端口（按 deviceId / portId 字典序） */
  ports: LoopPort[];
  /** 环内最慢的一段（Mbps）—— 风暴会先把这一段打满 */
  slowestMbps: number;
  /** 环上是否含无线段（无线也参与二层环路，这一点常被忽略） */
  hasWireless: boolean;
  /** 给人看的环路径，如 `接入交换机A GE23 → 二楼交换机B GE23 → 二楼交换机B GE7 → 接入交换机A GE23` */
  label: string;
  /** 该环所在广播域内的设备 id（含环上设备）—— 用于判断"谁被这个风暴波及" */
  affected: Set<string>;
}

export interface LoopScan {
  /** 代表性的环（≤ MAX_REPORTED_LOOPS，按 VLAN、再按链路 id 排序） */
  loops: L2Loop[];
  /** 卷进任何环路的线缆 id（**完整**，用于给每条线缆挂告警） */
  loopLinkIds: Set<string>;
  /** 实际检测到的环数（可能大于 `loops.length`，被上限截断时会有差额） */
  total: number;
}

/* ────────────────────────── 端口图（含聚合收缩） ────────────────────────── */

interface GraphNode {
  id: string;
  deviceId: string;
  /** 该组内的端口（聚合组的成员端口；非聚合组只有一个） */
  portIds: string[];
  ports: Port[];
}

interface GraphEdge {
  id: string;
  a: string;
  b: string;
  /** 这条逻辑边对应的线缆（聚合组多条，普通链路一条） */
  links: DerivedLink[];
}

interface PortGraph {
  nodes: Map<string, GraphNode>;
  /** `${deviceId}:${portId}` → 节点 id */
  nodeOf: Map<string, string>;
}

/**
 * 建立"设备内端口组"：勾了聚合的并联线缆，其同一设备侧的端口合并成一个节点。
 *
 * 组身份由"两端设备"唯一确定（schema 里没有组 id），所以这里先把
 * `bonded` 的链路按设备对分组，再在每台设备内部把对应端口并起来。
 */
function buildPortGraph(world: World): PortGraph {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== undefined && parent.get(root) !== root) {
      root = parent.get(root) as string;
    }
    while (parent.get(key) !== undefined && parent.get(key) !== root) {
      const next = parent.get(key) as string;
      parent.set(key, root);
      key = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // 同一对设备之间勾了聚合的线缆 → 各自把本端端口并成一组
  const byPair = new Map<string, DerivedLink[]>();
  for (const link of world.links) {
    if (!link.cable.bonded) continue;
    const pair = [link.a.deviceId, link.b.deviceId].sort().join('→');
    const list = byPair.get(pair);
    if (list) list.push(link);
    else byPair.set(pair, [link]);
  }
  for (const links of [...byPair.values()]) {
    for (const deviceId of [links[0].a.deviceId, links[0].b.deviceId]) {
      const ports = links
        .flatMap((link) => [link.a, link.b])
        .filter((end) => end.deviceId === deviceId)
        .map((end) => portKey(end.deviceId, end.portId))
        .sort();
      for (let i = 1; i < ports.length; i += 1) union(ports[0], ports[i]);
    }
  }

  /*
   * 节点 = 设备内的端口组：**每个参与的端口都属于某个组**（没做聚合的端口自成一组成员）。
   *
   * 这里遍历的是"设备的端口"，而不是"被聚合过的端口" —— 后者曾让整张图是空的，
   * 于是任何环路都检测不出来（普通拓扑里一条 `bonded` 都没有）。
   * "参与"的判定在下面的循环里：转发设备的全部端口 + 任何接了线的端口。
   */
  const nodes = new Map<string, GraphNode>();
  const nodeOf = new Map<string, string>();
  for (const device of world.ordered) {
    /*
     * 只为"可能参与环路"的端口建节点：转发设备的全部端口（它们在同一座桥里），
     * 以及任何**接了线**的端口。端主机上没有连线的网卡永远进不了环
     * （主机不转发帧），为它们建节点在 800 台设备的场景里纯属浪费。
     */
    const forwarder = isL2Forwarder(device) || bridgesLanPorts(device);
    const byRoot = new Map<string, string[]>();
    for (const port of device.ports) {
      const key = portKey(device.id, port.id);
      if (!forwarder && (world.linksByPort.get(key)?.length ?? 0) === 0) continue;
      const root = parent.has(key) ? find(key) : key;
      const list = byRoot.get(root);
      if (list) list.push(port.id);
      else byRoot.set(root, [port.id]);
    }
    for (const portIds of byRoot.values()) {
      const ids = [...portIds].sort();
      const nodeId = `${device.id}#${ids[0]}`;
      nodes.set(nodeId, {
        id: nodeId,
        deviceId: device.id,
        portIds: ids,
        ports: ids
          .map((portId) => device.ports.find((p) => p.id === portId))
          .filter((port): port is Port => port !== undefined),
      });
      for (const id of ids) nodeOf.set(portKey(device.id, id), nodeId);
    }
  }

  return { nodes, nodeOf };
}

/** 节点在指定 VLAN 下是否"活"（组内任一端口承载该 VLAN） */
function nodeCarriesVlan(node: GraphNode, vlan: number): boolean {
  return node.ports.some((port) => portCarriesVlan(port, vlan));
}

/** 该设备在指定 VLAN 下会做二层转发的端口组 */
function forwardingGroups(graph: PortGraph, device: Device, vlan: number): GraphNode[] {
  const portIds = new Set<string>();
  if (isL2Forwarder(device)) {
    for (const port of device.ports) {
      if (portCarriesVlan(port, vlan)) portIds.add(port.id);
    }
  } else if (bridgesLanPorts(device) && vlan === LAN_BRIDGE_VLAN) {
    for (const port of device.ports) {
      if (isLanSidePort(port) && portCarriesVlan(port, vlan)) portIds.add(port.id);
    }
  }

  const seen = new Set<string>();
  const groups: GraphNode[] = [];
  for (const portId of [...portIds].sort()) {
    const nodeId = graph.nodeOf.get(portKey(device.id, portId));
    if (!nodeId || seen.has(nodeId)) continue;
    seen.add(nodeId);
    const node = graph.nodes.get(nodeId);
    if (node) groups.push(node);
  }
  return groups;
}

/* ────────────────────────── 环扫描 ────────────────────────── */

/** 场景里出现过的所有 VLAN（access 的 PVID / trunk 的允许列表 / 无线与桥固定的 VLAN 1） */
function vlansOf(world: World): number[] {
  const vlans = new Set<number>([LAN_BRIDGE_VLAN]);
  for (const device of world.ordered) {
    for (const port of device.ports) {
      if (port.vlan !== undefined) vlans.add(port.vlan);
      for (const vlan of port.allowedVlans ?? []) vlans.add(vlan);
    }
  }
  return [...vlans].sort((a, b) => a - b);
}

/** 找非桥边：Tarjan 低值算法，多重边的父边要按**边 id** 而不是父节点排除 */
function findNonBridges(nodes: string[], adjacency: Map<string, GraphEdge[]>): Set<string> {
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const bridges = new Set<string>();
  let timer = 0;

  for (const root of nodes) {
    if (disc.has(root)) continue;
    disc.set(root, timer);
    low.set(root, timer);
    timer += 1;
    const stack: { node: string; parentEdge: string | null; index: number }[] = [
      { node: root, parentEdge: null, index: 0 },
    ];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const edges = adjacency.get(frame.node) ?? [];
      if (frame.index < edges.length) {
        const edge = edges[frame.index];
        frame.index += 1;
        if (edge.id === frame.parentEdge) continue;
        const next = edge.a === frame.node ? edge.b : edge.a;
        if (disc.has(next)) {
          low.set(frame.node, Math.min(low.get(frame.node) as number, disc.get(next) as number));
        } else {
          disc.set(next, timer);
          low.set(next, timer);
          timer += 1;
          stack.push({ node: next, parentEdge: edge.id, index: 0 });
        }
      } else {
        stack.pop();
        const parent = stack[stack.length - 1];
        if (!parent) continue;
        low.set(parent.node, Math.min(low.get(parent.node) as number, low.get(frame.node) as number));
        if ((low.get(frame.node) as number) > (disc.get(parent.node) as number)) {
          bridges.add(frame.parentEdge as string);
        }
      }
    }
  }

  const nonBridges = new Set<string>();
  for (const edges of adjacency.values()) {
    for (const edge of edges) {
      if (!bridges.has(edge.id)) nonBridges.add(edge.id);
    }
  }
  return nonBridges;
}

/** 去掉 `banned` 这条边之后，a → b 的最短路（返回经过的边，按顺序） */
function shortestPathWithout(
  adjacency: Map<string, GraphEdge[]>,
  from: string,
  to: string,
  banned: string,
): GraphEdge[] | null {
  const prev = new Map<string, { node: string; edge: GraphEdge }>();
  const seen = new Set<string>([from]);
  const queue: string[] = [from];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === to) break;
    for (const edge of adjacency.get(current) ?? []) {
      if (edge.id === banned) continue;
      const next = edge.a === current ? edge.b : edge.a;
      if (seen.has(next)) continue;
      seen.add(next);
      prev.set(next, { node: current, edge });
      queue.push(next);
    }
  }

  if (!prev.has(to) && from !== to) return null;
  const path: GraphEdge[] = [];
  let cursor = to;
  while (cursor !== from) {
    const step = prev.get(cursor);
    if (!step) return null;
    path.push(step.edge);
    cursor = step.node;
  }
  return path.reverse();
}

/** 环路径文本：`设备A 端口 → 设备B 端口 → … → 设备A 端口`（闭合） */
function describeCycle(world: World, cycle: GraphEdge[], startNode: string): string {
  const nameOf = (deviceId: string): string => world.devices.get(deviceId)?.name ?? deviceId;
  const nodeOfId = (nodeId: string): { deviceId: string; portIds: string[] } => {
    const sep = nodeId.indexOf('#');
    return { deviceId: nodeId.slice(0, sep), portIds: [nodeId.slice(sep + 1)] };
  };

  const labelOf = (nodeId: string): string | null => {
    const at = nodeOfId(nodeId);
    const device = world.devices.get(at.deviceId);
    // 星心是设备内部的虚拟转发节点（没有端口）：它代表"在设备里转了一下"，
    // 不占用路径文本 —— 否则每条环里都会多出一个没有端口名的设备名
    if (at.portIds[0] === 'hub') return null;
    const port = device?.ports.find((p) => p.id === at.portIds[0]);
    return `${nameOf(at.deviceId)} ${port?.name ?? at.portIds[0]}`;
  };

  const parts: string[] = [];
  let current = startNode;
  const head = labelOf(startNode);
  if (head) parts.push(head);
  for (const edge of cycle) {
    const bonded = edge.links.length > 1 ? `（聚合 ${edge.links.length} 根）` : '';
    if (bonded && parts.length > 0) parts[parts.length - 1] += bonded;
    current = edge.a === current ? edge.b : edge.a;
    const label = labelOf(current);
    if (label) parts.push(label);
  }

  return parts.join(' → ');
}

/**
 * 扫描全网二层环路。
 *
 * 复杂度：每个 VLAN 一次 O(V+E) 的建图 + 一次 Tarjan；代表环每条一次 BFS。
 * 树形拓扑（绝大多数场景）只付第一次的代价，不会有代表环的 BFS。
 */
export function scanL2Loops(world: World): LoopScan {
  const graph = buildPortGraph(world);
  const loops: L2Loop[] = [];
  const loopLinkIds = new Set<string>();
  const seenCycles = new Set<string>();
  let total = 0;

  for (const vlan of vlansOf(world)) {
    // 1. 节点：该 VLAN 下参与的端口组
    const activeNodes = [...graph.nodes.values()]
      .filter((node) => nodeCarriesVlan(node, vlan))
      .map((node) => node.id)
      .sort();
    if (activeNodes.length === 0) continue;
    const activeSet = new Set(activeNodes);

    // 2. 边：线缆（聚合组收缩） + 设备内部转发
    const adjacency = new Map<string, GraphEdge[]>();
    const edges = new Map<string, GraphEdge>();
    const addEdge = (edge: GraphEdge): void => {
      edges.set(edge.id, edge);
      for (const end of [edge.a, edge.b]) {
        const list = adjacency.get(end);
        if (list) list.push(edge);
        else adjacency.set(end, [edge]);
      }
    };

    /** 该 VLAN 下新建的星心（虚拟转发节点） */
    const hubNodes: string[] = [];
    const byLogicalLink = new Map<string, GraphEdge>();
    for (const link of world.links) {
      if (!link.up) continue;
      const nodeA = graph.nodeOf.get(portKey(link.a.deviceId, link.a.portId));
      const nodeB = graph.nodeOf.get(portKey(link.b.deviceId, link.b.portId));
      if (!nodeA || !nodeB) continue;
      if (!activeSet.has(nodeA) || !activeSet.has(nodeB)) continue;
      if (!portCarriesVlan(link.a.port, vlan) || !portCarriesVlan(link.b.port, vlan)) continue;

      const key = link.cable.bonded
        ? `bond:${[link.a.deviceId, link.b.deviceId].sort().join('→')}`
        : `link:${link.id}`;
      const existing = byLogicalLink.get(key);
      if (existing) {
        existing.links.push(link);
        continue;
      }
      const edge: GraphEdge = { id: key, a: nodeA, b: nodeB, links: [link] };
      byLogicalLink.set(key, edge);
      addEdge(edge);
    }

    /*
     * 设备内部转发：用一个**星形中心**表示这台设备的转发面，而不是端口两两全连接。
     *
     * 两种画法在"哪条线缆卷进了环"上完全等价（星心是中心，去掉任意一条线缆后
     * 各端口的连通性与全连接一致），但边的数量从 k(k-1)/2 降到 k：
     * 一台 26 口交换机从 325 条边降到 26 条 —— IDC 那种规模下这是几十毫秒的差别。
     * 星心只是建模用的虚拟节点，没有端口，也就不会出现在环路径文本里。
     */
    for (const device of world.ordered) {
      const groups = forwardingGroups(graph, device, vlan);
      if (groups.length < 2) continue;
      const hubId = `${device.id}#hub`;
      hubNodes.push(hubId);
      for (const group of groups) {
        addEdge({ id: `int:${device.id}:${vlan}:${group.id}`, a: hubId, b: group.id, links: [] });
      }
    }

    if (edges.size === 0) continue;

    // 3. 非桥边 = 卷进环路的逻辑链路（星心节点也要参与遍历）
    const nonBridges = findNonBridges([...activeNodes, ...hubNodes].sort(), adjacency);
    const cycleEdges = [...nonBridges]
      .map((id) => edges.get(id))
      .filter((edge): edge is GraphEdge => edge !== undefined && edge.links.length > 0)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (cycleEdges.length === 0) continue;

    for (const edge of cycleEdges) {
      for (const link of edge.links) loopLinkIds.add(link.id);
    }

    // 4. 代表环：每条非桥边去掉自己后找一条回到起点的路
    for (const edge of cycleEdges) {
      const path = shortestPathWithout(adjacency, edge.a, edge.b, edge.id);
      if (!path) continue;
      /*
       * 闭合成环：代表边把 f→a 打通之后，要沿**反过来的**最短路走回起点，
       * 才是一条首尾相接的走法（`path` 本身是 a→b，直接拼上去是"8 字"而不是环）。
       */
      const cycle = [edge, ...[...path].reverse()];

      const links = [...new Set(cycle.flatMap((item) => item.links.map((link) => link.id)))].sort();
      const signature = `${vlan}|${links.join(',')}`;
      if (seenCycles.has(signature)) continue;
      seenCycles.add(signature);
      total += 1;
      if (loops.length >= MAX_REPORTED_LOOPS) continue;

      const memberLinks = cycle.flatMap((item) => item.links);
      /*
       * 环上经过的端口：取每条边**两端节点**的全部端口，而不是只取代表链路的两端 ——
       * 聚合组是一个节点，它的每一个成员端口都在环上（两条上联都在传同一份广播帧）。
       */
      const ports: LoopPort[] = [];
      const seenPorts = new Set<string>();
      for (const item of cycle) {
        for (const nodeId of [item.a, item.b]) {
          const node = graph.nodes.get(nodeId);
          if (!node) continue;
          for (const portId of node.portIds) {
            const key = portKey(node.deviceId, portId);
            if (seenPorts.has(key)) continue;
            seenPorts.add(key);
            ports.push({ deviceId: node.deviceId, portId });
          }
        }
      }
      const deviceIds = [...new Set(ports.map((port) => port.deviceId))].sort();
      const seedEnd = cycle[0].links[0].a;
      const seed: DomainEntry = { deviceId: seedEnd.deviceId, portId: seedEnd.portId };
      // 受影响范围 = 该环所在广播域（风暴不只影响环上的设备）
      const affected = new Set(broadcastDomain(world, seed, vlan).map((e) => e.deviceId));

      const slowest = Math.min(...memberLinks.map((link) => link.speedMbps));

      loops.push({
        vlan,
        linkIds: links,
        deviceIds,
        ports: [...ports].sort((a, b) =>
          a.deviceId === b.deviceId
            ? a.portId.localeCompare(b.portId)
            : a.deviceId.localeCompare(b.deviceId),
        ),
        slowestMbps: slowest,
        hasWireless: memberLinks.some((link) => link.family === 'wireless'),
        label: describeCycle(world, cycle, cycle[0].a),
        affected,
      });
    }
  }

  loops.sort((a, b) => (a.vlan === b.vlan ? a.linkIds[0].localeCompare(b.linkIds[0]) : a.vlan - b.vlan));
  return { loops, loopLinkIds, total };
}

/** 只取代表性的环（调用方只关心"有哪些环"时用） */
export function detectL2Loops(world: World): L2Loop[] {
  return scanL2Loops(world).loops;
}

/** 环上最慢的一段（风暴先打满它）的文本 */
export function stormSaturationText(loop: L2Loop): string {
  return formatSpeed(loop.slowestMbps);
}
