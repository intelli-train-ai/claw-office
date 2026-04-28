import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { ThemeFamilyProvider } from "@/components/layout/ThemeFamilyProvider";
import { I18nProvider } from "@/components/layout/I18nProvider";
import { AppShell } from "@/components/layout/AppShell";
import { getAllThemeFamilies, getThemeFamilyMetas } from "@/lib/theme/loader";
import { renderThemeFamilyCSS } from "@/lib/theme/render-css";
import { getSetting } from "@/lib/db";

export const metadata: Metadata = {
  title: "SafeClaw",
  description: "A multi-model AI agent desktop client",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const families = getAllThemeFamilies();
  const familiesMeta = getThemeFamilyMetas();
  const themeFamilyCSS = renderThemeFamilyCSS(families);
  const validIds = families.map((f) => f.id);

  // Read theme preferences from DB (persisted across sessions).
  // Wrapped in try-catch because during `next build`, multiple worker processes
  // prerender pages concurrently through this layout, all hitting getDb().
  // SQLite cannot handle parallel writes from separate processes ("database is locked").
  let dbThemeMode: string | undefined;
  let dbThemeFamily: string | undefined;
  try {
    dbThemeMode = getSetting('theme_mode') || undefined;
    dbThemeFamily = getSetting('theme_family') || undefined;
  } catch {
    // Build-time or DB unavailable — fall back to localStorage-only theme
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Rebrand: one-shot copy of legacy codepilot:* / codepilot_* localStorage keys to safeclaw:*. Must run before any reader. */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{if(localStorage.getItem('safeclaw:rebrand-migrated'))return;var keys=[];for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&(k.indexOf('codepilot:')===0||k.indexOf('codepilot_')===0))keys.push(k)}for(var j=0;j<keys.length;j++){var ok=keys[j];var nk='safeclaw'+ok.slice(9);var v=localStorage.getItem(ok);if(v!==null&&localStorage.getItem(nk)===null)localStorage.setItem(nk,v);localStorage.removeItem(ok)}localStorage.setItem('safeclaw:rebrand-migrated','1')}catch(e){}})();` }} />
        {/* Anti-FOUC: set data-theme-family from localStorage → DB fallback, validate against known IDs */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var v=${JSON.stringify(validIds)};var db=${JSON.stringify(dbThemeFamily || null)};var f=localStorage.getItem('safeclaw_theme_family')||db||'default';if(v.indexOf(f)<0)f='default';document.documentElement.setAttribute('data-theme-family',f);if(!localStorage.getItem('safeclaw_theme_family')&&f!=='default'){localStorage.setItem('safeclaw_theme_family',f)}}catch(e){}})();` }} />
        {/* Sync DB theme mode to next-themes localStorage if not yet set */}
        {dbThemeMode && (
          <script dangerouslySetInnerHTML={{ __html: `(function(){try{if(!localStorage.getItem('theme')){localStorage.setItem('theme',${JSON.stringify(dbThemeMode)})}}catch(e){}})();` }} />
        )}
        <style id="theme-family-vars" dangerouslySetInnerHTML={{ __html: themeFamilyCSS }} />
      </head>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}
      >
        <ThemeProvider>
          <ThemeFamilyProvider families={familiesMeta}>
            <I18nProvider>
              <AppShell>{children}</AppShell>
            </I18nProvider>
          </ThemeFamilyProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
