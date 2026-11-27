import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Check, Copy, ExternalLink, Pencil, Send, X, Keyboard, type LucideIcon } from "@/components/icons";
import { fmtDayTime } from "@/lib/dates";
import { gesteClavier, gesteValider, modeModifier, positionCourante, positionVoisine, validablesEnLot, type PropositionLite } from "@/lib/aValider";

/**
 * La file « À valider » de la page Agents, faite pour aller vite : une carte compacte par
 * proposition, trois gestes (Valider, Modifier, Écarter), des raccourcis clavier (V, M, E,
 * flèches ou J / K, Espace pour cocher, Maj + V pour la sélection) et la validation d'une
 * sélection. Ce que « Valider » déclenche reste décidé par la page (aValider.ts).
 */

export type FileItem = PropositionLite & { cree_le: string };

type Props = {
  items: FileItem[];
  alfredId: string | null;
  meta: (a: FileItem) => { label: string; icon: LucideIcon; alerte: boolean };
  agentBadge: (a: FileItem) => ReactNode;
  /** Qui l'a déposée (« Claude de Gianni », « l'agent autonome de Marc ») ; null si on ne sait pas. */
  origine?: (a: FileItem) => string | null;
  copied: string | null;
  onCopier: (a: FileItem) => void;
  /** `texte` : le texte modifié par Marc ; `silencieux` : validation d'une sélection. */
  onValider: (a: FileItem, opts: { texte?: string; silencieux?: boolean }) => Promise<boolean>;
  onEcarter: (a: FileItem) => Promise<boolean>;
  /** Fin d'une validation de sélection : combien sont passées. */
  onSelectionFaite: (ok: number, total: number) => void;
};

const champ = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
};

// Téléphone (moins de 768 px, comme useIsPhone) : 44 px sous le doigt ; ordinateur : 30 px, inchangé.
const btn = "flex h-11 items-center gap-1.5 rounded-lg border border-border px-3.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-40 md:h-[30px] md:px-2.5 md:text-[11px]";
const iconBtn = "grid size-11 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground md:size-[30px]";
const validerBtn = "flex h-11 items-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50 md:h-[30px] md:px-3.5 md:text-[11px]";
// Case à cocher dans un <label> de 44 px sur téléphone (la case garde son dessin de 16 px).
const caseLabel = "grid size-11 shrink-0 cursor-pointer place-items-center md:size-auto";

export function AValiderFile({ items, alfredId, meta, agentBadge, origine, copied, onCopier, onValider, onEcarter, onSelectionFaite }: Props) {
  // Proposition courante retenue par son id : une nouvelle arrivée en tête ne change pas la cible.
  const [courantId, setCourantId] = useState<string | null>(null);
  const dernierePos = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const [coches, setCoches] = useState<Set<string>>(() => new Set());
  const [edition, setEdition] = useState<{ id: string; texte: string } | null>(null);
  const [occupe, setOccupe] = useState<Set<string>>(() => new Set());
  const [lot, setLot] = useState(false);
  const cartes = useRef(new Map<string, HTMLDivElement>());

  const n = items.length;
  const i = positionCourante(items.map((a) => a.id), courantId, dernierePos.current);
  dernierePos.current = i;
  const courante = items[i] ?? null;
  const viser = (k: number) => setCourantId(items[k]?.id ?? null);
  // Cochées encore dans la file (une proposition traitée ailleurs sort de la sélection).
  const selection = items.filter((a) => coches.has(a.id));
  // « Valider (n) » : jamais les messages à copier (ils restent dans la file, un par un).
  const enLot = validablesEnLot(selection, alfredId);

  // La courante a quitté la file (validée, écartée) : la cible devient celle qui a pris sa place.
  useEffect(() => {
    if (courante && courante.id !== courantId) setCourantId(courante.id);
  }, [courante, courantId]);

  useEffect(() => {
    if (!courante) return;
    cartes.current.get(courante.id)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [courante?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const marquer = (id: string, on: boolean) => setOccupe((s) => {
    const x = new Set(s);
    if (on) x.add(id); else x.delete(id);
    return x;
  });

  const valider = async (a: FileItem, texte?: string) => {
    if (occupe.has(a.id)) return;
    marquer(a.id, true);
    const ok = await onValider(a, { texte });
    marquer(a.id, false);
    if (ok) {
      setEdition(null);
      setCoches((s) => { const x = new Set(s); x.delete(a.id); return x; });
    }
  };
  const ecarter = async (a: FileItem) => {
    if (occupe.has(a.id)) return;
    marquer(a.id, true);
    const ok = await onEcarter(a);
    marquer(a.id, false);
    if (ok) {
      if (edition?.id === a.id) setEdition(null);
      setCoches((s) => { const x = new Set(s); x.delete(a.id); return x; });
    }
  };
  const modifier = (a: FileItem) => {
    const mode = modeModifier(a);
    if (mode === "texte") setEdition({ id: a.id, texte: a.contenu ?? "" });
    else if (mode === "lien" && a.lien_spark) window.open(a.lien_spark, "_blank", "noopener,noreferrer");
  };
  const cocher = (a: FileItem) => setCoches((s) => {
    const x = new Set(s);
    if (x.has(a.id)) x.delete(a.id); else x.add(a.id);
    return x;
  });
  const validerSelection = async () => {
    // Pendant une modification, le texte d'origine partirait : on attend.
    if (lot || edition || !enLot.length) return;
    setLot(true);
    let ok = 0;
    const faites: string[] = [];
    // Une à une, dans l'ordre de la file : chacune garde son propre circuit.
    for (const a of enLot) {
      marquer(a.id, true);
      if (await onValider(a, { silencieux: true })) { ok++; faites.push(a.id); }
      marquer(a.id, false);
    }
    setLot(false);
    setCoches((s) => { const x = new Set(s); for (const id of faites) x.delete(id); return x; });
    onSelectionFaite(ok, enLot.length);
  };

  // Raccourcis : la file n'est montée que sur l'onglet « À valider ».
  const ref = useRef({ courante, i, n, edition, valider, ecarter, modifier, cocher, validerSelection, viser });
  ref.current = { courante, i, n, edition, valider, ecarter, modifier, cocher, validerSelection, viser };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = ref.current;
      // Les pages restent montées (cache d'App.tsx) : seulement quand la file est à l'écran.
      if (!rootRef.current?.getClientRects().length) return;
      if (e.repeat || s.edition || e.defaultPrevented) return;
      if (document.querySelector("[role='dialog'], [role='alertdialog']")) return;
      const g = gesteClavier({ key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, dansUnChamp: champ(e.target) });
      if (!g) return;
      if (g === "suivante" || g === "precedente") {
        e.preventDefault();
        s.viser(positionVoisine(s.i, s.n, g === "suivante" ? 1 : -1));
        return;
      }
      if (g === "valider_selection") { e.preventDefault(); void s.validerSelection(); return; }
      const a = s.courante;
      if (!a) return;
      e.preventDefault();
      if (g === "valider") void s.valider(a);
      else if (g === "ecarter") void s.ecarter(a);
      else if (g === "modifier") s.modifier(a);
      else if (g === "cocher") s.cocher(a);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toutCoche = n > 0 && selection.length === n;

  return (
    <div ref={rootRef} className="flex flex-col gap-2">
      <div className="flex min-h-[32px] flex-wrap items-center gap-2 px-1 text-[11px] text-muted-foreground">
        <label className="-ml-3 flex min-h-11 cursor-pointer items-center md:ml-0 md:min-h-0">
          <span className={caseLabel}>
            <input type="checkbox" aria-label="Tout cocher" checked={toutCoche}
              onChange={() => setCoches(toutCoche ? new Set() : new Set(items.map((a) => a.id)))}
              className="size-4 accent-[var(--primary)]" />
          </span>
          <span className="md:ml-2">{selection.length ? `${selection.length} cochée${selection.length > 1 ? "s" : ""}` : "Tout cocher"}</span>
        </label>
        <span className="ml-auto hidden items-center gap-1.5 text-faint md:flex"
          title="V valide, M modifie, E écarte, flèches ou J / K pour passer de l'une à l'autre, Espace coche, Maj + V valide la sélection">
          <Keyboard className="h-3.5 w-3.5" /> V · M · E · ↑ ↓
        </span>
        {selection.length > 0 && (
          <button type="button" onClick={() => void validerSelection()} disabled={lot || !!edition || !enLot.length}
            title={enLot.length < selection.length ? "Les messages à copier (WhatsApp, DM, LinkedIn) se valident un par un" : "Maj + V"}
            className={validerBtn}>
            <Check className="h-3.5 w-3.5" /> Valider ({enLot.length})
          </button>
        )}
      </div>

      {items.map((a, k) => {
        const m = meta(a);
        const MIcon = m.icon;
        const active = k === i;
        const ed = edition?.id === a.id ? edition : null;
        const geste = gesteValider(a, alfredId);
        const mode = modeModifier(a);
        const busy = occupe.has(a.id);
        // Proposé par Alfred, ou par une autre connexion « agent autonome » (le texte le dit).
        const parAlfred = !!alfredId && a.agent_id === alfredId;
        const titreValider = geste === "alfred_envoie" ? (parAlfred ? "Alfred l'envoie dans la minute (V)" : "L'agent l'envoie à son prochain passage (V)")
          : geste === "alfred_fait" ? (parAlfred ? "Alfred fait exactement cette action (V)" : "L'agent fait exactement cette action (V)")
          : geste === "avancer_collab" ? "La collab avance à cette étape (V)"
          : geste === "copier_envoye" ? "Copie le message et le marque envoyé (V)"
          : "Marque comme fait (V)";
        const qui = origine?.(a) ?? null;
        return (
          <div key={a.id} ref={(el) => { if (el) cartes.current.set(a.id, el); else cartes.current.delete(a.id); }}
            onClick={() => setCourantId(a.id)}
            className={cn(
              "rounded-xl border bg-surface px-3 py-2.5 transition-colors",
              active ? "border-primary/50 ring-1 ring-primary/30" : "border-border",
              m.alerte && !active && "border-amber/40",
              busy && "opacity-60",
            )}>
            <div className="flex min-w-0 items-center gap-2">
              <label className={cn(caseLabel, "-my-2.5 -ml-3 md:m-0")} onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" aria-label="Cocher" checked={coches.has(a.id)} onChange={() => cocher(a)}
                  className="size-4 shrink-0 accent-[var(--primary)]" />
              </label>
              <span className={cn("flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold", m.alerte ? "bg-amber/15 text-amber" : "bg-primary/10 text-primary")}>
                <MIcon className="h-3 w-3" /> {m.label}
              </span>
              {a.cible && <span className="min-w-0 truncate text-[12px] font-semibold text-foreground">{a.cible}</span>}
              <span className="hidden shrink-0 sm:inline-flex">{agentBadge(a)}</span>
              <span className="ml-auto shrink-0 text-[10px] tabular-nums text-faint">{fmtDayTime(a.cree_le)}</span>
            </div>
            {qui && <p className="mt-0.5 truncate text-[10px] text-faint">Proposé par {qui}</p>}
            {a.contexte && <p className={cn("mt-1 text-[11px] leading-relaxed text-muted-foreground", !active && "line-clamp-1")}>{a.contexte}</p>}
            {ed ? (
              <textarea autoFocus value={ed.texte} rows={Math.min(14, Math.max(4, ed.texte.split("\n").length + 1))}
                onChange={(e) => setEdition({ id: a.id, texte: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { e.preventDefault(); setEdition(null); }
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void valider(a, ed.texte); }
                }}
                className="mt-2 w-full resize-y rounded-lg border border-border bg-field px-3 py-2 text-[12px] leading-relaxed text-foreground outline-none focus:border-primary" />
            ) : a.contenu ? (
              <div className={cn("mt-1.5 whitespace-pre-wrap rounded-lg bg-panel px-3 py-2 text-[12px] leading-relaxed text-foreground", !active && "line-clamp-2")}>{a.contenu}</div>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-2.5 md:gap-1.5">
              {!ed && a.contenu && (
                <button type="button" title="Copier le message" aria-label="Copier le message" onClick={(e) => { e.stopPropagation(); onCopier(a); }} className={iconBtn}>
                  {copied === a.id ? <Check className="h-3.5 w-3.5 text-signal" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              )}
              {!ed && a.lien_spark && (
                <a href={a.lien_spark} target="_blank" rel="noreferrer" title="Ouvrir le lien" aria-label="Ouvrir le lien" onClick={(e) => e.stopPropagation()} className={iconBtn}>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              <div className="ml-auto flex flex-wrap items-center justify-end gap-2.5 md:gap-1.5">
                {ed ? (
                  <button type="button" onClick={(e) => { e.stopPropagation(); setEdition(null); }} className={btn} title="Échap">
                    Annuler
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={(e) => { e.stopPropagation(); void ecarter(a); }} disabled={busy} className={cn(btn, "max-md:mr-3")} title="Écarter (E)">
                      <X className="h-3.5 w-3.5" /> Écarter
                    </button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); modifier(a); }} disabled={!mode || busy} className={btn}
                      title={mode === "texte" ? "Modifier le texte, puis valider (M)" : mode === "lien" ? (geste === "avancer_collab" ? "Ouvrir la collab (M)" : "Ouvrir le brouillon pour le modifier, puis Valider ici (M)") : "Rien à modifier"}>
                      <Pencil className="h-3.5 w-3.5" /> Modifier
                    </button>
                  </>
                )}
                <button type="button" onClick={(e) => { e.stopPropagation(); void valider(a, ed?.texte); }} disabled={busy || (!!ed && !ed.texte.trim())}
                  title={ed ? "Valider le texte modifié (Cmd + Entrée)" : titreValider}
                  className={validerBtn}>
                  {geste === "alfred_envoie" ? <Send className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />} Valider
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
