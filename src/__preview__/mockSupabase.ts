// Faux client Supabase (banc d'essai visuel uniquement, jamais committé).
const Q = new URLSearchParams(location.search);
const iso = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
const ts = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
const C = ["lea martin", "ines diallo", "camille roux", "sarah benali", "julie moreau", "emma petit", "nora haddad", "chloe garnier"];
const B = ["Gymshark", "Lululemon", "Alo Yoga", "Nike", "Myprotein", "Décathlon", "Asics", "Hoka"];
const cap = (s: string) => s.replace(/\b\w/g, (m) => m.toUpperCase());
const invoices = Array.from({ length: 18 }, (_, i) => ({ id: `inv${i}`, ref: `TTP-2026-${String(i + 1).padStart(3, "0")}`, party: `${B[i % 8]} x ${cap(C[i % 8].split(" ")[0])}`, amount: String(900 + ((i * 373) % 2600)), date: iso(i * 17 - 20), status: i === 1 ? "retard" : i < 4 ? "attente" : i === 17 ? "brouillon" : "payee", creator: C[i % 8], sort_order: i, created_at: ts(i * 17) }));
const details = Object.fromEntries(invoices.map((v, i) => [v.id, { issueDate: iso(i * 17 + 3), items: [{ label: "Collaboration", qty: 1, unit: Number(v.amount) }], franchise: true, vatRate: 20, commissionRate: 20 }]));
const DATA: Record<string, unknown[]> = {
  profiles: [Q.get("role") === "creator" ? { user_id: "u1", role: "creator", creator_name: "lea martin", agency_role: null } : { user_id: "u1", role: "agency", creator_name: null, agency_role: "founder" }],
  creators: C.map((n, i) => ({ id: `c${i}`, name: n, lang: Q.get("lang") ?? "fr", handle: `@${n.split(" ")[0]}`, niche: ["Fitness", "Running", "Yoga", "Lifestyle"][i % 4], platform: "instagram", followers: String(12000 + i * 8300), reach: String(40000 + i * 9000), er: ["3,2", "3,9", "4,6", "5,3"][i % 4], ca: null, status: i >= 6 ? "inactif" : "actif", tone: "cyan", commission: "20", photo_url: null, sort_order: i, instagram: `@${n.split(" ")[0]}`, tiktok: null, ville: "Lyon", stats: { instagram: { followers: 12000 + i * 8300, er: 3.4, reach: 40000 } }, stats_history: [], followers_history: [{ date: iso(60), value: 11000 + i * 8000 }, { date: iso(1), value: 12000 + i * 8300 }], stats_month: i < 2 ? "2026-09" : "2026-08", exclu: i < 3, mediakit: null, email_pro: null, created_at: ts(300 - i * 20) })),
  invoices,
  contacts: B.map((b, i) => ({ id: `ct${i}`, brand: b, person: `${["Julie", "Marc", "Sophie", "Tom"][i % 4]} ${["Durand", "Petit", "Leroy", "Morel"][i % 4]}`, first_name: null, last_name: null, role: ["Brand manager", "Head of influence", "Chargée RP"][i % 3], tag: i % 3 === 2 ? "Agence" : "Marque", email: `contact@${b.toLowerCase().replace(/\W/g, "")}.com`, phone: "06 12 34 56 7" + i, tone: "indigo", sort_order: i, creator: null, instagram: `@${b.toLowerCase()}`, city: ["Paris", "Lyon", "Genève"][i % 3], last_contacted: i % 2 ? ts(i * 9) : null, touches: i % 3 === 0 ? [{ id: `t${i}`, date: ts(50), canal: "whatsapp", kind: "contact" }] : null })),
  briefs: B.slice(0, 6).map((b, i) => ({ id: `b${i}`, brand: b, creator: C[i], who: C[i], deliverables: ["2 reels · 3 stories", "1 TikTok · 1 reel", "UGC 3 vidéos"][i % 3], due: iso(-3 - i * 4), status: ["attente", "valider", "cours", "terminé"][i % 4], budget: `${1500 + i * 400} €`, objectif: ["Notoriété", "Conversion", "Lancement"][i % 3], consignes: "", sort_order: i, pdf: null })),
  todos: ["Relancer Nike pour la facture de juillet", "Envoyer le media kit à Oysho", "Valider le concept Myprotein", "Mettre à jour les stats du mois", "Préparer le point mensuel"].map((t, i) => ({ id: `td${i}`, text: t, descr: null, tag: null, due: iso(-i), creator: i % 2 ? C[i] : null, priority: ["haute", "moyenne", "basse"][i % 3], source: "agency", done: i === 4, status: i === 4 ? "Fait" : i === 2 ? "En cours" : "À faire", sort_order: i, subtasks: null, attachments: null, created_at: ts(i * 3) })),
  ideas: ["Série « 30 jours de running »", "Collab duo Léa x Inès", "Live Q&A nutrition", "Vlog coulisses tournage"].map((t, i) => ({ id: `i${i}`, text: t, creator: C[i], status: ["À explorer", "À faire", "En cours", "Publiée"][i], source: "agency", sort_order: i, subtasks: null, created_at: ts(i) })),
  events: [0, 1, 3, 5, 8, 12].map((d, i) => ({ id: `e${i}`, day: null, date: iso(-d - 1), time: ["10:00", "14:30", "09:00", "18:00", "11:00", "16:00"][i], title: ["Call brief Alo Yoga", "Tournage Gymshark", "Point mensuel Camille", "Soirée lancement Hoka", "Shooting Asics", "Deadline contenu Nike"][i], type: ["call", "shoot", "reunion", "event", "voyage", "deadline"][i], who: C[i], source: "agency", sort_order: i, deleted: false, description: null })),
  gifting: B.slice(0, 4).map((b, i) => ({ id: `g${i}`, creator: C[i], brand: b, product: "Coffret nouvelle collection", value: `${120 + i * 40} €`, contact_name: null, contact_email: null, received_on: iso(i * 6), content_expected: i % 2 === 0, deliverables: "1 story", status: ["recu", "publie"][i % 2], mentions: null, note: null, source: "agency", sort_order: i })),
  collabs: B.slice(0, 5).map((b, i) => ({ id: `cl${i}`, brand: b, creator: C[i], contact: "Julie Durand", title: "Campagne automne", deliverables: "2 reels", cachet: `${2000 + i * 500} €`, step: [2, 4, 6, 8, 11][i], status: "active", note: null, sort_order: i, updated_at: ts(i * 5 + 2), created_at: ts(40), ig: i === 2 ? { posts: [{ id: "p1", at: ts(10), product: "REELS", likes: 4200, comments: 180, reach: 52000, saves: 900, shares: 300, views: 81000 }, { id: "p2", at: ts(9), type: "CAROUSEL_ALBUM", likes: 2100, comments: 64, reach: 31000, saves: 410, shares: 95 }] } : null, tt: null, yt: null })),
  collab_steps: [{ collab_id: "cl2", step: 6, reached_at: ts(10) }],
  creator_mail_settings: [{ creator: "lea martin", alias: "lea@ttpcreators.pro", label_id: null, label_name: null, enabled: true }],
  prospects: B.slice(0, 4).map((b, i) => ({ id: `p${i}`, brand: b, contact: "Julie Durand", value: `${3000 + i * 1000} €`, stage: ["Prospection", "Contact", "Négociation", "Signé"][i], tone: "cyan", sort_order: i })),
  documents: ["Contrat Alo Yoga.pdf", "Brief Gymshark.pdf", "Facture TTP-2026-012.pdf"].map((n, i) => ({ id: `d${i}`, creator: C[i], name: n, type: ["contrat", "brief", "facture"][i], size: `${120 + i * 40} Ko`, path: `x/${i}.pdf`, sort_order: i, created_at: ts(i) })),
  creator_pool: C.slice(0, 5).map((n, i) => ({ id: `cp${i}`, name: cap(n), handle: `@${n.split(" ")[1]}fit`, email: null, tag: "Fitness", note: null, last_contacted: null, sort_order: i })),
  agents: [
    { id: "ag1", slug: "megan", nom: "Megan", emoji: "🔎", role: "Prospection : repère les marques à démarcher, prépare les premiers messages et entretient le cercle des contacts.", moteur: "externe", consignes: "", routines: [], actif: true, sort_order: 1 },
    { id: "ag2", slug: "talent-manager", nom: "Talent manager", emoji: "🎯", role: "Gère les demandes des marques, prépare les réponses et les propositions, suit les collabs des créateurs du roster.", moteur: "claude", consignes: "# Rôle\nTu es le talent manager de TTP Creators…", routines: [{ nom: "Le point du matin", quand: "Chaque jour à 8 h", consigne: "Fais le point du jour et prépare les brouillons." }], actif: true, sort_order: 2 },
  ],
  actions: [
    { id: "ac1", type: "whatsapp", cible: "Hoka", contexte: "Relance après la proposition du 12 octobre.", contenu: "Bonjour Julie, je reviens vers vous pour la proposition Hoka x Léa…", lien_spark: null, statut: "a_valider", cree_le: new Date().toISOString(), traite_le: null, agent_id: "ag2" },
  ],
  journal: [{ id: "j1", action: "agent_session", detail: "Consignes relues", cree_le: new Date().toISOString(), agent_id: "ag2" }],
  module_rows: [{ id: "blob", module: "__app_state__", created_at: ts(0), a: JSON.stringify({ invoiceDetails: details, objByMonth: { "0": [{ label: "CA", pct: 64, target: 20000 }, { label: "Signatures", pct: 80, target: 5 }] }, prospectSettings: { relanceDays: 45 }, brandContractHistory: [{ id: "bc1", html: "<p>x</p>", ctType: "marque", ctName: "lea martin", brand: "Saucony", ref: "TTP-2026-118", ts: Date.now() - 10 * 864e5, status: "signed", title: "Contrat" }, { id: "bc2", html: "<p>x</p>", ctType: "marque", ctName: "ines diallo", brand: "Speedo", ref: "TTP-2026-121", ts: Date.now() - 7 * 864e5, title: "Contrat" }, { id: "bc3", html: "<p>x</p>", ctType: "ugc", ctName: "camille roux", brand: "Nutripure", ref: "TTP-2026-122", ts: Date.now() - 6 * 864e5, status: "changes", title: "Contrat UGC" }], contractDeadlines: [{ id: "cd1", creator: C[0], type: "marque", start: iso(200), months: 12 }], creatorPayouts: {}, diagnosticHistory: [{ ts: Date.now() - 3600e3, overall: "warn", checks: [{ key: "db", label: "Base de données", status: "ok", detail: "Lecture OK" }, { key: "edge", label: "Fonctions serveur", status: "warn", detail: "Indisponibles" }] }] }) }],
};
type Res = { data: unknown; error: null; count?: number };
function builder(table: string) {
  let single = false;
  const res = (): Res => { const d = DATA[table] ?? []; return { data: single ? (d as unknown[])[0] ?? null : d, error: null, count: (d as unknown[]).length }; };
  const b: Record<string, unknown> = {};
  const chain = () => b;
  for (const k of ["select", "order", "eq", "neq", "in", "or", "is", "gte", "lte", "lt", "gt", "limit", "range", "ilike", "like", "not", "filter", "match", "contains", "update", "delete", "upsert", "insert", "csv", "returns", "abortSignal"]) b[k] = chain;
  b.single = () => { single = true; return b; };
  b.maybeSingle = () => { single = true; return b; };
  b.then = (ok: (r: Res) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(res()).then(ok, ko);
  return b as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const session = { access_token: "x", user: { id: "u1", email: "marc@ttpcreators.pro", user_metadata: {} } };
export const supabase = {
  from: builder, schema: () => ({ from: builder }), rpc: async (fn: string) => fn === "agency_accounts" ? ({ data: [
      { user_id: "u1", email: "marcbouraoui@gmail.com", agency_role: "founder", display_name: "Marc", last_sign_in_at: new Date().toISOString() },
      { user_id: "u2", email: "gianni.valter@gmail.com", agency_role: "founder", display_name: "Gianni", last_sign_in_at: new Date(Date.now() - 86400e3).toISOString() },
    ], error: null }) : ({ data: null, error: null }),
  functions: { invoke: async (name: string, opts?: { body?: Record<string, any> }) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const now = Date.now();
    if (name === "gmail-history" && opts?.body?.inbox) {
      const all = [
        { threadId: "i1", subject: "Collaboration Sézane x Léa : brief hiver", name: "MARIE DUBOIS", email: "marie@sezane.com", snippet: "Bonjour, nous serions ravis de travailler avec Léa sur notre campagne hiver.", ts: now - 3600e3, count: 1, direction: "in", unread: true, box: "talent" },
        { threadId: "th1", subject: "Re: TTP Creators × Four Seasons : roster créateurs", name: "Clara Frechin", email: "clara@fourseasons.com", snippet: "Merci Marc, j&#39;ai bien reçu le media kit.", ts: now - 86400e3, count: 2, direction: "in", unread: false, box: "partnerships" },
        { threadId: "i3", subject: "Proposition UGC Lululemon", name: "Tom Morel", email: "tom@lululemon.com", snippet: "Parfait, je vous envoie le contrat demain.", ts: now - 2 * 86400e3, count: 4, direction: "out", unread: false, box: "partnerships" },
        { threadId: "i4", subject: "Invitation soirée Hoka", name: "Sophie Leroy", email: "sophie@hoka.com", snippet: "Nous organisons une soirée de lancement le 14 octobre.", ts: now - 3 * 86400e3, count: 1, direction: "in", unread: false, box: "talent" },
        { threadId: "i6", subject: "Question shooting", name: "Julien Martin", email: "julien.martin.photo@gmail.com", snippet: "Salut, dispo jeudi pour le shooting ?", ts: now - 400 * 86400e3, count: 2, direction: "in", unread: false, box: "partnerships" },
      ];
      const b = opts.body.box;
      return { data: { ok: true, threads: b === "all" ? all : all.filter((t) => t.box === b) }, error: null };
    }
    if (name === "gmail-history") {
      const d = (n: number) => new Date(now - n * 86400e3).toISOString();
      return { data: { ok: true, messages: [
        { id: "h1", threadId: "th1", from: "Clara <clara@fourseasons.com>", subject: "Re: TTP Creators × Four Seasons : roster créateurs", date: d(1), snippet: "Merci Marc, j&#39;ai bien reçu le media kit.", direction: "in", box: "partnerships" },
        { id: "h2", threadId: "th1", from: "TTP <partnerships@ttpcreators.pro>", subject: "TTP Creators × Four Seasons : roster créateurs", date: d(3), snippet: "Hello Clara, suite à notre échange LinkedIn…", direction: "out", source: "mediakit", box: "partnerships" },
      ] }, error: null };
    }
    if (name === "gmail-thread") {
      return { data: { ok: true, messages: [
        { id: "x1", from: "TTP Creators <partnerships@ttpcreators.pro>", to: "clara@fourseasons.com", subject: "TTP Creators × Four Seasons", date: "", ts: now - 3 * 86400e3, html: "<p>Hello Clara,</p><p>Suite à notre échange LinkedIn, je te fais parvenir notre media kit agence.</p><p>Marc</p>", text: "", direction: "out" },
        { id: "x2", from: "Clara Frechin <clara@fourseasons.com>", to: "partnerships@ttpcreators.pro", subject: "Re: TTP Creators × Four Seasons", date: "", ts: now - 86400e3, html: "<p>Merci Marc,</p><p>J'ai bien reçu le media kit, je reviens vers vous la semaine prochaine.</p><p>Clara</p>", text: "", direction: "in", attachments: [{ messageId: "x2", attachmentId: "b1", filename: "Tarifs-Four-Seasons-2027.pdf", mimeType: "application/pdf", size: 1240000 }] },
      ] }, error: null };
    }
    if (name === "creator-mail") {
      const threads = [
        { id: "t1", subject: "Partenariat collection automne : proposition", brand: "Gymshark", excerpt: "Merci pour la proposition. Léa est partante, nous revenons vers vous avec nos conditions.", ts: now - 3600e3, count: 3, status: "negociation", notes: 1, prospect: true, replied: true, startedTs: now - 86400e3 * 3 },
        { id: "t2", subject: "Invitation lancement Hoka Paris", brand: "Hoka", excerpt: "Nous organisons une soirée de lancement le 14 octobre et aimerions inviter Léa.", ts: now - 86400e3 * 2, count: 1, status: "demarchee", notes: 0, prospect: true, replied: false, startedTs: now - 86400e3 * 2 },
        { id: "t3", subject: "Re: Contrat Alo Yoga signé", brand: "Alo Yoga", excerpt: "Parfait, merci pour le retour signé. Les contenus sont attendus pour le 20.", ts: now - 86400e3 * 9, count: 5, status: "valide", notes: 0 },
      ];
      if (opts?.body?.action === "decision") return { data: { ok: true, status: opts.body.decision, decidedBy: "creator", decidedAt: new Date().toISOString(), logged: true }, error: null };
      if (opts?.body?.action === "thread") {
        const t = threads.find((x) => x.id === opts.body?.threadId) ?? threads[0];
        return { data: { ok: true, thread: { id: t.id, subject: t.subject, brand: t.brand, status: t.status, decidedBy: null, decidedAt: null, notes: [], messages: [
          { id: "m1", from: "Julie Durand", fromEmail: "julie@gymshark.com", fromAgency: false, to: "Léa <lea@ttpcreators.pro>", cc: "", ts: now - 86400e3, html: "<p>Bonjour,</p><p>Nous serions ravis de travailler avec <b>Léa</b> sur notre campagne d'automne.</p><p>Julie</p>", text: "", attachments: [] },
          { id: "m2", from: "Marc", fromEmail: "talent@ttpcreators.pro", fromAgency: true, to: "Julie Durand <julie@gymshark.com>", cc: "", ts: now - 3600e3, html: "<p>Bonjour Julie,</p><p>Merci pour la proposition. Léa est partante.</p>", text: "", attachments: [] },
        ] } }, error: null };
      }
      return { data: { ok: true, configured: true, threads }, error: null };
    }
    if (name === "creator-report") {
      const d = (n: number) => new Date(now - n * 86400000).toISOString().slice(0, 10);
      const hist = (base: number, step: number) => Array.from({ length: 60 }, (_, i) => ({ d: d(59 - i), f: base + i * step }));
      return { data: {
        creator: { name: "lea martin", commission: "20 %", ig: { history: hist(17800, 28), insights: { at: new Date(now - 86400000).toISOString(), reach: 241000, views: 612000 } }, tt: { history: hist(8900, 15) }, yt: null },
        invoices: [
          { id: "r1", ref: "TTP-2026-041", party: "Hoka x Léa", amount: "1 500 €", date: d(25), status: "payee", created_at: d(26) },
          { id: "r2", ref: "TTP-2026-044", party: "Nike x Léa", amount: "1 000 €", date: d(2), status: "attente", created_at: d(6) },
          { id: "r3", ref: "TTP-2026-012", party: "Alo Yoga x Léa", amount: "2 200 €", date: "2026-04-10", status: "payee", created_at: "2026-04-01" },
        ],
        details: { r1: { items: [{ id: "1", label: "Reel", qty: 1, unit: 1500 }], franchise: true, vatRate: 0, commissionRate: 20, issueDate: d(18) } },
        payouts: [{ id: "p1", date: d(9), amount: 1200 }],
        collabs: [
          { id: "k1", brand: "Hoka", deliverables: "1 reel · 3 stories", cachet: "1 500 €", step: 7, status: "active", created_at: d(17) },
          { id: "k2", brand: "Nike", deliverables: "1 TikTok", cachet: "1 000 €", step: 4, status: "active", created_at: d(8) },
          { id: "k3", brand: "Gymshark", deliverables: "2 reels", cachet: "2 000 €", step: 2, status: "active", created_at: d(40) },
        ],
        steps: [{ collab_id: "k1", step: 6, reached_at: new Date(now - 12 * 86400000).toISOString() }],
        gifting: [{ brand: "Asics", product: "Gel-Nimbus", value: "180 €", received_on: d(5) }],
        engagement: [{ date: "20/09/2026", platform: "instagram", platformLabel: "Instagram", er: "3,10 %" }, { date: "15/10/2026", platform: "instagram", platformLabel: "Instagram", er: "3,82 %" }],
      }, error: null };
    }
    if (name === "creator-history") {
      const fr = (d: number) => { const x = new Date(now - d * 86400000); return `${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}/${x.getFullYear()}`; };
      const entries = [150, 120, 90, 60, 30, 3].flatMap((d, i) => [
        { id: `ig${i}`, date: fr(d), creator: "lea martin", platform: "instagram", platformLabel: "Instagram", er: `${(3.1 + i * 0.15).toFixed(2).replace(".", ",")} %`, verdict: "bon", detail: "", vals: {}, followers: String(18200 + i * 1350) },
      ]);
      return { data: { entries }, error: null };
    }
    return { data: { ok: true, connected: false, messages: [] }, error: null };
  } },
  storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }), upload: async () => ({ error: null }), remove: async () => ({}), getPublicUrl: () => ({ data: { publicUrl: "" } }), list: async () => ({ data: [], error: null }) }) },
  auth: { getSession: async () => ({ data: { session: Q.get("login") ? null : session } }), getUser: async () => ({ data: { user: session.user } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), signOut: async () => ({}) },
  channel: () => { const ch: any = { on: () => ch, subscribe: () => ch }; return ch; }, // eslint-disable-line @typescript-eslint/no-explicit-any
  removeChannel: () => {},
};
export function setRemember(_r: boolean): void {}
export default supabase;