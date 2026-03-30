'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/hooks/useTranslation';
import { Lock, Eye, EyeOff, AlertCircle } from 'lucide-react';

interface TokenGateProps {
  onAuthenticated: (token: string) => void;
}

const AUTH_TOKEN_KEY = 'codepilot:auth_token';

/** Read stored auth token from localStorage. */
export function getStoredAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

/** Store auth token in localStorage. */
export function setStoredAuthToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

/** Clear auth token from localStorage. */
export function clearStoredAuthToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

export function TokenGate({ onAuthenticated }: TokenGateProps) {
  const { t } = useTranslation();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!token.trim() || loading) return;

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });

      if (res.ok) {
        setStoredAuthToken(token.trim());
        onAuthenticated(token.trim());
      } else {
        setError(t('auth.invalidToken'));
      }
    } catch {
      setError(t('auth.networkError'));
    } finally {
      setLoading(false);
    }
  }, [token, loading, onAuthenticated, t]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background">
      <div className="w-full max-w-sm mx-4">
        <form onSubmit={handleSubmit} className="rounded-xl border bg-card shadow-2xl p-8 space-y-6">
          {/* Icon + Title */}
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Lock className="h-6 w-6 text-primary" />
            </div>
            <div className="text-center">
              <h2 className="text-lg font-semibold">{t('auth.title')}</h2>
              <p className="text-sm text-muted-foreground mt-1">{t('auth.subtitle')}</p>
            </div>
          </div>

          {/* Token input */}
          <div className="space-y-2">
            <div className="relative">
              <Input
                ref={inputRef}
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => { setToken(e.target.value); setError(''); }}
                placeholder={t('auth.tokenPlaceholder')}
                className="pr-10"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowToken(!showToken)}
                tabIndex={-1}
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {error && (
              <div className="flex items-center gap-1.5 text-sm text-destructive">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Submit */}
          <Button type="submit" className="w-full" disabled={!token.trim() || loading}>
            {loading ? t('auth.verifying') : t('auth.unlock')}
          </Button>
        </form>
      </div>
    </div>
  );
}
