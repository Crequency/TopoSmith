/** 顶部工具栏：模式切换、线缆参数、场景读写 */

import { useRef, useState } from 'react';
import { CABLE_SPECS, cableLabel } from '@toposmith/catalog';
import type { CableType } from '@toposmith/schema';
import { Icon, uiIcon } from '../lib/icons';
import { selectionCount, useApp } from '../state/store';
import { Button, NumberInput, Select } from './ui';
import { PresetDialog } from './PresetDialog';

export function Toolbar() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scenario = useApp((s) => s.scenario);
  const linkMode = useApp((s) => s.linkMode);
  const linkDraft = useApp((s) => s.linkDraft);
  const cableDefaults = useApp((s) => s.cableDefaults);
  const selection = useApp((s) => s.selection);
  const viewport = useApp((s) => s.viewport);
  const history = useApp((s) => s.history);
  const snapEnabled = useApp((s) => s.snapEnabled);

  const setLinkMode = useApp((s) => s.setLinkMode);
  const setCableDefaults = useApp((s) => s.setCableDefaults);
  const deleteSelection = useApp((s) => s.deleteSelection);
  const fitView = useApp((s) => s.fitView);
  const setViewport = useApp((s) => s.setViewport);
  const zoomAt = useApp((s) => s.zoomAt);
  const [presetOpen, setPresetOpen] = useState(false);
  const clearScenario = useApp((s) => s.clearScenario);
  const exportJson = useApp((s) => s.exportJson);
  const importJson = useApp((s) => s.importJson);
  const showToast = useApp((s) => s.showToast);
  const setSnapEnabled = useApp((s) => s.setSnapEnabled);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);

  const cableOptions = CABLE_SPECS.filter((spec) => spec.family !== 'wireless').map((spec) => ({
    value: spec.type,
    label: spec.alias ? `${spec.label}（俗称 ${spec.alias}）` : spec.label,
  }));

  const download = () => {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${scenario.id || 'toposmith'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast('已导出场景 JSON。', 'info');
  };

  const upload = async (file: File) => {
    const text = await file.text();
    const error = importJson(text);
    if (error) showToast(`导入失败：\n${error}`, 'error');
  };

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-900 px-3 py-2">
      <div className="flex items-center gap-2">
        {/* 品牌标识：与 favicon 同一份矢量来源（apps/web/public/favicon.svg），保证"页面里的 logo"和"标签栏里的 logo"是一个东西 */}
        {/* 用 BASE_URL 而不是绝对路径：GitHub Pages 项目站点是子路径（见 vite.config.ts） */}
        <img
          src={`${import.meta.env.BASE_URL}favicon.svg`}
          alt="TopoSmith"
          width={20}
          height={20}
          className="shrink-0"
        />
        <span className="text-sm font-bold tracking-tight text-slate-100">TopoSmith</span>
        <span className="self-baseline text-[11px] text-slate-500">拓扑匠</span>
        <span className="ml-2 rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
          {scenario.name}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          active={linkMode}
          onClick={() => setLinkMode(!linkMode)}
          title="连线模式：点击设备底部的端口方块选择两端"
        >
          {linkMode ? (linkDraft ? '选择目标端口…' : '选择起点端口…') : '连线'}
        </Button>
        <Select<CableType>
          value={cableDefaults.type}
          options={cableOptions}
          disabled={linkMode}
          onChange={(type) => setCableDefaults({ type })}
        />
        <div className="w-20">
          <NumberInput
            value={cableDefaults.lengthM}
            min={0}
            step={1}
            disabled={linkMode}
            onChange={(lengthM) => setCableDefaults({ lengthM })}
          />
        </div>
        <span className="text-[10px] text-slate-500">米</span>
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={!history.canUndo}
          onClick={undo}
          title={history.canUndo ? `撤销：${history.undoLabel ?? ''}（Ctrl+Z）` : '没有可撤销的操作'}
          className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs font-medium text-slate-100 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon node={uiIcon('undo')} size={13} />
          撤销
        </button>
        <button
          type="button"
          disabled={!history.canRedo}
          onClick={redo}
          title={history.canRedo ? `重做：${history.redoLabel ?? ''}（Ctrl+Shift+Z / Ctrl+Y）` : '没有可重做的操作'}
          className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs font-medium text-slate-100 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon node={uiIcon('redo')} size={13} />
          重做
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          onClick={deleteSelection}
          disabled={selectionCount(selection) === 0}
          variant="danger"
          title="删除选中的设备与线缆（Delete）"
        >
          删除选中{selectionCount(selection) > 0 ? `（${selectionCount(selection)}）` : ''}
        </Button>
        <Button
          active={snapEnabled}
          onClick={() => setSnapEnabled(!snapEnabled)}
          title="网格吸附（8 单位 + 节点对齐），按住 Alt 拖动可临时关闭"
        >
          网格吸附
        </Button>
        <Button onClick={fitView}>适应视图</Button>
        <Button onClick={() => zoomAt(1 / 1.2, 400, 300)} title="缩小">
          −
        </Button>
        <Button onClick={() => zoomAt(1.2, 400, 300)} title="放大">
          ＋
        </Button>
        <Button
          onClick={() => setViewport({ x: 40, y: 20, k: 1 })}
          title={`当前缩放 ${Math.round(viewport.k * 100)}%`}
        >
          复位
        </Button>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <Button
          onClick={() =>
            useApp
              .getState()
              .selectManyDevices(useApp.getState().world.ordered.map((device) => device.id))
          }
          title="全选设备（Ctrl/Cmd+A）"
        >
          全选
        </Button>
        <Button
          onClick={() => setPresetOpen(true)}
          title="载入一套预置场景（家庭 / 办公 / 机房 / 光接入 / 园区，会覆盖当前拓扑）"
        >
          预置场景
        </Button>
        <Button onClick={clearScenario} title="清空当前拓扑">
          清空
        </Button>
        <Button onClick={download}>导出</Button>
        <Button onClick={() => fileInputRef.current?.click()}>导入</Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = '';
          }}
        />
      </div>

      {presetOpen && <PresetDialog onClose={() => setPresetOpen(false)} />}
    </header>
  );
}

/** 供检查器复用：线缆类型下拉的选项文本 */
export function cableTypeLabel(type: CableType): string {
  return cableLabel(type);
}
