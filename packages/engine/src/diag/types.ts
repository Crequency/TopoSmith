/** 诊断输出契约（docs/07-diagnostics.md §1） */

import type { ReasonCode } from './reasons';

export type StepLevel = 'ok' | 'info' | 'warn' | 'error';

export interface DiagStep {
  code: ReasonCode;
  level: StepLevel;
  title: string;
  detail: string;
  deviceId?: string;
  portId?: string;
  data?: Record<string, unknown>;
}

export interface Hop {
  index: number;
  deviceId: string;
  deviceName: string;
  inPort?: string;
  outPort?: string;
  inPortId?: string;
  outPortId?: string;
  linkSpeedMbps?: number;
  linkFamily?: 'copper' | 'fiber' | 'wireless';
  linkLengthM?: number;
  linkIssues?: string[];
  nextHopIp?: string;
  /**
   * 本跳在**二层实际经过的链路 id（按顺序）**，包含中间穿过的交换机。
   *
   * 为什么需要它：hop 记录的是三层转发决策，而交换机不做三层决策，
   * 于是"笔记本 → 光猫"这一跳中间其实还穿过了 AP 与交换机两条以上的链路。
   * 少了这些链路，带宽瓶颈会被高估（无线段 1201 Mbps 会盖住真实瓶颈 1 Gbps 的网线），
   * 动画也会画成一条"飞过交换机"的直线。见 DECISIONS D-23。
   */
  transitLinkIds?: string[];
  /** NAT 转换点描述，如 `192.168.1.101 → 100.64.0.10` */
  nat?: string;
  note?: string;
}

export interface BandwidthMetrics {
  bottleneckMbps: number;
  bottleneckLabel: string;
  oneWayMs: number;
  rttMs: number;
  efficiency: number;
  effectiveMbps: number;
  transfer1GiBSeconds: number;
  hasWireless: boolean;
  wirelessConcurrency: number;
  hops: {
    index: number;
    from: string;
    to: string;
    speedMbps: number;
    family: 'copper' | 'fiber' | 'wireless';
    lengthM: number;
    latencyMs: number;
  }[];
}

export interface DiagResult {
  kind: 'ping' | 'trace' | 'bandwidth' | 'dns';
  ok: boolean;
  summary: string;
  steps: DiagStep[];
  hops: Hop[];
  metrics?: BandwidthMetrics;
  answer?: { ip?: string; name?: string };
}
