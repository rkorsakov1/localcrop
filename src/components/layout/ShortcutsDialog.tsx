import { useT } from '../../i18n/useT';
import { Keycap } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { IS_MAC } from './SettingsPanel';

export const ShortcutsDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const t = useT();
  const s = t.shortcuts;
  const MOD = IS_MAC ? '⌘' : s.mod;
  const SHORTCUTS: [string[][], string][] = [
    [[[MOD, 'V']], s.paste],
    [[[MOD, 'S'], [s.enter]], s.download],
    [[[MOD, '⇧', 'C']], s.copy],
    [[['N'], ['P']], s.nextPrevious],
    [[['Alt', '↑'], ['Alt', '↓']], s.reorder],
    [[['F2']], s.rename],
    [[['C'], ['E'], ['B'], ['V']], s.modes],
    [[['R']], s.resetCrop],
    [[['←↑↓→']], s.nudge],
    [[['+'], ['−']], s.resize],
    [[['⇧', s.drag]], s.keepRatio],
    [[[MOD, '+'], [MOD, '−']], s.zoom],
    [[[MOD, '0'], ['⇧', '0']], s.zoomFit],
    [[[s.space, s.drag]], s.pan],
    [[['['], [']']], s.brushSize],
    [[['X']], s.toggleErase],
    [[[MOD, 'Z']], s.undo],
    [[[MOD, '⇧', 'Z']], s.redo],
    [[['?']], s.help],
  ];

  return (
    <Dialog open={open} onClose={onClose} title={s.title} className="lg:w-[min(46rem,calc(100vw-2rem))]">
      <dl className="grid gap-x-8 gap-y-0 sm:grid-cols-2">
        {SHORTCUTS.map(([combos, action]) => (
          <div key={action} className="flex min-h-9 items-center justify-between gap-4 border-b border-line py-1.5">
            <dt className="text-[13px] text-ink-2">{action}</dt>
            <dd className="flex shrink-0 items-center gap-1.5">
              <span className="sr-only">{combos.map((combo) => combo.join('+')).join(` ${s.or} `)}</span>
              {combos.map((combo) => (
                <span key={combo.join('+')} className="flex items-center gap-0.5">
                  {combo.map((key) => (
                    <Keycap key={key}>{key}</Keycap>
                  ))}
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-ink-3">{s.note}</p>
    </Dialog>
  );
};
