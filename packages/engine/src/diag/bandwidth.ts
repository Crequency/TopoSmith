/**
 * 通讯速度推演
 *
 * 两个数字必须**分开呈现**：`协商速率`（链路能力）与`有效吞吐`（实际能用）。
 * 把无线路径的协商 1201 Mbps 直接当成"能用 1.2G"是最常见的误导，
 * 本模块的职责就是主动纠正它（docs/05-engine.md §5）。
 */

import { formatMbpsAsBytesPerSecond, formatSpeed } from '@toposmith/catalog';
import type { World } from '../model';
import { linksOfPort } from '../graph';
import { mkStep } from './reasons';
import { trace } from './trace';
import type { BandwidthMetrics, DiagResult } from './types';

/** 每跳处理时延（ms） */
const PROCESSING_MS = 0.05;
/** 无线空中接入附加时延（ms） */
const WIFI_AIR_MS = 0.3;
/** 传播时延：铜/光同量级近似，约 5 ns/m */
const PROPAGATION_MS_PER_M = 5e-6;
const WIRED_EFFICIENCY = 0.95;
const WIFI_EFFICIENCY = 0.5;
const GIB_BITS = 1024 * 1024 * 1024 * 8;

/** 无线跳的对端设备（AP） */
function wifiPeer(world: World, deviceId: string, portId: string): string | undefined {
  for (const link of linksOfPort(world, deviceId, portId)) {
    if (link.family !== 'wireless') continue;
    const onA = link.a.deviceId === deviceId && link.a.portId === portId;
    return onA ? link.b.deviceId : link.a.deviceId;
  }
  return undefined;
}

/** 某 AP 的 radio 上已关联的客户端数（共享介质的分母） */
function associationsOn(world: World, apDeviceId: string): number {
  const ap = world.devices.get(apDeviceId);
  if (!ap) return 1;
  const radio = ap.ports.find((p) => p.medium === 'wifi');
  if (!radio) return 1;
  const links = linksOfPort(world, ap.id, radio.id);
  // 每条关联的另一端只要不是本机（例如 AP 自环），就算一个客户端
  const clients = new Set<string>();
  for (const link of links) {
    const onA = link.a.deviceId === ap.id && link.a.portId === radio.id;
    const peer = onA ? link.b.deviceId : link.a.deviceId;
    if (peer !== ap.id) clients.add(peer);
  }
  return Math.max(1, clients.size);
}

export function computeBandwidth(
  world: World,
  srcDeviceId: string,
  dstIp: string,
): DiagResult {
  const tr = trace(world, srcDeviceId, dstIp);
  if (!tr.ok) {
    return {
      kind: 'bandwidth',
      ok: false,
      summary: `无法计算通讯速度：路径不可达 —— ${tr.summary}`,
      steps: [
        mkStep('BANDWIDTH_RESULT', 'error', `先解决可达性问题再测算速度。${tr.summary}`, {}),
        ...tr.steps,
      ],
      hops: tr.hops,
    };
  }

  const pathHops: BandwidthMetrics['hops'] = [];
  let oneWayMs = 0;
  let bottleneck = Number.POSITIVE_INFINITY;
  let bottleneckLabel = '';
  let hasWireless = false;
  /**
   * 无线段提供方是蜂窝基站还是 WiFi AP —— 只影响文案。
   * 共享介质的**算法**对两者完全相同（空口都是所有人分一份），
   * 但"同一 AP 下的客户端数"套在蜂窝上会让用户误以为模型没考虑蜂窝。
   */
  let wirelessCellular = false;
  let wirelessConcurrency = 1;
  let wirelessCap = Number.POSITIVE_INFINITY;
  let wirelessCapLabel = '';

  for (const hop of tr.hops) {
    if (hop.note === '目的地') continue;

    // 优先使用"二层实际经过的链路"序列：hop 本身只记录三层转发点，
    // 直接用它会把中间交换机两侧的链路（往往是真正的瓶颈）漏掉（D-23）。
    const transitIds = hop.transitLinkIds ?? [];
    const segments: { speedMbps: number; family: 'copper' | 'fiber' | 'wireless'; lengthM: number; label: string }[] = [];

    if (transitIds.length > 0) {
      for (const linkId of transitIds) {
        const link = world.linksById.get(linkId);
        if (!link) continue;
        const peer = link.a.deviceId === hop.deviceId ? link.b : link.a;
        segments.push({
          speedMbps: link.speedMbps,
          family: link.family,
          lengthM: link.cable.lengthM,
          label: `${world.devices.get(hop.deviceId)?.name ?? hop.deviceId} → ${world.devices.get(peer.deviceId)?.name ?? peer.deviceId}`,
        });
      }
    } else if (hop.outPortId) {
      segments.push({
        speedMbps: hop.linkSpeedMbps ?? 0,
        family: hop.linkFamily ?? 'copper',
        lengthM: hop.linkLengthM ?? 0,
        label: `${hop.deviceName} ${hop.outPort ?? ''}`.trim(),
      });
    }

    for (const segment of segments) {
      const speed = segment.speedMbps;
      const family = segment.family;
      const lengthM = segment.lengthM;
      let latency = lengthM * PROPAGATION_MS_PER_M + PROCESSING_MS;
      if (family === 'wireless') latency += WIFI_AIR_MS;
      oneWayMs += latency;

      pathHops.push({
        index: hop.index,
        from: segment.label,
        to: hop.nextHopIp ?? '下一跳',
        speedMbps: speed,
        family,
        lengthM,
        latencyMs: latency,
      });

      if (speed > 0 && speed < bottleneck) {
        bottleneck = speed;
        bottleneckLabel = `${segment.label}（${formatSpeed(speed)}）`;
      }

      if (family === 'wireless') {
        hasWireless = true;
        const peerDeviceId = hop.outPortId ? wifiPeer(world, hop.deviceId, hop.outPortId) : undefined;
        if (peerDeviceId && world.devices.get(peerDeviceId)?.kind === 'base-station') {
          wirelessCellular = true;
        }
        const concurrency = peerDeviceId ? associationsOn(world, peerDeviceId) : 1;
        wirelessConcurrency = Math.max(wirelessConcurrency, concurrency);
        // 无线段的有效能力 = 协商速率 × 半双工/共享效率 ÷ 并发客户端数
        const cap = (speed * WIFI_EFFICIENCY) / concurrency;
        if (cap < wirelessCap) {
          wirelessCap = cap;
          const apName = peerDeviceId ? world.devices.get(peerDeviceId)?.name ?? peerDeviceId : 'AP';
          wirelessCapLabel = `${apName} 的无线段（协商 ${formatSpeed(speed)}，${concurrency} 台并发）`;
        }
      }
    }
  }

  if (!Number.isFinite(bottleneck) || bottleneck <= 0) {
    return {
      kind: 'bandwidth',
      ok: false,
      summary: '路径上没有可用于计算的链路速率（可能是纯无线或速率未协商）。',
      steps: [
        mkStep('BANDWIDTH_RESULT', 'error', '路径中的链路速率均为 0，无法测算速度。请检查端口速率与无线标准配置。', {}),
      ],
      hops: tr.hops,
    };
  }

  const wiredCap = bottleneck * WIRED_EFFICIENCY;
  const effective = Math.min(wiredCap, wirelessCap);
  const rttMs = oneWayMs * 2;
  const transfer1GiBSeconds = GIB_BITS / (effective * 1_000_000);

  const metrics: BandwidthMetrics = {
    bottleneckMbps: bottleneck,
    bottleneckLabel,
    oneWayMs,
    rttMs,
    efficiency: effective === wiredCap ? WIRED_EFFICIENCY : WIFI_EFFICIENCY,
    effectiveMbps: effective,
    transfer1GiBSeconds,
    hasWireless,
    wirelessConcurrency,
    hops: pathHops,
  };

  const steps = [
    ...tr.steps.filter((s) => s.code !== 'HOP'),
    mkStep(
      'BANDWIDTH_BOTTLENECK',
      'info',
      `瓶颈链路：${bottleneckLabel}。路径上最小链路速率决定端到端上限，而不是两端端口的标称速率。`,
      { data: { bottleneckMbps: bottleneck } },
    ),
  ];

  if (hasWireless) {
    /*
     * 共享介质这条结论对 WiFi 与蜂窝同样成立，但说法要分开：
     * 蜂窝的"单用户峰值 1 Gbps"最容易被当成"我用 5G 就有 1G"，
     * 而真相是同一小区里所有终端分同一份空口资源。
     */
    const text = wirelessCellular
      ? `路径包含蜂窝段，空口是彻底的共享介质：${wirelessCapLabel ?? '蜂窝段'}` +
        `。有效吞吐按「协商速率 × ${WIFI_EFFICIENCY} ÷ 同一小区内的终端数」估算 —— ` +
        `蜂窝速率是**单用户峰值**，同一小区（同一基站）下的终端越多，每台能分到的越少。`
      : `路径包含无线段，且无线是共享半双工介质：${wirelessCapLabel ?? '无线段'}` +
        `。有效吞吐按「协商速率 × ${WIFI_EFFICIENCY} ÷ 并发客户端数」估算，` +
        `同一 AP 下同时使用的客户端越多，每台能分到的越少。`;
    steps.push(
      mkStep('WIFI_SHARED_MEDIUM', 'warn', text, {
        data: { wirelessConcurrency, wirelessCapMbps: wirelessCap },
      }),
    );
  }

  steps.push(
    mkStep(
      'BANDWIDTH_RESULT',
      'ok',
      `单向时延约 ${oneWayMs.toFixed(3)} ms，往返（RTT）约 ${rttMs.toFixed(3)} ms；` +
        `单流有效吞吐约 ${formatSpeed(effective)}（${formatMbpsAsBytesPerSecond(effective)}）；` +
        `传输 1 GiB 约需 ${transfer1GiBSeconds.toFixed(1)} 秒。`,
      { data: { metrics } },
    ),
    mkStep(
      'KNOWN_SIMPLIFICATION',
      'info',
      '已知简化：时延为铜/光传播（约 5 ns/m）+ 每跳处理时延的线性叠加，未建模拥塞、队列、TCP 慢启动与重传；' +
        '有效吞吐为单流估算值，非实测吞吐。',
      {},
    ),
  );

  return {
    kind: 'bandwidth',
    ok: true,
    summary:
      `可达，瓶颈 ${formatSpeed(bottleneck)}，单向时延约 ${oneWayMs.toFixed(3)} ms，` +
      `单流有效吞吐约 ${formatSpeed(effective)}。` +
      // 环路会让"瓶颈 / 吞吐"这两个数字失去意义：真机上环内链路已被广播帧占满
      (tr.steps.some((s) => s.code === 'L2_LOOP')
        ? '（注意：路径所在广播域存在二层环路，这两个数字是按「没有风暴」算出来的估计值，真机上不成立）'
        : ''),
    steps,
    hops: tr.hops,
    metrics,
  };
}
