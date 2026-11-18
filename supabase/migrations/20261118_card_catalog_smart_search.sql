-- Card catalog: smart search. Each card gets tags worked out from its name,
-- rarity, number and set (gold star, full art, secret rare, illustration rare,
-- special illustration rare, hyper/gold, rainbow, alt art, delta species,
-- holo, shiny, promo, trainer gallery, radiant, amazing rare, character rare,
-- LV.X, ACE SPEC, tag team, Japanese/English), and search_card_catalog() turns
-- the words people type ("gold star", "full art charizard", "sir umbreon",
-- "charizard 100/101") into those tags. Additive and rerunnable.
--
-- The data (TCGdex) has no "full art" field, so full art is inferred:
--   illustration / special illustration / hyper / secret / character /
--   shiny ultra / full art trainer rarities; trainer gallery (TG/GG numbers);
--   "Ultra Rare" from 2020 on (Sword & Shield and Scarlet & Violet use it only
--   for full arts) or in the last 10% of an older set's numbers (XY / Sun &
--   Moon full arts sit at the end of the set); any card numbered past its set's
--   printed total from 2011 on (Black & White onward).
-- Alt art and rainbow are approximate: special illustration rares, plus Sword &
-- Shield era secret rare V / VMAX / VSTAR (alt art) and Sun & Moon / Sword &
-- Shield secret rare GX / V / VMAX / VSTAR (rainbow).

set lock_timeout = '5s';

create or replace function public.card_catalog_tags(
  p_name text, p_rarity text, p_number text, p_total text, p_release date, p_lang text
) returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  with v as (
    select
      coalesce(p_name, '') as nm,
      coalesce(p_rarity, '') as r,
      coalesce(p_number, '') as num,
      case when p_number ~ '^[0-9]{1,4}$' and p_total ~ '^[0-9]{1,4}$' and p_total::int > 0
           then p_number::int > p_total::int else false end as past_total,
      case when p_number ~ '^[0-9]{1,4}$' and p_total ~ '^[0-9]{1,4}$' and p_total::int > 0
           then p_number::numeric / p_total::numeric else null end as pos
  )
  select concat_ws(' ',
    case when nm ~ '[☆★]' or nm ~* '\sstar(\s*δ)?$' then 'goldstar' end,
    case when nm ~ 'δ' then 'delta' end,
    case when r ~* 'holo' then 'holo' end,
    case when r ~* 'secret' or past_total then 'secretrare' end,
    case when r ~* '^(illustration rare|special illustration rare|hyper rare|mega hyper rare|secret rare|full art trainer|shiny ultra rare|character rare|character super rare|shiny rare v|shiny rare vmax)$'
           or num ~* '^(tg|gg)[0-9]'
           or (r ~* '^ultra rare$' and (p_release >= date '2020-01-01' or pos >= 0.9))
           or (past_total and p_release >= date '2011-01-01')
         then 'fullart' end,
    case when r ~* '^special illustration' then 'sir' end,
    case when r ~* '^illustration rare' then 'illustrationrare' end,
    case when r ~* 'hyper' then 'hyperrare' end,
    case when r ~* 'secret' and nm ~* '\m(gx|v|vmax|vstar)$'
           and p_release between date '2017-01-01' and date '2023-03-31' then 'rainbow' end,
    case when r ~* '^special illustration'
           or (r ~* 'secret' and nm ~* '\m(v|vmax|vstar)$' and p_release between date '2021-01-01' and date '2023-03-31')
         then 'altart' end,
    case when r ~* 'shiny' or num ~* '^sv[0-9]' then 'shiny' end,
    case when r ~* 'promo' then 'promo' end,
    case when num ~* '^(tg|gg)[0-9]' then 'trainergallery' end,
    case when r ~* 'radiant' then 'radiant' end,
    case when r ~* 'amazing' then 'amazingrare' end,
    case when r ~* 'character' then 'characterrare' end,
    case when r ~* 'lv\.?\s*x' or nm ~* 'lv\.?\s*x' then 'lvx' end,
    case when r ~* 'ace spec' then 'acespec' end,
    case when nm ~ '&' then 'tagteam' end,
    case when p_lang = 'ja' then 'japanese' else 'english' end)
  from v
$$;

alter table public.card_catalog
  add column if not exists tags text
  generated always as (public.card_catalog_tags(name, rarity, number, printed_total, release_date, lang)) stored;

create index if not exists card_catalog_tags_trgm_idx on public.card_catalog using gin (tags gin_trgm_ops);

-- ── Search ───────────────────────────────────────────────────────────────────
-- 1. What people type becomes tags: "gold star" / ☆ / a trailing "star" →
--    goldstar, "full art" / FA / SR → fullart, "special illustration rare" /
--    SIR / SAR → sir, "illustration rare" / IR / AR → illustrationrare,
--    "secret rare" → secretrare, "hyper rare" / gold / UR → hyperrare,
--    "alt art" → altart, "trainer gallery" / TG → trainergallery, "delta
--    species" / δ → delta, LV.X, ACE SPEC, tag team, Japanese / JP, English...
--    Words the catalog can't know (1st edition, shadowless, unlimited, reverse,
--    PSA / CGC / BGS / SGC, graded, card, pokemon...) and # are dropped.
-- 2. Tag words must be among the card's tags; every other word must appear in
--    its search text (name, set, series, number in every form, year).
-- 3. Ranking: the card's number is one of the words ('100/101', '4', 'tg01'),
--    a name that starts with a word, English first, closeness of the name,
--    words in the set name, cards with a picture, newest release, number.
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
  with base as (
    select translate(lower(btrim(coalesce(q, ''))),
                     'áàâäãåéèêëíìîïóòôöõúùûüñç''’`#',
                     'aaaaaaeeeeiiiiooooouuuunc') as s
  ),
  phrased as (
    select
      regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      regexp_replace(
        b.s,
        'gold\s*stars?|[☆★]', ' goldstar ', 'g'),
        '(?<!black\s)\mstars?$', ' goldstar ', 'g'),
        'special\s*illustration(\s*rares?)?|\m(sir|sirs|sar|sars)\M', ' sir ', 'g'),
        'illustration\s*rares?|\m(ir|ar)\M', ' illustrationrare ', 'g'),
        'full[\s-]*arts?|\m(fa|sr)\M', ' fullart ', 'g'),
        'alt(ernate|ernative)?[\s-]*arts?|\maa\M', ' altart ', 'g'),
        'secret\s*rares?|\msecrets?\M', ' secretrare ', 'g'),
        'hyper\s*rares?|\m(gold|golds|ur)\M', ' hyperrare ', 'g'),
        'rainbow(\s*rares?)?', ' rainbow ', 'g'),
        'trainer\s*gallery|\mtg\M', ' trainergallery ', 'g'),
        'delta(\s*species)?|δ', ' delta ', 'g'),
        'character\s*(super\s*)?rares?|\m(chr|csr)\M', ' characterrare ', 'g'),
        'amazing\s*rares?', ' amazingrare ', 'g'),
        'lv\.?\s*x|level\s*x', ' lvx ', 'g'),
        'ace\s*spec', ' acespec ', 'g'),
        'tag\s*team', ' tagteam ', 'g'),
        '\m(japanese|japan|jpn|jp)\M', ' japanese ', 'g'),
        '\m(english|eng)\M', ' english ', 'g'),
        '\m(holos|holofoil)\M', ' holo ', 'g'),
        '\mpromos\M', ' promo ', 'g'),
        '\m(1st|first|edition|ed|shadowless|unlimited|reverse|psa|cgc|bgs|sgc|graded|raw|card|cards|pokemon|tcg|the|of|and|with)\M', ' ', 'g')
      as s
    from base b
  ),
  words as (
    select w
      from phrased p, regexp_split_to_table(btrim(p.s), '\s+') as w
     where w <> ''
     limit 10
  ),
  tagged as (
    select w,
           w = any (array['goldstar','delta','holo','secretrare','fullart','sir','illustrationrare',
                          'hyperrare','rainbow','altart','shiny','promo','trainergallery','radiant',
                          'amazingrare','characterrare','lvx','acespec','tagteam','japanese','english']) as is_tag,
           w ~ '^[a-z]{0,5}[0-9]{1,4}[a-z]?(/[0-9]{1,4})?$' as is_num
      from words
  ),
  input as (
    select
      -- Card words as LIKE patterns (% _ and \ taken literally), longest first
      array_agg('%' || replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_') || '%'
                order by char_length(w) desc, w) filter (where not is_tag) as text_pats,
      array_agg('%' || w || '%') filter (where is_tag) as tag_pats,
      -- Card numbers without leading zeros: '004/102' → '4'
      array_agg(regexp_replace(split_part(w, '/', 1), '^([a-z]*)0+([0-9])', '\1\2')) filter (where is_num and not is_tag) as nums,
      coalesce(string_agg(w, ' ') filter (where not is_num and not is_tag), '') as text_q,
      coalesce(string_agg(w, ' ') filter (where not is_tag), '') as all_q
    from tagged
  )
  select c.id, c.lang, c.set_id, c.set_name, c.series, c.release_date,
         c.number, c.printed_total, c.name, c.name_en, c.rarity,
         c.image_small, c.image_large
    from public.card_catalog c, input i
   where (i.text_pats is not null or i.tag_pats is not null)
     and (i.text_pats is null or c.search like all (i.text_pats))
     and (i.tag_pats is null or c.tags like all (i.tag_pats))
   order by
     coalesce(regexp_replace(lower(c.number), '^([a-z]*)0+([0-9])', '\1\2') = any (i.nums), false) desc,
     exists (select 1 from regexp_split_to_table(i.text_q, ' ') w
              where w <> '' and (lower(c.name) like w || '%' or lower(coalesce(c.name_en, '')) like w || '%')) desc,
     (c.lang = 'en') desc,
     greatest(similarity(lower(c.name), i.text_q), similarity(lower(coalesce(c.name_en, '')), i.text_q)) desc,
     (select count(*) from unnest(coalesce(i.text_pats, '{}')) p where lower(c.set_name) like p) desc,
     case when i.all_q <> '' and lower(c.set_name) like any (coalesce(i.text_pats, '{}'))
          then similarity(lower(c.set_name), i.all_q) else 0 end desc,
     (c.image_small is not null) desc,
     c.release_date desc nulls last,
     lpad(coalesce(substring(c.number from '[0-9]+'), ''), 6, '0'),
     c.id
   limit least(greatest(coalesce(lim, 24), 1), 60);
$$;
revoke execute on function public.search_card_catalog(text, integer) from public, anon, authenticated;
grant execute on function public.search_card_catalog(text, integer) to service_role;
