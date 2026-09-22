import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ExtTokensManager } from './ext-tokens-manager';
import * as api from '@/lib/api';
import type { ExtTokenItem } from '@/types/job';

vi.mock('@/lib/api', () => ({
  createExtToken: vi.fn(),
  revokeExtToken: vi.fn(),
}));

describe('ExtTokensManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockTokens: ExtTokenItem[] = [
    {
      id: 'token-1',
      userId: 'u1',
      label: 'Chrome MacBook',
      createdAt: '2026-05-14T10:00:00Z',
      lastUsedAt: '2026-05-15T12:00:00Z',
    },
  ];

  it('renders empty state when there are no tokens', () => {
    render(<ExtTokensManager initialTokens={[]} />);
    expect(screen.getByText('No personal access tokens')).toBeInTheDocument();
  });

  it('renders existing tokens with their labels and active status', () => {
    render(<ExtTokensManager initialTokens={mockTokens} />);
    expect(screen.getByText('Chrome MacBook')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('generates a new token and displays raw token in prominent banner', async () => {
    vi.mocked(api.createExtToken).mockResolvedValueOnce({
      token: {
        id: 'token-new',
        userId: 'u1',
        label: 'Work Laptop Chrome',
        createdAt: new Date().toISOString(),
      },
      rawToken: 'jop_abcdef0123456789abcdef0123456789abcdef0123456789',
    });

    render(<ExtTokensManager initialTokens={[]} />);

    const input = screen.getByPlaceholderText(/Token label/i);
    fireEvent.change(input, { target: { value: 'Work Laptop Chrome' } });

    const generateBtn = screen.getByRole('button', { name: /Generate new token/i });
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(api.createExtToken).toHaveBeenCalledWith('Work Laptop Chrome');
    });

    // Verify raw token banner is shown
    expect(screen.getByText('Personal Access Token Generated')).toBeInTheDocument();
    const tokenDisplay = screen.getByLabelText('New Personal Access Token') as HTMLInputElement;
    expect(tokenDisplay.value).toBe('jop_abcdef0123456789abcdef0123456789abcdef0123456789');

    // Verify token is in the list
    expect(screen.getByText('Work Laptop Chrome')).toBeInTheDocument();
  });

  it('allows revoking a token after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.revokeExtToken).mockResolvedValueOnce(undefined);

    render(<ExtTokensManager initialTokens={mockTokens} />);

    const revokeBtn = screen.getByLabelText(/Revoke token Chrome MacBook/i);
    fireEvent.click(revokeBtn);

    await waitFor(() => {
      expect(api.revokeExtToken).toHaveBeenCalledWith('token-1');
    });

    expect(screen.queryByText('Chrome MacBook')).not.toBeInTheDocument();
  });
});
