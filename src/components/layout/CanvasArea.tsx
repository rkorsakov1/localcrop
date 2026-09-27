import type { KeyboardEvent } from 'react';
import {
  adaptCropToAspect,
  COMMON_RATIOS,
  computeAutoCrop,
  describeRatio,
  resolveOutputGeometry,
  rotateTransform,
  targetAspect,
  transformedSize,
} from '../../lib/cropMath';
import { cn } from '../../lib/cn';
import { formatBytes } from '../../lib/format';
import type { Preset, QueueItem } from '../../lib/types';
import type { PreviewReference } from '../../hooks/useDebouncedEncode';
import { getItemPreset, type Mode } from '../../state/appReducer';
import { useApp } from '../../state/AppContext';
import { CropEditor } from '../crop/CropEditor';
import { EmptyDropZone } from '../input/DropZone';
import { CompareView } from '../preview/CompareView';
import { BackgroundPanel } from '../retouch/BackgroundPanel';
import { RetouchPanel } from '../retouch/RetouchPanel';
import { Button, focusRing, Keycap } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Stage, Toolbar, ToolbarDivider } from './Stage';
import { useT } from '../../i18n/useT';

export const MODES: { mode: Mode; key: string }[] = [
  { mode: 'crop', key: 'C' },
  { mode: 'retouch', key: 'E' },
  { mode: 'background', key: 'B' },
  { mode: 'compare', key: 'V' },
];

const ModeTabs = ({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) => {
  const t = useT();
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const index = MODES.findIndex((entry) => entry.mode === mode);
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const next = MODES[(index + offset + MODES.length) % MODES.length];
    if (!next) return;
    onChange(next.mode);
    document.getElementById(`tab-${next.mode}`)?.focus();
  };

  return (
    <div role="tablist" aria-label={t.modes.label} className="inline-flex shrink-0 rounded-[9px] bg-sunken p-0.75" onKeyDown={handleKeyDown}>
      {MODES.map((entry) => {
        const selected = entry.mode === mode;
        return (
          <button
            key={entry.mode}
            id={`tab-${entry.mode}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls="editor-panel"
            aria-keyshortcuts={entry.key}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(entry.mode)}
            className={cn('flex h-7.5 items-center gap-2 rounded-[7px] px-2.5 text-[13px] max-lg:h-10 max-lg:px-3', focusRing, {
              'bg-raised font-semibold text-ink ring-1 ring-line-strong': selected,
              'text-ink-2 hover:text-ink': !selected,
            })}
          >
            {t.modes[entry.mode]}
            <Keycap className="max-lg:hidden">{entry.key}</Keycap>
          </button>
        );
      })}
    </div>
  );
};

export const UndoRedo = () => {
  const { state, dispatch } = useApp();
  const t = useT();
  return (
    <div className="flex shrink-0 items-center">
      <Button
        variant="ghost"
        size="icon"
        disabled={state.history.past.length === 0}
        onClick={() => dispatch({ type: 'undo' })}
        aria-label={t.history.undo}
        aria-keyshortcuts="Control+Z Meta+Z"
        title={t.history.undoTitle}
      >
        <Icon name="undo" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        disabled={state.history.future.length === 0}
        onClick={() => dispatch({ type: 'redo' })}
        aria-label={t.history.redo}
        aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
        title={t.history.redoTitle}
      >
        <Icon name="redo" />
      </Button>
    </div>
  );
};

/** Free crop: reshapes the box to a named ratio around its center. Shift+drag then keeps it. */
const RatioSelect = ({ onPick, imageRatio }: { onPick: (ratio: number) => void; imageRatio: number }) => {
  const t = useT();
  const ratios = COMMON_RATIOS.flatMap(([a, b]) => (a === b ? [[a, b]] : [[a, b], [b, a]]));
  return (
    <span className="relative ml-1 shrink-0">
      <select
        aria-label={t.crop.ratio}
        title={t.crop.ratioTitle}
        value=""
        onChange={(event) => {
          const value = event.target.value;
          if (!value) return;
          const [a = 1, b = 1] = value.split(':').map(Number);
          onPick(value === 'original' ? imageRatio : a / b);
        }}
        className={cn(
          'h-7.5 max-w-36 appearance-none rounded-md bg-transparent pr-7 pl-2.5 text-[13px] field-sizing-content font-medium text-ink-2 hover:bg-sunken hover:text-ink max-lg:h-10',
          focusRing,
        )}
      >
        <option value="" disabled>
          {t.crop.ratio}
        </option>
        <option value="original">{t.crop.originalRatio(describeRatio(imageRatio, 1))}</option>
        {ratios.map(([a, b]) => (
          <option key={`${a}:${b}`} value={`${a}:${b}`}>
            {a}:{b}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-ink-3" />
    </span>
  );
};

const CropToolbar = ({ item, preset }: { item: QueueItem; preset: Preset }) => {
  const { state, dispatch } = useApp();
  const t = useT();
  const bitmap = item.editedBitmap ?? item.sourceBitmap;
  const image = transformedSize(bitmap, item.transform.rotation);
  const geometry = resolveOutputGeometry(image, item.crop, preset);
  const crop = item.crop ?? computeAutoCrop(image, targetAspect(preset));
  const contain = preset.fit === 'contain' && preset.width !== null && preset.height !== null;
  const free = targetAspect(preset) === null && !contain;
  const setTransform = (transform: QueueItem['transform']) => dispatch({ type: 'setTransform', id: item.id, transform });

  return (
    <Toolbar label={t.crop.tools}>
      <Button variant="ghost" size="icon" aria-label={t.crop.rotateLeft} title={t.crop.rotateLeftTitle} onClick={() => setTransform(rotateTransform(item.transform, 'left'))}>
        <Icon name="rotateLeft" />
      </Button>
      <Button variant="ghost" size="icon" aria-label={t.crop.rotateRight} title={t.crop.rotateRightTitle} onClick={() => setTransform(rotateTransform(item.transform, 'right'))}>
        <Icon name="rotateRight" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t.crop.flipH}
        title={t.crop.flipH}
        pressed={item.transform.flipH}
        onClick={() => setTransform({ ...item.transform, flipH: !item.transform.flipH })}
      >
        <Icon name="flipH" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t.crop.flipV}
        title={t.crop.flipV}
        pressed={item.transform.flipV}
        onClick={() => setTransform({ ...item.transform, flipV: !item.transform.flipV })}
      >
        <Icon name="flipV" />
      </Button>
      <ToolbarDivider />
      <Button
        variant="ghost"
        size="icon"
        aria-label={t.crop.thirds}
        title={t.crop.thirdsTitle}
        pressed={state.prefs.showThirds}
        disabled={contain}
        onClick={() => dispatch({ type: 'setPref', patch: { showThirds: !state.prefs.showThirds } })}
      >
        <Icon name="grid" />
      </Button>
      <Button variant="ghost" size="sm" disabled={contain || item.crop === null} onClick={() => dispatch({ type: 'setCrop', id: item.id, crop: null })} aria-keyshortcuts="R">
        <Icon name="reset" /> {t.crop.reset} <Keycap className="max-lg:hidden">R</Keycap>
      </Button>
      {free ? (
        <RatioSelect
          imageRatio={image.width / image.height}
          onPick={(ratio) => dispatch({ type: 'setCrop', id: item.id, crop: adaptCropToAspect(crop, ratio, image) })}
        />
      ) : null}
      <span className="min-w-4 flex-1" />
      {geometry.upscaleCapped ? (
        <span
          className="mr-2 flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-warning-bg pr-0.5 pl-2 text-xs text-warning ring-1 ring-warning-line"
          title={t.crop.cappedTitle(contain, geometry.requestedWidth, geometry.requestedHeight)}
        >
          <Icon name="warn" className="size-3.5" />
          {t.crop.cappedAt} <span className="font-mono">{geometry.outWidth} × {geometry.outHeight}</span>
          <button
            type="button"
            onClick={() => dispatch({ type: 'setOverrides', id: item.id, patch: { allowUpscale: true } })}
            className={cn('h-6 rounded bg-raised px-1.5 font-medium text-ink ring-1 ring-warning-line hover:bg-warning-bg', focusRing)}
          >
            {t.crop.allowUpscaling}
          </button>
        </span>
      ) : null}
      <span className="shrink-0 font-mono text-xs text-ink-3">
        {/* The source size gives way first when the toolbar is short on room (long German labels). */}
        <span className={cn({ 'max-2xl:hidden': geometry.upscaleCapped })}>
          {contain ? t.crop.wholeImage(image.width, image.height) : t.crop.cropSize(Math.round(crop.width), Math.round(crop.height))}
          {contain ? null : <span className="text-ink-2"> · {describeRatio(crop.width, crop.height)}</span>} →{' '}
        </span>
        <strong className="font-semibold text-ink">
          {geometry.outWidth} × {geometry.outHeight}
        </strong>
      </span>
    </Toolbar>
  );
};

export const CanvasArea = ({ reference }: { reference: PreviewReference | null }) => {
  const { state, dispatch, selectedItem } = useApp();

  if (!selectedItem) {
    return (
      <div className="flex min-h-0 flex-1 flex-col lg:p-3">
        <EmptyDropZone />
      </div>
    );
  }

  const preset = getItemPreset(state, selectedItem);
  const mode = MODES.some((entry) => entry.mode === state.mode) ? state.mode : 'crop';
  const bitmap = selectedItem.editedBitmap ?? selectedItem.sourceBitmap;

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:px-3 lg:pb-3">
      <div className="flex h-12 shrink-0 items-center gap-2 overflow-x-auto [scrollbar-width:none] max-lg:px-4 max-lg:pt-1">
        <ModeTabs mode={mode} onChange={(next) => dispatch({ type: 'setMode', mode: next })} />
        <span className="flex-1" />
        <span className="max-lg:hidden">
          <UndoRedo />
        </span>
        <p className="min-w-0 truncate font-mono text-[11px] text-ink-3 max-lg:hidden" title={selectedItem.sourceName}>
          {selectedItem.sourceName} · {bitmap.width} × {bitmap.height} · {formatBytes(selectedItem.sourceBytes)}
        </p>
      </div>
      <div id="editor-panel" role="tabpanel" aria-labelledby={`tab-${mode}`} className="flex min-h-0 flex-1 flex-col gap-1 max-lg:gap-0">
        {mode === 'crop' ? (
          <>
            <CropToolbar item={selectedItem} preset={preset} />
            <Stage>
              <CropEditor item={selectedItem} preset={preset} />
            </Stage>
          </>
        ) : null}
        {mode === 'retouch' ? <RetouchPanel key={selectedItem.id} item={selectedItem} /> : null}
        {mode === 'background' ? <BackgroundPanel key={selectedItem.id} item={selectedItem} /> : null}
        {mode === 'compare' ? <CompareView item={selectedItem} reference={reference} /> : null}
      </div>
    </div>
  );
};
