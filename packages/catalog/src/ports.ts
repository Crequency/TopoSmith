/** 端口工厂与 VLAN 承载判定 */

import type { Duplex, Port, PortMedium, PortRole, PortSide } from '@toposmith/schema';

export interface PortSpec {
  name: string;
  medium: PortMedium;
  speedMbps: number;
  side?: PortSide;
  duplex?: Duplex;
  role: PortRole;
  vlan?: number;
  allowedVlans?: number[];
  module?: string;
  poe?: boolean;
}

/** 端口名 → 稳定 ID（`GE1` → `port-ge1`），让导出的 JSON 可读 */
export function portIdFor(name: string): string {
  return `port-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

export function makePorts(specs: PortSpec[]): Port[] {
  return specs.map((s) => ({
    id: portIdFor(s.name),
    name: s.name,
    medium: s.medium,
    speedMbps: s.speedMbps,
    side: s.side ?? 'front',
    duplex: s.duplex ?? 'full',
    role: s.role,
    vlan: s.vlan,
    allowedVlans: s.allowedVlans,
    module: s.module,
    poe: s.poe,
  }));
}

/** 端口默认 VLAN（access/lan/wan 语义） */
export function defaultVlanOf(port: Port): number {
  return port.vlan ?? 1;
}

/**
 * 该端口是否承载指定 VLAN —— 广播域划分的唯一依据。
 *
 * trunk 看允许列表；其余（access/lan/wan/wifi）看 PVID。
 * 见 docs/05-engine.md §2。
 */
export function portCarriesVlan(port: Port, vlan: number): boolean {
  if (port.role === 'trunk') return (port.allowedVlans ?? []).includes(vlan);
  return defaultVlanOf(port) === vlan;
}

/** SFP 口速率由模块决定：模块比端口标称低时取模块 */
export const SFP_MODULES = [
  { id: 'sfp-1g', label: 'SFP 1G', speedMbps: 1000 },
  { id: 'sfp+-10g', label: 'SFP+ 10G', speedMbps: 10000 },
  { id: 'sfp28-25g', label: 'SFP28 25G', speedMbps: 25000 },
] as const;

export const PON_MODULES = [
  { id: 'epon-1g', label: 'EPON 1G（上下行对称）', speedMbps: 1000 },
  { id: 'gpon-2.5g', label: 'GPON 2.5G/1.25G（非对称）', speedMbps: 2500 },
  { id: '10gepon', label: '10G-EPON（上下行 10G）', speedMbps: 10000 },
] as const;

/** 新增端口时的名字建议：按介质与已有端口取名，避免重名 */
export function suggestPortName(ports: Port[], medium: PortMedium): string {
  const prefixes: Record<PortMedium, string> = {
    rj45: 'GE',
    sfp: 'SFP+',
    pon: 'PON',
    wifi: 'WLAN',
  };
  const prefix = prefixes[medium];
  const used = new Set(ports.map((port) => port.name));
  let index = ports.filter((port) => port.medium === medium).length + 1;
  while (used.has(`${prefix}${index}`)) index += 1;
  return `${prefix}${index}`;
}

/** 新增端口的默认速率 */
export function defaultPortSpeed(medium: PortMedium): number {
  switch (medium) {
    case 'rj45':
      return 1000;
    case 'sfp':
    case 'pon':
      return 10000;
    default:
      return 0;
  }
}

/** 新增端口的默认角色 */
export function defaultPortRole(medium: PortMedium): PortRole {
  if (medium === 'wifi') return 'client';
  if (medium === 'sfp' || medium === 'pon') return 'uplink';
  return 'access';
}

/** 新增端口时携带的模块描述 */
export function defaultPortModule(medium: PortMedium): string | undefined {
  if (medium === 'sfp') return 'SFP+ 10G';
  if (medium === 'pon') return '10G-EPON';
  return undefined;
}
