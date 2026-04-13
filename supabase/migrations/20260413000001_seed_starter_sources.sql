-- Slice 3: seed starter_sources with the RotoWire projected source.
-- Required before any RotoWire ingest can run.
-- The ingestRotowireProjectedStarters service asserts this row is present.
-- Idempotent: on conflict(source_key) do nothing.

insert into public.starter_sources (source_key, source_name, source_type, is_active)
values ('rotowire', 'RotoWire Daily Lineups', 'projected', true)
on conflict (source_key) do nothing;
