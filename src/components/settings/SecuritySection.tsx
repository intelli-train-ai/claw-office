"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/hooks/useTranslation";
import { SettingsCard } from "@/components/patterns/SettingsCard";
import { FieldRow } from "@/components/patterns/FieldRow";
import { authFetch } from "@/lib/api-client";
import { Lock, LockOpen } from "@/components/ui/icon";
import { clearStoredAuthToken } from "@/components/auth/TokenGate";

export function SecuritySection() {
  const { t } = useTranslation();
  const [authEnabled, setAuthEnabled] = useState(false);
  const [tokenSource, setTokenSource] = useState<"env" | "db">("db");
  const [editing, setEditing] = useState(false);
  const [newToken, setNewToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await authFetch("/api/auth/status");
      if (res.ok) {
        const data = await res.json();
        setAuthEnabled(data.enabled);
        setTokenSource(data.tokenSource);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleSave = useCallback(async () => {
    if (newToken.length < 6) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await authFetch("/api/auth/token", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: newToken }),
      });
      if (res.ok) {
        setMessage({ type: "success", text: t("settings.security.tokenSaved") });
        setEditing(false);
        setNewToken("");
        fetchStatus();
      } else {
        const data = await res.json().catch(() => ({}));
        setMessage({ type: "error", text: data.error || t("settings.security.tokenError") });
      }
    } catch {
      setMessage({ type: "error", text: t("settings.security.tokenError") });
    } finally {
      setSaving(false);
    }
  }, [newToken, t, fetchStatus]);

  const handleRemove = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await authFetch("/api/auth/token", { method: "DELETE" });
      if (res.ok) {
        setMessage({ type: "success", text: t("settings.security.tokenRemoved") });
        fetchStatus();
      } else {
        setMessage({ type: "error", text: t("settings.security.tokenError") });
      }
    } catch {
      setMessage({ type: "error", text: t("settings.security.tokenError") });
    } finally {
      setSaving(false);
    }
  }, [t, fetchStatus]);

  const handleLogout = useCallback(() => {
    clearStoredAuthToken();
    window.dispatchEvent(new CustomEvent("codepilot:auth-required"));
  }, []);

  const isFromEnv = tokenSource === "env";

  return (
    <div className="space-y-4">
      <SettingsCard>
        <FieldRow
          label={t("settings.security.accessToken")}
          description={t("settings.security.accessTokenDesc")}
        >
          <div className="space-y-3">
            {/* Status indicator */}
            <div className="flex items-center gap-2 text-sm">
              {authEnabled ? (
                <>
                  <Lock size={14} className="text-primary" />
                  <span className="text-primary font-medium">
                    {isFromEnv
                      ? t("settings.security.tokenFromEnv")
                      : t("settings.security.tokenConfigured")}
                  </span>
                </>
              ) : (
                <>
                  <LockOpen size={14} className="text-muted-foreground" />
                  <span className="text-muted-foreground">
                    {t("settings.security.tokenNotConfigured")}
                  </span>
                </>
              )}
            </div>

            {/* Token editing form */}
            {editing ? (
              <div className="flex items-center gap-2">
                <Input
                  type="password"
                  value={newToken}
                  onChange={(e) => setNewToken(e.target.value)}
                  placeholder={t("settings.security.newTokenPlaceholder")}
                  className="max-w-xs"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={newToken.length < 6 || saving}
                >
                  {t("settings.security.save")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setEditing(false); setNewToken(""); setMessage(null); }}
                >
                  {t("settings.security.cancel")}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {!isFromEnv && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setEditing(true); setMessage(null); }}
                    >
                      {authEnabled
                        ? t("settings.security.changeToken")
                        : t("settings.security.setToken")}
                    </Button>
                    {authEnabled && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={handleRemove}
                        disabled={saving}
                      >
                        {t("settings.security.removeToken")}
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Feedback message */}
            {message && (
              <p className={`text-xs ${message.type === "error" ? "text-destructive" : "text-primary"}`}>
                {message.text}
              </p>
            )}
          </div>
        </FieldRow>
      </SettingsCard>

      {/* Logout section */}
      {authEnabled && (
        <SettingsCard>
          <FieldRow
            label={t("settings.security.logout")}
            description={t("settings.security.logoutDesc")}
          >
            <Button size="sm" variant="outline" onClick={handleLogout}>
              {t("auth.logout")}
            </Button>
          </FieldRow>
        </SettingsCard>
      )}
    </div>
  );
}
