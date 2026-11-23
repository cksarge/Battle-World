-- Battle World — Supabase schema
-- Paste this whole file into Supabase Dashboard → SQL Editor → New query → Run.
-- Safe to re-run.

-- ───────────────────────── profiles ─────────────────────────
create table if not exists public.profiles (
  id            uuid primary key references auth.users on delete cascade,
  username      text unique not null
                check (char_length(username) between 3 and 16 and username ~ '^[A-Za-z0-9_]+$'),
  elo           int  not null default 1000,
  peak_elo      int  not null default 1000,
  ranked_wins   int  not null default 0,
  ranked_losses int  not null default 0,
  wins          int  not null default 0,
  losses        int  not null default 0,
  matches       int  not null default 0,
  kills         int  not null default 0,
  deaths        int  not null default 0,
  headshots     int  not null default 0,
  xp            int  not null default 0,
  character     jsonb,
  created_at    timestamptz not null default now(),
  last_seen     timestamptz not null default now()
);

-- Collected cosmetics (weapon finishes + outfits). Added after launch, so use IF NOT EXISTS.
alter table public.profiles add column if not exists inventory jsonb not null default '{}'::jsonb;

alter table public.profiles enable row level security;

drop policy if exists "profiles are public" on public.profiles;
create policy "profiles are public" on public.profiles for select using (true);

drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles
  for update using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Players may only edit cosmetic columns directly; stats change through the functions below.
revoke update on public.profiles from anon, authenticated;
grant update (character, last_seen, inventory) on public.profiles to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data ->> 'username');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────── match history ─────────────────────────
create table if not exists public.match_history (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  match_id    text not null,
  mode        text not null,
  map         text not null,
  ranked      boolean not null default false,
  online      boolean not null default true,
  result      text not null check (result in ('win', 'loss', 'draw')),
  kills       int not null default 0,
  deaths      int not null default 0,
  headshots   int not null default 0,
  score       text,
  elo_change  int not null default 0,
  created_at  timestamptz not null default now(),
  unique (user_id, match_id)
);
create index if not exists match_history_user_idx on public.match_history (user_id, created_at desc);
-- Per-match details for the stats page (weapon kills, accuracy, head-to-head, death spots).
alter table public.match_history add column if not exists details jsonb;
-- Assists (4.3.2): another player who did 30+ damage in the 5 seconds before a kill, or flashed the
-- victim, or threw the smoke the killer shot through.
alter table public.profiles add column if not exists assists int not null default 0;
alter table public.match_history add column if not exists assists int not null default 0;
-- Zombies (4.x): kills and deaths against the horde are kept apart from PvP totals, so K/D on
-- leaderboards, profiles and the admin outlier panel reflects player-vs-player only. The first run
-- moves zombie results already counted in kills/deaths/headshots over from match_history.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'zombie_kills') then
    alter table public.profiles add column zombie_kills int not null default 0;
    alter table public.profiles add column zombie_deaths int not null default 0;
    alter table public.profiles add column zombie_headshots int not null default 0;
    update public.profiles p set
      zombie_kills = z.k, zombie_deaths = z.d, zombie_headshots = z.hs,
      kills = greatest(p.kills - z.k, 0), deaths = greatest(p.deaths - z.d, 0), headshots = greatest(p.headshots - z.hs, 0)
    from (select user_id, sum(kills)::int as k, sum(deaths)::int as d, sum(headshots)::int as hs
          from public.match_history where online and mode = 'zombies' group by user_id) z
    where z.user_id = p.id;
  end if;
end $$;

alter table public.match_history enable row level security;
drop policy if exists "history is public" on public.match_history;
create policy "history is public" on public.match_history for select using (true);

-- ───────────────────────── ranked results ─────────────────────────
create table if not exists public.ranked_matches (
  match_id     text primary key,
  winner       uuid not null references public.profiles(id) on delete cascade,
  loser        uuid not null references public.profiles(id) on delete cascade,
  winner_delta int  not null,
  loser_delta  int  not null,
  created_at   timestamptz not null default now()
);
alter table public.ranked_matches enable row level security;
drop policy if exists "ranked results are public" on public.ranked_matches;
create policy "ranked results are public" on public.ranked_matches for select using (true);

-- report_ranked and record_match are defined further down (with season tracking and ban checks).

-- Older record_match versions are dropped so the RPC isn't ambiguous.
drop function if exists public.record_match(text, text, text, boolean, boolean, text, int, int, int, text, int);
drop function if exists public.record_match(text, text, text, boolean, boolean, text, int, int, int, text, int, jsonb);


-- ═════════════════════════ seasons, challenges, commends, reports, admin ═════════════════════════
-- Added November 2026. Safe to re-run.

-- ───────────── seasons ─────────────
-- Season boundaries live here (UTC). The client reads this table; rewards and names are in js/data/seasons.js.
create table if not exists public.seasons (
  id        text primary key,
  num       int  not null,
  name      text not null,
  starts_at timestamptz not null,
  ends_at   timestamptz not null
);
alter table public.seasons enable row level security;
revoke insert, update, delete on public.seasons from anon, authenticated;
drop policy if exists "seasons are public" on public.seasons;
create policy "seasons are public" on public.seasons for select using (true);
insert into public.seasons (id, num, name, starts_at, ends_at) values
  ('s1', 1, 'First Contact', '2026-11-01 00:00:00+00', '2027-01-01 00:00:00+00'),
  ('s2', 2, 'Frostline',     '2027-01-01 00:00:00+00', '2027-04-01 00:00:00+00'),
  ('s3', 3, 'Overgrowth',    '2027-04-01 00:00:00+00', '2027-07-01 00:00:00+00'),
  ('s4', 4, 'Heatwave',      '2027-07-01 00:00:00+00', '2027-10-01 00:00:00+00'),
  ('s5', 5, 'Nightfall',     '2027-10-01 00:00:00+00', '2028-01-01 00:00:00+00')
on conflict (id) do update set num = excluded.num, name = excluded.name, starts_at = excluded.starts_at, ends_at = excluded.ends_at;

-- Per-season progress on the profile. Written only by the functions below.
alter table public.profiles add column if not exists season_id     text;
alter table public.profiles add column if not exists pass_xp       int not null default 0;
alter table public.profiles add column if not exists season_wins   int not null default 0;
alter table public.profiles add column if not exists season_losses int not null default 0;
alter table public.profiles add column if not exists season_peak   int not null default 1000;
-- Challenge progress is tracked by the client (like match stats); claims are checked by claim_challenge.
alter table public.profiles add column if not exists challenges    jsonb not null default '{}'::jsonb;
grant update (challenges) on public.profiles to authenticated;
-- Achievements (js/data/achievements.js): tracked by the client like challenges. Badges only, no rewards.
alter table public.profiles add column if not exists achievements jsonb not null default '{}'::jsonb;
alter table public.profiles drop constraint if exists achievements_size;
alter table public.profiles add constraint achievements_size check (pg_column_size(achievements) <= 16000);
grant update (achievements) on public.profiles to authenticated;

-- Ranked results an admin has voided are kept, flagged, so the match can't be reported again.
alter table public.ranked_matches add column if not exists voided boolean not null default false;
-- Who sent the result that counted, and whether the other player's game later reported the opposite.
alter table public.ranked_matches add column if not exists reporter uuid;
alter table public.ranked_matches add column if not exists disputed boolean not null default false;

create table if not exists public.season_history (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  season_id   text not null references public.seasons(id),
  final_elo   int  not null,
  peak_elo    int  not null,
  wins        int  not null,
  losses      int  not null,
  pass_xp     int  not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, season_id)
);
alter table public.season_history enable row level security;
revoke insert, update, delete on public.season_history from anon, authenticated;
drop policy if exists "season history is public" on public.season_history;
create policy "season history is public" on public.season_history for select using (true);

create or replace function public.current_season()
returns text language sql stable set search_path = public as $$
  select id from seasons where now() >= starts_at and now() < ends_at order by starts_at limit 1;
$$;

-- Moves a player into the current season the first time they play in it. On a rollover the old
-- season is archived and ELO is pulled halfway back to 1000 (a soft reset). Safe to call repeatedly.
create or replace function public.ensure_season(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare cur text := current_season(); p profiles%rowtype;
begin
  if cur is null then return; end if;
  select * into p from profiles where id = p_user for update;
  if not found or p.season_id is not distinct from cur then return; end if;
  if p.season_id is not null then
    insert into season_history (user_id, season_id, final_elo, peak_elo, wins, losses, pass_xp)
    values (p_user, p.season_id, p.elo, p.season_peak, p.season_wins, p.season_losses, p.pass_xp)
    on conflict do nothing;
    update profiles set elo = 1000 + round((elo - 1000) / 2.0)::int where id = p_user;
  end if;
  update profiles set season_id = cur, pass_xp = 0, season_wins = 0, season_losses = 0, season_peak = elo where id = p_user;
end;
$$;

-- ───────────── moderation (private: each player sees only their own row) ─────────────
create table if not exists public.admins (user_id uuid primary key references public.profiles(id) on delete cascade);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;
-- The only admin is Carter. Nothing in the app can add rows here. On a database where that account
-- doesn't exist (a new project or a fork) this adds nobody instead of failing.
insert into public.admins (user_id)
select id from public.profiles where id = '161b8bab-6d36-4845-8179-3e72255f466b'
on conflict do nothing;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from admins where user_id = auth.uid());
$$;

create table if not exists public.moderation (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  banned_until timestamptz,
  ban_reason   text,
  muted_until  timestamptz,
  mute_reason  text,
  kick_at      timestamptz,
  kick_reason  text,
  updated_at   timestamptz not null default now()
);
alter table public.moderation enable row level security;
revoke all on public.moderation from anon, authenticated;
grant select on public.moderation to authenticated;
drop policy if exists "own moderation" on public.moderation;
create policy "own moderation" on public.moderation for select using ((select auth.uid()) = user_id);

-- Ban appeals and device bans (4.0.0). banned_at marks when the current ban started (one appeal per ban).
alter table public.moderation add column if not exists banned_at timestamptz;
alter table public.moderation add column if not exists ban_appealable boolean not null default true;
alter table public.moderation add column if not exists device_ban boolean not null default false;

-- Each browser keeps a random device id (js/net/device.js); signing in links it to the account.
create table if not exists public.player_devices (
  device_id  text not null check (char_length(device_id) between 8 and 64),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  primary key (device_id, user_id)
);
create index if not exists player_devices_user_idx on public.player_devices (user_id);
alter table public.player_devices enable row level security;
revoke all on public.player_devices from anon, authenticated;

-- Devices of accounts given a device ban. Signing in on one bans that account too (ban evasion).
create table if not exists public.banned_devices (
  device_id  text primary key,
  user_id    uuid references public.profiles(id) on delete set null,
  reason     text,
  created_at timestamptz not null default now()
);
alter table public.banned_devices enable row level security;
revoke all on public.banned_devices from anon, authenticated;

create table if not exists public.ban_appeals (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  message      text not null check (char_length(message) between 1 and 1000),
  ban_reason   text,
  banned_until timestamptz,
  status       text not null default 'open' check (status in ('open', 'accepted', 'denied')),
  admin_note   text,
  resolved_at  timestamptz
);
create index if not exists ban_appeals_status_idx on public.ban_appeals (status, created_at desc);
alter table public.ban_appeals enable row level security;
revoke all on public.ban_appeals from anon, authenticated;

-- Friendly-fire kicks (4.2.0). The match host records them; repeated ones bring matchmaking cooldowns
-- and then a ban (report_ff_kick).
alter table public.moderation add column if not exists queue_cooldown_until timestamptz;
create table if not exists public.ff_penalties (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  reporter    uuid references public.profiles(id) on delete set null,
  match_id    text not null,
  team_kills  int not null default 0,
  team_damage int not null default 0,
  created_at  timestamptz not null default now(),
  unique (user_id, match_id)
);
create index if not exists ff_penalties_user_idx on public.ff_penalties (user_id, created_at desc);
alter table public.ff_penalties enable row level security;
revoke all on public.ff_penalties from anon, authenticated;

create table if not exists public.warnings (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  message    text not null,
  seen       boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.warnings enable row level security;
revoke all on public.warnings from anon, authenticated;
grant select on public.warnings to authenticated;
drop policy if exists "own warnings" on public.warnings;
create policy "own warnings" on public.warnings for select using ((select auth.uid()) = user_id);
-- 'warning' (a telling-off from admin_warn) or 'notice' (information, e.g. a ranked result was voided).
alter table public.warnings add column if not exists kind text not null default 'warning';
alter table public.warnings drop constraint if exists warnings_kind_check;
alter table public.warnings add constraint warnings_kind_check check (kind in ('warning', 'notice'));

-- Items an admin gives or takes away; the player's client applies them to its inventory.
create table if not exists public.item_grants (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null,
  item       text not null,
  revoke     boolean not null default false,
  applied    boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.item_grants enable row level security;
revoke all on public.item_grants from anon, authenticated;
grant select on public.item_grants to authenticated;
drop policy if exists "own grants" on public.item_grants;
create policy "own grants" on public.item_grants for select using ((select auth.uid()) = user_id);

create table if not exists public.announcements (
  id         bigint generated always as identity primary key,
  message    text not null check (char_length(message) between 1 and 300),
  kind       text not null default 'info' check (kind in ('info', 'warn', 'event')),
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz not null,
  created_by uuid references public.profiles(id) on delete set null
);
alter table public.announcements enable row level security;
revoke all on public.announcements from anon, authenticated;
grant select on public.announcements to anon, authenticated;
drop policy if exists "live announcements are public" on public.announcements;
create policy "live announcements are public" on public.announcements for select using (now() >= starts_at and now() < ends_at);

-- Polls (4.10.0). Players read and vote only through polls_list() and poll_vote(); admins make them with
-- admin_create_poll(). cutoff: only accounts created before it may vote (null = anyone with an account).
create table if not exists public.polls (
  id          bigint generated always as identity primary key,
  question    text not null check (char_length(question) between 1 and 200),
  options     jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 10),
  eligibility text not null default 'anyone' check (eligibility in ('anyone', 'before_start', 'before_date')),
  cutoff      timestamptz,
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz not null,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.polls enable row level security;
revoke all on public.polls from anon, authenticated;

create table if not exists public.poll_votes (
  poll_id    bigint not null references public.polls(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  choice     int not null,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);
alter table public.poll_votes enable row level security;
revoke all on public.poll_votes from anon, authenticated;

-- Global switches such as maintenance mode: {"maintenance": {"on": true, "message": "..."}}.
create table if not exists public.app_settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to anon, authenticated;
drop policy if exists "settings are public" on public.app_settings;
create policy "settings are public" on public.app_settings for select using (true);

create table if not exists public.admin_audit (
  id         bigint generated always as identity primary key,
  admin_id   uuid not null,
  action     text not null,
  target     text,
  details    jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from anon, authenticated;

create or replace function public.is_banned(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from moderation where user_id = p_user and banned_until is not null and banned_until > now());
$$;

-- Ban and mute flags for a list of players (ids only, no reasons), so clients can keep banned
-- players out of queues and lobbies and hide chat from muted ones.
create or replace function public.moderation_flags(p_ids uuid[])
returns table (id uuid, banned boolean, muted boolean) language sql stable security definer set search_path = public as $$
  select m.user_id, coalesce(m.banned_until > now(), false), coalesce(m.muted_until > now(), false)
  from moderation m where m.user_id = any(p_ids[1:100])
    and ((m.banned_until is not null and m.banned_until > now()) or (m.muted_until is not null and m.muted_until > now()));
$$;

-- Everything the signed-in player's client needs to know about itself, polled every half minute.
create or replace function public.my_status()
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m moderation%rowtype;
begin
  if uid is null then return null; end if;
  perform ensure_season(uid);
  select * into m from moderation where user_id = uid;
  return json_build_object(
    'banned_until', case when m.banned_until > now() then m.banned_until end, 'ban_reason', m.ban_reason,
    'ban_appealable', coalesce(m.ban_appealable, true),
    'queue_cooldown_until', case when m.queue_cooldown_until > now() then m.queue_cooldown_until end,
    'appeal', case when m.banned_until > now() then (select json_build_object('status', a.status, 'note', a.admin_note) from ban_appeals a
      where a.user_id = uid and a.created_at >= coalesce(m.banned_at, m.updated_at) order by a.id desc limit 1) end,
    'muted_until', case when m.muted_until > now() then m.muted_until end, 'mute_reason', m.mute_reason,
    'kick_at', m.kick_at, 'kick_reason', m.kick_reason,
    'warnings', (select coalesce(json_agg(json_build_object('id', w.id, 'message', w.message, 'at', w.created_at, 'kind', w.kind) order by w.id), '[]') from warnings w where w.user_id = uid and not w.seen),
    'grants', (select coalesce(json_agg(json_build_object('id', g.id, 'kind', g.kind, 'item', g.item, 'revoke', g.revoke) order by g.id), '[]') from item_grants g where g.user_id = uid and not g.applied),
    'season', current_season(),
    'admin', is_admin(),
    'friend_requests', (select count(*) from friends where friend_id = uid and status = 'pending')
  );
end;
$$;

-- Links this browser to the signed-in account. A device banned for another account bans this one too
-- (permanently, no appeal) along with every device it has used. Admin accounts are never caught by it.
create or replace function public.register_device(p_device text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or p_device is null or char_length(p_device) not between 8 and 64 then return false; end if;
  insert into player_devices (device_id, user_id) values (p_device, uid)
  on conflict (device_id, user_id) do update set last_seen = now();
  if exists (select 1 from admins where user_id = uid) or not exists (select 1 from banned_devices where device_id = p_device) then return false; end if;
  if not is_banned(uid) then
    insert into moderation (user_id, banned_until, banned_at, ban_reason, ban_appealable, device_ban, kick_at, kick_reason, updated_at)
    values (uid, 'infinity', now(), 'Ban evasion: this device belongs to a banned account', false, true, now(), 'Banned', now())
    on conflict (user_id) do update set banned_until = 'infinity', banned_at = now(), ban_reason = excluded.ban_reason,
      ban_appealable = false, device_ban = true, kick_at = now(), kick_reason = 'Banned', updated_at = now();
  end if;
  insert into banned_devices (device_id, user_id, reason)
  select d.device_id, uid, 'Ban evasion' from player_devices d
  where d.user_id = uid and not exists (select 1 from player_devices a join admins ad on ad.user_id = a.user_id where a.device_id = d.device_id)
  on conflict (device_id) do nothing;
  return true;
end;
$$;

-- A banned player asks for their ban to be lifted: once per ban, and only if the ban allows it.
create or replace function public.submit_appeal(p_message text)
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  m moderation%rowtype;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select * into m from moderation where user_id = uid;
  if not found or m.banned_until is null or m.banned_until <= now() then raise exception 'You are not banned.'; end if;
  if not m.ban_appealable then raise exception 'This ban can''t be appealed.'; end if;
  if coalesce(trim(p_message), '') = '' then raise exception 'Write your appeal first.'; end if;
  if exists (select 1 from ban_appeals where user_id = uid and created_at >= coalesce(m.banned_at, m.updated_at)) then
    raise exception 'You have already appealed this ban.';
  end if;
  insert into ban_appeals (user_id, message, ban_reason, banned_until) values (uid, left(trim(p_message), 1000), m.ban_reason, m.banned_until);
end;
$$;
-- The host reports a player kicked for team killing (one record per player per match). Kicks in the
-- last 30 days set the penalty: 1st 30 min queue cooldown, 2nd 2 h, 3rd 24 h, 4th 7 days, 5th or more a
-- 14-day ban (appealable; never shortens or replaces a longer ban). Admins are never penalised.
create or replace function public.report_ff_kick(p_match_id text, p_target uuid, p_team_kills int, p_team_damage int)
returns json language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  n int;
  until timestamptz;
begin
  if uid is null or p_target is null or p_match_id is null then return null; end if;
  if not exists (select 1 from profiles where id = p_target) or exists (select 1 from admins where user_id = p_target) then return null; end if;
  if (select count(*) from ff_penalties where reporter = uid and created_at > now() - interval '1 hour') >= 10 then return null; end if;
  insert into ff_penalties (user_id, reporter, match_id, team_kills, team_damage)
  values (p_target, uid, left(p_match_id, 80), least(greatest(coalesce(p_team_kills, 0), 0), 50), least(greatest(coalesce(p_team_damage, 0), 0), 5000))
  on conflict (user_id, match_id) do nothing;
  if not found then return null; end if;
  select count(*) into n from ff_penalties where user_id = p_target and created_at > now() - interval '30 days';
  if n >= 5 then
    until := now() + interval '14 days';
    insert into moderation (user_id, banned_until, banned_at, ban_reason, ban_appealable, kick_at, kick_reason, updated_at)
    values (p_target, until, now(), 'Repeated team killing', true, now(), 'Banned', now())
    on conflict (user_id) do update set banned_until = excluded.banned_until, banned_at = now(), ban_reason = excluded.ban_reason,
      ban_appealable = true, kick_at = now(), kick_reason = 'Banned', updated_at = now()
    where moderation.banned_until is null or moderation.banned_until < excluded.banned_until;
    return json_build_object('offenses', n, 'banned_until', until);
  end if;
  until := now() + case n when 1 then interval '30 minutes' when 2 then interval '2 hours' when 3 then interval '24 hours' else interval '7 days' end;
  insert into moderation (user_id, queue_cooldown_until, updated_at) values (p_target, until, now())
  on conflict (user_id) do update set queue_cooldown_until = greatest(coalesce(moderation.queue_cooldown_until, now()), excluded.queue_cooldown_until), updated_at = now();
  return json_build_object('offenses', n, 'cooldown_until', until);
end;
$$;
revoke all on function public.report_ff_kick(text, uuid, int, int) from public, anon;
grant execute on function public.report_ff_kick(text, uuid, int, int) to authenticated;

revoke all on function public.register_device(text) from public, anon;
grant execute on function public.register_device(text) to authenticated;
revoke all on function public.submit_appeal(text) from public, anon;
grant execute on function public.submit_appeal(text) to authenticated;

create or replace function public.ack_status(p_warnings bigint[], p_grants bigint[])
returns void language sql security definer set search_path = public as $$
  update warnings set seen = true where user_id = auth.uid() and id = any(p_warnings);
  update item_grants set applied = true where user_id = auth.uid() and id = any(p_grants);
$$;

-- ───────────── commends and reports ─────────────
create table if not exists public.commends (
  from_id    uuid not null references public.profiles(id) on delete cascade,
  to_id      uuid not null references public.profiles(id) on delete cascade,
  match_id   text not null,
  kind       text not null check (kind in ('friendly', 'leader', 'teacher', 'clutch')),
  created_at timestamptz not null default now(),
  primary key (from_id, to_id, match_id)
);
alter table public.commends enable row level security;
revoke all on public.commends from anon, authenticated;

create or replace function public.commend_player(p_to uuid, p_match text, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  if is_banned(uid) then raise exception 'account banned'; end if;
  if p_to = uid then raise exception 'you cannot commend yourself'; end if;
  if not exists (select 1 from profiles where id = p_to) then raise exception 'player not found'; end if;
  if (select count(*) from commends where from_id = uid and created_at > now() - interval '1 day') >= 30 then raise exception 'daily commend limit reached'; end if;
  insert into commends (from_id, to_id, match_id, kind) values (uid, p_to, left(p_match, 64), p_kind) on conflict do nothing;
end;
$$;

create or replace function public.player_commends(p_id uuid)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_object_agg(kind, n), '{}') from (select kind, count(*) n from commends where to_id = p_id group by kind) t;
$$;

create table if not exists public.reports (
  id          bigint generated always as identity primary key,
  reporter    uuid not null references public.profiles(id) on delete cascade,
  target      uuid not null references public.profiles(id) on delete cascade,
  match_id    text not null,
  mode        text,
  reason      text not null check (reason in ('cheating', 'griefing', 'abuse', 'name', 'afk', 'other')),
  note        text check (char_length(note) <= 500),
  evidence    jsonb,
  status      text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  resolution  text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (reporter, target, match_id)
);
create index if not exists reports_status_idx on public.reports (status, created_at desc);
alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;

create or replace function public.report_player(p_target uuid, p_match text, p_mode text, p_reason text, p_note text, p_evidence jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  if is_banned(uid) then raise exception 'account banned'; end if;
  if p_target = uid then raise exception 'you cannot report yourself'; end if;
  if not exists (select 1 from profiles where id = p_target) then raise exception 'player not found'; end if;
  if (select count(*) from reports where reporter = uid and created_at > now() - interval '1 day') >= 20 then raise exception 'daily report limit reached'; end if;
  insert into reports (reporter, target, match_id, mode, reason, note, evidence)
  values (uid, p_target, left(p_match, 64), left(p_mode, 20), p_reason, left(p_note, 500),
          case when p_evidence is not null and pg_column_size(p_evidence) <= 16000 then p_evidence end)
  on conflict (reporter, target, match_id) do update set reason = excluded.reason, note = excluded.note, evidence = excluded.evidence;
end;
$$;

-- ───────────── friends ─────────────
-- One row per pair: user_id sent the request, friend_id received it. Private: only changed and
-- read through the functions below.
create table if not exists public.friends (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  friend_id   uuid not null references public.profiles(id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);
create index if not exists friends_friend_idx on public.friends (friend_id);
alter table public.friends enable row level security;
revoke all on public.friends from anon, authenticated;

-- Sends a friend request, or accepts theirs if they already asked you. Returns 'sent', 'accepted' or 'already'.
create or replace function public.friend_request(p_to uuid)
returns text language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); r friends%rowtype;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if is_banned(uid) then raise exception 'account banned'; end if;
  if p_to = uid then raise exception 'you can''t add yourself'; end if;
  if not exists (select 1 from profiles where id = p_to) then raise exception 'player not found'; end if;
  select * into r from friends where (user_id = uid and friend_id = p_to) or (user_id = p_to and friend_id = uid) for update;
  if found then
    if r.status = 'accepted' then return 'already'; end if;
    if r.user_id = uid then return 'sent'; end if;
    update friends set status = 'accepted', accepted_at = now() where user_id = p_to and friend_id = uid;
    return 'accepted';
  end if;
  if (select count(*) from friends where (user_id = uid or friend_id = uid) and status = 'accepted') >= 200 then raise exception 'friends list is full (200)'; end if;
  if (select count(*) from friends where user_id = uid and created_at > now() - interval '1 day') >= 30 then raise exception 'daily friend request limit reached'; end if;
  insert into friends (user_id, friend_id) values (uid, p_to);
  return 'sent';
end;
$$;

create or replace function public.friend_respond(p_from uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_accept then
    update friends set status = 'accepted', accepted_at = now() where user_id = p_from and friend_id = uid and status = 'pending';
  else
    delete from friends where user_id = p_from and friend_id = uid and status = 'pending';
  end if;
end;
$$;

-- Unfriends, or cancels a request you sent.
create or replace function public.friend_remove(p_id uuid)
returns void language sql security definer set search_path = public as $$
  delete from friends where (user_id = auth.uid() and friend_id = p_id) or (user_id = p_id and friend_id = auth.uid());
$$;

-- Your friends and pending requests, with what the friends list shows about each player.
create or replace function public.my_friends()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
    'id', p.id, 'username', p.username, 'elo', p.elo, 'xp', p.xp, 'last_seen', p.last_seen,
    'card', p.character ->> 'card', 'status', f.status, 'incoming', f.friend_id = auth.uid(), 'since', coalesce(f.accepted_at, f.created_at)
  ) order by p.username), '[]')
  from friends f join profiles p on p.id = case when f.user_id = auth.uid() then f.friend_id else f.user_id end
  where auth.uid() is not null and (f.user_id = auth.uid() or f.friend_id = auth.uid());
$$;

-- ───────────── custom maps (map editor) ─────────────
-- Up to 5 per account. `data` is the grid ({w, h, rows, spawns, sites, theme}); the game cleans it
-- again before use (js/data/custommaps.js). Featured slots 1-2 are small maps, 3-4 large; players
-- like maps and the admin picks which ones fill the slots. Everyone can read maps; changes go
-- through the functions below.
create table if not exists public.custom_maps (
  id            bigint generated always as identity primary key,
  owner         uuid not null references public.profiles(id) on delete cascade,
  name          text not null check (char_length(name) between 3 and 24),
  description   text check (char_length(description) <= 120),
  size          text not null check (size in ('small', 'large')),
  data          jsonb not null check (pg_column_size(data) <= 24000),
  likes         int not null default 0,
  featured_slot int check (featured_slot between 1 and 4),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists custom_maps_owner_idx on public.custom_maps (owner);
create index if not exists custom_maps_likes_idx on public.custom_maps (likes desc);
create unique index if not exists custom_maps_slot_idx on public.custom_maps (featured_slot) where featured_slot is not null;
alter table public.custom_maps enable row level security;
revoke all on public.custom_maps from anon, authenticated;
grant select on public.custom_maps to anon, authenticated;
drop policy if exists "maps are public" on public.custom_maps;
create policy "maps are public" on public.custom_maps for select using (true);

create table if not exists public.map_likes (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  map_id     bigint not null references public.custom_maps(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, map_id)
);
alter table public.map_likes enable row level security;
revoke all on public.map_likes from anon, authenticated;

-- Creates (p_id null) or updates one of your maps. Returns its id. Editing a featured map takes it
-- out of its slot until the admin approves it again.
create or replace function public.save_custom_map(p_id bigint, p_name text, p_description text, p_size text, p_data jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); new_id bigint; w int; h int;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if is_banned(uid) then raise exception 'account banned'; end if;
  if p_name !~ '^[A-Za-z0-9 _''-]{3,24}$' then raise exception 'map names are 3-24 letters, numbers, spaces, - or _'; end if;
  if p_size not in ('small', 'large') then raise exception 'invalid map size'; end if;
  if p_data is null or pg_column_size(p_data) > 24000 then raise exception 'map is too big'; end if;
  w := (p_data ->> 'w')::int; h := (p_data ->> 'h')::int;
  if w is null or h is null or w < 14 or h < 10 or w > 52 or h > 48 or jsonb_array_length(p_data -> 'rows') <> h then raise exception 'invalid map grid'; end if;
  if p_id is null then
    if (select count(*) from custom_maps where owner = uid) >= 5 then raise exception 'you can upload up to 5 maps. Delete one first.'; end if;
    insert into custom_maps (owner, name, description, size, data) values (uid, p_name, left(p_description, 120), p_size, p_data) returning id into new_id;
    return new_id;
  end if;
  update custom_maps set name = p_name, description = left(p_description, 120), size = p_size, data = p_data, featured_slot = null, updated_at = now()
  where id = p_id and owner = uid;
  if not found then raise exception 'map not found'; end if;
  return p_id;
end;
$$;

create or replace function public.delete_custom_map(p_id bigint)
returns void language sql security definer set search_path = public as $$
  delete from custom_maps where id = p_id and owner = auth.uid();
$$;

-- Likes or unlikes a map. Returns its new like count.
create or replace function public.like_custom_map(p_id bigint, p_like boolean)
returns int language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n int;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if is_banned(uid) then raise exception 'account banned'; end if;
  if p_like then insert into map_likes (user_id, map_id) values (uid, p_id) on conflict do nothing;
  else delete from map_likes where user_id = uid and map_id = p_id; end if;
  update custom_maps set likes = (select count(*) from map_likes where map_id = p_id) where id = p_id returning likes into n;
  return coalesce(n, 0);
end;
$$;

create or replace function public.my_map_likes()
returns bigint[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(map_id), '{}') from map_likes where user_id = auth.uid();
$$;

-- ───────────── feedback and bug reports ─────────────
-- Sent from the Feedback button in the menu; only the admin can read them (admin_feedback).
create table if not exists public.feedback (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('bug', 'feedback', 'idea')),
  message     text not null check (char_length(message) between 5 and 2000),
  context     jsonb check (context is null or pg_column_size(context) <= 4000),
  status      text not null default 'open' check (status in ('open', 'resolved')),
  admin_note  text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists feedback_status_idx on public.feedback (status, created_at desc);
alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;

create or replace function public.submit_feedback(p_kind text, p_message text, p_context jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sign in to send feedback'; end if;
  if is_banned(uid) then raise exception 'account banned'; end if;
  if p_kind not in ('bug', 'feedback', 'idea') then raise exception 'invalid type'; end if;
  if char_length(trim(coalesce(p_message, ''))) < 5 then raise exception 'write a little more (at least 5 characters)'; end if;
  if (select count(*) from feedback where user_id = uid and created_at > now() - interval '1 day') >= 10 then raise exception 'you can send 10 messages a day. Thanks for all the feedback!'; end if;
  insert into feedback (user_id, kind, message, context)
  values (uid, p_kind, left(trim(p_message), 2000), case when p_context is not null and pg_column_size(p_context) <= 4000 then p_context end);
end;
$$;

-- ───────────── challenges ─────────────
create table if not exists public.challenge_claims (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  key        text not null,
  xp         int  not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.challenge_claims enable row level security;
revoke all on public.challenge_claims from anon, authenticated;

-- Keys look like d:2026-11-13:0 (daily) or w:2026-W46:2 (weekly). Only the current day or week,
-- three of each, with fixed rewards, so a tampered client can't farm XP.
create or replace function public.claim_challenge(p_key text)
returns int language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); amount int; parts text[] := string_to_array(p_key, ':');
begin
  if uid is null then raise exception 'not signed in'; end if;
  if is_banned(uid) then raise exception 'account banned'; end if;
  if array_length(parts, 1) <> 3 or parts[3] not in ('0', '1', '2') then raise exception 'invalid challenge'; end if;
  if parts[1] = 'd' and parts[2] = to_char(now() at time zone 'utc', 'YYYY-MM-DD') then amount := 300;
  elsif parts[1] = 'w' and parts[2] = to_char(now() at time zone 'utc', 'IYYY-"W"IW') then amount := 1000;
  else raise exception 'that challenge has expired'; end if;
  insert into challenge_claims (user_id, key, xp) values (uid, p_key, amount) on conflict do nothing;
  if not found then return 0; end if;
  perform ensure_season(uid);
  update profiles set xp = xp + amount, pass_xp = pass_xp + amount where id = uid;
  return amount;
end;
$$;

-- ───────────── ranked and match results: season tracking + bans ─────────────
-- Cheat flags: players' games report impossible things they see another player (or the host) do,
-- such as moving too fast, shooting through walls, firing too fast, impossible purchases or round results.
-- Players can't read them; they're listed in Admin → Cheat flags. Ranked disputes are added by report_ranked.
-- Each game also flags itself (flag_self: reporter = target) for signs of cheat scripts on its own page.
create table if not exists public.cheat_flags (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  reporter   uuid not null references public.profiles(id) on delete cascade,
  target     uuid references public.profiles(id) on delete cascade,
  match_id   text not null,
  mode       text,
  kind       text not null check (kind in ('speed', 'wall_shot', 'fire_rate', 'money', 'round', 'forged_hit', 'ranked_dispute', 'tampered', 'injected_script', 'synthetic_input', 'autoclicker', 'aim_hook', 'triggerbot')),
  details    jsonb,
  unique (reporter, match_id, target, kind)
);
create index if not exists cheat_flags_target_idx on public.cheat_flags (target, created_at desc);
alter table public.cheat_flags drop constraint if exists cheat_flags_kind_check;
alter table public.cheat_flags add constraint cheat_flags_kind_check check (kind in ('speed', 'wall_shot', 'fire_rate', 'money', 'round', 'forged_hit', 'ranked_dispute', 'tampered', 'injected_script', 'synthetic_input', 'autoclicker', 'aim_hook', 'triggerbot'));
-- Worked through in the admin panel: open until resolved (acted on) or dismissed.
alter table public.cheat_flags add column if not exists status text not null default 'open';
alter table public.cheat_flags add column if not exists resolution text;
alter table public.cheat_flags add column if not exists resolved_at timestamptz;
alter table public.cheat_flags drop constraint if exists cheat_flags_status_check;
alter table public.cheat_flags add constraint cheat_flags_status_check check (status in ('open', 'resolved', 'dismissed'));
create index if not exists cheat_flags_status_idx on public.cheat_flags (status, id desc);
alter table public.cheat_flags enable row level security;
revoke all on public.cheat_flags from anon, authenticated;

create or replace function public.flag_player(p_match_id text, p_target uuid, p_kind text, p_mode text, p_details jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or p_target is null or p_target = uid or p_match_id is null then return; end if;
  if p_kind not in ('speed', 'wall_shot', 'fire_rate', 'money', 'round', 'forged_hit') then return; end if;
  if not exists (select 1 from profiles where id = p_target) then return; end if;
  if (select count(*) from cheat_flags where reporter = uid and created_at > now() - interval '1 hour') >= 30 then return; end if;
  insert into cheat_flags (reporter, target, match_id, mode, kind, details)
  values (uid, p_target, left(p_match_id, 80), left(p_mode, 30), p_kind,
          case when p_details is not null and pg_column_size(p_details) <= 4000 then p_details end)
  on conflict do nothing;
end;
$$;
revoke all on function public.flag_player(text, uuid, text, text, jsonb) from public, anon;
grant execute on function public.flag_player(text, uuid, text, text, jsonb) to authenticated;

-- A player's own game reporting signs of cheat scripts on itself (js/game/anticheat.js, selfAudit).
-- Shares flag_player's limit of 30 flags an hour per player.
create or replace function public.flag_self(p_match_id text, p_kind text, p_mode text, p_details jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or p_match_id is null then return; end if;
  if p_kind not in ('tampered', 'injected_script', 'synthetic_input', 'autoclicker', 'aim_hook', 'triggerbot') then return; end if;
  if (select count(*) from cheat_flags where reporter = uid and created_at > now() - interval '1 hour') >= 30 then return; end if;
  insert into cheat_flags (reporter, target, match_id, mode, kind, details)
  values (uid, uid, left(p_match_id, 80), left(p_mode, 30), p_kind,
          case when p_details is not null and pg_column_size(p_details) <= 4000 then p_details end)
  on conflict do nothing;
end;
$$;
revoke all on function public.flag_self(text, text, text, jsonb) from public, anon;
grant execute on function public.flag_self(text, text, text, jsonb) to authenticated;

-- Sign in with a username: returns the account's email only when the password is right, so emails
-- can't be looked up without it. Five wrong passwords per username lock it for 15 minutes. The game
-- then signs in with the email through Supabase Auth as usual (captcha and all).
create table if not exists public.login_attempts (
  username text not null,
  at       timestamptz not null default now()
);
create index if not exists login_attempts_idx on public.login_attempts (username, at);
alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from anon, authenticated;

create or replace function public.email_for_login(p_username text, p_password text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  name text := lower(trim(p_username));
  addr text;
  ok boolean;
begin
  if name is null or name = '' or p_password is null or length(p_password) > 72 then return null; end if;
  delete from login_attempts where at < now() - interval '1 day';
  if (select count(*) from login_attempts where username = name and at > now() - interval '15 minutes') >= 5 then
    raise exception 'too many sign-in attempts';
  end if;
  select u.email, u.encrypted_password = crypt(p_password, u.encrypted_password)
    into addr, ok
    from profiles p join auth.users u on u.id = p.id
    where lower(p.username) = name
    limit 1;
  if ok then
    delete from login_attempts where username = name;
    return addr;
  end if;
  insert into login_attempts (username) values (name);
  return null;
end;
$$;
revoke all on function public.email_for_login(text, text) from public;
grant execute on function public.email_for_login(text, text) to anon, authenticated;

create or replace function public.report_ranked(p_match_id text, p_winner uuid, p_loser uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  r ranked_matches%rowtype;
  we int; le int; expected float; d int;
begin
  if auth.uid() is null or auth.uid() not in (p_winner, p_loser) then
    raise exception 'not a participant';
  end if;
  if p_winner = p_loser then raise exception 'invalid result'; end if;
  if is_banned(auth.uid()) then raise exception 'account banned'; end if;

  select * into r from ranked_matches where match_id = p_match_id;
  if found then
    -- Voided results stay recorded (so they can't be reported again) and count for nothing.
    if r.voided then return json_build_object('winner', r.winner, 'winner_delta', 0, 'loser_delta', 0); end if;
    -- The other player's game says the opposite: keep the result, but mark it disputed and flag it for
    -- the admin (who can void it). Leaving still counts as a loss, since a leaver never reports.
    if r.winner <> p_winner and r.reporter is not null and r.reporter <> auth.uid() and not r.disputed then
      update ranked_matches set disputed = true where match_id = p_match_id;
      insert into cheat_flags (reporter, target, match_id, mode, kind, details)
      values (auth.uid(), r.reporter, p_match_id, 'ranked', 'ranked_dispute',
              json_build_object('counted_winner', r.winner, 'reported_winner', p_winner)::jsonb)
      on conflict do nothing;
    end if;
    return json_build_object('winner', r.winner, 'winner_delta', r.winner_delta, 'loser_delta', r.loser_delta);
  end if;

  perform ensure_season(p_winner);
  perform ensure_season(p_loser);
  begin
    select elo into we from profiles where id = p_winner for update;
    select elo into le from profiles where id = p_loser for update;
    expected := 1.0 / (1.0 + power(10.0, (le - we) / 400.0));
    d := greatest(5, round(32 * (1 - expected)))::int;

    update profiles set elo = elo + d, peak_elo = greatest(peak_elo, elo + d), season_peak = greatest(season_peak, elo + d),
           ranked_wins = ranked_wins + 1, season_wins = season_wins + 1 where id = p_winner;
    update profiles set elo = greatest(0, elo - d),
           ranked_losses = ranked_losses + 1, season_losses = season_losses + 1 where id = p_loser;
    -- Store what the loser actually lost (rating never goes below 0) so a void can reverse it exactly.
    insert into ranked_matches (match_id, winner, loser, winner_delta, loser_delta, created_at, reporter)
    values (p_match_id, p_winner, p_loser, d, -least(d, le), now(), auth.uid());
  exception when unique_violation then
    select * into r from ranked_matches where match_id = p_match_id;
    return json_build_object('winner', r.winner, 'winner_delta', r.winner_delta, 'loser_delta', r.loser_delta);
  end;

  return json_build_object('winner', p_winner, 'winner_delta', d, 'loser_delta', -d);
end;
$$;

create or replace function public.record_match(
  p_match_id text, p_mode text, p_map text, p_ranked boolean, p_online boolean,
  p_result text, p_kills int, p_deaths int, p_headshots int, p_score text, p_elo_change int,
  p_details jsonb default null, p_assists int default 0
) returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  k int := least(greatest(p_kills, 0), 150);
  ast int := least(greatest(coalesce(p_assists, 0), 0), 150);
  dth int := least(greatest(p_deaths, 0), 150);
  hs int := least(greatest(p_headshots, 0), k);
  zmb boolean := p_mode = 'zombies';
  gained int;
  det jsonb := case when p_details is not null and pg_column_size(p_details) <= 16000 then p_details end;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if is_banned(uid) then raise exception 'account banned'; end if;

  insert into match_history (user_id, match_id, mode, map, ranked, online, result, kills, assists, deaths, headshots, score, elo_change, details)
  values (uid, p_match_id, p_mode, p_map, p_ranked, p_online, p_result, k, ast, dth, hs, p_score, coalesce(p_elo_change, 0), det)
  on conflict (user_id, match_id) do nothing;
  if not found then return; end if;

  perform ensure_season(uid);
  gained := k * 10 + ast * 5 + case p_result when 'win' then 100 when 'draw' then 50 else 25 end;
  -- Admin XP events: {"multiplier": 2, "from": "<timestamp>", "until": "<timestamp>"} in app_settings.xp_boost.
  -- "from" is optional (scheduled events); without it the event runs until "until".
  gained := round(gained * coalesce((select least(greatest((value ->> 'multiplier')::numeric, 1), 3) from app_settings
    where key = 'xp_boost' and (value ->> 'until')::timestamptz > now()
      and coalesce((value ->> 'from')::timestamptz, '-infinity') <= now()), 1))::int;

  if p_online then
    update profiles set
      matches = matches + 1,
      wins = wins + (p_result = 'win')::int,
      losses = losses + (p_result = 'loss')::int,
      kills = kills + case when zmb then 0 else k end, assists = assists + ast,
      deaths = deaths + case when zmb then 0 else dth end, headshots = headshots + case when zmb then 0 else hs end,
      zombie_kills = zombie_kills + case when zmb then k else 0 end, zombie_deaths = zombie_deaths + case when zmb then dth else 0 end,
      zombie_headshots = zombie_headshots + case when zmb then hs else 0 end,
      xp = xp + gained, pass_xp = pass_xp + gained, last_seen = now()
    where id = uid;
  else
    update profiles set xp = xp + gained / 2, pass_xp = pass_xp + gained / 2, last_seen = now() where id = uid;
  end if;
end;
$$;

-- ───────────── admin functions (each one refuses anyone who isn't in public.admins) ─────────────
create or replace function public.admin_guard()
returns uuid language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not authorized'; end if;
  return auth.uid();
end;
$$;

create or replace function public.admin_log(p_action text, p_target text, p_details jsonb)
returns void language sql security definer set search_path = public as $$
  insert into admin_audit (admin_id, action, target, details) values (auth.uid(), p_action, p_target, p_details);
$$;

create or replace function public.admin_overview()
returns json language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  return json_build_object(
    'players', (select count(*) from profiles),
    'new_today', (select count(*) from profiles where created_at > now() - interval '1 day'),
    'active_today', (select count(*) from profiles where last_seen > now() - interval '1 day'),
    'matches_today', (select count(*) from match_history where created_at > now() - interval '1 day'),
    'open_reports', (select count(*) from reports where status = 'open'),
    'open_feedback', (select count(*) from feedback where status = 'open'),
    'open_flags', (select count(*) from cheat_flags where status = 'open'),
    'banned', (select count(*) from moderation where banned_until > now()),
    'muted', (select count(*) from moderation where muted_until > now()),
    'season', current_season(),
    'settings', (select coalesce(json_object_agg(key, value), '{}') from app_settings)
  );
end;
$$;

create or replace function public.admin_reports(p_status text default 'open', p_limit int default 100)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  return (select coalesce(json_agg(row_to_json(t)), '[]') from (
    select r.*, rp.username as reporter_name, tp.username as target_name,
      (select count(*) from reports x where x.target = r.target) as target_report_count
    from reports r join profiles rp on rp.id = r.reporter join profiles tp on tp.id = r.target
    where p_status = 'all' or r.status = p_status
    order by r.created_at desc limit least(p_limit, 500)) t);
end;
$$;

create or replace function public.admin_resolve_report(p_id bigint, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  if p_status not in ('open', 'actioned', 'dismissed') then raise exception 'invalid status'; end if;
  update reports set status = p_status, resolution = left(p_note, 500), resolved_by = auth.uid(),
    resolved_at = case when p_status = 'open' then null else now() end where id = p_id;
  perform admin_log('resolve_report', p_id::text, json_build_object('status', p_status, 'note', p_note)::jsonb);
end;
$$;

-- Full picture of one player for the admin panel.
create or replace function public.admin_player(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  return json_build_object(
    'profile', (select row_to_json(p) from profiles p where p.id = p_id),
    'moderation', (select row_to_json(m) from moderation m where m.user_id = p_id),
    'is_admin', exists (select 1 from admins where user_id = p_id),
    'warnings', (select coalesce(json_agg(w order by w.id desc), '[]') from warnings w where w.user_id = p_id),
    'reports_against', (select coalesce(json_agg(row_to_json(t)), '[]') from (select r.*, rp.username as reporter_name from reports r join profiles rp on rp.id = r.reporter where r.target = p_id order by r.created_at desc limit 50) t),
    'reports_filed', (select count(*) from reports where reporter = p_id),
    'commends', player_commends(p_id),
    'matches', (select coalesce(json_agg(row_to_json(t)), '[]') from (select id, match_id, mode, map, ranked, online, result, kills, deaths, headshots, score, elo_change, created_at from match_history where user_id = p_id order by created_at desc limit 30) t),
    'seasons', (select coalesce(json_agg(s), '[]') from season_history s where s.user_id = p_id),
    'devices', (select count(*) from player_devices where user_id = p_id),
    'shared_accounts', (select coalesce(json_agg(distinct jsonb_build_object('id', o.user_id, 'username', pr.username)), '[]')
      from player_devices d join player_devices o on o.device_id = d.device_id and o.user_id <> p_id
      join profiles pr on pr.id = o.user_id where d.user_id = p_id),
    'appeals', (select coalesce(json_agg(a order by a.id desc), '[]') from ban_appeals a where a.user_id = p_id),
    'ff_penalties', (select coalesce(json_agg(f order by f.id desc), '[]') from ff_penalties f where f.user_id = p_id)
  );
end;
$$;

-- Admins can't be banned, muted or kicked, so the panel can't lock its own owner out.
create or replace function public.admin_target(p_user uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = p_user) then raise exception 'player not found'; end if;
  if exists (select 1 from admins where user_id = p_user) then raise exception 'admins cannot be moderated'; end if;
end;
$$;

-- p_appealable: the player may send one appeal. p_device: permanent, no appeal, and every device the
-- account has used is banned (devices an admin account also uses are skipped). The old three-argument
-- version is dropped so calls aren't ambiguous.
drop function if exists public.admin_ban(uuid, int, text);
create or replace function public.admin_ban(p_user uuid, p_minutes int, p_reason text, p_appealable boolean default true, p_device boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  until timestamptz := case when p_device or p_minutes is null or p_minutes <= 0 then 'infinity'::timestamptz else now() + make_interval(mins => p_minutes) end;
  appealable boolean := coalesce(p_appealable, true) and not coalesce(p_device, false);
begin
  perform admin_guard(); perform admin_target(p_user);
  insert into moderation (user_id, banned_until, banned_at, ban_reason, ban_appealable, device_ban, kick_at, kick_reason, updated_at)
  values (p_user, until, now(), left(p_reason, 300), appealable, coalesce(p_device, false), now(), 'Banned', now())
  on conflict (user_id) do update set banned_until = until, banned_at = now(), ban_reason = left(p_reason, 300),
    ban_appealable = appealable, device_ban = coalesce(p_device, false), kick_at = now(), kick_reason = 'Banned', updated_at = now();
  if p_device then
    insert into banned_devices (device_id, user_id, reason)
    select d.device_id, p_user, left(p_reason, 300) from player_devices d
    where d.user_id = p_user and not exists (select 1 from player_devices a join admins ad on ad.user_id = a.user_id where a.device_id = d.device_id)
    on conflict (device_id) do nothing;
  end if;
  perform admin_log('ban', p_user::text, json_build_object('minutes', p_minutes, 'reason', p_reason, 'appealable', appealable, 'device', coalesce(p_device, false))::jsonb);
end;
$$;

create or replace function public.admin_unban(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  update moderation set banned_until = null, ban_reason = null, banned_at = null, ban_appealable = true, device_ban = false, updated_at = now() where user_id = p_user;
  delete from banned_devices where user_id = p_user;
  perform admin_log('unban', p_user::text, null);
end;
$$;

create or replace function public.admin_mute(p_user uuid, p_minutes int, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare until timestamptz := case when p_minutes is null or p_minutes <= 0 then 'infinity'::timestamptz else now() + make_interval(mins => p_minutes) end;
begin
  perform admin_guard(); perform admin_target(p_user);
  insert into moderation (user_id, muted_until, mute_reason, updated_at) values (p_user, until, left(p_reason, 300), now())
  on conflict (user_id) do update set muted_until = until, mute_reason = left(p_reason, 300), updated_at = now();
  perform admin_log('mute', p_user::text, json_build_object('minutes', p_minutes, 'reason', p_reason)::jsonb);
end;
$$;

create or replace function public.admin_unmute(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  update moderation set muted_until = null, mute_reason = null, updated_at = now() where user_id = p_user;
  perform admin_log('unmute', p_user::text, null);
end;
$$;

create or replace function public.admin_kick(p_user uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard(); perform admin_target(p_user);
  insert into moderation (user_id, kick_at, kick_reason, updated_at) values (p_user, now(), left(p_reason, 300), now())
  on conflict (user_id) do update set kick_at = now(), kick_reason = left(p_reason, 300), updated_at = now();
  perform admin_log('kick', p_user::text, json_build_object('reason', p_reason)::jsonb);
end;
$$;

create or replace function public.admin_warn(p_user uuid, p_message text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard(); perform admin_target(p_user);
  if coalesce(trim(p_message), '') = '' then raise exception 'empty message'; end if;
  insert into warnings (user_id, message) values (p_user, left(p_message, 500));
  perform admin_log('warn', p_user::text, json_build_object('message', p_message)::jsonb);
end;
$$;

create or replace function public.admin_rename(p_user uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare old text;
begin
  perform admin_guard();
  if p_name !~ '^[A-Za-z0-9_]{3,16}$' then raise exception 'usernames are 3-16 letters, numbers or _'; end if;
  if exists (select 1 from profiles where lower(username) = lower(p_name) and id <> p_user) then raise exception 'that username is taken'; end if;
  select username into old from profiles where id = p_user;
  update profiles set username = p_name where id = p_user;
  perform admin_log('rename', p_user::text, json_build_object('from', old, 'to', p_name)::jsonb);
end;
$$;

-- Sets any of the listed stat columns from a JSON object, e.g. {"elo": 1200, "xp": 5000}.
create or replace function public.admin_set_stats(p_user uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare col text; allowed text[] := array['elo','peak_elo','ranked_wins','ranked_losses','wins','losses','matches','kills','deaths','headshots','zombie_kills','zombie_deaths','zombie_headshots','xp','pass_xp','season_wins','season_losses','season_peak'];
begin
  perform admin_guard();
  for col in select jsonb_object_keys(p_patch) loop
    if not col = any(allowed) then raise exception 'cannot set %', col; end if;
    execute format('update profiles set %I = greatest(0, $1) where id = $2', col) using (p_patch ->> col)::int, p_user;
  end loop;
  perform admin_log('set_stats', p_user::text, p_patch);
end;
$$;

create or replace function public.admin_reset_stats(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  update profiles set elo = 1000, peak_elo = 1000, ranked_wins = 0, ranked_losses = 0, wins = 0, losses = 0, matches = 0,
    kills = 0, deaths = 0, headshots = 0, zombie_kills = 0, zombie_deaths = 0, zombie_headshots = 0, xp = 0, pass_xp = 0, season_wins = 0, season_losses = 0, season_peak = 1000 where id = p_user;
  perform admin_log('reset_stats', p_user::text, null);
end;
$$;

create or replace function public.admin_grant_item(p_user uuid, p_kind text, p_item text, p_revoke boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  if p_kind not in ('finish', 'outfit', 'card', 'effect', 'emote') then raise exception 'invalid item kind'; end if;
  insert into item_grants (user_id, kind, item, revoke) values (p_user, p_kind, left(p_item, 40), coalesce(p_revoke, false));
  perform admin_log(case when p_revoke then 'revoke_item' else 'grant_item' end, p_user::text, json_build_object('kind', p_kind, 'item', p_item)::jsonb);
end;
$$;

-- Undoes a ranked result: reverses both players' rating change and win/loss counts. Season counts
-- only change if the match was played in the current season. The result stays recorded as voided so
-- it can't be reported again.
create or replace function public.admin_void_ranked(p_match_id text)
returns void language plpgsql security definer set search_path = public as $$
declare r ranked_matches%rowtype; this_season boolean;
begin
  perform admin_guard();
  select * into r from ranked_matches where match_id = p_match_id for update;
  if not found then raise exception 'no ranked result for that match'; end if;
  if r.voided then raise exception 'that result is already voided'; end if;
  this_season := r.created_at >= coalesce((select starts_at from seasons where id = current_season()), 'infinity');
  update profiles set elo = greatest(0, elo - r.winner_delta), ranked_wins = greatest(0, ranked_wins - 1),
    season_wins = case when this_season then greatest(0, season_wins - 1) else season_wins end where id = r.winner;
  update profiles set elo = elo - r.loser_delta, ranked_losses = greatest(0, ranked_losses - 1),
    season_losses = case when this_season then greatest(0, season_losses - 1) else season_losses end where id = r.loser;
  update ranked_matches set voided = true where match_id = p_match_id;
  update match_history set elo_change = 0, score = coalesce(score, '') || ' (voided)' where match_id = p_match_id and ranked;
  perform admin_log('void_ranked', p_match_id, row_to_json(r)::jsonb);
end;
$$;

-- Ban appeals, newest first, with the player's current ban.
create or replace function public.admin_appeals(p_status text default 'open')
returns json language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  return (select coalesce(json_agg(row_to_json(t)), '[]') from (
    select a.*, p.username, m.banned_until as current_until, m.device_ban
    from ban_appeals a join profiles p on p.id = a.user_id left join moderation m on m.user_id = a.user_id
    where p_status = 'all' or a.status = p_status
    order by a.id desc limit 200) t);
end;
$$;

-- Accepting an appeal lifts the ban (devices included); denying it keeps the ban. Either way the
-- player sees the note on their ban screen.
create or replace function public.admin_resolve_appeal(p_id bigint, p_accept boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
begin
  perform admin_guard();
  update ban_appeals set status = case when p_accept then 'accepted' else 'denied' end, admin_note = left(p_note, 500), resolved_at = now()
  where id = p_id and status = 'open' returning user_id into uid;
  if uid is null then raise exception 'That appeal was already handled.'; end if;
  if p_accept then
    update moderation set banned_until = null, ban_reason = null, banned_at = null, ban_appealable = true, device_ban = false, updated_at = now() where user_id = uid;
    delete from banned_devices where user_id = uid;
  end if;
  perform admin_log(case when p_accept then 'appeal_accepted' else 'appeal_denied' end, uid::text, json_build_object('appeal', p_id, 'note', p_note)::jsonb);
end;
$$;

-- Cheat flags, newest first, with how many flags (and open ones) and separate reporters each player
-- has. Ranked disputes include the result that counted, with both players' names.
drop function if exists public.admin_flags(int);
create or replace function public.admin_flags(p_status text default 'open', p_limit int default 200)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  return (select coalesce(json_agg(row_to_json(t)), '[]') from (
    select f.*, rp.username as reporter_name, tp.username as target_name,
      (select count(*) from cheat_flags x where x.target = f.target) as target_flags,
      (select count(*) from cheat_flags x where x.target = f.target and x.status = 'open') as target_open,
      (select count(distinct x.reporter) from cheat_flags x where x.target = f.target and x.reporter <> x.target) as target_reporters,
      case when f.kind = 'ranked_dispute' then (
        select json_build_object('winner', rm.winner, 'winner_name', wp.username, 'loser', rm.loser, 'loser_name', lp.username,
          'winner_delta', rm.winner_delta, 'loser_delta', rm.loser_delta, 'voided', rm.voided, 'created_at', rm.created_at)
        from ranked_matches rm left join profiles wp on wp.id = rm.winner left join profiles lp on lp.id = rm.loser
        where rm.match_id = f.match_id) end as ranked
    from cheat_flags f
    left join profiles rp on rp.id = f.reporter
    left join profiles tp on tp.id = f.target
    where p_status = 'all' or f.status = p_status
    order by f.id desc limit least(p_limit, 500)) t);
end;
$$;

-- Closes a flag ('resolved' = acted on, 'dismissed' = nothing wrong) or reopens it ('open').
-- p_all: every open flag against the same player instead. Returns how many changed.
create or replace function public.admin_resolve_flag(p_id bigint, p_status text, p_note text, p_all boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare t uuid; n int;
begin
  perform admin_guard();
  if p_status not in ('open', 'resolved', 'dismissed') then raise exception 'invalid status'; end if;
  select target into t from cheat_flags where id = p_id;
  if not found then raise exception 'flag not found'; end if;
  update cheat_flags set status = p_status, resolution = case when p_status = 'open' then null else left(p_note, 500) end,
    resolved_at = case when p_status = 'open' then null else now() end
  where (id = p_id) or (coalesce(p_all, false) and target = t and status = 'open');
  get diagnostics n = row_count;
  perform admin_log('resolve_flag', p_id::text, json_build_object('status', p_status, 'note', p_note, 'all', coalesce(p_all, false), 'count', n)::jsonb);
  return n;
end;
$$;

-- A message to a player that isn't a warning (no "repeated problems" line). Admins can receive these.
create or replace function public.admin_notify(p_user uuid, p_message text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  if coalesce(trim(p_message), '') = '' then raise exception 'empty message'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'player not found'; end if;
  insert into warnings (user_id, message, kind) values (p_user, left(p_message, 500), 'notice');
  perform admin_log('notify', p_user::text, json_build_object('message', p_message)::jsonb);
end;
$$;

-- Settles a disputed ranked result from its flag. p_void: void the result (both players get their
-- rating and win/loss back; see admin_void_ranked) or keep it as it counted. p_message, if given, is
-- sent to both players as a notice. Every open dispute flag for that match is closed.
create or replace function public.admin_settle_dispute(p_id bigint, p_void boolean, p_message text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare f cheat_flags%rowtype; r ranked_matches%rowtype;
begin
  perform admin_guard();
  select * into f from cheat_flags where id = p_id;
  if not found or f.kind <> 'ranked_dispute' then raise exception 'not a ranked dispute'; end if;
  select * into r from ranked_matches where match_id = f.match_id;
  if not found then raise exception 'no ranked result for that match'; end if;
  if p_void and not r.voided then perform admin_void_ranked(f.match_id); end if;
  if coalesce(trim(p_message), '') <> '' then
    insert into warnings (user_id, message, kind) values (r.winner, left(p_message, 500), 'notice'), (r.loser, left(p_message, 500), 'notice');
  end if;
  update cheat_flags set status = case when p_void then 'resolved' else 'dismissed' end,
    resolution = left(coalesce(nullif(trim(p_note), ''), case when p_void then 'Result voided' else 'Result kept' end), 500), resolved_at = now()
  where match_id = f.match_id and kind = 'ranked_dispute' and status = 'open';
  perform admin_log(case when p_void then 'void_dispute' else 'keep_dispute' end, f.match_id,
    json_build_object('flag', p_id, 'message', p_message, 'winner', r.winner, 'loser', r.loser)::jsonb);
end;
$$;

-- Players whose online results over the last p_days are far outside normal: at least 100 kills and
-- 70%+ of them headshots, or 6+ kills per death. Read from match_history (Zombies matches left out,
-- since horde kills aren't PvP); nothing is flagged.
create or replace function public.admin_stat_outliers(p_days int default 30)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  return (select coalesce(json_agg(row_to_json(t)), '[]') from (
    select h.user_id, p.username, count(*) as matches, sum(h.kills) as kills, sum(h.deaths) as deaths, sum(h.headshots) as headshots,
      round(sum(h.headshots)::numeric / nullif(sum(h.kills), 0), 2) as hs_rate,
      round(sum(h.kills)::numeric / greatest(sum(h.deaths), 1), 2) as kd,
      (m.banned_until > now()) as banned
    from match_history h join profiles p on p.id = h.user_id left join moderation m on m.user_id = h.user_id
    where h.online and h.mode <> 'zombies' and h.created_at > now() - make_interval(days => greatest(1, least(p_days, 365)))
    group by h.user_id, p.username, m.banned_until
    having sum(h.kills) >= 100 and (sum(h.headshots)::numeric / sum(h.kills) >= 0.7 or sum(h.kills)::numeric / greatest(sum(h.deaths), 1) >= 6)
    order by sum(h.headshots)::numeric / sum(h.kills) desc limit 50) t);
end;
$$;

create or replace function public.admin_moderated(p_limit int default 200)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  return (select coalesce(json_agg(row_to_json(t)), '[]') from (
    select m.*, p.username from moderation m join profiles p on p.id = m.user_id
    where m.banned_until > now() or m.muted_until > now() order by m.updated_at desc limit least(p_limit, 500)) t);
end;
$$;

-- p_starts schedules it for later (null = now). The old three-argument version is dropped so calls aren't ambiguous.
drop function if exists public.admin_announce(text, numeric, text);
create or replace function public.admin_announce(p_message text, p_hours numeric, p_kind text default 'info', p_starts timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  starts timestamptz := greatest(coalesce(p_starts, now()), now());
begin
  perform admin_guard();
  insert into announcements (message, kind, starts_at, ends_at, created_by)
  values (left(p_message, 300), p_kind, starts, starts + make_interval(secs => (greatest(0.1, p_hours) * 3600)::double precision), auth.uid());
  perform admin_log('announce', null, json_build_object('message', p_message, 'hours', p_hours, 'kind', p_kind, 'starts', starts)::jsonb);
end;
$$;

create or replace function public.admin_end_announcement(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  update announcements set ends_at = now() where id = p_id;
  perform admin_log('end_announcement', p_id::text, null);
end;
$$;

create or replace function public.admin_announcements()
returns json language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  return (select coalesce(json_agg(a order by a.id desc), '[]') from (select * from announcements order by id desc limit 50) a);
end;
$$;

-- ───────────── polls ─────────────
-- Vote counts per option for a poll, as a JSON array the same length as its options.
create or replace function public.poll_counts(p_id bigint)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(coalesce(v.n, 0) order by i.i), '[]')
  from polls p cross join lateral generate_series(0, jsonb_array_length(p.options) - 1) as i(i)
  left join (select choice, count(*) n from poll_votes where poll_id = p_id group by choice) v on v.choice = i.i
  where p.id = p_id;
$$;

-- Live polls, plus ones that ended in the last 3 days (with their results). Counts are only included
-- once you've voted or the poll has ended, so early results don't sway anyone.
create or replace function public.polls_list()
returns json language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); made timestamptz;
begin
  select created_at into made from profiles where id = uid;
  return (select coalesce(json_agg(r order by r.live desc, r.ends_at), '[]') from (
    select p.id, p.question, p.options, p.eligibility, p.cutoff, p.starts_at, p.ends_at, now() < p.ends_at as live,
      v.choice as my_vote,
      (made is not null and (p.cutoff is null or made < p.cutoff)) as eligible,
      case when v.choice is not null or now() >= p.ends_at then poll_counts(p.id) end as counts
    from polls p left join poll_votes v on v.poll_id = p.id and v.user_id = uid
    where p.starts_at <= now() and p.ends_at > now() - interval '3 days'
    order by p.id desc limit 10) r);
end;
$$;

create or replace function public.poll_vote(p_poll bigint, p_choice int)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); p polls%rowtype; made timestamptz;
begin
  if uid is null then raise exception 'Sign in to vote'; end if;
  if is_banned(uid) then raise exception 'Banned accounts can''t vote'; end if;
  select * into p from polls where id = p_poll;
  if not found or now() < p.starts_at then raise exception 'That poll doesn''t exist'; end if;
  if now() >= p.ends_at then raise exception 'This poll has closed'; end if;
  if p_choice is null or p_choice < 0 or p_choice >= jsonb_array_length(p.options) then raise exception 'Pick one of the options'; end if;
  select created_at into made from profiles where id = uid;
  if p.cutoff is not null and made >= p.cutoff then
    raise exception 'Only accounts made before % can vote in this poll', to_char(p.cutoff at time zone 'UTC', 'Mon DD, YYYY HH24:MI "UTC"');
  end if;
  insert into poll_votes (poll_id, user_id, choice) values (p_poll, uid, p_choice) on conflict do nothing;
  if not found then raise exception 'You''ve already voted in this poll'; end if;
  return poll_counts(p_poll);
end;
$$;

-- p_eligibility: 'anyone' (any account), 'before_start' (accounts made before the poll starts) or
-- 'before_date' (accounts made before p_cutoff). p_starts schedules it for later (null = now).
create or replace function public.admin_create_poll(p_question text, p_options text[], p_hours numeric, p_eligibility text default 'anyone',
  p_cutoff timestamptz default null, p_starts timestamptz default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  starts timestamptz := greatest(coalesce(p_starts, now()), now());
  opts jsonb;
  cut timestamptz;
  new_id bigint;
begin
  perform admin_guard();
  select coalesce(jsonb_agg(left(btrim(o), 80) order by n), '[]') into opts from unnest(p_options) with ordinality as t(o, n) where btrim(coalesce(o, '')) <> '';
  if jsonb_array_length(opts) not between 2 and 10 then raise exception 'A poll needs 2 to 10 options'; end if;
  if btrim(coalesce(p_question, '')) = '' then raise exception 'Write a question'; end if;
  cut := case p_eligibility when 'anyone' then null when 'before_start' then starts when 'before_date' then p_cutoff end;
  if p_eligibility = 'before_date' and cut is null then raise exception 'Pick the date accounts must be made before'; end if;
  if p_eligibility not in ('anyone', 'before_start', 'before_date') then raise exception 'unknown eligibility'; end if;
  insert into polls (question, options, eligibility, cutoff, starts_at, ends_at, created_by)
  values (left(btrim(p_question), 200), opts, p_eligibility, cut, starts,
    starts + make_interval(secs => (greatest(0.1, p_hours) * 3600)::double precision), auth.uid())
  returning id into new_id;
  perform admin_log('create_poll', new_id::text, json_build_object('question', p_question, 'options', opts, 'hours', p_hours,
    'eligibility', p_eligibility, 'cutoff', cut, 'starts', starts)::jsonb);
  return new_id;
end;
$$;

-- Ends a live poll now (its results stay), or cancels a scheduled one.
create or replace function public.admin_end_poll(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  if exists (select 1 from polls where id = p_id and starts_at > now()) then
    delete from polls where id = p_id;
    perform admin_log('cancel_poll', p_id::text, null);
    return;
  end if;
  update polls set ends_at = now() where id = p_id and ends_at > now();
  perform admin_log('end_poll', p_id::text, null);
end;
$$;

create or replace function public.admin_delete_poll(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  perform admin_log('delete_poll', p_id::text, (select json_build_object('question', question, 'counts', poll_counts(id)) from polls where id = p_id)::jsonb);
  delete from polls where id = p_id;
end;
$$;

create or replace function public.admin_polls()
returns json language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  return (select coalesce(json_agg(r order by r.id desc), '[]') from (
    select p.*, poll_counts(p.id) as counts from polls p order by p.id desc limit 50) r);
end;
$$;

create or replace function public.admin_set_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  if p_key not in ('maintenance', 'motd', 'xp_boost') then raise exception 'unknown setting'; end if;
  insert into app_settings (key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform admin_log('set_setting', p_key, p_value);
end;
$$;

create or replace function public.admin_audit_log(p_limit int default 100)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  return (select coalesce(json_agg(row_to_json(t)), '[]') from (
    select a.*, p.username as target_name from admin_audit a left join profiles p on p.id::text = a.target
    order by a.id desc limit least(p_limit, 500)) t);
end;
$$;

-- Puts a map in a featured slot (1-2 small, 3-4 large), replacing whatever was there, or takes it
-- out (p_slot null).
create or replace function public.admin_feature_map(p_id bigint, p_slot int)
returns void language plpgsql security definer set search_path = public as $$
declare sz text;
begin
  perform admin_guard();
  select size into sz from custom_maps where id = p_id;
  if not found then raise exception 'map not found'; end if;
  if p_slot is not null then
    if p_slot not between 1 and 4 then raise exception 'slots are 1-4'; end if;
    if (p_slot <= 2) <> (sz = 'small') then raise exception 'slots 1-2 are for small maps, 3-4 for large maps'; end if;
    update custom_maps set featured_slot = null where featured_slot = p_slot and id <> p_id;
  end if;
  update custom_maps set featured_slot = p_slot where id = p_id;
  perform admin_log(case when p_slot is null then 'unfeature_map' else 'feature_map' end, p_id::text, json_build_object('slot', p_slot)::jsonb);
end;
$$;

create or replace function public.admin_delete_map(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare m custom_maps%rowtype;
begin
  perform admin_guard();
  delete from custom_maps where id = p_id returning * into m;
  perform admin_log('delete_map', p_id::text, json_build_object('name', m.name, 'owner', m.owner)::jsonb);
end;
$$;

create or replace function public.admin_feedback(p_status text default 'open', p_limit int default 100)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  return (select coalesce(json_agg(row_to_json(t)), '[]') from (
    select f.*, p.username from feedback f join profiles p on p.id = f.user_id
    where p_status = 'all' or f.status = p_status order by f.created_at desc limit least(p_limit, 500)) t);
end;
$$;

create or replace function public.admin_resolve_feedback(p_id bigint, p_status text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform admin_guard();
  if p_status not in ('open', 'resolved') then raise exception 'invalid status'; end if;
  update feedback set status = p_status, admin_note = left(p_note, 500), resolved_at = case when p_status = 'resolved' then now() end where id = p_id;
  perform admin_log('resolve_feedback', p_id::text, json_build_object('status', p_status, 'note', p_note)::jsonb);
end;
$$;

-- Clans (4.3.0): a name and a 2-4 character tag, up to 20 members, joined with an invite code. One
-- clan per player. Everything goes through the functions below; nobody writes the tables directly.
create table if not exists public.clans (
  id         bigint generated always as identity primary key,
  name       text not null check (char_length(name) between 3 and 24),
  tag        text not null check (tag ~ '^[A-Z0-9]{2,4}$'),
  owner      uuid not null references public.profiles(id) on delete cascade,
  code       text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists clans_name_key on public.clans (lower(name));
create unique index if not exists clans_tag_key on public.clans (tag);
create unique index if not exists clans_code_key on public.clans (code);

create table if not exists public.clan_members (
  user_id   uuid primary key references public.profiles(id) on delete cascade,
  clan_id   bigint not null references public.clans(id) on delete cascade,
  joined_at timestamptz not null default now()
);
create index if not exists clan_members_clan_idx on public.clan_members (clan_id);

alter table public.clans enable row level security;
alter table public.clan_members enable row level security;
revoke all on public.clans from anon, authenticated;
revoke all on public.clan_members from anon, authenticated;

-- A fresh 6-character invite code (no 0/O or 1/I).
create or replace function public.clan_code()
returns text language plpgsql volatile set search_path = public as $$
declare c text;
begin
  loop
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '') into c from generate_series(1, 6);
    exit when not exists (select 1 from clans where code = c);
  end loop;
  return c;
end;
$$;

-- The caller's clan with its members (and the invite code, which only members see), or null.
create or replace function public.my_clan()
returns json language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); cid bigint;
begin
  select clan_id into cid from clan_members where user_id = uid;
  if cid is null then return null; end if;
  return (select json_build_object('id', c.id, 'name', c.name, 'tag', c.tag, 'owner', c.owner, 'code', c.code, 'created_at', c.created_at,
    'members', (select coalesce(json_agg(json_build_object('id', p.id, 'username', p.username, 'elo', p.elo, 'wins', p.wins, 'matches', p.matches, 'joined_at', m.joined_at) order by (p.id = c.owner) desc, m.joined_at), '[]')
      from clan_members m join profiles p on p.id = m.user_id where m.clan_id = c.id))
    from clans c where c.id = cid);
end;
$$;

-- A clan's public page: name, tag and members (no invite code).
create or replace function public.clan_info(p_id bigint)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('id', c.id, 'name', c.name, 'tag', c.tag, 'owner', c.owner, 'created_at', c.created_at,
    'members', (select coalesce(json_agg(json_build_object('id', p.id, 'username', p.username, 'elo', p.elo, 'wins', p.wins) order by (p.id = c.owner) desc, m.joined_at), '[]')
      from clan_members m join profiles p on p.id = m.user_id
      where m.clan_id = c.id and not exists (select 1 from moderation x where x.user_id = p.id and x.banned_until > now())))
  from clans c where c.id = p_id;
$$;

create or replace function public.clan_create(p_name text, p_tag text)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')); t text := upper(btrim(coalesce(p_tag, ''))); cid bigint;
begin
  if uid is null then raise exception 'Sign in to create a clan'; end if;
  if is_banned(uid) then raise exception 'Banned players can''t create clans'; end if;
  if exists (select 1 from clan_members where user_id = uid) then raise exception 'Leave your clan first'; end if;
  if n !~ '^[A-Za-z0-9 _.-]{3,24}$' then raise exception 'Clan names are 3 to 24 letters, numbers, spaces, dots, dashes or underscores'; end if;
  if t !~ '^[A-Z0-9]{2,4}$' then raise exception 'Clan tags are 2 to 4 letters or numbers'; end if;
  if exists (select 1 from clans where lower(name) = lower(n)) then raise exception 'That clan name is taken'; end if;
  if exists (select 1 from clans where tag = t) then raise exception 'That clan tag is taken'; end if;
  insert into clans (name, tag, owner, code) values (n, t, uid, clan_code()) returning id into cid;
  insert into clan_members (user_id, clan_id) values (uid, cid);
  return my_clan();
end;
$$;

create or replace function public.clan_join(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cid bigint;
begin
  if uid is null then raise exception 'Sign in to join a clan'; end if;
  if exists (select 1 from clan_members where user_id = uid) then raise exception 'Leave your clan first'; end if;
  select id into cid from clans where code = upper(btrim(coalesce(p_code, '')));
  if cid is null then raise exception 'No clan has that invite code'; end if;
  if (select count(*) from clan_members where clan_id = cid) >= 20 then raise exception 'That clan is full (20 members)'; end if;
  insert into clan_members (user_id, clan_id) values (uid, cid);
  return my_clan();
end;
$$;

-- Leaving: the leader hands over to the longest-standing member, and the last one out disbands it.
create or replace function public.clan_leave()
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cid bigint; nxt uuid;
begin
  select clan_id into cid from clan_members where user_id = uid;
  if cid is null then return; end if;
  delete from clan_members where user_id = uid;
  select user_id into nxt from clan_members where clan_id = cid order by joined_at limit 1;
  if nxt is null then delete from clans where id = cid;
  elsif (select owner from clans where id = cid) = uid then update clans set owner = nxt where id = cid;
  end if;
end;
$$;

-- Leader only: remove a member, hand over leadership, or replace the invite code.
create or replace function public.clan_kick(p_user uuid)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cid bigint;
begin
  select id into cid from clans where owner = uid;
  if cid is null then raise exception 'Only the clan leader can do that'; end if;
  if p_user = uid then raise exception 'Leave the clan instead'; end if;
  delete from clan_members where user_id = p_user and clan_id = cid;
  return my_clan();
end;
$$;

create or replace function public.clan_promote(p_user uuid)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cid bigint;
begin
  select id into cid from clans where owner = uid;
  if cid is null then raise exception 'Only the clan leader can do that'; end if;
  if not exists (select 1 from clan_members where user_id = p_user and clan_id = cid) then raise exception 'They aren''t in your clan'; end if;
  update clans set owner = p_user where id = cid;
  return my_clan();
end;
$$;

create or replace function public.clan_new_code()
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cid bigint;
begin
  select id into cid from clans where owner = uid;
  if cid is null then raise exception 'Only the clan leader can do that'; end if;
  update clans set code = clan_code() where id = cid;
  return my_clan();
end;
$$;

-- Clan leaderboard: total wins and average rating of members who aren't banned.
create or replace function public.clan_leaderboard(p_limit int default 50)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(t order by t.pos), '[]') from (
    select row_number() over (order by sum(p.wins) desc, avg(p.elo) desc) as pos,
      c.id, c.name, c.tag, count(*) as members, sum(p.wins)::int as wins, round(avg(p.elo))::int as elo, sum(p.kills)::int as kills
    from clans c join clan_members m on m.clan_id = c.id join profiles p on p.id = m.user_id
    where not exists (select 1 from moderation x where x.user_id = p.id and x.banned_until > now())
    group by c.id
    order by sum(p.wins) desc, avg(p.elo) desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ) t;
$$;

-- Admin: disband a clan (an offensive name or tag).
create or replace function public.admin_delete_clan(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare c clans%rowtype;
begin
  perform admin_guard();
  select * into c from clans where id = p_id;
  if c.id is null then return; end if;
  delete from clans where id = p_id;
  perform admin_log('delete_clan', p_id::text, json_build_object('name', c.name, 'tag', c.tag)::jsonb);
end;
$$;

-- Leaderboards (4.2.2, now with each player's clan tag). Players with an active ban are left out.
create or replace function public.leaderboard(p_kind text default 'elo', p_limit int default 100)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(t order by t.pos), '[]') from (
    select row_number() over (order by case p_kind when 'kills' then p.kills when 'wins' then p.wins when 'xp' then p.xp else p.elo end desc) as pos,
      p.id, p.username, p.elo, p.peak_elo, p.ranked_wins, p.ranked_losses, p.wins, p.losses, p.matches, p.kills, p.deaths, p.headshots, p.zombie_kills, p.zombie_deaths, p.xp,
      (select c.tag from clan_members cm join clans c on c.id = cm.clan_id where cm.user_id = p.id) as clan
    from profiles p
    where not exists (select 1 from moderation m where m.user_id = p.id and m.banned_until > now())
    order by case p_kind when 'kills' then p.kills when 'wins' then p.wins when 'xp' then p.xp else p.elo end desc
    limit least(greatest(coalesce(p_limit, 100), 1), 200)
  ) t;
$$;

create or replace function public.season_leaderboard(p_season text, p_limit int default 100)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(t order by t.pos), '[]') from (
    select row_number() over (order by p.elo desc) as pos,
      p.id, p.username, p.elo, p.season_peak, p.season_wins, p.season_losses, p.pass_xp,
      (select c.tag from clan_members cm join clans c on c.id = cm.clan_id where cm.user_id = p.id) as clan
    from profiles p
    where p.season_id = p_season
      and not exists (select 1 from moderation m where m.user_id = p.id and m.banned_until > now())
    order by p.elo desc
    limit least(greatest(coalesce(p_limit, 100), 1), 200)
  ) t;
$$;

-- ───────────── function permissions ─────────────
-- Internal helpers are not callable from the app at all.
revoke all on function public.ensure_season(uuid) from public, anon, authenticated;
revoke all on function public.admin_guard() from public, anon, authenticated;
revoke all on function public.admin_log(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.admin_target(uuid) from public, anon, authenticated;
revoke all on function public.is_banned(uuid) from public, anon, authenticated;
revoke all on function public.poll_counts(bigint) from public, anon, authenticated;
-- The sign-up trigger only ever runs as a trigger, never through the API.
revoke all on function public.handle_new_user() from public, anon, authenticated;

revoke all on function public.current_season() from public;
grant execute on function public.current_season() to anon, authenticated;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
revoke all on function public.moderation_flags(uuid[]) from public, anon;
grant execute on function public.moderation_flags(uuid[]) to authenticated;
revoke all on function public.player_commends(uuid) from public;
grant execute on function public.player_commends(uuid) to anon, authenticated;
revoke all on function public.leaderboard(text, int) from public;
grant execute on function public.leaderboard(text, int) to anon, authenticated;
revoke all on function public.season_leaderboard(text, int) from public;
grant execute on function public.season_leaderboard(text, int) to anon, authenticated;
revoke all on function public.clan_code() from public, anon, authenticated;
revoke all on function public.clan_info(bigint) from public;
grant execute on function public.clan_info(bigint) to anon, authenticated;
revoke all on function public.clan_leaderboard(int) from public;
grant execute on function public.clan_leaderboard(int) to anon, authenticated;
revoke all on function public.polls_list() from public;
grant execute on function public.polls_list() to anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['my_clan()', 'clan_create(text, text)', 'clan_join(text)', 'clan_leave()', 'clan_kick(uuid)', 'clan_promote(uuid)', 'clan_new_code()', 'admin_delete_clan(bigint)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'my_status()', 'ack_status(bigint[], bigint[])', 'commend_player(uuid, text, text)',
    'report_player(uuid, text, text, text, text, jsonb)', 'claim_challenge(text)',
    'friend_request(uuid)', 'friend_respond(uuid, boolean)', 'friend_remove(uuid)', 'my_friends()',
    'save_custom_map(bigint, text, text, text, jsonb)', 'delete_custom_map(bigint)', 'like_custom_map(bigint, boolean)', 'my_map_likes()',
    'admin_feature_map(bigint, int)', 'admin_delete_map(bigint)',
    'submit_feedback(text, text, jsonb)', 'admin_feedback(text, int)', 'admin_resolve_feedback(bigint, text, text)',
    'admin_overview()', 'admin_reports(text, int)', 'admin_resolve_report(bigint, text, text)', 'admin_player(uuid)',
    'admin_ban(uuid, int, text, boolean, boolean)', 'admin_unban(uuid)', 'admin_appeals(text)', 'admin_resolve_appeal(bigint, boolean, text)', 'admin_mute(uuid, int, text)', 'admin_unmute(uuid)',
    'admin_kick(uuid, text)', 'admin_warn(uuid, text)', 'admin_rename(uuid, text)', 'admin_set_stats(uuid, jsonb)',
    'admin_reset_stats(uuid)', 'admin_grant_item(uuid, text, text, boolean)', 'admin_void_ranked(text)',
    'admin_moderated(int)', 'admin_announce(text, numeric, text, timestamptz)', 'admin_end_announcement(bigint)',
    'admin_announcements()', 'admin_set_setting(text, jsonb)', 'admin_audit_log(int)', 'admin_flags(text, int)',
    'admin_resolve_flag(bigint, text, text, boolean)', 'admin_notify(uuid, text)', 'admin_settle_dispute(bigint, boolean, text, text)',
    'admin_stat_outliers(int)', 'poll_vote(bigint, int)', 'admin_create_poll(text, text[], numeric, text, timestamptz, timestamptz)',
    'admin_end_poll(bigint)', 'admin_delete_poll(bigint)', 'admin_polls()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

revoke all on function public.report_ranked(text, uuid, uuid) from public, anon;
revoke all on function public.record_match(text, text, text, boolean, boolean, text, int, int, int, text, int, jsonb, int) from public, anon;
grant execute on function public.report_ranked(text, uuid, uuid) to authenticated;
grant execute on function public.record_match(text, text, text, boolean, boolean, text, int, int, int, text, int, jsonb, int) to authenticated;
