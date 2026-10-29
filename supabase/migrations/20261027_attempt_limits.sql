-- Attempt limits for sign-ins and for emails anyone can trigger (lib/attempt-limit.ts).
-- Shared database; only the new site writes it. Counted per account name or
-- email, never per IP. key_hash is SHA-256 of "<kind>:<lowercased name>", so
-- no usernames or emails are stored. Rows older than a day are deleted as new
-- ones come in.

create table if not exists auth_attempts (
  id bigint generated always as identity primary key,
  kind text not null,
  key_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists auth_attempts_key_idx on auth_attempts (kind, key_hash, created_at);
create index if not exists auth_attempts_created_idx on auth_attempts (created_at);
-- Service role only (no policies)
alter table auth_attempts enable row level security;
