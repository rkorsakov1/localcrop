import { useCallback, useRef, useState, type RefObject } from 'react';

export type ReorderDrag = {
  id: string;
  /** How far the row has been dragged (px), for moving it with the pointer. */
  offset: number;
  /** Where the drop line goes (px from the list's top), or null before the pointer has moved. */
  indicator: number | null;
};

/** Where a row dragged to `clientY` would land among the other rows (`li[data-reorder-id]`). */
const dropTarget = (list: HTMLElement | null, id: string, clientY: number): { index: number; indicator: number | null } => {
  if (!list) return { index: 0, indicator: null };
  const rows = [...list.querySelectorAll<HTMLElement>('li[data-reorder-id]')].filter((row) => row.dataset.reorderId !== id);
  // In list coordinates, including any scroll of the list itself.
  const top = list.getBoundingClientRect().top - list.scrollTop;
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

/**
 * Drag-to-reorder for a list whose rows are `li[data-reorder-id]`. With `threshold`, the drag only
 * starts once the pointer has moved that far, so a plain click on the row still works (and the
 * click that ends a drag is swallowed).
 */
export const useListReorder = (listRef: RefObject<HTMLElement | null>, onDrop: (id: string, index: number) => void) => {
  const [drag, setDrag] = useState<ReorderDrag | null>(null);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const start = useCallback(
    (event: { button: number; pointerId: number; clientX: number; clientY: number }, id: string, from: number, threshold = 0) => {
      if (event.button !== 0) return;
      const { pointerId, clientX: startX, clientY: startY } = event;
      let active = threshold === 0;
      if (active) setDrag({ id, offset: 0, indicator: null });

      const handleMove = (move: PointerEvent) => {
        if (move.pointerId !== pointerId) return;
        if (!active) {
          if (Math.hypot(move.clientX - startX, move.clientY - startY) < threshold) return;
          active = true;
        }
        move.preventDefault();
        const { indicator } = dropTarget(listRef.current, id, move.clientY);
        setDrag({ id, offset: move.clientY - startY, indicator });
      };
      const handleUp = (up: PointerEvent) => {
        if (up.pointerId !== pointerId) return;
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
        window.removeEventListener('pointercancel', handleUp);
        if (!active) return;
        setDrag(null);
        if (threshold > 0) {
          // The click that follows a drag must not also select the row.
          const swallow = (click: MouseEvent) => click.stopPropagation();
          window.addEventListener('click', swallow, { capture: true, once: true });
          setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
        }
        if (up.type === 'pointercancel') return;
        const { index } = dropTarget(listRef.current, id, up.clientY);
        if (index !== from) onDropRef.current(id, index);
      };
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
      window.addEventListener('pointercancel', handleUp);
    },
    [listRef],
  );

  return { drag, start };
};
