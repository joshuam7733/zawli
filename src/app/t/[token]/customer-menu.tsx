"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, ChevronRight, Minus, Plus, Receipt, ShoppingBag, X } from "lucide-react";
import type { PublicMenu, ResolvedTable } from "@/server/services/ordering";
import { computeOrderTotals } from "@/domain/pricing";
import { formatMoney } from "@/lib/format";
import { readableOn } from "@/lib/color";
import { cn } from "@/lib/cn";
import { Wordmark } from "@/components/brand";

type MenuItem = PublicMenu[number]["items"][number];

interface CartLine {
  key: string;
  menuItemId: string;
  variantId: string | null;
  optionIds: string[];
  quantity: number;
  note: string;
  name: string;
  variantName: string | null;
  optionNames: string[];
  unitMinor: number;
}

interface MyOrder {
  reference: string;
  publicToken: string;
  at: string;
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode): cart lives in memory only */
  }
}

export function CustomerMenu({
  token,
  info,
  menu,
  preview = false,
}: {
  token: string;
  info: ResolvedTable;
  menu: PublicMenu;
  preview?: boolean;
}) {
  const router = useRouter();
  const { tenant, settings } = info;
  const money = useCallback(
    (m: number) => formatMoney(m, tenant.currency, tenant.locale),
    [tenant.currency, tenant.locale],
  );
  const cartKey = `zawli-cart:${token}`;
  const ordersKey = `zawli-orders:${token}`;
  const idemKey = `zawli-idem:${token}`;

  const [cart, setCart] = useState<CartLine[]>([]);
  const [myOrders, setMyOrders] = useState<MyOrder[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState<MenuItem | null>(null);
  const [view, setView] = useState<"menu" | "cart">("menu");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    // Restore the cart from browser storage after hydration (the server can't see
    // localStorage, so reading it during render would cause a hydration mismatch).
    const ids = new Set(menu.flatMap((c) => c.items.map((i) => i.id)));
    const savedCart = preview ? [] : load<CartLine[]>(cartKey, []).filter((l) => ids.has(l.menuItemId)); // drop items no longer on the menu
    const savedOrders = preview
      ? []
      : load<MyOrder[]>(ordersKey, []).filter((o) => Date.now() - new Date(o.at).getTime() < 12 * 3600_000);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from an external store (localStorage) on mount
    setCart(savedCart);
    setMyOrders(savedOrders);
    setHydrated(true);
  }, [cartKey, ordersKey, menu, preview]);

  useEffect(() => {
    if (hydrated && !preview) save(cartKey, cart);
  }, [cart, cartKey, hydrated, preview]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const count = cart.reduce((a, l) => a + l.quantity, 0);
  const totals = useMemo(
    () =>
      computeOrderTotals(
        cart.map((l) => l.unitMinor * l.quantity),
        settings,
      ),
    [cart, settings],
  );
  const headerText = readableOn(tenant.brandPrimary);

  function addLine(line: Omit<CartLine, "key">) {
    setCart((c) => {
      const same = c.find(
        (l) =>
          l.menuItemId === line.menuItemId &&
          l.variantId === line.variantId &&
          l.note === line.note &&
          l.optionIds.join() === line.optionIds.join(),
      );
      if (same)
        return c.map((l) =>
          l === same ? { ...l, quantity: Math.min(settings.maxItemQuantity, l.quantity + line.quantity) } : l,
        );
      return [...c, { ...line, key: `${Date.now()}-${Math.random().toString(36).slice(2)}` }];
    });
    setToast(`${line.quantity} × ${line.name} added`);
  }

  async function callStaff(type: "ASSISTANCE" | "BILL") {
    if (preview) return setToast("Preview: requests are not sent.");
    try {
      const res = await fetch("/api/public/service-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, type }),
      });
      const body = await res.json();
      if (!res.ok) return setToast(body?.error?.message ?? "Couldn't reach the staff. Please wave to a waiter.");
      setToast(
        type === "BILL"
          ? body.duplicate
            ? "Your bill is already on its way."
            : "A waiter will bring your bill."
          : body.duplicate
            ? "A waiter has already been called."
            : "A waiter is on the way.",
      );
    } catch {
      setToast("No connection. Please wave to a waiter.");
    }
  }

  return (
    <div className="bg-ivory-50 min-h-dvh pb-28">
      <header style={{ background: tenant.brandPrimary, color: headerText }} className="px-5 pt-6 pb-5">
        <div className="mx-auto flex max-w-2xl items-start justify-between gap-4">
          <div className="min-w-0">
            {tenant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tenant.logoUrl} alt={tenant.name} className="mb-2 h-10 w-auto" />
            ) : null}
            <h1 className="font-display truncate text-2xl font-semibold tracking-tight">{tenant.name}</h1>
            <p className="text-sm opacity-80">
              {info.branch.name} · Table <strong>{info.table.label}</strong>
            </p>
          </div>
          {preview ? (
            <span className="text-charcoal-900 rounded bg-white/90 px-2 py-1 text-xs font-semibold">Preview</span>
          ) : null}
          {tenant.isDemo ? (
            <span className="text-charcoal-900 rounded bg-lime-300 px-2 py-1 text-xs font-semibold">Demo</span>
          ) : null}
        </div>
        {(settings.enableWaiterCalls || settings.enableBillRequests) && (
          <div className="mx-auto mt-4 flex max-w-2xl gap-2">
            {settings.enableWaiterCalls ? (
              <button
                onClick={() => callStaff("ASSISTANCE")}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-white/15 px-3 text-sm font-medium ring-1 ring-white/25 backdrop-blur-sm hover:bg-white/25"
                style={{ color: headerText }}
              >
                <Bell className="size-4" aria-hidden /> Call waiter
              </button>
            ) : null}
            {settings.enableBillRequests ? (
              <button
                onClick={() => callStaff("BILL")}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-white/15 px-3 text-sm font-medium ring-1 ring-white/25 hover:bg-white/25"
                style={{ color: headerText }}
              >
                <Receipt className="size-4" aria-hidden /> Request bill
              </button>
            ) : null}
          </div>
        )}
      </header>

      {myOrders.length > 0 && view === "menu" ? (
        <div className="mx-auto max-w-2xl px-4 pt-4">
          {myOrders
            .slice(-3)
            .reverse()
            .map((o) => (
              <a
                key={o.publicToken}
                href={`/t/${token}/orders/${o.publicToken}`}
                className="border-forest-100 bg-forest-50 mb-2 flex items-center justify-between rounded-lg border px-4 py-3 text-sm"
              >
                <span>
                  Your order <strong className="font-mono">#{o.reference}</strong> — track progress
                </span>
                <ChevronRight className="text-forest-700 size-4" aria-hidden />
              </a>
            ))}
        </div>
      ) : null}

      {view === "menu" ? (
        <>
          {menu.length > 1 ? (
            <nav
              aria-label="Menu categories"
              className="border-ivory-200 bg-ivory-50/95 sticky top-0 z-10 border-b backdrop-blur"
            >
              <ul className="mx-auto flex max-w-2xl [scrollbar-width:none] gap-2 overflow-x-auto px-4 py-3">
                {menu.map((c) => (
                  <li key={c.id} className="shrink-0">
                    <a
                      href={`#cat-${c.id}`}
                      className="border-ivory-300 text-charcoal-800 hover:border-forest-600 block rounded-full border bg-white px-3.5 py-1.5 text-sm font-medium whitespace-nowrap"
                    >
                      {c.name}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          <main className="mx-auto max-w-2xl px-4">
            {menu.length === 0 ? (
              <p className="text-charcoal-500 py-16 text-center">
                The menu is being updated. Please ask a member of staff.
              </p>
            ) : null}
            {menu.map((c) => (
              <section key={c.id} id={`cat-${c.id}`} className="scroll-mt-16 pt-6">
                <h2 className="font-display text-xl font-semibold">{c.name}</h2>
                {c.description ? <p className="text-charcoal-500 text-sm">{c.description}</p> : null}
                <ul className="mt-3 flex flex-col gap-3">
                  {c.items.map((item) => {
                    const from = item.variants.length
                      ? Math.min(...item.variants.map((v) => v.priceMinor))
                      : item.basePriceMinor;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          disabled={!item.orderable}
                          onClick={() => setOpen(item)}
                          className="border-ivory-200 shadow-card enabled:hover:border-forest-600/40 flex w-full items-stretch gap-3 rounded-lg border bg-white p-3 text-left transition-colors disabled:opacity-60"
                        >
                          <div className="flex min-w-0 flex-1 flex-col">
                            <span className="text-charcoal-950 font-semibold">{item.name}</span>
                            {item.description ? (
                              <span className="text-charcoal-600 mt-0.5 line-clamp-2 text-sm">{item.description}</span>
                            ) : null}
                            {item.allergens ? (
                              <span className="text-warning-700 mt-1 text-xs">Contains: {item.allergens}</span>
                            ) : null}
                            <span className="tabular text-forest-800 mt-auto pt-2 text-sm font-semibold">
                              {item.orderable ? `${item.variants.length > 1 ? "from " : ""}${money(from)}` : "Sold out"}
                            </span>
                          </div>
                          {item.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.imageUrl}
                              alt=""
                              className="size-24 shrink-0 rounded-md object-cover"
                              loading="lazy"
                            />
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </main>
        </>
      ) : (
        <CartView
          token={token}
          cart={cart}
          setCart={setCart}
          totals={totals}
          settings={settings}
          money={money}
          preview={preview}
          idemKey={idemKey}
          onBack={() => setView("menu")}
          onPlaced={(o) => {
            const next = [...myOrders, o];
            setMyOrders(next);
            save(ordersKey, next);
            setCart([]);
            save(cartKey, []);
            router.push(`/t/${token}/orders/${o.publicToken}`);
          }}
          onMenuChanged={() => router.refresh()}
        />
      )}

      {view === "menu" && count > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-20 p-3">
          <button
            onClick={() => setView("cart")}
            className="bg-forest-900 text-ivory-50 shadow-pop mx-auto flex h-14 w-full max-w-2xl items-center justify-between rounded-lg px-5"
          >
            <span className="flex items-center gap-2 font-medium">
              <ShoppingBag className="size-5 text-lime-400" aria-hidden />
              View order · {count} item{count === 1 ? "" : "s"}
            </span>
            <span className="tabular font-semibold">{money(totals.totalMinor)}</span>
          </button>
        </div>
      ) : null}

      {open ? (
        <ItemSheet
          item={open}
          maxQty={settings.maxItemQuantity}
          allowNotes={settings.allowItemNotes}
          money={money}
          onClose={() => setOpen(null)}
          onAdd={(l) => {
            addLine(l);
            setOpen(null);
          }}
        />
      ) : null}

      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-4">
        {toast ? (
          <p className="bg-charcoal-900 text-ivory-50 shadow-pop rounded-md px-4 py-2.5 text-sm">{toast}</p>
        ) : null}
      </div>
      <footer className="text-charcoal-400 mx-auto mt-12 max-w-2xl px-4 text-center text-xs">
        {settings.payFirst ? "Pay by mobile money" : "Pay at the restaurant"} · Ordering by{" "}
        <Wordmark className="text-xs" />
      </footer>
    </div>
  );
}

function ItemSheet({
  item,
  maxQty,
  allowNotes,
  money,
  onClose,
  onAdd,
}: {
  item: MenuItem;
  maxQty: number;
  allowNotes: boolean;
  money: (m: number) => string;
  onClose: () => void;
  onAdd: (l: Omit<CartLine, "key">) => void;
}) {
  const availableVariants = item.variants.filter((v) => v.isAvailable);
  const [variantId, setVariantId] = useState<string | null>(availableVariants[0]?.id ?? null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const variant = item.variants.find((v) => v.id === variantId) ?? null;
  const base = variant ? variant.priceMinor : item.basePriceMinor;
  const chosen = item.groups.flatMap((g) => g.options.filter((o) => selected.has(o.id)));
  const unit = base + chosen.reduce((a, o) => a + o.priceDeltaMinor, 0);
  const groupErrors = item.groups
    .map((g) => {
      const n = g.options.filter((o) => selected.has(o.id)).length;
      if (n < g.minSelect)
        return { id: g.id, msg: g.minSelect === 1 ? "Choose one" : `Choose at least ${g.minSelect}` };
      if (n > g.maxSelect) return { id: g.id, msg: `Choose at most ${g.maxSelect}` };
      return null;
    })
    .filter(Boolean) as { id: string; msg: string }[];
  const missingVariant = item.variants.length > 0 && !variant;

  function toggle(groupId: string, optionId: string) {
    const g = item.groups.find((x) => x.id === groupId)!;
    setSelected((s) => {
      const next = new Set(s);
      if (g.maxSelect === 1) {
        for (const o of g.options) next.delete(o.id);
        if (!s.has(optionId)) next.add(optionId);
        else if (g.minSelect === 0) next.delete(optionId);
        else next.add(optionId);
      } else if (next.has(optionId)) next.delete(optionId);
      else if (g.options.filter((o) => next.has(o.id)).length < g.maxSelect) next.add(optionId);
      return next;
    });
  }

  return (
    <div
      className="bg-charcoal-950/50 fixed inset-0 z-30 flex items-end justify-center sm:items-center"
      onClick={onClose}
    >
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-sheet-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-xl bg-white outline-none sm:rounded-xl"
      >
        <div className="overflow-y-auto">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt="" className="aspect-[16/9] w-full object-cover" />
          ) : null}
          <div className="p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 id="item-sheet-title" className="font-display text-xl font-semibold">
                {item.name}
              </h2>
              <button
                onClick={onClose}
                className="text-charcoal-500 hover:bg-ivory-100 -mt-1 -mr-2 rounded-md p-2"
                aria-label="Close"
              >
                <X className="size-5" />
              </button>
            </div>
            {item.description ? <p className="text-charcoal-600 mt-1 text-sm">{item.description}</p> : null}
            {item.allergens ? (
              <p className="bg-warning-50 text-warning-700 mt-2 rounded-md px-3 py-2 text-sm">
                Contains: {item.allergens}
              </p>
            ) : null}

            {item.variants.length > 0 ? (
              <fieldset className="mt-5">
                <legend className="mb-2 flex w-full items-center justify-between text-sm font-semibold">
                  Choose a size{" "}
                  <span className="bg-ivory-100 text-charcoal-600 rounded px-1.5 py-0.5 text-xs font-medium">
                    Required
                  </span>
                </legend>
                <div className="divide-ivory-200 border-ivory-200 flex flex-col divide-y rounded-lg border">
                  {item.variants.map((v) => (
                    <label
                      key={v.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 px-4 py-3",
                        !v.isAvailable && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <input
                        type="radio"
                        name="variant"
                        checked={variantId === v.id}
                        disabled={!v.isAvailable}
                        onChange={() => setVariantId(v.id)}
                        className="accent-forest-700 size-4"
                      />
                      <span className="flex-1 text-sm">{v.name}</span>
                      <span className="tabular text-charcoal-600 text-sm">
                        {v.isAvailable ? money(v.priceMinor) : "Sold out"}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            {item.groups.map((g) => {
              const err = showErrors ? groupErrors.find((e) => e.id === g.id) : null;
              return (
                <fieldset key={g.id} className="mt-5" aria-describedby={err ? `err-${g.id}` : undefined}>
                  <legend className="mb-2 flex w-full items-center justify-between text-sm font-semibold">
                    {g.name}
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-xs font-medium",
                        g.minSelect > 0 ? "bg-ivory-100 text-charcoal-600" : "text-charcoal-500",
                      )}
                    >
                      {g.minSelect > 0 ? "Required" : g.maxSelect > 1 ? `Up to ${g.maxSelect}` : "Optional"}
                    </span>
                  </legend>
                  {err ? (
                    <p id={`err-${g.id}`} className="text-danger-700 mb-2 text-sm">
                      {err.msg}
                    </p>
                  ) : null}
                  <div
                    className={cn(
                      "divide-ivory-200 flex flex-col divide-y rounded-lg border",
                      err ? "border-danger-600" : "border-ivory-200",
                    )}
                  >
                    {g.options.map((o) => (
                      <label
                        key={o.id}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 px-4 py-3",
                          !o.isAvailable && "cursor-not-allowed opacity-50",
                        )}
                      >
                        <input
                          type={g.maxSelect === 1 ? "radio" : "checkbox"}
                          name={`group-${g.id}`}
                          checked={selected.has(o.id)}
                          disabled={!o.isAvailable}
                          onChange={() => toggle(g.id, o.id)}
                          onClick={() =>
                            g.maxSelect === 1 && selected.has(o.id) && g.minSelect === 0 && toggle(g.id, o.id)
                          }
                          className="accent-forest-700 size-4"
                        />
                        <span className="flex-1 text-sm">{o.name}</span>
                        <span className="tabular text-charcoal-600 text-sm">
                          {!o.isAvailable ? "Sold out" : o.priceDeltaMinor ? `+${money(o.priceDeltaMinor)}` : ""}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}

            {allowNotes ? (
              <label className="mt-5 block">
                <span className="text-sm font-semibold">Note for the kitchen</span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={280}
                  rows={2}
                  placeholder="e.g. no onions, well done"
                  className="border-ivory-300 focus:border-forest-600 focus:ring-forest-600/20 mt-2 w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
                />
              </label>
            ) : null}
          </div>
        </div>
        <div className="border-ivory-200 flex items-center gap-3 border-t p-4">
          <div className="border-ivory-300 flex items-center rounded-md border">
            <button
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              className="text-charcoal-700 grid size-11 place-items-center disabled:opacity-40"
              disabled={qty <= 1}
              aria-label="Decrease quantity"
            >
              <Minus className="size-4" />
            </button>
            <span className="tabular w-8 text-center font-semibold" aria-live="polite">
              {qty}
            </span>
            <button
              onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
              className="text-charcoal-700 grid size-11 place-items-center disabled:opacity-40"
              disabled={qty >= maxQty}
              aria-label="Increase quantity"
            >
              <Plus className="size-4" />
            </button>
          </div>
          <button
            onClick={() => {
              if (groupErrors.length || missingVariant) return setShowErrors(true);
              const optionIds = item.groups.flatMap((g) =>
                g.options.filter((o) => selected.has(o.id)).map((o) => o.id),
              );
              onAdd({
                menuItemId: item.id,
                variantId: variant?.id ?? null,
                optionIds,
                quantity: qty,
                note: note.trim(),
                name: item.name,
                variantName: variant?.name ?? null,
                optionNames: chosen.map((o) => o.name),
                unitMinor: unit,
              });
            }}
            className="bg-forest-800 text-ivory-50 hover:bg-forest-700 flex h-12 flex-1 items-center justify-between gap-2 rounded-md px-4 font-medium whitespace-nowrap"
          >
            <span>Add to order</span>
            <span className="tabular">{money(unit * qty)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function CartView({
  token,
  cart,
  setCart,
  totals,
  settings,
  money,
  preview,
  idemKey,
  onBack,
  onPlaced,
  onMenuChanged,
}: {
  token: string;
  cart: CartLine[];
  setCart: (fn: (c: CartLine[]) => CartLine[]) => void;
  totals: ReturnType<typeof computeOrderTotals>;
  settings: ResolvedTable["settings"];
  money: (m: number) => string;
  preview: boolean;
  idemKey: string;
  onBack: () => void;
  onPlaced: (o: MyOrder) => void;
  onMenuChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  async function submit() {
    if (preview) return setErrors(["Preview mode: orders are not sent."]);
    setSubmitting(true);
    setErrors([]);
    // Reuse the same key until the server confirms: retries after a dropped
    // connection return the original order instead of creating a duplicate.
    let key = sessionStorage.getItem(idemKey);
    if (!key) {
      key = crypto.randomUUID();
      sessionStorage.setItem(idemKey, key);
    }
    try {
      const res = await fetch("/api/public/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          idempotencyKey: key,
          customerName: name.trim() || null,
          customerNote: note.trim() || null,
          lines: cart.map((l) => ({
            menuItemId: l.menuItemId,
            variantId: l.variantId,
            optionIds: l.optionIds,
            quantity: l.quantity,
            note: l.note || null,
          })),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        // Validation failures mean this cart will never succeed as-is: new key next time.
        if (res.status === 422 || res.status === 404) sessionStorage.removeItem(idemKey);
        const list: string[] = body?.error?.details?.errors ?? [
          body?.error?.message ?? "We couldn't send your order. Please try again.",
        ];
        setErrors(list);
        if (res.status === 422) onMenuChanged();
        return;
      }
      sessionStorage.removeItem(idemKey);
      onPlaced({ reference: body.reference, publicToken: body.publicToken, at: new Date().toISOString() });
    } catch {
      setErrors([
        "No connection. Your order was not confirmed — check your signal and tap Send again (you won't be charged twice).",
      ]);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pt-6">
      <button onClick={onBack} className="text-forest-700 mb-4 text-sm font-medium hover:underline">
        ← Back to menu
      </button>
      <h2 className="font-display text-2xl font-semibold">Your order</h2>
      {cart.length === 0 ? (
        <p className="text-charcoal-500 mt-6">Your order is empty.</p>
      ) : (
        <>
          <ul className="divide-ivory-200 border-ivory-200 mt-4 divide-y rounded-lg border bg-white">
            {cart.map((l) => (
              <li key={l.key} className="flex gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {l.name}
                    {l.variantName ? <span className="text-charcoal-500"> · {l.variantName}</span> : null}
                  </p>
                  {l.optionNames.length ? (
                    <p className="text-charcoal-600 text-sm">{l.optionNames.join(", ")}</p>
                  ) : null}
                  {l.note ? <p className="text-charcoal-500 text-sm italic">“{l.note}”</p> : null}
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      aria-label={`One less ${l.name}`}
                      onClick={() =>
                        setCart((c) =>
                          c.flatMap((x) =>
                            x.key !== l.key ? [x] : x.quantity > 1 ? [{ ...x, quantity: x.quantity - 1 }] : [],
                          ),
                        )
                      }
                      className="border-ivory-300 grid size-9 place-items-center rounded-md border"
                    >
                      <Minus className="size-4" />
                    </button>
                    <span className="tabular w-6 text-center font-semibold">{l.quantity}</span>
                    <button
                      aria-label={`One more ${l.name}`}
                      disabled={l.quantity >= settings.maxItemQuantity}
                      onClick={() =>
                        setCart((c) => c.map((x) => (x.key === l.key ? { ...x, quantity: x.quantity + 1 } : x)))
                      }
                      className="border-ivory-300 grid size-9 place-items-center rounded-md border disabled:opacity-40"
                    >
                      <Plus className="size-4" />
                    </button>
                  </div>
                </div>
                <span className="tabular font-medium">{money(l.unitMinor * l.quantity)}</span>
              </li>
            ))}
          </ul>

          <div className="mt-4 grid gap-3">
            <label className="block">
              <span className="text-sm font-medium">Your name (optional)</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                autoComplete="given-name"
                className="border-ivory-300 focus:border-forest-600 focus:ring-forest-600/20 mt-1.5 h-11 w-full rounded-md border bg-white px-3 text-sm focus:ring-2 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Note for the order (optional)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
                rows={2}
                placeholder="Allergies, timing, celebrations…"
                className="border-ivory-300 focus:border-forest-600 focus:ring-forest-600/20 mt-1.5 w-full rounded-md border bg-white px-3 py-2 text-sm focus:ring-2 focus:outline-none"
              />
            </label>
          </div>

          <dl className="mt-5 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-charcoal-600">Subtotal</dt>
              <dd className="tabular">{money(totals.subtotalMinor)}</dd>
            </div>
            {totals.serviceChargeMinor > 0 ? (
              <div className="flex justify-between">
                <dt className="text-charcoal-600">
                  {settings.serviceChargeLabel} ({settings.serviceChargeBps / 100}%)
                </dt>
                <dd className="tabular">{money(totals.serviceChargeMinor)}</dd>
              </div>
            ) : null}
            {totals.taxMinor > 0 ? (
              <div className="flex justify-between">
                <dt className="text-charcoal-600">
                  {settings.taxLabel} ({settings.taxRateBps / 100}%)
                </dt>
                <dd className="tabular">{money(totals.taxMinor)}</dd>
              </div>
            ) : null}
            <div className="border-ivory-300 flex justify-between border-t pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular">{money(totals.totalMinor)}</dd>
            </div>
            {totals.taxIncludedMinor > 0 ? (
              <p className="text-charcoal-500 text-xs">
                Includes {settings.taxLabel} of {money(totals.taxIncludedMinor)}
              </p>
            ) : null}
          </dl>

          {errors.length ? (
            <div
              role="alert"
              className="bg-danger-50 text-danger-700 ring-danger-600/20 mt-4 rounded-md px-4 py-3 text-sm ring-1"
            >
              {errors.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </div>
          ) : null}

          {settings.payFirst ? (
            <p className="text-charcoal-600 mt-4 text-sm">
              Next, pay with{" "}
              {settings.mobileMoneyProviders.map((p) => (p === "MTN_MOMO" ? "MTN MoMo" : "Airtel Money")).join(" or ")}.
              Your order goes to the kitchen as soon as the payment is confirmed.
            </p>
          ) : (
            <p className="text-charcoal-600 mt-4 text-sm">
              You pay at the restaurant — cash, mobile money or card — when you&apos;re ready.
            </p>
          )}
          <button
            onClick={submit}
            disabled={submitting}
            className="text-charcoal-950 mt-4 flex h-14 w-full items-center justify-center rounded-lg bg-lime-400 text-base font-semibold hover:bg-lime-300 disabled:opacity-60"
          >
            {submitting
              ? settings.payFirst
                ? "Preparing payment…"
                : "Sending to the kitchen…"
              : settings.payFirst
                ? `Continue to payment · ${money(totals.totalMinor)}`
                : `Send order · ${money(totals.totalMinor)}`}
          </button>
        </>
      )}
    </main>
  );
}
