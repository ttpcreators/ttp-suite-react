import { describe, expect, it } from "vitest";
import { notifsVisibles } from "./notifTabs";

const items = [
  { id: "nouvelle", unread: true },
  { id: "lue", unread: false },
  { id: "facture-nouvelle", unread: true, actionable: true },
  { id: "facture-lue", unread: false, actionable: true },
  { id: "archivee", unread: true, archived: true },
  { id: "archivee-lue", unread: false, archived: true },
];
const ids = (tab: Parameters<typeof notifsVisibles>[1]) => notifsVisibles(items, tab).map((n) => n.id);

describe("notifsVisibles", () => {
  it("Non lues : seulement les non lues, hors archivées", () => {
    expect(ids("unread")).toEqual(["nouvelle", "facture-nouvelle"]);
  });

  it("À traiter : une notification lue ne s'affiche plus", () => {
    expect(ids("todo")).toEqual(["facture-nouvelle"]);
  });

  it("Archivées : toutes les archivées, lues ou non", () => {
    expect(ids("archived")).toEqual(["archivee", "archivee-lue"]);
  });
});
