// Fills the card catalog (lib/card-catalog.ts, supabase/migrations/
// 20261118_card_catalog.sql) from TCGdex, an open-source Pokémon card
// database (api.tcgdex.net): every English and Japanese card, set by set.
//
// A run does as much as fits in its time budget and stops; the next run picks
// up where it left off (card_catalog_sync remembers each set). Everything is
// an upsert on the card's id, so running a set twice changes nothing.
//   1. Cheap check: one read of card_catalog_sync. Nothing due → done.
//   2. Every 6 hours, the set lists (one request per language). A new set, or
//      a set whose card count changed, becomes due.
//   3. Due sets (never synced, or synced over 7 days ago), newest first: the
//      set's cards (REST), their rarity and Pokédex numbers (GraphQL), the
//      English names of Japanese Pokémon (PokeAPI's species names), and for
//      English cards TCGdex has no picture of, the picture from the legacy
//      PokemonTCG data when the set, number and name all agree.
// Runs from the cron route (app/api/cron/sync-card-catalog) and the admin
// Card Catalog page's "Sync now" (app/api/admin/card-catalog/sync).
//
// Pictures stay on the source CDNs: we store links only.
//
// TCG Pocket sets (a phone game: no physical cards) are left out.

import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeCatalogText } from "@/lib/card-catalog";

const TCGDEX = "https://api.tcgdex.net/v2";
const LEGACY = "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master";
const SPECIES_NAMES_CSV = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv";
const POKEAPI_ENGLISH = "9";

export const CATALOG_LANGS = ["en", "ja"] as const;
export type CatalogLang = (typeof CATALOG_LANGS)[number];

/** The card_catalog_sync row that records when a language's set list was last read. */
export const LIST_ROW = "_list";
const LIST_EVERY_MS = 6 * 60 * 60 * 1000;
const SET_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
/** A set that failed waits this long before a run tries it again, so a set the source can't serve doesn't keep every run busy. */
const RETRY_FAILED_MS = 30 * 60 * 1000;
const SKIPPED_SERIES = new Set(["tcgp"]);
const CONCURRENCY = 4;
/** Start no new set within this long of the deadline. */
const SET_RESERVE_MS = 2500;
const UPSERT_CHUNK = 500;

export type SyncRow = {
  lang: CatalogLang;
  set_id: string;
  source: string;
  set_name: string | null;
  series: string | null;
  release_date: string | null;
  source_total: number | null;
  cards: number;
  images: number;
  legacy_images: number;
  synced_at: string | null;
  attempted_at: string | null;
  error: string | null;
};

export type CatalogRow = {
  id: string;
  source: string;
  lang: CatalogLang;
  set_id: string;
  set_name: string;
  series: string | null;
  release_date: string | null;
  number: string;
  printed_total: string | null;
  name: string;
  name_en: string | null;
  rarity: string | null;
  image_small: string | null;
  image_large: string | null;
  search: string;
  updated_at: string;
};

/** Where a run reads and writes its progress and cards (the database, or a stub in a dry run). */
export interface CatalogStore {
  listSyncRows(): Promise<SyncRow[]>;
  saveSyncRows(rows: SyncRow[]): Promise<void>;
  saveCards(rows: CatalogRow[]): Promise<void>;
}

export type CatalogSyncResult = {
  /** Nothing is left to sync for now. */
  done: boolean;
  /** The run stopped after the cheap check: everything was already up to date. */
  upToDate: boolean;
  listsChecked: number;
  setsSynced: number;
  cardsSaved: number;
  setsLeft: number;
  failed: { lang: string; set_id: string; error: string }[];
  ms: number;
};

const SYNC_COLUMNS = "lang, set_id, source, set_name, series, release_date, source_total, cards, images, legacy_images, synced_at, attempted_at, error";

export function supabaseCatalogStore(admin = createAdminClient()): CatalogStore {
  return {
    async listSyncRows() {
      const { data, error } = await admin.from("card_catalog_sync").select(SYNC_COLUMNS);
      if (error) throw new Error(`card_catalog_sync: ${error.message}`);
      return (data ?? []) as SyncRow[];
    },
    async saveSyncRows(rows) {
      if (rows.length === 0) return;
      const { error } = await admin.from("card_catalog_sync").upsert(rows, { onConflict: "lang,set_id" });
      if (error) throw new Error(`card_catalog_sync: ${error.message}`);
    },
    async saveCards(rows) {
      for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
        const { error } = await admin.from("card_catalog").upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict: "id" });
        if (error) throw new Error(`card_catalog: ${error.message}`);
      }
    },
  };
}

// ── Source data ──────────────────────────────────────────────────────────────

type FetchFn = typeof fetch;

type TcgdexSetBrief = {
  id: string;
  name: string;
  releaseDate?: string | null;
  serie?: { id?: string | null; name?: string | null } | null;
  cardCount?: { total?: number | null; official?: number | null } | null;
};

type TcgdexCardBrief = { id: string; localId: string; name: string; image?: string | null };
type TcgdexSet = TcgdexSetBrief & { cards?: TcgdexCardBrief[] };

type LegacySet = { id: string; name: string; releaseDate: string; total: number; printedTotal: number };
type LegacyCard = { number: string; name: string; images?: { small?: string; large?: string } };

async function getJson<T>(fetchFn: FetchFn, url: string, deadline: number, init?: RequestInit): Promise<T> {
  const ms = Math.max(1500, Math.min(8000, deadline - Date.now()));
  const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(ms), cache: "no-store" });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return (await res.json()) as T;
}

async function graphql<T>(fetchFn: FetchFn, query: string, deadline: number): Promise<{ data?: T; errors?: unknown[] }> {
  return getJson(fetchFn, `${TCGDEX}/graphql`, deadline, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
}

/** A GraphQL string literal. */
const gqlString = (s: string) => JSON.stringify(s);

async function fetchSetList(fetchFn: FetchFn, lang: CatalogLang, deadline: number): Promise<TcgdexSetBrief[]> {
  const res = await graphql<{ sets: (TcgdexSetBrief | null)[] }>(
    fetchFn,
    `{ sets @locale(lang: ${gqlString(lang)}) { id name releaseDate serie { id name } cardCount { total official } } }`,
    deadline,
  );
  const sets = (res.data?.sets ?? []).filter((s): s is TcgdexSetBrief => !!s?.id && !!s.name);
  if (sets.length === 0) throw new Error(`TCGdex returned no ${lang} sets`);
  return sets;
}

/**
 * Rarity and Pokédex numbers for a set's cards. Two lists, because a card
 * with no rarity comes back as null in the first. Best effort: a failure
 * leaves them out and the cards are saved without them.
 */
async function fetchEnrichment(fetchFn: FetchFn, lang: CatalogLang, setId: string, deadline: number) {
  const filter = `filters: { id: ${gqlString(`${setId}-`)} }, pagination: { page: 1, itemsPerPage: 5000 }`;
  const loc = `@locale(lang: ${gqlString(lang)})`;
  const res = await graphql<{ r?: ({ id: string; rarity: string | null } | null)[]; d?: ({ id: string; dexId: number[] | null } | null)[] }>(
    fetchFn,
    `{ r: cards(${filter}) ${loc} { id rarity }${lang === "ja" ? ` d: cards(${filter}) ${loc} { id dexId }` : ""} }`,
    deadline,
  );
  const rarity = new Map<string, string>();
  for (const c of res.data?.r ?? []) if (c?.id && c.rarity && c.rarity !== "None") rarity.set(c.id, c.rarity);
  const dex = new Map<string, number[]>();
  for (const c of res.data?.d ?? []) if (c?.id && c.dexId?.length) dex.set(c.id, c.dexId);
  return { rarity, dex };
}

/** One CSV line, with quoted fields. */
function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** National Pokédex number → English species name, from PokeAPI's data. */
export function parseSpeciesNames(csv: string): Map<number, string> {
  const names = new Map<number, string>();
  for (const line of csv.split(/\r?\n/).slice(1)) {
    if (!line) continue;
    const [id, langId, name] = csvFields(line);
    if (langId === POKEAPI_ENGLISH && name) names.set(Number(id), name);
  }
  return names;
}

const legacyNorm = (s: string) => normalizeCatalogText(s).replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
/** "001" → "1", "TG01" → "TG1", "SV001" → "SV1", "4a" → "4A". */
export const numberKey = (n: string) => n.trim().toUpperCase().replace(/^([A-Z]*)0+(?=\d)/, "$1");
/** The same card in both sources: the names start the same way (catches a mismatched set). */
const sameName = (a: string, b: string) => {
  const x = legacyNorm(a);
  const y = legacyNorm(b);
  return x.length > 0 && x.slice(0, 5) === y.slice(0, 5);
};

/** The legacy set for a TCGdex set: same id, else same name, else same release date and size. */
export function matchLegacySet(set: { id: string; name: string; releaseDate: string | null; total: number | null; official: number | null }, legacy: LegacySet[]): LegacySet | null {
  const date = (l: LegacySet) => l.releaseDate.replace(/\//g, "-");
  const byId = legacy.filter((l) => l.id === set.id);
  if (byId.length === 1) return byId[0];
  let byName = legacy.filter((l) => legacyNorm(l.name) === legacyNorm(set.name));
  if (byName.length > 1) byName = byName.filter((l) => date(l) === set.releaseDate);
  if (byName.length === 1) return byName[0];
  const byDate = legacy.filter((l) => date(l) === set.releaseDate && (l.total === set.total || l.printedTotal === set.official));
  return byDate.length === 1 ? byDate[0] : null;
}

/** Everything one run fetches once and shares between sets. */
class RunCache {
  private species?: Promise<Map<number, string>>;
  private legacySets?: Promise<LegacySet[]>;
  constructor(private fetchFn: FetchFn, private deadline: number) {}

  speciesNames() {
    this.species ??= this.fetchFn(SPECIES_NAMES_CSV, { signal: AbortSignal.timeout(Math.max(1500, Math.min(8000, this.deadline - Date.now()))), cache: "no-store" })
      .then((r) => (r.ok ? r.text() : ""))
      .then(parseSpeciesNames)
      .catch(() => new Map<number, string>());
    return this.species;
  }

  legacySetList() {
    this.legacySets ??= getJson<LegacySet[]>(this.fetchFn, `${LEGACY}/sets/en.json`, this.deadline).catch(() => []);
    return this.legacySets;
  }

  legacyCards(id: string) {
    return getJson<LegacyCard[]>(this.fetchFn, `${LEGACY}/cards/en/${encodeURIComponent(id)}.json`, this.deadline).catch(() => [] as LegacyCard[]);
  }
}

// ── Building rows ────────────────────────────────────────────────────────────

/** The text the trigram index searches: names, set, series, number in every form, year, set id. */
export function searchText(r: Pick<CatalogRow, "name" | "name_en" | "set_name" | "series" | "number" | "printed_total" | "release_date" | "set_id">): string {
  const key = numberKey(r.number).toLowerCase();
  const parts = [
    r.name,
    r.name_en,
    r.set_name,
    r.series,
    r.number,
    key !== r.number.toLowerCase() ? key : null,
    r.printed_total ? `${r.number}/${r.printed_total}` : null,
    r.printed_total && key !== r.number.toLowerCase() ? `${key}/${r.printed_total}` : null,
    r.release_date?.slice(0, 4),
    r.set_id,
  ];
  return normalizeCatalogText(parts.filter(Boolean).join(" "));
}

type SetPayload = {
  lang: CatalogLang;
  set: TcgdexSet;
  rarity: Map<string, string>;
  englishNames: Map<string, string>;
  legacyImages: Map<string, { small: string | null; large: string | null }>;
  now: string;
};

export function buildRows({ lang, set, rarity, englishNames, legacyImages, now }: SetPayload): CatalogRow[] {
  const official = set.cardCount?.official ?? 0;
  const releaseDate = set.releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(set.releaseDate) ? set.releaseDate : null;
  const rows: CatalogRow[] = [];
  // One row per card: an upsert that names a card twice fails the whole set
  const seen = new Set<string>();
  for (const c of set.cards ?? []) {
    if (!c?.id || !c.name || c.localId == null || seen.has(c.id)) continue;
    seen.add(c.id);
    const number = String(c.localId).trim();
    const legacy = legacyImages.get(c.id);
    const row: Omit<CatalogRow, "search"> = {
      id: `tcgdex:${lang}:${c.id}`,
      source: "tcgdex",
      lang,
      set_id: set.id,
      set_name: set.name,
      series: set.serie?.name ?? null,
      release_date: releaseDate,
      number,
      printed_total: official > 0 && /^\d+$/.test(number) ? String(official) : null,
      name: c.name.trim(),
      name_en: lang === "ja" ? englishNames.get(c.id) ?? null : null,
      rarity: rarity.get(c.id) ?? null,
      image_small: c.image ? `${c.image}/low.webp` : legacy?.small ?? null,
      image_large: c.image ? `${c.image}/high.webp` : legacy?.large ?? null,
      updated_at: now,
    };
    rows.push({ ...row, search: searchText(row) });
  }
  return rows;
}

// ── One set ──────────────────────────────────────────────────────────────────

async function syncSet(row: SyncRow, store: CatalogStore, fetchFn: FetchFn, cache: RunCache, deadline: number) {
  const { lang, set_id } = row;
  const [set, enrichment] = await Promise.all([
    getJson<TcgdexSet>(fetchFn, `${TCGDEX}/${lang}/sets/${encodeURIComponent(set_id)}`, deadline),
    fetchEnrichment(fetchFn, lang, set_id, deadline).catch(() => ({ rarity: new Map<string, string>(), dex: new Map<string, number[]>() })),
  ]);
  if (!set?.id || !Array.isArray(set.cards)) throw new Error("TCGdex returned no cards for this set");

  // Japanese cards: the English species name, so "Charizard" finds リザードン
  const englishNames = new Map<string, string>();
  if (lang === "ja" && enrichment.dex.size > 0) {
    const species = await cache.speciesNames();
    for (const [id, dexIds] of enrichment.dex) {
      const names = dexIds.map((n) => species.get(n)).filter((n): n is string => !!n);
      if (names.length === dexIds.length) englishNames.set(id, names.join(" & "));
    }
  }

  // English cards TCGdex has no picture of: the legacy data's, when it is the same card
  const legacyImages = new Map<string, { small: string | null; large: string | null }>();
  const missing = lang === "en" ? set.cards.filter((c) => c?.id && !c.image) : [];
  if (missing.length > 0) {
    const legacySet = matchLegacySet(
      { id: set.id, name: set.name, releaseDate: set.releaseDate ?? null, total: set.cardCount?.total ?? null, official: set.cardCount?.official ?? null },
      await cache.legacySetList(),
    );
    if (legacySet) {
      const byNumber = new Map((await cache.legacyCards(legacySet.id)).map((c) => [numberKey(c.number), c]));
      for (const c of missing) {
        const l = byNumber.get(numberKey(String(c.localId)));
        if (l?.images?.large && sameName(l.name, c.name)) {
          legacyImages.set(c.id, { small: l.images.small ?? null, large: l.images.large });
        }
      }
    }
  }

  const now = new Date().toISOString();
  const rows = buildRows({ lang, set, rarity: enrichment.rarity, englishNames, legacyImages, now });
  await store.saveCards(rows);
  const saved: SyncRow = {
    ...row,
    set_name: set.name ?? row.set_name,
    series: set.serie?.name ?? row.series,
    release_date: rows[0]?.release_date ?? row.release_date,
    source_total: set.cardCount?.total ?? row.source_total,
    cards: rows.length,
    images: rows.filter((r) => r.image_large).length,
    legacy_images: legacyImages.size,
    synced_at: now,
    attempted_at: now,
    error: null,
  };
  await store.saveSyncRows([saved]);
  return saved;
}

// ── A run ────────────────────────────────────────────────────────────────────

const keyOf = (r: { lang: string; set_id: string }) => `${r.lang}:${r.set_id}`;

function emptyRow(lang: CatalogLang, set_id: string): SyncRow {
  return {
    lang, set_id, source: "tcgdex", set_name: null, series: null, release_date: null, source_total: null,
    cards: 0, images: 0, legacy_images: 0, synced_at: null, attempted_at: null, error: null,
  };
}

const olderThan = (iso: string | null, ms: number, now: number) => !iso || now - Date.parse(iso) > ms;

/**
 * Sets to sync now: never synced first, then the oldest sync; newest sets first, English first.
 * A set that failed in the last 30 minutes waits, unless retryFailed.
 */
export function dueSets(rows: SyncRow[], now: number, retryFailed = false): SyncRow[] {
  return rows
    .filter((r) => r.set_id !== LIST_ROW && olderThan(r.synced_at, SET_EVERY_MS, now)
      && (retryFailed || !r.error || olderThan(r.attempted_at, RETRY_FAILED_MS, now)))
    .sort((a, b) =>
      Number(!!a.synced_at) - Number(!!b.synced_at)
      || (b.release_date ?? "").localeCompare(a.release_date ?? "")
      || (a.lang === b.lang ? 0 : a.lang === "en" ? -1 : 1)
      || a.set_id.localeCompare(b.set_id));
}

export async function syncCardCatalog(opts: {
  budgetMs?: number;
  store?: CatalogStore;
  fetchFn?: FetchFn;
  /** Read the set lists even if they were read in the last 6 hours. */
  refreshLists?: boolean;
  /** Try sets that failed in the last 30 minutes too. */
  retryFailed?: boolean;
} = {}): Promise<CatalogSyncResult> {
  const started = Date.now();
  const deadline = started + (opts.budgetMs ?? 8000);
  const store = opts.store ?? supabaseCatalogStore();
  const fetchFn = opts.fetchFn ?? fetch;
  const result: CatalogSyncResult = { done: false, upToDate: false, listsChecked: 0, setsSynced: 0, cardsSaved: 0, setsLeft: 0, failed: [], ms: 0 };

  // 1. The cheap check
  const rows = new Map((await store.listSyncRows()).map((r) => [keyOf(r), r]));
  // A set list that failed waits RETRY_FAILED_MS before the next try, like a failed set
  const listsDue = CATALOG_LANGS.filter((lang) => {
    if (opts.refreshLists) return true;
    const row = rows.get(keyOf({ lang, set_id: LIST_ROW }));
    if (row?.error && !olderThan(row.attempted_at ?? null, RETRY_FAILED_MS, started)) return false;
    return olderThan(row?.synced_at ?? null, LIST_EVERY_MS, started);
  });
  if (listsDue.length === 0 && dueSets([...rows.values()], started, opts.retryFailed).length === 0) {
    return { ...result, done: true, upToDate: true, ms: Date.now() - started };
  }

  // 2. The set lists: new sets, and sets whose card count changed, become due
  await Promise.all(listsDue.map(async (lang) => {
    const listKey = keyOf({ lang, set_id: LIST_ROW });
    const listRow = rows.get(listKey) ?? emptyRow(lang, LIST_ROW);
    const nowIso = new Date().toISOString();
    try {
      const sets = (await fetchSetList(fetchFn, lang, deadline)).filter((s) => !SKIPPED_SERIES.has(s.serie?.id ?? ""));
      const changed: SyncRow[] = [];
      for (const s of sets) {
        const before = rows.get(keyOf({ lang, set_id: s.id })) ?? emptyRow(lang, s.id);
        const total = s.cardCount?.total ?? null;
        const next: SyncRow = {
          ...before,
          set_name: s.name,
          series: s.serie?.name ?? null,
          release_date: s.releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(s.releaseDate) ? s.releaseDate : null,
          source_total: total,
          // More (or fewer) cards than when it was synced: sync it again
          synced_at: before.source_total === total ? before.synced_at : null,
        };
        if (JSON.stringify(next) !== JSON.stringify(before)) changed.push(next);
        rows.set(keyOf(next), next);
      }
      const doneList: SyncRow = { ...listRow, source_total: sets.length, synced_at: nowIso, attempted_at: nowIso, error: null };
      rows.set(listKey, doneList);
      await store.saveSyncRows([...changed, doneList]);
      result.listsChecked++;
    } catch (err) {
      const failedList: SyncRow = { ...listRow, attempted_at: nowIso, error: String(err instanceof Error ? err.message : err).slice(0, 300) };
      rows.set(listKey, failedList);
      result.failed.push({ lang, set_id: LIST_ROW, error: failedList.error! });
      await store.saveSyncRows([failedList]).catch(() => {});
    }
  }));

  // 3. Due sets, a few at a time, until the time is up
  const queue = dueSets([...rows.values()], started, opts.retryFailed);
  const cache = new RunCache(fetchFn, deadline);
  const worker = async () => {
    while (queue.length > 0 && Date.now() < deadline - SET_RESERVE_MS) {
      const row = queue.shift()!;
      try {
        const saved = await syncSet(row, store, fetchFn, cache, deadline);
        result.setsSynced++;
        result.cardsSaved += saved.cards;
      } catch (err) {
        const error = String(err instanceof Error ? err.message : err).slice(0, 300);
        result.failed.push({ lang: row.lang, set_id: row.set_id, error });
        await store.saveSyncRows([{ ...row, attempted_at: new Date().toISOString(), error }]).catch(() => {});
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  result.setsLeft = queue.length + result.failed.filter((f) => f.set_id !== LIST_ROW).length;
  result.done = result.setsLeft === 0 && !result.failed.some((f) => f.set_id === LIST_ROW);
  result.ms = Date.now() - started;
  return result;
}

// ── Status, for the admin Card Catalog page ─────────────────────────────────

export type CatalogLangStatus = {
  lang: CatalogLang;
  sets: number;
  setsSynced: number;
  cards: number;
  images: number;
  legacyImages: number;
  lastSync: string | null;
  listCheckedAt: string | null;
  errors: { set_id: string; set_name: string | null; error: string }[];
};

/** Totals per language from card_catalog_sync alone (a few hundred small rows; never the catalog itself). */
export function catalogStatus(rows: SyncRow[]): CatalogLangStatus[] {
  return CATALOG_LANGS.map((lang) => {
    const mine = rows.filter((r) => r.lang === lang);
    const sets = mine.filter((r) => r.set_id !== LIST_ROW);
    const list = mine.find((r) => r.set_id === LIST_ROW) ?? null;
    const synced = sets.filter((r) => r.synced_at);
    return {
      lang,
      sets: sets.length,
      setsSynced: synced.length,
      cards: synced.reduce((n, r) => n + (r.cards ?? 0), 0),
      images: synced.reduce((n, r) => n + (r.images ?? 0), 0),
      legacyImages: synced.reduce((n, r) => n + (r.legacy_images ?? 0), 0),
      lastSync: synced.reduce<string | null>((max, r) => (!max || (r.synced_at! > max) ? r.synced_at : max), null),
      listCheckedAt: list?.synced_at ?? null,
      errors: mine.filter((r) => r.error).map((r) => ({ set_id: r.set_id, set_name: r.set_name, error: r.error! })),
    };
  });
}

export async function readCatalogStatus(store: CatalogStore = supabaseCatalogStore()) {
  return catalogStatus(await store.listSyncRows());
}
