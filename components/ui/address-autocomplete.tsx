"use client";

import { useEffect, useId, useRef, useState } from "react";

/*
 * Street address field with Google address suggestions (Places API (New):
 * AutocompleteSuggestion, the successor to google.maps.places.Autocomplete,
 * which new Google projects can't use). Suggestions render in our own list so
 * the input keeps the site's styling. Without NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
 * it is a plain input that the browser's saved-address autofill can fill.
 */

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
// Street-level results only (a house number), like the old "address" type
const ADDRESS_TYPES = ["street_address", "premise", "subpremise"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlacesLibrary = any;
let placesPromise: Promise<PlacesLibrary> | null = null;

// Module-level singleton so the Maps script only loads once however many
// fields are on the page.
function loadPlaces(apiKey: string): Promise<PlacesLibrary> {
  if (placesPromise) return placesPromise;
  placesPromise = new Promise<void>((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (w.google?.maps?.importLibrary) return resolve();
    w.__googleMapsReady = () => resolve();
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&callback=__googleMapsReady`;
    script.async = true;
    script.onerror = () => reject(new Error("Google Maps failed to load"));
    document.head.appendChild(script);
  })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .then(() => (window as any).google.maps.importLibrary("places"))
    .catch((err) => {
      placesPromise = null; // let a later field try again
      throw err;
    });
  return placesPromise;
}

export interface PlaceFields {
  street1: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

type Suggestion = {
  id: string;
  main: string;
  secondary: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prediction: any;
};

type AddressComponent = { longText: string | null; shortText: string | null; types: string[] };

function toFields(components: AddressComponent[]): PlaceFields {
  const get = (type: string, short = false) => {
    const c = components.find((x) => x.types.includes(type));
    return (short ? c?.shortText : c?.longText) ?? "";
  };
  return {
    street1: [get("street_number"), get("route")].filter(Boolean).join(" "),
    city: get("locality") || get("postal_town") || get("sublocality_level_1") || get("sublocality"),
    state: get("administrative_area_level_1", true),
    zip: get("postal_code"),
    country: get("country", true) || "US",
  };
}

interface Props {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onPlaceSelect: (fields: PlaceFields) => void;
  placeholder?: string;
  className?: string;
  /** Countries Google suggests from (ISO codes, up to 15); US by default,
   *  any country when empty. */
  countries?: string[];
}

export function AddressAutocomplete({
  id,
  value,
  onChange,
  onPlaceSelect,
  placeholder = "123 Main St",
  className,
  countries = ["us"],
}: Props) {
  const listId = useId();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionToken = useRef<any>(null); // one billing session per address picked
  const requestId = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countriesKey = countries.join(",");

  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); }, []);

  function close() {
    setOpen(false);
    setActive(-1);
  }

  function search(input: string) {
    if (!API_KEY) return;
    if (debounce.current) clearTimeout(debounce.current);
    const query = input.trim();
    if (query.length < 3) {
      requestId.current++;
      setSuggestions([]);
      close();
      return;
    }
    debounce.current = setTimeout(async () => {
      const id = ++requestId.current;
      try {
        const places = await loadPlaces(API_KEY);
        sessionToken.current ??= new places.AutocompleteSessionToken();
        const regions = countriesKey ? countriesKey.split(",") : [];
        const { suggestions: found } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query,
          sessionToken: sessionToken.current,
          includedPrimaryTypes: ADDRESS_TYPES,
          ...(regions.length ? { includedRegionCodes: regions } : {}),
          language: "en-US",
        });
        if (id !== requestId.current) return; // a newer keystroke won
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list: Suggestion[] = (found ?? []).filter((s: any) => s.placePrediction).slice(0, 5).map((s: any) => ({
          id: s.placePrediction.placeId,
          main: s.placePrediction.mainText?.text ?? s.placePrediction.text.text,
          secondary: s.placePrediction.secondaryText?.text ?? "",
          prediction: s.placePrediction,
        }));
        setSuggestions(list);
        setActive(-1);
        setOpen(list.length > 0);
      } catch (err) {
        // Suggestions are a convenience: typing the address still works
        console.error("Address suggestions failed:", err instanceof Error ? err.message : err);
        if (id === requestId.current) close();
      }
    }, 200);
  }

  async function choose(s: Suggestion) {
    close();
    requestId.current++;
    onChange(s.main);
    try {
      const place = s.prediction.toPlace();
      await place.fetchFields({ fields: ["addressComponents"] });
      sessionToken.current = null; // the session ends with the details call
      const fields = toFields(place.addressComponents ?? []);
      if (!fields.street1) fields.street1 = s.main;
      onChange(fields.street1);
      onPlaceSelect(fields);
    } catch (err) {
      console.error("Address details failed:", err instanceof Error ? err.message : err);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      choose(suggestions[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  if (!API_KEY) {
    return (
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={className}
        autoComplete="address-line1"
      />
    );
  }

  return (
    <div className="relative w-full">
      <input
        id={id}
        value={value}
        onChange={(e) => { onChange(e.target.value); search(e.target.value); }}
        onKeyDown={onKeyDown}
        onBlur={close}
        onFocus={() => { if (suggestions.length > 0 && value.trim().length >= 3) setOpen(true); }}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
      />
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border bg-white shadow-lg">
          <ul id={listId} role="listbox" aria-label="Address suggestions">
            {suggestions.map((s, i) => (
              <li
                key={s.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                // mousedown, so the input's blur doesn't close the list first
                onMouseDown={(e) => { e.preventDefault(); choose(s); }}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer px-3 py-2.5 text-left ${i === active ? "bg-secondary" : ""}`}
              >
                <span className="block text-sm font-medium text-foreground">{s.main}</span>
                {s.secondary && <span className="block text-xs text-muted-foreground">{s.secondary}</span>}
              </li>
            ))}
          </ul>
          <p className="border-t border-border px-3 py-1.5 text-right text-[11px] text-muted-foreground">powered by Google</p>
        </div>
      )}
    </div>
  );
}
