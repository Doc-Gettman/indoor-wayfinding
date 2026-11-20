-- Usage tracking: one row per successfully completed wayfind (directions) request.
-- Run once in the Supabase SQL editor (safe to re-run).
--
-- Append-only on purpose: unlike the building_collections JSON blobs, every
-- visitor request inserts its own row, so concurrent requests never race and
-- reports can filter by date range in the database.
--
-- qr_label / destination_name are snapshots taken at request time so reports
-- still read correctly after a QR code or destination is renamed or deleted.

create table if not exists direction_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  building_id text not null,
  origin_node_id text not null,
  qr_code_id text,
  qr_label text,
  destination_poi_id text not null,
  destination_name text,
  avoid_stairs boolean,
  generated_by text
);

create index if not exists direction_requests_building_created_idx
  on direction_requests (building_id, created_at);

-- The server uses the service-role key (bypasses RLS). Enabling RLS with no
-- policies keeps the table closed to the public anon key.
alter table direction_requests enable row level security;
