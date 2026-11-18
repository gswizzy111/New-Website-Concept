"use client";

import { useState } from "react";
import { CardPicker, pickCaption } from "@/components/admin/card-picker";
import { catalogDisplayName, type CatalogCard } from "@/lib/card-catalog";

/** The same search the card forms use, to check the catalog without touching an order. */
export function CatalogTry() {
  const [text, setText] = useState("");
  const [card, setCard] = useState<CatalogCard | null>(null);

  return (
    <div className="bg-white rounded-xl border border-border p-6 flex flex-col gap-3">
      <div>
        <h2 className="font-heading font-black text-lg text-foreground">Try a search</h2>
        <p className="text-sm text-muted-foreground">
          Words in any order: a name, set, year or number, for example &ldquo;charizard base 4&rdquo;, &ldquo;umbreon 215&rdquo; or &ldquo;リザードン&rdquo;.
        </p>
      </div>
      <div className="max-w-xl">
        <CardPicker
          inputId="catalog-try"
          ariaLabel="Search the card catalog"
          inputClassName="w-full h-10 border border-border rounded-lg px-3 text-sm focus:outline-none focus:border-primary transition-colors bg-white"
          value={text}
          onChange={(t) => { setText(t); setCard(null); }}
          onPick={(c) => { setCard(c); setText(catalogDisplayName(c)); }}
          picked={card ? { imageUrl: card.image_large ?? card.image_small, caption: pickCaption(card) } : null}
          onClear={() => setCard(null)}
          placeholder="Search cards"
        />
      </div>
    </div>
  );
}
