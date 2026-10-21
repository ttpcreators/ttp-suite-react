import { describe, expect, it } from "vitest";
import { localEnd, meetEventBody, meetLinkOf, parseMeetRequest, type MeetRequest } from "./meetEvent.ts";

const ok = { title: "Call Nike — TTP", date: "2026-10-28", time: "14:30", duration: 30, guests: ["Anna@Nike.com", "anna@nike.com"] };

describe("rendez-vous Meet", () => {
  it("valide et nettoie la demande", () => {
    const r = parseMeetRequest(ok) as MeetRequest;
    expect(r.title).toBe("Call Nike, TTP");
    expect(r.guests).toEqual(["anna@nike.com"]);
    expect(r.meet).toBe(true);
    expect(r.invite).toBe(true);
    expect(parseMeetRequest({ ...ok, guests: [] })).toMatchObject({ invite: false });
  });
  it("refuse ce qui est faux", () => {
    expect(parseMeetRequest({ ...ok, title: " " })).toEqual({ error: "titre_requis" });
    expect(parseMeetRequest({ ...ok, date: "28/10/2026" })).toEqual({ error: "date_invalide" });
    expect(parseMeetRequest({ ...ok, time: "25:00" })).toEqual({ error: "heure_invalide" });
    expect(parseMeetRequest({ ...ok, duration: 0 })).toEqual({ error: "duree_invalide" });
    expect(parseMeetRequest({ ...ok, guests: ["pas-une-adresse"] })).toEqual({ error: "invite_invalide" });
  });
  it("calcule la fin, y compris après minuit", () => {
    expect(localEnd("2026-10-28", "14:30", 30)).toBe("2026-10-28T15:00:00");
    expect(localEnd("2026-10-31", "23:30", 60)).toBe("2026-11-01T00:30:00");
  });
  it("construit l'évènement avec Meet et invités", () => {
    const b = meetEventBody(parseMeetRequest(ok) as MeetRequest, "Europe/Paris", "req1");
    expect(b.start).toEqual({ dateTime: "2026-10-28T14:30:00", timeZone: "Europe/Paris" });
    expect(b.attendees).toEqual([{ email: "anna@nike.com" }]);
    expect(b).toHaveProperty("conferenceData.createRequest.conferenceSolutionKey.type", "hangoutsMeet");
    expect(meetEventBody({ ...(parseMeetRequest(ok) as MeetRequest), meet: false }, "Europe/Paris", "r")).not.toHaveProperty("conferenceData");
  });
  it("trouve le lien Meet", () => {
    expect(meetLinkOf({ hangoutLink: "https://meet.google.com/abc" })).toBe("https://meet.google.com/abc");
    expect(meetLinkOf({ conferenceData: { entryPoints: [{ entryPointType: "phone", uri: "tel:1" }, { entryPointType: "video", uri: "https://meet.google.com/x" }] } })).toBe("https://meet.google.com/x");
    expect(meetLinkOf({})).toBe("");
  });
});
