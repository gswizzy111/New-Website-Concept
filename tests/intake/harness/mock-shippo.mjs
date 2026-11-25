// A fake Shippo for the harness, served by the mock (mock-supabase.mjs) under
// /__shippo. The app reaches it through shippo-fetch.mjs, a preload start.mjs
// gives `next dev` (NODE_OPTIONS --import): every request the app makes to
// https://api.goshippo.com goes to <mock>/__shippo instead (the Shippo SDK
// and the plain fetch calls alike), so no label is ever bought and nothing
// leaves the machine. No production code knows about it.
//
// OFF after every reset: it then answers like Shippo with the harness's
// placeholder token (401), as the real one did before, so scenarios that
// never meant to buy a label behave as they always did. A scenario turns it
// on with POST /__shippo/__config { "enabled": true } (and, optionally,
// "transactionDelayMs": 1500 to slow a purchase down, "failTransactions": n
// to refuse the next n purchases with an ERROR transaction).
//
//   POST /__shippo/shipments/        a shipment with 3 domestic rates (or 2 international)
//   POST /__shippo/transactions/     buys a known rate: a label URL and a tracking number
//   GET  /__shippo/rates/<id>        a rate (provider, service, price)
//   GET  /__shippo/labels/<id>.pdf   the label (a one-page 4x6 PDF)
//   GET  /__dump -> shippo: { enabled, shipments, transactions } (every call, for assertions)

const DOMESTIC = [
  { provider: "USPS", name: "Ground Advantage", token: "usps_ground_advantage", amount: "5.40", days: 5 },
  { provider: "USPS", name: "Priority Mail", token: "usps_priority", amount: "9.85", days: 2 },
  { provider: "UPS", name: "Ground", token: "ups_ground", amount: "12.10", days: 3 },
];
const INTERNATIONAL = [
  { provider: "USPS", name: "First-Class Package International Service", token: "usps_first_class_package_international_service", amount: "18.75", days: 10 },
  { provider: "USPS", name: "Priority Mail International", token: "usps_priority_mail_international", amount: "45.50", days: 7 },
];

const fresh = () => ({
  enabled: false,
  transactionDelayMs: 0,
  failTransactions: 0,
  seq: 0,
  shipments: [],
  transactions: [],
  rates: {},
});

/** The fake's state on this mock store (made on first use; mock-supabase.mjs clears it on every reset). */
export function shippoState(store) {
  if (!store.shippo) store.shippo = fresh();
  return store.shippo;
}

/** What /__dump shows. */
export function shippoDump(store) {
  const s = shippoState(store);
  return { enabled: s.enabled, shipments: s.shipments, transactions: s.transactions };
}

// A one-page 4x6 PDF that says "HARNESS LABEL" (opens in any viewer)
function labelPdf(text) {
  const stream = `BT /F1 28 Tf 36 300 Td (${text.replace(/[()\\]/g, "")}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 288 432] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Requests under /__shippo. `baseUrl` is the mock's own address (label links point back here). */
export async function handleShippo(store, req, res, url, body, baseUrl) {
  const s = shippoState(store);
  const p = url.pathname.replace(/^\/__shippo/, "").replace(/\/+$/, "") || "/";
  const send = (status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  let data = {};
  try { data = body.length ? JSON.parse(body.toString()) : {}; } catch { data = {}; }

  if (p === "/__config" && req.method === "POST") {
    for (const k of ["enabled", "transactionDelayMs", "failTransactions"]) if (k in data) s[k] = data[k];
    return send(200, { enabled: s.enabled, transactionDelayMs: s.transactionDelayMs, failTransactions: s.failTransactions });
  }
  if (!s.enabled) return send(401, { detail: "Invalid token." });

  const now = new Date().toISOString();
  if (p === "/shipments" && req.method === "POST") {
    s.seq += 1;
    const id = `shp_harness_${s.seq}`;
    const to = data.address_to ?? {};
    const international = !!(to.country && to.country !== "US");
    const rates = (international ? INTERNATIONAL : DOMESTIC).map((r, i) => {
      const rate = {
        object_id: `rate_harness_${s.seq}_${i + 1}`, object_owner: "harness@example.com", object_created: now,
        amount: r.amount, amount_local: r.amount, currency: "USD", currency_local: "USD", attributes: [],
        carrier_account: `ca_harness_${r.provider.toLowerCase()}`, estimated_days: r.days, provider: r.provider,
        servicelevel: { name: r.name, token: r.token }, shipment: id, messages: [], test: true,
      };
      s.rates[rate.object_id] = rate;
      return rate;
    });
    const parcel = (x) => ({
      mass_unit: x?.mass_unit ?? "lb", weight: String(x?.weight ?? "1"), distance_unit: x?.distance_unit ?? "in",
      height: String(x?.height ?? "1"), length: String(x?.length ?? "7"), width: String(x?.width ?? "5"),
    });
    const shipment = {
      object_id: id, object_owner: "harness@example.com", object_created: now, object_updated: now, status: "SUCCESS", metadata: "",
      address_from: { ...(data.address_from ?? {}), country: data.address_from?.country || "US" },
      address_to: { ...to, country: to.country || "US" },
      carrier_accounts: [], messages: [], parcels: (data.parcels ?? [{}]).map(parcel), rates, test: true,
    };
    s.shipments.push({ id, at: now, addressTo: to, customs: !!data.customs_declaration, rates: rates.map((r) => r.object_id) });
    return send(201, shipment);
  }

  if (p === "/transactions" && req.method === "POST") {
    if (s.transactionDelayMs > 0) await sleep(s.transactionDelayMs);
    s.seq += 1;
    const id = `txn_harness_${s.seq}`;
    const rate = s.rates[data.rate];
    const call = { id, at: now, rate: data.rate ?? null, metadata: data.metadata ?? null, extra: data.extra ?? null, labelFileType: data.label_file_type ?? null };
    if (s.failTransactions > 0 || !rate) {
      if (s.failTransactions > 0) s.failTransactions -= 1;
      s.transactions.push({ ...call, status: "ERROR" });
      return send(201, { object_id: id, status: "ERROR", object_state: "VALID", rate: data.rate ?? null, messages: [{ source: "harness", code: "", text: rate ? "The harness refused this purchase." : "Rate not found." }] });
    }
    const n = s.transactions.filter((t) => t.status === "SUCCESS").length + 1;
    const tracking = `9400111${String(202600000000000 + n).padStart(15, "0")}`;
    const tx = {
      object_id: id, object_state: "VALID", status: "SUCCESS", rate: data.rate, metadata: data.metadata ?? "",
      tracking_number: tracking,
      tracking_url_provider: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${tracking}`,
      label_url: `${baseUrl}/__shippo/labels/${id}.pdf`,
      messages: [], test: true,
    };
    s.transactions.push({ ...call, status: "SUCCESS", trackingNumber: tracking, labelUrl: tx.label_url, provider: rate.provider, service: rate.servicelevel.name, amount: rate.amount });
    return send(201, tx);
  }

  const rateMatch = /^\/rates\/([^/]+)$/.exec(p);
  if (rateMatch && req.method === "GET") {
    const rate = s.rates[decodeURIComponent(rateMatch[1])];
    return rate ? send(200, rate) : send(404, { detail: "Not found." });
  }

  const labelMatch = /^\/labels\/([^/]+)\.pdf$/.exec(p);
  if (labelMatch && (req.method === "GET" || req.method === "HEAD")) {
    const pdf = labelPdf(`HARNESS LABEL ${labelMatch[1]}`);
    res.writeHead(200, { "content-type": "application/pdf", "content-length": String(pdf.length) });
    return res.end(req.method === "HEAD" ? undefined : pdf);
  }

  return send(404, { detail: `harness Shippo: no ${req.method} ${p}` });
}
