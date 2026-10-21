'use client';

import { useState } from 'react';
import { DraftLengthWarning } from '@/components/draft-length-warning';
import { cn } from '@/lib/utils';
import type { OutreachMessageType } from '@/types/job';

interface OutreachDraftCardProps {
  draftText: string;
  messageType: OutreachMessageType;
}

export function OutreachDraftCard({ draftText, messageType }: OutreachDraftCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div>
      <p
        className={cn(
          'text-muted-foreground text-sm',
          expanded ? 'max-h-48 overflow-y-auto' : 'line-clamp-3',
        )}
        tabIndex={expanded ? 0 : undefined}
      >
        {draftText}
      </p>
      <DraftLengthWarning messageType={messageType} text={draftText} />
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((prev) => !prev)}
        className="text-muted-foreground hover:text-foreground mt-1 text-xs underline"
      >
        {expanded ? 'Collapse' : 'Show full message'}
      </button>
    </div>
  );
}
