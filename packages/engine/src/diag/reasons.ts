/**
 * 原因码（ReasonCode）与步骤构造
 *
 * 原因码是**唯一稳定的机器可读标识**：文案会改、会翻译，原因码不会。
 * 单元测试断言 `steps[].code` 序列，UI 断言渲染结果，两者解耦（docs/07-diagnostics.md §1）。
 */

import type { DiagStep, StepLevel } from './types';

export type ReasonCode =
  /* ── 成功 / 信息 ── */
  | 'OK'
  | 'SRC_ADDRESS'
  | 'DHCP_LEASE'
  | 'ROUTE_MATCH'
  | 'DIRECT_DELIVERY'
  | 'ARP_OK'
  | 'HOP'
  | 'REACHED'
  | 'NAT_SNAT'
  | 'DNS_QUERY'
  | 'DNS_CACHE_HIT'
  | 'DNS_ANSWER'
  | 'BANDWIDTH_BOTTLENECK'
  | 'BANDWIDTH_RESULT'
  /* ── 提示（不阻断） ── */
  | 'LINK_SPEED_LIMITED'
  | 'LINK_SPEED_NEGOTIATED'
  /**
   * 无线共享介质（WiFi 与蜂窝共用同一个原因码）。
   * 判据是"路径上有没有 wireless 段"，与具体制式无关：空口都是所有人分一份。
   */
  | 'WIFI_SHARED_MEDIUM'
  | 'CELLULAR_RADIO_DOWNGRADE'
  | 'L2_LOOP'
  | 'BROADCAST_STORM'
  | 'KNOWN_SIMPLIFICATION'
  /* ── 失败 ── */
  | 'DST_INVALID'
  | 'SRC_MISSING'
  | 'NO_SOURCE_ADDRESS'
  | 'NO_DHCP_SERVER'
  | 'POOL_EXHAUSTED'
  | 'NO_ROUTE'
  | 'NO_GATEWAY'
  | 'PORT_NOT_CONNECTED'
  | 'LINK_DOWN'
  | 'LINK_TOO_LONG'
  | 'MEDIUM_MISMATCH'
  | 'SSID_MISMATCH'
  | 'RADIO_TECH_MISMATCH'
  | 'CELLULAR_PLMN_MISMATCH'
  | 'WIRELESS_OUT_OF_COVERAGE'
  | 'VLAN_MISMATCH'
  | 'ARP_FAILED'
  | 'NAT_MISSING'
  | 'ROUTING_LOOP'
  | 'DNS_UNREACHABLE'
  | 'NO_DNS_CONFIGURED'
  | 'NO_DNS_SERVICE'
  | 'DNS_NXDOMAIN'
  | 'DNS_FORWARD_LOOP';

/** 失败类原因码的短标题（UI 时间线用；detail 由产出方按上下文填写） */
export const REASON_TITLE: Partial<Record<ReasonCode, string>> = {
  OK: '推演成功',
  LINK_SPEED_LIMITED: '链路降速（线缆能力限制）',
  LINK_SPEED_NEGOTIATED: '链路按较低速率协商',
  WIFI_SHARED_MEDIUM: '无线为共享半双工介质',
  CELLULAR_RADIO_DOWNGRADE: '蜂窝世代不同（按低一代回落）',
  L2_LOOP: '检测到二层环路',
  BROADCAST_STORM: '广播风暴风险',
  KNOWN_SIMPLIFICATION: '已知简化',
  DST_INVALID: '目标地址无法解析',
  SRC_MISSING: '源设备不存在',
  NO_SOURCE_ADDRESS: '源设备没有可用地址',
  NO_DHCP_SERVER: '广播域内没有 DHCP 服务器',
  POOL_EXHAUSTED: 'DHCP 地址池已耗尽',
  NO_ROUTE: '没有匹配的路由',
  NO_GATEWAY: '缺少默认网关',
  PORT_NOT_CONNECTED: '出接口没有连接线缆',
  LINK_DOWN: '链路不可用',
  LINK_TOO_LONG: '线缆超过长度上限',
  MEDIUM_MISMATCH: '端口介质不匹配',
  SSID_MISMATCH: '无线 SSID 不一致',
  RADIO_TECH_MISMATCH: '无线制式不匹配（WiFi ≠ 蜂窝）',
  CELLULAR_PLMN_MISMATCH: '蜂窝网络标识（PLMN）不一致',
  WIRELESS_OUT_OF_COVERAGE: '设备不在无线覆盖范围内',
  VLAN_MISMATCH: '两端不在同一广播域',
  ARP_FAILED: 'ARP 解析失败',
  NAT_MISSING: '缺少 NAT，公网无法回程',
  ROUTING_LOOP: '检测到路由环路',
  DNS_UNREACHABLE: 'DNS 服务器不可达',
  NO_DNS_CONFIGURED: '客户端没有配置 DNS 服务器',
  NO_DNS_SERVICE: '目标设备未启用 DNS 服务',
  DNS_NXDOMAIN: '域名不存在',
  DNS_FORWARD_LOOP: 'DNS 转发成环',
};

/** 构造一个证据链步骤；`data` 放结构化信息，供 UI 展开显示 */
export function mkStep(
  code: ReasonCode,
  level: StepLevel,
  detail: string,
  extra: { title?: string; deviceId?: string; portId?: string; data?: Record<string, unknown> } = {},
): DiagStep {
  return {
    code,
    level,
    title: extra.title ?? REASON_TITLE[code] ?? code,
    detail,
    deviceId: extra.deviceId,
    portId: extra.portId,
    data: extra.data,
  };
}
