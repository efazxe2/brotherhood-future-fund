-- ============================================
-- Brotherhood Future Fund — Supabase schema
-- Run this once in Supabase: SQL Editor → New query → Run
-- ============================================

create table members (
  id serial primary key,
  name text not null,
  shares integer not null check (shares > 0),
  created_at timestamptz default now()
);

create table payments (
  id serial primary key,
  member_id integer not null references members(id) on delete cascade,
  month_key text not null,
  amount numeric not null default 0,
  updated_at timestamptz default now(),
  unique (member_id, month_key)
);

create table late_fees (
  member_id integer primary key references members(id) on delete cascade,
  amount numeric not null default 0,
  updated_at timestamptz default now()
);

-- ============================================
-- Seed data — 18 members from the original spreadsheet
-- Skip this block if you already ran it once before.
-- ============================================

insert into members (id, name, shares) values
  (1, 'Shanjit', 4),
  (2, 'Efaz', 2),
  (3, 'Morshed', 1),
  (4, 'Shojol', 1),
  (5, 'Ashik', 1),
  (6, 'Shaikot', 2),
  (7, 'Farhan', 2),
  (8, 'Bijoy', 1),
  (9, 'Pranto', 2),
  (10, 'Antor', 1),
  (11, 'Rocky', 1),
  (12, 'Parbej', 3),
  (13, 'Shahadat', 2),
  (14, 'Rajib', 2),
  (15, 'Anwar', 4),
  (16, 'Sabur', 1),
  (17, 'Piash', 1),
  (18, 'Sohel', 1);

select setval('members_id_seq', (select max(id) from members));

insert into payments (member_id, month_key, amount) values
  (2, '2026-09', 2000);

-- ============================================
-- Row Level Security — open read/write via the anon key.
-- The app's admin PIN is the only edit gate; anyone with the
-- anon key (visible in the deployed frontend) can technically
-- write directly. Fine for a small trusted-group fund tracker;
-- tighten later with Supabase Auth if you ever need real
-- per-user access control.
-- ============================================

alter table members enable row level security;
alter table payments enable row level security;
alter table late_fees enable row level security;

create policy "public read members" on members for select using (true);
create policy "public write members" on members for all using (true) with check (true);

create policy "public read payments" on payments for select using (true);
create policy "public write payments" on payments for all using (true) with check (true);

create policy "public read late_fees" on late_fees for select using (true);
create policy "public write late_fees" on late_fees for all using (true) with check (true);

-- ============================================
-- Enable realtime so every client gets pushed changes instantly
-- ============================================

alter publication supabase_realtime add table members;
alter publication supabase_realtime add table payments;
alter publication supabase_realtime add table late_fees;
