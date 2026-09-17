/**
 * 设备转发行为判定（叶子模块：只依赖 schema 类型，避免循环依赖）
 *
 * 这两条规则是"家用网络能推演"的关键，见 DECISIONS D-17。
 */

import { isL2Device, type Device, type Port } from '@toposmith/schema';

/**
 * 该设备是否在二层传播广播域。
 *
 * 除交换机与 AP 外，**桥接模式的光猫/路由器也是透明网桥** ——
 * 这正是「光猫改桥接、路由器拨号」这种常见拓扑能推演的前提。
 */
export function isL2Forwarder(device: Device): boolean {
  if (isL2Device(device.kind)) return true;
  if ((device.kind === 'ont' || device.kind === 'router') && device.accessMode === 'bridge') {
    return true;
  }
  return false;
}

/**
 * 路由模式的家用网关：LAN 口与 WLAN 在设备内部桥接成一个广播域。
 * 真实家用网关的 LAN 交换口与 WiFi 是同一个二层域，三层接口浮在这个桥上。
 */
export function bridgesLanPorts(device: Device): boolean {
  return (device.kind === 'ont' || device.kind === 'router') && device.accessMode !== 'bridge';
}

/** 内部 LAN 桥的 VLAN（M0 固定为 1） */
export const LAN_BRIDGE_VLAN = 1;

export function isLanSidePort(port: Port): boolean {
  return port.role === 'lan';
}
