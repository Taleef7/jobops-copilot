'use client';

import { useId, useState } from 'react';
import { flushSync } from 'react-dom';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Putting a list in order from the keyboard (#415): Move up and Move down buttons, focus that
 * follows the item moved, and a message for screen readers ("Riccle moved to position 1 of
 * 2"). No dragging: every move is a button press.
 */
export function useReorder() {
  const [message, setMessage] = useState('');
  // The list's element, as a callback ref (`ref={reorder.container}`).
  const [container, setContainer] = useState<HTMLElement | null>(null);
  // Its own buttons carry this, so a list inside one (an entry's bullets) isn't searched.
  const list = useId();

  return {
    container: setContainer,
    list,
    message,
    /**
     * Moves an item (`apply` changes the list) and says where it went. Focus stays on the
     * button pressed, now on the item's new row, or goes to the other one when the item
     * reached the end of the list (the button is disabled there).
     */
    move(apply: () => void, label: string, to: number, count: number, direction: Direction) {
      flushSync(() => {
        apply();
        setMessage(`${label} moved to position ${to + 1} of ${count}`);
      });
      const find = (which: Direction) =>
        container?.querySelector<HTMLButtonElement>(`[data-move-list="${list}"][data-move="${which}"][data-move-index="${to}"]`);
      const button = find(direction);
      (button && !button.disabled ? button : find(direction === 'up' ? 'down' : 'up'))?.focus();
    },
    /** Say something else that changed, such as a section hidden. */
    say: setMessage,
  };
}

export type Direction = 'up' | 'down';

/** The message of a list's moves, read out but not shown. */
export function MoveMessage({ message }: { message: string }) {
  return (
    <p role="status" className="sr-only">
      {message}
    </p>
  );
}

interface MoveButtonsProps {
  /** The list's id, from useReorder. */
  list: string;
  index: number;
  count: number;
  /** What moves, as said in "Move … up". */
  label: string;
  onMove: (to: number, direction: Direction) => void;
  disabled?: boolean;
}

export function MoveButtons({ list, index, count, label, onMove, disabled = false }: MoveButtonsProps) {
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        data-move-list={list}
        data-move="up"
        data-move-index={index}
        aria-label={`Move ${label} up`}
        title="Move up"
        disabled={disabled || index === 0}
        onClick={() => onMove(index - 1, 'up')}
      >
        <ArrowUp aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        data-move-list={list}
        data-move="down"
        data-move-index={index}
        aria-label={`Move ${label} down`}
        title="Move down"
        disabled={disabled || index === count - 1}
        onClick={() => onMove(index + 1, 'down')}
      >
        <ArrowDown aria-hidden="true" />
      </Button>
    </>
  );
}
