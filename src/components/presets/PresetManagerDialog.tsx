import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { DEFAULT_FILENAME_TEMPLATE } from '../../lib/filenameTemplate';
import { BUILTIN_PRESETS, isBuiltinPreset, orderedPresets, uniquePresetName } from '../../lib/presets';
import { createShareHash } from '../../lib/presetShare';
import { createPresetFile, describeMergeSummary, mergePresets, validatePresetFile } from '../../lib/presetValidation';
import { FORMAT_LABELS } from '../../lib/format';
import type { Preset } from '../../lib/types';
import { triggerDownload, useApp } from '../../state/AppContext';
import { cn } from '../../lib/cn';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { inputClass } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { messages, presetLabel, translateError } from '../../i18n';
import { useT } from '../../i18n/useT';

export const describePreset = (preset: Preset): string => {
  const t = messages();
  const size = preset.width || preset.height ? `${preset.width ?? t.form.auto}×${preset.height ?? t.form.auto}` : t.presets.originalSize;
  const quality = preset.format === 'png' ? '' : ` q${preset.quality}`;
  const target = preset.targetMaxBytes ? ` ≤${Math.round(preset.targetMaxBytes / 1000)} KB` : '';
  return `${size} · ${t.presets.fits[preset.fit]} · ${FORMAT_LABELS[preset.format]}${quality}${target}`;
};

const newPreset = (existing: readonly Preset[]): Preset => ({
  id: crypto.randomUUID(),
  name: uniquePresetName(messages().presets.newName, existing),
  width: 1600,
  height: null,
  fit: 'cover',
  format: 'webp',
  quality: 80,
  targetMaxBytes: null,
  matteColor: '#ffffff',
  allowUpscale: false,
  filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
  sharpen: 0,
});

type PendingImport = { presets: Preset[]; summary: string };

type RowProps = {
  preset: Preset;
  builtin: boolean;
  selected: boolean;
  /** Vertical offset while this row is being dragged; null when it isn't. */
  dragOffset: number | null;
  onToggleSelected: () => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onGripPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onGripKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onShare?: () => void;
};

/** Drag handle; also moves the row with the up/down arrow keys. */
const Grip = ({ preset, onPointerDown, onKeyDown }: { preset: Preset; onPointerDown: RowProps['onGripPointerDown']; onKeyDown: RowProps['onGripKeyDown'] }) => {
  const t = useT();
  return (
    <button
      type="button"
      data-grip={preset.id}
      aria-label={t.presets.reorder(presetLabel(preset))}
      aria-keyshortcuts="ArrowUp ArrowDown"
      title={t.presets.reorderTitle}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className="-ml-1.5 flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-ink-3 hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-accent active:cursor-grabbing max-lg:h-11 max-lg:w-9"
    >
      <Icon name="grip" strokeWidth={2.6} />
    </button>
  );
};

const PresetRow = ({ preset, builtin, selected, dragOffset, onToggleSelected, onRename, onDuplicate, onDelete, onGripPointerDown, onGripKeyDown, onShare }: RowProps) => {
  const t = useT();
  const [name, setName] = useState(preset.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  useEffect(() => setName(preset.name), [preset.name]);

  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setName(preset.name);
      return;
    }
    if (trimmed !== preset.name) onRename(trimmed);
  };

  const grip = <Grip preset={preset} onPointerDown={onGripPointerDown} onKeyDown={onGripKeyDown} />;
  const dragging = dragOffset !== null;
  const rowClass = cn('flex items-center gap-2.5 bg-panel py-2', { 'relative z-10 rounded-md opacity-90 shadow-float': dragging });
  const rowStyle = dragging ? { transform: `translateY(${dragOffset}px)` } : undefined;

  if (builtin) {
    return (
      <li data-preset={preset.id} className={rowClass} style={rowStyle}>
        {grip}
        <span className="flex size-4 shrink-0 items-center justify-center text-ink-3" title={t.presets.builtInTitle}>
          <Icon name="lock" className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate px-1.5 text-[13px] font-medium">
            {presetLabel(preset)} <span className="ml-1 text-[11px] font-normal text-ink-3">{t.presets.builtInBadge}</span>
          </p>
          <p className="mt-0.5 truncate pl-1.5 font-mono text-[11px] text-ink-3">{describePreset(preset)}</p>
        </div>
        <Button size="icon-sm" variant="ghost" onClick={onDuplicate} aria-label={t.presets.duplicateNamed(presetLabel(preset))} title={t.presets.duplicate}>
          <Icon name="duplicate" />
        </Button>
      </li>
    );
  }

  return (
    <li data-preset={preset.id} className={cn(rowClass, 'flex-wrap')} style={rowStyle}>
      {grip}
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggleSelected}
        aria-label={t.presets.select(preset.name)}
        className="size-4 shrink-0 accent-primary"
      />
      <div className="min-w-0 flex-1">
        <input
          value={name}
          aria-label={t.presets.nameOf(preset.name)}
          onChange={(event) => setName(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitName();
          }}
          className={cn(inputClass, 'h-7 border-transparent bg-transparent px-1.5 font-medium hover:border-line-strong focus:border-line-strong focus:bg-raised')}
        />
        <p className="mt-0.5 truncate pl-1.5 font-mono text-[11px] text-ink-3">{describePreset(preset)}</p>
      </div>
      {confirmingDelete ? (
        <div role="group" aria-label={t.presets.confirmDelete(preset.name)} className="flex items-center gap-1 rounded-md bg-danger-bg py-1 pr-1 pl-2.5 text-xs text-danger">
          <span className="mr-1">{t.presets.deleteQuestion(preset.name)}</span>
          <Button size="xs" variant="ghost" onClick={() => setConfirmingDelete(false)}>
            {t.presets.cancel}
          </Button>
          <Button size="xs" variant="danger" autoFocus onClick={onDelete}>
            {t.presets.delete}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-0.5">
          {onShare ? (
            <Button size="icon-sm" variant="ghost" onClick={onShare} aria-label={t.presets.shareNamed(preset.name)} title={t.presets.shareTitle}>
              <Icon name="link" />
            </Button>
          ) : null}
          <Button size="icon-sm" variant="ghost" onClick={onDuplicate} aria-label={t.presets.duplicateNamed(preset.name)} title={t.presets.duplicate}>
            <Icon name="duplicate" />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => setConfirmingDelete(true)} aria-label={t.presets.deleteNamed(preset.name)} title={t.presets.delete}>
            <Icon name="trash" />
          </Button>
        </div>
      )}
    </li>
  );
};

type PresetManagerDialogProps = { open: boolean; onClose: () => void };

export const PresetManagerDialog = ({ open, onClose }: PresetManagerDialogProps) => {
  const { state, dispatch, notify } = useApp();
  const t = useT();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const allNames = [...BUILTIN_PRESETS, ...state.presets];
  const ordered = orderedPresets(state.presets, state.presetOrder);
  const listRef = useRef<HTMLUListElement>(null);
  /** A pointer drag of one row: where it would land, and the drop line's y inside the list. */
  const [drag, setDrag] = useState<{ id: string; index: number; offset: number; indicator: number | null } | null>(null);

  const moveTo = (preset: Preset, index: number) => {
    dispatch({ type: 'movePreset', id: preset.id, index });
    const position = Math.min(ordered.length, Math.max(1, index + 1));
    dispatch({ type: 'announce', message: t.presets.moved(presetLabel(preset), position, ordered.length) });
  };

  const handleGripKey = (event: KeyboardEvent<HTMLButtonElement>, preset: Preset) => {
    const index = ordered.findIndex((candidate) => candidate.id === preset.id);
    const targets: Record<string, number> = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: ordered.length - 1 };
    const target = targets[event.key];
    if (target === undefined) return;
    event.preventDefault();
    if (target < 0 || target >= ordered.length) return;
    moveTo(preset, target);
    // The row moves in the DOM; keep the handle focused so the arrows can keep going.
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-grip="${preset.id}"]`)?.focus());
  };

  /** Where a row dragged to `clientY` would land, among the other rows. */
  const dropTarget = (id: string, clientY: number) => {
    const list = listRef.current;
    if (!list) return { index: 0, indicator: null };
    const rows = [...list.querySelectorAll<HTMLElement>('li[data-preset]')].filter((row) => row.dataset.preset !== id);
    const top = list.getBoundingClientRect().top;
    let index = 0;
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (clientY > rect.top + rect.height / 2) index += 1;
    }
    const before = rows[index - 1];
    const after = rows[index];
    const indicator = after ? after.getBoundingClientRect().top - top : before ? before.getBoundingClientRect().bottom - top : null;
    return { index, indicator };
  };

  const startDrag = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const index = ordered.findIndex((preset) => preset.id === id);
    const startY = event.clientY;
    setDrag({ id, index, offset: 0, indicator: null });

    const target = event.currentTarget;
    const handleMove = (move: globalThis.PointerEvent) => {
      if (move.pointerId !== event.pointerId) return;
      const next = dropTarget(id, move.clientY);
      setDrag((current) => (current ? { ...current, ...next, offset: move.clientY - startY } : current));
    };
    const handleUp = (up: globalThis.PointerEvent) => {
      if (up.pointerId !== event.pointerId) return;
      target.removeEventListener('pointermove', handleMove);
      target.removeEventListener('pointerup', handleUp);
      target.removeEventListener('pointercancel', handleUp);
      setDrag(null);
      if (up.type === 'pointercancel') return;
      const { index: to } = dropTarget(id, up.clientY);
      const preset = ordered.find((candidate) => candidate.id === id);
      if (preset && to !== index) moveTo(preset, to);
    };
    target.addEventListener('pointermove', handleMove);
    target.addEventListener('pointerup', handleUp);
    target.addEventListener('pointercancel', handleUp);
  };

  const handleDuplicate = (preset: Preset) => {
    const copy: Preset = { ...preset, id: crypto.randomUUID(), name: uniquePresetName(t.presets.copyName(presetLabel(preset)), allNames) };
    dispatch({ type: 'upsertPreset', preset: copy });
    dispatch({ type: 'announce', message: t.presets.created(copy.name) });
  };

  const handleShare = async (preset: Preset) => {
    const url = `${window.location.origin}${window.location.pathname}${createShareHash([preset])}`;
    try {
      await navigator.clipboard.writeText(url);
      notify('info', t.presets.linkCopied(preset.name));
    } catch {
      window.prompt(t.presets.copyLink, url);
    }
  };

  const handleExport = () => {
    const chosen = selected.size > 0 ? state.presets.filter((preset) => selected.has(preset.id)) : state.presets;
    if (chosen.length === 0) {
      notify('info', t.presets.nothingToExport);
      return;
    }
    const json = JSON.stringify(createPresetFile(chosen), null, 2);
    const stamp = new Date().toISOString().slice(0, 10);
    triggerDownload(new Blob([json], { type: 'application/json' }), `localcrop-presets-${stamp}.json`);
    dispatch({ type: 'announce', message: t.presets.exported(chosen.length) });
  };

  const handleImportFile = async (file: File) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      notify('error', t.presets.invalidJson(file.name));
      return;
    }
    const validation = validatePresetFile(parsed);
    if (!validation.ok) {
      notify('error', `${file.name}: ${translateError(validation.reason)}`);
      return;
    }
    const merged = mergePresets(state.presets, validation.presets);
    setPendingImport({ presets: merged.presets, summary: describeMergeSummary(merged.summary, validation.rejected) });
  };

  const handleConfirmImport = () => {
    if (!pendingImport) return;
    dispatch({ type: 'replacePresets', presets: pendingImport.presets });
    dispatch({ type: 'announce', message: t.presets.imported(pendingImport.summary) });
    setPendingImport(null);
  };

  const toggleSelected = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.presets.title}
      footer={
        <>
          <Button onClick={() => fileInput.current?.click()} className="mr-auto">
            {t.presets.import}
          </Button>
          <Button onClick={handleExport}>{selected.size > 0 ? t.presets.exportSelected(selected.size) : t.presets.exportAll}</Button>
          <Button
            variant="primary"
            onClick={() => {
              const preset = newPreset(allNames);
              dispatch({ type: 'upsertPreset', preset });
            }}
          >
            <Icon name="plus" /> {t.presets.new}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            aria-label={t.presets.importFile}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void handleImportFile(file);
            }}
          />
        </>
      }
    >
      {pendingImport ? (
        <div role="alert" className="mb-4 rounded-md bg-success-bg p-3 text-[13px] text-success">
          <p className="font-medium">{t.presets.importSummary(pendingImport.summary)}</p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="primary" onClick={handleConfirmImport}>
              {t.presets.merge}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPendingImport(null)}>
              {t.presets.cancel}
            </Button>
          </div>
        </div>
      ) : null}

      <p className="mb-2 text-xs text-ink-3">{t.presets.orderHint}</p>
      <ul ref={listRef} aria-label={t.presets.listLabel} className="relative divide-y divide-line">
        {ordered.map((preset) => {
          const builtin = isBuiltinPreset(preset.id);
          return (
            <PresetRow
              key={preset.id}
              preset={preset}
              builtin={builtin}
              selected={selected.has(preset.id)}
              dragOffset={drag?.id === preset.id ? drag.offset : null}
              onToggleSelected={() => toggleSelected(preset.id)}
              onRename={(name) => dispatch({ type: 'upsertPreset', preset: { ...preset, name: uniquePresetName(name, allNames.filter((other) => other.id !== preset.id)) } })}
              onDuplicate={() => handleDuplicate(preset)}
              onDelete={() => {
                dispatch({ type: 'deletePreset', id: preset.id });
                setSelected((previous) => {
                  const next = new Set(previous);
                  next.delete(preset.id);
                  return next;
                });
                dispatch({ type: 'announce', message: t.presets.deleted(preset.name) });
              }}
              onGripPointerDown={(event) => startDrag(event, preset.id)}
              onGripKeyDown={(event) => handleGripKey(event, preset)}
              onShare={builtin ? undefined : () => void handleShare(preset)}
            />
          );
        })}
        {drag && drag.indicator !== null ? (
          <li aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-20 h-0.5 -translate-y-1/2 rounded-full bg-accent" style={{ top: drag.indicator }} />
        ) : null}
      </ul>
      {state.presets.length === 0 ? <p className="mt-3 text-[13px] text-ink-3">{t.presets.none}</p> : null}
    </Dialog>
  );
};
