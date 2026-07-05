import { useState } from "react";
import { X, Users } from "lucide-react";

export type PickContact = { email: string; label: string; tag?: string };
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Éditeur de destinataires : recherche dans les contacts, ajout « tout le monde »,
 * saisie d'emails libres, chips retirables. `value` = liste d'emails (minuscules).
 */
export function RecipientPicker({
  value,
  onChange,
  contacts,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  contacts: PickContact[];
}) {
  const [q, setQ] = useState("");
  const has = (e: string) => value.some((v) => v.toLowerCase() === e.toLowerCase());
  const add = (e: string) => {
    const x = e.trim().toLowerCase();
    if (EMAIL_RE.test(x) && !has(x)) onChange([...value, x]);
  };
  const addMany = (raw: string) => {
    const merged = [...value];
    raw
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => EMAIL_RE.test(s))
      .forEach((s) => {
        if (!merged.some((v) => v.toLowerCase() === s)) merged.push(s);
      });
    if (merged.length !== value.length) onChange(merged);
  };
  const remove = (e: string) => onChange(value.filter((v) => v.toLowerCase() !== e.toLowerCase()));

  const term = q.trim().toLowerCase();
  const matches = term
    ? contacts
        .filter(
          (c) =>
            !has(c.email) &&
            (c.label.toLowerCase().includes(term) || c.email.toLowerCase().includes(term) || (c.tag ?? "").toLowerCase().includes(term)),
        )
        .slice(0, 8)
    : [];
  const allEmails = [...new Set(contacts.map((c) => c.email.toLowerCase()).filter((e) => EMAIL_RE.test(e)))];
  const notAdded = allEmails.filter((e) => !has(e));

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {value.map((e) => (
            <span key={e} className="inline-flex items-center gap-1 rounded-full bg-panel px-2.5 py-1 text-[11px] text-foreground">
              {e}
              <button type="button" onClick={() => remove(e)} className="text-faint transition-colors hover:text-[#E5484D]" aria-label={`Retirer ${e}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button type="button" onClick={() => onChange([])} className="ml-1 text-[10px] text-faint transition-colors hover:text-foreground">
            Tout retirer
          </button>
        </div>
      )}

      <div className="relative">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === ",") && EMAIL_RE.test(q.trim())) {
              e.preventDefault();
              add(q.trim());
              setQ("");
            }
          }}
          onBlur={() => {
            if (q.trim()) {
              addMany(q);
              setQ("");
            }
          }}
          placeholder="Rechercher un contact ou taper un email…"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
        {matches.length > 0 && (
          <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
            {matches.map((c) => (
              <button
                key={c.email}
                type="button"
                onMouseDown={(e) => {
                  // onMouseDown (avant le blur de l'input) pour ne pas perdre le clic
                  e.preventDefault();
                  add(c.email);
                  setQ("");
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-rowhover"
              >
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">{c.label || c.email}</span>
                <span className="shrink-0 truncate text-[11px] text-faint">{c.email}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {notAdded.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([...value, ...notAdded])}
          className="inline-flex items-center gap-1.5 self-start rounded-full border border-border bg-surface px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground"
        >
          <Users className="h-3 w-3" /> Tout le monde ({notAdded.length})
        </button>
      )}
      <p className="text-[10px] text-faint">Chaque personne reçoit un mail séparé — les destinataires ne se voient pas entre eux.</p>
    </div>
  );
}
