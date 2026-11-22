// ============================================================================
// ttp-mcp/kitGarde.ts : un media kit faux ne part pas en prospection.
// ----------------------------------------------------------------------------
// Demande de Marc (22 novembre 2026). Avant de préparer ou d'envoyer un mail de prospection
// (creer_brouillon_mail, envoyer_mail, envoyer_brouillon, envoyer_brouillons_valides), on
// retrouve les créateurs proposés (paramètre `createur`, alias `envoyer_en_tant_que`, adresse
// du créateur en copie, @ cité dans le mail, media kit joint ou cité) et on compare leur kit
// aux chiffres réels (_shared/mediakitControle.ts). Kit « à corriger » : refus, avec quoi
// corriger et comment (maj_chiffres_mediakit). PDF de kit hors de l'app : ses chiffres
// d'abonnés doivent être donnés (`chiffres_kit`) pour être comparés.
// Une réponse dans un fil existant, sans kit joint ni lien de kit, n'est pas de la prospection.
// ============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { readAppState } from "../_shared/appState.ts";
import type { BrouillonLu } from "./gmail.ts";
import {
  controlerKit, createursDuMail, kitDeclare, piecesKit, refusProspection, slugsCites,
  type Controle, type FicheRoster, type Mesure, type PieceKit,
} from "../_shared/mediakitControle.ts";

type Json = Record<string, unknown>;

/** En-tête posé sur un brouillon dont le media kit joint a été vérifié à sa création. */
export const ENTETE_KIT = "X-TTP-Kit";

export type MailAVerifier = {
  createur?: string;
  alias?: string;
  /** Destinataires (À). */
  a: string[];
  /** Copies (Cc, Cci). */
  copies: string[];
  objet: string;
  texte: string;
  /** Réponse dans un fil existant. */
  reponse: boolean;
  /** Media kits joints. */
  pieces: PieceKit[];
  /** Chiffres d'abonnés lus dans un PDF de kit hors de l'app : [{ createur?, instagram?, tiktok?, youtube? }]. */
  chiffresKit?: unknown;
  /** À l'envoi d'un brouillon : son kit joint a déjà été vérifié (en-tête X-TTP-Kit). */
  kitVerifie?: boolean;
  /** À l'envoi d'un brouillon (les pièces ne sont connues que par leur nom). */
  envoiBrouillon?: boolean;
};
/** `refus` : le mail ne doit être ni préparé ni envoyé (message pour Alfred) ; sinon null. */
export type Verdict = { refus: string | null; kitJoint: boolean; note: string };

const plie = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
const PASSE: Verdict = { refus: null, kitJoint: false, note: "" };
const refuse = (refus: string): Verdict => ({ refus, kitJoint: false, note: "" });

/** Le roster (petit) avec ce qu'il faut pour reconnaître un créateur et contrôler son kit. */
async function roster(sb: SupabaseClient): Promise<FicheRoster[] | null> {
  const { data, error } = await sb.from("creators").select("id, name, status, email, email_pro, handle, instagram, tiktok, youtube, mediakit, ig, tt, yt");
  return error ? null : ((data as FicheRoster[] | null) ?? []);
}

/** Vérifie les media kits d'un mail. */
export async function verifierKitsDuMail(sb: SupabaseClient, m: MailAVerifier, maintenant = new Date()): Promise<Verdict> {
  const texte = `${m.objet}\n${m.texte}`;
  const prospection = !m.reponse || m.pieces.length > 0 || slugsCites(texte).length > 0;
  if (!prospection) return PASSE;
  const fiches = await roster(sb);
  if (!fiches) return refuse("Vérification du media kit impossible (lecture du roster) : rien n'est parti, réessaie dans un instant.");
  let aliases: { creator?: string | null; alias?: string | null }[] = [];
  if (m.alias) {
    const { data } = await sb.from("creator_mail_settings").select("creator, alias");
    aliases = (data as typeof aliases | null) ?? [];
  }
  const createurs = createursDuMail(fiches, {
    createur: m.createur, alias: m.alias, aliases, a: m.a, copies: m.copies, texte,
    slugs: m.pieces.filter((p) => p.site && p.slug).map((p) => p.slug as string),
  });
  // Brouillon préparé avant ce garde-fou (ou sans vérification) avec un media kit joint.
  if (m.envoiBrouillon && m.pieces.length && !m.kitVerifie) {
    return refuse(`Rien n'est envoyé : ce brouillon joint un media kit (${m.pieces.map((p) => p.nom).join(", ")}) qui n'a pas été vérifié à sa préparation. Refais le brouillon avec creer_brouillon_mail (même destinataire et même objet : il le remplace), le kit y sera comparé aux chiffres réels.`);
  }
  const horsApp = !m.envoiBrouillon && m.pieces.some((p) => !p.site);
  if (m.pieces.length && !m.kitVerifie && !createurs.length) {
    return refuse("Rien n'est préparé : un media kit est joint mais le créateur proposé n'est pas reconnu. Indique-le avec `createur` (nom du roster) pour que son kit soit comparé aux chiffres réels.");
  }
  if (!createurs.length) return PASSE;
  let mesures: Mesure[] = [];
  try {
    const st = await readAppState(sb);
    mesures = Array.isArray(st.engagementHistory) ? (st.engagementHistory as Mesure[]) : [];
  } catch {
    mesures = []; // sans les mesures : les chiffres d'engagement passent « à vérifier », jamais faux
  }
  const declares = (Array.isArray(m.chiffresKit) ? m.chiffresKit : m.chiffresKit && typeof m.chiffresKit === "object" ? [m.chiffresKit] : []) as Json[];
  const declarePour = (nom: string): Json | null => {
    const n = plie(nom);
    const exact = declares.find((d) => plie(d.createur) && (plie(d.createur) === n || n.includes(plie(d.createur))));
    if (exact) return exact;
    const sansNom = declares.filter((d) => !plie(d.createur));
    return createurs.length === 1 && sansNom.length === 1 ? sansNom[0] : null;
  };
  const items = createurs.map((fiche) => {
    const controle = controlerKit(fiche, mesures, maintenant);
    const d = horsApp ? declarePour(fiche.name) : null;
    const decl: Controle | null = d ? controlerKit({ ...fiche, mediakit: kitDeclare({ instagram: d.instagram, tiktok: d.tiktok, youtube: d.youtube }) }, mesures, maintenant) : null;
    return { fiche, controle, kitHorsApp: horsApp, declares: decl };
  });
  const refus = refusProspection(items);
  if (refus) return refuse(m.envoiBrouillon ? refus.replace("Rien n'est préparé ni envoyé", "Rien n'est envoyé") : refus);
  const notes = items
    .map(({ fiche, controle, declares: d }) => {
      const av = [...(d?.aVerifier ?? []), ...controle.aVerifier];
      return av.length ? `${fiche.name} : chiffres du kit à vérifier (pas de chiffre réel récent) : ${av.map((l) => l.texte).join(" · ")}` : "";
    })
    .filter(Boolean);
  return { refus: null, kitJoint: m.pieces.length > 0, note: notes.length ? `\nMedia kit : ${notes.join("\n")}` : "" };
}

/** Adresses d'un en-tête « A <a@x>, b@y » → liste. */
const adresses = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);

/** Le garde-fou pour sendDraft : relit le brouillon tel qu'il partira (message de refus ou null). */
export function verifierBrouillon(sb: SupabaseClient, createur?: string): (b: BrouillonLu) => Promise<string | null> {
  return async (b) => {
    const v = await verifierKitsDuMail(sb, {
      createur, alias: b.from, a: adresses(b.to), copies: [...adresses(b.cc), ...adresses(b.bcc)],
      objet: b.subject, texte: b.text, reponse: b.reponse,
      pieces: piecesKit(b.files.map((nom) => ({ nom }))),
      kitVerifie: b.kit.toLowerCase() === "verifie", envoiBrouillon: true,
    });
    return v.refus;
  };
}
