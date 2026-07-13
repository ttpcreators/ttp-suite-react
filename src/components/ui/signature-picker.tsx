import { useEffect, useRef, useState } from "react";
import { Plus, Star, Trash2, Code2, X, Upload, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useMailSignatures,
  htmlSignatureMarkup,
  defaultSigFields,
  type MailSignature,
  type SigFields,
} from "@/lib/useMailSignatures";

/**
 * Choix de la signature d'un email : miniatures (image ou carte HTML), ajout
 * d'une image, création/édition d'une carte HTML cliquable. Se remonte via `key`
 * à chaque ouverture de modale pour re-présélectionner la signature par défaut.
 */
export function SignaturePicker({
  value,
  onChange,
}: {
  value: MailSignature | null;
  onChange: (s: MailSignature | null) => void;
}) {
  const { list, defaultId, busy, addImage, uploadPhoto, saveHtml, remove, setDefault } = useMailSignatures();
  const imgRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const seeded = useRef(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [fields, setFields] = useState<SigFields>(defaultSigFields());

  // Présélectionne la signature par défaut à l'ouverture (si rien de choisi).
  useEffect(() => {
    if (seeded.current || value) return;
    const d = list.find((s) => s.id === defaultId);
    if (d) {
      seeded.current = true;
      onChange(d);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, defaultId]);

  const onImg = async (f: File) => {
    const s = await addImage(f);
    if (s) onChange(s);
  };
  const openForm = (sig?: MailSignature) => {
    setEditId(sig?.id ?? null);
    setFields(sig?.fields ? { ...sig.fields } : defaultSigFields());
    setFormOpen(true);
  };
  const onPhoto = async (f: File) => {
    const up = await uploadPhoto(f);
    if (up) setFields((x) => ({ ...x, photoUrl: up.url, photoPath: up.path }));
  };
  const saveForm = async () => {
    if (!fields.name.trim()) return;
    const s = await saveHtml(fields, editId ?? undefined);
    if (s) {
      onChange(s);
      setFormOpen(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={cn(
            "grid h-14 min-w-[56px] place-items-center rounded-lg border px-3 text-[11px] font-medium transition-colors",
            value === null ? "border-primary text-foreground ring-1 ring-primary" : "border-border text-muted-foreground hover:bg-rowhover",
          )}
        >
          Aucune
        </button>
        {list.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onChange(s)}
            title={s.name}
            className={cn(
              "relative grid h-14 place-items-center overflow-hidden rounded-lg border transition-colors",
              s.kind === "html" ? "w-32 bg-surface px-2" : "w-24 bg-white p-1",
              value?.id === s.id ? "border-primary ring-1 ring-primary" : "border-border hover:bg-rowhover",
            )}
          >
            {s.kind === "html" ? (
              <span className="flex flex-col items-center gap-0.5">
                <Code2 className="h-4 w-4 text-primary" />
                <span className="max-w-[110px] truncate text-[10px] font-medium text-foreground">{s.name}</span>
              </span>
            ) : (
              <img src={s.url} alt={s.name} className="max-h-full max-w-full object-contain" />
            )}
            {defaultId === s.id && (
              <span className="absolute right-0.5 top-0.5 rounded bg-primary px-1 text-[7px] font-bold uppercase text-primary-foreground">déf.</span>
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={() => imgRef.current?.click()}
          disabled={busy}
          title="Ajouter une image (PNG/JPEG)"
          className="grid h-14 w-14 place-items-center rounded-lg border border-dashed border-border text-faint transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50"
        >
          {busy ? "…" : <Plus className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => openForm()}
          title="Créer une signature HTML cliquable"
          className="grid h-14 w-14 place-items-center gap-0.5 rounded-lg border border-dashed border-border text-faint transition-colors hover:bg-rowhover hover:text-foreground"
        >
          <Code2 className="h-4 w-4" />
          <span className="text-[8px] font-semibold uppercase">HTML</span>
        </button>
        <input
          ref={imgRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImg(f);
            e.target.value = "";
          }}
        />
      </div>

      {value && (
        <div className="flex flex-col gap-2">
          {value.kind === "html" && value.fields && (
            <div className="overflow-x-auto rounded-lg border border-border bg-white p-3">
              <div dangerouslySetInnerHTML={{ __html: htmlSignatureMarkup(value.fields) }} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 text-[10px] text-faint">
            {value.kind === "html" && (
              <button type="button" onClick={() => openForm(value)} className="inline-flex items-center gap-1 hover:text-foreground">
                <Pencil className="h-3 w-3" /> Modifier
              </button>
            )}
            {defaultId !== value.id && (
              <button type="button" onClick={() => setDefault(value.id)} className="inline-flex items-center gap-1 hover:text-foreground">
                <Star className="h-3 w-3" /> Définir par défaut
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                remove(value.id);
                onChange(null);
              }}
              className="inline-flex items-center gap-1 text-[#E5484D] hover:underline"
            >
              <Trash2 className="h-3 w-3" /> Supprimer
            </button>
          </div>
        </div>
      )}

      {/* Modale : créer / modifier une signature HTML */}
      {formOpen && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-4" onClick={() => setFormOpen(false)}>
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="text-sm font-semibold">{editId ? "Modifier la signature" : "Nouvelle signature HTML"}</div>
              <button type="button" onClick={() => setFormOpen(false)} className="grid h-9 w-9 place-items-center rounded-lg text-faint hover:bg-rowhover hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-2xl border border-border bg-panel">
                  {fields.photoUrl ? <img src={fields.photoUrl} alt="" className="h-full w-full object-cover" /> : <span className="text-[9px] text-faint">Photo</span>}
                </div>
                <button
                  type="button"
                  onClick={() => photoRef.current?.click()}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-rowhover hover:text-foreground disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" /> {busy ? "Envoi…" : fields.photoUrl ? "Changer la photo" : "Photo (PNG/JPEG)"}
                </button>
                <input
                  ref={photoRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onPhoto(f);
                    e.target.value = "";
                  }}
                />
              </div>
              <SigField label="Nom" v={fields.name} set={(v) => setFields((x) => ({ ...x, name: v }))} />
              <SigField label="Rôle" v={fields.role} set={(v) => setFields((x) => ({ ...x, role: v }))} />
              <SigField label="Mobile" v={fields.phone} set={(v) => setFields((x) => ({ ...x, phone: v }))} />
              <SigField label="Instagram (sans @)" v={fields.instagram} set={(v) => setFields((x) => ({ ...x, instagram: v }))} />
              <SigField label="Email" v={fields.email} set={(v) => setFields((x) => ({ ...x, email: v }))} />

              <div>
                <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-faint">Aperçu</div>
                <div className="overflow-x-auto rounded-lg border border-border bg-white p-3">
                  <div dangerouslySetInnerHTML={{ __html: htmlSignatureMarkup(fields) }} />
                </div>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setFormOpen(false)} className="rounded-lg border border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:bg-rowhover">
                Annuler
              </button>
              <button
                type="button"
                onClick={saveForm}
                disabled={busy || !fields.name.trim()}
                className="rounded-lg bg-primary px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SigField({ label, v, set }: { label: string; v: string; set: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-faint">{label}</span>
      <input
        value={v}
        onChange={(e) => set(e.target.value)}
        className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
      />
    </label>
  );
}
