/**
 * Alfred dans l'app (demande de Marc, 17 novembre 2026) : son état (en ligne, dernier passage),
 * « Demander à Alfred », ses réglages (heures, sonnerie, commandes) et l'historique d'un dossier.
 * Le pont avec l'iMac est la fonction alfred-pont ; les tables sont agent.agents (vu_le, passage,
 * reglages), agent.demandes et agent.evenements (SQL 2026-11-18-alfred-relie-a-l-app.sql).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Clock, History, Send, Settings2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { alfredEnLigne, heuresTexte, lireReglages, type ReglagesAlfred } from "@/lib/alfredApp";

type AlfredRow = { id: string; nom: string; vu_le: string | null; passage: string | null; passage_le: string | null; reglages: Record<string, unknown> | null };
type Demande = { id: string; texte: string; contexte: string | null; lien: string | null; auteur: string | null; statut: string; reponse: string | null; cree_le: string; repondu_le: string | null };

const heure = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }).replace(":", " h ") : "";
const jourHeure = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Fondateur (Marc, Gianni) : seuls eux voient Alfred dans l'app (les tables d'Alfred leur sont réservées). */
export function useEstFondateur(): boolean {
  const [oui, setOui] = useState(false);
  useEffect(() => {
    void supabase.rpc("is_founder").then(({ data }) => setOui(data === true));
  }, []);
  return oui;
}

/** La ligne d'Alfred (agent.agents), relue chaque minute. null : pas encore de pont (SQL pas lancé). */
export function useAlfred(): { alfred: AlfredRow | null; recharger: () => void } {
  const [alfred, setAlfred] = useState<AlfredRow | null>(null);
  const recharger = useCallback(() => {
    void supabase
      .schema("agent")
      .from("agents")
      .select("id, nom, vu_le, passage, passage_le, reglages")
      .or("slug.eq.talent-manager,nom.ilike.Alfred")
      .limit(1)
      .then(({ data, error }) => setAlfred(error ? null : (((data as AlfredRow[] | null) ?? [])[0] ?? null)));
  }, []);
  useEffect(() => {
    recharger();
    const t = setInterval(recharger, 60_000);
    return () => clearInterval(t);
  }, [recharger]);
  return { alfred, recharger };
}

/** Le voyant : « Alfred en ligne · dernier passage : point du soir à 17 h 02 », ou hors ligne. */
export function AlfredStatut({ alfred }: { alfred: AlfredRow | null }) {
  if (!alfred) return null;
  const etat = alfredEnLigne(alfred.vu_le, new Date());
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
      <span className="relative flex h-2.5 w-2.5">
        {etat.enLigne && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-signal opacity-60 motion-reduce:hidden" />}
        <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", etat.enLigne ? "bg-signal" : etat.jamais ? "bg-muted-foreground/50" : "bg-destructive")} />
      </span>
      <span className="text-[13px] font-semibold text-foreground">
        {etat.jamais ? `${alfred.nom} : pas encore relié à l'app` : etat.enLigne ? `${alfred.nom} en ligne` : `${alfred.nom} hors ligne depuis ${heure(alfred.vu_le)}`}
      </span>
      {alfred.passage && alfred.passage_le && (
        <span className="text-[11px] text-muted-foreground">
          Dernier passage : {alfred.passage} à {heure(alfred.passage_le)}
        </span>
      )}
      {!etat.enLigne && !etat.jamais && <span className="text-[11px] text-muted-foreground">L'iMac est peut-être éteint, en veille ou sans internet.</span>}
    </div>
  );
}

/** « Demander à Alfred » : la demande part à l'iMac dans la minute ; la réponse arrive sur Telegram et ici. */
export function DemanderAlfred({ contexte, lien, titre = "Demander à Alfred" }: { contexte?: string; lien?: string; titre?: string }) {
  const [texte, setTexte] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [liste, setListe] = useState<Demande[] | null>(null);
  const charger = useCallback(() => {
    let q = supabase.schema("agent").from("demandes").select("*").order("cree_le", { ascending: false }).limit(lien ? 5 : 8);
    if (lien) q = q.eq("lien", lien);
    void q.then(({ data, error }) => setListe(error ? null : ((data as Demande[] | null) ?? [])));
  }, [lien]);
  useEffect(() => {
    charger();
    const t = setInterval(charger, 20_000);
    return () => clearInterval(t);
  }, [charger]);
  if (liste === null) return null; // table pas encore créée : rien à montrer

  const envoyer = async () => {
    const t = texte.trim();
    if (!t || envoi) return;
    setEnvoi(true);
    const { error } = await supabase.schema("agent").from("demandes").insert({ texte: t, contexte: contexte ?? null, lien: lien ?? null });
    setEnvoi(false);
    if (error) return toast("Demande non envoyée, réessaie");
    setTexte("");
    toast("Envoyé à Alfred ✓ Il répond sur Telegram et ici.");
    charger();
  };

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
        <Bot className="h-4 w-4 text-muted-foreground" /> {titre}
      </div>
      <textarea
        value={texte}
        onChange={(e) => setTexte(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void envoyer();
        }}
        rows={2}
        maxLength={2000}
        placeholder={contexte ? `« Relance la marque », « prépare la facture »… (${contexte})` : "« Relance Fitaya », « prépare la facture Nova »…"}
        className="w-full resize-none rounded-[10px] border border-input bg-surface px-3 py-2 text-[13px] text-foreground outline-none focus:border-foreground"
      />
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-faint">Rien ne part chez une marque sans ton « oui ».</span>
        <button
          type="button"
          onClick={() => void envoyer()}
          disabled={!texte.trim() || envoi}
          className="ml-auto flex h-[32px] items-center gap-1.5 rounded-full bg-primary px-4 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" /> Envoyer à Alfred
        </button>
      </div>
      {liste.length > 0 && (
        <div className="mt-1 flex flex-col gap-2">
          {liste.map((d) => (
            <div key={d.id} className="rounded-xl bg-panel px-3 py-2">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">{d.auteur ?? "Toi"}</span>
                <span>{jourHeure(d.cree_le)}</span>
                <span className="ml-auto">{d.statut === "repondue" ? "Répondu" : d.statut === "recue" ? "Alfred s'en occupe" : "En route vers l'iMac"}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[12px] text-foreground">{d.texte}</p>
              {d.reponse && <p className="mt-2 whitespace-pre-wrap border-l-2 border-border pl-2 text-[12px] leading-relaxed text-muted-foreground">{d.reponse}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Les réglages d'Alfred : heures des passages, sonnerie, commandes « / ». Lus par l'iMac au pouls suivant. */
export function ReglagesAlfredCarte({ alfred, onSaved }: { alfred: AlfredRow | null; onSaved: () => void }) {
  const depart = useMemo(() => lireReglages(alfred?.reglages), [alfred?.reglages]);
  const [r, setR] = useState<ReglagesAlfred>(depart);
  const [veille, setVeille] = useState(depart.heures.veille.join(", "));
  const [commandes, setCommandes] = useState(depart.commandes.texte);
  const [enreg, setEnreg] = useState(false);
  useEffect(() => {
    setR(depart);
    setVeille(depart.heures.veille.join(", "));
    setCommandes(depart.commandes.texte);
  }, [depart]);
  if (!alfred) return null;

  const champ = (cle: keyof ReglagesAlfred["heures"], label: string) =>
    cle === "veille" ? null : (
      <label className="flex items-center justify-between gap-3 text-[12px] text-muted-foreground">
        {label}
        <input
          type="number"
          min={0}
          max={23}
          value={r.heures[cle] as number}
          onChange={(e) => setR({ ...r, heures: { ...r.heures, [cle]: Number(e.target.value) } })}
          className="h-[30px] w-16 rounded-[8px] border border-input bg-surface px-2 text-right text-[13px] tabular-nums text-foreground outline-none focus:border-foreground"
        />
      </label>
    );

  const enregistrer = async () => {
    setEnreg(true);
    const heures = { ...r.heures, veille: veille.split(/[,;\s]+/).map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 23) };
    const neuf = {
      ...(alfred.reglages ?? {}),
      heures,
      sonner: r.sonner,
      ...(commandes.trim() !== depart.commandes.texte.trim() ? { commandes: { texte: commandes.trim(), maj_le: new Date().toISOString() } } : {}),
    };
    const { error } = await supabase.schema("agent").from("agents").update({ reglages: neuf }).eq("id", alfred.id);
    setEnreg(false);
    if (error) return toast("Réglages non enregistrés, réessaie");
    toast("Réglages enregistrés ✓ Alfred les prend dans la minute.");
    onSaved();
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
        <Settings2 className="h-4 w-4 text-muted-foreground" /> Réglages d'Alfred
      </div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {champ("matin", "Point du matin (heure)")}
        {champ("soir", "Point du soir et liste à valider")}
        {champ("vigie", "Vigie des réseaux")}
        {champ("contenu", "Point contenu (mardi, vendredi)")}
        {champ("bilan_soir", "Bilan du soir")}
        <label className="flex items-center justify-between gap-3 text-[12px] text-muted-foreground">
          Veilles (heures)
          <input
            value={veille}
            onChange={(e) => setVeille(e.target.value)}
            className="h-[30px] w-28 rounded-[8px] border border-input bg-surface px-2 text-right text-[13px] tabular-nums text-foreground outline-none focus:border-foreground"
          />
        </label>
      </div>
      <p className="text-[11px] text-faint">{heuresTexte(r.heures)}</p>
      <div className="flex flex-col gap-1.5 text-[12px] text-foreground">
        <span className="text-[12px] font-medium text-muted-foreground">Ton téléphone sonne pour :</span>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked disabled /> Les réponses à tes messages et l'urgent (toujours)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={r.sonner.points} onChange={(e) => setR({ ...r, sonner: { ...r.sonner, points: e.target.checked } })} /> Le début des points du matin et du soir
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={r.sonner.valider} onChange={(e) => setR({ ...r, sonner: { ...r.sonner, valider: e.target.checked } })} /> La liste à valider
        </label>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-muted-foreground">Tes commandes « / » (une par ligne : /commande = ce qu'Alfred fait)</span>
        <textarea
          value={commandes}
          onChange={(e) => setCommandes(e.target.value)}
          rows={6}
          placeholder="Alfred les envoie ici à sa prochaine minute de pouls."
          className="w-full rounded-[10px] border border-input bg-surface px-3 py-2 font-mono text-[12px] text-foreground outline-none focus:border-foreground"
        />
      </div>
      <button
        type="button"
        onClick={() => void enregistrer()}
        disabled={enreg}
        className="ml-auto flex h-[32px] items-center gap-1.5 rounded-full bg-primary px-4 text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        Enregistrer
      </button>
    </div>
  );
}

type Ligne = { quand: string; quoi: string; qui?: string | null };

/** L'historique d'un dossier (une collab) : étapes et actions de l'équipe, ce qu'Alfred a fait, tâches, factures, échanges, demandes. */
/** Sur la fiche d'une collab : l'historique du dossier et « Demander à Alfred » (fondateurs seulement). */
export function AlfredSurCollab({ collab }: { collab: { id: string; brand: string; creator: string | null; created_at?: string | null } }) {
  const fondateur = useEstFondateur();
  if (!fondateur) return null;
  return (
    <>
      <DemanderAlfred titre="Demander à Alfred sur ce dossier" contexte={`Collab ${collab.brand}${collab.creator ? ` × ${collab.creator}` : ""}`} lien={`/?open=view&view=collabs&item=${collab.id}`} />
      <DossierCollab collab={collab} />
    </>
  );
}

export function DossierCollab({ collab }: { collab: { id: string; brand: string; creator: string | null; created_at?: string | null } }) {
  const [lignes, setLignes] = useState<Ligne[] | null>(null);
  useEffect(() => {
    let vivant = true;
    const marque = collab.brand.replace(/[%_,()]/g, " ").trim();
    const like = `%${marque}%`;
    void Promise.all([
      supabase.from("agency_activity").select("created_at, actor_name, verb, entity, label").ilike("label", like).order("created_at", { ascending: false }).limit(40),
      supabase.schema("agent").from("journal").select("cree_le, action, detail").ilike("detail", like).order("cree_le", { ascending: false }).limit(40),
      supabase.from("todos").select("text, created_at, done, done_at, done_by").eq("collab_id", collab.id).limit(40),
      supabase.from("invoices").select("ref, status, created_at, paid_at").eq("collab_id", collab.id).limit(10),
      supabase.from("contacts").select("brand, touches").ilike("brand", like).limit(3),
      supabase.schema("agent").from("demandes").select("cree_le, texte, auteur, reponse, repondu_le").eq("lien", `/?open=view&view=collabs&item=${collab.id}`).limit(20),
    ]).then(([act, jr, td, inv, ct, dm]) => {
      if (!vivant) return;
      const out: Ligne[] = [];
      for (const a of (act.data as { created_at: string; actor_name: string | null; verb: string; entity: string; label: string | null }[] | null) ?? [])
        out.push({ quand: a.created_at, quoi: `${a.label ?? a.entity} (${a.verb})`, qui: a.actor_name });
      for (const j of (jr.data as { cree_le: string; action: string; detail: string | null }[] | null) ?? [])
        if (!/^marc_/.test(j.action)) out.push({ quand: j.cree_le, quoi: `${j.action} : ${String(j.detail ?? "").slice(0, 280)}`, qui: "Alfred" });
      for (const t of (td.data as { text: string; created_at: string; done: boolean; done_at: string | null; done_by: string | null }[] | null) ?? []) {
        out.push({ quand: t.created_at, quoi: `Tâche créée : ${t.text}` });
        if (t.done && t.done_at) out.push({ quand: t.done_at, quoi: `Tâche faite : ${t.text}`, qui: t.done_by });
      }
      for (const f of (inv.data as { ref: string; status: string; created_at: string; paid_at: string | null }[] | null) ?? []) {
        out.push({ quand: f.created_at, quoi: `Facture ${f.ref} créée` });
        if (f.paid_at) out.push({ quand: f.paid_at, quoi: `Facture ${f.ref} payée` });
      }
      for (const c of (ct.data as { brand: string; touches: unknown }[] | null) ?? [])
        for (const x of Array.isArray(c.touches) ? (c.touches as Record<string, unknown>[]) : [])
          if (x && typeof x === "object" && x.date)
            out.push({ quand: `${String(x.date)}T12:00:00Z`, quoi: `${x.kind === "reponse" ? "Réponse de" : x.kind === "relance" ? "Relance à" : "Contact avec"} ${c.brand}${x.canal ? ` (${String(x.canal)})` : ""}${x.note ? ` : ${String(x.note).slice(0, 200)}` : ""}` });
      for (const d of (dm.data as { cree_le: string; texte: string; auteur: string | null; reponse: string | null; repondu_le: string | null }[] | null) ?? []) {
        out.push({ quand: d.cree_le, quoi: `Demande à Alfred : ${d.texte}`, qui: d.auteur });
        if (d.reponse && d.repondu_le) out.push({ quand: d.repondu_le, quoi: `Réponse d'Alfred : ${d.reponse.slice(0, 280)}`, qui: "Alfred" });
      }
      if (collab.created_at) out.push({ quand: collab.created_at, quoi: "Collab créée" });
      out.sort((a, b) => Date.parse(b.quand) - Date.parse(a.quand));
      setLignes(out.filter((l) => !Number.isNaN(Date.parse(l.quand))).slice(0, 60));
    });
    return () => {
      vivant = false;
    };
  }, [collab.id, collab.brand, collab.created_at]);

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
        <History className="h-4 w-4 text-muted-foreground" /> Historique du dossier
      </div>
      {lignes === null ? (
        <p className="text-[12px] text-muted-foreground">Chargement…</p>
      ) : lignes.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">Rien encore dans l'historique de ce dossier.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {lignes.map((l, i) => (
            <li key={i} className="flex gap-3 text-[12px]">
              <span className="flex w-28 shrink-0 items-start gap-1 tabular-nums text-faint">
                <Clock className="mt-[2px] h-3 w-3" /> {jourHeure(l.quand)}
              </span>
              <span className="min-w-0 flex-1 text-foreground">
                {l.quoi}
                {l.qui && <span className="text-muted-foreground"> · {l.qui}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="text-[11px] text-faint">Les mails eux-mêmes restent dans Mails ; ici, ce qui en a été fait (envoyé, noté par Alfred).</p>
    </div>
  );
}
