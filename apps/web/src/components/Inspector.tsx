/** 检查器：编辑选中设备 / 线缆的全部可编辑事实 */

import { useMemo, useState, type ReactNode } from 'react';
import { portIcon } from '../lib/icons';
import {
  CABLE_SPECS,
  SPEED,
  cableLabel,
  cableSpec,
  defaultVlanOf,
  formatSpeed,
  portCarriesVlan,
} from '@toposmith/catalog';
import {
  DEFAULT_LABEL_RATIO,
  DEVICE_KIND_LABEL,
  DEVICE_SUBTYPE_LABEL,
  PORT_MEDIUM_LABEL,
  clampLabelRatio,
  type AccessMode,
  type CableType,
  type Device,
  type Port,
  type PortMedium,
  type PortRole,
  type PortSide,
  type WifiBand,
  type WifiStandard,
} from '@toposmith/schema';
import { firstLinkOfPort, type World } from '@toposmith/engine';
import {
  MAX_CARD_W,
  MAX_RACK_HEIGHT_U,
  MAX_RACK_UNITS,
  MIN_CARD_W,
  MIN_RACK_HEIGHT_U,
  MIN_RACK_UNITS,
  NODE_W,
  cardWidthOf,
  rackUnitsOf,
  type AlignMode,
} from '../lib/geometry';
import { speedColor } from '../lib/speed-color';
import { deviceIcon, Icon, uiIcon, type UiIconName } from '../lib/icons';
import { isRackable } from '@toposmith/catalog';
import { useApp } from '../state/store';
import { Button, Checkbox, Field, NumberInput, Select, TextInput } from './ui';

const SPEED_OPTIONS = [
  { value: SPEED.eth100, label: '100 Mbps' },
  { value: SPEED.eth1g, label: '1 Gbps' },
  { value: SPEED.eth2_5g, label: '2.5 Gbps' },
  { value: SPEED.eth5g, label: '5 Gbps' },
  { value: SPEED.eth10g, label: '10 Gbps' },
  { value: SPEED.eth25g, label: '25 Gbps' },
  { value: 0, label: '无线（协商）' },
];

const ROLE_OPTIONS: { value: PortRole; label: string }[] = [
  { value: 'lan', label: 'LAN' },
  { value: 'wan', label: 'WAN' },
  { value: 'access', label: 'Access' },
  { value: 'trunk', label: 'Trunk' },
  { value: 'uplink', label: 'Uplink' },
  { value: 'client', label: '终端口' },
];

export function Inspector() {
  const world = useApp((s) => s.world);
  const selection = useApp((s) => s.selection);

  if (selection.port) {
    const device = world.devices.get(selection.port.deviceId);
    const port = device?.ports.find((item) => item.id === selection.port?.portId);
    if (device && port) return <PortInspector device={device} port={port} world={world} />;
  }
  if (selection.devices.length >= 2 && selection.cables.length === 0) {
    return <MultiSelectInspector />;
  }
  if (selection.devices.length === 1 && selection.cables.length === 0) {
    const device = world.devices.get(selection.devices[0]!);
    if (device?.kind === 'rack') return <RackInspector device={device} world={world} />;
    if (device) return <DeviceInspector device={device} world={world} />;
  }
  if (selection.cables.length === 1 && selection.devices.length === 0) {
    const link = world.links.find((l) => l.id === selection.cables[0]);
    if (link) return <CableInspector linkId={link.id} world={world} />;
  }

  return (
    <div className="p-3 text-[11px] leading-relaxed text-slate-500">
      在画布上选中一台设备或一条线缆，这里会显示它的全部可编辑参数。
      <br />
      <br />
      · 设备：端口速率与介质、VLAN、IP 与路由、DHCP / DNS / NAT
      <br />
      · 线缆：类型与长度 —— 它们<strong className="text-slate-400">参与计算</strong>，不是装饰字段
      <br />
      <br />
      <span className="text-slate-600">多选：</span>按住 <kbd className="rounded bg-slate-800 px-1">Shift</kbd>{' '}
      点选多个设备，或在空白处拖动框选。
    </div>
  );
}

/* ────────────────────────────── 端口详情（FR-32） ────────────────────────────── */

function PortInspector({ device, port, world }: { device: Device; port: Port; world: World }) {
  const selection = useApp((s) => s.selection);
  const patchPort = useApp((s) => s.patchPort);
  const patchCable = useApp((s) => s.patchCable);
  const removeCable = useApp((s) => s.removeCable);
  const removePort = useApp((s) => s.removePort);
  const selectPort = useApp((s) => s.selectPort);
  const selectOneDevice = useApp((s) => s.selectOneDevice);
  void selection;

  const link = firstLinkOfPort(world, device.id, port.id);
  const peer = link
    ? link.a.deviceId === device.id && link.a.portId === port.id
      ? link.b
      : link.a
    : undefined;
  const peerDevice = peer ? world.devices.get(peer.deviceId) : undefined;
  const peerPort = peerDevice?.ports.find((item) => item.id === peer?.portId);
  const cableTypeOptions = CABLE_SPECS.map((spec) => ({
    value: spec.type,
    label: spec.alias ? `${spec.label}（俗称 ${spec.alias}）` : spec.label,
  }));

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      <section className="flex flex-col gap-2 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Icon node={portIcon(port.medium)} size={18} className="shrink-0 text-sky-300" />
          <div className="min-w-0">
            <h3 className="truncate text-[12px] font-semibold text-slate-200">
              {device.name} · {port.name}
            </h3>
            <p className="text-[10px] text-slate-500">{PORT_MEDIUM_LABEL[port.medium]}</p>
          </div>
          <button
            type="button"
            onClick={() => selectOneDevice(device.id)}
            className="ml-auto shrink-0 rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-300 hover:border-sky-600 hover:text-sky-300"
          >
            设备详情
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="速率">
            <Select<number>
              value={port.speedMbps}
              options={
                port.medium === 'wifi'
                  ? [{ value: 0, label: '无线（协商）' }]
                  : SPEED_OPTIONS.map((option) => ({
                      value: option.value,
                      label: option.label,
                    }))
              }
              onChange={(speedMbps) => patchPort(device.id, port.id, { speedMbps })}
            />
          </Field>
          <Field label="双工">
            <Select<'full' | 'half'>
              value={port.duplex}
              options={[
                { value: 'full', label: '全双工' },
                { value: 'half', label: '半双工' },
              ]}
              onChange={(duplex) => patchPort(device.id, port.id, { duplex })}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="角色" hint="trunk 口用逗号分隔允许的 VLAN">
            <Select<PortRole>
              value={port.role}
              options={ROLE_OPTIONS}
              onChange={(role) => patchPort(device.id, port.id, { role })}
            />
          </Field>
          <Field label="所在面" hint="机架式设备的两面都可能有端口">
            <Select<PortSide>
              value={port.side ?? 'front'}
              options={[
                { value: 'front', label: '正面' },
                { value: 'rear', label: '背面' },
              ]}
              onChange={(side) => patchPort(device.id, port.id, { side })}
            />
          </Field>
        </div>

        {port.role === 'trunk' ? (
          <Field label="允许的 VLAN">
            <TextInput
              value={(port.allowedVlans ?? []).join(', ')}
              onChange={(value) =>
                patchPort(device.id, port.id, {
                  allowedVlans: value
                    .split(',')
                    .map((item) => Number(item.trim()))
                    .filter((value) => Number.isFinite(value) && value > 0),
                })
              }
            />
          </Field>
        ) : (
          <Field label="VLAN（PVID）">
            <NumberInput
              value={defaultVlanOf(port)}
              min={1}
              max={4094}
              onChange={(vlan) => patchPort(device.id, port.id, { vlan })}
            />
          </Field>
        )}
      </section>

      <section className="flex flex-col gap-2 border-b border-slate-800 pb-3">
        <h3 className="text-[11px] font-semibold tracking-wide text-slate-400">连接情况</h3>
        {link && peerDevice && peerPort ? (
          <>
            <div className="rounded border border-slate-800 bg-slate-950/60 p-2 text-[11px]">
              <div className="font-mono text-slate-200">
                {device.name} {port.name}
                <span className="mx-1 text-slate-500">↔</span>
                {peerDevice.name} {peerPort.name}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span
                  className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{
                    color: link.up ? speedColor(link.speedMbps) : '#fca5a5',
                    border: `1px solid ${link.up ? speedColor(link.speedMbps) : '#fca5a5'}`,
                  }}
                >
                  {link.up ? formatSpeed(link.speedMbps) : '链路不可用'}
                </span>
                <span className="text-[10px] text-slate-500">
                  {link.duplex === 'half' ? '半双工' : '全双工'} ·{' '}
                  {link.family === 'wireless'
                    ? '无线'
                    : link.family === 'fiber'
                      ? '光纤'
                      : '双绞线'}
                </span>
              </div>
            </div>
            <Field label="线缆类型">
              <Select<CableType>
                value={link.cable.type}
                options={cableTypeOptions}
                onChange={(type) => patchCable(link.id, { type })}
              />
            </Field>
            {link.family !== 'wireless' && (
              <Field label="线缆长度（米）">
                <NumberInput
                  value={link.cable.lengthM}
                  min={0}
                  onChange={(lengthM) => patchCable(link.id, { lengthM })}
                />
              </Field>
            )}
            {link.issues.map((issue, index) => (
              <div
                key={`${issue.code}-${index}`}
                className={`rounded border px-2 py-1 text-[10px] leading-snug ${
                  issue.level === 'error'
                    ? 'border-rose-800 bg-rose-500/10 text-rose-200'
                    : 'border-amber-700 bg-amber-500/10 text-amber-200'
                }`}
              >
                {issue.text}
              </div>
            ))}
            <Button variant="danger" onClick={() => removeCable(link.id)}>
              断开这条连线
            </Button>
          </>
        ) : (
          <div className="rounded border border-slate-800 bg-slate-950/60 p-2 text-[10px] leading-snug text-slate-500">
            这个端口没有连接线缆。点顶部「连线」后依次点击两个端口即可接线。
          </div>
        )}
      </section>

      <section className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-semibold tracking-wide text-slate-400">
            该设备的其他端口
          </h3>
          <button
            type="button"
            onClick={() => removePort(device.id, port.id)}
            className="rounded border border-rose-800 px-2 py-0.5 text-[10px] text-rose-300 hover:bg-rose-500/10"
            title="删除该端口（同时移除挂在其上的连线与三层接口）"
          >
            删除此端口
          </button>
        </div>
        <div className="flex flex-wrap gap-1">
          {device.ports.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => selectPort(device.id, item.id)}
              title={`${item.name} · ${PORT_MEDIUM_LABEL[item.medium]}`}
              className={`rounded border px-1.5 py-0.5 text-[10px] ${
                item.id === port.id
                  ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                  : 'border-slate-700 text-slate-400 hover:border-sky-600 hover:text-sky-300'
              }`}
            >
              {item.name}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ────────────────────────────── 添加端口（FR-38） ────────────────────────────── */

const MEDIUM_OPTIONS: { value: PortMedium; label: string }[] = [
  { value: 'rj45', label: 'RJ45 电口' },
  { value: 'sfp', label: 'SFP 光口' },
  { value: 'pon', label: 'PON 口' },
  { value: 'wifi', label: '无线' },
];

function AddPortRow({
  deviceId,
  onAdd,
}: {
  deviceId: string;
  onAdd: (medium: PortMedium, side: PortSide) => void;
}) {
  const [medium, setMedium] = useState<PortMedium>('rj45');
  const [side, setSide] = useState<PortSide>('front');
  void deviceId;

  return (
    <div className="flex items-end gap-1.5 rounded border border-dashed border-slate-700 p-1.5">
      <div className="flex-1">
        <Select<PortMedium>
          value={medium}
          options={MEDIUM_OPTIONS}
          onChange={setMedium}
        />
      </div>
      <div className="w-[74px]">
        <Select<PortSide>
          value={side}
          options={[
            { value: 'front', label: '正面' },
            { value: 'rear', label: '背面' },
          ]}
          onChange={setSide}
        />
      </div>
      <Button onClick={() => onAdd(medium, side)}>+ 添加端口</Button>
    </div>
  );
}

/* ────────────────────────────── 上架 / 机柜（FR-36） ────────────────────────────── */

/**
 * 卡片宽度（FR-49）。
 *
 * 只有**未上架的非机柜设备**可调：上架设备的宽度由机柜决定（19″ 面板宽），
 * 允许改会造成"卡片比导轨还宽"这种自相矛盾的状态。
 */
function CardWidthRow({ device }: { device: Device }) {
  const setDeviceWidth = useApp((s) => s.setDeviceWidth);
  const width = cardWidthOf(device);
  const custom = device.cardWidth !== undefined;

  return (
    <Field
      label="卡片宽度"
      hint={`${MIN_CARD_W}–${MAX_CARD_W}（世界单位）：也可以直接在画布上拖卡片右边缘。宽度只影响观感与端口排布，不参与任何推演`}
    >
      <div className="flex items-center gap-2">
        <NumberInput
          value={width}
          min={MIN_CARD_W}
          max={MAX_CARD_W}
          step={8}
          onChange={(value) => setDeviceWidth(device.id, value)}
        />
        <Button
          variant="default"
          disabled={!custom}
          title="恢复默认卡片宽度"
          onClick={() => setDeviceWidth(device.id, NODE_W)}
        >
          默认
        </Button>
      </div>
    </Field>
  );
}

function RackMountRow({ device, world }: { device: Device; world: World }) {
  const mountDevice = useApp((s) => s.mountDevice);
  const unmountDevice = useApp((s) => s.unmountDevice);
  const setDeviceRackUnits = useApp((s) => s.setDeviceRackUnits);
  const racks = world.ordered.filter((item) => item.kind === 'rack');
  const [rackId, setRackId] = useState(racks[0]?.id ?? '');
  const units = rackUnitsOf(device);

  if (racks.length === 0) {
    return (
      <div className="rounded border border-slate-800 bg-slate-950/60 p-2 text-[10px] leading-snug text-slate-500">
        这是机架式设备。从左侧「机架与容器」拖一个机柜进画布后，把本设备拖到机柜上即可上架；
        也可以在这里选择机柜后点「上架」。
      </div>
    );
  }

  const mounted = device.mount;
  const rack = mounted ? world.devices.get(mounted.rackId) : undefined;

  return (
    <div className="flex flex-col gap-1.5 rounded border border-slate-800 bg-slate-950/60 p-2">
      <span className="text-[11px] font-medium text-slate-400">机柜安装</span>
      <Field
        label="设备高度（U）"
        hint={`${MIN_RACK_UNITS}–${MAX_RACK_UNITS}U：一个设备可以占多个 U，卡片高度与面板宽度会随之变化`}
      >
        <NumberInput
          value={units}
          min={MIN_RACK_UNITS}
          max={MAX_RACK_UNITS}
          onChange={(value) => setDeviceRackUnits(device.id, value)}
        />
      </Field>
      {mounted && rack ? (
        <div className="flex items-center gap-2 text-[11px] text-slate-300">
          <span>
            已装在 <span className="text-sky-300">{rack.name}</span> 第{' '}
            <span className="text-sky-300">
              {mounted.startU}
              {units > 1 ? `–${mounted.startU + units - 1}` : ''}U
            </span>
          </span>
          <Button variant="danger" onClick={() => unmountDevice(device.id)}>
            下架
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <Select<string>
            value={rackId || (racks[0]?.id ?? '')}
            options={racks.map((item) => ({ value: item.id, label: item.name }))}
            onChange={setRackId}
          />
          <Button onClick={() => mountDevice(device.id, rackId || (racks[0]?.id ?? ''))}>
            上架
          </Button>
        </div>
      )}
    </div>
  );
}

function RackInspector({ device, world }: { device: Device; world: World }) {
  const setRackHeight = useApp((s) => s.setRackHeight);
  const flipRack = useApp((s) => s.flipRack);
  const unmountDevice = useApp((s) => s.unmountDevice);
  const patchDevice = useApp((s) => s.patchDevice);

  const heightU = device.rack?.heightU ?? 12;
  const flipped = device.rack?.flipped ?? false;
  const mounted = world.ordered
    .filter((item) => item.mount?.rackId === device.id)
    .sort((a, b) => (a.mount?.startU ?? 0) - (b.mount?.startU ?? 0));
  const usedUnits = mounted.reduce((sum, item) => sum + rackUnitsOf(item), 0);

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      <Section title="机柜">
        <Field label="名称">
          <TextInput
            value={device.name}
            onChange={(name) => patchDevice(device.id, (d) => void (d.name = name))}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="高度（U）"
            hint={`${MIN_RACK_HEIGHT_U}–${MAX_RACK_HEIGHT_U}U，调小会把放不下的设备自动下架`}
          >
            <NumberInput
              value={heightU}
              min={MIN_RACK_HEIGHT_U}
              max={MAX_RACK_HEIGHT_U}
              onChange={(value) => setRackHeight(device.id, value)}
            />
          </Field>
          <Field label="当前观察面">
            <Button onClick={() => flipRack(device.id)} active={flipped}>
              翻转到{flipped ? '正面' : '背面'}
            </Button>
          </Field>
        </div>
        <p className="text-[10px] leading-snug text-slate-500">
          鼠标悬浮在机柜上时机柜会半透明，直接看到另一面的端口；点标题栏右侧的翻转图标按钮切换观察面。
          已用 {usedUnits}/{heightU}U（按各设备占用的 U 数累计）。
        </p>
      </Section>

      <Section title={`柜内设备（${mounted.length}）`}>
        {mounted.length === 0 ? (
          <p className="text-[10px] leading-snug text-slate-500">
            还没有设备上架。把机架式设备（机架服务器 / 交换机 / OLT）拖到机柜上即可。
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {mounted.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-2 rounded border border-slate-800 bg-slate-950/60 px-2 py-1"
              >
                <span className="w-14 shrink-0 font-mono text-[10px] text-sky-300">
                  {item.mount
                    ? `${item.mount.startU}${rackUnitsOf(item) > 1 ? `–${item.mount.startU + rackUnitsOf(item) - 1}` : ''}U`
                    : ''}
                </span>
                <Icon node={deviceIcon(item.kind, item.subtype)} size={13} className="text-slate-400" />
                <button
                  type="button"
                  className="truncate text-[11px] text-slate-300 hover:text-sky-300"
                  onClick={() => useApp.getState().selectOneDevice(item.id)}
                >
                  {item.name}
                </button>
                <button
                  type="button"
                  className="ml-auto shrink-0 text-[10px] text-slate-500 hover:text-rose-400"
                  onClick={() => unmountDevice(item.id)}
                >
                  下架
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

/* ────────────────────────────── 多选操作 ────────────────────────────── */

const ALIGN_BUTTONS: { mode: AlignMode; icon: UiIconName; label: string }[] = [
  { mode: 'left', icon: 'align-left', label: '左对齐' },
  { mode: 'center-x', icon: 'align-center-x', label: '水平居中' },
  { mode: 'right', icon: 'align-right', label: '右对齐' },
  { mode: 'top', icon: 'align-top', label: '顶对齐' },
  { mode: 'center-y', icon: 'align-center-y', label: '垂直居中' },
  { mode: 'bottom', icon: 'align-bottom', label: '底对齐' },
];

function MultiSelectInspector() {
  const world = useApp((s) => s.world);
  const selection = useApp((s) => s.selection);
  const alignSelection = useApp((s) => s.alignSelection);
  const distributeSelection = useApp((s) => s.distributeSelection);
  const deleteSelection = useApp((s) => s.deleteSelection);
  const selectManyDevices = useApp((s) => s.selectManyDevices);

  const devices = world.ordered.filter((device) => selection.devices.includes(device.id));

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      <section className="flex flex-col gap-2">
        <div>
          <h3 className="text-[11px] font-semibold tracking-wide text-slate-400">
            已选 {devices.length} 台设备
          </h3>
          <p className="mt-0.5 text-[10px] leading-snug text-slate-600">
            对齐与分布以当前选区包围盒为基准；拖动其中任意一台会带动全部选中设备一起移动。
          </p>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {ALIGN_BUTTONS.map((item) => (
            <button
              key={item.mode}
              type="button"
              onClick={() => alignSelection(item.mode)}
              title={item.label}
              className="flex flex-col items-center gap-1 rounded-md border border-slate-700 bg-slate-950/60 px-1 py-2 text-[10px] text-slate-300 transition hover:border-sky-600 hover:text-sky-300"
            >
              <Icon node={uiIcon(item.icon)} size={15} />
              {item.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => distributeSelection('horizontal')}
            title="水平等距分布（首尾不动，中间平分间隙）"
            className="flex items-center justify-center gap-1.5 rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-[10px] text-slate-300 transition hover:border-sky-600 hover:text-sky-300"
          >
            <Icon node={uiIcon('distribute-x')} size={14} />
            水平等距
          </button>
          <button
            type="button"
            onClick={() => distributeSelection('vertical')}
            title="垂直等距分布（首尾不动，中间平分间隙）"
            className="flex items-center justify-center gap-1.5 rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1.5 text-[10px] text-slate-300 transition hover:border-sky-600 hover:text-sky-300"
          >
            <Icon node={uiIcon('distribute-y')} size={14} />
            垂直等距
          </button>
        </div>

        <div className="flex gap-1.5">
          <Button onClick={() => selectManyDevices(world.ordered.map((d) => d.id))}>全选设备</Button>
          <Button variant="danger" onClick={deleteSelection}>
            删除选中的 {devices.length} 台
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-1 border-t border-slate-800 pt-3">
        <h3 className="text-[11px] font-semibold tracking-wide text-slate-400">选中清单</h3>
        <ul className="flex flex-col gap-0.5">
          {devices.map((device) => (
            <li key={device.id} className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Icon node={deviceIcon(device.kind, device.subtype)} size={13} className="text-slate-500" />
              <span className="truncate">{device.name}</span>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-slate-600">
                {device.x},{device.y}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ────────────────────────────── 设备 ────────────────────────────── */

function DeviceInspector({ device, world }: { device: Device; world: World }) {
  const patchDevice = useApp((s) => s.patchDevice);
  const patchPort = useApp((s) => s.patchPort);
  const cableTypeLabel = useApp((s) => s.cableDefaults.type);

  const lease = world.leases.get(device.id);
  const addresses = world.addresses.get(device.id) ?? [];
  const addPort = useApp((s) => s.addPort);
  const rackable = isRackable(device);

  const isGateway = device.kind === 'ont' || device.kind === 'router';

  // 这台设备所在广播域里的二层环路：风暴会波及整个域，不只是环上的设备
  const affectedLoops = world.loops.filter((loop) => loop.affected.has(device.id));

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      {affectedLoops.length > 0 && (
        <section className="flex flex-col gap-1 rounded border border-amber-700 bg-amber-500/10 p-2 text-[10px] leading-snug text-amber-200">
          <div className="text-[11px] font-semibold">
            所在广播域有 {affectedLoops.length} 处二层环路（VLAN{' '}
            {[...new Set(affectedLoops.map((loop) => loop.vlan))].join('、')}）
          </div>
          <ul className="flex flex-col gap-0.5">
            {affectedLoops.map((loop) => (
              <li key={`${loop.vlan}-${loop.linkIds.join(',')}`} className="font-mono text-amber-100/90">
                {loop.label}
              </li>
            ))}
          </ul>
          <div>
            以太网帧没有 TTL：广播帧会沿环无限循环（广播风暴），环内最慢的一段{' '}
            {formatSpeed(Math.min(...affectedLoops.map((loop) => loop.slowestMbps)))} 会先被打满，
            该域内 {Math.max(...affectedLoops.map((loop) => loop.affected.size))} 台设备一起受影响。
            修法：把并联的线缆做成「链路聚合」（选中其中一根线缆即可勾选），或拆掉多余的那一根。
          </div>
        </section>
      )}

      {/* 基本信息 */}
      <Section title="基本信息">
        <Field label="名称">
          <TextInput
            value={device.name}
            onChange={(name) => patchDevice(device.id, (d) => void (d.name = name))}
          />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <ReadOnly label="类型" value={DEVICE_KIND_LABEL[device.kind]} />
          <ReadOnly
            label="子类型"
            value={device.subtype ? DEVICE_SUBTYPE_LABEL[device.subtype] : '—'}
          />
        </div>
        <ReadOnly label="型号" value={device.model ?? '—'} />
        {isGateway && (
          <Field label="工作模式" hint="桥接模式下本机不做 NAT/DHCP，相当于透明网桥（D-17）">
            <Select<AccessMode>
              value={device.accessMode ?? 'route'}
              options={[
                { value: 'route', label: '路由模式（自己做 NAT/DHCP）' },
                { value: 'bridge', label: '桥接模式（仅透传）' },
              ]}
              onChange={(accessMode) =>
                patchDevice(device.id, (d) => {
                  d.accessMode = accessMode;
                  if (accessMode === 'bridge') d.services.nat = false;
                })
              }
            />
          </Field>
        )}
      </Section>

      {/* 端口 */}
      <Section
        title={`端口（${device.ports.length}）`}
        hint="速率决定协商上限；角色决定 VLAN 行为；线缆能力不足时会降速并在诊断中说明"
      >
        <div className="flex flex-col gap-1.5">
          {device.ports.map((port) => (
            <PortRow
              key={port.id}
              world={world}
              deviceId={device.id}
              port={port}
              onPatch={(patch) => patchPort(device.id, port.id, patch)}
            />
          ))}
        </div>
        <AddPortRow deviceId={device.id} onAdd={(medium, side) => addPort(device.id, { medium, side })} />
      </Section>

      {rackable && <RackMountRow device={device} world={world} />}
      {device.kind !== 'rack' && !device.mount && <CardWidthRow device={device} />}

      {/* 地址 */}
      <Section title="地址与路由">
        <div className="flex flex-col gap-1">
          {device.l3.interfaces.map((itf) => (
            <div key={itf.id} className="grid grid-cols-[1fr_1.2fr_52px_24px] items-center gap-1">
              <select
                className="rounded border border-slate-700 bg-slate-950 px-1 py-1 text-[10px] text-slate-200"
                value={itf.portId}
                onChange={(event) =>
                  patchDevice(device.id, (d) => {
                    const target = d.l3.interfaces.find((i) => i.id === itf.id);
                    if (target) target.portId = event.target.value;
                  })
                }
              >
                {device.ports.map((port) => (
                  <option key={port.id} value={port.id}>
                    {port.name}
                  </option>
                ))}
              </select>
              <input
                className="rounded border border-slate-700 bg-slate-950 px-1.5 py-1 font-mono text-[10px] text-slate-100"
                value={itf.ip}
                onChange={(event) =>
                  patchDevice(device.id, (d) => {
                    const target = d.l3.interfaces.find((i) => i.id === itf.id);
                    if (target) target.ip = event.target.value;
                  })
                }
              />
              <input
                type="number"
                min={0}
                max={32}
                className="rounded border border-slate-700 bg-slate-950 px-1 py-1 text-[10px] text-slate-100"
                value={itf.prefix}
                onChange={(event) =>
                  patchDevice(device.id, (d) => {
                    const target = d.l3.interfaces.find((i) => i.id === itf.id);
                    if (target) target.prefix = Number(event.target.value);
                  })
                }
              />
              <button
                type="button"
                className="text-slate-500 hover:text-rose-400"
                title="删除该接口"
                onClick={() =>
                  patchDevice(device.id, (d) => {
                    d.l3.interfaces = d.l3.interfaces.filter((i) => i.id !== itf.id);
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
          <Button
            onClick={() =>
              patchDevice(device.id, (d) => {
                const free = d.ports[0];
                if (!free) return;
                d.l3.interfaces.push({
                  id: `l3-${Date.now().toString(36)}`,
                  portId: free.id,
                  ip: '192.168.1.1',
                  prefix: 24,
                });
              })
            }
          >
            + 添加接口
          </Button>
        </div>

        <Field label="默认网关" hint="与“默认路由”等价；需与某个接口同网段才能生效">
          <TextInput
            value={device.l3.defaultGateway ?? ''}
            placeholder="留空表示无默认路由"
            onChange={(value) =>
              patchDevice(device.id, (d) => {
                d.l3.defaultGateway = value.trim() === '' ? undefined : value;
              })
            }
          />
        </Field>

        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-slate-400">静态路由</span>
          {device.l3.staticRoutes.map((route) => (
            <div key={route.id} className="grid grid-cols-[1.2fr_52px_1.2fr_24px] items-center gap-1">
              <input
                className="rounded border border-slate-700 bg-slate-950 px-1.5 py-1 font-mono text-[10px] text-slate-100"
                value={route.dst}
                onChange={(event) =>
                  patchDevice(device.id, (d) => {
                    const target = d.l3.staticRoutes.find((r) => r.id === route.id);
                    if (target) target.dst = event.target.value;
                  })
                }
              />
              <input
                type="number"
                min={0}
                max={32}
                className="rounded border border-slate-700 bg-slate-950 px-1 py-1 text-[10px] text-slate-100"
                value={route.prefix}
                onChange={(event) =>
                  patchDevice(device.id, (d) => {
                    const target = d.l3.staticRoutes.find((r) => r.id === route.id);
                    if (target) target.prefix = Number(event.target.value);
                  })
                }
              />
              <input
                className="rounded border border-slate-700 bg-slate-950 px-1.5 py-1 font-mono text-[10px] text-slate-100"
                value={route.nextHop}
                onChange={(event) =>
                  patchDevice(device.id, (d) => {
                    const target = d.l3.staticRoutes.find((r) => r.id === route.id);
                    if (target) target.nextHop = event.target.value;
                  })
                }
              />
              <button
                type="button"
                className="text-slate-500 hover:text-rose-400"
                onClick={() =>
                  patchDevice(device.id, (d) => {
                    d.l3.staticRoutes = d.l3.staticRoutes.filter((r) => r.id !== route.id);
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
          <Button
            onClick={() =>
              patchDevice(device.id, (d) => {
                d.l3.staticRoutes.push({
                  id: `rt-${Date.now().toString(36)}`,
                  dst: '10.0.0.0',
                  prefix: 8,
                  nextHop: '192.168.1.1',
                });
              })
            }
          >
            + 添加静态路由
          </Button>
        </div>

        <div className="rounded border border-slate-800 bg-slate-950/60 p-2">
          <div className="mb-1 text-[10px] font-semibold text-slate-500">推演得到的地址</div>
          {addresses.length === 0 ? (
            <div className="text-[10px] text-slate-500">
              {lease?.failure ? (
                <span className="text-rose-300">{lease.detail}</span>
              ) : (
                '没有地址'
              )}
            </div>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {addresses.map((address) => (
                <li key={address.ip} className="font-mono text-[10px] text-slate-300">
                  {address.ip}/{address.prefix}
                  <span className="ml-1 font-sans text-slate-500">
                    {address.source === 'dhcp' ? '（DHCP）' : '（静态）'}
                    {address.gateway ? ` 网关 ${address.gateway}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      {/* 客户端地址 */}
      {device.client && (
        <Section title="客户端地址">
          <Select<'dhcp' | 'static'>
            value={device.client.mode}
            options={[
              { value: 'dhcp', label: 'DHCP 自动获取' },
              { value: 'static', label: '静态配置' },
            ]}
            onChange={(mode) =>
              patchDevice(device.id, (d) => {
                if (d.client) d.client.mode = mode;
              })
            }
          />
          {device.client.mode === 'static' && (
            <>
              <div className="grid grid-cols-[1.4fr_60px] gap-2">
                <Field label="IP 地址">
                  <TextInput
                    value={device.client.ip ?? ''}
                    onChange={(ip) =>
                      patchDevice(device.id, (d) => {
                        if (d.client) d.client.ip = ip;
                      })
                    }
                  />
                </Field>
                <Field label="前缀">
                  <NumberInput
                    value={device.client.prefix ?? 24}
                    min={0}
                    max={32}
                    onChange={(prefix) =>
                      patchDevice(device.id, (d) => {
                        if (d.client) d.client.prefix = prefix;
                      })
                    }
                  />
                </Field>
              </div>
              <Field label="网关">
                <TextInput
                  value={device.client.gateway ?? ''}
                  onChange={(gateway) =>
                    patchDevice(device.id, (d) => {
                      if (d.client) d.client.gateway = gateway;
                    })
                  }
                />
              </Field>
              <Field label="DNS 服务器（逗号分隔）">
                <TextInput
                  value={device.client.dns.join(', ')}
                  onChange={(value) =>
                    patchDevice(device.id, (d) => {
                      if (d.client)
                        d.client.dns = value
                          .split(',')
                          .map((item) => item.trim())
                          .filter(Boolean);
                    })
                  }
                />
              </Field>
            </>
          )}
        </Section>
      )}

      {/* 服务 */}
      <Section title="服务">
        <Checkbox
          checked={device.services.nat === true}
          label="启用 NAT（源地址转换）"
          onChange={(nat) =>
            patchDevice(device.id, (d) => {
              d.services.nat = nat;
            })
          }
        />

        <div className="rounded border border-slate-800 p-2">
          <Checkbox
            checked={device.services.dhcp?.enabled === true}
            label="本机作为 DHCP 服务器"
            onChange={(enabled) =>
              patchDevice(device.id, (d) => {
                d.services.dhcp = d.services.dhcp
                  ? { ...d.services.dhcp, enabled }
                  : {
                      enabled,
                      poolStart: '192.168.1.100',
                      poolEnd: '192.168.1.200',
                      gateway: '192.168.1.1',
                      dns: ['192.168.1.1'],
                    };
              })
            }
          />
          {device.services.dhcp?.enabled && (
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <Field label="地址池起">
                <TextInput
                  value={device.services.dhcp.poolStart}
                  onChange={(poolStart) =>
                    patchDevice(device.id, (d) => {
                      if (d.services.dhcp) d.services.dhcp.poolStart = poolStart;
                    })
                  }
                />
              </Field>
              <Field label="地址池止">
                <TextInput
                  value={device.services.dhcp.poolEnd}
                  onChange={(poolEnd) =>
                    patchDevice(device.id, (d) => {
                      if (d.services.dhcp) d.services.dhcp.poolEnd = poolEnd;
                    })
                  }
                />
              </Field>
              <Field label="下发网关">
                <TextInput
                  value={device.services.dhcp.gateway}
                  onChange={(gateway) =>
                    patchDevice(device.id, (d) => {
                      if (d.services.dhcp) d.services.dhcp.gateway = gateway;
                    })
                  }
                />
              </Field>
              <Field label="下发 DNS">
                <TextInput
                  value={device.services.dhcp.dns.join(', ')}
                  onChange={(value) =>
                    patchDevice(device.id, (d) => {
                      if (d.services.dhcp)
                        d.services.dhcp.dns = value
                          .split(',')
                          .map((item) => item.trim())
                          .filter(Boolean);
                    })
                  }
                />
              </Field>
            </div>
          )}
        </div>

        <div className="rounded border border-slate-800 p-2">
          <Checkbox
            checked={device.services.dns?.enabled === true}
            label="本机作为 DNS 服务器"
            onChange={(enabled) =>
              patchDevice(device.id, (d) => {
                d.services.dns = d.services.dns
                  ? { ...d.services.dns, enabled }
                  : { enabled, records: [], forwarders: [] };
              })
            }
          />
          {device.services.dns?.enabled && (
            <>
              <Field label="上游 DNS / 转发器（逗号分隔）" hint="留空表示本机是权威服务器">
                <TextInput
                  value={device.services.dns.forwarders.join(', ')}
                  onChange={(value) =>
                    patchDevice(device.id, (d) => {
                      if (d.services.dns)
                        d.services.dns.forwarders = value
                          .split(',')
                          .map((item) => item.trim())
                          .filter(Boolean);
                    })
                  }
                />
              </Field>
              <div className="mt-1 flex flex-col gap-1">
                {device.services.dns.records.map((record) => (
                  <div key={record.id} className="grid grid-cols-[1.3fr_1fr_24px] gap-1">
                    <input
                      className="rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-[10px] text-slate-100"
                      value={record.name}
                      onChange={(event) =>
                        patchDevice(device.id, (d) => {
                          const target = d.services.dns?.records.find((r) => r.id === record.id);
                          if (target) target.name = event.target.value;
                        })
                      }
                    />
                    <input
                      className="rounded border border-slate-700 bg-slate-950 px-1.5 py-1 font-mono text-[10px] text-slate-100"
                      value={record.ip}
                      onChange={(event) =>
                        patchDevice(device.id, (d) => {
                          const target = d.services.dns?.records.find((r) => r.id === record.id);
                          if (target) target.ip = event.target.value;
                        })
                      }
                    />
                    <button
                      type="button"
                      className="text-slate-500 hover:text-rose-400"
                      onClick={() =>
                        patchDevice(device.id, (d) => {
                          if (d.services.dns)
                            d.services.dns.records = d.services.dns.records.filter(
                              (r) => r.id !== record.id,
                            );
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
                <Button
                  onClick={() =>
                    patchDevice(device.id, (d) => {
                      if (!d.services.dns) d.services.dns = { enabled: true, records: [], forwarders: [] };
                      d.services.dns.records.push({
                        id: `rec-${Date.now().toString(36)}`,
                        name: 'new.example.com',
                        ip: '192.168.1.10',
                      });
                    })
                  }
                >
                  + 添加域名记录
                </Button>
              </div>
            </>
          )}
        </div>
      </Section>

      {/* 无线 */}
      {device.ports.some((port) => port.medium === 'wifi') && (
        <Section title="无线">
          <div className="grid grid-cols-2 gap-2">
            <Field label="角色">
              <Select<'ap' | 'sta'>
                value={device.wireless?.mode ?? 'sta'}
                options={[
                  { value: 'ap', label: 'AP（提供接入）' },
                  { value: 'sta', label: '客户端（关联）' },
                ]}
                onChange={(mode) =>
                  patchDevice(device.id, (d) => {
                    d.wireless = { ...(d.wireless ?? { mode }), mode };
                  })
                }
              />
            </Field>
            <Field label="标准">
              <Select<WifiStandard>
                value={device.wireless?.standard ?? '802.11ax'}
                options={[
                  { value: '802.11n', label: '802.11n' },
                  { value: '802.11ac', label: '802.11ac' },
                  { value: '802.11ax', label: '802.11ax (WiFi 6)' },
                  { value: '802.11be', label: '802.11be (WiFi 7)' },
                ]}
                onChange={(standard) =>
                  patchDevice(device.id, (d) => {
                    d.wireless = { ...(d.wireless ?? { mode: 'sta' }), standard };
                  })
                }
              />
            </Field>
          </div>
          <Field label="SSID" hint="STA 与 AP 的 SSID 必须完全一致（大小写敏感），否则链路不可用">
            <TextInput
              value={device.wireless?.ssid ?? ''}
              onChange={(ssid) =>
                patchDevice(device.id, (d) => {
                  d.wireless = { ...(d.wireless ?? { mode: 'sta' }), ssid };
                })
              }
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="频段">
              <Select<WifiBand>
                value={device.wireless?.band ?? '5G'}
                options={[
                  { value: '2.4G', label: '2.4 GHz' },
                  { value: '5G', label: '5 GHz' },
                  { value: '6G', label: '6 GHz' },
                ]}
                onChange={(band) =>
                  patchDevice(device.id, (d) => {
                    d.wireless = { ...(d.wireless ?? { mode: 'sta' }), band };
                  })
                }
              />
            </Field>
            <Field label="信道">
              <NumberInput
                value={device.wireless?.channel ?? 36}
                min={1}
                max={233}
                onChange={(channel) =>
                  patchDevice(device.id, (d) => {
                    d.wireless = { ...(d.wireless ?? { mode: 'sta' }), channel };
                  })
                }
              />
            </Field>
          </div>
        </Section>
      )}

      <p className="text-[10px] leading-snug text-slate-600">
        当前待用线缆：{cableLabel(cableTypeLabel)}（在顶部工具栏切换）。端口仅展示介质与速率，
        线缆类别与长度在选中线缆后编辑。
      </p>
    </div>
  );
}

function PortRow({
  world,
  deviceId,
  port,
  onPatch,
}: {
  world: World;
  deviceId: string;
  port: Port;
  onPatch: (patch: Partial<Port>) => void;
}) {
  const link = firstLinkOfPort(world, deviceId, port.id);
  const cableType = link ? (link.cable.type as CableType) : null;

  const selectPort = useApp((s) => s.selectPort);

  return (
    <div
      className="rounded border border-slate-800 bg-slate-950/50 p-1.5 transition hover:border-slate-700"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          title="点击编辑该端口详情"
          onClick={() => selectPort(deviceId, port.id)}
          className="shrink-0 text-slate-400 hover:text-sky-300"
        >
          <Icon node={portIcon(port.medium)} size={13} />
        </button>
        <button
          type="button"
          onClick={() => selectPort(deviceId, port.id)}
          className="w-16 shrink-0 text-left text-[11px] font-medium text-slate-200 hover:text-sky-300"
        >
          {port.name}
        </button>
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] text-slate-400">
          {PORT_MEDIUM_LABEL[port.medium]}
        </span>
        {cableType && (
          <span className="truncate text-[9px] text-slate-500">
            {cableLabel(cableType)} · {link?.cable.lengthM} m
          </span>
        )}
        {link && (
          <span
            className={`ml-auto shrink-0 text-[9px] font-semibold ${
              link.up ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {link.up ? formatSpeed(link.speedMbps) : '不可用'}
          </span>
        )}
        {!link && <span className="ml-auto shrink-0 text-[9px] text-slate-600">未连接</span>}
      </div>

      <div className="mt-1 grid grid-cols-3 gap-1">
        <select
          className="rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[10px] text-slate-200"
          value={port.speedMbps}
          onChange={(event) => onPatch({ speedMbps: Number(event.target.value) })}
        >
          {SPEED_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          className="rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[10px] text-slate-200"
          value={port.role}
          onChange={(event) => onPatch({ role: event.target.value as PortRole })}
        >
          {ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {port.role === 'trunk' ? (
          <input
            className="rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[10px] text-slate-100"
            value={(port.allowedVlans ?? []).join(',')}
            title="允许通过的 VLAN（逗号分隔）"
            onChange={(event) =>
              onPatch({
                allowedVlans: event.target.value
                  .split(',')
                  .map((item) => Number(item.trim()))
                  .filter((value) => Number.isFinite(value) && value > 0),
              })
            }
          />
        ) : (
          <input
            type="number"
            min={1}
            max={4094}
            className="rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[10px] text-slate-100"
            value={defaultVlanOf(port)}
            title="VLAN ID（PVID）"
            onChange={(event) => onPatch({ vlan: Number(event.target.value) })}
          />
        )}
      </div>

      {port.medium !== 'wifi' && port.role !== 'trunk' && (
        <div className="mt-0.5 text-[9px] text-slate-600">
          承载 VLAN {defaultVlanOf(port)}
          {portCarriesVlan(port, defaultVlanOf(port)) ? '' : '（配置异常）'}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────── 线缆 ────────────────────────────── */

function CableInspector({ linkId, world }: { linkId: string; world: World }) {
  const patchCable = useApp((s) => s.patchCable);
  const setBonded = useApp((s) => s.setBonded);
  const link = world.links.find((l) => l.id === linkId);
  if (!link) return null;

  const deviceA = world.devices.get(link.a.deviceId);
  const deviceB = world.devices.get(link.b.deviceId);
  const spec = cableSpec(link.cable.type);
  const ratio = clampLabelRatio(link.cable.labelRatio);

  /*
   * 同一对设备之间的所有线缆（聚合是"一对设备之间的组"，不是单根线的属性）。
   * 只有 ≥2 根时聚合开关才有意义，也只有这时它才能把"双上行"从"环路"里救出来。
   */
  const siblings = world.links.filter((candidate) => {
    const ends = [candidate.a.deviceId, candidate.b.deviceId].sort().join('→');
    return ends === [link.a.deviceId, link.b.deviceId].sort().join('→');
  });
  const bondable = spec.family !== 'wireless' && siblings.length > 1;
  const peerName = deviceB && deviceB.id !== deviceA?.id ? deviceB.name : `${deviceA?.name ?? ''} 自身`;

  const typeOptions = CABLE_SPECS.map((candidate) => ({
    value: candidate.type,
    label: candidate.alias ? `${candidate.label}（俗称 ${candidate.alias}）` : candidate.label,
  }));

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      <Section title="链路两端">
        <div className="rounded border border-slate-800 bg-slate-950/60 p-2 font-mono text-[11px] text-slate-300">
          {deviceA?.name} {link.a.port.name}
          <span className="mx-1 text-slate-500">↔</span>
          {deviceB?.name} {link.b.port.name}
        </div>
        <div className="text-[10px] leading-snug text-slate-500">
          端口介质：{PORT_MEDIUM_LABEL[link.a.port.medium]} / {PORT_MEDIUM_LABEL[link.b.port.medium]}
        </div>
      </Section>

      <Section title="线缆参数">
        <Select<CableType>
          value={link.cable.type}
          options={typeOptions}
          onChange={(type) => patchCable(link.id, { type })}
        />
        {spec.family !== 'wireless' && (
          <Field label="长度（米）" hint={spec.note}>
            <NumberInput
              value={link.cable.lengthM}
              min={0}
              step={1}
              onChange={(lengthM) => patchCable(link.id, { lengthM })}
            />
          </Field>
        )}
        <div className="text-[10px] text-slate-500">
          标准：{spec.standard} · 长度上限 {spec.maxLengthM} m
          {spec.alias ? ` · 实际标准名为 ${spec.label}，「${spec.alias}」是市面俗称` : ''}
        </div>
      </Section>

      <Section
        title="链路聚合（LACP）"
        hint="并联的两根线是「冗余带宽」还是「二层环路」，区别只在于做没做聚合"
      >
        <Checkbox
          checked={Boolean(link.cable.bonded)}
          disabled={!bondable}
          onChange={(bonded) => setBonded(link.id, bonded)}
          label={
            bondable
              ? `与${peerName}之间的 ${siblings.length} 根线做链路聚合`
              : '同一对设备之间只有一根线，聚合没有意义'
          }
          title={
            bondable
              ? '勾上后这几根线在推演里算作一条逻辑链路：不再判成二层环路（真机上就是 LACP / 静态聚合）'
              : '链路聚合至少要两根成员线缆'
          }
        />
        <div className="text-[10px] leading-snug text-slate-500">
          {bondable
            ? '勾上之后：拓扑上视为「一条」链路，因此不再形成二层环路；' +
              '速率仍按单根计算（带宽叠加不在 M0 范围内，见 D-50）。'
            : '要把双上行变成"冗余带宽"而不是"环路"，就得有两根以上的线缆并标为聚合。'}
        </div>
      </Section>

      <Section title="标签位置（纯展示）">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-400">
            {ratio === DEFAULT_LABEL_RATIO
              ? '连线中点（默认）'
              : `${linkDirection(ratio)}侧 ${Math.round(ratio * 100)}%`}
          </span>
          <Button
            variant="default"
            disabled={ratio === DEFAULT_LABEL_RATIO}
            title="把速率标签移回连线中点"
            onClick={() => patchCable(link.id, { labelRatio: DEFAULT_LABEL_RATIO })}
          >
            <span className="flex items-center gap-1">
              <Icon node={uiIcon('undo')} size={12} />
              复位
            </span>
          </Button>
        </div>
        <div className="text-[10px] leading-snug text-slate-500">
          直接拖动画布上的速率标签即可沿连线移动（双击标签也能复位）。
          位置按连线弧长比例保存 —— 缩放、移动设备之后仍贴着同一条线；不影响任何推演结果。
        </div>
      </Section>

      <Section title="协商结果（派生，不可直接编辑）">
        <div className="rounded border border-slate-800 bg-slate-950/60 p-2">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] text-slate-400">链路状态</span>
            <span
              className={`text-[11px] font-semibold ${link.up ? 'text-emerald-400' : 'text-rose-400'}`}
            >
              {link.up ? '可用' : '不可用'}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-[11px] text-slate-400">协商速率</span>
            <span className="font-mono text-[11px] text-slate-200">
              {link.up ? formatSpeed(link.speedMbps) : '—'}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-[11px] text-slate-400">双工</span>
            <span className="font-mono text-[11px] text-slate-200">
              {link.duplex === 'half' ? '半双工' : '全双工'}
            </span>
          </div>
        </div>

        {link.issues.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {link.issues.map((issue, index) => (
              <li
                key={`${issue.code}-${index}`}
                className={`rounded border px-2 py-1 text-[10px] leading-snug ${
                  issue.level === 'error'
                    ? 'border-rose-800 bg-rose-500/10 text-rose-200'
                    : 'border-amber-700 bg-amber-500/10 text-amber-200'
                }`}
              >
                {issue.text}
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded border border-emerald-900 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300">
            两端端口能力与线缆能力匹配，按标称速率协商。
          </div>
        )}
      </Section>
    </div>
  );
}

/* ────────────────────────────── 小组件 ────────────────────────────── */

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 border-b border-slate-800 pb-3 last:border-b-0">
      <div>
        <h3 className="text-[11px] font-semibold tracking-wide text-slate-400">{title}</h3>
        {hint && <p className="mt-0.5 text-[10px] leading-snug text-slate-600">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * 标签偏向哪一端（用于面板上的文字说明）。
 * 比例是沿 A→B 的弧长，所以 <0.5 就是"靠 A 端"。
 */
function linkDirection(ratio: number): string {
  return ratio < DEFAULT_LABEL_RATIO ? 'A（起）' : 'B（终）';
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-slate-400">{label}</span>
      <span className="rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1.5 text-[11px] text-slate-400">
        {value}
      </span>
    </div>
  );
}

/** 供外部（如画布状态栏）复用的地址摘要 */
export function useAddressSummary(deviceId: string): string {
  const world = useApp((s) => s.world);
  return useMemo(() => {
    const address = world.addresses.get(deviceId)?.[0];
    return address ? `${address.ip}/${address.prefix}` : '无地址';
  }, [world, deviceId]);
}
