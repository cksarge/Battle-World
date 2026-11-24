# Changelog

#### 4.17.6 · 2026-11-24

- Fixed a poll sometimes still showing **Vote** right after you voted (until you reloaded the page). The results now show straight away

#### 4.17.5 · 2026-11-24 · [22594fc](https://github.com/cksarge/Battle-World/commit/22594fc)

- Knives (and the machete, karambit and hatchet) now break glass when you swing at it

#### 4.17.4 · 2026-11-24 · [4c8e882](https://github.com/cksarge/Battle-World/commit/4c8e882)

- Admin panel: the overview's Today stats are an even 8 tiles (the current season tile is gone)

#### 4.17.3 · 2026-11-24 · [0b9abe9](https://github.com/cksarge/Battle-World/commit/0b9abe9)

- Fixed challenge XP occasionally failing to save when two challenges were claimed at the same moment
- Database updates no longer cause brief errors for players who are online while they're applied

#### 4.17.2 · 2026-11-24 · [e901f43](https://github.com/cksarge/Battle-World/commit/e901f43)

- The database upgrade is done and Battle World is back online

#### 4.17.1 · 2026-11-24 · [d428e46](https://github.com/cksarge/Battle-World/commit/d428e46)

- Updated the Terms of Service and Privacy Policy: they now cover the anti-cheat checks your game runs on itself, trusted players helping moderate, and moderators' messages to the admin. You'll be asked to agree once more

### 4.17.0 · 2026-11-24 · [d99128e](https://github.com/cksarge/Battle-World/commit/d99128e)

- Agreeing to the Terms of Service and Privacy Policy is now saved to your account, so you're only asked once per update instead of once on every new device. New accounts count as agreed from sign-up

#### 4.16.1 · 2026-11-24 · [f16c5f2](https://github.com/cksarge/Battle-World/commit/f16c5f2)

- Battle World is down for a short database upgrade. The game shows a maintenance screen until it's done, and reloads by itself when it's over

### 4.16.0 · 2026-11-24 · [21e17c9](https://github.com/cksarge/Battle-World/commit/21e17c9)

- Better tools for moderators reviewing reports and cheat flags:
  - **Replays for reviews:** when your game flags someone for cheating, or you report someone from the results screen, your replay of that match is sent to the moderators so they can watch what happened. Only moderators can see it, and it's deleted after 60 days
  - Admin panel: a **match page** for every report and cheat flag, with everyone's results, the ranked result, every report, flag and staff action from that match, and its replays to watch
  - Admin panel: a **case history** on each player's page, listing every report, cheat flag, warning, staff action, ban appeal, moderator message and new device for them in one timeline, with links to each match
  - Admin panel: a **Linked accounts** page grouping accounts that have signed in on the same browser, with banned ones first
  - The admin can see a player's email and last sign-in on their page
- Reporting a player now says that the replay goes to the moderators with it
- Updated the Privacy Policy to cover review replays, what moderators can see and poll votes

### 4.15.0 · 2026-11-24 · [ec8ee7f](https://github.com/cksarge/Battle-World/commit/ec8ee7f)

- Admin panel: a **Who voted** button on each poll shows who voted for which option. Moderators who can run polls can see it too; players still only see the totals, and the voting screen now says that moderators can see votes
- Final poll results now stay up for 1 day after a poll closes, instead of 3

### 4.14.0 · 2026-11-23 · [f92b192](https://github.com/cksarge/Battle-World/commit/f92b192)

- New mode: **Sniper Duels**. A 1v1 with snipers only, first to 7 rounds
  - Every round you start with an AWP, a knife and full armor. No pistols or grenades
  - In the buy phase you can swap to any other sniper for free, and you keep starting with it in the rounds after
  - Play it online (All modes), against bots, or in a custom lobby

#### 4.13.3 · 2026-11-23 · [73ff436](https://github.com/cksarge/Battle-World/commit/73ff436)

- Fixed matchmaking sometimes putting a player into two matches at once (or starting a match without someone in it) when more than two people were searching at the same time. A match now only starts once every player in it has confirmed, and anyone already being matched is left out of other matches until theirs starts or falls through

#### 4.13.2 · 2026-11-23 · [4094eee](https://github.com/cksarge/Battle-World/commit/4094eee)

- The **Thumper Launcher** can no longer be bought in Ranked 1v1. It's still in every other mode
  - A saved loadout with the Thumper in it buys everything else on it in ranked

#### 4.13.1 · 2026-11-23 · [803f9d4](https://github.com/cksarge/Battle-World/commit/803f9d4)

- Season rank cards no longer fill the Armory with eight locked cards per season: they only show up once you've earned one
- Each season's rank cards count as a single item in your collection, so earning any one of them collects it. You don't need every rank to reach 100%
- The Season tab shows just one rank card: the one for the rank you're on now
- Card pictures on the Season tab are no longer squashed next to long descriptions

### 4.13.0 · 2026-11-23 · [880de34](https://github.com/cksarge/Battle-World/commit/880de34)

- When a season ends, **everyone's rating now resets to 1000**, whether it was above or below, so every season is a fresh climb. This happens for every account at once when the season ends, even if you're not playing
- New **season-end rank cards**: play ranked during a season and when it ends you get that season's card for the rank you finished on, like **Season 1 Gold**. There's one for every rank from Iron to Elite in each of Seasons 1–5
  - The Season tab shows this season's rank cards, with the one you're on now highlighted
  - Later seasons' rank cards stay hidden until their season starts
- Finished seasons' leaderboards show everyone's final ratings

### 4.12.0 · 2026-11-23 · [d6d5bb3](https://github.com/cksarge/Battle-World/commit/d6d5bb3)

- New **Moderator** calling card, like the Contributor and Developer cards. It's given to moderators, and to players who send in 3 player reports that a moderator acts on
  - It's handed out automatically, including to everyone who already qualifies, and the admin can also give or remove it from a player's page
- Fewer false "kills through walls" cheat flags. Kills that a bullet could really make are no longer flagged: wallbangs through wooden barricades and crates, shots through a cracked wall that's been shot or broken open, and shots over stairs, ramps, open doors and other spots the old check got wrong
  - Kills by bots are never flagged

#### 4.11.2 · 2026-11-23 · [2572dcf](https://github.com/cksarge/Battle-World/commit/2572dcf)

- Matches that end 0-0 are now voided: they don't count as a win or a loss, ranked rating doesn't change, and they give no drop, challenge or achievement progress. This mostly happens when someone leaves before anyone scores
- Fixed planting the charge not counting toward the **Charge Set** and **Demolitionist** achievements (and planting challenges) in bot matches and in online matches you host. The "Charge planted" banner and sound now show there too

#### 4.11.1 · 2026-11-23 · [cb5bb74](https://github.com/cksarge/Battle-World/commit/cb5bb74)

- Fixed some text boxes showing white text on a white background: search boxes (like the admin panel's player search), number boxes and some message boxes now use the game's dark style, with readable placeholder text

### 4.11.0 · 2026-11-23 · [265f2ac](https://github.com/cksarge/Battle-World/commit/265f2ac)

- Moderators! The admin can now make players moderators and choose exactly what each one can do: reviewing reports, cheat flags, feedback or ban appeals, looking up players, warning, muting, kicking, banning, announcements, polls and community maps
  - Moderators get the Admin tab with only the pages and buttons their role allows
  - Buttons for things a moderator can't do themselves, like Ban, become **Recommend**, which sends the admin a message about that player
- Admin panel: new **Moderators** page to add moderators, edit their roles (with presets), see what they've been doing and remove them
- Admin panel: new **Mod contact** page for direct messages between the admin and each moderator. A message can link a player and a recommended action, which the admin can carry out from the message
- The audit log now shows who did each action

#### 4.10.3 · 2026-11-23 · [58a70e1](https://github.com/cksarge/Battle-World/commit/58a70e1)

- Fixed lifted device bans leaving some devices banned. When a ban is lifted or an appeal accepted, every device the ban spread to (including devices of accounts caught evading it) is now cleared too, so the player isn't banned again the next time they sign in on one of them
  - Devices that are part of someone else's ban stay banned

#### 4.10.2 · 2026-11-23 · [4e52ff6](https://github.com/cksarge/Battle-World/commit/4e52ff6)

- Zombies kills no longer count toward your K/D, headshot rate or the kills leaderboard. They're tracked separately, and profiles and your Stats page show a **Zombies K/D** of their own
  - Kills and deaths from past Zombies matches have been moved over too
- Admin panel: the stat outliers list leaves out Zombies matches, and player pages show Zombies kills and deaths separately

#### 4.10.1 · 2026-11-20 · [9a7faf5](https://github.com/cksarge/Battle-World/commit/9a7faf5)

- Rewards for upcoming seasons are now a surprise: the Season tab only shows their names and dates, and their items no longer appear in the Armory until the season starts

### 4.10.0 · 2026-11-20 · [7bbdfa4](https://github.com/cksarge/Battle-World/commit/7bbdfa4)

- Polls! When one is running it shows at the top of the menu: press **Vote**, pick an option and see how everyone else voted
  - You get one vote per poll, and it can't be changed
  - Some polls are only for players whose accounts were made before a certain date (or before the poll started). You can still see those polls, but not vote
  - After a poll closes, everyone who voted can see the final results for 3 days
  - You need an account to vote; guests can look but not vote

#### 4.9.1 · 2026-11-20 · [64b053e](https://github.com/cksarge/Battle-World/commit/64b053e)

- Moderators can now send you a notice: a message that's just information, not a warning

### 4.9.0 · 2026-11-20 · [0de7c39](https://github.com/cksarge/Battle-World/commit/0de7c39)

- Stronger anti-cheat in online matches: the game now also watches for cheat scripts, aimbots, triggerbots and autoclickers. Anything it finds goes to a moderator to review; nobody is banned automatically, so a false alarm can't get you banned on its own
- Keyboard and mouse input faked by a script is now ignored, so input-faking cheats do nothing
- Disputed ranked matches (where the two players' games report different winners) are now reviewed by a moderator. If a match is voided, both players get back the rating they won or lost, the win and loss are removed from their records, and both are sent a notice explaining why
- Messages from the moderator that are just information, like a voided match, now show as a notice instead of a warning

#### 4.8.2 · 2026-11-20 · [a244afc](https://github.com/cksarge/Battle-World/commit/a244afc)

- Throwing an incendiary no longer makes the game hitch (when it's thrown and again when the fire burns out)
- The party slots at the top of the menu update as soon as friends join or leave, instead of only after you switch tabs
- "World" in the title on the sign-in screen is amber

#### 4.8.1 · 2026-11-19 · [1980ba6](https://github.com/cksarge/Battle-World/commit/1980ba6)

- The game is now called **Battle World**: title, menus, loading screen, BW logo, Terms and Privacy pages and account emails
- New address: battleworld.carterscoding.com

### 4.8.0 · 2026-11-18 · [2ec4b89](https://github.com/cksarge/Battle-World/commit/2ec4b89)

- Terms of Service and Privacy Policy, readable in game from the Terms and Privacy links in the menu footer (and on GitHub as TERMS.md and PRIVACY.md)
  - New players tick a box agreeing to them: on the Create account form, or before their first game as a guest on a new device
  - Existing players see a one-time notice that continuing to play means agreeing to them

#### 4.7.7 · 2026-11-18 · [2ffd45f](https://github.com/cksarge/Battle-World/commit/2ffd45f)

- Admin panel is easier to use:
  - A side menu grouped into To do, Players, Game and History, with red counts on Reports, Appeals and Feedback so you can see what's waiting
  - "Jump to a player" search at the top of every page: type part of a name, pick from the list or press Enter
  - The Overview starts with a "Needs your attention" list, and every number tile opens its page
  - Players have their own page with a Back button. Actions are grouped into Moderation, Account and Items, and their history folds away into sections with counts
  - Player search shows results as you type, and an empty search lists everyone
  - Ban and mute have one-click reasons (Cheating, Harassment and so on). Give item is grouped by type and leaves out what they already own; Remove item lists only what they own
  - Dialogs: Enter confirms, Esc cancels
  - The panel reopens on the last page you used, and has a Refresh button

#### 4.7.6 · 2026-11-18 · [8c51742](https://github.com/cksarge/Battle-World/commit/8c51742)

- Online matches no longer wait on players who don't ready up. The ready-up countdown is now 20 seconds and is shown at the top of the screen; it skips ahead to the last 3 seconds once everyone is ready
  - If you haven't readied up when it runs out, you're readied automatically and the match starts. Click anywhere to jump in

#### 4.7.5 · 2026-11-18 · [e5b5f45](https://github.com/cksarge/Battle-World/commit/e5b5f45)

- The Cloudflare security check on sign-in, sign-up and password reset is turned off for now, since it was blocking some players. It can be switched back on later

#### 4.7.4 · 2026-11-17 · [abbe925](https://github.com/cksarge/Battle-World/commit/abbe925)

- Outpost: the gate switches are now on the spawn side of their gates, so you can open the gate from your own side

#### 4.7.3 · 2026-11-17 · [f02ea9b](https://github.com/cksarge/Battle-World/commit/f02ea9b)

- Smokes are solid now: you can't see through the gaps in the cloud anymore, and standing inside one greys out your view
- Enemies seen through a smoke no longer show up on your radar
- The P9 Sidearm no longer kills with one headshot (95 damage at most, down from 112), so it always takes two

#### 4.7.2 · 2026-11-17 · [6c47f94](https://github.com/cksarge/Battle-World/commit/6c47f94)

- Fixed starting a round on top of a box instead of at your spawn: if you were climbing onto a ledge (jumping at a box) when the round ended, the climb carried on after you respawned and pulled you back to the box once buy time ended

#### 4.7.1 · 2026-11-17 · [898b6b2](https://github.com/cksarge/Battle-World/commit/898b6b2)

- Hair fixed on every style: it now sits right on the head with a proper hairline instead of floating pieces or a bald patch on top
  - Short and swept hair have their volume on top of the head, long hair falls from the head down past the shoulders, the mohawk crest sits on the skull, and the ponytail ties on at the back
- Beards are one piece from sideburn to sideburn and join the hair, the helmet's chin strap runs along the jaw, and glasses arms follow the head back to the ears

### 4.7.0 · 2026-11-17 · [a6ec05d](https://github.com/cksarge/Battle-World/commit/a6ec05d)

- **Operators hold their guns properly**: the right hand is on the grip and the left on the handguard (or cupped under the pistol hand), with long guns raised to the shoulder in a bladed stance
- **Better deaths**: the knees give way first, then the body falls with a twist, the arms go loose, the gun drops and the eyes close
- Operators blink now and then
- **Guns move when you use them** (first person): pistol slides kick back on every shot, bolt-action snipers and the Breacher's pump cycle after each shot, and the magazine drops out and goes back in when you reload
- **Getting back into the game is smoother**: clicking Resume too soon after leaving no longer fails with "the browser needs a moment"; the game waits that second and takes the mouse itself. When the game does need a click, you get a light "click anywhere to jump in" prompt instead of the pause menu (Esc still opens the pause menu)
- **The first round waits for everyone to ready up**, so reading the lineup no longer eats into buy time. Online it waits at most 20 seconds for anyone who hasn't clicked in
- Bot names show "BOT" as a small tag, like clan tags, in the kill feed, scoreboard, kill cam and spectator bar; the lineup shows their difficulty instead

### 4.6.0 · 2026-11-17 · [76e98ca](https://github.com/cksarge/Battle-World/commit/76e98ca)

- **Operator graphics overhaul**: every operator has been rebuilt with rounded, shaped bodies instead of blocks
  - Faces with eyes, brows, a nose and mouth; hair that sits on the head, and proper beards, stubble, glasses, masks, balaclavas and gas masks
  - Headgear redone: ballistic helmet with rails and an NVG mount, cap with a curved brim, beanie, headset with a mic, and a floppy boonie hat
  - Plate carriers with mag pouches, webbing and a radio; chest rigs with mags showing and back straps; shirts with pockets when there's no vest
  - Cargo pants with knee pads, laced boots with rubber soles, gloved hands, and fabric, leather and skin that catch the light differently
- Your first-person arms match: rounded sleeves and gloves instead of boxes
- Operators are the same size as before, so hitboxes haven't changed, and they're drawn with fewer draw calls than the old models

### 4.5.0 · 2026-11-17 · [77f1add](https://github.com/cksarge/Battle-World/commit/77f1add)

- **Lineups on the ready-up screen**: before a match starts you see everyone's calling card, with your team on the left and the other team on the right
  - Each card shows the player's name and clan tag, plus their ELO online (or the bot difficulty against bots); yours is highlighted
  - In free-for-all and party modes everyone is split across both sides, and the lineup updates as players join or leave
- In Duel, Wingman and the other modes that open the buy menu at the start, the ready-up screen now stays up until you click to play, then the buy menu opens
- The buy menu now closes by itself when buy time ends, with a quick "click anywhere to jump in" prompt to get back into the game. In modes where you can keep buying after the start it stays open until that window closes, and modes where you can buy all round leave it alone
- Replays moved from the main menu into a Replays tab in Stats, next to Overview, Achievements and Mastery

#### 4.4.1 · 2026-11-17 · [122160e](https://github.com/cksarge/Battle-World/commit/122160e)

- The Arc Rail's beam now shoots out toward where you aimed instead of streaking backwards behind you

### 4.4.0 · 2026-11-17 · [71e2b12](https://github.com/cksarge/Battle-World/commit/71e2b12)

- **Weapon graphics overhaul**: every gun, knife, grenade and attachment has been rebuilt with far more detail
  - Bevelled receivers and slides, real rails, magazines, trigger guards, sights, scopes with glass, muzzle brakes and flash hiders
  - Better materials: brushed metal, stippled polymer, walnut grain and glass that reflects the sky
  - Grenades have moulded frag segments, a proper spoon and pull ring, and sharper markings
- **Finishes look much better**: they now cover the whole gun, including the receiver, slide and magazine
  - Camo, digital, tiger stripe, marble, damascus and the rest are redrawn at higher resolution with light wear
  - Glowing finishes only glow along their lines, and polished, carbon and prism finishes get a glossy clear coat
- **Attachments are fully modelled**: a proper suppressor, a laser with a lit emitter, a ribbed foregrip, and the Extended Mag now shows a longer magazine
- Guns are drawn with far fewer draw calls, so the extra detail doesn't cost frame rate

#### 4.3.2 · 2026-11-16 · [6a9a17b](https://github.com/cksarge/Battle-World/commit/6a9a17b)

- **Assists**: you get one when you do at least 30 damage to someone in the 5 seconds before a teammate (or anyone, in free-for-all) kills them
  - If nobody else damaged them, flashing the victim or throwing the smoke the killer shot through also counts, marked with a small ASSIST tag
  - Your name shows next to the killer's in the kill feed (Killer + You), with a "+Assist" popup by your crosshair
  - A new A column on the scoreboard and end-of-match table, assists on your profile and stats page, and 5 XP for each one

#### 4.3.1 · 2026-11-16 · [28774a9](https://github.com/cksarge/Battle-World/commit/28774a9)

- Two new awarded calling cards, given out by the developers:
  - Contributor: for sending in 5 useful bug reports, feedback or ideas
  - Developer: for helping write the game's code, as a GitHub collaborator or with a merged pull request
- A GitHub link next to the version number at the bottom of the menu

### 4.3.0 · 2026-11-16 · [a266f8d](https://github.com/cksarge/Battle-World/commit/a266f8d)

- **Gun attachments**: one slot per gun and the same four choices on every gun, each with one upside and one downside
  - Grip (less recoil, a little slower), Laser (tighter hip-fire, slower draw), Extended Mag (half again as many rounds, slower reload) and Suppressor (quiet, no tracers and firing doesn't show you on radar, but damage drops off sooner)
  - They unlock per gun at mastery levels 2, 3, 4 and 5, and are picked in Armory → Weapons. Until a gun reaches level 2 there's nothing new to learn
  - Other players see and hear your attachment, and the buy menu shows which one each gun has
- **Party modes**, in their own list under the other modes (online, versus bots and custom lobbies):
  - One in the Chamber: a pistol with one bullet that kills in one hit. Every kill earns another bullet; three lives each, last one standing wins
  - Sharpshooter: everyone has the same random gun, and it changes every 45 seconds. First to 20 kills
  - Juggernaut: one heavily armored player with an LMG who is always on the radar. Kill the Juggernaut to become it; only the Juggernaut scores
  - Prop Hunt: hiders turn into crates, barrels, boxes, tyre stacks and cabinets and get 30 seconds to hide while the seekers are blindfolded. Missed shots cost seekers health, and found hiders join the seekers
- **Clans**: create one with a name and a 2 to 4 character tag, or join with an invite code. Up to 20 members
  - Your clan tag shows next to your name in the kill feed, scoreboards and leaderboards
  - The Clan tab shows your members and invite code; the leader can remove members, hand over leadership or make a new code
  - New Clans view on the leaderboard, ranked by members' wins (banned players don't count)

#### 4.2.4 · 2026-11-16 · [0b28b5f](https://github.com/cksarge/Battle-World/commit/0b28b5f)

- New kill feed tag order: WIN, HS, 360, NOSCOPE, AIR, LASTBLT, LONG, WALLBANG, FLASH, SMOKE, BURN, TK

#### 4.2.3 · 2026-11-16 · [20571c9](https://github.com/cksarge/Battle-World/commit/20571c9)

- No more limit on kill feed tags: every one that applies shows up, so a 360 NOSCOPE LASTBLT AIR FLASH SMOKE WALLBANG LONG BURN HS WIN is possible. HS now sits just before WIN, and long kill feed lines wrap instead of running off the screen

#### 4.2.2 · 2026-11-16 · [b5c96ce](https://github.com/cksarge/Battle-World/commit/b5c96ce)

- Banned players no longer show on the leaderboards, including the season leaderboard. They come back if the ban ends or is lifted

#### 4.2.1 · 2026-11-16 · [2267c2b](https://github.com/cksarge/Battle-World/commit/2267c2b)

- Kill feed tags each have their own color instead of all being yellow

### 4.2.0 · 2026-11-16 · [eb16907](https://github.com/cksarge/Battle-World/commit/eb16907)

- **Friendly fire** in every team mode (not Zombies, Infection or training): bullets, knives, grenades, fire and barrels all hurt teammates
- Team kills earn no kill and cost $300, and show a red TK tag in the kill feed
- Like CS2: a warning at the first team kill or 100 team damage, and a kick at 3 team kills or 300 team damage. In online matches each kick adds a matchmaking cooldown (30 minutes, then 2 hours, 24 hours and 7 days), and a fifth kick within 30 days brings a 14-day ban
- Bots hold their fire when a teammate is in the way
- WIN kill feed tag on the kill that ends the round, or the match in modes without rounds

### 4.1.0 · 2026-11-16 · [7743bd4](https://github.com/cksarge/Battle-World/commit/7743bd4)

- Kill feed tags besides headshots: NOSCOPE, 360, LASTBLT (last bullet in the magazine), AIR, FLASH (while flashed), SMOKE (through smoke), WALLBANG (through wooden cover), LONG (40 m or more) and BURN (victim standing in fire). They show in replays too
- Background buildings, chimneys, tanks, trees and ships no longer poke into the playable area on any map
- The buy menu has grenades in their own column on the right, matching gear on the left

## 4.0.0 · 2026-11-16 · [0fef720](https://github.com/cksarge/Battle-World/commit/0fef720)

- **Anti-cheat** in online matches: the host throws out impossible hits (more damage than the gun does, a gun the player doesn't have, or shots faster than it fires), and every player's game reports impossible things it sees others do, the host included: moving too fast, firing too fast, kills through solid walls, buying outside buy time and round results that don't add up
- Ranked results the two players' games disagree on are marked as disputed and flagged for review
- Bans can be set from 1 hour to 1 year, a custom number of days, or permanent
- Banned players can appeal once per ban from the ban screen and see the answer there; bans can also be made final with no appeal
- Device bans for cheaters: permanent with no appeal, and new accounts made on a banned device are banned too

### 3.8.0 · 2026-11-16 · [26cc94d](https://github.com/cksarge/Battle-World/commit/26cc94d)

- Sell back guns you bought this round during buy time, for the full price, as long as you're still holding them; you get back the gun it replaced
- Defuse Kit ($400, defenders only): defusing takes 5 seconds instead of 10 in Bomb Defusal (Retakes: 3 instead of 6)
- Bomb Defusal: defusing without a kit now takes 10 seconds (was 7)
- The buy menu's gear (armor and the defuse kit) has its own column on the left with bigger buttons
- The defuse prompt shows how long it will take

#### 3.7.1 · 2026-11-16 · [a972033](https://github.com/cksarge/Battle-World/commit/a972033)

- Versus bots: picking a mode switches to a map of the right size, and picking a map switches to a mode that fits it

### 3.7.0 · 2026-11-16 · [355755d](https://github.com/cksarge/Battle-World/commit/355755d)

- Sign in with your email or your username
- New accounts are offered the tutorial, even on a device that has seen it before
- The main menu camera always shows your operator clearly, never from behind glass or a wall
- Clearer messages when an email can't be sent or the server has a problem

#### 3.6.2 · 2026-11-16 · [ad87986](https://github.com/cksarge/Battle-World/commit/ad87986)

- Links in sign-up and password reset emails go straight to the game's own site, so the emails are less likely to land in spam

#### 3.6.1 · 2026-11-16 · [c7aba61](https://github.com/cksarge/Battle-World/commit/c7aba61)

- Pressing Enter again while searching for a match no longer shows a connection error
- Cancelling a search and starting another straight away works reliably
- Clearer messages if joining a queue or lobby fails

### 3.6.0 · 2026-11-16 · [a9c108a](https://github.com/cksarge/Battle-World/commit/a9c108a)

- The main menu shows the game version (opens this changelog) and the latest commit (opens it on GitHub)
- Added this changelog, and every change from now on gets a new version number

### 3.5.0 · 2026-11-16 · [4303845](https://github.com/cksarge/Battle-World/commit/4303845)

- The first time the game runs on a device, and the first time a brand new account signs in on one, the graphics preset is picked automatically
- Admin: XP events and announcements can be scheduled to start later, and cancelled before they start
- The menu banner shows upcoming XP events

#### 3.4.1 · 2026-11-16 · [37c0acf](https://github.com/cksarge/Battle-World/commit/37c0acf)

- Admin: recent announcements are labelled News, Notice and Event instead of info, warn and event

### 3.4.0 · 2026-11-15 · [2452fe5](https://github.com/cksarge/Battle-World/commit/2452fe5)

- Admin: See all players lists every account, 50 at a time, sortable by newest, last online, name, rating or matches
- Removed the message of the day (announcements cover it)

### 3.3.0 · 2026-11-15 · [9f7bd6f](https://github.com/cksarge/Battle-World/commit/9f7bd6f)

- Settings → Graphics: an Auto-detect button picks the best preset for the device from its GPU and a short benchmark

### 3.2.0 · 2026-11-15 · [dc83f6c](https://github.com/cksarge/Battle-World/commit/dc83f6c)

- Weapon pickups: dead players drop their main gun; walk over it with that slot empty, or press E to swap (not in Gun Game, Infection, Zombies or training)
- Auto reload when the magazine runs dry (Settings → Gameplay, on by default)
- The Magnum .50 is now the Desert Eagle, with a new model (skins and loadouts carry over)
- Explosions do full damage within about 1.5 m, your own included, and armor stops much less of it
- Frags 98 → 130 damage; Thumper rounds match frags (130 damage, 6.5 m radius)
- Exploding barrels: 150 damage over 7 m, with a bigger fireball and burning debris

### 3.1.0 · 2026-11-15 · [6e30abf](https://github.com/cksarge/Battle-World/commit/6e30abf)

- New models for frags, flashbangs, smokes, incendiaries, proximity mines and decoys
- Explosions get fireballs, shockwaves, debris, lingering smoke and scorch marks
- Flashbangs get a lens streak; smokes a hissing canister and a billowing cloud; incendiaries flame tongues, a glowing floor and a burning canister
- Decoys flash and blink while firing; thrown grenades leave trails and settle on their side

#### 3.0.2 · 2026-11-14 · [f6053c1](https://github.com/cksarge/Battle-World/commit/f6053c1)

- Fixed not being able to stand on platforms, ramps and crate tops
- Removed spawn barriers (players are already frozen during buy time)
- Glass blocks get panes on every side; barrel and switch hitboxes no longer rotate
- Domination always has three points, with B fair to both teams
- Capture the Flag: carriers keep moving while they shoot, bot roles are split evenly and flags sit just outside spawn
- Zombies squad bots buy upgrades and doors sooner

#### 3.0.1 · 2026-11-14 · [5b22dc9](https://github.com/cksarge/Battle-World/commit/5b22dc9)

- Glass panels line up into proper window walls
- Glass, doors, gates, switches, ammo crates and barrels get hitboxes that match their shape

## 3.0.0 · 2026-11-14 · [8429c51](https://github.com/cksarge/Battle-World/commit/8429c51)

- **Zombies**: a co-op wave survival mode for up to 4 players, with its own Play tab
- New objective modes: Domination, King of the Hill, Capture the Flag and Infection
- Weapon mastery: every gun and knife levels up from kills (headshots count double) and unlocks mastery finishes

#### 2.17.1 · 2026-11-13 · [8df486f](https://github.com/cksarge/Battle-World/commit/8df486f)

- Lifts keep moving in training modes

### 2.17.0 · 2026-11-13 · [2a5b556](https://github.com/cksarge/Battle-World/commit/2a5b556)

- The tutorial is offered on first launch
- Skip step in the pause menu during the tutorial

### 2.16.0 · 2026-11-13 · [616148e](https://github.com/cksarge/Battle-World/commit/616148e)

- Tutorial steps for grenades, buying, the bomb, teamwork and a final fight

### 2.15.0 · 2026-11-13 · [51e235b](https://github.com/cksarge/Battle-World/commit/51e235b)

- Tutorial steps for movement, doors and shooting

### 2.14.0 · 2026-11-13 · [b699622](https://github.com/cksarge/Battle-World/commit/b699622)

- Tutorial mode with its own course map

### 2.13.0 · 2026-11-13 · [ecdbdf9](https://github.com/cksarge/Battle-World/commit/ecdbdf9)

- Bots use gates, switches and lifts, and wait behind spawn barriers
- Nobody can glitch on top of walls any more
- 2v2 Wingman uses the 1v1 round economy

#### 2.12.2 · 2026-11-13 · [3df2b48](https://github.com/cksarge/Battle-World/commit/3df2b48)

- Faster database security checks; the sign-up trigger is no longer callable from outside

#### 2.12.1 · 2026-11-13 · [5c6ce8f](https://github.com/cksarge/Battle-World/commit/5c6ce8f)

- A shot-out grate leaves a gap instead of invisible railings
- Grenades roll on ramps instead of bouncing off them
- New map pieces get their own colours on the radar

### 2.12.0 · 2026-11-13 · [b8b2dcf](https://github.com/cksarge/Battle-World/commit/b8b2dcf)

- Every official map gets the new pieces: stairs, lifts, cracked walls, gates, roofed tunnels and railings

### 2.11.0 · 2026-11-13 · [91fffb2](https://github.com/cksarge/Battle-World/commit/91fffb2)

- Map editor: ground and overhead layers, height tool, select/copy/paste/rotate/flip, any-shape bomb sites, walk mode and a balance report

### 2.10.0 · 2026-11-13 · [3832401](https://github.com/cksarge/Battle-World/commit/3832401)

- Ramps and stairs

### 2.9.0 · 2026-11-13 · [5d6bc3a](https://github.com/cksarge/Battle-World/commit/5d6bc3a)

- Cracked walls, breakable grate catwalks, spawn barriers, gates with switches and lifts

### 2.8.0 · 2026-11-13 · [a085f36](https://github.com/cksarge/Battle-World/commit/a085f36)

- An upper map layer for bridges, railings, grates and tunnel roofs
- Bomb sites can be made of several areas

### 2.7.0 · 2026-11-13 · [952b091](https://github.com/cksarge/Battle-World/commit/952b091)

- Bridges you can walk under
- Frostbite redesigned with an original layout
- Fixed ladders and vines

### 2.6.0 · 2026-11-13 · [9e1683d](https://github.com/cksarge/Battle-World/commit/9e1683d)

- Feedback button for bug reports, feedback and ideas

### 2.5.0 · 2026-11-13 · [48349a7](https://github.com/cksarge/Battle-World/commit/48349a7)

- Maintenance mode locks everyone but admins out with a full-screen notice

#### 2.4.1 · 2026-11-13 · [0533b03](https://github.com/cksarge/Battle-World/commit/0533b03)

- Fixed map author names in the workshop

### 2.4.0 · 2026-11-13 · [21fd0b2](https://github.com/cksarge/Battle-World/commit/21fd0b2)

- Friends: requests, online status, invites and watching
- 34 achievements
- Map workshop: a map editor, uploads, a community browser with likes, and featured maps in every queue
- Night, rain, blizzards and fog
- Accessibility: colour-blind palettes, sound markers, toggle crouch/walk, reduced flashing and motion, HUD size

#### 2.3.1 · 2026-11-13 · [02ef0ae](https://github.com/cksarge/Battle-World/commit/02ef0ae)

- The menu camera no longer jumps when a setting changes

### 2.3.0 · 2026-11-13 · [f5b45bd](https://github.com/cksarge/Battle-World/commit/f5b45bd)

- Live crosshair preview in the settings

### 2.2.0 · 2026-11-13 · [2532017](https://github.com/cksarge/Battle-World/commit/2532017)

- Opt-in offline play for bot matches and the Training Range
- A 404 page

#### 2.1.2 · 2026-11-13 · [8b82057](https://github.com/cksarge/Battle-World/commit/8b82057)

- Hitboxes match what players see, the same for every operator; visible heads now count as headshots about 97% of the time

#### 2.1.1 · 2026-11-13 · [8b270ed](https://github.com/cksarge/Battle-World/commit/8b270ed)

- Security and reliability fixes for moderation

### 2.1.0 · 2026-11-13 · [096b6e1](https://github.com/cksarge/Battle-World/commit/096b6e1)

- Admin panel and moderation: bans, mutes, kicks, warnings, announcements, maintenance mode, XP events and an audit log

## 2.0.0 · 2026-11-13 · [98172fe](https://github.com/cksarge/Battle-World/commit/98172fe)

- **Ranked seasons** with 30-tier reward tracks and exclusive season cosmetics
- Daily and weekly challenges and a season leaderboard
- New modes: Hostage Rescue and Retakes
- Training Range: aim drills, moving targets, spray board and grenade arc preview
- Weapon inspect, pings and a ping wheel
- Play of the match
- Commend and report players after online matches

#### 1.14.1 · 2026-11-13 · [a5134b0](https://github.com/cksarge/Battle-World/commit/a5134b0)

- Database groundwork for seasons, challenges, commends and reports

### 1.14.0 · 2026-11-13 · [d928a3b](https://github.com/cksarge/Battle-World/commit/d928a3b)

- Bad words are filtered out of match and party chat

### 1.13.0 · 2026-11-13 · [a7cdfe6](https://github.com/cksarge/Battle-World/commit/a7cdfe6)

- Full controller support, required on phones and tablets

### 1.12.0 · 2026-11-13 · [6f050c2](https://github.com/cksarge/Battle-World/commit/6f050c2)

- The main online modes appear as four tiles, with the rest under All modes

#### 1.11.1 · 2026-11-12 · [4af4a54](https://github.com/cksarge/Battle-World/commit/4af4a54)

- Saved loadouts stay intact when rebuys arrive late online

### 1.11.0 · 2026-11-12 · [2b60aca](https://github.com/cksarge/Battle-World/commit/2b60aca)

- The menu is a live 3D scene with your operator and party standing in a real map
- New stats page (form, modes, maps, weapons, rivals and a death heatmap)

### 1.10.0 · 2026-11-12 · [a7cafe5](https://github.com/cksarge/Battle-World/commit/a7cafe5)

- Parties in the matchmaker, stats tracking and front-facing previews

### 1.9.0 · 2026-11-12 · [838aa9f](https://github.com/cksarge/Battle-World/commit/838aa9f)

- Live spectating of online matches

### 1.8.0 · 2026-11-12 · [c6a69c3](https://github.com/cksarge/Battle-World/commit/c6a69c3)

- Kill cams and match replays

### 1.7.0 · 2026-11-12 · [e779a86](https://github.com/cksarge/Battle-World/commit/e779a86)

- Ladders, catwalks, mantling, fall damage and destructible wood

### 1.6.0 · 2026-11-12 · [b028f75](https://github.com/cksarge/Battle-World/commit/b028f75)

- Calling cards, kill effects, emotes and more finishes and outfits

### 1.5.0 · 2026-11-12 · [5261ba3](https://github.com/cksarge/Battle-World/commit/5261ba3)

- Loadout presets in the buy menu; the saved loadout is the kit you're holding

### 1.4.0 · 2026-11-12 · [f4f29df](https://github.com/cksarge/Battle-World/commit/f4f29df)

- 32 weapons in eight classes
- Flashbangs, incendiaries, proximity mines and decoys
- Economy for 1v1 Duel and Ranked 1v1
- Doors, breakable glass, explosive barrels and ammo crates
- Easier bots that throw grenades and open doors
- New textures, lighting, scenery and weather on every map

### 1.3.0 · 2026-11-11 · [3d0e219](https://github.com/cksarge/Battle-World/commit/3d0e219)

- Reconnect to a match after a disconnect, with a bot filling in meanwhile
- Fixed mouse capture, the warmup camera and spawn facing

### 1.2.0 · 2026-11-11 · [e007467](https://github.com/cksarge/Battle-World/commit/e007467)

- Four new maps: Foundry, Outpost, Canopy and Frostbite
- Team Deathmatch and Gun Game
- Eight new weapons
- Weapon finishes, outfits, operator perks and saved loadouts

#### 1.1.4 · 2026-11-11 · [60b09bf](https://github.com/cksarge/Battle-World/commit/60b09bf)

- Fixed grenades not throwing

#### 1.1.3 · 2026-11-11 · [25d9c2f](https://github.com/cksarge/Battle-World/commit/25d9c2f)

- 60-second cooldown between account emails

#### 1.1.2 · 2026-11-11 · [fbd2a78](https://github.com/cksarge/Battle-World/commit/fbd2a78)

- Fixed smoke turning black with ambient occlusion on

#### 1.1.1 · 2026-11-11 · [a3b19ad](https://github.com/cksarge/Battle-World/commit/a3b19ad)

- Password resets happen inside the game instead of a separate page

### 1.1.0 · 2026-11-11 · [24c3c6f](https://github.com/cksarge/Battle-World/commit/24c3c6f)

- Email confirmation and password reset with 6-digit codes
- Password rules and bot protection on sign-in

## 1.0.0 · 2026-11-11 · [080e771](https://github.com/cksarge/Battle-World/commit/080e771)

- First release: a browser 3D tactical shooter with Ranked 1v1, Duel, 2v2, 5v5 Bomb Defusal and Free For All, bots, a character creator, accounts, rankings and online multiplayer
