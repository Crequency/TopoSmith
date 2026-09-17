/**
 * 设备目录（一整页，FR-43 / FR-70）
 *
 * 目录是左栏的一个**页面**：全部分组在一页里列出、整页滚动，与节点树共享左侧空间
 * （通过页签切换）。分组不再各占一张卡片 —— 页签 + 卡片两套范式混在一起，
 * 会让"拖标题排版"到底是拖分组还是拖页面变得说不清（用户反馈纠正过这一点）。
 */

import { TEMPLATE_GROUPS, templatesByGroup, type TemplateGroup } from '@toposmith/catalog';
import { deviceIcon, Icon, portIcon } from '../lib/icons';
import { useApp } from '../state/store';

export function Palette() {
  return (
    <div data-testid="palette-page" className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-slate-800 px-3 py-2">
        <p className="text-[10px] leading-snug text-slate-500">拖到画布，或点击在视口内添加</p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {TEMPLATE_GROUPS.map((group) => {
          const templates = templatesByGroup(group.id);
          if (templates.length === 0) return null;
          return (
            <PaletteGroup key={group.id} groupId={group.id} label={group.label} hint={group.hint} />
          );
        })}
      </div>
    </div>
  );
}

/** 目录里的一个分组：标题 + 设备条目（同一页内的小节，不是独立卡片） */
function PaletteGroup({
  groupId,
  label,
  hint,
}: {
  groupId: string;
  label: string;
  hint: string;
}) {
  const addDevice = useApp((s) => s.addDevice);
  const viewport = useApp((s) => s.viewport);
  const world = useApp((s) => s.world);

  // 点击添加时，把设备放在视口中心附近，并在已有设备下方错开，避免重叠
  const addAtCenter = (templateKey: string) => {
    const index = world.ordered.length;
    const worldX = (-viewport.x + 320) / viewport.k;
    const worldY = (-viewport.y + 120 + (index % 8) * 70) / viewport.k;
    addDevice(templateKey, worldX, worldY);
  };

  const templates = templatesByGroup(groupId as TemplateGroup);

  return (
    <section className="border-b border-slate-800/60 px-2 py-2">
      <div className="mb-1.5 flex items-baseline justify-between px-1">
        <h3 className="text-[11px] font-semibold text-slate-400">{label}</h3>
        <span className="text-[10px] text-slate-600">{hint}</span>
      </div>
      <ul className="flex flex-col gap-1">
      {templates.map((template) => (
        <li key={template.key}>
          <button
            type="button"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData('application/x-toposmith-template', template.key);
              event.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => addAtCenter(template.key)}
            title={template.note ?? template.label}
            className="flex w-full cursor-grab items-center gap-2 rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1.5 text-left transition hover:border-sky-600 hover:bg-slate-800/60 active:cursor-grabbing"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded bg-slate-800 text-sky-300">
              <Icon node={deviceIcon(template.kind, template.subtype)} size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11px] font-medium text-slate-200">
                {template.label}
              </span>
              <span className="flex items-center gap-1 text-[10px] text-slate-500">
                <span className="truncate">
                  {template.ports.length} 端口
                  {template.builtinExtension ? ' · 内置扩展' : ''}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-0.5 text-slate-600">
                  {[...new Set(template.ports.map((port) => port.medium))].map((medium) => (
                    <Icon key={medium} node={portIcon(medium)} size={10} />
                  ))}
                </span>
              </span>
            </span>
          </button>
        </li>
      ))}
      </ul>
    </section>
  );
}
