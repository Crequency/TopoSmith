/** 轻量提示条：连线预检失败、降速提示等即时反馈 */

import { useEffect } from 'react';
import { useApp } from '../state/store';

const LEVEL_CLASS = {
  info: 'border-sky-700 bg-sky-500/15 text-sky-100',
  warn: 'border-amber-600 bg-amber-500/15 text-amber-100',
  error: 'border-rose-700 bg-rose-500/15 text-rose-100',
} as const;

export function Toast() {
  const toast = useApp((s) => s.toast);
  const dismissToast = useApp((s) => s.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(dismissToast, 6000);
    return () => window.clearTimeout(timer);
  }, [toast, dismissToast]);

  if (!toast) return null;

  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 w-[min(680px,90vw)] -translate-x-1/2">
      <div
        className={`pointer-events-auto flex items-start gap-3 rounded-lg border px-3 py-2 text-xs shadow-xl backdrop-blur ${LEVEL_CLASS[toast.level]}`}
      >
        <span className="whitespace-pre-wrap leading-relaxed">{toast.text}</span>
        <button
          type="button"
          onClick={dismissToast}
          className="ml-auto shrink-0 rounded px-1 text-slate-300 hover:bg-white/10"
          aria-label="关闭提示"
        >
          ×
        </button>
      </div>
    </div>
  );
}
