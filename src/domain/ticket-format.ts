// Plain-text kitchen ticket layout for thermal printers (monospace).
// 58 mm paper ≈ 32 characters per line, 80 mm ≈ 48 (Font A, typical ESC/POS).

export interface TicketForPrint {
  reference: string;
  tableLabel: string | null;
  stationName: string;
  branchName: string;
  restaurantName: string;
  placedAt: string; // already formatted in the branch timezone
  customerName: string | null;
  customerNote: string | null;
  items: {
    quantity: number;
    name: string;
    variant: string | null;
    modifiers: string[];
    note: string | null;
    allergens: string | null;
  }[];
  reprint?: boolean;
}

export function charsPerLine(paperWidthMm: number): number {
  if (paperWidthMm <= 58) return 32;
  if (paperWidthMm <= 80) return 48;
  return 64;
}

function wrap(text: string, width: number, indent = ""): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const word = w.length > width - indent.length ? w.slice(0, width - indent.length) : w;
    if (!line) line = indent + word;
    else if ((line + " " + word).length <= width) line += " " + word;
    else {
      lines.push(line);
      line = indent + word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function center(text: string, width: number): string {
  const t = text.slice(0, width);
  const pad = Math.floor((width - t.length) / 2);
  return " ".repeat(pad) + t;
}

export function formatTicketText(t: TicketForPrint, paperWidthMm: number): string {
  const w = charsPerLine(paperWidthMm);
  const rule = "-".repeat(w);
  const out: string[] = [];
  if (t.reprint) out.push(center("*** REPRINT ***", w));
  out.push(center(t.restaurantName.toUpperCase(), w));
  out.push(center(`${t.stationName} · ${t.branchName}`, w));
  out.push(rule);
  out.push(
    `ORDER #${t.reference}`.padEnd(w - 12) + (t.tableLabel ? `TABLE ${t.tableLabel}` : "").padStart(12).slice(-12),
  );
  out.push(t.placedAt);
  if (t.customerName) out.push(...wrap(`Name: ${t.customerName}`, w));
  out.push(rule);
  for (const item of t.items) {
    const head = `${item.quantity} x ${item.name}${item.variant ? ` (${item.variant})` : ""}`;
    out.push(...wrap(head, w));
    for (const m of item.modifiers) out.push(...wrap(`+ ${m}`, w, "    "));
    if (item.note) out.push(...wrap(`NOTE: ${item.note}`, w, "    "));
    if (item.allergens) out.push(...wrap(`!! ALLERGY: ${item.allergens}`, w, "    "));
  }
  if (t.customerNote) {
    out.push(rule);
    out.push(...wrap(`ORDER NOTE: ${t.customerNote}`, w));
  }
  out.push(rule);
  out.push("");
  return out.join("\n");
}
