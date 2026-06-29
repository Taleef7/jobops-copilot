'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

interface OutreachDraftCardProps {
  draftText: string;
}

export function OutreachDraftCard({ draftText }: OutreachDraftCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <p
        className={cn(
          'text-muted-foreground text-sm',
          expanded ? 'max-h-48 overflow-y-auto' : 'line-clamp-3',
        )}
      >
        {draftText}
      </p>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="text-muted-foreground hover:text-foreground mt-1 text-xs underline"
      >
        {expanded ? 'Collapse' : 'Show full message'}
      </button>
    </div>
  );
}
