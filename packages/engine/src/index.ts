/**
 * @toposmith/engine — 推演内核
 *
 * 纯 TypeScript，零 DOM / 零 React 依赖，可在 Node 下直接测试。
 * 依赖方向：web → engine → catalog → schema（docs/04-architecture.md §1）。
 */

/* World 与派生模型 */
export {
  LAN_BRIDGE_VLAN,
  bridgesLanPorts,
  buildWorld,
  describeAddress,
  isL2Forwarder,
  isLanSidePort,
  negotiateLink,
  subnetText,
} from './model';
export type {
  Address,
  DerivedLink,
  LinkEnd,
  LinkIssue,
  World,
} from './model';

/* 图查询助手 */
export {
  addressesOf,
  findAddressByIp,
  firstConnectedPortId,
  firstLinkOfPort,
  linksOfPort,
  otherEnd,
  portKey,
  portOf,
  primaryAddress,
} from './graph';

/* IPv4 工具 */
export * from './ip';

/* 二层 / 三层 */
export {
  broadcastDomain,
  domainDeviceNames,
  findAddressInDomain,
  linkedPortCount,
} from './l2/domain';
export type { DomainEntry } from './l2/domain';
export { describeRouteTable, lookupRoute, routingTable } from './l3/routing';
export type { RouteEntry, RouteKind } from './l3/routing';

/* 地址分配与 DNS */
export { dhcpLease } from './dhcp';
export type { LeaseAddress, LeaseAttempt } from './dhcp';
export { DNS_DEFAULT_TTL, chainToHops, resolveName } from './dns';
export type {
  DnsCacheEntry,
  DnsChainHop,
  DnsResolution,
  DnsResolveOptions,
  DnsSessionCache,
} from './dns';

/* 四类诊断 */
export { bandwidth, dnsPath, pathTrace, ping, trace } from './diag';
export type { TraceResult } from './diag';
export { mkStep, REASON_TITLE } from './diag';
export type { ReasonCode } from './diag';
export type { BandwidthMetrics, DiagResult, DiagStep, Hop, StepLevel } from './diag';
