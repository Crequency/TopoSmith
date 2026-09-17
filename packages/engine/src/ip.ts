/**
 * IPv4 工具
 *
 * 内部一律用 32 位无符号整数表示地址（`>>> 0`），避免字符串比较带来的歧义与性能问题。
 * 注意 `prefixToMask` 必须特判 0 与 32 —— JS 的位移量按 32 取模，
 * `-1 << 32` 会静默变成 `-1 << 0`，这是本文件最容易踩的坑。
 */

export type Ipv4 = number; // 32 位无符号

export function parseIp(text: string): Ipv4 | null {
  const parts = text.trim().split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = ((value << 8) | n) >>> 0;
  }
  return value;
}

export function ipToString(value: Ipv4): string {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join('.');
}

export function prefixToMask(prefix: number): Ipv4 {
  if (prefix <= 0) return 0;
  if (prefix >= 32) return 0xffffffff;
  return (0xffffffff << (32 - prefix)) >>> 0;
}

export function networkAddress(ip: Ipv4, prefix: number): Ipv4 {
  return (ip & prefixToMask(prefix)) >>> 0;
}

export function broadcastAddress(ip: Ipv4, prefix: number): Ipv4 {
  const mask = prefixToMask(prefix);
  return ((ip & mask) | (~mask >>> 0)) >>> 0;
}

/** 该地址是否落在 network/prefix 内（network 会被自动规范化） */
export function inSubnet(ip: Ipv4, network: Ipv4, prefix: number): boolean {
  return networkAddress(ip, prefix) === networkAddress(network, prefix);
}

/** 两个地址是否属于同一网段 */
export function sameSubnet(a: Ipv4, b: Ipv4, prefix: number): boolean {
  return networkAddress(a, prefix) === networkAddress(b, prefix);
}

export function isPrivateIp(ip: Ipv4): boolean {
  const a = (ip >>> 24) & 0xff;
  const b = (ip >>> 16) & 0xff;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // APIPA（链路本地，视为不可路由）
  if (a === 127) return true;
  return false;
}

/** 是否为 APIPA 自动私有地址（169.254.0.0/16）—— DHCP 失败的特征 */
export function isApipa(ip: Ipv4): boolean {
  return ((ip >>> 24) & 0xff) === 169 && ((ip >>> 16) & 0xff) === 254;
}

export function ipInRange(ip: Ipv4, start: Ipv4, end: Ipv4): boolean {
  return ip >= start && ip <= end;
}

export function addToIp(ip: Ipv4, delta: number): Ipv4 {
  return (ip + delta) >>> 0;
}
