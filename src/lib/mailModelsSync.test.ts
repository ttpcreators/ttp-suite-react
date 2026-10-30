import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES } from "./mailModels";
import { DEFAULT_MAIL_MODELS } from "../../supabase/functions/_shared/mailModels.ts";

describe("modèles de mails : copie serveur à jour", () => {
  it("le connecteur voit les mêmes modèles par défaut que l'app", () => {
    expect(DEFAULT_MAIL_MODELS).toEqual(DEFAULT_TEMPLATES);
  });
});
