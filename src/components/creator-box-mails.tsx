/**
 * Page Mails › « Boîtes créateurs » : la boîte Gmail d'un créateur reliée à TTP Suite
 * (ex. Léna), pour la lire et y répondre depuis l'app, sans Spark (demande de Marc,
 * 16 novembre 2026). Serveur : fonction creator-box-mail (fondateurs seulement).
 * Les mails partent de SA boîte, avec SA signature Gmail. Pas d'archive ni de corbeille :
 * ces gestes restent dans sa boîte.
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Inbox, PenLine, RefreshCw, Send, X } from "@/components/icons";
import { Spin } from "@/components/ui/loader";
import { toast } from "@/components/ui/toast";
import { SearchField, mailRowCls, pillCls } from "@/components/mail-shell";
import { supabase } from "@/lib/supabase";
import { cn, titleCase } from "@/lib/utils";
import { fmtDayTime } from "@/lib/dates";
import { destinataireReponse, erreurBoite, nomDe, type BoxMessage, type BoxThread, type CreatorBox } from "@/lib/creatorBoxMail";

type Res<T> = T & { ok?: boolean; error?: string };

async function call<T>(body: Record<string, unknown>): Promise<Res<T>> {
  try {
    const { data, error } = await supabase.functions.invoke("creator-box-mail", { body, timeout: 30_000 });
    if (error) {
      const ctx = (error as { context?: { json?: () => Promise<unknown> } }).context;
      const parsed = ctx && typeof ctx.json === "function" ? ((await ctx.json().catch(() => null)) as Res<T> | null) : null;
      return parsed ?? ({ error: "reseau" } as Res<T>);
    }
    return (data ?? {}) as Res<T>;
  } catch {
    return { error: "reseau" } as Res<T>;
  }
}

/** Les boîtes reliées (vide pour un membre : réservé aux fondateurs). */
export function useCreatorBoxes(): CreatorBox[] {
  const [boxes, setBoxes] = useState<CreatorBox[]>([]);
  useEffect(() => {
    let live = true;
    void call<{ boxes?: CreatorBox[] }>({ action: "boxes" }).then((r) => {
      if (live && r.ok) setBoxes((r.boxes ?? []).filter((b) => b.connected));
    });
    return () => {
      live = false;
    };
  }, []);
  return boxes;
}

type Compose = { to: string; subject: string; text: string; threadId?: string };

export function CreatorBoxMails({ boxes }: { boxes: CreatorBox[] }) {
  const [email, setEmail] = useState(boxes[0]?.email ?? "");
  const [folder, setFolder] = useState<"inbox" | "sent">("inbox");
  const [q, setQ] = useState("");
  const [threads, setThreads] = useState<BoxThread[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<{ threadId: string; subject: string; messages: BoxMessage[] } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [compose, setCompose] = useState<Compose | null>(null);
  const [sending, setSending] = useState(false);
  const box = boxes.find((b) => b.email === email) ?? boxes[0];

  const load = useCallback(async (query = q) => {
    if (!box) return;
    setBusy(true);
    setErr(null);
    const r = await call<{ threads?: BoxThread[] }>({ action: "list", box: box.email, folder, q: query });
    setBusy(false);
    if (!r.ok) return setErr(erreurBoite(r.error));
    setThreads(r.threads ?? []);
  }, [box, folder, q]);

  useEffect(() => {
    setThreads(null);
    setOpen(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box?.email, folder]);

  const openThread = async (t: BoxThread) => {
    if (!box) return;
    setOpening(t.threadId);
    setCompose(null);
    const r = await call<{ subject?: string; messages?: BoxMessage[] }>({ action: "thread", box: box.email, threadId: t.threadId });
    setOpening(null);
    if (!r.ok) return toast(erreurBoite(r.error));
    setOpen({ threadId: t.threadId, subject: r.subject ?? t.subject, messages: r.messages ?? [] });
  };

  const send = async () => {
    if (!box || !compose) return;
    setSending(true);
    const r = await call<{ threadId?: string }>({ action: "send", box: box.email, to: compose.to, subject: compose.subject, text: compose.text, threadId: compose.threadId });
    setSending(false);
    if (!r.ok) return toast(erreurBoite(r.error));
    toast(`✓ Envoyé depuis ${box.email}`);
    const reopen = compose.threadId;
    setCompose(null);
    if (reopen && open) void openThread({ threadId: reopen, subject: open.subject } as BoxThread);
    void load();
  };

  if (!box) return <div className="p-6 text-[13px] text-muted-foreground">Aucune boîte de créateur reliée.</div>;

  const reader = compose ? (
    <div className="flex min-h-0 flex-col gap-3 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[14px] font-semibold text-foreground">{compose.threadId ? "Répondre" : "Nouveau mail"}</span>
        <button type="button" aria-label="Fermer" onClick={() => setCompose(null)} className="grid h-8 w-8 place-items-center rounded-full text-faint hover:bg-rowhover hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="text-[12px] text-muted-foreground">De : {box.email} (sa signature Gmail est ajoutée)</p>
      <input value={compose.to} onChange={(e) => setCompose({ ...compose, to: e.target.value })} placeholder="À"
        className="h-9 rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:ring-2 focus:ring-ring" />
      {!compose.threadId && (
        <input value={compose.subject} onChange={(e) => setCompose({ ...compose, subject: e.target.value })} placeholder="Objet"
          className="h-9 rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus:ring-2 focus:ring-ring" />
      )}
      <textarea value={compose.text} onChange={(e) => setCompose({ ...compose, text: e.target.value })} placeholder="Message" rows={12}
        className="min-h-[200px] flex-1 resize-y rounded-lg border border-border bg-background p-3 text-[13px] leading-relaxed outline-none focus:ring-2 focus:ring-ring" />
      <div className="flex justify-end">
        <button type="button" onClick={() => void send()} disabled={sending || !compose.to.trim() || !compose.text.trim()}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground disabled:opacity-50">
          {sending ? <Spin className="h-4 w-4" /> : <Send className="h-4 w-4" />} Envoyer
        </button>
      </div>
    </div>
  ) : open ? (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 sm:px-5">
        <button type="button" aria-label="Retour" onClick={() => setOpen(null)} className="grid h-8 w-8 place-items-center rounded-full text-faint hover:bg-rowhover hover:text-foreground lg:hidden">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">{open.subject}</h2>
        <button type="button" onClick={() => setCompose({ to: destinataireReponse(open.messages, box.email), subject: "", text: "", threadId: open.threadId })}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground">
          <PenLine className="h-3.5 w-3.5" /> Répondre
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
        {open.messages.map((m) => (
          <article key={m.id} className="rounded-xl border border-border bg-background p-4">
            <div className="mb-2 flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">{nomDe(m.from)}</span>
              <span className="shrink-0 text-[11.5px] text-faint">{m.ts ? fmtDayTime(m.ts) : ""}</span>
            </div>
            <p className="mb-3 truncate text-[11.5px] text-muted-foreground">À : {m.to}{m.cc ? ` · Cc : ${m.cc}` : ""}</p>
            <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground">{m.text || "(message vide)"}</div>
            {m.files.length > 0 && <p className="mt-3 text-[11.5px] text-muted-foreground">Pièces jointes : {m.files.join(", ")} (à ouvrir dans sa boîte)</p>}
          </article>
        ))}
      </div>
    </div>
  ) : (
    <div className="hidden items-center justify-center p-6 text-[13px] text-faint lg:flex">Choisis un mail.</div>
  );

  return (
    <div className="grid min-h-0 min-w-0 lg:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
      <section className={cn("flex min-h-0 flex-col border-border lg:border-r", (open || compose) && "max-lg:hidden")}>
        <div className="space-y-2.5 border-b border-border p-4">
          <div className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-muted-foreground" />
            {boxes.length > 1 ? (
              <select value={box.email} onChange={(e) => setEmail(e.target.value)} className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-2 py-1 text-[13px] font-semibold">
                {boxes.map((b) => <option key={b.email} value={b.email}>{titleCase(b.creator)} · {b.email}</option>)}
              </select>
            ) : (
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground" title={box.email}>{titleCase(box.creator)} · {box.email}</span>
            )}
            <button type="button" aria-label="Actualiser" onClick={() => void load()} className="grid h-8 w-8 place-items-center rounded-full text-faint hover:bg-rowhover hover:text-foreground">
              <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            {(["inbox", "sent"] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFolder(f)} aria-pressed={folder === f}
                className={cn(pillCls, folder === f ? "bg-foreground text-background" : "text-muted-foreground hover:bg-rowhover")}>
                {f === "inbox" ? "Reçus" : "Envoyés"}
              </button>
            ))}
            <span className="flex-1" />
            <button type="button" onClick={() => { setOpen(null); setCompose({ to: "", subject: "", text: "" }); }}
              className={cn(pillCls, "bg-primary text-primary-foreground")}>
              <PenLine className="h-3.5 w-3.5" /> Écrire
            </button>
          </div>
          <SearchField value={q} onChange={setQ} placeholder="Rechercher (syntaxe Gmail)" size="sm"
            onKeyDown={(e) => { if (e.key === "Enter") void load(q); }} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {err ? (
            <p className="p-4 text-[13px] text-muted-foreground">{err}</p>
          ) : threads === null ? (
            <div className="grid place-items-center p-8"><Spin className="h-5 w-5" /></div>
          ) : threads.length === 0 ? (
            <p className="p-4 text-[13px] text-faint">Aucun</p>
          ) : (
            threads.map((t) => (
              <button key={t.threadId} type="button" onClick={() => void openThread(t)} className={cn(mailRowCls(open?.threadId === t.threadId), "flex-col gap-0.5 border-b border-border/60 py-3")}>
                <span className="flex w-full items-baseline gap-2">
                  <span className={cn("min-w-0 flex-1 truncate text-[13px]", t.unread ? "font-semibold text-foreground" : "text-foreground")}>{nomDe(t.from)}</span>
                  <span className="shrink-0 text-[11.5px] text-faint">{opening === t.threadId ? <Spin className="h-3 w-3" /> : t.ts ? fmtDayTime(t.ts) : ""}</span>
                </span>
                <span className="w-full truncate text-[12.5px] text-foreground">{t.subject}{t.messages > 1 ? ` (${t.messages})` : ""}</span>
                <span className="w-full truncate text-[12px] text-muted-foreground">{t.snippet}</span>
              </button>
            ))
          )}
        </div>
      </section>
      <section className={cn("min-h-0 min-w-0", !(open || compose) && "max-lg:hidden")}>{reader}</section>
    </div>
  );
}
