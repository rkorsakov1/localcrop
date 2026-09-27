import { cn } from '../../lib/cn';
import { formatBytes, formatSavings, FORMAT_LABELS } from '../../lib/format';
import type { Preset, QueueItem } from '../../lib/types';
import { useApp } from '../../state/AppContext';
import { sectionLabelClass } from '../ui/Button';
import { Spinner } from '../ui/Icon';
import { checkerboardClass } from './Checkerboard';
import { messages, translateError } from '../../i18n';
import { useT } from '../../i18n/useT';

type OutputCardProps = { item: QueueItem | null; preset: Preset };

type Status = { tone: 'success' | 'muted' | 'danger'; label: string; busy?: boolean };

const outputStatus = (item: QueueItem | null): Status => {
  const o = messages().output;
  if (!item) return { tone: 'muted', label: o.waitingForImage };
  if (item.status === 'error') return { tone: 'danger', label: o.error };
  const stale = item.outputRevision !== item.revision;
  if (stale) return item.status === 'encoding' || item.output ? { tone: 'muted', label: o.encoding, busy: true } : { tone: 'muted', label: o.waiting };
  if (item.output?.warning) return { tone: 'danger', label: o.targetMissed };
  return { tone: 'success', label: o.exact };
};

/** The real encoded output: thumbnail, exact size, dimensions, quality and savings. */
export const OutputCard = ({ item, preset }: OutputCardProps) => {
  const { outputFilename } = useApp();
  const t = useT();
  const output = item?.output ?? null;
  const stale = item !== null && item.outputRevision !== item.revision;
  const status = outputStatus(item);
  const qualityLabel = preset.format === 'png' ? t.output.lossless : `q${output?.quality ?? preset.quality}`;
  const ratio = item && output ? Math.min(1, output.blob.size / Math.max(1, item.sourceBytes)) : 0;

  return (
    <section aria-labelledby="output-heading" aria-busy={status.busy}>
      <div className="mb-2.5 flex items-center justify-between">
        <h3 id="output-heading" className={sectionLabelClass}>
          {t.output.title}
        </h3>
        <span
          className={cn('flex items-center gap-1.5 text-[11px]', {
            'text-success': status.tone === 'success',
            'text-ink-3': status.tone === 'muted',
            'text-danger': status.tone === 'danger',
          })}
        >
          {status.busy ? <Spinner /> : <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
          {status.label}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className={cn('flex h-[47px] w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-sm', output ? checkerboardClass : 'bg-sunken')}>
          {output ? (
            <img
              src={output.previewUrl}
              alt={t.output.preview(output.width, output.height)}
              draggable={!stale}
              title={stale ? undefined : t.output.dragOut}
              onDragStart={(event) => {
                if (!item) return;
                // Chromium turns this into a real file drop with the right name; other browsers drag the image.
                const absolute = new URL(output.url, window.location.href).href;
                event.dataTransfer.setData('DownloadURL', `${output.blob.type}:${outputFilename(item)}:${absolute}`);
                event.dataTransfer.effectAllowed = 'copy';
              }}
              className={cn('max-h-full max-w-full object-contain transition-opacity duration-300', { 'opacity-45': stale })}
            />
          ) : null}
        </div>
        <div className="min-w-0">
          <p
            key={output && !stale ? output.url : 'pending'}
            className={cn('font-mono text-[26px] leading-tight font-semibold tracking-[-.02em] transition-colors duration-300', {
              'text-ink-3': stale || !output,
            })}
            title={output ? t.output.bytes(output.blob.size.toLocaleString(t.meta.short === 'DE' ? 'de-DE' : 'en-US')) : undefined}
          >
            {output ? formatBytes(output.blob.size) : '—'}
          </p>
          <p className="flex flex-wrap items-center gap-x-1.5 font-mono text-[11px] text-ink-3">
            {output ? (
              <>
                <span>
                  {output.width} × {output.height} · {FORMAT_LABELS[preset.format]} {qualityLabel}
                </span>
                {output.encoder === 'native' ? (
                  <span
                    title={t.output.nativeTitle}
                    className="rounded-sm bg-warning-bg px-1 font-sans text-[10px] font-semibold tracking-wide text-warning uppercase"
                  >
                    {t.output.nativeEncoder}
                  </span>
                ) : null}
              </>
            ) : item ? (
              item.status === 'error' ? t.output.failed : t.output.preparing
            ) : (
              t.output.noImage
            )}
          </p>
        </div>
      </div>

      {item && output ? (
        <div className="mt-3">
          <div className="h-1 overflow-hidden rounded-full bg-sunken">
            <div className="h-full rounded-full bg-success-bar transition-[width] duration-300" style={{ width: `${Math.max(2, ratio * 100)}%` }} />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[11px] text-ink-3">
            <span className={cn({ 'text-success': output.blob.size < item.sourceBytes })}>{formatSavings(item.sourceBytes, output.blob.size)} {t.output.vsSource}</span>
            <span>{formatBytes(item.sourceBytes)}</span>
          </div>
        </div>
      ) : null}

      {output?.warning && !stale ? (
        <p className="mt-2 text-xs text-danger">{t.output.targetMissedDetail(preset.targetMaxBytes ? formatBytes(preset.targetMaxBytes) : '')}</p>
      ) : null}
      {item?.status === 'error' && item.error ? (
        <p role="alert" className="mt-2 text-xs text-danger">
          {translateError(item.error)}
        </p>
      ) : null}
    </section>
  );
};
