import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/admin-auth";
import { AdminLink } from "@/components/admin-ui/admin-link";
import { LabelPrinterChoice } from "@/components/intake/label-print-button";

/**
 * Staff guide: printing labels on the Katasymbol (Supvan T50M Pro family,
 * 50 x 80 mm labels) from a phone. The printer has no driver a web page can
 * reach from Safari, so the website makes each label as a picture at the
 * label's exact size (400 x 640 dots) and the Katasymbol app prints the
 * picture. Steps from the research in the tracking brief (katasymbol.md).
 */

export const metadata: Metadata = { title: "Printing on the Katasymbol | Receiving", robots: { index: false } };

const panel = "bg-white rounded-xl border border-border p-5 sm:p-6";
const stepNum = "inline-flex size-7 shrink-0 items-center justify-center rounded-md border-2 border-foreground text-sm font-bold";

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="mt-3 flex flex-col gap-3">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-sm text-foreground">
          <span className={stepNum} aria-hidden>
            {i + 1}
          </span>
          <span className="min-w-0 pt-0.5">{item}</span>
        </li>
      ))}
    </ol>
  );
}

export default async function PrintingGuidePage() {
  await requireAdmin();
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <AdminLink href="/admin/receiving" className="text-sm font-bold text-primary hover:underline min-h-11 inline-flex items-center">
        Back to Receiving
      </AdminLink>
      <h1 className="font-heading font-black text-3xl text-foreground mt-1">How to print on the Katasymbol from your phone</h1>
      <p className="text-sm text-muted-foreground mt-1">
        The Katasymbol prints 50 × 80 mm labels from its own app over Bluetooth. The website makes each label as a picture at the label&apos;s exact
        size, and the app prints the picture.
      </p>

      <div className="mt-6 flex flex-col gap-6">
        <section aria-labelledby="what-h" className={panel}>
          <h2 id="what-h" className="font-heading font-black text-lg text-foreground">What gets printed</h2>
          <ul className="mt-3 flex flex-col gap-3 text-sm text-foreground">
            <li>
              <span className="font-bold">Slot labels</span> (CLAMP 01, HEAT PRESS 03…): one per clamp, press spot, humidor spot and so on. Print them
              once, in a batch, and stick each one on its clamp or spot. Reprint one only if it gets lost or damaged. They are on the{" "}
              <AdminLink href="/admin/receiving/locations" className="font-semibold text-primary underline">
                Places
              </AdminLink>{" "}
              page.
            </li>
            <li>
              <span className="font-bold">Bag labels</span>: one per tier bag, printed at intake on the order&apos;s Receiving page. Stick it on the
              bag.
            </li>
            <li>
              <span className="font-bold">Shelf signs</span>: one per due-date shelf slot (DUE MON DEC 7), printed the first time that slot is used.
            </li>
          </ul>
        </section>

        <section aria-labelledby="choice-h" className={panel}>
          <h2 id="choice-h" className="font-heading font-black text-lg text-foreground">This phone prints with</h2>
          <p className="text-sm text-muted-foreground mt-1">Saved on this phone (or computer) only. Every print button follows it.</p>
          <h3 className="mt-4 text-sm font-bold text-foreground">50 × 80 mm labels: slot labels, shelf signs, and bag labels at 50 × 80</h3>
          <div className="mt-2">
            <LabelPrinterChoice group="50x80" label="Printer for 50 × 80 mm labels" />
          </div>
          <h3 className="mt-5 text-sm font-bold text-foreground">Bag labels at 4 × 6 in (when Receiving Settings uses that size)</h3>
          <div className="mt-2">
            <LabelPrinterChoice group="inch" label="Printer for 4 × 6 in bag labels" />
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Bag label size:{" "}
            <AdminLink href="/admin/receiving/settings" className="font-semibold text-primary underline">
              Receiving Settings
            </AdminLink>
            .
          </p>
        </section>

        <section aria-labelledby="setup-h" className={panel}>
          <h2 id="setup-h" className="font-heading font-black text-lg text-foreground">Once: set up the phone</h2>
          <Steps
            items={[
              <>Install <span className="font-bold">Katasymbol</span> from the App Store (free, no account).</>,
              <>
                Load the 50 × 80 mm roll, turn the printer on and turn on Bluetooth. In Katasymbol, connect the printer. The app reads the roll and
                picks the 50 × 80 mm label.
              </>,
              <>When Katasymbol asks for Photos, allow it: it picks the label pictures from there.</>,
              <>Above, pick <span className="font-bold">Katasymbol (image)</span> for 50 × 80 mm labels.</>,
            ]}
          />
        </section>

        <section aria-labelledby="one-h" className={panel}>
          <h2 id="one-h" className="font-heading font-black text-lg text-foreground">Print a label</h2>
          <Steps
            items={[
              <>Tap the print button on the website (Print label on a bag, a slot&apos;s label on Places).</>,
              <>
                The share sheet opens. Tap <span className="font-bold">Save Image</span>. If Katasymbol is in the row of apps, you can tap it
                instead.
              </>,
              <>Open Katasymbol and start a new 50 × 80 mm label (the size of the roll).</>,
              <>Tap <span className="font-bold">Image</span> and pick the label from your photos (the newest one).</>,
              <>
                Stretch the picture to fill the whole label, edge to edge. It is made at the label&apos;s exact size, so it lines up. If the label
                shows sideways, turn the picture so it reads upright.
              </>,
              <>Tap <span className="font-bold">Print</span>.</>,
            ]}
          />
        </section>

        <section aria-labelledby="batch-h" className={panel}>
          <h2 id="batch-h" className="font-heading font-black text-lg text-foreground">A batch: 20 clamp labels</h2>
          <Steps
            items={[
              <>
                On{" "}
                <AdminLink href="/admin/receiving/locations" className="font-semibold text-primary underline">
                  Places
                </AdminLink>
                , print the range (Clamps 01 to 20). The website makes all 20 pictures and sends them at once: tap{" "}
                <span className="font-bold">Save 20 Images</span>.
              </>,
              <>
                In Katasymbol, print them one after another: Image, pick the next one, Print. They land in Photos in order (CLAMP 01 first), and
                each picture shows its number big, so check it as you pick.
              </>,
              <>Stick each label on its clamp as it comes out, so the numbers match.</>,
              <>
                If your phone can&apos;t take them all at once, or you tap <span className="font-bold">Send one at a time</span>, the button turns into{" "}
                <span className="font-bold">Next label (2 of 20)</span>: tap it after each one.
              </>,
            ]}
          />
        </section>

        <section aria-labelledby="tips-h" className={panel}>
          <h2 id="tips-h" className="font-heading font-black text-lg text-foreground">Good to know</h2>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-sm text-foreground">
            <li>Before you stick a new slot label on, scan it with the Scan page to check the QR reads.</li>
            <li>The printer connects to one phone at a time: close Katasymbol on the other phone first.</li>
            <li>Labels print black only. Keep the QR clear of tape and fingerprints.</li>
            <li>You can delete the label pictures from Photos once they are printed. Reprint any time from the website.</li>
            <li>On a computer, the print button saves the pictures to Downloads instead of opening the share sheet.</li>
            <li>
              Bag labels at 4 × 6 in still print on the Labelife printer as before: pick PDF / Labelife / QZ for 4 × 6 bag labels above.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
