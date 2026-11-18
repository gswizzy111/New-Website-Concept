-- Card catalog: every English and Japanese Pokémon card with a link to its
-- picture, so staff can pick the exact card when they enter one in the admin
-- (the card picker in the manual order form, Add Card and Edit Card).
-- Admin only: nothing customer-facing reads it. Additive and safe to run more
-- than once. Apply before the code that uses it.
--
-- 1. card_catalog          one row per card, filled by lib/card-catalog-sync.ts
--                          from TCGdex (api.tcgdex.net). Pictures stay on the
--                          source CDNs (assets.tcgdex.net, images.pokemontcg.io):
--                          only links are stored.
-- 2. card_catalog_sync     one row per language and set: when it was last
--                          synced, its card and picture counts, the last error.
--                          set_id '_list' records when the language's set list
--                          was last read. The admin Card Catalog page reads
--                          only this table.
-- 3. search_card_catalog() the picker's search (GET /api/admin/card-catalog/search).
-- 4. cards.catalog_card_id and cards.catalog_image_url: the catalog card staff
--    picked for an order's card and its picture (shown on the admin order page
--    as "Reference photo"). The old site never reads them.
-- Only the server (service role) reads or writes any of it.

-- pg_trgm is already in public on the live database; elsewhere it goes to extensions
create extension if not exists pg_trgm with schema extensions;

-- ── Cards ────────────────────────────────────────────────────────────────────
create table if not exists public.card_catalog (
  id text primary key check (char_length(id) <= 120),       -- 'tcgdex:en:swsh3-136'
  source text not null default 'tcgdex',
  lang text not null check (lang in ('en', 'ja')),
  set_id text not null,
  set_name text not null,
  series text,
  release_date date,
  number text not null,                                      -- as printed: '4', '215', 'TG01', '001'
  printed_total text,                                        -- the set's printed count: '102' (numbered cards only)
  name text not null,
  name_en text,                                              -- English species name, Japanese cards only
  rarity text,
  image_small text check (image_small is null or image_small ~ '^https://'),
  image_large text check (image_large is null or image_large ~ '^https://'),
  -- Lower case, no accents or apostrophes (normalizeCatalogText in lib/card-catalog.ts):
  -- names, set, series, number in every form, year and set id
  search text not null,
  updated_at timestamptz not null default now()
);
create index if not exists card_catalog_search_trgm_idx on public.card_catalog using gin (search gin_trgm_ops);
create index if not exists card_catalog_set_number_idx on public.card_catalog (set_id, number);
create index if not exists card_catalog_release_date_idx on public.card_catalog (release_date);
alter table public.card_catalog enable row level security;
revoke all on table public.card_catalog from anon, authenticated;

-- ── Sync progress ────────────────────────────────────────────────────────────
create table if not exists public.card_catalog_sync (
  lang text not null check (lang in ('en', 'ja')),
  set_id text not null,
  source text not null default 'tcgdex',
  set_name text,
  series text,
  release_date date,
  source_total integer,                                      -- cards the source lists for the set
  cards integer not null default 0,                          -- cards saved
  images integer not null default 0,                         -- of them with a picture
  legacy_images integer not null default 0,                  -- pictures from the legacy PokemonTCG data
  synced_at timestamptz,                                     -- null: due
  attempted_at timestamptz,
  error text,
  primary key (lang, set_id)
);
alter table public.card_catalog_sync enable row level security;
revoke all on table public.card_catalog_sync from anon, authenticated;

-- ── The picked card on an order's card ───────────────────────────────────────
alter table public.cards add column if not exists catalog_card_id text;
alter table public.cards add column if not exists catalog_image_url text;
-- The same hosts as CATALOG_IMAGE_HOSTS in lib/card-catalog.ts: change both together
alter table public.cards drop constraint if exists cards_catalog_image_url_check;
alter table public.cards add constraint cards_catalog_image_url_check
  check (catalog_image_url is null or catalog_image_url ~ '^https://(assets\.tcgdex\.net|images\.pokemontcg\.io)/');

-- ── Search ───────────────────────────────────────────────────────────────────
-- Every word of q must appear in a card's search text. The longest word goes
-- through the trigram index; the rest are checked on what it finds. Ranking:
--   1. the card's number is one of the words ('4', '4/102', '215', 'tg01'),
--   2. how close the name (or English name) is to the words that aren't numbers,
--   3. English before Japanese,
--   4. how many of the words are in the set name, then how close it is,
--   5. newest release first, then by card number.
-- q is cleaned the same way as the search text (the route also cleans it with
-- normalizeCatalogText; the translate() here covers accents when it doesn't).
create or replace function public.search_card_catalog(q text, lim integer default 24)
returns table (
  id text, lang text, set_id text, set_name text, series text, release_date date,
  number text, printed_total text, name text, name_en text, rarity text,
  image_small text, image_large text
)
language sql
stable
set search_path = public, extensions, pg_temp
as $$
  with words as (
    select w
      from regexp_split_to_table(
             translate(lower(btrim(coalesce(q, ''))),
                       'áàâäãåéèêëíìîïóòôöõúùûüñç''’`',
                       'aaaaaaeeeeiiiiooooouuuunc'),
             '\s+') as w
     where w <> ''
     limit 8
  ),
  input as (
    select
      -- LIKE patterns, % _ and \ in the words taken literally
      array_agg('%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%'
                order by char_length(w) desc, w) as pats,
      -- Words that look like a card number, without leading zeros: '004/102' → '4'
      array_agg(regexp_replace(split_part(w, '/', 1), '^([a-z]*)0+([0-9])', '\1\2'))
        filter (where w ~ '^[a-z]{0,5}[0-9]{1,4}[a-z]?(/[0-9]{1,4})?$') as nums,
      coalesce(string_agg(w, ' ') filter (where w !~ '^[a-z]{0,5}[0-9]{1,4}[a-z]?(/[0-9]{1,4})?$'),
               string_agg(w, ' ')) as text_q,
      string_agg(w, ' ') as all_q
    from words
  )
  select c.id, c.lang, c.set_id, c.set_name, c.series, c.release_date,
         c.number, c.printed_total, c.name, c.name_en, c.rarity,
         c.image_small, c.image_large
    from public.card_catalog c
   where (select i.pats is not null from input i)
     and c.search like (select i.pats[1] from input i)
     and c.search like all ((select i.pats from input i)::text[])
   order by
     coalesce(regexp_replace(lower(c.number), '^([a-z]*)0+([0-9])', '\1\2') = any ((select i.nums from input i)::text[]), false) desc,
     greatest(similarity(lower(c.name), (select i.text_q from input i)),
              similarity(lower(coalesce(c.name_en, '')), (select i.text_q from input i))) desc,
     (c.lang = 'en') desc,
     (select count(*) from unnest((select i.pats from input i)::text[]) p where lower(c.set_name) like p) desc,
     case when lower(c.set_name) like any ((select i.pats from input i)::text[])
          then similarity(lower(c.set_name), (select i.all_q from input i)) else 0 end desc,
     c.release_date desc nulls last,
     lpad(coalesce(substring(c.number from '[0-9]+'), ''), 6, '0'),
     c.id
   limit least(greatest(coalesce(lim, 24), 1), 50);
$$;
revoke execute on function public.search_card_catalog(text, integer) from public, anon, authenticated;
grant execute on function public.search_card_catalog(text, integer) to service_role;
