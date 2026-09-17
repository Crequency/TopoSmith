/**
 * 预置场景选择弹窗（FR-54）
 *
 * 为什么是模态而不是下拉：场景是"换掉整个世界"的操作，代价不可逆（会覆盖当前拓扑），
 * 而且每个场景都需要一段说明（它演示什么、有没有故意留的坑）——
 * 这些信息塞进下拉项会看不清，塞进提示又要靠悬浮才发现。
 *
 * 无障碍约定：`role="dialog"` + `aria-modal`，打开时聚焦第一张卡片，Esc 关闭，
 * 点遮罩关闭；卡片本身是 `<button>`，可以用键盘逐张 Tab 过去。
 */

import { useEffect, useRef } from 'react';
import { PRESETS, presetSize, type PresetMeta } from '../scenarios';
import { useApp } from '../state/store';
import { Icon, uiIcon } from '../lib/icons';

export function PresetDialog({ onClose }: { onClose: () => void }) {
  const loadPreset = useApp((s) => s.loadPreset);
  const clearScenario = useApp((s) => s.clearScenario);
  const currentName = useApp((s) => s.scenario.name);
  const firstCard = useRef<HTMLButtonElement>(null);

  // 打开即聚焦第一张卡片：键盘用户不必先 Tab 过整个工具栏
  useEffect(() => {
    firstCard.current?.focus();
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

  const choose = (preset: PresetMeta) => {
    loadPreset(preset.key);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-6 backdrop-blur-sm"
      onPointerDown={(event) => {
        // 只有点在遮罩本身才关闭：点面板内部不关
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="preset-dialog-title"
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div className="flex flex-col gap-0.5">
            <h2 id="preset-dialog-title" className="text-sm font-semibold text-slate-100">
              选择预置场景
            </h2>
            <p className="text-[11px] leading-snug text-slate-500">
              载入会覆盖当前拓扑（当前：{currentName}）。想保留就先「导出」成文件。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="关闭（Esc）"
            aria-label="关闭"
            className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
          >
            ✕
          </button>
        </header>

        <div className="flex flex-col gap-2 overflow-y-auto px-5 py-4">
          {PRESETS.map((preset, index) => {
            const size = presetSize(preset);
            const active = preset.name === currentName;
            return (
              <button
                key={preset.key}
                ref={index === 0 ? firstCard : undefined}
                type="button"
                onClick={() => choose(preset)}
                className={`flex flex-col gap-1.5 rounded-lg border px-4 py-3 text-left transition ${
                  active
                    ? 'border-sky-500/60 bg-sky-500/10'
                    : 'border-slate-800 bg-slate-950/50 hover:border-sky-500/50 hover:bg-slate-900'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-slate-100">{preset.name}</span>
                  {active && (
                    <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-200">
                      当前
                    </span>
                  )}
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-500">
                    {size.devices} 台设备 · {size.cables} 条链路
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-slate-400">{preset.summary}</p>
                <div className="flex flex-wrap gap-1.5">
                  {preset.highlights.map((tag) => (
                    <span
                      key={tag}
                      className="rounded border border-slate-700 bg-slate-800/60 px-1.5 py-0.5 text-[10px] text-slate-300"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                {preset.pitfall && (
                  <p className="flex items-start gap-1.5 text-[10px] leading-snug text-amber-300/90">
                    <span className="mt-0.5 shrink-0">⚠</span>
                    <span>{preset.pitfall}</span>
                  </p>
                )}
              </button>
            );
          })}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-800 px-5 py-3">
          <button
            type="button"
            onClick={() => {
              clearScenario();
              onClose();
            }}
            className="rounded-md border border-slate-700 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-slate-500 hover:text-slate-200"
          >
            改为从零开始（空白拓扑）
          </button>
          <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
            <Icon node={uiIcon('undo')} size={11} className="text-slate-500" />
            载入后可用 Ctrl+Z 撤销本次载入
          </span>
        </footer>
      </div>
    </div>
  );
}
