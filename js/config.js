// Supabase project used for accounts, rankings and realtime multiplayer.
// The publishable key is safe to ship in client code; Row Level Security protects the data.
export const SUPABASE_URL = 'https://xchruhouswgbakgovzus.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_tkHFJJC5lY6JHHijfV5I-g_LrRaQOuy';
// Cloudflare Turnstile (sign-up / sign-in bot protection). The secret key lives only in Supabase.
export const TURNSTILE_SITE_KEY = '0x4AAAAAAF8-kZzPxxkUI0iP';
// Off while Supabase's CAPTCHA protection is off. Turn both back on together, or sign-in breaks.
export const TURNSTILE_ENABLED = false;
// MAJOR.Minor.patch, bumped with every change; each version is listed in CHANGELOG.md.
export const GAME_VERSION = '4.14.0';
// Effective date of TERMS.md and PRIVACY.md. Change it when either changes meaningfully, so every
// player is told once (see ui/legal.js).
export const LEGAL_VERSION = '2026-11-18';
// GitHub repository, for the latest-commit link in the menu footer.
export const GITHUB_REPO = 'cksarge/Battle-World';
