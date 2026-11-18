import { PRESETS, saveSettings, detectPreset } from '../engine/engine.js';
import { setVolume, initAudio } from '../engine/audio.js';
import { applyPadSettings, padHelp } from '../engine/gamepad.js';
import { buildCrosshair, layoutCrosshair } from './crosshair.js';
import { offlineSupported, enableOffline, disableOffline } from '../net/offline.js';
import { PALETTES, applyAccess } from './access.js';
import { FOCUS } from './ui-shared.js';

// Menu: Settings. Installed on UI by mixin().
export class SettingsScreen {
  // ───────────────────────── settings ─────────────────────────
  renderSettings(el) {
    el.innerHTML = this.settingsHTML();
    this.bindSettings(el);
  }

  openSettingsModal(container, onClose) {
    container.innerHTML = `<div class="overlay"><div class="panel" style="width:min(820px,94vw);max-height:88vh;overflow-y:auto">${this.settingsHTML()}<div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn primary" data-done>Done</button></div></div></div>`;
    this.bindSettings(container);
    container.querySelector('[data-done]').onclick = onClose;
  }

  settingsHTML() {
    const s = this.app.settings;
    const seg = (key, opts) => `<div class="seg" data-seg="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(s[key]) === String(v) ? 'sel' : ''}">${l}</button>`).join('')}</div>`;
    const range = (key, min, max, step, fmt = (v) => v) => `<input type="range" data-range="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}"><span class="val" data-val="${key}">${fmt(s[key])}</span>`;
    const toggle = (key) => `<input type="checkbox" data-toggle="${key}" ${s[key] ? 'checked' : ''}><span></span>`;
    return `<h2 class="m-h2">Graphics</h2>
      <div class="settings-grid">
        <span>Quality preset</span>${seg('preset', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra'], ['custom', 'Custom']])}<span></span>
        <span>Auto-detect</span><button class="btn small" data-autodetect style="justify-self:start">Find the best preset for this device</button><span></span>
        <span>Render resolution</span>${range('renderScale', 0.5, 2, 0.25, (v) => Math.round(v * 100) + '%')}
        <span>Shadows</span>${seg('shadows', [['off', 'Off'], ['low', 'Low'], ['high', 'High'], ['ultra', 'Ultra']])}<span></span>
        <span>Anti-aliasing</span>${seg('aa', [['off', 'Off'], ['fxaa', 'FXAA'], ['smaa', 'SMAA'], ['msaa', 'MSAA 4x']])}<span></span>
        <span>Bloom</span>${toggle('bloom')}
        <span>Ambient occlusion (GTAO)</span>${toggle('ao')}
        <span>Frame rate cap</span>${seg('maxFps', [[0, 'Unlimited'], [60, '60'], [120, '120'], [144, '144']])}<span></span>
        <span>Show FPS</span>${toggle('showFps')}
        <span>3D menu backdrop</span>${toggle('menuScene')}
      </div>
      <h2 class="m-h2">Gameplay</h2>
      <div class="settings-grid">
        <span>Field of view</span>${range('fov', 70, 110, 1, (v) => v + '°')}
        <span>Weapon field of view</span>${range('viewmodelFov', 50, 80, 1, (v) => v + '°')}
        <span>Mouse sensitivity</span>${range('sens', 0.1, 4, 0.05, (v) => (+v).toFixed(2))}
        <span>Scoped sensitivity</span>${range('scopedSens', 0.2, 2, 0.05, (v) => (+v).toFixed(2))}
        <span>Invert mouse Y</span>${toggle('invertY')}
        <span>Kill cam</span>${toggle('killcam')}
        <span>Auto reload on empty</span>${toggle('autoReload')}
        <span>Master volume</span>${range('volume', 0, 1, 0.05, (v) => Math.round(v * 100) + '%')}
      </div>
      <h2 class="m-h2">Accessibility</h2>
      <div class="settings-grid">
        <span>Colour-blind mode</span>${seg('colorblind', Object.entries(PALETTES).map(([k, p]) => [k, p.label]))}<span></span>
        <span>Show sounds on screen</span>${toggle('soundCues')}
        <span>Toggle crouch (instead of hold)</span>${toggle('toggleCrouch')}
        <span>Toggle walk (instead of hold)</span>${toggle('toggleWalk')}
        <span>Reduce flashing</span>${toggle('reduceFlash')}
        <span>Reduce motion</span>${toggle('reduceMotion')}
        <span>HUD size</span>${range('hudScale', 0.8, 1.5, 0.05, (v) => Math.round(v * 100) + '%')}
      </div>
      <p class="m-sub small">Colour-blind mode changes team, enemy, health and win/loss colours everywhere, and shows enemies on the radar as diamonds. Show sounds on screen marks gunfire, footsteps, explosions, the charge's beeps, doors and breaking glass with an arrow pointing at where they came from. Reduce flashing dims flashbangs and the damage flash instead of turning the screen white or red. Reduce motion stops weapon bob and sway.</p>
      <h2 class="m-h2">Offline play</h2>
      <div class="settings-grid">
        <span>Save the game for offline play</span>${toggle('offlineMode')}
      </div>
      <p class="m-sub small" id="offline-note">${offlineSupported() ? 'Downloads the game (about 3.5 MB) so bot matches and the Training Range work without internet. Online play, accounts and stats still need a connection. Off by default; turning it off removes the saved copy.' : 'Your browser doesn’t support offline play.'}</p>
      <h2 class="m-h2">Controller</h2>
      <div class="settings-grid">
        <span>Look sensitivity</span>${range('padSens', 0.2, 3, 0.05, (v) => (+v).toFixed(2))}
        <span>Invert look Y</span>${toggle('padInvertY')}
        <span>Stick dead zone</span>${range('padDeadzone', 0.05, 0.4, 0.01, (v) => Math.round(v * 100) + '%')}
        <span>Vibration</span>${toggle('padVibration')}
      </div>
      <p class="m-sub small">${padHelp()}</p>
      <h2 class="m-h2">Crosshair</h2>
      <div class="ch-preview" data-bg="dark">
        <div class="crosshair" aria-hidden="true"></div>
        <div class="ch-preview-bar">
          <div class="seg ch-bg" aria-label="Preview background">${[['dark', 'Dark'], ['sand', 'Sand'], ['sky', 'Sky']].map(([k, l]) => `<button data-chbg="${k}" class="${k === 'dark' ? 'sel' : ''}">${l}</button>`).join('')}</div>
          <button class="btn small" data-chfire>Preview firing</button>
        </div>
      </div>
      <div class="settings-grid">
        <span>Colour</span><div class="swatches">${['#3dff8f', '#ffffff', '#ffe14d', '#4dd7ff', '#ff4dd2', '#ff4d4d'].map((c) => `<div class="swatch ${s.crosshairColor === c ? 'sel' : ''}" data-ch="${c}" style="background:${c}"></div>`).join('')}<input type="color" data-color="crosshairColor" value="${s.crosshairColor}"></div><span></span>
        <span>Length</span>${range('crosshairSize', 2, 16, 1, (v) => v + 'px')}
        <span>Gap</span>${range('crosshairGap', 0, 12, 1, (v) => v + 'px')}
        <span>Thickness</span>${range('crosshairThick', 1, 4, 1, (v) => v + 'px')}
        <span>Centre dot</span>${toggle('crosshairDot')}
      </div>`;
  }

  bindSettings(root) {
    const app = this.app;
    const apply = (patch, graphics) => {
      const s = app.settings;
      Object.assign(s, patch);
      if (Object.keys(patch).some((k) => k.startsWith('crosshair'))) this.drawCrosshairPreview(root);
      if (graphics && !('preset' in patch)) s.preset = 'custom';
      saveSettings(s);
      applyAccess(s);
      setVolume(s.volume);
      applyPadSettings(s);
      // In the menus the 3D backdrop owns the camera's zoom; keep it so a settings change doesn't
      // snap it out to the in-game field of view and ease back in. In a match, the new FOV applies.
      const cam = app.engine.camera, menuFov = app.game ? null : cam.fov;
      if (graphics) app.engine.applySettings(s);
      else { cam.fov = s.fov; app.engine.vmCamera.fov = s.viewmodelFov; app.engine.vmCamera.updateProjectionMatrix(); }
      if (menuFov !== null) cam.fov = menuFov;
      cam.updateProjectionMatrix();
    };
    const GRAPHICS = new Set(['renderScale', 'shadows', 'aa', 'bloom', 'ao']);
    const auto = root.querySelector('[data-autodetect]');
    if (auto) auto.onclick = () => {
      auto.disabled = true; auto.textContent = 'Testing…';
      // Let the button repaint before the benchmark briefly holds up the page.
      setTimeout(() => {
        const v = detectPreset(app.engine);
        apply({ preset: v, ...PRESETS[v] }, true);
        this.rebindAfterPreset(root, `Auto-detected: ${v[0].toUpperCase() + v.slice(1)} preset`);
      }, 50);
    };
    root.querySelectorAll('[data-seg]').forEach((g) => {
      g.querySelectorAll('button').forEach((b) => { b.onclick = () => {
        const key = g.dataset.seg;
        let v = b.dataset.v;
        if (key === 'maxFps') v = +v;
        if (key === 'preset') {
          if (v === 'custom') return;
          apply({ preset: v, ...PRESETS[v] }, true);
          return this.rebindAfterPreset(root);
        }
        g.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b));
        apply({ [key]: v }, GRAPHICS.has(key));
        const pre = root.querySelector('[data-seg=preset]');
        if (GRAPHICS.has(key) && pre) pre.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x.dataset.v === 'custom'));
      }; });
    });
    root.querySelectorAll('[data-range]').forEach((r) => {
      const key = r.dataset.range;
      const fmtEl = root.querySelector(`[data-val="${key}"]`);
      const fmt = { renderScale: (v) => Math.round(v * 100) + '%', fov: (v) => v + '°', viewmodelFov: (v) => v + '°', volume: (v) => Math.round(v * 100) + '%', crosshairSize: (v) => v + 'px', crosshairGap: (v) => v + 'px', crosshairThick: (v) => v + 'px', padDeadzone: (v) => Math.round(v * 100) + '%', hudScale: (v) => Math.round(v * 100) + '%' }[key] || ((v) => (+v).toFixed(2));
      r.oninput = () => { fmtEl.textContent = fmt(+r.value); if (key !== 'renderScale') apply({ [key]: +r.value }, false); };
      r.onchange = () => apply({ [key]: +r.value }, GRAPHICS.has(key));
    });
    root.querySelectorAll('[data-toggle]').forEach((t) => { t.onchange = () => {
      if (t.dataset.toggle === 'offlineMode') return this.setOfflineMode(t, apply);
      apply({ [t.dataset.toggle]: t.checked }, GRAPHICS.has(t.dataset.toggle));
      if (t.dataset.toggle === 'menuScene' && !app.game) { if (t.checked) this.stage(null, FOCUS[this.tab] || 'play'); else app.menuScene?.stop(); }
    }; });
    root.querySelectorAll('[data-ch]').forEach((sw) => { sw.onclick = () => { apply({ crosshairColor: sw.dataset.ch }); root.querySelectorAll('[data-ch]').forEach((x) => x.classList.toggle('sel', x === sw)); }; });
    root.querySelectorAll('[data-color]').forEach((c) => { c.oninput = () => apply({ [c.dataset.color]: c.value }); });
    // Crosshair preview: background choice and a short burst showing how it spreads when firing.
    this.drawCrosshairPreview(root);
    root.querySelectorAll('[data-chbg]').forEach((b) => { b.onclick = () => {
      root.querySelector('.ch-preview').dataset.bg = b.dataset.chbg;
      root.querySelectorAll('[data-chbg]').forEach((x) => x.classList.toggle('sel', x === b));
    }; });
    root.querySelector('[data-chfire]')?.addEventListener('click', () => {
      const start = performance.now();
      const tick = (now) => {
        const t = (now - start) / 900;
        if (t >= 1 || !this.chPreview?.parts[0].isConnected) { this.drawCrosshairPreview(root); return; }
        // Opens up over a short burst, then settles back, like spraying a rifle.
        const spread = Math.sin(Math.min(1, t * 1.6) * Math.PI / 2) * 14 * (t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4);
        layoutCrosshair(this.chPreview.parts, app.settings, app.settings.crosshairGap + spread);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  // Settings → Offline play: installs or removes the service worker and the saved copy of the game.
  async setOfflineMode(box, apply) {
    const on = box.checked, note = this.root.querySelector('#offline-note') || box.closest('.panel, .m-panel')?.querySelector('#offline-note');
    box.disabled = true;
    try {
      if (on) {
        const r = await enableOffline((done, total) => { if (note) note.textContent = `Saving the game for offline play… ${done} / ${total} files`; });
        if (r.failed) throw new Error(`${r.failed} of ${r.saved + r.failed} files couldn’t be saved. Check your connection and try again.`);
        apply({ offlineMode: true }, false);
        if (note) note.textContent = `Saved ${r.saved} files. Bot matches and the Training Range now work without internet.`;
        this.toast('Offline play is on', 'good');
      } else {
        await disableOffline();
        apply({ offlineMode: false }, false);
        if (note) note.textContent = 'Offline play is off and the saved copy was removed.';
      }
    } catch (e) {
      if (on) await disableOffline().catch(() => null);
      box.checked = false;
      apply({ offlineMode: false }, false);
      if (note) note.textContent = e.message;
      this.toast(e.message, 'bad', null, 6000);
    }
    box.disabled = false;
  }

  drawCrosshairPreview(root) {
    const el = root.querySelector('.ch-preview .crosshair');
    if (!el) return;
    const s = this.app.settings;
    this.chPreview = { parts: buildCrosshair(el, s) };
    layoutCrosshair(this.chPreview.parts, s, s.crosshairGap);
  }

  rebindAfterPreset(root, message = 'Graphics preset applied') {
    // Re-render the whole settings body so every control reflects the preset.
    const done = root.querySelector('[data-done]');
    if (done) {
      const onClose = done.onclick;
      this.openSettingsModal(root, onClose);
    } else this.renderSettings(root);
    this.toast(message, 'good');
    initAudio();
  }
}
