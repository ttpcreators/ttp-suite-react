import { useState } from "react";
import { supabase } from "./supabase";
import { useAppState, saveAppStateKey, getAppState, invalidateAppState, type AppState } from "./appState";
import { toast } from "@/components/ui/toast";

/**
 * Signatures mail (images PNG/JPEG/WebP) que l'agence colle en bas de ses envois.
 * Les fichiers vont dans le bucket privé `documents` (dossier `signatures/`),
 * les métadonnées dans le blob agence `mailSignatures = { list, defaultId }`.
 * On stocke une URL signée très longue durée (≈10 ans) pour l'affichage direct
 * dans les emails (Gmail proxifie l'image ; l'URL doit rester valide).
 */
export type MailSignature = { id: string; name: string; path: string; url: string };
type SigState = { list: MailSignature[]; defaultId: string };

const KEY = "mailSignatures";
const MAX_MB = 3;
const TTL = 60 * 60 * 24 * 365 * 10; // ≈10 ans : URL signée quasi-permanente
const EMPTY: SigState = { list: [], defaultId: "" };
const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

/** Bloc <img> de signature à coller en bas d'un email. */
export function signatureImgHtml(url: string): string {
  return `<div style="margin-top:22px"><img src="${url}" alt="Signature" style="max-width:360px;width:100%;height:auto;border:0;display:block" /></div>`;
}

function normalize(v: unknown): SigState {
  const s = v as SigState | undefined;
  return s && Array.isArray(s.list) ? { list: s.list, defaultId: s.defaultId ?? "" } : EMPTY;
}
async function readFresh(): Promise<SigState> {
  invalidateAppState();
  return normalize((await getAppState())[KEY]);
}

export function useMailSignatures() {
  const { data } = useAppState<SigState>((s: AppState) => normalize(s[KEY]));
  // Override optimiste : nos propres mutations sont reflétées immédiatement
  // (useAppState ne notifie qu'au tick live suivant).
  const [override, setOverride] = useState<SigState | null>(null);
  const [busy, setBusy] = useState(false);
  const state = override ?? data ?? EMPTY;

  const add = async (file: File, name: string): Promise<MailSignature | null> => {
    if (busy) return null;
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) {
      toast("Formats acceptés : PNG, JPEG, WebP");
      return null;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      toast(`Image trop lourde (max ${MAX_MB} Mo)`);
      return null;
    }
    setBusy(true);
    try {
      const ext = (/\.([a-z0-9]+)$/i.exec(file.name)?.[1] ?? "png").toLowerCase();
      const path = `signatures/${uid()}.${ext}`;
      const up = await supabase.storage.from("documents").upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (up.error) {
        toast("Upload de la signature échoué — réessaie");
        return null;
      }
      const signed = await supabase.storage.from("documents").createSignedUrl(path, TTL);
      const url = signed.data?.signedUrl ?? "";
      if (!url) {
        await supabase.storage.from("documents").remove([path]).catch(() => {});
        toast("URL indisponible — réessaie");
        return null;
      }
      const sig: MailSignature = { id: uid(), name: name.trim() || "Signature", path, url };
      const cur = await readFresh();
      const next: SigState = { list: [sig, ...cur.list], defaultId: cur.defaultId || sig.id };
      const ok = await saveAppStateKey(KEY, next);
      if (!ok) {
        await supabase.storage.from("documents").remove([path]).catch(() => {});
        toast("Signature non enregistrée — réessaie");
        return null;
      }
      setOverride(next);
      toast("Signature ajoutée ✓");
      return sig;
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    const cur = await readFresh();
    const sig = cur.list.find((s) => s.id === id);
    const list = cur.list.filter((s) => s.id !== id);
    const defaultId = cur.defaultId === id ? (list[0]?.id ?? "") : cur.defaultId;
    const next: SigState = { list, defaultId };
    const ok = await saveAppStateKey(KEY, next);
    if (ok) {
      setOverride(next);
      if (sig) await supabase.storage.from("documents").remove([sig.path]).catch(() => {});
    }
    toast(ok ? "Signature supprimée" : "Erreur — réessaie");
  };

  const setDefault = async (id: string): Promise<void> => {
    const cur = await readFresh();
    const next: SigState = { ...cur, defaultId: id };
    const ok = await saveAppStateKey(KEY, next);
    if (ok) setOverride(next);
    toast(ok ? "Signature par défaut ✓" : "Erreur — réessaie");
  };

  return { list: state.list, defaultId: state.defaultId, busy, add, remove, setDefault };
}
