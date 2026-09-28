import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { formatBytes } from '../../lib/format';
import { findPreset } from '../../lib/presets';
import type { QueueItem } from '../../lib/types';
import { useApp } from '../../state/AppContext';
import { Button, focusRing, Keycap } from '../ui/Button';
import { inputClass } from '../ui/Field';
import { stripExtension } from '../../lib/slugify';
import { Icon, Spinner } from '../ui/Icon';
import { messages, presetLabel, translateError } from '../../i18n';
import { useT } from '../../i18n/useT';
import { useListReorder } from '../../hooks/useListReorder';

const Thumbnail = ({ bitmap, width, height }: { bitmap: ImageBitmap; width: number; height: number }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    // Cover the thumbnail box, like object-fit: cover.
    const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
    const drawWidth = bitmap.width * scale;
    const drawHeight = bitmap.height * scale;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, (canvas.width - drawWidth) / 2, (canvas.height - drawHeight) / 2, drawWidth, drawHeight);
  }, [bitmap, width, height]);
  return <canvas ref={canvasRef} aria-hidden="true" className="shrink-0 rounded-sm bg-sunken" style={{ width, height }} />;
};

/** Size, or what the item is waiting for. Used as visible status and in the accessible name. */
const statusText = (item: QueueItem): string => {
  const q = messages().queue;
  if (item.status === 'error') return q.error(item.error ? translateError(item.error) : q.unknownError);
  if (item.output && item.outputRevision === item.revision) return formatBytes(item.output.blob.size);
  if (item.status === 'encoding') return q.encoding;
  if (item.output) return q.outdatedSize(formatBytes(item.output.blob.size));
  return q.waiting;
};

const Status = ({ item }: { item: QueueItem }) => {
  const t = useT();
  if (item.status === 'error') return <span className="truncate text-danger">{t.queue.error(item.error ? translateError(item.error) : t.queue.unknownError)}</span>;
  const current = item.output && item.outputRevision === item.revision;
  if (current && item.output) return <span className="font-mono">{formatBytes(item.output.blob.size)}</span>;
  if (item.status === 'encoding')
    return (
      <span className="flex items-center gap-1.5">
        <Spinner className="size-2.5" /> {t.queue.encoding}
      </span>
    );
  if (item.output)
    return (
      <span className="flex items-center gap-1.5">
        <s className="font-mono">{formatBytes(item.output.blob.size)}</s> {t.queue.outdated}
      </span>
    );
  return <span>{t.queue.waiting}</span>;
};

/** Inline name editor. Only the part before the extension is edited; the extension is kept. */
const RenameField = ({ item, onDone }: { item: QueueItem; onDone: () => void }) => {
  const { dispatch } = useApp();
  const t = useT();
  const base = stripExtension(item.sourceName);
  const extension = item.sourceName.slice(base.length);
  const [draft, setDraft] = useState(base);
  const done = useRef(false);

  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const name = draft.trim();
    if (commit && name && name !== base) {
      dispatch({ type: 'renameItem', id: item.id, name: `${name}${extension}` });
      dispatch({ type: 'announce', message: t.queue.renamed(`${name}${extension}`) });
    }
    onDone();
  };

  return (
    <input
      autoFocus
      value={draft}
      aria-label={t.queue.nameField}
      spellCheck={false}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(true);
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
      }}
      className={cn(inputClass, 'h-7 px-1.5 font-semibold max-lg:h-9')}
    />
  );
};

export const QueuePanel = () => {
  const { state, dispatch, removeItem, selectedItem } = useApp();
  const t = useT();
  const listRef = useRef<HTMLUListElement>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const moveItem = (id: string, index: number) => {
    const item = state.items.find((candidate) => candidate.id === id);
    if (!item) return;
    dispatch({ type: 'moveItem', id, index });
    dispatch({ type: 'announce', message: t.queue.moved(item.sourceName, index + 1, state.items.length) });
  };
  // Drag a row to reorder; a short move threshold keeps plain clicks selecting.
  const { drag, start: startDrag } = useListReorder(listRef, moveItem);

  const stopRenaming = (id: string) => {
    setRenaming(null);
    // Give focus back to the row, so keyboard users stay in place.
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-item="${id}"]`)?.focus());
  };

  // Keep the selected image in view when N/P moves through a long queue.
  useEffect(() => {
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [state.selectedId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between px-4">
        <h2 className="text-xs font-semibold text-ink-3">
          {t.queue.title} <span className="font-mono text-ink">{state.items.length}</span>
        </h2>
        <span className="flex items-center gap-1" title={t.queue.previousNext}>
          <Keycap>P</Keycap>
          <Keycap>N</Keycap>
        </span>
      </div>
      <ul ref={listRef} aria-label={t.queue.list} className="relative min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {state.items.map((item, index) => {
          const selected = item.id === state.selectedId;
          if (renaming === item.id) {
            return (
              <li key={item.id} className="flex items-center gap-2.5 rounded-md bg-raised p-2 ring-1 ring-line-strong ring-inset">
                <Thumbnail bitmap={item.editedBitmap ?? item.sourceBitmap} width={44} height={32} />
                <span className="min-w-0 flex-1">
                  <RenameField item={item} onDone={() => stopRenaming(item.id)} />
                </span>
              </li>
            );
          }
          return (
            <li
              key={item.id}
              data-reorder-id={item.id}
              onPointerDown={(event) => {
                // Mouse and pen only: on touch screens a vertical drag scrolls the list.
                if (event.pointerType === 'touch' || !(event.target instanceof Element && event.target.closest('[data-item]'))) return;
                startDrag(event, item.id, index, 6);
              }}
              className={cn('group relative select-none', { 'z-10 rounded-md bg-raised shadow-float': drag?.id === item.id })}
              style={drag?.id === item.id ? { transform: `translateY(${drag.offset}px)` } : undefined}
            >
              <button
                type="button"
                data-item={item.id}
                aria-current={selected ? 'true' : undefined}
                aria-label={`${index + 1}. ${item.sourceName}, ${statusText(item)}`}
                aria-keyshortcuts="F2 Alt+ArrowUp Alt+ArrowDown"
                onClick={() => dispatch({ type: 'selectItem', id: item.id })}
                onKeyDown={(event) => {
                  if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                    // Alt + arrows move the image in the queue; focus stays on it.
                    event.preventDefault();
                    const target = index + (event.key === 'ArrowUp' ? -1 : 1);
                    if (target < 0 || target >= state.items.length) return;
                    moveItem(item.id, target);
                    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-item="${item.id}"]`)?.focus());
                    return;
                  }
                  if (event.key !== 'F2') return;
                  event.preventDefault();
                  setRenaming(item.id);
                }}
                className={cn('flex w-full min-w-0 items-center gap-2.5 rounded-md p-2 pr-15 text-left', focusRing, {
                  'bg-raised ring-1 ring-line-strong ring-inset': selected,
                  'hover:bg-sunken/60': !selected,
                })}
              >
                <Thumbnail bitmap={item.editedBitmap ?? item.sourceBitmap} width={44} height={32} />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn('block truncate', { 'font-semibold': selected })}
                    title={t.queue.renameTitle}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      setRenaming(item.id);
                    }}
                  >
                    {item.sourceName}
                  </span>
                  <span className="flex text-xs text-ink-3">
                    <Status item={item} />
                  </span>
                </span>
              </button>
              <button
                type="button"
                aria-label={t.queue.rename(item.sourceName)}
                title={t.queue.renameTitle}
                onClick={() => setRenaming(item.id)}
                className={cn(
                  'absolute top-1/2 right-8 flex size-6 -translate-y-1/2 items-center justify-center rounded text-ink-3 hover:bg-sunken hover:text-ink',
                  'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
                  { 'opacity-100': selected },
                  focusRing,
                )}
              >
                <Icon name="pencil" className="size-3.5" />
              </button>
              <button
                type="button"
                aria-label={t.queue.remove(item.sourceName)}
                onClick={() => removeItem(item.id)}
                className={cn(
                  'absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded text-ink-3 hover:bg-sunken hover:text-ink',
                  'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
                  { 'opacity-100': selected },
                  focusRing,
                )}
              >
                <Icon name="close" />
              </button>
            </li>
          );
        })}
        {drag && drag.indicator !== null ? (
          <li aria-hidden="true" className="pointer-events-none absolute inset-x-2 z-20 h-0.5 -translate-y-1/2 rounded-full bg-accent" style={{ top: drag.indicator }} />
        ) : null}
      </ul>
      {state.items.length > 1 && selectedItem ? (
        <div className="shrink-0 border-t border-line p-2">
          <Button
            className="w-full"
            onClick={() => {
              dispatch({ type: 'applyPresetToAll', presetId: selectedItem.presetId });
              dispatch({ type: 'announce', message: t.queue.appliedToAll(presetLabel(findPreset(state.presets, selectedItem.presetId))) });
            }}
          >
            <span className="truncate">{t.queue.applyToAll(presetLabel(findPreset(state.presets, selectedItem.presetId)))}</span>
          </Button>
        </div>
      ) : null}
    </div>
  );
};

/** Mobile: the queue as a horizontally scrolling strip of thumbnails. */
export const MobileQueueStrip = () => {
  const { state, dispatch, removeItem } = useApp();
  const t = useT();
  if (state.items.length === 0) return null;
  return (
    <ul aria-label={t.queue.list} className="flex shrink-0 gap-3 overflow-x-auto overscroll-x-contain border-b border-line bg-panel px-4 pt-3 pb-2">
      {state.items.map((item, index) => {
        const selected = item.id === state.selectedId;
        return (
          <li key={item.id} className="relative shrink-0">
            <button
              type="button"
              aria-current={selected ? 'true' : undefined}
              aria-label={`${index + 1}. ${item.sourceName}, ${statusText(item)}`}
              onClick={() => dispatch({ type: 'selectItem', id: item.id })}
              className={cn('block rounded-md p-0.5', focusRing, { 'ring-2 ring-primary': selected, 'opacity-80': !selected })}
            >
              <Thumbnail bitmap={item.editedBitmap ?? item.sourceBitmap} width={56} height={44} />
              {item.status === 'error' ? (
                <span aria-hidden="true" className="absolute top-1 left-1 size-2 rounded-full bg-danger-solid" />
              ) : item.status === 'encoding' ? (
                <span aria-hidden="true" className="absolute top-1 left-1 text-on-primary">
                  <Spinner className="size-2.5" />
                </span>
              ) : null}
            </button>
            {selected ? (
              <button
                type="button"
                aria-label={t.queue.remove(item.sourceName)}
                onClick={() => removeItem(item.id)}
                className={cn(
                  // The visible dot is 20px; the ::before extends the touch target to 44px.
                  'absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-primary text-on-primary before:absolute before:-inset-3',
                  focusRing,
                )}
              >
                <Icon name="close" className="size-3" />
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
};
