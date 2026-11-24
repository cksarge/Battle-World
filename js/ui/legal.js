// Terms of Service and Privacy Policy agreement. New players tick a box (at sign-up, or before their
// first guest game on a new device); players from before the documents existed, or before they last
// changed, see a one-time notice instead. Agreement is remembered on the device and, for accounts, in
// the database (profiles.legal_version, set at sign-up and by accept_legal), so an account that has
// agreed to the current version isn't asked again on any other device.
import { bindDocLinks } from './changelog.js';
import { LEGAL_VERSION } from '../config.js';

const KEY = 'jps_legal';
// Set on a device's first launch, so it's asked for a tick rather than shown the notice.
const NEW = 'new';

export const AGREE_LABEL = `I'm 13 or older and agree to the <a href="#" data-doc="TERMS.md">Terms of Service</a> and <a href="#" data-doc="PRIVACY.md">Privacy Policy</a>`;

export function markNewDevice() {
  try { if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, NEW); } catch { /* ignore */ }
}

export function acceptLegal(app = null) {
  try { localStorage.setItem(KEY, LEGAL_VERSION); } catch { /* ignore */ }
  // Signed in: remember it on the account too, so other devices don't ask again.
  const p = app?.profile;
  if (app?.user && app.api && p && p.legal_version !== LEGAL_VERSION) {
    p.legal_version = LEGAL_VERSION;
    app.api.acceptLegal(LEGAL_VERSION).catch(() => null);
  }
}

// Shows the notice or the agreement dialog if this player hasn't agreed to the current version here.
// Returns true when a dialog opened; done() runs once it's closed.
export function maybeLegal(ui, done) {
  const app = ui.app, p = app.profile;
  // A menu re-render clears open dialogs, so it's shown again if that happened.
  if (ui.legalOpen?.isConnected) return true;
  if (app.game || (app.user && !p)) return false;
  // The account already agreed to this version (on any device): nothing to show here.
  if (p?.legal_version === LEGAL_VERSION) { try { localStorage.setItem(KEY, LEGAL_VERSION); } catch { /* ignore */ } return false; }
  let seen;
  try { seen = localStorage.getItem(KEY); } catch { return false; }
  // Agreed on this device already (before it was saved to the account): save it to the account now.
  if (seen === LEGAL_VERSION) { acceptLegal(app); return false; }
  if (app.user?.user_metadata?.terms_accepted === LEGAL_VERSION) { acceptLegal(app); return false; }
  const fresh = seen === NEW && !p, updated = !!seen && seen !== NEW;
  const close = (m) => { acceptLegal(app); ui.legalOpen = null; m.remove(); done?.(); };
  const links = `<a href="#" data-doc="TERMS.md">Terms of Service</a> and <a href="#" data-doc="PRIVACY.md">Privacy Policy</a>`;
  const m = fresh
    ? ui.modal(`<h2 class="m-h2">Welcome to Battle World</h2>
      <p class="m-sub">Before you play, please read and agree to the ${links}.</p>
      <label class="m-check"><input type="checkbox" data-agree><span>${AGREE_LABEL}</span></label>
      <div class="row"><button class="btn primary" data-ok disabled>Continue</button></div>`)
    : ui.modal(`<h2 class="m-h2">${updated ? 'Updated terms' : 'Terms and privacy'}</h2>
      <p class="m-sub">Battle World ${updated ? 'has updated its' : 'now has a'} ${links}. By continuing to use the game, you agree to and acknowledge them.</p>
      <div class="row"><button class="btn primary" data-ok>Continue</button></div>`);
  m.dataset.locked = '1';
  ui.legalOpen = m;
  bindDocLinks(m, ui);
  const ok = m.querySelector('[data-ok]'), agree = m.querySelector('[data-agree]');
  if (agree) agree.onchange = () => { ok.disabled = !agree.checked; };
  ok.onclick = () => close(m);
  return true;
}
