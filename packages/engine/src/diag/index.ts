/**
 * 诊断统一入口
 *
 * 四类诊断返回同一个结构（docs/07-diagnostics.md §1）：
 * **任何诊断都不允许只返回布尔值** —— 用户要的是"为什么"。
 */

import type { World } from '../model';
import { chainToHops, resolveName, type DnsResolveOptions } from '../dns';
import { computeBandwidth } from './bandwidth';
import { trace } from './trace';
import type { DiagResult } from './types';

/**
 * 可达性（ping 语义）
 *
 * 与 `pathTrace` 共用同一套推演算法，差别在输出裁剪：
 * ping 是**结论导向**，去掉逐跳过程步骤，让首错直接可见。
 */
export function ping(world: World, srcDeviceId: string, dstIp: string): DiagResult {
  const tr = trace(world, srcDeviceId, dstIp);
  return {
    kind: 'ping',
    ok: tr.ok,
    summary: tr.summary,
    steps: tr.steps.filter((s) => s.code !== 'HOP'),
    hops: tr.hops,
  };
}

/** 数据包链路（traceroute 语义）：保留完整推演过程 */
export function pathTrace(world: World, srcDeviceId: string, dstIp: string): DiagResult {
  const tr = trace(world, srcDeviceId, dstIp);
  return {
    kind: 'trace',
    ok: tr.ok,
    summary: tr.summary,
    steps: tr.steps,
    hops: tr.hops,
  };
}

/** 通讯速度：瓶颈带宽、时延与有效吞吐 */
export function bandwidth(world: World, srcDeviceId: string, dstIp: string): DiagResult {
  return computeBandwidth(world, srcDeviceId, dstIp);
}

/** DNS 解析路径 */
export function dnsPath(
  world: World,
  srcDeviceId: string,
  name: string,
  options: DnsResolveOptions = {},
): DiagResult {
  const resolution = resolveName(world, srcDeviceId, name, options);
  return {
    kind: 'dns',
    ok: resolution.ok,
    summary: resolution.ok
      ? `${resolution.name} → ${resolution.ip}${resolution.cacheHit ? '（缓存命中）' : `（经由 ${resolution.chain.length} 级 DNS）`}`
      : `解析 ${resolution.name} 失败：${resolution.failure ?? '未知原因'}`,
    steps: resolution.steps,
    hops: chainToHops(resolution.chain),
    answer: { name: resolution.name, ip: resolution.ip },
  };
}

export { trace } from './trace';
export type { TraceResult } from './trace';
export { computeBandwidth } from './bandwidth';
export { mkStep, REASON_TITLE } from './reasons';
export type { ReasonCode } from './reasons';
export type { BandwidthMetrics, DiagResult, DiagStep, Hop, StepLevel } from './types';
