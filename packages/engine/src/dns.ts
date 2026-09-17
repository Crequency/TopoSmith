/**
 * DNS 解析路径推演
 *
 * DNS 解析不是字符串查表：**查询本身要走网络**。因此本模块调用 `trace`
 * 验证到每个 DNS 服务器的可达性，并把结果作为证据链子链 ——
 * 于是能给出这类结论：
 *
 *   域名解析失败 → DNS 服务器 192.168.1.1 不可达 → 客户端没有默认网关
 *   → 因为它在 VLAN 20 而网关在 VLAN 1
 *
 * 缓存**不进 World**（它不是拓扑事实），由调用方持有并作为参数传入，
 * 以保证引擎仍是纯函数（D-07、D-13）。
 */

import type { World } from './model';
import { findAddressByIp, primaryAddress } from './graph';
import { parseIp } from './ip';
import { mkStep, type ReasonCode } from './diag/reasons';
import type { DiagStep, Hop } from './diag/types';
import { trace } from './diag/trace';

export const DNS_DEFAULT_TTL = 300;

export interface DnsCacheEntry {
  ip: string;
  expiresAt: number;
}
/** `${serverIp}|${name}` → 记录 */
export type DnsSessionCache = Map<string, DnsCacheEntry>;

export interface DnsChainHop {
  serverIp: string;
  serverName: string;
  role: 'local' | 'forwarder' | 'authoritative';
  ok: boolean;
  result: string;
}

export interface DnsResolution {
  ok: boolean;
  name: string;
  ip?: string;
  chain: DnsChainHop[];
  steps: DiagStep[];
  failure?: ReasonCode;
  cacheHit: boolean;
}

export interface DnsResolveOptions {
  cache?: DnsSessionCache;
  /** 由调用方传入"当前时间"（引擎内不允许读时钟），用于 TTL 判定 */
  nowMs?: number;
  ttlSeconds?: number;
}

const MAX_DEPTH = 8;

export function resolveName(
  world: World,
  srcDeviceId: string,
  name: string,
  options: DnsResolveOptions = {},
): DnsResolution {
  const nowMs = options.nowMs ?? 0;
  const ttl = options.ttlSeconds ?? DNS_DEFAULT_TTL;
  const cache = options.cache;
  const steps: DiagStep[] = [];
  const chain: DnsChainHop[] = [];

  const fail = (code: ReasonCode, detail: string, hint?: Partial<DnsResolution>): DnsResolution => {
    steps.push(mkStep(code, 'error', detail, {}));
    return { ok: false, name, chain, steps, failure: code, cacheHit: false, ...hint };
  };

  const src = world.devices.get(srcDeviceId);
  if (!src) return fail('SRC_MISSING', `找不到源设备 ${srcDeviceId}。`);

  const srcAddress = primaryAddress(world, src.id);
  if (!srcAddress) {
    const lease = world.leases.get(src.id);
    if (lease?.failure) {
      steps.push(mkStep(lease.failure, 'error', lease.detail, { deviceId: src.id }));
      return { ok: false, name, chain, steps, failure: lease.failure, cacheHit: false };
    }
    return fail('NO_SOURCE_ADDRESS', `${src.name} 没有可用地址，无法发起 DNS 查询。`);
  }

  const servers = srcAddress.dns ?? [];
  if (servers.length === 0) {
    return fail(
      'NO_DNS_CONFIGURED',
      `${src.name} 没有配置 DNS 服务器。若使用 DHCP，请确认 DHCP 服务器下发了 DNS；` +
        '若是静态地址，请在该设备面板中填写 DNS。',
    );
  }

  steps.push(
    mkStep(
      'DNS_QUERY',
      'info',
      `${src.name}（${srcAddress.ip}）要解析域名 ${name}，首选 DNS 服务器：${servers.join('、')}。`,
      { deviceId: src.id, data: { servers } },
    ),
  );

  let currentIpText = servers[0];
  const cacheKey = `${currentIpText}|${name}`;

  const cached = cache?.get(cacheKey);
  if (cached && cached.expiresAt > nowMs) {
    const remaining = Math.max(0, Math.round((cached.expiresAt - nowMs) / 1000));
    const owner = findAddressByIp(world, parseIp(currentIpText) ?? 0);
    const serverName = owner ? world.devices.get(owner.deviceId)?.name ?? currentIpText : currentIpText;
    steps.push(
      mkStep(
        'DNS_CACHE_HIT',
        'ok',
        `${serverName} 的缓存命中：${name} → ${cached.ip}（剩余 TTL 约 ${remaining} 秒），本次查询未走完整解析链路。`,
        { data: { remaining } },
      ),
    );
    chain.push({
      serverIp: currentIpText,
      serverName,
      role: 'local',
      ok: true,
      result: `缓存命中 → ${cached.ip}`,
    });
    return { ok: true, name, ip: cached.ip, chain, steps, cacheHit: true };
  }

  steps.push(
    mkStep(
      'DNS_QUERY',
      'info',
      `缓存未命中，开始逐级解析（最多 ${MAX_DEPTH} 级）。`,
      {},
    ),
  );

  let previousDeviceId = src.id;
  let depth = 0;
  const visited = new Set<string>();

  while (depth < MAX_DEPTH) {
    const visitedKey = `${currentIpText}|${name}`;
    if (visited.has(visitedKey)) {
      return fail(
        'DNS_FORWARD_LOOP',
        `检测到 DNS 转发成环：${[...visited, visitedKey].join(' → ')}。请检查各 DNS 服务器的转发器配置。`,
      );
    }
    visited.add(visitedKey);

    const ipValue = parseIp(currentIpText);
    if (ipValue === null) {
      return fail('DNS_UNREACHABLE', `DNS 服务器地址「${currentIpText}」不是合法的 IPv4 地址。`);
    }

    const owner = findAddressByIp(world, ipValue);
    if (!owner) {
      return fail(
        'DNS_UNREACHABLE',
        `没有任何设备的地址是 ${currentIpText}，无法向它发起 DNS 查询。请检查客户端配置的 DNS 地址是否正确。`,
      );
    }
    const serverDevice = world.devices.get(owner.deviceId);
    if (!serverDevice) {
      return fail('DNS_UNREACHABLE', `DNS 服务器设备 ${owner.deviceId} 不存在。`);
    }

    // 查询本身要走网络：先验证可达性，失败时把子链一并带回
    const reach = trace(world, previousDeviceId, currentIpText);
    if (!reach.ok) {
      steps.push(
        mkStep(
          'DNS_UNREACHABLE',
          'error',
          `从 ${world.devices.get(previousDeviceId)?.name ?? previousDeviceId} 到 DNS 服务器 ` +
            `${serverDevice.name}（${currentIpText}）不可达：${reach.summary}`,
          { deviceId: serverDevice.id },
        ),
        ...reach.steps,
      );
      chain.push({
        serverIp: currentIpText,
        serverName: serverDevice.name,
        role: depth === 0 ? 'local' : 'forwarder',
        ok: false,
        result: `不可达：${reach.summary}`,
      });
      return {
        ok: false,
        name,
        chain,
        steps,
        failure: 'DNS_UNREACHABLE',
        cacheHit: false,
      };
    }

    const role: DnsChainHop['role'] =
      depth === 0 ? 'local' : 'forwarder';

    if (!serverDevice.services.dns?.enabled) {
      steps.push(
        mkStep(
          'NO_DNS_SERVICE',
          'error',
          `${serverDevice.name}（${currentIpText}）没有启用 DNS 服务，但它被配置为 DNS 服务器。` +
            '请在该设备面板中启用 DNS，或把客户端指向正确的服务器。',
          { deviceId: serverDevice.id },
        ),
      );
      chain.push({
        serverIp: currentIpText,
        serverName: serverDevice.name,
        role,
        ok: false,
        result: '未启用 DNS 服务',
      });
      return { ok: false, name, chain, steps, failure: 'NO_DNS_SERVICE', cacheHit: false };
    }

    steps.push(
      mkStep(
        'DNS_QUERY',
        'info',
        `${serverDevice.name}（${currentIpText}）收到查询 ${name}；到它的连通性已验证（${reach.hops.length} 跳）。`,
        { deviceId: serverDevice.id },
      ),
    );

    const record = serverDevice.services.dns.records.find((r) => r.name === name);
    if (record) {
      const authoritative = (serverDevice.services.dns.forwarders ?? []).length === 0;
      steps.push(
        mkStep(
          'DNS_ANSWER',
          'ok',
          `${serverDevice.name} ${authoritative ? '作为权威服务器直接应答' : '的本地静态记录命中'}：` +
            `${name} → ${record.ip}。`,
          { deviceId: serverDevice.id, data: { answer: record.ip, authoritative } },
        ),
      );
      chain.push({
        serverIp: currentIpText,
        serverName: serverDevice.name,
        role: authoritative ? 'authoritative' : 'local',
        ok: true,
        result: `静态记录 → ${record.ip}`,
      });
      cache?.set(cacheKey, { ip: record.ip, expiresAt: nowMs + ttl * 1000 });
      return {
        ok: true,
        name,
        ip: record.ip,
        chain,
        steps: [
          ...steps,
          mkStep(
            'KNOWN_SIMPLIFICATION',
            'info',
            `结果已写入 ${servers[0]} 的缓存（TTL ${ttl} 秒）；本次会话内再次查询同名域名将直接命中缓存。`,
            {},
          ),
        ],
        cacheHit: false,
      };
    }

    const forwarders = serverDevice.services.dns.forwarders ?? [];
    if (forwarders.length === 0) {
      steps.push(
        mkStep(
          'DNS_NXDOMAIN',
          'error',
          `${serverDevice.name} 既没有 ${name} 的静态记录，也没有配置转发器，因此只能回答 NXDOMAIN（域名不存在）。` +
            '如需解析公网域名，请为它配置上游 DNS。',
          { deviceId: serverDevice.id },
        ),
      );
      chain.push({
        serverIp: currentIpText,
        serverName: serverDevice.name,
        role,
        ok: false,
        result: '无记录且无转发器 → NXDOMAIN',
      });
      return { ok: false, name, chain, steps, failure: 'DNS_NXDOMAIN', cacheHit: false };
    }

    const nextIp = forwarders[0];
    chain.push({
      serverIp: currentIpText,
      serverName: serverDevice.name,
      role,
      ok: false,
      result: `本地无记录，转发至 ${nextIp}`,
    });
    steps.push(
      mkStep(
        'DNS_QUERY',
        'info',
        `${serverDevice.name} 本地没有 ${name} 的记录，按转发器顺序转发到 ${nextIp}。`,
        { deviceId: serverDevice.id, data: { forwarders } },
      ),
    );

    previousDeviceId = serverDevice.id;
    currentIpText = nextIp;
    depth += 1;
  }

  return fail(
    'DNS_FORWARD_LOOP',
    `解析链超过 ${MAX_DEPTH} 级仍未得到答案，疑似转发成环。已走过的路径：${[...visited].join(' → ')}。`,
  );
}

/** 把解析链映射为 Hop 列表，供统一的路径视图渲染 */
export function chainToHops(chain: DnsChainHop[]): Hop[] {
  return chain.map((entry, index) => ({
    index,
    deviceId: entry.serverIp,
    deviceName: entry.serverName,
    note: `${entry.role === 'authoritative' ? '权威' : entry.role === 'forwarder' ? '转发' : '本地'}：${entry.result}`,
  }));
}
