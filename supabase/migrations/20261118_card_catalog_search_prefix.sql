-- Card catalog search: names that start with a typed word rank first, so a
-- half-typed name ('char', 'umb') lists Charizard / Umbreon before names that
-- only end with it (Chimchar). Replaces search_card_catalog() from
-- 20261118_card_catalog.sql; additive and safe to run more than once.

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
     -- A name that starts with one of the words ('char' finds Charizard and Charmander before Chimchar)
     exists (select 1 from regexp_split_to_table((select i.text_q from input i), ' ') w
              where w <> '' and (lower(c.name) like w || '%' or lower(coalesce(c.name_en, '')) like w || '%')) desc,
     greatest(similarity(lower(c.name), (select i.text_q from input i)),
              similarity(lower(coalesce(c.name_en, '')), (select i.text_q from input i))) desc,
     (c.lang = 'en') desc,
     (select count(*) from unnest((select i.pats from input i)::text[]) p where lower(c.set_name) like p) desc,
     case when lower(c.set_name) like any ((select i.pats from input i)::text[])
          then similarity(lower(c.set_name), (select i.all_q from input i)) else 0 end desc,
     (c.image_small is not null) desc,
     c.release_date desc nulls last,
     lpad(coalesce(substring(c.number from '[0-9]+'), ''), 6, '0'),
     c.id
   limit least(greatest(coalesce(lim, 24), 1), 50);
$$;
revoke execute on function public.search_card_catalog(text, integer) from public, anon, authenticated;
grant execute on function public.search_card_catalog(text, integer) to service_role;
