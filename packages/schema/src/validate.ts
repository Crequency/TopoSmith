/**
 * 场景导入校验
 *
 * M0 用**手写校验**：错误信息需要是人类可读的中文，而 zod 的默认报错对用户不友好，
 * 且这里只有一处输入边界。M1 起改用 zod 重写，但**保持相同的错误文本契约**
 * （见 docs/02-domain-model.md §4）。
 */

import type { Scenario } from './index';
import { SCHEMA_VERSION } from './version';

export interface ValidationOk {
  ok: true;
  scenario: Scenario;
}
export interface ValidationFail {
  ok: false;
  errors: string[];
}
export type ValidationResult = ValidationOk | ValidationFail;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateScenario(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(input)) {
    return { ok: false, errors: ['场景文件内容不是对象，无法解析。'] };
  }

  const version = input['schemaVersion'];
  if (version !== SCHEMA_VERSION) {
    errors.push(
      `场景结构版本不匹配：文件为 ${String(version)}，当前支持 ${SCHEMA_VERSION}。` +
        '请用对应版本的工具打开，或手工迁移后再导入。',
    );
  }

  if (typeof input['name'] !== 'string' || input['name'].length === 0) {
    errors.push('场景缺少 name 字段（非空字符串）。');
  }

  const devices = input['devices'];
  const cables = input['cables'];
  if (!Array.isArray(devices)) errors.push('场景缺少 devices 数组。');
  if (!Array.isArray(cables)) errors.push('场景缺少 cables 数组。');

  if (errors.length > 0 || !Array.isArray(devices) || !Array.isArray(cables)) {
    return { ok: false, errors };
  }

  // ── 设备与端口索引（不变量 2）
  const deviceIds = new Set<string>();
  /** `${deviceId}:${portId}` → 端口介质（无线端口允许承载多条关联，见 D-11 例外） */
  const portOwner = new Map<string, { deviceId: string; medium: string }>();
  devices.forEach((raw, i) => {
    if (!isObject(raw)) {
      errors.push(`devices[${i}] 不是对象。`);
      return;
    }
    const id = raw['id'];
    if (typeof id !== 'string' || id.length === 0) {
      errors.push(`devices[${i}] 缺少 id。`);
      return;
    }
    if (deviceIds.has(id)) errors.push(`设备 id 重复：${id}。`);
    deviceIds.add(id);

    const ports = raw['ports'];
    if (!Array.isArray(ports)) {
      errors.push(`设备 ${id} 缺少 ports 数组。`);
      return;
    }
    const seen = new Set<string>();
    ports.forEach((p, j) => {
      if (!isObject(p)) {
        errors.push(`设备 ${id} 的 ports[${j}] 不是对象。`);
        return;
      }
      const pid = p['id'];
      if (typeof pid !== 'string' || pid.length === 0) {
        errors.push(`设备 ${id} 的 ports[${j}] 缺少 id。`);
        return;
      }
      if (seen.has(pid)) errors.push(`设备 ${id} 的端口 id 重复：${pid}。`);
      seen.add(pid);
      portOwner.set(`${id}:${pid}`, {
        deviceId: id,
        medium: typeof p['medium'] === 'string' ? p['medium'] : '',
      });
    });

    // 不变量 5：l3 接口的 portId 必须存在
    const l3 = raw['l3'];
    if (isObject(l3) && Array.isArray(l3['interfaces'])) {
      l3['interfaces'].forEach((itf, j) => {
        if (!isObject(itf)) return;
        const portId = itf['portId'];
        if (typeof portId === 'string' && !seen.has(portId)) {
          errors.push(
            `设备 ${id} 的 l3.interfaces[${j}] 指向不存在的端口 ${portId}。`,
          );
        }
      });
    }
  });

  // ── 线缆（不变量 1、3）
  const portUse = new Map<string, number>();
  /** 聚合组成员数：`设备A→设备B`（id 排序）→ 勾了 bonded 的线缆数 */
  const bondPairs = new Map<string, number>();
  cables.forEach((raw, i) => {
    if (!isObject(raw)) {
      errors.push(`cables[${i}] 不是对象。`);
      return;
    }
    const cid = typeof raw['id'] === 'string' ? raw['id'] : `cables[${i}]`;
    const a = raw['a'];
    const b = raw['b'];
    for (const [label, ep] of [
      ['a', a],
      ['b', b],
    ] as const) {
      if (!isObject(ep)) {
        errors.push(`线缆 ${cid} 的 ${label} 端缺少端点定义。`);
        continue;
      }
      const deviceId = ep['deviceId'];
      const portId = ep['portId'];
      if (typeof deviceId !== 'string' || !deviceIds.has(deviceId)) {
        errors.push(`线缆 ${cid} 的 ${label} 端指向不存在的设备 ${String(deviceId)}。`);
        continue;
      }
      const key = `${deviceId}:${String(portId)}`;
      if (!portOwner.has(key)) {
        errors.push(
          `线缆 ${cid} 的 ${label} 端指向不存在的端口 ${String(portId)}（设备 ${deviceId}）。`,
        );
        continue;
      }
      portUse.set(key, (portUse.get(key) ?? 0) + 1);
    }
    const len = raw['lengthM'];
    if (typeof len !== 'number' || Number.isNaN(len) || len < 0) {
      errors.push(`线缆 ${cid} 的 lengthM 必须是非负数字。`);
    }

    // 标签位置是 0–1 的弧长比例（FR-46）；越界说明文件被手工改坏了
    const ratio = raw['labelRatio'];
    if (ratio !== undefined) {
      if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
        errors.push(`线缆 ${cid} 的 labelRatio 必须是 0–1 之间的数字。`);
      }
    }

    // 链路聚合：组成员必须成对（一条链路谈不上"聚合"），且无线关联不能聚合
    const bonded = raw['bonded'];
    if (bonded !== undefined) {
      if (typeof bonded !== 'boolean') {
        errors.push(`线缆 ${cid} 的 bonded 必须是布尔值。`);
      } else if (bonded) {
        const type = raw['type'];
        if (type === 'wireless') {
          errors.push(`线缆 ${cid} 是无线关联，不能做链路聚合（聚合只对有线端口有意义）。`);
        }
        if (isObject(a) && isObject(b)) {
          const ends = [String(a['deviceId']), String(b['deviceId'])].sort();
          bondPairs.set(ends.join('→'), (bondPairs.get(ends.join('→')) ?? 0) + 1);
        }
      }
    }
  });

  // 每对设备上的聚合组至少要两根成员，否则是"孤零零勾了聚合"的坏数据
  for (const [pair, count] of bondPairs) {
    if (count >= 2) continue;
    errors.push(
      `链路聚合组 ${pair} 只有 ${count} 根成员线缆；聚合至少要两根（否则请去掉 bonded 标记）。`,
    );
  }

  // 不变量 1：一个端口最多一根线缆（D-11）；
  // **无线端口例外**：一个 radio 天然承载多条关联（手机、笔记本可以同时连同一个 AP）
  for (const [key, count] of portUse) {
    if (count <= 1) continue;
    const owner = portOwner.get(key);
    if (owner?.medium === 'wifi') continue;
    const [deviceId, portId] = key.split(':');
    errors.push(
      `端口 ${deviceId}/${portId} 接了 ${count} 根线缆；每个有线端口最多一根（见 DECISIONS D-11）。`,
    );
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, scenario: input as unknown as Scenario };
}

/** 解析 JSON 文本并校验，供导入功能使用 */
export function parseScenarioJson(text: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`JSON 解析失败：${(e as Error).message}`] };
  }
  return validateScenario(parsed);
}
