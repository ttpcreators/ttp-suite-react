import { useState } from "react";
import { supabase } from "./supabase";
import { useAppState, saveAppStateKey, getAppState, invalidateAppState, type AppState } from "./appState";
import { toast } from "@/components/ui/toast";

/**
 * Signatures mail. Deux types :
 *  - `image` : une image PNG/JPEG uploadée (collée telle quelle).
 *  - `html`  : une "carte" HTML cliquable (tél / Instagram / email) et fluide,
 *              construite depuis des champs éditables (photo, nom, rôle…).
 * Fichiers dans le bucket privé `documents` (dossier `signatures/`), métadonnées
 * dans le blob agence `mailSignatures = { list, defaultId }`. URL signée ≈10 ans
 * pour l'affichage direct dans les emails.
 */
export type SigFields = {
  photoUrl?: string;
  photoPath?: string;
  name: string;
  role: string;
  phone: string;
  instagram: string;
  email: string;
};
export type MailSignature = {
  id: string;
  name: string;
  kind: "image" | "html";
  path?: string; // image : chemin storage
  url?: string; // image : URL signée
  fields?: SigFields; // html : champs de la carte
};
type SigState = { list: MailSignature[]; defaultId: string };

const KEY = "mailSignatures";
const MAX_MB = 3;
const TTL = 60 * 60 * 24 * 365 * 10; // ≈10 ans
const EMPTY: SigState = { list: [], defaultId: "" };
const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

function esc(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** Signature image simple. */
export function signatureImgHtml(url: string): string {
  return `<div style="margin-top:22px"><img src="${url}" alt="Signature" style="max-width:360px;width:100%;height:auto;border:0;display:block" /></div>`;
}

/**
 * Carte de signature HTML : table + styles inline (compatible Gmail/Apple Mail/
 * Outlook), fluide (max-width, pills qui passent à la ligne sur mobile),
 * cliquable (tel: / instagram / mailto:).
 */
export function htmlSignatureMarkup(f: SigFields): string {
  const burgundy = "#3d0000";
  const ig = (f.instagram || "").replace(/^@+/, "").trim();
  const igUrl = ig ? `https://instagram.com/${encodeURIComponent(ig)}` : "";
  const tel = (f.phone || "").replace(/[^\d+]/g, "");
  const photoCell = f.photoUrl
    ? `<td valign="top" style="padding:0 16px 12px 0">` +
      (igUrl ? `<a href="${igUrl}" style="text-decoration:none">` : "") +
      `<img src="${f.photoUrl}" width="92" height="92" alt="${esc(f.name)}" style="display:block;width:92px;height:92px;border-radius:16px;object-fit:cover;border:0" />` +
      (igUrl ? `</a>` : "") +
      `</td>`
    : "";
  const phonePill = f.phone
    ? `<div style="margin-top:10px"><a href="tel:${tel}" style="display:inline-block;background:#ececec;color:#222222;text-decoration:none;font-size:12px;line-height:1.3;padding:6px 12px;border-radius:14px">Mobile : ${esc(f.phone)}</a></div>`
    : "";
  const igMailPill =
    `<div style="margin-top:6px"><span style="display:inline-block;background:${burgundy};color:#ffffff;font-size:12px;line-height:1.4;padding:6px 12px;border-radius:14px">Ig : ` +
    (igUrl ? `<a href="${igUrl}" style="color:#ffffff;text-decoration:none">@${esc(ig)}</a>` : `@${esc(ig)}`) +
    (f.email ? ` // <a href="mailto:${esc(f.email)}" style="color:#ffffff;text-decoration:none">${esc(f.email)}</a>` : "") +
    `</span></div>`;
  return (
    `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;max-width:520px;margin-top:22px">` +
    `<tr>${photoCell}<td valign="top">` +
    `<div style="font-size:24px;line-height:1.05;font-weight:800;letter-spacing:1.5px;color:${burgundy};text-transform:uppercase">${esc(f.name)}</div>` +
    (f.role ? `<div style="margin-top:4px;font-size:15px;color:#6b6b6b">${esc(f.role)}</div>` : "") +
    phonePill +
    igMailPill +
    `</td></tr></table>`
  );
}

/** HTML final d'une signature (image ou carte HTML) pour l'insérer dans un email. */
export function renderSignatureHtml(sig: MailSignature | null): string {
  if (!sig) return "";
  if (sig.kind === "html" && sig.fields) return htmlSignatureMarkup(sig.fields);
  if (sig.url) return signatureImgHtml(sig.url);
  return "";
}

/** Champs pré-remplis (signature Marc). */
export function defaultSigFields(): SigFields {
  return { name: "Marc Maher B", role: "Co-founder 👋", phone: "+33 7 66 25 98 03", instagram: "ttp.creators", email: "marc@ttpcreators.pro" };
}

function normalize(v: unknown): SigState {
  const s = v as SigState | undefined;
  if (!s || !Array.isArray(s.list)) return EMPTY;
  const list = s.list.map((x) => ({ ...x, kind: x.kind ?? "image" })) as MailSignature[]; // rétro-compat
  return { list, defaultId: s.defaultId ?? "" };
}
async function readFresh(): Promise<SigState> {
  invalidateAppState();
  return normalize((await getAppState())[KEY]);
}

/** Upload une image dans le bucket documents → { url signée, path }. */
async function uploadImage(file: File): Promise<{ url: string; path: string } | null> {
  if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) {
    toast("Formats acceptés : PNG, JPEG, WebP");
    return null;
  }
  if (file.size > MAX_MB * 1024 * 1024) {
    toast(`Image trop lourde (max ${MAX_MB} Mo)`);
    return null;
  }
  const ext = (/\.([a-z0-9]+)$/i.exec(file.name)?.[1] ?? "png").toLowerCase();
  const path = `signatures/${uid()}.${ext}`;
  const up = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (up.error) {
    toast("Upload échoué — réessaie");
    return null;
  }
  const signed = await supabase.storage.from("documents").createSignedUrl(path, TTL);
  const url = signed.data?.signedUrl ?? "";
  if (!url) {
    await supabase.storage.from("documents").remove([path]).catch(() => {});
    toast("URL indisponible — réessaie");
    return null;
  }
  return { url, path };
}

export function useMailSignatures() {
  const { data } = useAppState<SigState>((s: AppState) => normalize(s[KEY]));
  // Override optimiste : nos mutations sont visibles immédiatement.
  const [override, setOverride] = useState<SigState | null>(null);
  const [busy, setBusy] = useState(false);
  const state = override ?? data ?? EMPTY;

  const commit = async (next: SigState): Promise<boolean> => {
    const ok = await saveAppStateKey(KEY, next);
    if (ok) setOverride(next);
    return ok;
  };

  const addImage = async (file: File): Promise<MailSignature | null> => {
    if (busy) return null;
    setBusy(true);
    try {
      const up = await uploadImage(file);
      if (!up) return null;
      const sig: MailSignature = { id: uid(), name: file.name.replace(/\.[^.]+$/, "") || "Signature", kind: "image", path: up.path, url: up.url };
      const cur = await readFresh();
      const next: SigState = { list: [sig, ...cur.list], defaultId: cur.defaultId || sig.id };
      if (!(await commit(next))) {
        await supabase.storage.from("documents").remove([up.path]).catch(() => {});
        toast("Signature non enregistrée — réessaie");
        return null;
      }
      toast("Signature ajoutée ✓");
      return sig;
    } finally {
      setBusy(false);
    }
  };

  /** Upload de la photo d'une carte HTML (renvoie url+path pour les champs). */
  const uploadPhoto = async (file: File): Promise<{ url: string; path: string } | null> => {
    if (busy) return null;
    setBusy(true);
    try {
      return await uploadImage(file);
    } finally {
      setBusy(false);
    }
  };

  const saveHtml = async (fields: SigFields, id?: string): Promise<MailSignature | null> => {
    const cur = await readFresh();
    const sigId = id ?? uid();
    const sig: MailSignature = { id: sigId, name: fields.name || "Signature", kind: "html", fields };
    const exists = cur.list.some((s) => s.id === sigId);
    const list = exists ? cur.list.map((s) => (s.id === sigId ? sig : s)) : [sig, ...cur.list];
    const next: SigState = { list, defaultId: cur.defaultId || sigId };
    if (!(await commit(next))) {
      toast("Signature non enregistrée — réessaie");
      return null;
    }
    toast("Signature enregistrée ✓");
    return sig;
  };

  const remove = async (id: string): Promise<void> => {
    const cur = await readFresh();
    const sig = cur.list.find((s) => s.id === id);
    const list = cur.list.filter((s) => s.id !== id);
    const defaultId = cur.defaultId === id ? (list[0]?.id ?? "") : cur.defaultId;
    const ok = await commit({ list, defaultId });
    if (ok && sig) {
      const p = sig.kind === "html" ? sig.fields?.photoPath : sig.path;
      if (p) await supabase.storage.from("documents").remove([p]).catch(() => {});
    }
    toast(ok ? "Signature supprimée" : "Erreur — réessaie");
  };

  const setDefault = async (id: string): Promise<void> => {
    const cur = await readFresh();
    const ok = await commit({ ...cur, defaultId: id });
    toast(ok ? "Signature par défaut ✓" : "Erreur — réessaie");
  };

  return { list: state.list, defaultId: state.defaultId, busy, addImage, uploadPhoto, saveHtml, remove, setDefault };
}
