import { describe, expect, it } from "vitest";
import { extFor, mediaFromMessage, metaFileUrl } from "./igMedia.ts";

describe("photos et vidéos des DM Instagram", () => {
  it("lit photos, vidéos, vocaux, partages et stories", () => {
    const m = {
      attachments: { data: [
        { image_data: { url: "https://scontent.cdninstagram.com/a.jpg", preview_url: "p" } },
        { video_data: { url: "https://video.fbcdn.net/v.mp4" } },
        { mime_type: "audio/mpeg", file_url: "https://lookaside.fbsbx.com/x" },
      ] },
      shares: { data: [{ link: "https://www.instagram.com/reel/abc/", name: "Reel" }] },
      story: { reply_to: { link: "https://lookaside.fbsbx.com/story", id: "1" } },
    };
    expect(mediaFromMessage(m)).toEqual([
      { kind: "image", src: "https://scontent.cdninstagram.com/a.jpg" },
      { kind: "video", src: "https://video.fbcdn.net/v.mp4" },
      { kind: "audio", src: "https://lookaside.fbsbx.com/x", name: undefined },
      { kind: "share", link: "https://www.instagram.com/reel/abc/", name: "Reel" },
      { kind: "story", link: "https://lookaside.fbsbx.com/story", name: "Réponse à ta story" },
    ]);
    expect(mediaFromMessage({ story: { mention: { link: "https://x.fbsbx.com/s" } } })[0].name).toBe("T'a mentionné en story");
    expect(mediaFromMessage({})).toEqual([]);
  });
  it("seulement des fichiers Meta, extension d'après le type", () => {
    expect(metaFileUrl("https://scontent-cdg4-1.cdninstagram.com/v/a.jpg")).toBe(true);
    expect(metaFileUrl("https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1")).toBe(true);
    expect(metaFileUrl("https://evil.example.com/a.jpg")).toBe(false);
    expect(extFor("video/mp4")).toBe("mp4");
    expect(extFor("image/jpeg; charset=binary")).toBe("jpg");
    expect(extFor("application/x-unknown")).toBe("bin");
  });
});
