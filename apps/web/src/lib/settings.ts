/**
 * 用户设置（使用偏好）
 *
 * 与拓扑存档分开落盘：设置是"我这个人的偏好"，换场景、清空拓扑、导出/导入都不该动它
 * （与布局 FR-69 同一套理由）。这里只放**纯逻辑**（规范化 + 读写），store 负责持有状态。
 *
 * 当前设置项只有一项 —— 无线动画的表现形式（FR-86），两层结构：
 *   · 用户设置：统一覆盖所有无线设备，或遵照每台设备的单独设置；
 *   · 设备设置：某台设备单独指定用它自己的动画。
 */

import {
  DEFAULT_WIRELESS_ANIMATION,
  normalizeAnimationStyle,
  type WirelessAnimationStyle,
} from '@toposmith/schema';

export const SETTINGS_STORAGE_KEY = 'toposmith.ui.settings.v1';

/**
 * 无线动画的**用户设置**。
 *
 * `per-device` 是本产品的默认：默认动画（信号波）本身就是好的通用形态，
 * 而"统一覆盖"是为"我要给一整套拓扑讲同一个故事"（演示、截图、教学）准备的。
 */
export type WirelessAnimationSetting =
  | { mode: 'per-device' }
  | { mode: 'unified'; style: WirelessAnimationStyle };

export const DEFAULT_WIRELESS_ANIMATION_SETTING: WirelessAnimationSetting = { mode: 'per-device' };

export interface UserSettings {
  wirelessAnimation: WirelessAnimationSetting;
}

export const DEFAULT_SETTINGS: UserSettings = {
  wirelessAnimation: DEFAULT_WIRELESS_ANIMATION_SETTING,
};

/** 把任意输入规范成合法设置：坏数据一律回落默认，绝不让界面拿到非法值 */
export function normalizeWirelessAnimationSetting(raw: unknown): WirelessAnimationSetting {
  if (!raw || typeof raw !== 'object') return DEFAULT_WIRELESS_ANIMATION_SETTING;
  const value = raw as { mode?: unknown; style?: unknown };
  if (value.mode === 'unified') {
    return { mode: 'unified', style: normalizeAnimationStyle(value.style) };
  }
  if (value.mode === 'per-device') return { mode: 'per-device' };
  return DEFAULT_WIRELESS_ANIMATION_SETTING;
}

export function normalizeSettings(raw: unknown): UserSettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_SETTINGS;
  const value = raw as { wirelessAnimation?: unknown };
  if (value.wirelessAnimation === undefined) return DEFAULT_SETTINGS;
  return { wirelessAnimation: normalizeWirelessAnimationSetting(value.wirelessAnimation) };
}

/** 设备的动画选择：'inherit' = 跟随用户设置 */
export type DeviceAnimationChoice = 'inherit' | WirelessAnimationStyle;

export function animationChoiceOf(style: WirelessAnimationStyle | undefined): DeviceAnimationChoice {
  return style ?? 'inherit';
}

export function styleFromChoice(choice: DeviceAnimationChoice): WirelessAnimationStyle | undefined {
  return choice === 'inherit' ? undefined : choice;
}

/**
 * 某台设备**最终**用哪个动画。
 *
 * 优先级：用户设置"统一覆盖" > 设备自己的设置 > 默认动画（信号波）。
 * 只有一处实现，画布与设置面板都调它，界面上显示的"当前生效"与真正画的必然一致。
 */
export function resolveAnimationStyle(
  setting: WirelessAnimationSetting,
  deviceStyle?: WirelessAnimationStyle,
): WirelessAnimationStyle {
  if (setting.mode === 'unified') return setting.style;
  return deviceStyle ?? DEFAULT_WIRELESS_ANIMATION;
}

/** 生效来源：设置面板用它解释"这个动画是哪来的" */
export function animationSource(
  setting: WirelessAnimationSetting,
  deviceStyle?: WirelessAnimationStyle,
): 'unified' | 'device' | 'default' {
  if (setting.mode === 'unified') return 'unified';
  return deviceStyle ? 'device' : 'default';
}

/* ────────────────────────────── 落盘 ────────────────────────────── */

export function loadStoredSettings(): UserSettings {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return normalizeSettings(JSON.parse(raw) as unknown);
  } catch {
    // 存档损坏不该阻塞启动：退回默认设置
    return DEFAULT_SETTINGS;
  }
}

export function persistSettings(settings: UserSettings): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    }
  } catch {
    /* 配额或隐私模式：忽略，不影响本次会话 */
  }
}
