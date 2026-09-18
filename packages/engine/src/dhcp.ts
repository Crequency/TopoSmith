/**
 * DHCP 租约推演
 *
 * 第一条硬约束：**DHCP 是广播协议，服务器必须与客户端在同一广播域**。
 * 这不是简化，而是真实世界的核心约束，也是"为什么路由器另一头的 DHCP 分配不到地址"的标准答案。
 *
 * 分配顺序按**客户端 id 字典序**决定，不依赖时间与请求顺序 —— 保证确定性（D-06）。
 */

import type { Device } from '@toposmith/schema';
import { defaultVlanOf } from '@toposmith/catalog';
import type { World } from './model';
import { addressesOf, linksOfPort } from './graph';
import { addToIp, inSubnet, ipToString, parseIp } from './ip';
import type { ReasonCode } from './diag/reasons';
import { broadcastDomain, domainDeviceNames } from './l2/domain';

export interface LeaseAddress {
  ip: string;
  ipValue: number;
  prefix: number;
  portId: string;
  gateway?: string;
  gatewayValue?: number;
  dns: string[];
}

export interface LeaseAttempt {
  ok: boolean;
  address?: LeaseAddress;
  serverId?: string;
  serverName?: string;
  poolLabel?: string;
  /** 池内偏移（0 起） */
  index?: number;
  failure?: ReasonCode;
  detail: string;
  /** 尝试过的端口名，用于解释"通过哪个口申请的" */
  triedPorts: string[];
}

export function dhcpLease(
  world: World,
  device: Device,
  usage: Map<string, number>,
): LeaseAttempt {
  // 有线优先、无线其次（确定性：端口顺序稳定）
  const ports = [...device.ports].sort(
    (a, b) => (a.medium === 'wifi' ? 1 : 0) - (b.medium === 'wifi' ? 1 : 0),
  );

  const triedPorts: string[] = [];

  for (const port of ports) {
    // 只有"线缆存在且链路可用"的端口才能发出 DHCP 请求：
    // 超长或介质不匹配的链路虽然插着线，但一个包也发不出去
    if (!linksOfPort(world, device.id, port.id).some((link) => link.up)) continue;
    triedPorts.push(port.name);

    const vlan = defaultVlanOf(port);
    const entries = broadcastDomain(world, { deviceId: device.id, portId: port.id }, vlan);

    for (const serverDevice of world.ordered) {
      /*
       * 设备不会向自己申请地址。
       *
       * 这条规则是给"既是 DHCP 服务器又是 DHCP 客户端"的设备用的 ——
       * 5G CPE、家用网关都是这种：LAN 侧自己是服务器，WAN 侧要向运营商申请地址。
       * 没有它的话，CPE 会先在自己 LAN 口上"发现"自己的 DHCP 服务，
       * 于是从自己的池里领一个内网地址当 WAN 地址 —— 一个自相矛盾的结论。
       */
      if (serverDevice.id === device.id) continue;
      const pool = serverDevice.services.dhcp;
      if (!pool?.enabled) continue;

      const poolStart = parseIp(pool.poolStart);
      const poolEnd = parseIp(pool.poolEnd);
      if (poolStart === null || poolEnd === null) continue;

      for (const serverAddress of addressesOf(world, serverDevice.id)) {
        // 地址池必须落在服务器自身某个接口的网段内
        if (!inSubnet(poolStart, serverAddress.ipValue, serverAddress.prefix)) continue;
        // 服务器该接口必须就在客户端的广播域内
        const inDomain = entries.some(
          (e) => e.deviceId === serverDevice.id && e.portId === serverAddress.portId,
        );
        if (!inDomain) continue;

        const used = usage.get(serverDevice.id) ?? 0;
        const candidate = addToIp(poolStart, used);
        if (candidate > poolEnd) {
          return {
            ok: false,
            failure: 'POOL_EXHAUSTED',
            detail:
              `${serverDevice.name} 的地址池 ${pool.poolStart}–${pool.poolEnd} 已分配完` +
              `（已分配 ${used} 个），${device.name} 只能等待租约释放或扩大地址池。`,
            triedPorts,
          };
        }
        usage.set(serverDevice.id, used + 1);

        const gatewayValue = pool.gateway ? parseIp(pool.gateway) : null;
        const ip = ipToString(candidate);
        return {
          ok: true,
          address: {
            ip,
            ipValue: candidate,
            prefix: serverAddress.prefix,
            portId: port.id,
            gateway: pool.gateway,
            gatewayValue: gatewayValue === null ? undefined : gatewayValue,
            dns: [...pool.dns],
          },
          serverId: serverDevice.id,
          serverName: serverDevice.name,
          poolLabel: `${pool.poolStart}–${pool.poolEnd}`,
          index: used,
          detail:
            `${device.name} 在端口 ${port.name}（VLAN ${vlan}）发起 DHCP 广播，` +
            `由同一广播域内的 ${serverDevice.name} 分配地址 ${ip}/${serverAddress.prefix}` +
            `${pool.gateway ? `，网关 ${pool.gateway}` : ''}` +
            `${pool.dns.length > 0 ? `，DNS ${pool.dns.join('、')}` : ''}。`,
          triedPorts,
        };
      }
    }
  }

  if (triedPorts.length === 0) {
    return {
      ok: false,
      failure: 'NO_SOURCE_ADDRESS',
      detail:
        `${device.name} 没有任何已连接的端口（网线未连接，或无线未关联到 AP），` +
        '无法发出 DHCP 请求，因此没有地址。',
      triedPorts,
    };
  }

  // 找出第一个候选端口所在域的设备清单，帮助用户判断"是不是插错地方了"
  const firstPort = ports.find((p) => triedPorts.includes(p.name));
  let domainHint = '';
  if (firstPort) {
    const entries = broadcastDomain(
      world,
      { deviceId: device.id, portId: firstPort.id },
      defaultVlanOf(firstPort),
    );
    const names = domainDeviceNames(world, entries);
    domainHint = `该广播域内只有：${names.join('、')}。`;
  }

  return {
    ok: false,
    failure: 'NO_DHCP_SERVER',
    detail:
      `${device.name} 在端口 ${triedPorts.join('、')} 发出 DHCP 广播，` +
      `但同一广播域内没有启用 DHCP 服务的服务器。` +
      'DHCP 是广播协议，无法跨越三层设备（路由器/光猫）—— 服务器必须与客户端在同二层域。' +
      domainHint,
    triedPorts,
  };
}
