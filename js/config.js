// Supabase project used for accounts, rankings and realtime multiplayer.
// The publishable key is safe to ship in client code; Row Level Security protects the data.
export const SUPABASE_URL = 'https://xchruhouswgbakgovzus.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_tkHFJJC5lY6JHHijfV5I-g_LrRaQOuy';
// Cloudflare Turnstile (sign-up / sign-in bot protection). The secret key lives only in Supabase.
export const TURNSTILE_SITE_KEY = '0x4AAAAAAF8-kZzPxxkUI0iP';
// Off while Supabase's CAPTCHA protection is off. Turn both back on together, or sign-in breaks.
export const TURNSTILE_ENABLED = false;
// Hard-coded maintenance, for when the database itself is down (a Supabase upgrade or restore), so the
// admin panel's Maintenance switch can't be used. A message here puts everyone (the admin too) on the
// maintenance screen without touching the database; null turns it off. Open games check this file every
// 30 seconds, so players already playing are moved to the screen, and let back in once it's null again.
export const FORCED_MAINTENANCE = 'Battle World is getting a database upgrade. It should be back within the hour. This page reloads by itself when it’s over.';
// MAJOR.Minor.patch, bumped with every change; each version is listed in CHANGELOG.md.
export const GAME_VERSION = '4.17.0';
// Effective date of TERMS.md and PRIVACY.md. Change it when either changes meaningfully, so every
// player is told once (see ui/legal.js).
export const LEGAL_VERSION = '2026-11-24';
// GitHub repository, for the latest-commit link in the menu footer.
export const GITHUB_REPO = 'cksarge/Battle-World';
