import { useEffect, useState } from "react";
import { useAppState, type AppState } from "@/lib/appState";
import { localMailSettings, readMailSettings, subscribeMailSettings, type MailSettings } from "@/lib/mailSend";

/** Réglages mails (signature, délai) : base partagée + dernier enregistrement de ce poste. */
export function useMailSettings(): MailSettings {
  const { data } = useAppState<MailSettings>((s: AppState) => readMailSettings(s));
  const [local, setLocal] = useState<MailSettings | null>(localMailSettings);
  useEffect(() => subscribeMailSettings(setLocal), []);
  return local ?? data ?? readMailSettings({} as AppState);
}
