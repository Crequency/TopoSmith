/**
 * 逐跳推演：可达性（ping）与数据包链路（traceroute）是**同一个算法**
 *
 * 它们的信息需求完全一致（逐跳转发决策），差别只在输出裁剪。
 * 合并之后，用户问"不通"时不需要再单独跑一次路径 —— 见 docs/05-engine.md §4。
 */

import type { Device } from '@toposmith/schema';
import { isEndHost } from '@toposmith/schema';
import { cableLabel, defaultVlanOf, formatSpeed, portCarriesVlan } from '@toposmith/catalog';
import { describeAddress, type Address, type World } from '../model';
import {
  addressesOf,
  firstLinkOfPort,
  otherEnd,
  primaryAddress,
  portOf,
} from '../graph';
import {
  broadcastDomain,
  domainDeviceNames,
  linkedPortCount,
  traceDomainPath,
} from '../l2/domain';
import { describeRouteTable, lookupRoute, routingTable } from '../l3/routing';
import { inSubnet, ipToString, isPrivateIp, parseIp } from '../ip';
import { mkStep, type ReasonCode } from './reasons';
import type { DiagStep, Hop } from './types';

export interface TraceResult {
  ok: boolean;
  summary: string;
  steps: DiagStep[];
  hops: Hop[];
  dstIpValue: number;
  srcAddress?: Address;
  failure?: ReasonCode;
}

interface FailInit {
  code: ReasonCode;
  detail: string;
  deviceId?: string;
  portId?: string;
  data?: Record<string, unknown>;
}

export function trace(
  world: World,
  srcDeviceId: string,
  dstIpText: string,
  maxTtl = 16,
): TraceResult {
  const steps: DiagStep[] = [];
  const hops: Hop[] = [];
  let dstIpValue = 0;

  const finishFail = (init: FailInit, summary: string): TraceResult => {
    steps.push(mkStep(init.code, 'error', init.detail, { deviceId: init.deviceId, portId: init.portId, data: init.data }));
    return { ok: false, summary, steps, hops, dstIpValue, failure: init.code };
  };

  const parsedDst = parseIp(dstIpText);
  if (parsedDst === null) {
    return finishFail(
      { code: 'DST_INVALID', detail: `目标地址「${dstIpText}」不是合法的 IPv4 地址。` },
      '目标地址不合法，无法推演。',
    );
  }
  const dstValue: number = parsedDst;
  dstIpValue = dstValue;

  const src = world.devices.get(srcDeviceId);
  if (!src) {
    return finishFail(
      { code: 'SRC_MISSING', detail: `找不到源设备 ${srcDeviceId}。` },
      '源设备不存在。',
    );
  }

  const srcAddress = primaryAddress(world, src.id);
  if (!srcAddress) {
    const lease = world.leases.get(src.id);
    if (lease?.failure) {
      steps.push(mkStep(lease.failure, 'error', lease.detail, { deviceId: src.id }));
      return {
        ok: false,
        summary: `${src.name} 没有可用地址：${lease.failure === 'NO_DHCP_SERVER' ? '广播域内没有 DHCP 服务器' : lease.failure === 'POOL_EXHAUSTED' ? 'DHCP 地址池已耗尽' : '端口未连接'}`,
        steps,
        hops,
        dstIpValue: dstValue,
        failure: lease.failure,
      };
    }
    return finishFail(
      {
        code: 'NO_SOURCE_ADDRESS',
        detail: `${src.name} 没有配置任何 IP 地址，也没有 DHCP 客户端配置，无法作为通信源。`,
        deviceId: src.id,
      },
      `${src.name} 没有可用地址，无法发起通信。`,
    );
  }

  steps.push(
    mkStep('SRC_ADDRESS', 'info', `${src.name} 使用地址 ${describeAddress(srcAddress)}（端口 ${srcAddress.portId}）。`, {
      deviceId: src.id,
      portId: srcAddress.portId,
      data: { source: srcAddress.source, prefix: srcAddress.prefix, gateway: srcAddress.gateway },
    }),
  );

  // SNAT 之后，网络里"看到的源地址"就变了；据此避免在多台设备上重复判定 NAT
  let effectiveSrcValue = srcAddress.ipValue;

  let current: Device = src;
  let inPortId: string | undefined;
  let ttl = maxTtl;
  let hopIndex = 0;

  while (ttl > 0) {
    ttl -= 1;

    // a. 到达本机？
    const localHit = addressesOf(world, current.id).find((a) => a.ipValue === dstValue);
    if (localHit) {
      steps.push(
        mkStep('REACHED', 'ok', `${ipToString(dstValue)} 是 ${current.name} 的本机地址，报文送达。`, {
          deviceId: current.id,
          portId: localHit.portId,
        }),
      );
      const inPortName = inPortId ? portOf(world, current.id, inPortId)?.name : undefined;
      hops.push({
        index: hopIndex,
        deviceId: current.id,
        deviceName: current.name,
        inPort: inPortName,
        inPortId,
        note: '目的地',
      });
      return {
        ok: true,
        summary: `${src.name} → ${ipToString(dstValue)} 可达，共经过 ${hops.length} 台设备。`,
        steps,
        hops,
        dstIpValue: dstValue,
        srcAddress,
      };
    }

    // b. 查路由表
    const table = routingTable(world, current);
    const route = lookupRoute(table, dstValue);
    if (!route) {
      const endHost = isEndHost(current.kind);
      const code: ReasonCode = endHost ? 'NO_GATEWAY' : 'NO_ROUTE';
      const detail = endHost
        ? `${current.name} 的路由表里没有能到达 ${ipToString(dstValue)} 的条目，` +
          `且没有配置默认网关。终端要访问其他网段，必须配置网关（或缺省路由）。`
        : `${current.name} 的路由表里没有匹配 ${ipToString(dstValue)} 的条目（${describeRouteTable(table)}）。` +
          `跨网段转发需要网关或明细路由。`;
      return finishFail({ code, detail, deviceId: current.id }, `${current.name} 无路由可达目标。`);
    }

    steps.push(
      mkStep('ROUTE_MATCH', 'info', `${current.name} 命中 ${route.via}。`, {
        deviceId: current.id,
        portId: route.ifPortId,
        data: { prefix: route.prefix, kind: route.kind, nextHop: route.nextHop ?? '直连' },
      }),
    );

    // c. 出接口与链路
    const outPort = portOf(world, current.id, route.ifPortId);
    if (!outPort) {
      return finishFail(
        {
          code: 'PORT_NOT_CONNECTED',
          detail: `${current.name} 的路由出接口 ${route.ifPortId} 不存在。`,
          deviceId: current.id,
        },
        `${current.name} 出接口无效。`,
      );
    }
    const link = firstLinkOfPort(world, current.id, outPort.id);
    if (!link) {
      return finishFail(
        {
          code: 'PORT_NOT_CONNECTED',
          detail:
            `${current.name} 的出接口 ${outPort.name} 没有连接任何线缆。` +
            '请检查拓扑：这个端口是空的，报文从这里出去就没有下一站了。',
          deviceId: current.id,
          portId: outPort.id,
        },
        `${current.name} 的 ${outPort.name} 未连接，链路中断。`,
      );
    }
    if (!link.up) {
      const firstError = link.issues.find((i) => i.level === 'error');
      const code: ReasonCode = firstError?.code ?? 'LINK_DOWN';
      return finishFail(
        {
          code,
          detail:
            `${current.name} 的 ${outPort.name} 链路不可用：` +
            link.issues.map((i) => i.text).join(' ') +
            `（线缆：${cableLabel(link.cable.type)}，${link.cable.lengthM} m，协商速率 ${formatSpeed(link.speedMbps)}）`,
          deviceId: current.id,
          portId: outPort.id,
          data: { cableType: link.cable.type, lengthM: link.cable.lengthM },
        },
        `${current.name} 的 ${outPort.name} 链路不可用（${firstError?.code ?? 'LINK_DOWN'}）。`,
      );
    }

    const vlan = defaultVlanOf(outPort);
    const nextHopValue = route.nextHopValue ?? dstValue;
    const nextHopIp = route.nextHop ?? ipToString(dstValue);

    // d. VLAN 一致性检查（对端端口必须承载同一 VLAN，否则根本不构成同一广播域）
    const peer = otherEnd(link, current.id, outPort.id);
    const peerPort = portOf(world, peer.deviceId, peer.portId);
    if (peerPort && !portCarriesVlan(peerPort, vlan)) {
      const peerVlanText =
        peerPort.role === 'trunk'
          ? `trunk，允许 VLAN ${(peerPort.allowedVlans ?? []).join('、') || '（空）'}`
          : `VLAN ${defaultVlanOf(peerPort)}`;
      const peerDevice = world.devices.get(peer.deviceId);
      return finishFail(
        {
          code: 'VLAN_MISMATCH',
          detail:
            `本端 ${current.name} 的 ${outPort.name} 属于 VLAN ${vlan}，` +
            `而直连的对端 ${peerDevice?.name ?? peer.deviceId} 的 ${peerPort.name} 是 ${peerVlanText}。` +
            '两者不在同一广播域，二层无法互通（即使物理链路是通的）。' +
            '要么把两端改成同一 VLAN，要么在 trunk 上放行该 VLAN。',
          deviceId: current.id,
          portId: outPort.id,
          data: { localVlan: vlan, peerPort: peerPort.name, peerRole: peerPort.role },
        },
        `VLAN 不匹配：${outPort.name}（VLAN ${vlan}）与对端 ${peerPort.name} 不在同一广播域。`,
      );
    }

    // e. ARP：在出接口所在广播域内解析下一跳（同时记录二层实际经过的链路）
    const seed = { deviceId: current.id, portId: outPort.id };
    const domainPath = traceDomainPath(world, seed, vlan, nextHopValue);
    const target = domainPath.target;
    if (!target) {
      const entries = broadcastDomain(world, seed, vlan);
      const names = domainDeviceNames(world, entries);
      const isDirect = route.nextHopValue === undefined;
      return finishFail(
        {
          code: 'ARP_FAILED',
          detail:
            `在 ${current.name} 的 ${outPort.name} 所在 VLAN ${vlan} 广播域内，` +
            `没有任何设备持有 ${isDirect ? '目标地址' : '下一跳'} ${nextHopIp}。` +
            `该广播域内共 ${linkedPortCount(world, entries)} 个已连接端口，涉及设备：${names.join('、')}。` +
            '常见原因：目标主机不在这个 VLAN / 网线插在了别的交换机上 / 网关地址填错。',
          deviceId: current.id,
          portId: outPort.id,
          data: { vlan, nextHop: nextHopIp, domainDevices: names },
        },
        `ARP 解析失败：VLAN ${vlan} 内没有设备持有 ${nextHopIp}。`,
      );
    }

    const targetDevice = world.devices.get(target.deviceId);
    const targetPort = portOf(world, target.deviceId, target.portId);
    const transit = domainPath.links.map((item) => item.link.id);
    const l2Note =
      transit.length > 1
        ? `，二层路径共 ${transit.length} 段链路（穿过了不做三层转发的中间设备）`
        : '';
    steps.push(
      mkStep(
        'ARP_OK',
        'info',
        `在 VLAN ${vlan} 内解析到 ${nextHopIp} → ${targetDevice?.name ?? target.deviceId}（${targetPort?.name ?? target.portId}）${l2Note}。`,
        {
          deviceId: target.deviceId,
          portId: target.portId,
          data: { transitLinkCount: transit.length },
        },
      ),
    );

    // f. NAT 判定：私网源经公网出接口转发到本网段之外
    const egressAddress = addressesOf(world, current.id).find((a) => a.portId === outPort.id);
    if (
      egressAddress &&
      isPrivateIp(effectiveSrcValue) &&
      !isPrivateIp(egressAddress.ipValue) &&
      !inSubnet(dstValue, egressAddress.ipValue, egressAddress.prefix)
    ) {
      if (current.services.nat) {
        const converted = `${ipToString(effectiveSrcValue)} → ${egressAddress.ip}`;
        steps.push(
          mkStep('NAT_SNAT', 'info', `${current.name} 执行源地址转换（SNAT）：${converted}。`, {
            deviceId: current.id,
            portId: outPort.id,
            data: { nat: converted },
          }),
        );
        effectiveSrcValue = egressAddress.ipValue;
      } else {
        return finishFail(
          {
            code: 'NAT_MISSING',
            detail:
              `${current.name} 需要把私网地址 ${ipToString(effectiveSrcValue)} 转发到公网侧 ${egressAddress.ip}，` +
              '但该设备没有启用 NAT。私网地址在公网上无法回程，因此通信不会成功。' +
              '请在设备面板中开启 NAT，或改用桥接模式由下游路由器承担。',
            deviceId: current.id,
            portId: outPort.id,
          },
          `${current.name} 缺少 NAT，私网地址无法访问公网。`,
        );
      }
    }

    // g. 记录这一跳
    const inPortName = inPortId ? portOf(world, current.id, inPortId)?.name : undefined;
    hops.push({
      index: hopIndex,
      deviceId: current.id,
      deviceName: current.name,
      inPort: inPortName,
      outPort: outPort.name,
      inPortId,
      outPortId: outPort.id,
      linkSpeedMbps: link.speedMbps,
      linkFamily: link.family,
      linkLengthM: link.cable.lengthM,
      linkIssues: link.issues.filter((i) => i.level === 'warn').map((i) => i.text),
      nextHopIp,
      transitLinkIds: transit,
    });
    hopIndex += 1;
    steps.push(
      mkStep('HOP', 'info', `第 ${hopIndex} 跳：${current.name} ${outPort.name} → ${targetDevice?.name ?? target.deviceId} ${targetPort?.name ?? ''}（${formatSpeed(link.speedMbps)}${link.family === 'wireless' ? '，无线' : ''}）。`, {
        deviceId: current.id,
        portId: outPort.id,
      }),
    );

    current = targetDevice ?? current;
    inPortId = target.portId;
    if (!targetDevice) {
      return finishFail(
        { code: 'ARP_FAILED', detail: '下一跳设备已不存在。', deviceId: current.id },
        '下一跳设备缺失。',
      );
    }
  }

  return finishFail(
    {
      code: 'ROUTING_LOOP',
      detail: `经过 ${maxTtl} 跳仍未到达目标，疑似路由环路。请检查各设备的路由配置是否互相指回。`,
    },
    '检测到路由环路（超出最大跳数）。',
  );
}
