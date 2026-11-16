# Changelog

#### 4.2.4 · 2026-11-16

- New kill feed tag order: WIN, HS, 360, NOSCOPE, AIR, LASTBLT, LONG, WALLBANG, FLASH, SMOKE, BURN, TK

#### 4.2.3 · 2026-11-16 · [20571c9](https://github.com/cksarge/John-Paul-Simulator/commit/20571c9)

- No more limit on kill feed tags: every one that applies shows up, so a 360 NOSCOPE LASTBLT AIR FLASH SMOKE WALLBANG LONG BURN HS WIN is possible. HS now sits just before WIN, and long kill feed lines wrap instead of running off the screen

#### 4.2.2 · 2026-11-16 · [b5c96ce](https://github.com/cksarge/John-Paul-Simulator/commit/b5c96ce)

- Banned players no longer show on the leaderboards, including the season leaderboard. They come back if the ban ends or is lifted

#### 4.2.1 · 2026-11-16 · [2267c2b](https://github.com/cksarge/John-Paul-Simulator/commit/2267c2b)

- Kill feed tags each have their own color instead of all being yellow

### 4.2.0 · 2026-11-16 · [eb16907](https://github.com/cksarge/John-Paul-Simulator/commit/eb16907)

- **Friendly fire** in every team mode (not Zombies, Infection or training): bullets, knives, grenades, fire and barrels all hurt teammates
- Team kills earn no kill and cost $300, and show a red TK tag in the kill feed
- Like CS2: a warning at the first team kill or 100 team damage, and a kick at 3 team kills or 300 team damage. In online matches each kick adds a matchmaking cooldown (30 minutes, then 2 hours, 24 hours and 7 days), and a fifth kick within 30 days brings a 14-day ban
- Bots hold their fire when a teammate is in the way
- WIN kill feed tag on the kill that ends the round, or the match in modes without rounds

### 4.1.0 · 2026-11-16 · [7743bd4](https://github.com/cksarge/John-Paul-Simulator/commit/7743bd4)

- Kill feed tags besides headshots: NOSCOPE, 360, LASTBLT (last bullet in the magazine), AIR, FLASH (while flashed), SMOKE (through smoke), WALLBANG (through wooden cover), LONG (40 m or more) and BURN (victim standing in fire). They show in replays too
- Background buildings, chimneys, tanks, trees and ships no longer poke into the playable area on any map
- The buy menu has grenades in their own column on the right, matching gear on the left

## 4.0.0 · 2026-11-16 · [0fef720](https://github.com/cksarge/John-Paul-Simulator/commit/0fef720)

- **Anti-cheat** in online matches: the host throws out impossible hits (more damage than the gun does, a gun the player doesn't have, or shots faster than it fires), and every player's game reports impossible things it sees others do, the host included: moving too fast, firing too fast, kills through solid walls, buying outside buy time and round results that don't add up
- Ranked results the two players' games disagree on are marked as disputed and flagged for review
- Bans can be set from 1 hour to 1 year, a custom number of days, or permanent
- Banned players can appeal once per ban from the ban screen and see the answer there; bans can also be made final with no appeal
- Device bans for cheaters: permanent with no appeal, and new accounts made on a banned device are banned too

### 3.8.0 · 2026-11-16 · [26cc94d](https://github.com/cksarge/John-Paul-Simulator/commit/26cc94d)

- Sell back guns you bought this round during buy time, for the full price, as long as you're still holding them; you get back the gun it replaced
- Defuse Kit ($400, defenders only): defusing takes 5 seconds instead of 10 in Bomb Defusal (Retakes: 3 instead of 6)
- Bomb Defusal: defusing without a kit now takes 10 seconds (was 7)
- The buy menu's gear (armor and the defuse kit) has its own column on the left with bigger buttons
- The defuse prompt shows how long it will take

#### 3.7.1 · 2026-11-16 · [a972033](https://github.com/cksarge/John-Paul-Simulator/commit/a972033)

- Versus bots: picking a mode switches to a map of the right size, and picking a map switches to a mode that fits it

### 3.7.0 · 2026-11-16 · [355755d](https://github.com/cksarge/John-Paul-Simulator/commit/355755d)

- Sign in with your email or your username
- New accounts are offered the tutorial, even on a device that has seen it before
- The main menu camera always shows your operator clearly, never from behind glass or a wall
- Clearer messages when an email can't be sent or the server has a problem

#### 3.6.2 · 2026-11-16 · [ad87986](https://github.com/cksarge/John-Paul-Simulator/commit/ad87986)

- Links in sign-up and password reset emails go straight to the game's own site, so the emails are less likely to land in spam

#### 3.6.1 · 2026-11-16 · [c7aba61](https://github.com/cksarge/John-Paul-Simulator/commit/c7aba61)

- Pressing Enter again while searching for a match no longer shows a connection error
- Cancelling a search and starting another straight away works reliably
- Clearer messages if joining a queue or lobby fails

### 3.6.0 · 2026-11-16 · [a9c108a](https://github.com/cksarge/John-Paul-Simulator/commit/a9c108a)

- The main menu shows the game version (opens this changelog) and the latest commit (opens it on GitHub)
- Added this changelog, and every change from now on gets a new version number

### 3.5.0 · 2026-11-16 · [4303845](https://github.com/cksarge/John-Paul-Simulator/commit/4303845)

- The first time the game runs on a device, and the first time a brand new account signs in on one, the graphics preset is picked automatically
- Admin: XP events and announcements can be scheduled to start later, and cancelled before they start
- The menu banner shows upcoming XP events

#### 3.4.1 · 2026-11-16 · [37c0acf](https://github.com/cksarge/John-Paul-Simulator/commit/37c0acf)

- Admin: recent announcements are labelled News, Notice and Event instead of info, warn and event

### 3.4.0 · 2026-11-15 · [2452fe5](https://github.com/cksarge/John-Paul-Simulator/commit/2452fe5)

- Admin: See all players lists every account, 50 at a time, sortable by newest, last online, name, rating or matches
- Removed the message of the day (announcements cover it)

### 3.3.0 · 2026-11-15 · [9f7bd6f](https://github.com/cksarge/John-Paul-Simulator/commit/9f7bd6f)

- Settings → Graphics: an Auto-detect button picks the best preset for the device from its GPU and a short benchmark

### 3.2.0 · 2026-11-15 · [dc83f6c](https://github.com/cksarge/John-Paul-Simulator/commit/dc83f6c)

- Weapon pickups: dead players drop their main gun; walk over it with that slot empty, or press E to swap (not in Gun Game, Infection, Zombies or training)
- Auto reload when the magazine runs dry (Settings → Gameplay, on by default)
- The Magnum .50 is now the Desert Eagle, with a new model (skins and loadouts carry over)
- Explosions do full damage within about 1.5 m, your own included, and armor stops much less of it
- Frags 98 → 130 damage; Thumper rounds match frags (130 damage, 6.5 m radius)
- Exploding barrels: 150 damage over 7 m, with a bigger fireball and burning debris

### 3.1.0 · 2026-11-15 · [6e30abf](https://github.com/cksarge/John-Paul-Simulator/commit/6e30abf)

- New models for frags, flashbangs, smokes, incendiaries, proximity mines and decoys
- Explosions get fireballs, shockwaves, debris, lingering smoke and scorch marks
- Flashbangs get a lens streak; smokes a hissing canister and a billowing cloud; incendiaries flame tongues, a glowing floor and a burning canister
- Decoys flash and blink while firing; thrown grenades leave trails and settle on their side

#### 3.0.2 · 2026-11-14 · [f6053c1](https://github.com/cksarge/John-Paul-Simulator/commit/f6053c1)

- Fixed not being able to stand on platforms, ramps and crate tops
- Removed spawn barriers (players are already frozen during buy time)
- Glass blocks get panes on every side; barrel and switch hitboxes no longer rotate
- Domination always has three points, with B fair to both teams
- Capture the Flag: carriers keep moving while they shoot, bot roles are split evenly and flags sit just outside spawn
- Zombies squad bots buy upgrades and doors sooner

#### 3.0.1 · 2026-11-14 · [5b22dc9](https://github.com/cksarge/John-Paul-Simulator/commit/5b22dc9)

- Glass panels line up into proper window walls
- Glass, doors, gates, switches, ammo crates and barrels get hitboxes that match their shape

## 3.0.0 · 2026-11-14 · [8429c51](https://github.com/cksarge/John-Paul-Simulator/commit/8429c51)

- **Zombies**: a co-op wave survival mode for up to 4 players, with its own Play tab
- New objective modes: Domination, King of the Hill, Capture the Flag and Infection
- Weapon mastery: every gun and knife levels up from kills (headshots count double) and unlocks mastery finishes

#### 2.17.1 · 2026-11-13 · [8df486f](https://github.com/cksarge/John-Paul-Simulator/commit/8df486f)

- Lifts keep moving in training modes

### 2.17.0 · 2026-11-13 · [2a5b556](https://github.com/cksarge/John-Paul-Simulator/commit/2a5b556)

- The tutorial is offered on first launch
- Skip step in the pause menu during the tutorial

### 2.16.0 · 2026-11-13 · [616148e](https://github.com/cksarge/John-Paul-Simulator/commit/616148e)

- Tutorial steps for grenades, buying, the bomb, teamwork and a final fight

### 2.15.0 · 2026-11-13 · [51e235b](https://github.com/cksarge/John-Paul-Simulator/commit/51e235b)

- Tutorial steps for movement, doors and shooting

### 2.14.0 · 2026-11-13 · [b699622](https://github.com/cksarge/John-Paul-Simulator/commit/b699622)

- Tutorial mode with its own course map

### 2.13.0 · 2026-11-13 · [ecdbdf9](https://github.com/cksarge/John-Paul-Simulator/commit/ecdbdf9)

- Bots use gates, switches and lifts, and wait behind spawn barriers
- Nobody can glitch on top of walls any more
- 2v2 Wingman uses the 1v1 round economy

#### 2.12.2 · 2026-11-13 · [3df2b48](https://github.com/cksarge/John-Paul-Simulator/commit/3df2b48)

- Faster database security checks; the sign-up trigger is no longer callable from outside

#### 2.12.1 · 2026-11-13 · [5c6ce8f](https://github.com/cksarge/John-Paul-Simulator/commit/5c6ce8f)

- A shot-out grate leaves a gap instead of invisible railings
- Grenades roll on ramps instead of bouncing off them
- New map pieces get their own colours on the radar

### 2.12.0 · 2026-11-13 · [b8b2dcf](https://github.com/cksarge/John-Paul-Simulator/commit/b8b2dcf)

- Every official map gets the new pieces: stairs, lifts, cracked walls, gates, roofed tunnels and railings

### 2.11.0 · 2026-11-13 · [91fffb2](https://github.com/cksarge/John-Paul-Simulator/commit/91fffb2)

- Map editor: ground and overhead layers, height tool, select/copy/paste/rotate/flip, any-shape bomb sites, walk mode and a balance report

### 2.10.0 · 2026-11-13 · [3832401](https://github.com/cksarge/John-Paul-Simulator/commit/3832401)

- Ramps and stairs

### 2.9.0 · 2026-11-13 · [5d6bc3a](https://github.com/cksarge/John-Paul-Simulator/commit/5d6bc3a)

- Cracked walls, breakable grate catwalks, spawn barriers, gates with switches and lifts

### 2.8.0 · 2026-11-13 · [a085f36](https://github.com/cksarge/John-Paul-Simulator/commit/a085f36)

- An upper map layer for bridges, railings, grates and tunnel roofs
- Bomb sites can be made of several areas

### 2.7.0 · 2026-11-13 · [952b091](https://github.com/cksarge/John-Paul-Simulator/commit/952b091)

- Bridges you can walk under
- Frostbite redesigned with an original layout
- Fixed ladders and vines

### 2.6.0 · 2026-11-13 · [9e1683d](https://github.com/cksarge/John-Paul-Simulator/commit/9e1683d)

- Feedback button for bug reports, feedback and ideas

### 2.5.0 · 2026-11-13 · [48349a7](https://github.com/cksarge/John-Paul-Simulator/commit/48349a7)

- Maintenance mode locks everyone but admins out with a full-screen notice

#### 2.4.1 · 2026-11-13 · [0533b03](https://github.com/cksarge/John-Paul-Simulator/commit/0533b03)

- Fixed map author names in the workshop

### 2.4.0 · 2026-11-13 · [21fd0b2](https://github.com/cksarge/John-Paul-Simulator/commit/21fd0b2)

- Friends: requests, online status, invites and watching
- 34 achievements
- Map workshop: a map editor, uploads, a community browser with likes, and featured maps in every queue
- Night, rain, blizzards and fog
- Accessibility: colour-blind palettes, sound markers, toggle crouch/walk, reduced flashing and motion, HUD size

#### 2.3.1 · 2026-11-13 · [02ef0ae](https://github.com/cksarge/John-Paul-Simulator/commit/02ef0ae)

- The menu camera no longer jumps when a setting changes

### 2.3.0 · 2026-11-13 · [f5b45bd](https://github.com/cksarge/John-Paul-Simulator/commit/f5b45bd)

- Live crosshair preview in the settings

### 2.2.0 · 2026-11-13 · [2532017](https://github.com/cksarge/John-Paul-Simulator/commit/2532017)

- Opt-in offline play for bot matches and the Training Range
- A 404 page

#### 2.1.2 · 2026-11-13 · [8b82057](https://github.com/cksarge/John-Paul-Simulator/commit/8b82057)

- Hitboxes match what players see, the same for every operator; visible heads now count as headshots about 97% of the time

#### 2.1.1 · 2026-11-13 · [8b270ed](https://github.com/cksarge/John-Paul-Simulator/commit/8b270ed)

- Security and reliability fixes for moderation

### 2.1.0 · 2026-11-13 · [096b6e1](https://github.com/cksarge/John-Paul-Simulator/commit/096b6e1)

- Admin panel and moderation: bans, mutes, kicks, warnings, announcements, maintenance mode, XP events and an audit log

## 2.0.0 · 2026-11-13 · [98172fe](https://github.com/cksarge/John-Paul-Simulator/commit/98172fe)

- **Ranked seasons** with 30-tier reward tracks and exclusive season cosmetics
- Daily and weekly challenges and a season leaderboard
- New modes: Hostage Rescue and Retakes
- Training Range: aim drills, moving targets, spray board and grenade arc preview
- Weapon inspect, pings and a ping wheel
- Play of the match
- Commend and report players after online matches

#### 1.14.1 · 2026-11-13 · [a5134b0](https://github.com/cksarge/John-Paul-Simulator/commit/a5134b0)

- Database groundwork for seasons, challenges, commends and reports

### 1.14.0 · 2026-11-13 · [d928a3b](https://github.com/cksarge/John-Paul-Simulator/commit/d928a3b)

- Bad words are filtered out of match and party chat

### 1.13.0 · 2026-11-13 · [a7cdfe6](https://github.com/cksarge/John-Paul-Simulator/commit/a7cdfe6)

- Full controller support, required on phones and tablets

### 1.12.0 · 2026-11-13 · [6f050c2](https://github.com/cksarge/John-Paul-Simulator/commit/6f050c2)

- The main online modes appear as four tiles, with the rest under All modes

#### 1.11.1 · 2026-11-12 · [4af4a54](https://github.com/cksarge/John-Paul-Simulator/commit/4af4a54)

- Saved loadouts stay intact when rebuys arrive late online

### 1.11.0 · 2026-11-12 · [2b60aca](https://github.com/cksarge/John-Paul-Simulator/commit/2b60aca)

- The menu is a live 3D scene with your operator and party standing in a real map
- New stats page (form, modes, maps, weapons, rivals and a death heatmap)

### 1.10.0 · 2026-11-12 · [a7cafe5](https://github.com/cksarge/John-Paul-Simulator/commit/a7cafe5)

- Parties in the matchmaker, stats tracking and front-facing previews

### 1.9.0 · 2026-11-12 · [838aa9f](https://github.com/cksarge/John-Paul-Simulator/commit/838aa9f)

- Live spectating of online matches

### 1.8.0 · 2026-11-12 · [c6a69c3](https://github.com/cksarge/John-Paul-Simulator/commit/c6a69c3)

- Kill cams and match replays

### 1.7.0 · 2026-11-12 · [e779a86](https://github.com/cksarge/John-Paul-Simulator/commit/e779a86)

- Ladders, catwalks, mantling, fall damage and destructible wood

### 1.6.0 · 2026-11-12 · [b028f75](https://github.com/cksarge/John-Paul-Simulator/commit/b028f75)

- Calling cards, kill effects, emotes and more finishes and outfits

### 1.5.0 · 2026-11-12 · [5261ba3](https://github.com/cksarge/John-Paul-Simulator/commit/5261ba3)

- Loadout presets in the buy menu; the saved loadout is the kit you're holding

### 1.4.0 · 2026-11-12 · [f4f29df](https://github.com/cksarge/John-Paul-Simulator/commit/f4f29df)

- 32 weapons in eight classes
- Flashbangs, incendiaries, proximity mines and decoys
- Economy for 1v1 Duel and Ranked 1v1
- Doors, breakable glass, explosive barrels and ammo crates
- Easier bots that throw grenades and open doors
- New textures, lighting, scenery and weather on every map

### 1.3.0 · 2026-11-11 · [3d0e219](https://github.com/cksarge/John-Paul-Simulator/commit/3d0e219)

- Reconnect to a match after a disconnect, with a bot filling in meanwhile
- Fixed mouse capture, the warmup camera and spawn facing

### 1.2.0 · 2026-11-11 · [e007467](https://github.com/cksarge/John-Paul-Simulator/commit/e007467)

- Four new maps: Foundry, Outpost, Canopy and Frostbite
- Team Deathmatch and Gun Game
- Eight new weapons
- Weapon finishes, outfits, operator perks and saved loadouts

#### 1.1.4 · 2026-11-11 · [60b09bf](https://github.com/cksarge/John-Paul-Simulator/commit/60b09bf)

- Fixed grenades not throwing

#### 1.1.3 · 2026-11-11 · [25d9c2f](https://github.com/cksarge/John-Paul-Simulator/commit/25d9c2f)

- 60-second cooldown between account emails

#### 1.1.2 · 2026-11-11 · [fbd2a78](https://github.com/cksarge/John-Paul-Simulator/commit/fbd2a78)

- Fixed smoke turning black with ambient occlusion on

#### 1.1.1 · 2026-11-11 · [a3b19ad](https://github.com/cksarge/John-Paul-Simulator/commit/a3b19ad)

- Password resets happen inside the game instead of a separate page

### 1.1.0 · 2026-11-11 · [24c3c6f](https://github.com/cksarge/John-Paul-Simulator/commit/24c3c6f)

- Email confirmation and password reset with 6-digit codes
- Password rules and bot protection on sign-in

## 1.0.0 · 2026-11-11 · [080e771](https://github.com/cksarge/John-Paul-Simulator/commit/080e771)

- First release: a browser 3D tactical shooter with Ranked 1v1, Duel, 2v2, 5v5 Bomb Defusal and Free For All, bots, a character creator, accounts, rankings and online multiplayer
