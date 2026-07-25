import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/**
 * Pick an option from a design-system `OptionSelect`.
 *
 * The filters and form dropdowns used to be native `<select>` elements, which
 * tests drove with `user.selectOptions`. They are Base UI comboboxes now — a
 * button that opens a listbox popup — so `selectOptions` no longer applies.
 * This drives the control the way a user does: open the trigger, click the
 * option by its visible label.
 */
export async function chooseOption(user: UserEvent, filterName: RegExp, optionLabel: RegExp) {
  await user.click(screen.getByRole('combobox', { name: filterName }));
  const listbox = await screen.findByRole('listbox');
  await user.click(within(listbox).getByRole('option', { name: optionLabel }));
}
