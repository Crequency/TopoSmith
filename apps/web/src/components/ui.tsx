/** 通用 UI 原语（Tailwind 类名内联；不新增语义化 CSS 类） */

import { useEffect, useState, type ReactNode } from 'react';
import { commitNumberDraft } from '../lib/number-input';

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-slate-400">{label}</span>
      {children}
      {hint && <span className="text-[10px] leading-snug text-slate-500">{hint}</span>}
    </label>
  );
}

const inputClass =
  'w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none transition focus:border-sky-500 disabled:opacity-50';

export function TextInput({
  value,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type="text"
      className={inputClass}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/**
 * 数字输入框。
 *
 * 输入期间只保留草稿文本（不钳制、不解析），**失焦或回车才提交**并按 min/max 钳制。
 * 直接"每次按键就钳制"会让多位数输入被打断：输 `42` 会先变 `8` 再变 `48`（FR-42）。
 * `min`/`max` 同时交给浏览器，所以上下小三角的可达范围与真实范围一致。
 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // 外部值变化（例如撤销、切换选中对象）时丢弃草稿，避免显示过期文本
  useEffect(() => setDraft(null), [value]);

  const shown = draft ?? String(Number.isFinite(value) ? value : 0);

  const commit = () => {
    if (draft === null) return;
    const next = commitNumberDraft(draft, { min, max });
    setDraft(null);
    if (next !== null && next !== value) onChange(next);
  };

  return (
    <input
      type="number"
      className={inputClass}
      value={shown}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
      onWheel={(event) => {
        // 鼠标滚轮在数字框上会误改数值，且滚动页面时极易触发
        event.currentTarget.blur();
      }}
    />
  );
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <select
      className={inputClass}
      value={String(value)}
      disabled={disabled}
      onChange={(event) => {
        const raw = event.target.value;
        const matched = options.find((option) => String(option.value) === raw);
        if (matched) onChange(matched.value);
      }}
    >
      {options.map((option) => (
        <option key={String(option.value)} value={String(option.value)}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled = false,
  title,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <label
      className={`flex items-center gap-2 text-xs text-slate-300 ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      }`}
      title={title}
    >
      <input
        type="checkbox"
        className="size-3.5 accent-sky-500"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

type ButtonVariant = 'primary' | 'default' | 'danger' | 'ghost';

const BUTTON_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-sky-600 text-white hover:bg-sky-500 border-sky-500',
  default: 'bg-slate-800 text-slate-100 hover:bg-slate-700 border-slate-700',
  danger: 'bg-rose-600/90 text-white hover:bg-rose-500 border-rose-500',
  ghost: 'bg-transparent text-slate-300 hover:bg-slate-800 border-transparent',
};

export function Button({
  children,
  onClick,
  variant = 'default',
  disabled,
  title,
  active,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  title?: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      // whitespace-nowrap：工具栏是 flex-wrap 的，按钮允许收缩时中文标签会被折成两行
      // （"连线"曾因此变成上下两个字）—— 按钮的标签是原子内容，不该换行
      className={`whitespace-nowrap rounded-md border px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? 'border-amber-400 bg-amber-500/20 text-amber-200' : BUTTON_CLASS[variant]
      }`}
    >
      {children}
    </button>
  );
}

export function Panel({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/80 px-3 py-2">
        <h2 className="text-xs font-semibold tracking-wide text-slate-300">{title}</h2>
        <div className="flex items-center gap-1.5">{actions}</div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}
