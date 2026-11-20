// ============================================================================
// _shared/mxCheck.ts : le domaine d'une adresse peut-il recevoir des mails ?
// (liste de Gianni, point 7 : « contrôle du domaine avant chaque premier mail »).
// On interroge le DNS public (dns.google, en HTTPS) : enregistrement MX du domaine.
// Une boîte précise ne peut pas être vérifiée sans envoyer : les rebonds s'en chargent
// (gmail-poll). Dans le doute (DNS injoignable), on ne bloque rien.
// ============================================================================

export type MxVerdict = { ok: true } | { ok: false; raison: string } | { ok: null };

type DnsJson = { Status?: number; Answer?: { type?: number; data?: string }[] };

/** Verdict à partir de la réponse DNS des MX (et des A si pas de MX). */
export function verdictMx(mx: DnsJson | null, a?: DnsJson | null): MxVerdict {
  if (!mx || typeof mx.Status !== "number") return { ok: null };
  if (mx.Status === 3) return { ok: false, raison: "domaine inexistant" };
  if (mx.Status !== 0) return { ok: null };
  const mxs = (mx.Answer ?? []).filter((x) => x.type === 15 && String(x.data ?? "").trim() && !/^0 \.$/.test(String(x.data).trim()));
  if (mxs.length) return { ok: true };
  if ((mx.Answer ?? []).some((x) => x.type === 15 && /^0 \.$/.test(String(x.data ?? "").trim()))) return { ok: false, raison: "le domaine refuse tout mail" };
  if (a && a.Status === 0 && (a.Answer ?? []).some((x) => x.type === 1)) return { ok: false, raison: "domaine sans serveur mail" };
  return { ok: false, raison: "domaine sans serveur mail" };
}

export function domaineDe(email: string): string {
  return (email.split("@")[1] ?? "").trim().toLowerCase().replace(/\.$/, "");
}

async function dns(nom: string, type: string): Promise<DnsJson | null> {
  try {
    const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(nom)}&type=${type}`, { signal: AbortSignal.timeout(4000) });
    return r.ok ? ((await r.json()) as DnsJson) : null;
  } catch {
    return null;
  }
}

/** Vérifie chaque domaine une fois. Renvoie les adresses refusées avec la raison. */
export async function verifierDomaines(adresses: string[]): Promise<{ email: string; raison: string }[]> {
  const parDomaine = new Map<string, MxVerdict>();
  for (const d of [...new Set(adresses.map(domaineDe).filter(Boolean))]) {
    const mx = await dns(d, "MX");
    parDomaine.set(d, verdictMx(mx, mx && mx.Status === 0 && !(mx.Answer ?? []).some((x) => x.type === 15) ? await dns(d, "A") : null));
  }
  return adresses.flatMap((e) => {
    const v = parDomaine.get(domaineDe(e));
    return v && v.ok === false ? [{ email: e, raison: v.raison }] : [];
  });
}
