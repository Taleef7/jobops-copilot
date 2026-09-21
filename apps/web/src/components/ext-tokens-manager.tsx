'use client';

import { useState } from 'react';
import {
  Check,
  Copy,
  Key,
  Loader2,
  Plus,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { createExtToken, revokeExtToken } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { ExtTokenItem } from '@/types/job';

interface ExtTokensManagerProps {
  initialTokens: ExtTokenItem[];
}

export function ExtTokensManager({ initialTokens }: ExtTokensManagerProps) {
  const [tokens, setTokens] = useState<ExtTokenItem[]>(initialTokens);
  const [label, setLabel] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [newlyCreatedToken, setNewlyCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    const tokenLabel = label.trim() || 'Chrome Extension';
    setIsCreating(true);
    try {
      const res = await createExtToken(tokenLabel);
      setTokens((prev) => [res.token, ...prev]);
      setNewlyCreatedToken(res.rawToken);
      setLabel('');
      toast.success('Access token generated successfully!');
    } catch {
      toast.error('Failed to generate personal access token.');
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRevoke(id: string, tokenLabel: string) {
    if (!window.confirm(`Revoke token "${tokenLabel}"? The Chrome extension using this token will stop working immediately.`)) {
      return;
    }
    setRevokingId(id);
    try {
      await revokeExtToken(id);
      setTokens((prev) => prev.filter((t) => t.id !== id));
      toast.success(`Token "${tokenLabel}" revoked.`);
    } catch {
      toast.error('Failed to revoke access token.');
    } finally {
      setRevokingId(null);
    }
  }

  async function handleCopyToken(token: string) {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(token);
      } else {
        throw new Error('Clipboard API not available');
      }
      setCopied(true);
      toast.success('Token copied to clipboard!');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = token;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setCopied(true);
        toast.success('Token copied to clipboard!');
        setTimeout(() => setCopied(false), 2500);
      } catch {
        toast.error('Failed to copy token.');
      }
    }
  }

  return (
    <div className="space-y-4">
      {/* High-visibility display for newly created raw token */}
      {newlyCreatedToken ? (
        <Card className="border-emerald-500/40 bg-emerald-500/10 space-y-3 p-4">
          <div className="flex items-start gap-2.5">
            <ShieldAlert className="text-emerald-600 dark:text-emerald-400 mt-0.5 size-5 shrink-0" />
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
                Personal Access Token Generated
              </h4>
              <p className="text-muted-foreground text-xs">
                Copy this token now. For your security, it will never be displayed again.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={newlyCreatedToken}
              className="font-mono text-xs font-medium"
              aria-label="New Personal Access Token"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleCopyToken(newlyCreatedToken)}
              className="gap-1.5 shrink-0"
            >
              {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
              {copied ? 'Copied' : 'Copy token'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setNewlyCreatedToken(null)}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              Dismiss
            </Button>
          </div>
        </Card>
      ) : null}

      {/* Creation form */}
      <form onSubmit={handleCreate} className="flex flex-wrap items-center gap-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Token label (e.g. Work Laptop Chrome)"
          className="max-w-xs text-sm"
          disabled={isCreating}
        />
        <Button type="submit" size="sm" disabled={isCreating} className="gap-1.5">
          {isCreating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Generate new token
        </Button>
      </form>

      {/* Token list */}
      {tokens.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-2 p-6 text-center">
          <Key className="text-muted-foreground/50 size-8" />
          <p className="text-sm font-medium">No personal access tokens</p>
          <p className="text-muted-foreground text-xs">
            Generate a token above to connect the JobOps Chrome extension for 1-click ATS autofill.
          </p>
        </Card>
      ) : (
        <ul className="divide-border -my-1 divide-y">
          {tokens.map((token) => (
            <li key={token.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{token.label}</p>
                  <Badge variant="outline" className="border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[10px]">
                    Active
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs">
                  Created {formatDate(token.createdAt)}
                  {' · '}
                  {token.lastUsedAt ? `Last used ${formatDate(token.lastUsedAt)}` : 'Never used'}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRevoke(token.id, token.label)}
                disabled={revokingId === token.id}
                className="text-muted-foreground hover:text-destructive h-8 px-2"
                aria-label={`Revoke token ${token.label}`}
              >
                {revokingId === token.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
