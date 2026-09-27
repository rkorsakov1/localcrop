import type { ReactNode } from 'react';
import type { ZoomControls } from '../../hooks/useZoomView';
import { cn } from '../../lib/cn';
import { useT } from '../../i18n/useT';
import { focusRing } from '../ui/Button';
import { Icon } from '../ui/Icon';

/** Row 2 of the canvas column: one fixed-height toolbar per mode that scrolls sideways instead of wrapping. */
export const Toolbar = ({ label, children, className }: { label: string; children: ReactNode; className?: string }) => (
  <div
    role="toolbar"
    aria-label={label}
    className={cn(
      'flex h-10 shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] max-lg:h-12 max-lg:px-4 [&::-webkit-scrollbar]:hidden',
      className,
    )}
  >
    {children}
  </div>
);

export const ToolbarDivider = () => <span aria-hidden="true" className="mx-1.5 h-5 w-px shrink-0 bg-line-strong" />;

/** The canvas stage: sunken surface with a dot grid. Pointer drags inside never scroll the page. */
export const Stage = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div
    className={cn(
      'relative min-h-72 flex-1 touch-none overflow-hidden rounded-lg bg-sunken bg-[radial-gradient(var(--color-dot)_1px,transparent_1px)] bg-size-[16px_16px] select-none',
      'max-lg:min-h-[56vh] max-lg:rounded-none',
      className,
    )}
  >
    {children}
  </div>
);

/** A small note floating at the bottom-left of the stage. */
export const HintChip = ({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'busy' }) => (
  <p
    aria-live="polite"
    className={cn(
      'pointer-events-none absolute bottom-3 left-3 z-10 max-w-[min(26rem,calc(100%-1.5rem))] lg:max-w-[min(26rem,calc(100%-12rem))] rounded-md px-2.5 py-1.5 text-xs shadow-float',
      tone === 'busy' ? 'bg-primary text-on-primary' : 'bg-raised text-ink-2',
    )}
  >
    {children}
  </p>
);

const zoomButton = cn('flex h-7 min-w-7 items-center justify-center rounded px-1 text-ink-2 hover:bg-sunken hover:text-ink max-lg:h-10 max-lg:min-w-10', focusRing);

/** Zoom out / level / zoom in / fit, floating at the bottom-right of the stage. */
export const ZoomControl = ({ controls, className }: { controls: ZoomControls; className?: string }) => {
  const t = useT();
  const percent = Math.round(controls.zoom * 100);
  return (
    <div role="group" aria-label={t.zoom.label} className={cn('absolute right-3 bottom-3 z-10 flex items-center gap-0.5 rounded-md bg-raised p-0.5 shadow-float max-lg:top-3 max-lg:bottom-auto', className)}>
      <button type="button" className={zoomButton} onClick={controls.zoomOut} aria-label={t.zoom.out} title={t.zoom.outTitle} aria-keyshortcuts="Control+Minus Meta+Minus">
        <Icon name="minus" />
      </button>
      <button
        type="button"
        className={cn(zoomButton, 'w-12 font-mono text-[11px] tabular-nums')}
        onClick={controls.isFit ? controls.actualSize : controls.fit}
        aria-label={t.zoom.level(percent, controls.isFit)}
        title={controls.isFit ? t.zoom.actualTitle : t.zoom.fitTitle}
      >
        {percent}%
      </button>
      <button type="button" className={zoomButton} onClick={controls.zoomIn} aria-label={t.zoom.in} title={t.zoom.inTitle} aria-keyshortcuts="Control+= Meta+=">
        <Icon name="plus" />
      </button>
      <button
        type="button"
        className={cn(zoomButton, { 'text-ink-3 opacity-45': controls.isFit })}
        onClick={controls.fit}
        disabled={controls.isFit}
        aria-label={t.zoom.fit}
        title={t.zoom.fitTitle}
        aria-keyshortcuts="Control+0 Meta+0"
      >
        <Icon name="fit" />
      </button>
    </div>
  );
};

/** Cursor classes for a stage while Space is held (grab) or a pan drag is under way (grabbing). */
export const panCursor = (controls: ZoomControls) =>
  cn({ 'cursor-grab!': controls.panMode === 'ready', 'cursor-grabbing!': controls.panMode === 'dragging' });
