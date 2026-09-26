/**
 * 用户设置弹窗（FR-86）
 *
 * 目前只有一项设置：**无线关联的动画表现形式**。两层结构正好对应这个界面上的两组控件：
 *   · 「统一动画」：所有无线设备都用同一个形态（演示 / 截图 / 教学时用）；
 *   · 「遵照每台设备的设置」：每台设备各用各的（默认），没单独设置的走默认形态（信号波）。
 *
 * 界面里把九种形态连同"它表达什么 / 画成什么样"一起列出来：动画不是装饰，
 * 每一种都对应一类真实的无线行为，选型时需要看到这层对应关系（用户给的对照表就是依据）。
 * 改完**立刻生效**（画布重画），不需要确认按钮。
 */

import { useEffect, useRef, type ReactNode } from 'react';
import {
  DEFAULT_WIRELESS_ANIMATION,
  WIRELESS_ANIMATION_META,
  WIRELESS_ANIMATION_STYLES,
  type WirelessAnimationStyle,
} from '@toposmith/schema';
import { useApp } from '../state/store';
import { Icon, uiIcon } from '../lib/icons';

/** 一行形态：单选按钮 + 名称 + 英文名 + "表达什么 / 画成什么样" */
function StyleOption({
  style,
  checked,
  onSelect,
}: {
  style: WirelessAnimationStyle;
  checked: boolean;
  onSelect: () => void;
}) {
  const meta = WIRELESS_ANIMATION_META[style];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      data-style={style}
      onClick={onSelect}
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition ${
        checked
          ? 'border-sky-500 bg-sky-500/10'
          : 'border-slate-800 bg-slate-950/40 hover:border-slate-600 hover:bg-slate-800/40'
      }`}
    >
      <span
        className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
          checked ? 'border-sky-400' : 'border-slate-600'
        }`}
        aria-hidden
      >
        {checked && <span className="h-2 w-2 rounded-full bg-sky-400" />}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className="text-xs font-medium text-slate-100">{meta.label}</span>
          <span className="text-[10px] text-slate-500">{meta.latin}</span>
          {style === DEFAULT_WIRELESS_ANIMATION && (
            <span className="rounded bg-slate-800 px-1 text-[10px] text-slate-400">默认</span>
          )}
        </span>
        <span className="text-[10px] leading-snug text-slate-400">
          {meta.form}
          <span className="text-slate-600"> · {meta.scene}</span>
        </span>
      </span>
    </button>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }): ReactNode {
  const settings = useApp((s) => s.settings);
  const setWirelessAnimation = useApp((s) => s.setWirelessAnimation);
  const resetSettings = useApp((s) => s.resetSettings);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setting = settings.wirelessAnimation;
  const unified = setting.mode === 'unified';
  const unifiedStyle = setting.mode === 'unified' ? setting.style : DEFAULT_WIRELESS_ANIMATION;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-6 backdrop-blur-sm"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <Icon node={uiIcon('settings')} size={16} className="text-sky-400" />
            <h2 id="settings-dialog-title" className="text-sm font-semibold text-slate-100">
              用户设置
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            title="关闭（Esc）"
            aria-label="关闭设置"
            className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
          >
            ✕
          </button>
        </header>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-4">
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <Icon node={uiIcon('animation')} size={14} className="text-sky-400" />
                <h3 className="text-xs font-semibold text-slate-200">无线连接动画</h3>
              </div>
              <p className="text-[10px] leading-snug text-slate-500">
                动画由**提供无线接入的那台设备**决定（AP、家用网关的无线侧、基站）——
                它画的是"这个无线信号长什么样"。终端一侧不需要设置。
              </p>
            </div>

            {/* 模式：统一覆盖 or 遵照设备 */}
            <div role="radiogroup" aria-label="动画设置模式" className="flex flex-col gap-2">
              <button
                type="button"
                role="radio"
                aria-checked={unified}
                data-mode="unified"
                onClick={() =>
                  setWirelessAnimation({ mode: 'unified', style: unifiedStyle })
                }
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition ${
                  unified
                    ? 'border-sky-500 bg-sky-500/10'
                    : 'border-slate-800 bg-slate-950/40 hover:border-slate-600'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                    unified ? 'border-sky-400' : 'border-slate-600'
                  }`}
                  aria-hidden
                >
                  {unified && <span className="h-2 w-2 rounded-full bg-sky-400" />}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-slate-100">
                    统一动画：覆盖所有无线设备
                  </span>
                  <span className="text-[10px] text-slate-400">
                    忽略每台设备的单独设置，全部用下面选中的那一种（演示、截图、教学时最省心）
                  </span>
                </span>
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={!unified}
                data-mode="per-device"
                onClick={() => setWirelessAnimation({ mode: 'per-device' })}
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition ${
                  !unified
                    ? 'border-sky-500 bg-sky-500/10'
                    : 'border-slate-800 bg-slate-950/40 hover:border-slate-600'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                    !unified ? 'border-sky-400' : 'border-slate-600'
                  }`}
                  aria-hidden
                >
                  {!unified && <span className="h-2 w-2 rounded-full bg-sky-400" />}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-slate-100">
                    遵照每台设备的设置（默认）
                  </span>
                  <span className="text-[10px] text-slate-400">
                    在设备面板的「无线」一节里为单个设备指定；没指定的用默认动画「信号波」
                  </span>
                </span>
              </button>
            </div>

            {/* 统一模式下才需要选形态；遵照设备时列出形态只是"可选项说明" */}
            <div className="flex flex-col gap-2">
              <div className="text-[10px] font-semibold tracking-wide text-slate-400">
                {unified ? '统一使用的动画' : '可选动画（在设备面板里逐台指定）'}
              </div>
              <div
                role="radiogroup"
                aria-label="无线动画表现形式"
                className={`grid grid-cols-1 gap-2 sm:grid-cols-2 ${unified ? '' : 'opacity-60'}`}
              >
                {WIRELESS_ANIMATION_STYLES.map((style) => (
                  <StyleOption
                    key={style}
                    style={style}
                    checked={unified && unifiedStyle === style}
                    onSelect={() => setWirelessAnimation({ mode: 'unified', style })}
                  />
                ))}
              </div>
              {!unified && (
                <p className="text-[10px] leading-snug text-slate-500">
                  点任意一种即切换为「统一动画」并用它覆盖全部设备。
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
              <span className="text-[10px] leading-snug text-slate-500">
                设置是**使用偏好**，与拓扑分开落盘：换场景、清空拓扑、导出/导入都不会动它。
              </span>
              <button
                type="button"
                onClick={resetSettings}
                className="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 transition hover:border-slate-500 hover:text-slate-100"
              >
                恢复默认
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
