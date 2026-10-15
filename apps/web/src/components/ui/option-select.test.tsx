import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { OptionSelect } from './option-select';

const options = [
  { value: 'discovered', label: 'Discovered' },
  { value: 'applied', label: 'Applied' },
] as const;

function StatusForm({ onSave }: { onSave: () => void }) {
  const [status, setStatus] = useState<(typeof options)[number]['value']>('discovered');
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <OptionSelect aria-label="Status" value={status} onValueChange={setStatus} options={options} />
      <button type="submit">Save changes</button>
    </form>
  );
}

async function openStatus(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('combobox', { name: 'Status' }));
  return screen.findByRole('listbox');
}

/**
 * A modal Base UI select lays a fixed, page-sized layer over the app while it is open, so
 * the first click anywhere else only closes the popup (#353). jsdom has no hit testing,
 * so this looks for the layer itself.
 */
function pageCover() {
  return [...document.querySelectorAll<HTMLElement>('[role="presentation"]')].find(
    (element) => element.style.position === 'fixed' && element.style.inset === '0px',
  );
}

it('leaves the rest of the page clickable while the popup is open', async () => {
  const user = userEvent.setup();
  render(<StatusForm onSave={vi.fn()} />);

  await openStatus(user);

  expect(pageCover()).toBeUndefined();
});

it('closes on Escape', async () => {
  const user = userEvent.setup();
  render(<StatusForm onSave={vi.fn()} />);

  await openStatus(user);
  await user.keyboard('{Escape}');

  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
});

it('closes on a click outside, and that click lands', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  render(<StatusForm onSave={onSave} />);

  await openStatus(user);
  await user.click(screen.getByRole('button', { name: 'Save changes' }));

  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  expect(onSave).toHaveBeenCalledTimes(1);
});

it('closes after a selection, and Save changes takes the next click', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  render(<StatusForm onSave={onSave} />);

  const listbox = await openStatus(user);
  await user.click(within(listbox).getByRole('option', { name: 'Applied' }));
  await user.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent('Applied');
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(pageCover()).toBeUndefined();
});
