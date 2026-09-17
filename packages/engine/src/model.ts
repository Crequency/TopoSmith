/**
 * World：一次推演的全部输入与派生结果
 *
 * `buildWorld` 是**唯一一次全局计算**：链路协商 → 静态地址 → DHCP 租约。
 * 之后所有诊断都在 World 上做局部搜索，因此"改一个 IP"只需重建 World，
 * 不存在缓存失效问题（docs/05-engine.md §0）。
 */

import {
  type Cable,
  type Device,
  type Duplex,
  type Port,
  type Scenario,
} from '@toposmith/schema';
import {
  cableSpec,
  cableSpeedAt,
  formatSpeed,
  wifiNominalMbps,
  type CableFamily,
} from '@toposmith/catalog';
import { inSubnet, ipToString, networkAddress, parseIp } from './ip';
import type { ReasonCode } from './diag/reasons';
import { dhcpLease, type LeaseAttempt } from './dhcp';
import { firstConnectedPortId, portKey } from './graph';
import { scanL2Loops, type L2Loop } from './l2/loop';

/* ────────────────────────────── 派生链路 ────────────────────────────── */

export interface LinkIssue {
  code: ReasonCode;
  level: 'error' | 'warn';
  text: string;
}

export interface LinkEnd {
  deviceId: string;
  portId: string;
  port: Port;
}

export interface DerivedLink {
  id: string;
  cable: Cable;
  a: LinkEnd;
  b: LinkEnd;
  up: boolean;
  /** 协商后的实际速率（Mbps）；链路 down 时为 0 */
  speedMbps: number;
  duplex: Duplex;
  family: CableFamily;
  issues: LinkIssue[];
}

/* ────────────────────────────── 地址 ────────────────────────────── */

export interface Address {
  ip: string;
  ipValue: number;
  prefix: number;
  portId: string;
  source: 'static' | 'dhcp';
  gateway?: string;
  gatewayValue?: number;
  dns: string[];
  lease?: { serverId: string; serverName: string; pool: string; index: number };
}

/* ────────────────────────────── World ────────────────────────────── */

export interface World {
  scenario: Scenario;
  devices: Map<string, Device>;
  /** 稳定排序的设备列表（按 id 字典序）—— 所有"选一个"的决策都基于它，保证确定性 */
  ordered: Device[];
  links: DerivedLink[];
  linksById: Map<string, DerivedLink>;
  /** `${deviceId}:${portId}` → 链路数组（无线端口可有多条关联） */
  linksByPort: Map<string, DerivedLink[]>;
  addresses: Map<string, Address[]>;
  /** DHCP 尝试结果（含失败原因），用于诊断解释 */
  leases: Map<string, LeaseAttempt>;
  /**
   * 二层环路（代表性的环，见 `l2/loop.ts`）。
   *
   * 建世界时算一次：环路会同时影响**诊断结论的置信度**（按最短路近似）与
   * **线缆告警**（每条卷进环路的线缆都会被挂上 warn），两处都需要它。
   */
  loops: L2Loop[];
  /** 卷进任何环路的线缆 id（完整集合，未受代表环数量上限影响） */
  loopLinkIds: Set<string>;
}

/* ────────────────────────────── 设备行为 ────────────────────────────── */

// 行为判定放在叶子模块 behavior.ts（避免 model ↔ dhcp ↔ l2 的值级循环依赖）；
// 这里重新导出，方便调用方只 import model。
export {
  LAN_BRIDGE_VLAN,
  bridgesLanPorts,
  isL2Forwarder,
  isLanSidePort,
} from './behavior';

/* ────────────────────────────── 链路协商 ────────────────────────────── */

export function negotiateLink(
  cable: Cable,
  devA: Device,
  portA: Port,
  devB: Device,
  portB: Port,
): DerivedLink {
  const spec = cableSpec(cable.type);
  const issues: LinkIssue[] = [];
  const wireless = spec.family === 'wireless';

  const endA: LinkEnd = { deviceId: devA.id, portId: portA.id, port: portA };
  const endB: LinkEnd = { deviceId: devB.id, portId: portB.id, port: portB };

  // 1. 介质配对
  const aOk = spec.pairsWith.includes(portA.medium);
  const bOk = spec.pairsWith.includes(portB.medium);
  if (!aOk || !bOk) {
    const offender = !aOk ? portA : portB;
    issues.push({
      code: 'MEDIUM_MISMATCH',
      level: 'error',
      text: (() => {
        const mediumLabel =
          offender.medium === 'rj45'
            ? '电口'
            : offender.medium === 'sfp'
              ? '光口'
              : offender.medium === 'pon'
                ? 'PON 口'
                : '无线端口';
        const hint =
          offender.medium === 'rj45'
            ? `电口需要双绞线（CAT5/CAT5e/CAT6/CAT6a），本端是 ${spec.label}。电口与光口不能直连，需要光模块或介质转换器。`
            : offender.medium === 'sfp'
              ? `光口需要光纤或 DAC（本端是 ${spec.label}）。`
              : offender.medium === 'pon'
                ? `PON 口需要光纤（单模或多模），本端是 ${spec.label}。`
                : '无线端口只能与无线端口建立关联（WiFi ↔ WiFi）。';
        return `${spec.label} 不能连接 ${offender.name}（${mediumLabel}）。${hint}`;
      })(),
    });
  }

  let speed: number;
  let duplex: Duplex;

  if (wireless) {
    // 无线：速率由两端 802.11 标准协商；共享介质折扣不在这里扣（docs/05-engine.md §5）
    const nominalA = wifiNominalMbps(devA.wireless?.standard, devA.wireless?.band);
    const nominalB = wifiNominalMbps(devB.wireless?.standard, devB.wireless?.band);
    speed = Math.min(nominalA, nominalB);
    duplex = 'half';
    if (speed === 0) {
      issues.push({
        code: 'WIFI_SHARED_MEDIUM',
        level: 'warn',
        text: '无线端口缺少 802.11 标准配置，无法协商速率，按 0 处理。请在设备面板中设置无线标准。',
      });
    }
    // SSID 必须一致才能真正关联 —— 否则客户端会一直"连不上"，这是最常见的无线故障
    const ssidA = devA.wireless?.ssid;
    const ssidB = devB.wireless?.ssid;
    if (ssidA && ssidB && ssidA !== ssidB) {
      issues.push({
        code: 'SSID_MISMATCH',
        level: 'error',
        text:
          `两端 SSID 不一致（${ssidA} ≠ ${ssidB}），无线客户端无法关联到该 AP。` +
          '请把 SSID 改成一致（注意大小写敏感）。',
      });
    }
  } else {
    // 有线：min(端口A, 端口B, 线缆在该长度下的能力)
    const cableCap = cableSpeedAt(spec, cable.lengthM);
    const portMin = Math.min(portA.speedMbps, portB.speedMbps);

    if (cable.lengthM > spec.maxLengthM) {
      issues.push({
        code: 'LINK_TOO_LONG',
        level: 'error',
        text:
          `${spec.label} 长度 ${cable.lengthM} m 超过该类别上限 ${spec.maxLengthM} m，` +
          '信号完整性无法保证 —— 链路直接不可用（不是降速）。',
      });
    }

    speed = Math.min(portMin, cableCap);
    duplex = portA.duplex === 'half' || portB.duplex === 'half' ? 'half' : 'full';

    if (speed < portMin) {
      issues.push({
        code: 'LINK_SPEED_LIMITED',
        level: 'warn',
        text:
          `${spec.label} 在 ${cable.lengthM} m 下最高支持 ${formatSpeed(cableCap)}；` +
          `两端端口标称 ${formatSpeed(portA.speedMbps)} / ${formatSpeed(portB.speedMbps)}，` +
          `链路降速至 ${formatSpeed(speed)}。`,
      });
    } else if (portA.speedMbps !== portB.speedMbps) {
      issues.push({
        code: 'LINK_SPEED_NEGOTIATED',
        level: 'warn',
        text:
          `两端端口速率不同（${portA.name} ${formatSpeed(portA.speedMbps)} / ` +
          `${portB.name} ${formatSpeed(portB.speedMbps)}），按较低者 ${formatSpeed(speed)} 协商。`,
      });
    }
  }

  const up = !issues.some((i) => i.level === 'error');

  return {
    id: cable.id,
    cable,
    a: endA,
    b: endB,
    up,
    speedMbps: up ? speed : 0,
    duplex,
    family: spec.family,
    issues,
  };
}

/* ────────────────────────────── buildWorld ────────────────────────────── */

function staticAddresses(world: World, device: Device): Address[] {
  const out: Address[] = [];

  for (const itf of device.l3.interfaces) {
    const value = parseIp(itf.ip);
    if (value === null) continue;
    out.push({
      ip: itf.ip,
      ipValue: value,
      prefix: itf.prefix,
      portId: itf.portId,
      source: 'static',
      dns: [],
    });
  }

  if (device.client?.mode === 'static' && device.client.ip) {
    const value = parseIp(device.client.ip);
    if (value !== null) {
      // 静态终端的地址必须挂在"有连线的端口"上，否则它不在任何广播域里，
      // ARP 永远解析不到（这正是"网线没插却配了 IP"的真实后果）。
      const portId = firstConnectedPortId(world, device.id) ?? device.ports[0]?.id ?? '';
      const gatewayValue = device.client.gateway ? parseIp(device.client.gateway) : null;
      out.push({
        ip: device.client.ip,
        ipValue: value,
        prefix: device.client.prefix ?? 24,
        portId,
        source: 'static',
        gateway: device.client.gateway,
        gatewayValue: gatewayValue === null ? undefined : gatewayValue,
        dns: device.client.dns ?? [],
      });
    }
  }

  return out;
}

export function buildWorld(scenario: Scenario): World {
  const devices = new Map<string, Device>(scenario.devices.map((d) => [d.id, d]));
  const ordered = [...scenario.devices].sort((a, b) => a.id.localeCompare(b.id));

  const links: DerivedLink[] = [];
  const linksById = new Map<string, DerivedLink>();
  const linksByPort = new Map<string, DerivedLink[]>();
  const addresses = new Map<string, Address[]>();
  const leases = new Map<string, LeaseAttempt>();
  const loops: L2Loop[] = [];
  const loopLinkIds = new Set<string>();

  const world: World = {
    scenario,
    devices,
    ordered,
    links,
    linksById,
    linksByPort,
    addresses,
    leases,
    loops,
    loopLinkIds,
  };

  // 1. 派生链路
  for (const cable of [...scenario.cables].sort((a, b) => a.id.localeCompare(b.id))) {
    const devA = devices.get(cable.a.deviceId);
    const devB = devices.get(cable.b.deviceId);
    if (!devA || !devB) continue;
    const portA = devA.ports.find((p) => p.id === cable.a.portId);
    const portB = devB.ports.find((p) => p.id === cable.b.portId);
    if (!portA || !portB) continue;

    const link = negotiateLink(cable, devA, portA, devB, portB);
    links.push(link);
    linksById.set(link.id, link);
    for (const end of [link.a, link.b]) {
      const key = portKey(end.deviceId, end.portId);
      const list = linksByPort.get(key);
      if (list) list.push(link);
      else linksByPort.set(key, [link]);
    }
  }

  // 2. 静态地址（必须先于 DHCP：DHCP 服务器要能被找到）
  for (const device of ordered) {
    const addrs = staticAddresses(world, device);
    if (addrs.length > 0) addresses.set(device.id, addrs);
  }

  // 3. DHCP 租约：按设备 id 字典序分配，保证确定性（D-06）
  const poolUsage = new Map<string, number>();
  for (const device of ordered) {
    if (device.client?.mode !== 'dhcp') continue;
    const attempt = dhcpLease(world, device, poolUsage);
    leases.set(device.id, attempt);
    if (attempt.ok && attempt.address) {
      addresses.set(device.id, [
        {
          ip: attempt.address.ip,
          ipValue: attempt.address.ipValue,
          prefix: attempt.address.prefix,
          portId: attempt.address.portId,
          source: 'dhcp',
          gateway: attempt.address.gateway,
          gatewayValue: attempt.address.gatewayValue,
          dns: attempt.address.dns,
          lease: attempt.serverId
            ? {
                serverId: attempt.serverId,
                serverName: attempt.serverName ?? attempt.serverId,
                pool: attempt.poolLabel ?? '',
                index: attempt.index ?? 0,
              }
            : undefined,
        },
      ]);
    }
  }

  /*
   * 4. 二层环路扫描（FR-67 / D-51）
   *
   * 放在地址之后：环路本身只依赖拓扑与端口 VLAN，但给线缆挂告警需要
   * "这个环波及了哪些设备"（广播域范围），而那需要 walked 过的链路已就绪。
   * 树形拓扑只付一次 Tarjan 的代价，没有环就什么都不做。
   */
  const scan = scanL2Loops(world);
  world.loops = scan.loops;
  world.loopLinkIds = scan.loopLinkIds;
  for (const link of links) {
    if (!scan.loopLinkIds.has(link.id)) continue;
    const loop = scan.loops.find((item) => item.linkIds.includes(link.id));
    link.issues.push({
      code: 'L2_LOOP',
      level: 'warn',
      text: loop
        ? `这条链路卷进了 VLAN ${loop.vlan} 的二层环路：${loop.label}。` +
          '没有 STP 也没有链路聚合时，广播帧会沿环无限循环（以太网帧没有 TTL）：' +
          `环内最慢的一段 ${formatSpeed(loop.slowestMbps)} 会先被打满，` +
          `该广播域内 ${loop.affected.size} 台设备一起受影响。` +
          '要么把并联的线缆做成链路聚合，要么拆掉多余的那一根。'
        : '这条链路卷进了二层环路（本场景环路较多，未逐条展开）。',
    });
  }

  return world;
}

/* ────────────────────────────── 小工具 ────────────────────────────── */

/** 设备地址的文本摘要，供 UI 与证据链使用 */
export function describeAddress(address: Address): string {
  const base = `${address.ip}/${address.prefix}`;
  if (address.source === 'dhcp') {
    return `${base}（DHCP${address.lease ? ` 由 ${address.lease.serverName} 分配` : ''}）`;
  }
  return base;
}

/** 该地址所属网段的文本表示 */
export function subnetText(address: Address): string {
  return `${ipToString(networkAddress(address.ipValue, address.prefix))}/${address.prefix}`;
}

/** 某地址是否与该设备的另一个地址同网段（用于判断"直连可达"） */
export function addressCovers(address: Address, target: number): boolean {
  return inSubnet(target, address.ipValue, address.prefix);
}
