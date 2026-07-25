'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type SelectOption<T extends string> = { value: T; label: string };

/**
 * A labelled dropdown built on the design-system `Select`.
 *
 * Exists so the app stops reaching for a native `<select>`. Every dropdown in
 * the product — job status and priority, outreach message type, the jobs
 * filters — was a bare `<select>` styled with a border, so they rendered with
 * OS-native chrome (and an OS-native popup) inside an otherwise custom UI,
 * while `components/ui/select.tsx` sat unused. This keeps the one-line
 * ergonomics of a native select at the call site.
 */
export function OptionSelect<T extends string>({
  id,
  value,
  onValueChange,
  options,
  className,
  size = 'default',
  placeholder,
  'aria-label': ariaLabel,
  disabled,
}: {
  id?: string;
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  className?: string;
  size?: 'sm' | 'default';
  placeholder?: string;
  'aria-label'?: string;
  disabled?: boolean;
}) {
  return (
    <Select
      // `items` lets SelectValue render the option's label rather than the raw
      // value, so "outreach_drafted" shows as "Outreach drafted".
      items={[...options]}
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        size={size}
        aria-label={ariaLabel}
        className={cn('w-full', className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
