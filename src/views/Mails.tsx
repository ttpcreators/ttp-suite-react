import { useEffect, useMemo, useState } from "react";
import { Mail, ArrowDownLeft, ArrowUpRight, X, Search, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, initials, titleCase } from "@/lib/utils";
import { AnimatedBadge } from "@/components/ui/be-ui-animated-badge";

/**
 * Page « Mails » : historique des échanges Gmail par contact + lecture d'un fil
 * complet. Lecture seule (scope gmail.readonly via les fonctions gmail-history /
 * gmail-thread). Réservé à l'agence (les fonctions vérifient le rôle).
 */
type Contact = { email: string; label: string; tag?: string };
type MailMsg = { id: string; threadId: string; from: string; to?: string; subject: string; date: string; snippet: string; direction: "in" | "out" };
type ThreadMsg = { id: string; from: string; to?: string; subject: string; date: string; html: string; text: string; direction: "in" | "out"; ts: number };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function fmtDate(d: string): string {
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? "" : t.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "2-digit" });
}
function fmtDateTime(d: string): string {
  const t = new Date(d);
  return Number.isNaN(t.getTime())
    ? ""
    : t.toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
/** Nom affiché depuis un entête "Nom <email>" ou "email". */
function displayName(from: string): string {
  const m = /^\s*"?([^"<]+?)"?\s*</.exec(from);
  return (m ? m[1] : from.replace(/[<>]/g, "")).trim();
}
/** Corps lisible : texte brut si présent, sinon HTML nettoyé en texte. */
function readableBody(m: ThreadMsg): string {
  if (m.text && m.text.trim()) return m.text.trim();
  return m.html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** supabase-js met le corps JSON des réponses non-2xx dans error.context. */
async function invokeJson<T>(fn: string, body: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error && (error as { context?: { json?: () => Promise<unknown> } }).context?.json)
    return (await (error as { context: { json: () => Promise<unknown> } }).context.json().catch(() => null)) as T | null;
  return (data as T) ?? null;
}

export function Mails() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Contact | null>(null);

  const [history, setHistory] = useState<MailMsg[] | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyErr, setHistoryErr] = useState("");

  const [thread, setThread] = useState<{ contact: string; subject: string } | null>(null);
  const [threadMsgs, setThreadMsgs] = useState<ThreadMsg[] | null>(null);
  const [threadBusy, setThreadBusy] = useState(false);

  // Contacts avec un email valide.
  useEffect(() => {
    supabase
      .from("contacts")
      .select("*")
      .order("sort_order")
      .then(({ data }) => {
        const rows = (data as Record<string, unknown>[]) ?? [];
        setContacts(
          rows
            .map((r) => {
              const person = [r.first_name, r.last_name].filter(Boolean).join(" ") || String(r.person ?? "");
              const label = [String(r.brand ?? ""), person].filter((x) => x && x !== "—").join(" · ") || String(r.email ?? "");
              return { email: String(r.email ?? "").trim(), label, tag: String(r.tag ?? "").trim() };
            })
            .filter((c) => EMAIL_RE.test(c.email)),
        );
      });
  }, []);

  // Historique du contact sélectionné.
  useEffect(() => {
    setHistory(null);
    setHistoryErr("");
    const email = selected?.email?.toLowerCase();
    if (!email) return;
    let alive = true;
    setHistoryBusy(true);
    (async () => {
      const res = await invokeJson<{ ok?: boolean; messages?: MailMsg[]; error?: string }>("gmail-history", { contact: email });
      if (!alive) return;
      if (res?.error === "google_non_connecte" || res?.error === "gmail_scope_manquant")
        setHistoryErr("Reconnecte Google (droits Gmail) dans l'app pour lire tes mails.");
      setHistory(res?.ok ? res.messages ?? [] : []);
      setHistoryBusy(false);
    })();
    return () => {
      alive = false;
    };
  }, [selected]);

  const openThread = async (m: MailMsg) => {
    setThread({ contact: selected?.email.toLowerCase() ?? "", subject: m.subject });
    setThreadMsgs(null);
    setThreadBusy(true);
    const res = await invokeJson<{ ok?: boolean; messages?: ThreadMsg[] }>("gmail-thread", {
      threadId: m.threadId,
      contact: selected?.email.toLowerCase(),
    });
    setThreadMsgs(res?.ok ? res.messages ?? [] : []);
    setThreadBusy(false);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => c.label.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || (c.tag ?? "").toLowerCase().includes(q));
  }, [contacts, query]);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[300px_1fr]">
        {/* Colonne : contacts */}
        <div className={cn("rounded-2xl border border-border bg-surface p-3 shadow-sm", selected && "hidden md:block")}>
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher un contact…"
              className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </div>
          <div className="max-h-[70vh] space-y-0.5 overflow-y-auto pr-1">
            {filtered.length === 0 ? (
              <div className="px-2 py-6 text-center text-[12px] text-faint">Aucun contact avec email.</div>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.email}
                  type="button"
                  onClick={() => setSelected(c)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                    selected?.email === c.email ? "bg-primary/10" : "hover:bg-rowhover",
                  )}
                >
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-panel text-[10px] font-bold text-foreground">
                    {initials(c.label)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold text-foreground">{c.label}</div>
                    <div className="truncate text-[11px] text-faint">{c.email}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Colonne : historique */}
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
          {!selected ? (
            <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-2 text-center text-sm text-faint">
              <Mail className="h-8 w-8 opacity-40" />
              Choisis un contact pour voir vos échanges.
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="rounded-lg px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover md:hidden"
                >
                  ← Retour
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-foreground">{selected.label}</div>
                  <div className="truncate text-[11px] text-faint">{selected.email}</div>
                </div>
              </div>

              {historyBusy ? (
                <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Chargement des échanges…
                </div>
              ) : historyErr ? (
                <div className="rounded-lg border border-border bg-panel p-4 text-[12px] text-muted-foreground">{historyErr}</div>
              ) : !history || history.length === 0 ? (
                <div className="py-8 text-center text-sm text-faint">Aucun échange trouvé dans Gmail avec ce contact.</div>
              ) : (
                <div className="space-y-1.5">
                  {history.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => openThread(m)}
                      className="flex w-full items-start gap-3 rounded-xl border border-border bg-panel px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-rowhover"
                    >
                      <span
                        className={cn(
                          "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full",
                          m.direction === "in" ? "bg-signal/15 text-signaltext" : "bg-primary/10 text-primary",
                        )}
                      >
                        {m.direction === "in" ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[12px] font-semibold text-foreground">{m.subject || "(sans objet)"}</span>
                          <span className="shrink-0 text-[10px] text-faint">{fmtDate(m.date)}</span>
                        </div>
                        <div className="truncate text-[11px] text-faint">{m.snippet}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Fil complet */}
      {thread && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4" onClick={() => setThread(null)}>
          <div
            className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-foreground">{thread.subject || "(sans objet)"}</div>
                <div className="truncate text-[11px] text-faint">Conversation avec {titleCase(displayName(thread.contact))}</div>
              </div>
              <button
                type="button"
                onClick={() => setThread(null)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-faint transition-colors hover:bg-rowhover hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {threadBusy ? (
                <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Chargement du fil…
                </div>
              ) : !threadMsgs || threadMsgs.length === 0 ? (
                <div className="py-8 text-center text-sm text-faint">Impossible de charger ce fil.</div>
              ) : (
                threadMsgs.map((m) => (
                  <div key={m.id} className="rounded-xl border border-border bg-panel p-3.5">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <AnimatedBadge status={m.direction === "in" ? "success" : "info"} size="sm">
                          {m.direction === "in" ? "Reçu" : "Envoyé"}
                        </AnimatedBadge>
                        <span className="truncate text-[12px] font-medium text-foreground">{displayName(m.from)}</span>
                      </div>
                      <span className="shrink-0 text-[10px] text-faint">{fmtDateTime(m.date)}</span>
                    </div>
                    <div className="whitespace-pre-line break-words text-[13px] leading-relaxed text-foreground">{readableBody(m)}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
