// The version line in the menu footer: the changelog (CHANGELOG.md, shown in a dialog), the latest
// commit on GitHub, read from GitHub's public API so it updates by itself with every push, and the
// Terms of Service and Privacy Policy (TERMS.md, PRIVACY.md), shown in the same dialog.
import { GAME_VERSION, GITHUB_REPO } from '../config.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COMMIT_KEY = 'jps_latest_commit';
// GitHub allows 60 unauthenticated API calls an hour per address, so the answer is reused for a while.
const COMMIT_TTL = 10 * 60 * 1000;

// The newest commit on main as { sha, url }, or null if GitHub can't be reached and nothing is cached.
export async function latestCommit() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(COMMIT_KEY) || 'null'); } catch { /* ignore */ }
  if (cached?.sha && Date.now() - cached.at < COMMIT_TTL) return cached;
  try {
    const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits/main`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    if (!/^[0-9a-f]{40}$/.test(d.sha)) throw new Error('bad sha');
    const c = { sha: d.sha, url: `https://github.com/${GITHUB_REPO}/commit/${d.sha}`, at: Date.now() };
    try { localStorage.setItem(COMMIT_KEY, JSON.stringify(c)); } catch { /* ignore */ }
    return c;
  } catch {
    return cached?.sha ? cached : null;
  }
}

// Markdown files the game can show in a dialog, with their titles.
const DOCS = { 'CHANGELOG.md': 'Changelog', 'TERMS.md': 'Terms of Service', 'PRIVACY.md': 'Privacy Policy' };

// "Version x.y.z (abc1234) GitHub · Terms · Privacy": the version opens the changelog, the commit
// opens on GitHub.
export function versionHTML() {
  return `<a href="#" class="foot-link" data-doc="CHANGELOG.md">Version ${esc(GAME_VERSION)}</a><span data-commit></span> <a class="foot-link" href="https://github.com/${GITHUB_REPO}" target="_blank" rel="noopener">GitHub</a> · <a href="#" class="foot-link" data-doc="TERMS.md">Terms</a> · <a href="#" class="foot-link" data-doc="PRIVACY.md">Privacy</a>`;
}

// Any [data-doc] link inside root opens that document. Inside a label (the sign-up checkbox) the
// click doesn't tick the box.
export function bindDocLinks(root, ui) {
  root.querySelectorAll('[data-doc]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); e.stopPropagation(); showDoc(ui, a.dataset.doc); }; });
}

export function bindVersion(root, ui) {
  if (!root.querySelector('[data-commit]')) return;
  bindDocLinks(root, ui);
  latestCommit().then((c) => {
    const slot = root.querySelector('[data-commit]');
    if (c && slot) slot.innerHTML = ` (<a class="foot-link" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.sha.slice(0, 7))}</a>)`;
  });
}

// Just enough Markdown for these files: headings, bullet lists, paragraphs, bold, code and links.
// Major versions are ## headings, minor ### and patch ####. Links to the other documents open them here.
function inline(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\[([^\]]+)\]\(([A-Z]+\.md)\)/g, (m, label, file) => (DOCS[file] ? `<a href="#" data-doc="${file}">${label}</a>` : m));
}

function render(md) {
  const out = [];
  let list = false;
  const close = () => { if (list) { out.push('</ul>'); list = false; } };
  for (const line of md.split('\n')) {
    const t = line.trim();
    if (t.startsWith('- ')) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li${/^\s+- /.test(line) ? ' class="cl-sub"' : ''}>${inline(t.slice(2))}</li>`); continue; }
    close();
    if (!t) continue;
    const h = /^(#{1,4}) (.*)$/.exec(t);
    if (h?.[1].length === 1) continue; // the dialog has its own title
    if (h) out.push(`<h3 class="cl-ver ${['', '', 'cl-major', 'cl-minor', 'cl-patch'][h[1].length]}">${inline(h[2])}</h3>`);
    else out.push(`<p class="m-sub">${inline(t)}</p>`);
  }
  close();
  return out.join('');
}

export async function showDoc(ui, file) {
  const title = DOCS[file];
  if (!title) return;
  const m = ui.modal(`<div class="row"><h2 class="m-h2">${title}</h2><span class="spacer"></span><button class="btn small ghost" data-x>Close</button></div><div class="changelog ${file === 'CHANGELOG.md' ? '' : 'legal'}"><p class="m-sub">Loading…</p></div>`, 'changelog-modal');
  m.querySelector('[data-x]').onclick = () => m.remove();
  const body = m.querySelector('.changelog');
  try {
    const r = await fetch(file, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    body.innerHTML = render(await r.text());
    bindDocLinks(body, ui);
  } catch {
    body.innerHTML = file === 'CHANGELOG.md'
      ? `<p class="m-sub">The changelog couldn't be loaded. You're on version ${esc(GAME_VERSION)}.</p>`
      : `<p class="m-sub">The ${title} couldn't be loaded. Check your connection and try again.</p>`;
  }
}
