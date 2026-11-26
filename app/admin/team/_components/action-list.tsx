import { AdminLink } from "@/components/admin-ui/admin-link";
import { ACTION_LABEL, placeText, stepText, type ActivityAction } from "@/lib/team-activity";
import { KIND_TONE, personName, shortWhen, type WorkerName } from "../_lib/view";

/**
 * Recorded actions, newest first: a table on a computer, one block per
 * action on a phone. Used by the Activity page (`showCard`) and a card's own
 * page (one card: no card or order column).
 */

const link = "inline-flex items-center min-h-11 font-semibold text-primary hover:underline underline-offset-2";

export function KindTag({ kind }: { kind: ActivityAction["kind"] }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ${KIND_TONE[kind]}`}>
      {ACTION_LABEL[kind]}
    </span>
  );
}

export function Person({ by, dir }: { by: string | null; dir: ReadonlyMap<string, WorkerName> }) {
  const p = personName(by, dir);
  if (by === null) return <span className="text-muted-foreground italic">{p.title}</span>;
  return (
    <span className="font-semibold text-foreground">
      {p.title}
      {p.username && <span className="ml-1 font-mono text-xs font-normal text-muted-foreground">{p.username}</span>}
    </span>
  );
}

function CardCell({ a }: { a: ActivityAction }) {
  if (a.cardId) {
    return (
      <AdminLink href={`/admin/receiving/card/${a.cardId}`} className="group inline-flex flex-col justify-center min-h-11 min-w-0">
        <span className="font-mono text-xs font-bold text-primary group-hover:underline">{a.cardCode ?? "No Card ID"}</span>
        <span className="text-foreground break-words">{a.cardName ?? "Card"}</span>
      </AdminLink>
    );
  }
  if (a.bagId && a.bagCode) {
    return <AdminLink href={`/admin/receiving/bag/${a.bagId}`} className={`font-mono text-xs ${link}`}>Bag {a.bagCode}</AdminLink>;
  }
  return <span className="text-muted-foreground">—</span>;
}

function OrderCell({ a }: { a: ActivityAction }) {
  if (!a.orderId || !a.orderNumber) return <span className="text-muted-foreground">—</span>;
  return <AdminLink href={`/admin/orders/${a.orderId}`} className={link}>#{a.orderNumber}</AdminLink>;
}

/** Place, step and detail, each on its own line. */
function FromTo({ a }: { a: ActivityAction }) {
  const place = placeText(a);
  const step = stepText(a);
  if (!place && !step && !a.detail) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-col gap-0.5">
      {place && <span className="text-foreground">{place}</span>}
      {step && <span className="text-muted-foreground">Step: <span className="text-foreground">{step}</span></span>}
      {a.detail && <span className="text-muted-foreground break-words">{a.detail}</span>}
    </span>
  );
}

export function ActionList({ actions, dir, showCard = true, now }: { actions: readonly ActivityAction[]; dir: ReadonlyMap<string, WorkerName>; showCard?: boolean; now?: Date }) {
  return (
    <>
      {/* Computer: one row per action */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary/40 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <th scope="col" className="px-4 py-2.5 whitespace-nowrap">Time</th>
              <th scope="col" className="px-4 py-2.5">Person</th>
              <th scope="col" className="px-4 py-2.5">Action</th>
              {showCard && <th scope="col" className="px-4 py-2.5">Card</th>}
              {showCard && <th scope="col" className="px-4 py-2.5">Order</th>}
              <th scope="col" className="px-4 py-2.5">From → to</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {actions.map((a) => (
              <tr key={a.id} className="align-top">
                <td className="px-4 py-2.5 whitespace-nowrap tabular-nums text-muted-foreground">{shortWhen(a.at, now)}</td>
                <td className="px-4 py-2.5"><Person by={a.by} dir={dir} /></td>
                <td className="px-4 py-2.5"><KindTag kind={a.kind} /></td>
                {showCard && <td className="px-4 py-2.5 max-w-64"><CardCell a={a} /></td>}
                {showCard && <td className="px-4 py-2.5 whitespace-nowrap"><OrderCell a={a} /></td>}
                <td className="px-4 py-2.5"><FromTo a={a} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone: one block per action */}
      <ol className="md:hidden flex flex-col divide-y divide-border">
        {actions.map((a) => (
          <li key={a.id} className="px-4 py-3 flex flex-col gap-1.5 text-sm">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <KindTag kind={a.kind} />
              <Person by={a.by} dir={dir} />
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">{shortWhen(a.at, now)}</span>
            </div>
            {showCard && (
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <CardCell a={a} />
                <OrderCell a={a} />
              </div>
            )}
            <div className="text-[13px]"><FromTo a={a} /></div>
          </li>
        ))}
      </ol>
    </>
  );
}
