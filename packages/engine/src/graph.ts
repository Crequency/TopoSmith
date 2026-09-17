/**
 * World 图查询助手
 *
 * 单独抽成叶子模块（只做 type-only 引入 model）以避免运行时循环依赖：
 * model → dhcp → l2/domain 都需要这些查询，而 model 又要调用 dhcp。
 */

import type { Port } from '@toposmith/schema';
import type { Address, DerivedLink, LinkEnd, World } from './model';

export function portKey(deviceId: string, portId: string): string {
  return `${deviceId}:${portId}`;
}

/** 一个端口上的全部链路；无线端口（radio）可以有多条关联（D-11 例外） */
export function linksOfPort(world: World, deviceId: string, portId: string): DerivedLink[] {
  return world.linksByPort.get(portKey(deviceId, portId)) ?? [];
}

export function firstLinkOfPort(
  world: World,
  deviceId: string,
  portId: string,
): DerivedLink | undefined {
  const links = linksOfPort(world, deviceId, portId);
  if (links.length === 0) return undefined;
  // 确定性：按线缆 id 字典序取第一条（D-07）
  return [...links].sort((a, b) => a.id.localeCompare(b.id))[0];
}

export function otherEnd(link: DerivedLink, deviceId: string, portId: string): LinkEnd {
  const isA = link.a.deviceId === deviceId && link.a.portId === portId;
  return isA ? link.b : link.a;
}

export function portOf(world: World, deviceId: string, portId: string): Port | undefined {
  return world.devices.get(deviceId)?.ports.find((p) => p.id === portId);
}

export function addressesOf(world: World, deviceId: string): Address[] {
  return world.addresses.get(deviceId) ?? [];
}

/** 主地址：设备用于发起通信的地址（地址列表首项） */
export function primaryAddress(world: World, deviceId: string): Address | undefined {
  return addressesOf(world, deviceId)[0];
}

/** 全局按 IP 找持有者；用于 DNS 服务器定位与 ARP 之外的查询 */
export function findAddressByIp(
  world: World,
  ipValue: number,
): { deviceId: string; portId: string; address: Address } | undefined {
  for (const device of world.ordered) {
    for (const address of addressesOf(world, device.id)) {
      if (address.ipValue === ipValue) {
        return { deviceId: device.id, portId: address.portId, address };
      }
    }
  }
  return undefined;
}

/** 设备上第一个"有链路的端口"，用于静态终端地址挂载 */
export function firstConnectedPortId(world: World, deviceId: string): string | undefined {
  const device = world.devices.get(deviceId);
  if (!device) return undefined;
  for (const port of device.ports) {
    if (linksOfPort(world, deviceId, port.id).length > 0) return port.id;
  }
  return undefined;
}
