import { useEffect, useState } from "react";
import { ArrowUpRight, Check, MessagesSquare, Send, X } from "@/components/icons";
import { Spin } from "@/components/ui/loader";
import { Overlay } from "@/components/mobile/ios-sheet";
import { HelpTip } from "@/components/ui/help-tip";
import { PlatformIcon } from "@/components/ui/platform-icon";
import { toast } from "@/components/ui/toast";
import { supabase } from "@/lib/supabase";
import { requestIntent } from "@/lib/openIntent";
import { fmtDay } from "@/lib/dates";

/**
 * « Écrire à @marque » depuis un compte cité (collabs d'un créateur, Sourcing).
 *  • Déjà une conversation avec ce compte (DM du compte TTP, table ig_threads) : « Ouvrir »
 *    la montre dans la page DM Instagram, où l'on répond depuis l'app.
 *  • Sinon : Meta ne laisse pas une app écrire en premier. Le message est copié et la
 *    conversation s'ouvre dans Instagram ; sa réponse arrive ensuite toute seule dans
 *    DM Instagram (ig-inbox), et l'échange continue dans l'app.
 */
type Thread = { id: string; last_text: string | null; last_from_me: boolean | null; updated_at: string | null };

const clean = (u: string) => u.trim().replace(/^@/, "").toLowerCase();

export function IgDmStart({ username, onClose, onLeave }: {
  username: string;
  onClose: () => void;
  /** Appelé en quittant la page pour DM Instagram (pour fermer les fenêtres en dessous). */
  onLeave?: () => void;
}) {
  const u = clean(username);
  const [thread, setThread] = useState<Thread | null | undefined>(undefined);
  const [text, setText] = useState("");
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    let alive = true;
    void supabase
      .from("ig_threads")
      .select("id, last_text, last_from_me, updated_at")
      .ilike("username", u.replace(/[\\%_]/g, (m) => `\\${m}`))
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .then(({ data, error }) => {
        if (alive) setThread(error ? null : ((data?.[0] as Thread | undefined) ?? null));
      });
    return () => {
      alive = false;
    };
  }, [u]);

  const openInApp = (id: string) => {
    requestIntent("dm:open", id);
    window.dispatchEvent(new CustomEvent("ttp-navigate", { detail: "messages" }));
    onClose();
    onLeave?.();
  };
  // Dans le clic (iPhone : un onglet ouvert après un await est bloqué).
  const writeOnInstagram = () => {
    if (text.trim()) {
      void navigator.clipboard?.writeText(text.trim()).then(
        () => toast("Message copié : colle-le dans la conversation"),
        () => toast("Copie impossible : sélectionne le texte à la main"),
      );
    }
    window.open(`https://ig.me/m/${encodeURIComponent(u)}`, "_blank", "noopener");
    setOpened(true);
  };

  return (
    <Overlay className="fixed inset-0 z-[120] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClose={onClose} label={`Écrire à @${u}`}>
      <div className="w-full max-w-md rounded-t-[24px] bg-surface p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-xl sm:rounded-[24px] sm:pb-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-field text-muted-foreground">
            <PlatformIcon platform="instagram" className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[16px] font-semibold text-foreground">@{u}</div>
            <a href={`https://www.instagram.com/${u}/`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[12.5px] text-muted-foreground hover:text-foreground">
              Voir le profil <ArrowUpRight className="h-3 w-3" />
            </a>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-field text-muted-foreground transition-colors hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {thread === undefined ? (
          <div className="flex justify-center py-8"><Spin size={18} /></div>
        ) : thread ? (
          <div className="mt-4 flex flex-col gap-3">
            <div className="rounded-[16px] bg-panel p-3.5">
              <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <MessagesSquare className="h-3.5 w-3.5" /> Conversation en cours{thread.updated_at ? ` · ${fmtDay(thread.updated_at)}` : ""}
              </div>
              {thread.last_text && (
                <p className="mt-1.5 line-clamp-2 text-[14px] text-foreground">
                  {thread.last_from_me ? <span className="text-muted-foreground">Toi : </span> : null}
                  {thread.last_text}
                </p>
              )}
            </div>
            <button type="button" onClick={() => openInApp(thread.id)} className="flex h-12 items-center justify-center gap-2 rounded-full bg-primary text-[15px] font-semibold text-primary-foreground transition-opacity hover:opacity-90">
              <MessagesSquare className="h-4 w-4" /> Ouvrir
            </button>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              Pas encore de conversation
              <HelpTip title="Pourquoi Instagram s'ouvre ?">
                Meta ne laisse pas une app écrire en premier en message privé. Ton message est copié et la conversation s'ouvre dans
                Instagram : colle-le et envoie. Dès que le compte répond, la discussion arrive dans DM Instagram et tu continues depuis l'app.
              </HelpTip>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder={`Ton premier message à @${u}`}
              className="w-full resize-none rounded-[16px] border border-border bg-field px-3.5 py-3 text-[16px] leading-snug text-foreground outline-none placeholder:text-faint focus:border-primary"
            />
            {opened ? (
              <div className="flex items-center gap-2 rounded-[16px] bg-panel px-3.5 py-3 text-[13px] text-muted-foreground">
                <Check className="h-4 w-4 shrink-0 text-signaltext" /> Sa réponse arrivera dans DM Instagram.
              </div>
            ) : null}
            <button type="button" onClick={writeOnInstagram} className="flex h-12 items-center justify-center gap-2 rounded-full bg-primary text-[15px] font-semibold text-primary-foreground transition-opacity hover:opacity-90">
              <Send className="h-4 w-4" /> {opened ? "Rouvrir" : "Écrire"}
            </button>
          </div>
        )}
      </div>
    </Overlay>
  );
}
