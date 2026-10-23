import { describe, expect, it } from "vitest";
import { clip, deepLinkUrl, makePayload, pushTopic, safeUrl, tidyText } from "../../supabase/functions/_shared/pushPayload.ts";
import {
  agencyMailPayloads, cleanSnippet, creatorAddresses, creatorMailPayloads, creatorsForMail, decodeEntities, groupByThread,
  senderName, type CreatorMailSetting, type NewMail,
} from "../../supabase/functions/_shared/mailNotif.ts";
import { buildDeepLink, parseDeepLink, stripDeepLink } from "./deepLink";

let seq = 0;
const mail = (p: Partial<NewMail> = {}): NewMail => ({
  id: `m${++seq}`,
  threadId: "t1",
  box: "partnerships",
  from: '"Julie Durand" <julie@nike.com>',
  subject: "Partenariat Nike",
  snippet: "Bonjour, je reviens vers vous pour la campagne de novembre.",
  ts: 1000 + seq,
  ...p,
});

describe("notifications : format commun", () => {
  it("texte sobre : sans émoji ni tiret long, une ligne", () => {
    expect(tidyText("Ta journée 🎉 — 3 tâches\n2 RDV")).toBe("Ta journée · 3 tâches · 2 RDV");
    expect(tidyText("objet\n\n extrait  long ", true)).toBe("objet\nextrait long");
    expect(tidyText("a–b")).toBe("a-b");
  });

  it("coupe au mot avec « … »", () => {
    expect(clip("un deux trois quatre", 12)).toBe("un deux…");
    expect(clip("court", 12)).toBe("court");
  });

  it("adresse interne seulement", () => {
    expect(safeUrl("/?open=mails")).toBe("/?open=mails");
    expect(safeUrl("https://evil.com")).toBe("/");
    expect(safeUrl("//evil.com")).toBe("/");
    expect(safeUrl(undefined)).toBe("/");
  });

  it("charge complète, majuscule en tête pour les résumés", () => {
    const p = makePayload({ kind: "digest", title: "Ta journée", body: "2 évènements · 1 RDV demain", tag: "ttp-daily", ts: 5 }, { capitalize: true });
    expect(p).toEqual({ title: "Ta journée", body: "2 évènements · 1 RDV demain", url: "/", tag: "ttp-daily", kind: "digest", ts: 5 });
    expect(makePayload({ kind: "test", title: "", body: "x", tag: "" }).title).toBe("TTP Suite");
  });

  it("topic Web Push court et sûr", () => {
    expect(pushTopic("mail:18f2a9c0d1e2f3a4")).toBe("mail-18f2a9c0d1e2f3a4");
    expect(pushTopic("x".repeat(50))).toHaveLength(32);
  });
});

describe("liens d'ouverture (serveur ↔ app)", () => {
  it("le lien du serveur est lu tel quel par l'app", () => {
    const a = deepLinkUrl({ open: "mails", thread: "18f2a9c0d1e2f3a4", box: "talent" });
    expect(a).toBe("/?open=mails&thread=18f2a9c0d1e2f3a4&box=talent");
    expect(parseDeepLink(a)).toEqual({ open: "mails", thread: "18f2a9c0d1e2f3a4", box: "talent" });
    expect(buildDeepLink({ open: "mails", thread: "18f2a9c0d1e2f3a4", box: "talent" })).toBe(a);
    const c = deepLinkUrl({ open: "cs-mails", thread: "abc" });
    expect(parseDeepLink(`https://app.ttpcreators.pro${c}`)).toEqual({ open: "cs-mails", thread: "abc" });
    expect(buildDeepLink({ open: "cs-mails" })).toBe(deepLinkUrl({ open: "cs-mails" }));
  });

  it("refuse un fil ou une boîte invalides", () => {
    expect(parseDeepLink("?open=mails&thread=<script>&box=talent")).toEqual({ open: "mails" });
    expect(parseDeepLink("?open=mails&thread=abc&box=autre")).toEqual({ open: "mails", thread: "abc" });
    expect(parseDeepLink("?open=autre")).toBeNull();
    expect(parseDeepLink("/")).toBeNull();
  });

  it("pages agence et onglets créateur, avec l'objet visé", () => {
    const v = deepLinkUrl({ open: "view", view: "todo", item: "6f1c2b3a-0000-4000-8000-000000000001" });
    expect(v).toBe("/?open=view&view=todo&item=6f1c2b3a-0000-4000-8000-000000000001");
    expect(parseDeepLink(v)).toEqual({ open: "view", view: "todo", item: "6f1c2b3a-0000-4000-8000-000000000001" });
    expect(buildDeepLink({ open: "view", view: "todo", item: "6f1c2b3a-0000-4000-8000-000000000001" })).toBe(v);
    const c = deepLinkUrl({ open: "cs-tab", tab: "ideas" });
    expect(parseDeepLink(c)).toEqual({ open: "cs-tab", tab: "ideas" });
    expect(deepLinkUrl({ open: "view", view: "<x>" })).toBe("/");
    expect(parseDeepLink("?open=view&view=TODO")).toBeNull();
    expect(stripDeepLink("https://app.ttpcreators.pro/?open=cs-tab&tab=todo&item=a")).toBe("/");
  });

  it("retire seulement les paramètres du lien", () => {
    expect(stripDeepLink("https://app.ttpcreators.pro/?open=mails&thread=abc&box=talent")).toBe("/");
    expect(stripDeepLink("https://app.ttpcreators.pro/?x=1&open=cs-mails#h")).toBe("/?x=1#h");
  });
});

describe("mails : texte des notifications", () => {
  it("extrait propre : entités, invisibles, citation coupée", () => {
    expect(decodeEntities("l&#39;offre &amp; le brief &lt;3 &#x2014;")).toBe("l'offre & le brief <3 —");
    expect(cleanSnippet("Super‌͏  merci&nbsp;!  Le lun. 12 oct. 2026 à 10:00, Julie &lt;julie@nike.com&gt; a écrit : bla")).toBe("Super merci !");
    expect(cleanSnippet("Thanks! On Mon, Oct 12, 2026 at 10:00 AM Julie wrote: old")).toBe("Thanks!");
    const long = cleanSnippet("mot ".repeat(60));
    expect(long.length).toBeLessThanOrEqual(90);
    expect(long.endsWith("…")).toBe(true);
  });

  it("nom de l'expéditeur, sinon son adresse", () => {
    expect(senderName('"Julie Durand" <julie@nike.com>')).toBe("Julie Durand");
    expect(senderName("Nike Partnerships <p@nike.com>")).toBe("Nike Partnerships");
    expect(senderName("<julie@nike.com>")).toBe("julie@nike.com");
    expect(senderName("julie@nike.com")).toBe("julie@nike.com");
    expect(senderName('"julie@nike.com" <julie@nike.com>')).toBe("julie@nike.com");
  });

  it("un fil = une notification (objet, boîte, extrait), lien vers le fil", () => {
    const [p] = agencyMailPayloads([mail({ threadId: "abc", box: "talent" })]);
    expect(p.kind).toBe("mail");
    expect(p.title).toBe("Julie Durand");
    expect(p.body).toBe("Partenariat Nike\ntalent@ · Bonjour, je reviens vers vous pour la campagne de novembre.");
    expect(p.tag).toBe("mail:abc");
    expect(p.url).toBe("/?open=mails&thread=abc&box=talent");
    expect(p.threadId).toBe("abc");
    expect(p.body).not.toMatch(/[—–]/);
  });

  it("plusieurs mails du même fil : une notification, avec le compte", () => {
    const ps = agencyMailPayloads([mail({ threadId: "a", subject: "Re: 1" }), mail({ threadId: "a", subject: "Re: 2" })]);
    expect(ps).toHaveLength(1);
    expect(ps[0].title).toBe("Julie Durand (2)");
    expect(ps[0].body.startsWith("Re: 2\n")).toBe(true);
    expect(ps[0].count).toBe(2);
  });

  it("jusqu'à 3 fils : une notification chacun ; au-delà, un résumé", () => {
    const three = ["a", "b", "c"].map((t) => mail({ threadId: t }));
    expect(agencyMailPayloads(three).map((p) => p.tag)).toEqual(["mail:c", "mail:b", "mail:a"]);
    const five = [
      mail({ threadId: "a", from: "Nike <a@nike.com>" }),
      mail({ threadId: "b", from: "Sephora <b@sephora.fr>" }),
      mail({ threadId: "c", from: "Zara <c@zara.com>" }),
      mail({ threadId: "d", from: "Dior <d@dior.com>" }),
      mail({ threadId: "d", from: "Dior <d@dior.com>" }),
    ];
    const ps = agencyMailPayloads(five);
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ kind: "mail-summary", title: "5 nouveaux mails", tag: "mail:summary", url: "/?open=mails", count: 5 });
    expect(ps[0].body).toBe("Dior, Zara, Sephora et 1 autre");
  });

  it("créateur : objet + extrait, en anglais si son espace l'est", () => {
    const [fr] = creatorMailPayloads([mail({ threadId: "x", subject: "" })], "fr");
    expect(fr).toMatchObject({ kind: "creator-mail", title: "Julie Durand", tag: "mail:x", url: "/?open=cs-mails&thread=x" });
    expect(fr.body.startsWith("(sans objet)\n")).toBe(true);
    expect(fr.body).not.toContain("partnerships@");
    const [en] = creatorMailPayloads([mail({ threadId: "y", subject: "" })], "en");
    expect(en.body.startsWith("(no subject)")).toBe(true);
    expect(en.lang).toBe("en");
    const sum = creatorMailPayloads(["a", "b", "c", "d"].map((t) => mail({ threadId: t })), "en");
    expect(sum[0]).toMatchObject({ kind: "creator-mail-summary", title: "4 new emails", url: "/?open=cs-mails" });
  });

  it("regroupe par boîte et par fil, le plus récent d'abord", () => {
    const g = groupByThread([mail({ threadId: "a", ts: 1 }), mail({ threadId: "a", box: "talent", ts: 3 }), mail({ threadId: "a", ts: 2 })]);
    expect(g.map((x) => [x.box, x.count])).toEqual([["talent", 1], ["partnerships", 2]]);
  });
});

describe("mails des créateurs : qui prévenir", () => {
  const DOMAIN = "ttpcreators.pro";
  const lea: CreatorMailSetting = { creator: "Léa", alias: "lea@ttpcreators.pro", aliases: ["lea.collab@ttpcreators.pro"], enabled: true };
  const tom: CreatorMailSetting = { creator: "Tom", alias: "tom@ttpcreators.pro", enabled: true };
  const off: CreatorMailSetting = { creator: "Zoé", alias: "zoe@ttpcreators.pro", enabled: false };
  const settings = [lea, tom, off];

  it("mail d'une marque à son alias ou à une adresse en plus", () => {
    expect(creatorsForMail(mail({ to: "Léa <lea@ttpcreators.pro>" }), settings, DOMAIN)).toEqual(["Léa"]);
    expect(creatorsForMail(mail({ cc: "LEA.COLLAB@ttpcreators.pro" }), settings, DOMAIN)).toEqual(["Léa"]);
    expect(creatorsForMail(mail({ to: "talent@ttpcreators.pro", deliveredTo: "tom@ttpcreators.pro" }), settings, DOMAIN)).toEqual(["Tom"]);
    expect(creatorsForMail(mail({ to: "lea@ttpcreators.pro, tom@ttpcreators.pro" }), settings, DOMAIN)).toEqual(["Léa", "Tom"]);
  });

  it("colonne aliases absente : l'alias seul", () => {
    const old: CreatorMailSetting = { creator: "Léa", alias: "lea@ttpcreators.pro", enabled: true };
    expect(creatorsForMail(mail({ to: "lea@ttpcreators.pro" }), [old], DOMAIN)).toEqual(["Léa"]);
    expect(creatorsForMail(mail({ to: "lea.collab@ttpcreators.pro" }), [old], DOMAIN)).toEqual([]);
  });

  it("jamais un échange interne de l'agence, ni son propre envoi, ni un Mail coupé", () => {
    expect(creatorsForMail(mail({ from: "Marc <marc@ttpcreators.pro>", to: "lea@ttpcreators.pro" }), settings, DOMAIN)).toEqual([]);
    expect(creatorsForMail(mail({ from: "lea@ttpcreators.pro", to: "julie@nike.com, lea@ttpcreators.pro" }), settings, DOMAIN)).toEqual([]);
    expect(creatorsForMail(mail({ to: "zoe@ttpcreators.pro" }), settings, DOMAIN)).toEqual([]);
    expect(creatorsForMail(mail({ to: "lea@ttpcreators.pro", labelIds: ["SPAM"] }), settings, DOMAIN)).toEqual([]);
    expect(creatorsForMail(mail({ subject: "pour lea@ttpcreators.pro", to: "partnerships@ttpcreators.pro" }), settings, DOMAIN)).toEqual([]);
    expect(creatorsForMail(mail({ to: "clea@ttpcreators.pro" }), settings, DOMAIN)).toEqual([]);
  });

  it("une boîte partagée n'est jamais l'adresse d'un créateur", () => {
    const bad: CreatorMailSetting = { creator: "X", alias: "partnerships@ttpcreators.pro", aliases: ["talent@ttpcreators.pro", "x@ttpcreators.pro"], enabled: true };
    expect(creatorAddresses(bad, DOMAIN)).toEqual(["x@ttpcreators.pro"]);
    expect(creatorsForMail(mail({ to: "partnerships@ttpcreators.pro" }), [bad], DOMAIN)).toEqual([]);
  });

  it("libellé du créateur posé sur le mail", () => {
    const lab: CreatorMailSetting = { creator: "Léa", alias: null, label_id: "Label_7", enabled: true };
    expect(creatorsForMail(mail({ to: "partnerships@ttpcreators.pro", labelIds: ["INBOX", "Label_7"] }), [lab], DOMAIN)).toEqual(["Léa"]);
  });
});
