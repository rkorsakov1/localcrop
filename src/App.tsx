import { useEffect, useState } from 'react';
import { CanvasArea, MODES, UndoRedo } from './components/layout/CanvasArea';
import { Footer } from './components/layout/Footer';
import { Notices } from './components/layout/Notices';
import { MobileQueueStrip, QueuePanel } from './components/layout/QueuePanel';
import { MobileDownloadBar, OutputDock, SettingsForm, useCopyOutput } from './components/layout/SettingsPanel';
import { HelpDialog } from './components/layout/HelpDialog';
import { LanguageToggle, ThemeToggle, useApplyTheme } from './components/layout/ThemeToggle';
import { FilePickers, WindowDropTarget } from './components/input/DropZone';
import { PasteListener } from './components/input/PasteListener';
import { UrlInput } from './components/input/UrlInput';
import { SharedPresetDialog } from './components/presets/SharedPresetDialog';
import { Button } from './components/ui/Button';
import { Dialog } from './components/ui/Dialog';
import { BrandMark, Icon } from './components/ui/Icon';
import { useDebouncedEncode } from './hooks/useDebouncedEncode';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useIsDesktop } from './hooks/useMediaQuery';
import { useKeyboardInset } from './hooks/useScrollLock';
import { cn } from './lib/cn';
import { consumeLaunchedFiles, registerServiceWorker } from './pwa/registerServiceWorker';
import { AppProvider, useApp } from './state/AppContext';
import { messages } from './i18n';
import { useHistoryShortcuts } from './state/history';
import { useT } from './i18n/useT';

const PrivacyPill = ({ iconOnly }: { iconOnly: boolean }) => {
  const t = useT();
  return (
    <span
      className={cn('flex h-6.5 shrink-0 items-center gap-1.5 rounded-full bg-success-bg text-xs font-medium text-success', iconOnly ? 'w-6.5 justify-center' : 'pr-2.5 pl-2')}
      title={t.app.privacy}
    >
      <Icon name="lock" className="size-3.5" strokeWidth={1.8} />
      <span className={iconOnly ? 'sr-only' : undefined}>{t.app.privacy}</span>
    </span>
  );
};

const Shell = () => {
  const { state, dispatch, selectedItem, downloadItem, addFiles, notify } = useApp();
  const t = useT();
  const reference = useDebouncedEncode();
  const desktop = useIsDesktop();
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useKeyboardInset();
  useHistoryShortcuts(dispatch);
  useApplyTheme(state.prefs.theme);

  useEffect(() => {
    registerServiceWorker((activate) => notify('info', messages().app.newVersion, { label: messages().app.reload, run: activate }, true));
    consumeLaunchedFiles((files) => void addFiles(files));
  }, [addFiles, notify]);

  const copyOutput = useCopyOutput();
  useKeyboardShortcuts({
    download: () => {
      if (selectedItem) downloadItem(selectedItem);
    },
    copy: () => {
      if (selectedItem?.output && selectedItem.outputRevision === selectedItem.revision) void copyOutput(selectedItem);
    },
    next: () => dispatch({ type: 'selectRelative', offset: 1 }),
    previous: () => dispatch({ type: 'selectRelative', offset: -1 }),
    resetCrop: () => {
      if (selectedItem) dispatch({ type: 'setCrop', id: selectedItem.id, crop: null });
    },
    setMode: (mode) => {
      if (MODES.some((entry) => entry.mode === mode)) dispatch({ type: 'setMode', mode });
    },
    help: () => setHelpOpen(true),
  });

  const hasItems = state.items.length > 0;

  return (
    <div className="flex min-h-dvh flex-col bg-app text-ink lg:h-dvh">
      <header className="sticky top-0 z-30 flex h-13 shrink-0 items-center gap-3 border-b border-line bg-panel px-4 pt-[env(safe-area-inset-top)] max-lg:h-[calc(3.25rem+env(safe-area-inset-top))] lg:static lg:gap-4">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          {/* On phones the wordmark gives way to the editing buttons once there are images. */}
          <h1 className={cn('text-[15px] font-[650] tracking-[-.01em]', { 'max-lg:sr-only': hasItems })}>LocalCrop</h1>
        </div>
        <PrivacyPill iconOnly={!desktop} />
        <div className="flex-1" />
        {hasItems ? (
          <div className="flex items-center gap-2 max-lg:gap-0">
            {desktop ? <UrlInput variant="header" /> : <UndoRedo />}
            <FilePickers variant={desktop ? 'header' : 'icons'} />
          </div>
        ) : null}
        <div className="flex items-center">
          <LanguageToggle />
          <ThemeToggle />
          {desktop ? null : (
            // Phones have no footer, so Help lives here.
            <Button variant="ghost" size="icon" onClick={() => setHelpOpen(true)} aria-label={t.help.title} className="font-mono text-[15px] font-semibold">
              ?
            </Button>
          )}
        </div>
      </header>

      {desktop ? (
        <main
          className={cn('grid min-h-0 flex-1', {
            'grid-cols-[240px_minmax(0,1fr)_340px]': hasItems,
            'grid-cols-[minmax(0,1fr)_340px]': !hasItems,
          })}
        >
          {hasItems ? (
            <section aria-label={t.app.images} className="flex min-h-0 flex-col border-r border-line bg-panel">
              <QueuePanel />
            </section>
          ) : null}
          <section aria-label={t.app.editor} className="flex min-h-0 min-w-0 flex-col">
            <CanvasArea reference={reference} />
          </section>
          <section aria-label={t.app.outputSettings} className="flex min-h-0 flex-col border-l border-line bg-panel">
            <div className={cn('min-h-0 flex-1 overflow-y-auto p-4', { 'pointer-events-none opacity-45': !hasItems })} inert={!hasItems}>
              <SettingsForm />
            </div>
            <div className="flex-none border-t border-line bg-raised p-4">
              <OutputDock />
            </div>
          </section>
        </main>
      ) : (
        <main className="flex flex-1 flex-col">
          {hasItems ? <MobileQueueStrip /> : null}
          <section aria-label={t.app.editor} className="flex min-w-0 flex-1 flex-col">
            <CanvasArea reference={reference} />
          </section>
          {selectedItem ? <MobileDownloadBar onOpenSettings={() => setSettingsOpen(true)} /> : null}
          <Dialog open={settingsOpen && selectedItem !== null} onClose={() => setSettingsOpen(false)} title={t.app.settings} sheet>
            <div className="space-y-5">
              <SettingsForm />
              <div className="border-t border-line pt-4">
                <OutputDock showActions={false} />
              </div>
            </div>
          </Dialog>
        </main>
      )}

      <Footer onShowShortcuts={() => setHelpOpen(true)} />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <SharedPresetDialog />
      <Notices />
      <WindowDropTarget />
      <PasteListener />
    </div>
  );
};

export const App = () => (
  <AppProvider>
    <Shell />
  </AppProvider>
);
