/** 设备面板：按分组列出目录里的设备模板，可拖拽到画布或点击添加（FR-70 起为分组卡片） */

import { templatesByGroup, type TemplateGroup } from '@toposmith/catalog';
import { deviceIcon, Icon, portIcon } from '../lib/icons';
import { useApp } from '../state/store';

/**
 * 一个分组卡片的内容（FR-70）
 *
 * 卡片化之后，"分组标题 + 设备列表"由 `SidebarStack` 的标题栏 + 这里的内容组成：
 * 分组说明（hint）搬到标题栏右侧，卡里只剩设备条目，省一行高度也少一层视觉噪音。
 */
export function PaletteGroup({ groupId }: { groupId: string }) {
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
  if (templates.length === 0) {
    return <p className="px-3 py-2 text-[11px] text-slate-500">这个分组下暂时没有设备模板。</p>;
  }

  return (
    <ul className="flex flex-col gap-1 px-2 py-2">
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
  );
}
