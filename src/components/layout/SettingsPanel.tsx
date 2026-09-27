import { useEffect, useState } from 'react';
import { describeProgress, supportsDirectoryExport, useBatchExport } from '../../hooks/useBatchExport';
import { cn } from '../../lib/cn';
import { formatBytes } from '../../lib/format';
import { findPreset, isBuiltinPreset, orderedPresets } from '../../lib/presets';
import type { Preset, QueueItem } from '../../lib/types';
import { getItemPreset } from '../../state/appReducer';
import { useApp } from '../../state/AppContext';
import { canCopyImages, canShareImage, copyImageToClipboard, shareImage } from '../../state/clipboard';
import { outputImage } from '../../state/encoding';
import { clearDownloadedModels } from '../../worker/segmentClient';
import { OutputCard } from '../preview/OutputCard';
import { PresetForm } from '../presets/PresetForm';
import { PresetManagerDialog } from '../presets/PresetManagerDialog';
import { Button, focusRing } from '../ui/Button';
import { inputClass } from '../ui/Field';
import { Icon, Spinner } from '../ui/Icon';
import { presetLabel } from '../../i18n';
import { useT } from '../../i18n/useT';

export const TOAST_ANCHOR_ID = 'toast-anchor';

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

type PresetSelectProps = { value: string; presets: readonly Preset[]; onChange: (id: string) => void; onManage: () => void };

const PresetSelect = ({ value, presets, onChange, onManage }: PresetSelectProps) => {
  const t = useT();
  return (
  <div className="flex items-center gap-2">
    <label htmlFor="preset-select" className="sr-only">
      {t.settings.preset}
    </label>
    <div className="relative min-w-0 flex-1">
      <select id="preset-select" value={value} onChange={(event) => onChange(event.target.value)} className={cn(inputClass, 'appearance-none pr-8 font-medium')}>
        {/* One list in the order set in Manage presets. */}
        {presets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {presetLabel(preset)}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-ink-3" />
    </div>
    <Button variant="ghost" onClick={onManage}>
      {t.settings.manage}
    </Button>
  </div>
  );
};

const ModifiedBar = ({ item, onSaveAsNew }: { item: QueueItem; onSaveAsNew: () => void }) => {
  const { dispatch } = useApp();
  const t = useT();
  const builtin = isBuiltinPreset(item.presetId);
  return (
    <div className="rounded-[9px] bg-raised p-2.5 ring-1 ring-line-strong">
      <p className="mb-2 flex items-center gap-2 text-[13px] font-medium">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
        {t.settings.modified}
        <span className="truncate text-xs font-normal text-ink-3">· {t.settings.changes(Object.keys(item.overrides).length)}</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          disabled={builtin}
          title={builtin ? t.settings.readOnly : undefined}
          onClick={() => {
            dispatch({ type: 'saveOverridesToPreset', id: item.id });
            dispatch({ type: 'announce', message: t.settings.presetUpdated });
          }}
        >
          {t.settings.saveToPreset}
        </Button>
        <Button size="sm" onClick={onSaveAsNew}>
          {t.settings.saveAsNew}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'resetOverrides', id: item.id })}>
          {t.settings.reset}
        </Button>
      </div>
    </div>
  );
};

const SaveAsNewForm = ({ item, defaultName, onDone }: { item: QueueItem; defaultName: string; onDone: () => void }) => {
  const { dispatch } = useApp();
  const t = useT();
  const [name, setName] = useState(defaultName);
  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        dispatch({ type: 'saveOverridesAsNewPreset', id: item.id, name, newPresetId: crypto.randomUUID() });
        dispatch({ type: 'announce', message: t.settings.savedPreset(name) });
        onDone();
      }}
    >
      <input autoFocus value={name} onChange={(event) => setName(event.target.value)} aria-label={t.settings.newPresetName} className={inputClass} />
      <Button type="submit" variant="primary" disabled={!name.trim()}>
        {t.settings.save}
      </Button>
      <Button variant="ghost" onClick={onDone}>
        {t.settings.cancel}
      </Button>
    </form>
  );
};

/** Preset choice, per-image overrides and the "about the output" notes. */
export const SettingsForm = () => {
  const { state, dispatch, selectedItem, notify } = useApp();
  const t = useT();
  const [managerOpen, setManagerOpen] = useState(false);
  const [savingAsNew, setSavingAsNew] = useState(false);

  const presetId = selectedItem?.presetId ?? state.lastPresetId;
  const basePreset = findPreset(state.presets, presetId);
  const preset = selectedItem ? getItemPreset(state, selectedItem) : basePreset;
  const modified = selectedItem !== null && Object.keys(selectedItem.overrides).length > 0;

  const handleChange = (patch: Partial<Preset>) => {
    if (!selectedItem) {
      notify('info', t.settings.addImageFirst);
      return;
    }
    dispatch({ type: 'setOverrides', id: selectedItem.id, patch });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <PresetSelect
          value={presetId}
          presets={orderedPresets(state.presets, state.presetOrder)}
          onManage={() => setManagerOpen(true)}
          onChange={(id) => {
            if (selectedItem) dispatch({ type: 'setItemPreset', id: selectedItem.id, presetId: id });
            else dispatch({ type: 'applyPresetToAll', presetId: id });
          }}
        />
        {selectedItem && modified && !savingAsNew ? <ModifiedBar item={selectedItem} onSaveAsNew={() => setSavingAsNew(true)} /> : null}
        {selectedItem && savingAsNew ? (
          <SaveAsNewForm item={selectedItem} defaultName={t.settings.customName(presetLabel(basePreset))} onDone={() => setSavingAsNew(false)} />
        ) : null}
      </div>

      <PresetForm preset={preset} item={selectedItem} queueLength={state.items.length} onChange={handleChange} />

      <details className="group border-t border-line pt-3 text-xs text-ink-3">
        <summary className={cn('flex cursor-pointer list-none items-center gap-1.5 rounded select-none hover:text-ink', focusRing)}>
          <Icon name="info" className="size-3.5" />
          {t.settings.about}
          <Icon name="chevron" className="ml-auto size-3.5 transition-transform group-open:rotate-90" />
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-4">
          {t.settings.aboutItems.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <Button
          size="sm"
          variant="ghost"
          className="mt-2 -ml-2.5"
          onClick={async () => {
            const cleared = await clearDownloadedModels();
            notify('info', cleared ? t.settings.modelsCleared : t.settings.noModels);
          }}
        >
          {t.settings.clearModels}
        </Button>
      </details>

      <PresetManagerDialog open={managerOpen} onClose={() => setManagerOpen(false)} />
    </div>
  );
};

/** Copy as PNG, falling back to the share sheet where images can't go on the clipboard (iOS). */
export const useCopyOutput = () => {
  const { notify, outputFilename } = useApp();
  const t = useT();
  return async (item: QueueItem) => {
    const output = item.output;
    if (!output) return;
    const share = () => void shareImage(output.blob, outputFilename(item)).catch(() => undefined);
    if (!canCopyImages()) {
      if (canShareImage(output.blob, outputFilename(item))) share();
      else notify('error', t.output.cantCopy);
      return;
    }
    try {
      await copyImageToClipboard(outputImage(output));
      notify('success', t.output.copied);
    } catch (error) {
      if (canShareImage(output.blob, outputFilename(item))) {
        notify('info', t.output.copyBlocked, { label: t.output.share, run: share });
        return;
      }
      notify('error', t.output.copyFailed);
      console.warn(error);
    }
  };
};

const BatchExport = () => {
  const { state } = useApp();
  const t = useT();
  const { exportZip, exportPdf, exportToFolder, progress } = useBatchExport();
  const count = state.items.length;
  // Leads when every image is set to PDF; otherwise it's a secondary choice next to the ZIP.
  const allPdf = count > 0 && state.items.every((item) => getItemPreset(state, item).format === 'pdf');

  // Show export progress in the tab title, so it's visible from another tab.
  useEffect(() => {
    if (!progress) return;
    const original = document.title.replace(/^\(\d+\/\d+\) /, '');
    document.title = `(${progress.done}/${progress.total}) ${original}`;
    return () => {
      document.title = original;
    };
  }, [progress]);
  if (count < 2) return null;

  if (progress) {
    const fraction = progress.total > 0 ? progress.done / progress.total : 0;
    return (
      <div aria-live="polite" className="space-y-1.5">
        <p className="flex items-center justify-between text-xs font-medium">
          <span className="flex items-center gap-1.5">
            <Spinner /> {describeProgress(progress)}
          </span>
          <span className="font-mono text-ink-3">
            {progress.done}/{progress.total}
          </span>
        </p>
        <div className="h-1 overflow-hidden rounded-full bg-sunken">
          <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${fraction * 100}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-ink-3">
        {t.batch.allImages} · <span className="font-mono">{count}</span>
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant={allPdf ? 'ghost' : 'secondary'} onClick={exportZip} title={t.batch.exportZipTitle}>
          {t.batch.exportZip}
        </Button>
        <Button size="sm" variant={allPdf ? 'secondary' : 'ghost'} onClick={exportPdf} title={t.batch.onePdfTitle} className={cn({ 'order-first': allPdf })}>
          {t.batch.onePdf}
        </Button>
        {supportsDirectoryExport() ? (
          <Button size="sm" variant="ghost" onClick={exportToFolder}>
            {t.batch.saveToFolder}
          </Button>
        ) : null}
      </div>
    </div>
  );
};

/** The output card, Download/Copy and batch export. Pinned at the bottom of the settings column. */
export const OutputDock = ({ showActions = true }: { showActions?: boolean }) => {
  const { state, selectedItem, downloadItem } = useApp();
  const t = useT();
  const copy = useCopyOutput();
  const preset = selectedItem ? getItemPreset(state, selectedItem) : findPreset(state.presets, state.lastPresetId);
  const upToDate = selectedItem !== null && selectedItem.output !== null && selectedItem.outputRevision === selectedItem.revision;

  return (
    <div className="space-y-3">
      <OutputCard item={selectedItem} preset={preset} />
      {showActions ? (
        <div className="flex gap-2">
          <Button variant="primary" size="lg" className="flex-1" disabled={!upToDate} onClick={() => selectedItem && downloadItem(selectedItem)}>
            <Icon name="download" /> {t.output.download}
            <kbd aria-hidden="true" className="ml-auto rounded-sm bg-on-primary/15 px-1.5 py-0.5 font-mono text-[11px] font-medium">
              {IS_MAC ? '⌘S' : `${t.shortcuts.mod} S`}
            </kbd>
          </Button>
          <Button
            size="icon-lg"
            disabled={!upToDate}
            onClick={() => selectedItem && void copy(selectedItem)}
            aria-label={t.output.copy}
            title={t.output.copyTitle}
          >
            <Icon name="copy" />
          </Button>
        </div>
      ) : null}
      <BatchExport />
    </div>
  );
};

/** Mobile: size + Settings + Download, stuck to the bottom above the home indicator and keyboard. */
export const MobileDownloadBar = ({ onOpenSettings }: { onOpenSettings: () => void }) => {
  const { selectedItem, downloadItem } = useApp();
  const t = useT();
  const copy = useCopyOutput();
  if (!selectedItem) return null;
  const output = selectedItem.output;
  const upToDate = output !== null && selectedItem.outputRevision === selectedItem.revision;

  return (
    <div className="sticky bottom-0 z-30 flex items-center gap-2 border-t border-line bg-raised px-4 pt-2.5 pb-[max(.625rem,env(safe-area-inset-bottom))]">
      {/* Toasts render here on phones, so they always sit just above this bar (see Notices). */}
      <div id={TOAST_ANCHOR_ID} className="pointer-events-none absolute inset-x-0 bottom-full" />
      <div className="min-w-0 flex-1">
        <p className={cn('font-mono text-lg leading-tight font-semibold', { 'text-ink-3': !upToDate })}>{output ? formatBytes(output.blob.size) : '—'}</p>
        <p className="truncate font-mono text-[11px] text-ink-3">
          {output ? `${output.width} × ${output.height}` : t.output.encodingShort}
          {!upToDate && output ? t.output.updating : ''}
        </p>
      </div>
      <Button size="icon" onClick={onOpenSettings} aria-label={t.output.settings} title={t.output.settings}>
        <Icon name="sliders" />
      </Button>
      <Button size="icon" disabled={!upToDate} onClick={() => void copy(selectedItem)} aria-label={t.output.copy}>
        <Icon name="copy" />
      </Button>
      <Button variant="primary" size="lg" disabled={!upToDate} onClick={() => downloadItem(selectedItem)}>
        <Icon name="download" /> {t.output.download}
      </Button>
    </div>
  );
};

