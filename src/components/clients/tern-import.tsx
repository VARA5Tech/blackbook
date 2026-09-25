"use client";

import {
  AlertTriangle,
  CalendarHeart,
  CheckCircle2,
  ChevronRight,
  CloudDownload,
  FileText,
  Heart,
  Info,
  Loader2,
  Luggage,
  Phone,
  Search,
  ShieldCheck,
  UserRound,
  UserSearch,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import {
  applyTernImportAction,
  finishTernPopulateAction,
  populateTripFromTernAction,
  previewTernAgainstAction,
  previewTernTripAction,
  searchTernAction,
} from "@/actions/client-actions";
import { TripDetail, tripDates, type TripDetailData } from "@/components/clients/trip-detail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { KIND_LABELS, type PreferenceKind } from "@/domain/preferences";
import { TRAVEL_DOCUMENT_LABELS, TRIP_FLAG_LABELS, TRIP_STATUS_LABELS } from "@/domain/trips";
import type { previewTernClient } from "@/services/tern-service";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Bringing a client over from Tern, as a page rather than a popup.
 *
 * Laid out the way Tern lays out a contact — the person on the left, their
 * record in sections down the page — so somebody who knows Tern reads it at
 * once. Nothing is written until the Import button at the foot, which says in
 * one line exactly what it will do.
 */

type Preview = Extract<Awaited<ReturnType<typeof previewTernClient>>, { ok: true }>;

type Choices = {
  fields: Record<string, "take" | "keep">;
  phones: Set<string>;
  preferences: Set<string>;
  milestones: Set<string>;
  documents: Set<string>;
  trips: Set<string>;
};

/** What the page starts with: everything new ticked, everything of the desk's kept. */
function defaultChoices(plan: Preview): Choices {
  return {
    fields: Object.fromEntries(plan.fields.map((f) => [f.field, f.state === "new" ? "take" : "keep"])),
    phones: new Set(),
    preferences: new Set(plan.preferences.filter((p) => !p.already).map((p) => p.key)),
    milestones: new Set(plan.milestones.filter((m) => !m.already).map((m) => m.type)),
    documents: new Set(plan.travelDocuments.canSeal ? plan.travelDocuments.items.map((d) => d.key) : []),
    // A trip whose name looks like a test starts unticked; the rest come across.
    trips: new Set(plan.trips.filter((t) => t.flags.length === 0).map((t) => t.ternId)),
  };
}

function toggle(set: Set<string>, key: string, on: boolean) {
  const next = new Set(set);
  if (on) next.add(key);
  else next.delete(key);
  return next;
}

const MILESTONE_LABELS: Record<string, string> = { birthday: "Birthday", wedding_anniversary: "Wedding anniversary" };

/* ------------------------------------------------------------ search */

type Hit = {
  ternId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  nextTrip: string | null;
  owner: string | null;
  linkedTo: { id: string; ref: string } | null;
};

/**
 * Find the person in Tern. Choosing one opens the import page; a contact
 * already brought over opens its client instead.
 */
export function TernSearchDialog({ customerId, label = "Import from Tern" }: { customerId?: string; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [going, setGoing] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();

  function search(event: React.FormEvent) {
    event.preventDefault();
    startSearch(async () => {
      const result = await searchTernAction(query);
      if (!result.ok) return void setMessage(result.error);
      if (!result.data.ok) return void setMessage(result.data.message);
      setMessage(result.data.hits.length ? null : "Nobody in Tern matches that.");
      setHits(result.data.hits);
    });
  }

  function openImport(hit: Hit) {
    setGoing(hit.ternId);
    const params = customerId ? `?customerId=${customerId}` : "";
    router.push(`/clients/import/tern/${hit.ternId}${params}`);
  }

  const name = (h: Hit) => [h.firstName, h.lastName].filter(Boolean).join(" ") || "Unnamed contact";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <CloudDownload />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            Find the client in Tern. The next page shows everything Tern holds, beside what Blackbook has, and nothing is written until you choose.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={search} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or email in Tern" className="pl-8" />
          </div>
          <Button type="submit" disabled={searching || query.trim().length < 2}>
            {searching ? <Loader2 className="animate-spin" /> : null}
            Search
          </Button>
        </form>
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        {hits && hits.length > 0 ? (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border">
            {hits.map((hit) => (
              <li key={hit.ternId} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{name(hit)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[hit.email, hit.owner ? `with ${hit.owner} in Tern` : null, hit.nextTrip ? `next trip ${hit.nextTrip}` : null].filter(Boolean).join(" · ") || "No details in the list"}
                  </p>
                </div>
                {hit.linkedTo && hit.linkedTo.id !== customerId ? (
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/clients/${hit.linkedTo.id}`}>Open {hit.linkedTo.ref}</Link>
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => openImport(hit)} disabled={going !== null}>
                    {going === hit.ternId ? <Loader2 className="animate-spin" /> : null}
                    {hit.linkedTo ? "Review again" : "Review"}
                    <ChevronRight />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------ the page */

type Stage =
  | { step: "review" }
  | { step: "running"; label: string; done: number; total: number }
  | { step: "finished"; customerId: string; created: boolean; trips: number; failedTrips: number; skipped: string[]; travelDocuments: number };

const SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "who", label: "Who this is", icon: UserSearch },
  { id: "details", label: "Details", icon: UserRound },
  { id: "numbers", label: "Phone numbers", icon: Phone },
  { id: "preferences", label: "Preferences", icon: Heart },
  { id: "dates", label: "Dates", icon: CalendarHeart },
  { id: "documents", label: "Travel documents", icon: ShieldCheck },
  { id: "trips", label: "Trips", icon: Luggage },
  { id: "files", label: "Files", icon: FileText },
];

export function TernImportPage({ initial }: { initial: Preview }) {
  const router = useRouter();
  const [plan, setPlan] = useState(initial);
  const [choices, setChoices] = useState<Choices>(() => defaultChoices(initial));
  const [stage, setStage] = useState<Stage>({ step: "review" });
  const [retargeting, setRetargeting] = useState(false);
  const [tripView, setTripView] = useState<TripView | null>(null);

  /** Opens a trip beside the page. Usually instant: the bridge read it while the page was loading. */
  async function openTrip(ternId: string) {
    setTripView({ ternId, trip: null, error: null });
    const result = await previewTernTripAction({ ternId });
    setTripView((current) => {
      if (current?.ternId !== ternId) return current; // somebody opened another meanwhile
      if (!result.ok) return { ternId, trip: null, error: result.error };
      if (!result.data.ok) return { ternId, trip: null, error: result.data.message };
      return { ternId, trip: result.data as TripDetailData & { already: unknown }, error: null };
    });
  }

  const set = (patch: Partial<Choices>) => setChoices((c) => ({ ...c, ...patch }));

  /** The desk picked who this is; compare against that client instead. */
  async function retarget(target: string) {
    if (target === "new") {
      const fresh: Preview = {
        ...plan,
        target: { mode: "new" },
        fields: plan.fields.map((f) => ({ ...f, current: null, state: "new" as const })),
      };
      setPlan(fresh);
      return setChoices(defaultChoices(fresh));
    }
    setRetargeting(true);
    const result = await previewTernAgainstAction({ ternId: plan.ternId, customerId: target });
    setRetargeting(false);
    if (!result.ok) return void toast.error(result.error);
    if (!result.data.ok) return void toast.error(result.data.message);
    const next = { ...(result.data as Preview), candidates: plan.candidates };
    setPlan(next);
    setChoices(defaultChoices(next));
  }

  async function run() {
    setStage({ step: "running", label: "Bringing the client over…", done: 0, total: 1 });
    const applied = await applyTernImportAction({
      ternId: plan.ternId,
      target: plan.target.mode === "existing" ? { mode: "existing", customerId: plan.target.customerId } : { mode: "new" },
      fields: choices.fields,
      phones: [...choices.phones],
      preferences: [...choices.preferences],
      milestones: [...choices.milestones] as ("birthday" | "wedding_anniversary")[],
      travelDocuments: [...choices.documents],
    });
    if (!applied.ok) {
      setStage({ step: "review" });
      return void toast.error(applied.error);
    }

    // Three at a time: the bridge has most of them read already, from while
    // this page was being looked at.
    const tripIds = plan.trips.filter((t) => choices.trips.has(t.ternId)).map((t) => t.ternId);
    let done = 0;
    let failedTrips = 0;
    const queue = [...tripIds];
    const lane = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        const trip = await populateTripFromTernAction({ ternId: id, customerId: applied.data.customerId });
        if (!trip.ok || !trip.data.ok) failedTrips++;
        done++;
        setStage({ step: "running", label: `Bringing over trips — ${done} of ${tripIds.length}`, done, total: tripIds.length });
      }
    };
    setStage({ step: "running", label: `Bringing over trips — 0 of ${tripIds.length}`, done: 0, total: tripIds.length });
    await Promise.all([lane(), lane(), lane()]);
    await finishTernPopulateAction(applied.data.customerId);

    setStage({
      step: "finished",
      customerId: applied.data.customerId,
      created: applied.data.created,
      trips: tripIds.length - failedTrips,
      failedTrips,
      skipped: applied.data.skipped,
      travelDocuments: applied.data.travelDocuments,
    });
    router.refresh();
  }

  const decidable = plan.fields.filter((f) => f.state !== "same");
  const same = plan.fields.filter((f) => f.state === "same");
  const differing = plan.fields.filter((f) => f.state === "differs");
  const counts: Record<string, number> = {
    details: decidable.length,
    numbers: plan.phones.length,
    preferences: plan.preferences.length,
    dates: plan.milestones.length,
    documents: plan.travelDocuments.items.length,
    trips: plan.trips.length,
    files: plan.files.length,
  };

  if (stage.step === "finished") {
    return (
      <div className="mx-auto max-w-xl space-y-4 py-10">
        <CheckCircle2 className="size-10 text-[color:var(--polarity-prefer)]" />
        <h1 className="font-display text-2xl">{stage.created ? "Client added" : "Client updated"}</h1>
        <p className="text-sm text-muted-foreground">
          {plan.name} came across with {stage.trips} {stage.trips === 1 ? "trip" : "trips"}
          {stage.travelDocuments ? ` and ${stage.travelDocuments} travel ${stage.travelDocuments === 1 ? "document" : "documents"}` : ""}.
        </p>
        {stage.failedTrips > 0 ? (
          <p className="text-sm text-destructive">{stage.failedTrips} {stage.failedTrips === 1 ? "trip" : "trips"} could not be read. Review again to retry them.</p>
        ) : null}
        {stage.skipped.length > 0 ? (
          <div className="rounded-md border border-border p-3 text-sm">
            <p className="font-medium">Not added</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">{stage.skipped.map((s) => <li key={s}>{s}</li>)}</ul>
          </div>
        ) : null}
        <Button asChild>
          <Link href={`/clients/${stage.customerId}`}>Open the client</Link>
        </Button>
      </div>
    );
  }

  const busy = stage.step === "running";

  return (
    <div className="pb-28">
      {/* The person, as Tern shows a contact: name first, where it is going below. */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
        <div className="flex items-center gap-4">
          <span className="flex size-14 items-center justify-center rounded-full bg-muted font-display text-xl">
            {plan.name.replace(/^(Mr|Mrs|Ms|Dr|Miss|Mx)\.?\s+/i, "").split(/\s+/).map((w) => w[0]).slice(0, 2).join("")}
          </span>
          <div>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">From Tern</p>
            <h1 className="font-display text-3xl leading-tight">{plan.name}</h1>
            <p className="text-sm text-muted-foreground">
              {plan.target.mode === "existing"
                ? <>Into <span className="font-medium text-foreground">{plan.target.name}</span> <span className="tabular">{plan.target.ref}</span></>
                : "As a new client"}
              {" · "}Nothing is written until you import.
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav className="hidden lg:block">
          <ul className="sticky top-6 space-y-0.5">
            {SECTIONS.filter((s) => s.id === "who" ? plan.candidates.length > 0 : (counts[s.id] ?? 0) > 0).map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                  <s.icon className="size-4 shrink-0" />
                  <span className="flex-1">{s.label}</span>
                  {counts[s.id] ? <span className="tabular text-xs">{counts[s.id]}</span> : null}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6">
          {plan.candidates.length > 0 ? (
            <Panel id="who" title="Is this somebody already in Blackbook?" icon={UserSearch}>
              <div className="divide-y divide-border">
                <Tick checked={plan.target.mode === "new"} onChange={() => retarget("new")} disabled={busy || retargeting}>
                  <span className="font-medium">No — add as a new client</span>
                </Tick>
                {plan.candidates.map((c) => (
                  <Tick key={c.id} checked={plan.target.mode === "existing" && plan.target.customerId === c.id} onChange={() => retarget(c.id)} disabled={busy || retargeting}>
                    <span className="font-medium">Yes — merge into {c.name}</span>{" "}
                    <span className="tabular text-muted-foreground">{c.ref} · {c.reason}</span>
                  </Tick>
                ))}
              </div>
              {retargeting ? <p className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Comparing with that client…</p> : null}
            </Panel>
          ) : null}

          {decidable.length > 0 || same.length > 0 ? (
            <Panel id="details" title="Details" icon={UserRound} count={decidable.length}>
              {differing.length > 0 ? (
                <p className="flex items-start gap-2 border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                  <Info className="mt-0.5 size-3.5 shrink-0" />
                  {differing.length} {differing.length === 1 ? "field differs" : "fields differ"} from Blackbook. Blackbook&rsquo;s is kept unless you choose Tern&rsquo;s — and the change is recorded on the client.
                </p>
              ) : null}
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-4 py-2 font-medium">Field</th>
                    <th className="px-4 py-2 font-medium">In Blackbook</th>
                    <th className="px-4 py-2 font-medium">In Tern</th>
                    <th className="px-4 py-2 text-right font-medium">Use</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {decidable.map((f) => {
                    const take = choices.fields[f.field] === "take";
                    return (
                      <tr key={f.field} className={cn(f.state === "differs" && "bg-amber-500/5")}>
                        <td className="px-4 py-2.5 text-muted-foreground">{f.label}</td>
                        <td className={cn("px-4 py-2.5", take && f.current && "text-muted-foreground line-through")}>{f.current ?? <span className="text-muted-foreground">—</span>}</td>
                        <td className={cn("px-4 py-2.5", take ? "font-medium" : "text-muted-foreground")}>{f.tern}</td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
                            {(["keep", "take"] as const).map((v) => (
                              <button
                                key={v}
                                type="button"
                                disabled={busy}
                                onClick={() => set({ fields: { ...choices.fields, [f.field]: v } })}
                                className={cn("rounded px-2.5 py-1", choices.fields[f.field] === v ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground")}
                              >
                                {v === "keep" ? (f.current ? "Keep mine" : "Leave empty") : f.current ? "Use Tern's" : "Add"}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {same.map((f) => (
                    <tr key={f.field} className="text-muted-foreground">
                      <td className="px-4 py-2">{f.label}</td>
                      <td className="px-4 py-2" colSpan={2}>{f.tern}</td>
                      <td className="px-4 py-2 text-right text-xs">Already the same</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          ) : null}

          {plan.phones.length > 0 ? (
            <Panel id="numbers" title="Numbers without a country code" icon={Phone} count={plan.phones.length}>
              <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
                Tern holds these without a + and country code. Blackbook never guesses one: tick a number to add it exactly as shown.
              </p>
              {plan.phones.map((p) => (
                <Tick key={p.raw} checked={p.suggestion ? choices.phones.has(p.suggestion) : false} disabled={busy || !p.suggestion} onChange={(on) => p.suggestion && set({ phones: toggle(choices.phones, p.suggestion, on) })}>
                  <span className="tabular">{p.raw}</span>
                  <span className="text-muted-foreground"> → </span>
                  <span className="tabular font-medium">{p.suggestion ?? "no country can be read from it"}</span>
                </Tick>
              ))}
            </Panel>
          ) : null}

          {plan.preferences.length > 0 ? (
            <Panel
              id="preferences"
              title="Preferences and memberships"
              icon={Heart}
              count={plan.preferences.length}
              all={{
                on: plan.preferences.filter((p) => !p.already).every((p) => choices.preferences.has(p.key)),
                toggle: (on) => set({ preferences: new Set(on ? plan.preferences.filter((p) => !p.already).map((p) => p.key) : []) }),
              }}
            >
              <div className="grid sm:grid-cols-2">
                {plan.preferences.map((p) => (
                  <Tick key={p.key} checked={p.already || choices.preferences.has(p.key)} disabled={busy || p.already} onChange={(on) => set({ preferences: toggle(choices.preferences, p.key, on) })}>
                    {p.label}
                    <span className="text-muted-foreground">
                      {" · "}{KIND_LABELS[p.kind as PreferenceKind] ?? p.kind}
                      {p.number ? ` · ${p.number}` : ""}{p.tier ? ` · ${p.tier}` : ""}{p.already ? " · already here" : ""}
                    </span>
                  </Tick>
                ))}
              </div>
            </Panel>
          ) : null}

          {plan.milestones.length > 0 ? (
            <Panel id="dates" title="Dates" icon={CalendarHeart} count={plan.milestones.length}>
              {plan.milestones.map((m) => (
                <Tick key={m.type} checked={m.already || choices.milestones.has(m.type)} disabled={busy || m.already} onChange={(on) => set({ milestones: toggle(choices.milestones, m.type, on) })}>
                  {MILESTONE_LABELS[m.type] ?? m.type}
                  <span className="tabular text-muted-foreground"> · {formatDate(m.date)}{m.already ? " · already here" : ""}</span>
                </Tick>
              ))}
            </Panel>
          ) : null}

          {plan.travelDocuments.items.length > 0 ? (
            <Panel id="documents" title="Travel documents" icon={ShieldCheck} count={plan.travelDocuments.items.length}>
              {!plan.travelDocuments.canSeal ? (
                <p className="border-b border-border px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
                  These cannot be brought over: the encryption key is not set on this server, and a passport number is never stored unsealed.
                </p>
              ) : (
                <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
                  Numbers are sealed before they are stored. Only administrators and founders can reveal one, and every reveal is recorded.
                </p>
              )}
              {plan.travelDocuments.items.map((d) => (
                <Tick key={d.key} checked={choices.documents.has(d.key)} disabled={busy || !plan.travelDocuments.canSeal} onChange={(on) => set({ documents: toggle(choices.documents, d.key, on) })}>
                  {TRAVEL_DOCUMENT_LABELS[d.kind]}
                  <span className="tabular text-muted-foreground">
                    {d.nationality ? ` · ${d.nationality}` : ""} · •••• {d.last4}{d.expiresOn ? ` · expires ${formatDate(d.expiresOn)}` : ""}{d.already ? " · replaces the one here" : ""}
                  </span>
                </Tick>
              ))}
            </Panel>
          ) : null}

          {plan.trips.length > 0 ? (
            <Panel
              id="trips"
              title="Trips"
              icon={Luggage}
              count={plan.trips.length}
              all={{
                on: plan.trips.every((t) => choices.trips.has(t.ternId)),
                toggle: (on) => set({ trips: new Set(on ? plan.trips.map((t) => t.ternId) : []) }),
              }}
            >
              <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">Open a trip to see everything Tern holds for it before choosing.</p>
              <ul className="divide-y divide-border">
                {plan.trips.map((t) => (
                  <li key={t.ternId} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30">
                    <input
                      type="checkbox"
                      className="size-4 shrink-0 accent-[color:var(--primary)]"
                      checked={choices.trips.has(t.ternId)}
                      disabled={busy}
                      onChange={(e) => set({ trips: toggle(choices.trips, t.ternId, e.target.checked) })}
                      aria-label={`Bring over ${t.title}`}
                    />
                    <button type="button" onClick={() => openTrip(t.ternId)} className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm font-medium hover:underline">{t.title}</span>
                      <span className="tabular block text-xs text-muted-foreground">
                        {t.status ? TRIP_STATUS_LABELS[t.status] : "Status in Tern"}
                        {t.datesText && !/^last updated/i.test(t.datesText) ? ` · ${t.datesText}` : ""}
                        {t.already ? " · already here, will refresh" : ""}
                      </span>
                    </button>
                    {t.flags.map((flag) => (
                      <Badge key={flag} variant="outline" className="gap-1 border-amber-500/50 text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="size-3" />
                        {TRIP_FLAG_LABELS[flag] ?? flag}
                      </Badge>
                    ))}
                    <button type="button" onClick={() => openTrip(t.ternId)} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label={`Open ${t.title}`}>
                      <ChevronRight className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {plan.files.length > 0 ? (
            <Panel id="files" title="Files in Tern" icon={FileText} count={plan.files.length}>
              <p className="px-4 py-2 text-xs text-muted-foreground">Listed for reference. Files are not brought over yet; they stay in Tern.</p>
              <ul className="divide-y divide-border">{plan.files.map((f) => <li key={f} className="truncate px-4 py-2 text-sm">{f}</li>)}</ul>
            </Panel>
          ) : null}
        </div>
      </div>

      <ImportBar plan={plan} choices={choices} stage={stage} onImport={run} />
      <TripSheet view={tripView} onClose={() => setTripView(null)} />
    </div>
  );
}

function Panel({ id, title, icon: Icon, count, all, children }: {
  id: string;
  title: string;
  icon: LucideIcon;
  count?: number;
  all?: { on: boolean; toggle: (on: boolean) => void };
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 overflow-hidden rounded-lg border border-border bg-card shadow-xs">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted px-4 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="size-4 text-muted-foreground" />
          {title}
          {count !== undefined ? <span className="tabular rounded-full bg-background px-1.5 text-xs font-medium text-muted-foreground">{count}</span> : null}
        </h2>
        {all ? (
          <button type="button" onClick={() => all.toggle(!all.on)} className="text-xs text-muted-foreground hover:text-foreground">
            {all.on ? "Untick all" : "Tick all"}
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Tick({ checked, onChange, disabled, children }: { checked: boolean; onChange: (on: boolean) => void; disabled?: boolean; children: ReactNode }) {
  return (
    <label className={cn("flex items-start gap-3 px-4 py-2.5 text-sm", disabled ? "opacity-60" : "cursor-pointer hover:bg-muted/30")}>
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[color:var(--primary)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

/** What pressing Import will do, in one line, pinned to the foot of the page. */
function ImportBar({ plan, choices, stage, onImport }: { plan: Preview; choices: Choices; stage: Stage; onImport: () => void }) {
  const added = plan.fields.filter((f) => f.state === "new" && choices.fields[f.field] === "take").length;
  const replaced = plan.fields.filter((f) => f.state === "differs" && choices.fields[f.field] === "take").length;
  const parts = [
    added ? `${added} ${added === 1 ? "detail" : "details"}` : null,
    choices.phones.size ? `${choices.phones.size} ${choices.phones.size === 1 ? "number" : "numbers"}` : null,
    choices.preferences.size ? `${choices.preferences.size} ${choices.preferences.size === 1 ? "preference" : "preferences"}` : null,
    choices.milestones.size ? `${choices.milestones.size} ${choices.milestones.size === 1 ? "date" : "dates"}` : null,
    choices.documents.size ? `${choices.documents.size} travel ${choices.documents.size === 1 ? "document" : "documents"}` : null,
    choices.trips.size ? `${choices.trips.size} of ${plan.trips.length} trips` : null,
  ].filter(Boolean);
  const running = stage.step === "running";

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur md:left-82">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-6 py-3 lg:px-10">
        {running ? (
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />{stage.label}</p>
            <div className="h-1.5 max-w-md overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${stage.total ? Math.round((stage.done / stage.total) * 100) : 5}%` }} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{plan.target.mode === "new" ? "New client" : `Into ${plan.target.ref}`}</span>
            {parts.length ? `: ${parts.join(", ")}` : ": nothing chosen yet"}
            {replaced ? <span className="ml-1 font-medium text-amber-700 dark:text-amber-400">· {replaced} of your entries will be replaced</span> : null}
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="outline" asChild disabled={running}>
            <Link href={plan.target.mode === "existing" ? `/clients/${plan.target.customerId}` : "/clients"}>Cancel</Link>
          </Button>
          <Button onClick={onImport} disabled={running}>
            <CloudDownload />
            {plan.target.mode === "new" ? "Import client" : "Import into client"}
          </Button>
        </div>
      </div>
    </div>
  );
}

type TripView = { ternId: string; trip: (TripDetailData & { already: unknown }) | null; error: string | null };

/**
 * A trip from Tern opened beside the page: everything Tern holds for it,
 * shown and not stored, so somebody can decide whether it belongs.
 */
function TripSheet({ view, onClose }: { view: TripView | null; onClose: () => void }) {
  const trip = view?.trip ?? null;
  return (
    <Sheet open={view !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:!max-w-3xl lg:!max-w-4xl">
        <SheetHeader>
          <SheetTitle className="font-display text-xl">{trip?.title ?? "Trip from Tern"}</SheetTitle>
          <SheetDescription>{trip ? `${TRIP_STATUS_LABELS[trip.status]} · ${tripDates(trip)}` : "Reading it from Tern…"}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          {view?.error ? <p className="text-sm text-destructive">{view.error}</p> : null}
          {!trip && !view?.error ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Reading the trip…</p>
          ) : null}
          {trip ? <TripDetail trip={trip} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
