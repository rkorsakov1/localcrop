import { useState } from 'react';
import { useT } from '../../i18n/useT';
import { Keycap, Segmented } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { IS_MAC } from './SettingsPanel';

type Tab = 'guide' | 'shortcuts';

/** A short tour of what each part of the app does, one line per feature. */
const Guide = () => {
  const t = useT();
  return (
    <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
      {t.help.sections.map((section) => (
        <section key={section.title}>
          <h3 className="mb-1.5 text-[13px] font-semibold">{section.title}</h3>
          <ul className="space-y-1.5 text-[13px] text-ink-2">
            {section.items.map(([lead, text]) => (
              <li key={lead}>
                <strong className="font-medium text-ink">{lead}</strong> {text}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};

const Shortcuts = () => {
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
    <>
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
    </>
  );
};

/** Help (press ?): a concise guide to the features, and the keyboard shortcuts. */
export const HelpDialog = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const t = useT();
  const [tab, setTab] = useState<Tab>('guide');
  return (
    <Dialog open={open} onClose={onClose} title={t.help.title} className="lg:w-[min(50rem,calc(100vw-2rem))]">
      <Segmented<Tab>
        label={t.help.title}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'guide', label: t.help.guide },
          { value: 'shortcuts', label: t.shortcuts.title },
        ]}
        className="mb-4"
      />
      {tab === 'guide' ? <Guide /> : <Shortcuts />}
    </Dialog>
  );
};
