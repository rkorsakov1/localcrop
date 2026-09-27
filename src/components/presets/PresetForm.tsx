import { useEffect, useState } from 'react';
import { cn } from '../../lib/cn';
import { renderFilename } from '../../lib/filenameTemplate';
import { formatBytes, FORMAT_LABELS, parseByteSize } from '../../lib/format';
import type { FitMode, OutputFormat, Preset, QueueItem } from '../../lib/types';
import { focusRing, Segmented, sectionLabelClass } from '../ui/Button';
import { ColorInput, Field, inputClass, NumberField, Slider, Toggle } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { messages, presetLabel } from '../../i18n';
import { useT } from '../../i18n/useT';

type PresetFormProps = {
  preset: Preset;
  item: QueueItem | null;
  queueLength: number;
  onChange: (patch: Partial<Preset>) => void;
};

const FORMAT_OPTIONS = (['jpeg', 'webp', 'avif', 'png', 'pdf'] as const).map((value) => ({ value, label: FORMAT_LABELS[value] }));
const fitOptions = (): { value: FitMode; label: string; title: string }[] => {
  const f = messages().form;
  return [
    { value: 'cover', label: f.cover, title: f.coverTitle },
    { value: 'contain', label: f.contain, title: f.containTitle },
  ];
};

/** Target size, typed as "200 KB". Empty = off. Commits on blur/Enter. */
const TargetSizeField = ({ value, onChange, disabled }: { value: number | null; onChange: (value: number | null) => void; disabled: boolean }) => {
  const t = useT();
  const [draft, setDraft] = useState(value ? formatBytes(value) : '');
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(value ? formatBytes(value) : '');
    setInvalid(false);
  }, [value]);

  const commit = () => {
    if (draft.trim() === '') {
      setInvalid(false);
      if (value !== null) onChange(null);
      return;
    }
    const parsed = parseByteSize(draft);
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (parsed !== value) onChange(parsed);
  };

  return (
    <Field
      inline
      label={t.form.targetSize}
      hint={invalid ? <span className="text-danger">{t.form.targetInvalid}</span> : undefined}
    >
      {(id) => (
        <input
          id={id}
          type="text"
          placeholder={disabled ? t.form.targetNa : t.form.targetOff}
          title={t.form.targetTitle}
          value={draft}
          disabled={disabled}
          aria-invalid={invalid}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
          }}
          className={cn(inputClass, 'w-24 font-mono max-lg:w-32')}
        />
      )}
    </Field>
  );
};

const TemplateField = ({ preset, item, queueLength, onChange }: PresetFormProps) => {
  const t = useT();
  const [draft, setDraft] = useState(preset.filenameTemplate);
  useEffect(() => setDraft(preset.filenameTemplate), [preset.filenameTemplate]);

  const example = renderFilename(draft || preset.filenameTemplate, {
    sourceName: item?.sourceName ?? t.form.exampleName,
    width: item?.output?.width ?? preset.width ?? 1600,
    height: item?.output?.height ?? preset.height ?? 900,
    presetName: presetLabel(preset),
    index: 1,
    queueLength: Math.max(1, queueLength),
    format: preset.format,
  });

  const commit = () => {
    const next = draft.trim() || preset.filenameTemplate;
    setDraft(next);
    if (next !== preset.filenameTemplate) onChange({ filenameTemplate: next });
  };

  return (
    <Field
      label={t.form.template}
      hint={
        <>
          <span className="block truncate" title={example}>
            → <span className="font-mono">{example}</span>
          </span>
          <span className="block">
            {t.form.tokens} <code>{'{name}'}</code> <code>{'{w}'}</code> <code>{'{h}'}</code> <code>{'{preset}'}</code> <code>{'{i}'}</code>{' '}
            <code>{'{ext}'}</code>
          </span>
        </>
      }
    >
      {(id) => (
        <input
          id={id}
          type="text"
          spellCheck={false}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
          }}
          className={cn(inputClass, 'font-mono')}
        />
      )}
    </Field>
  );
};

const summaryParts = (preset: Preset): string[] => {
  const f = messages().form;
  return [preset.allowUpscale ? f.upscaling : f.noUpscaling, preset.sharpen === 0 ? f.sharpenOff : f.sharpenAmount(preset.sharpen)];
};

/** All per-image output settings. Edits become overrides until saved to a preset. */
export const PresetForm = ({ preset, item, queueLength, onChange }: PresetFormProps) => {
  const t = useT();
  const isPng = preset.format === 'png';
  const bothDimensions = preset.width !== null && preset.height !== null;
  const free = bothDimensions && preset.fit === 'free';

  return (
    <div className="space-y-5">
      <section aria-labelledby="size-heading" className="space-y-2.5">
        <h3 id="size-heading" className={sectionLabelClass}>
          {t.form.sizeFit}
        </h3>
        <div className="flex items-center gap-1">
          <NumberField label={t.form.width} prefix={t.form.widthPrefix} suffix="px" placeholder={t.form.auto} value={preset.width} onChange={(width) => onChange({ width })} />
          <button
            type="button"
            aria-pressed={bothDimensions && !free}
            disabled={!bothDimensions}
            onClick={() => onChange({ fit: free ? 'cover' : 'free' })}
            aria-label={free ? t.form.lock : t.form.unlock}
            title={free ? t.form.unlockedTitle : t.form.lockedTitle}
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink disabled:opacity-45 max-lg:size-11',
              'aria-pressed:text-ink',
              focusRing,
            )}
          >
            <Icon name={free ? 'unlink' : 'link'} />
          </button>
          <NumberField label={t.form.height} prefix={t.form.heightPrefix} suffix="px" placeholder={t.form.auto} value={preset.height} onChange={(height) => onChange({ height })} />
        </div>
        {free ? (
          <p className="flex min-h-9 items-center rounded-[9px] bg-sunken px-3 text-xs text-ink-2 max-lg:min-h-11">
            {t.form.freeNote}{' '}
            <span className="ml-1 font-mono">
              {preset.width} × {preset.height}
            </span>
          </p>
        ) : (
          <Segmented<FitMode>
            label={t.form.fit}
            value={preset.fit}
            options={fitOptions()}
            onChange={(fit) => onChange({ fit })}
            disabled={!bothDimensions}
            className="flex w-full"
          />
        )}
        {!bothDimensions ? <p className="text-xs text-ink-3">{t.form.oneSideHint}</p> : null}
      </section>

      <section aria-labelledby="format-heading" className="space-y-2.5">
        <h3 id="format-heading" className={sectionLabelClass}>
          {t.form.formatQuality}
        </h3>
        <Segmented<OutputFormat> label={t.form.format} value={preset.format} options={FORMAT_OPTIONS} onChange={(format) => onChange({ format })} className="flex w-full" />
        <Slider
          label={t.form.quality}
          min={0}
          max={100}
          value={preset.quality}
          disabled={isPng || preset.targetMaxBytes !== null}
          valueLabel={isPng ? t.form.lossless : preset.targetMaxBytes !== null ? t.form.qualityAuto : String(preset.quality)}
          onChange={(quality) => onChange({ quality })}
        />
        <TargetSizeField value={preset.targetMaxBytes} disabled={isPng} onChange={(targetMaxBytes) => onChange({ targetMaxBytes })} />
      </section>

      <details className="group">
        <summary className={cn('cursor-pointer list-none rounded select-none [&::-webkit-details-marker]:hidden', focusRing)}>
          <span className={cn(sectionLabelClass, 'flex items-center justify-between')}>
            {t.form.advanced}
            <Icon name="chevron" className="size-3.5 transition-transform group-open:rotate-90" />
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-3 group-open:hidden">
            <span className="flex items-center gap-1">
              <span aria-hidden="true" className="size-2.5 rounded-[3px] ring-1 ring-line-strong" style={{ backgroundColor: preset.matteColor }} />
              {t.form.matte} {preset.matteColor.toUpperCase()}
            </span>
            {summaryParts(preset).map((part) => (
              <span key={part}>{part}</span>
            ))}
            <span className="w-full truncate font-mono">{preset.filenameTemplate}</span>
          </span>
        </summary>
        <div className="mt-3 space-y-3.5">
          <Field inline label={t.form.matteColor} hint={t.form.matteHint}>
            {(id) => (
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-ink-3">{preset.matteColor.toUpperCase()}</span>
                <ColorInput id={id} label={t.form.matteColor} value={preset.matteColor} onChange={(matteColor) => onChange({ matteColor })} />
              </div>
            )}
          </Field>
          <Toggle
            label={t.form.allowUpscaling}
            checked={preset.allowUpscale}
            onChange={(allowUpscale) => onChange({ allowUpscale })}
            hint={t.form.upscaleHint}
          />
          <Slider
            label={t.form.sharpen}
            min={0}
            max={100}
            value={preset.sharpen}
            valueLabel={preset.sharpen === 0 ? t.form.off : String(preset.sharpen)}
            onChange={(sharpen) => onChange({ sharpen })}
          />
          <TemplateField preset={preset} item={item} queueLength={queueLength} onChange={onChange} />
        </div>
      </details>
    </div>
  );
};
