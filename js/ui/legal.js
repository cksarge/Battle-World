// Terms of Service and Privacy Policy agreement. New players tick a box (at sign-up, or before their
// first guest game on a new device); players from before the documents existed, or before they last
// changed, see a one-time notice instead. Agreement is remembered per device, and accounts made
// through sign-up carry it in their user metadata so signing in elsewhere doesn't ask again.
import { bindDocLinks } from './changelog.js';
import { LEGAL_VERSION } from '../config.js';

const KEY = 'jps_legal';
// Set on a device's first launch, so it's asked for a tick rather than shown the notice.
const NEW = 'new';

export const AGREE_LABEL = `I'm 13 or older and agree to the <a href="#" data-doc="TERMS.md">Terms of Service</a> and <a href="#" data-doc="PRIVACY.md">Privacy Policy</a>`;

export function markNewDevice() {
  try { if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, NEW); } catch { /* ignore */ }
}

export function acceptLegal() {
  try { localStorage.setItem(KEY, LEGAL_VERSION); } catch { /* ignore */ }
}

// Shows the notice or the agreement dialog if this player hasn't agreed to the current version here.
// Returns true when a dialog opened; done() runs once it's closed.
export function maybeLegal(ui, done) {
  const app = ui.app, p = app.profile;
  // A menu re-render clears open dialogs, so it's shown again if that happened.
  if (ui.legalOpen?.isConnected) return true;
  if (app.game || (app.user && !p)) return false;
  let seen;
  try { seen = localStorage.getItem(KEY); } catch { return false; }
  if (seen === LEGAL_VERSION) return false;
  if (app.user?.user_metadata?.terms_accepted === LEGAL_VERSION) { acceptLegal(); return false; }
  const fresh = seen === NEW && !p, updated = !!seen && seen !== NEW;
  const close = (m) => { acceptLegal(); ui.legalOpen = null; m.remove(); done?.(); };
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
