// FICHIER GÉNÉRÉ par `npm run alfred:contrats` depuis src/lib/contractRender.ts : ne pas le modifier à la main.
// Le moteur des contrats de l'app TTP Suite, pour qu'Alfred envoie exactement le contrat que l'app ferait.
// supabase/functions/_shared/contractDraft.ts
const DRAFT_OPTS = {
	nature: [
		"sponso",
		"ugc",
		"gifting",
		"ambassador",
		"event"
	],
	droits: [
		"organic",
		"repost",
		"paid",
		"buyout"
	],
	duree_droits: [
		"3 mois",
		"6 mois",
		"12 mois",
		"illimitée"
	],
	territoire: [
		"France",
		"France + DOM-TOM",
		"Europe",
		"Monde"
	],
	paiement: [
		"30j",
		"livraison",
		"acompte",
		"45j"
	],
	tva: ["non", "20"],
	exclusivite: [
		"non",
		"cat30",
		"cat90",
		"total"
	]
};
/**
* Les réglages du contrat de représentation que Claude peut remplir (clés de `RC_FIELDS` dans
* `src/lib/representationContract.ts` : le test vérifie qu'elles y sont toutes).
*/
const REPR_KEYS = [
	"variante",
	"contratTest",
	"titrePersonnalise",
	"lieuSignature",
	"dateSignature",
	"talentNom",
	"talentDateNaissance",
	"talentAdresse",
	"talentSiret",
	"talentEmailPro",
	"talentStatutTva",
	"modeDuree",
	"dureeMois",
	"dateDebut",
	"dateFin",
	"taciteReconduction",
	"periodeReconductionMois",
	"preavisJours",
	"essaiActif",
	"essaiJours",
	"essaiParEmail",
	"resiliationLibre",
	"resiliationLibreJours",
	"modeCommission",
	"regimeFiscalComm",
	"commApportee",
	"commInitiee",
	"commUniforme",
	"commAutonome",
	"seuil",
	"avantagesNatureInclus",
	"giftingSeuilStrict",
	"mandatEncaissement",
	"reversJours",
	"contestationVirementJours",
	"gestionMail",
	"mailChangementAccesHeures",
	"mailRevocationHeures",
	"visibiliteEmail"
];
const txt = (v, max = 300) => typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
/** L'outil demande un contrat de représentation (type « representation » ou « repr »). */
const estRepresentation = (a) => ["representation", "repr"].includes(txt(a.type, 20));
/** Les entrées de l'outil → un brouillon bien formé, ou l'erreur à dire à Claude. */
function normaliserBrouillon(a, { id, ts, ctName, by = "Claude", externe = false }) {
	if (estRepresentation(a)) return brouillonRepresentation(a, {
		id,
		ts,
		ctName,
		by,
		externe
	});
	const type = txt(a.type || "marque", 10) === "ugc" ? "ugc" : "marque";
	const brand = txt(a.marque, 120);
	if (!brand) return { erreur: "Indique la marque." };
	const choix = (cle, defaut) => {
		const v = txt(a[cle], 40);
		if (!v) return { v: defaut };
		const permis = DRAFT_OPTS[cle];
		const trouve = permis.find((p) => fold(p) === fold(v));
		return trouve ? { v: trouve } : {
			v: "",
			erreur: `« ${v} » n'est pas permis pour ${cle} : ${permis.join(", ")}.`
		};
	};
	const nature = choix("nature", type === "ugc" ? "ugc" : "sponso");
	const droits = choix("droits", "organic");
	const dureeDroits = choix("duree_droits", "6 mois");
	const territoire = choix("territoire", "France");
	const paiement = choix("paiement", "30j");
	const tva = choix("tva", "non");
	const exclusivite = choix("exclusivite", "non");
	for (const c of [
		nature,
		droits,
		dureeDroits,
		territoire,
		paiement,
		tva,
		exclusivite
	]) if (c.erreur) return { erreur: c.erreur };
	const commission = txt(a.commission, 6).replace(/[^0-9.,]/g, "").replace(",", ".") || "20";
	const extra = (Array.isArray(a.clauses) ? a.clauses : []).map((c, i) => {
		const o = c && typeof c === "object" ? c : {};
		return {
			id: `${id}x${i}`,
			l: txt(o.titre, 80),
			v: txt(o.texte, 1500)
		};
	}).filter((c) => c.l && c.v).slice(0, 6);
	const form = {
		ctType: type,
		brand,
		value: txt(a.montant, 60),
		commission,
		duration: txt(a.duree, 40),
		deliverables: txt(a.livrables, 300),
		excl: exclusivite.v !== "non",
		extra,
		collab: nature.v,
		rights: droits.v,
		rightsDuration: dureeDroits.v,
		territory: territoire.v,
		payment: paiement.v,
		tva: tva.v,
		exclScope: exclusivite.v,
		defraiement: a.defraiement === true
	};
	return { brouillon: {
		id,
		ts,
		by: txt(by, 40) || "Claude",
		ctType: type,
		ctName,
		brand,
		note: txt(a.note, 800),
		form
	} };
}
/** Valeur d'un réglage de représentation : texte court, nombre ou booléen (« true » / « false »). */
const reglage = (v) => typeof v === "boolean" || typeof v === "number" ? String(v) : txt(v, 300);
/** Brouillon de contrat de représentation : la variante et les réglages connus du générateur. */
function brouillonRepresentation(a, { id, ts, ctName, by = "Claude", externe = false }) {
	const r = a.representation && typeof a.representation === "object" && !Array.isArray(a.representation) ? a.representation : {};
	const inconnues = Object.keys(r).filter((k) => !REPR_KEYS.includes(k));
	if (inconnues.length) return { erreur: `Réglage inconnu du contrat de représentation : ${inconnues.join(", ")}. Permis : ${REPR_KEYS.join(", ")}.` };
	const config = {};
	for (const k of REPR_KEYS) {
		const v = reglage(r[k]);
		if (v) config[k] = v;
	}
	config.variante = config.variante === "nonexclusif" ? "nonexclusif" : "exclusif";
	if (!config.talentNom) config.talentNom = ctName;
	return { brouillon: {
		id,
		ts,
		by: txt(by, 40) || "Claude",
		ctType: "repr",
		ctName,
		...externe ? { externe: true } : {},
		brand: "",
		note: txt(a.note, 800),
		config
	} };
}
// src/lib/pdfDoc.ts
/**
* Identité des DOCUMENTS PDF de l'agence : brief, bilan de campagne, facture, contrats.
* Une seule feuille de style pour que tout ce qui sort de l'app se ressemble, et
* ressemble aux media kits du site (direction « Éditorial », 2026-10-07).
*
* Parti pris, pensé pour l'impression A4 :
*  - Instrument Serif pour les titres et les chiffres, Instrument Sans pour le texte
*    (les polices des media kits, servies par l'app : public/fonts/) ;
*  - un titre en deux temps, la fin en italique bordeaux (« Nike *× Candice* ») ;
*  - libellés en petites capitales espacées, valeurs reliées par des pointillés ;
*  - filets fins, aucun aplat de couleur, beaucoup de blanc.
*
* ⚠️ Réservé au PDF (via `printHtml`, qui attend le chargement des polices). NE PAS
* l'utiliser pour un corps d'EMAIL : Gmail/Outlook ignorent `<style>`, `@font-face`
* et `@page` (l'email a besoin de tableaux et de styles en ligne).
*/
function esc$2(s) {
	return String(s ?? "").replace(/[&<>"]/g, (c) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		"\"": "&quot;"
	})[c] ?? c);
}
/**
* URL ABSOLUE d'un fichier de `public/`. Absolue et non relative : les documents sont
* rendus dans un iframe `srcdoc` (base `about:srcdoc`), où une URL relative est ambiguë.
*/
function appAssetUrl(path) {
	const base = import.meta.env?.BASE_URL || "/";
	if (typeof window === "undefined") return `${APP_ORIGIN}${base}${path}`;
	try {
		return new URL(`${base}${path}`, window.location.href).href;
	} catch {
		return `${base}${path}`;
	}
}
/** Adresse de l'app en ligne (documents fabriqués hors navigateur). */
const APP_ORIGIN = "https://app.ttpcreators.pro";
/** URL absolue du monogramme TTP (`public/logo.png`), pour l'en-tête des documents. */
function ttpLogoUrl() {
	return appAssetUrl("logo.png");
}
/** Monogramme TTP en image (coins arrondis). */
function ttpLogoImg(sizePx = 34) {
	return `<img src="${esc$2(ttpLogoUrl())}" alt="TTP Creators" width="${sizePx}" height="${sizePx}" style="width:${sizePx}px;height:${sizePx}px;border-radius:${Math.round(sizePx / 5)}px;display:block;flex:none">`;
}
/** Date du jour (« 7 octobre 2026 », ou « 7 October 2026 » pour un document en anglais). */
function docToday(locale = "fr-FR") {
	try {
		return (/* @__PURE__ */ new Date()).toLocaleDateString(locale, {
			day: "numeric",
			month: "long",
			year: "numeric"
		});
	} catch {
		return (/* @__PURE__ */ new Date()).toLocaleDateString(locale);
	}
}
function fontFaces() {
	const f = (file) => esc$2(appAssetUrl(`fonts/${file}`));
	return `@font-face{font-family:"Instrument Serif";font-style:normal;font-weight:400;font-display:block;src:url("${f("instrument-serif-normal.woff2")}") format("woff2")}@font-face{font-family:"Instrument Serif";font-style:italic;font-weight:400;font-display:block;src:url("${f("instrument-serif-italic.woff2")}") format("woff2")}@font-face{font-family:"Instrument Sans";font-style:normal;font-weight:400 700;font-display:block;src:url("${f("instrument-sans-normal.woff2")}") format("woff2")}`;
}
/**
* Feuille de style COMMUNE à tous les documents. Les documents particuliers (facture,
* contrats) ajoutent leurs règles propres après celle-ci, avec les mêmes jetons.
*/
const BASE_CSS = `
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
:root{
  --ink:#121212; --grey:#6e6e6b; --faint:#a3a39e; --soft:#e4e4e0; --accent:#4a0a0e;
  --serif:"Instrument Serif","Iowan Old Style",Georgia,"Times New Roman",serif;
  --sans:"Instrument Sans","Helvetica Neue",Helvetica,Arial,sans-serif;
}
html,body{margin:0;background:#fff}
body{font-family:var(--sans);color:var(--ink);font-size:9.6pt;line-height:1.6;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.wrap{max-width:182mm;margin:0 auto;padding:14mm 12mm}
i,em{font-style:italic}
.tnum{font-variant-numeric:tabular-nums}

/* En-tête : monogramme + « TTP Creators » à gauche, type de document / référence à droite. */
.mast{display:flex;align-items:center;justify-content:space-between;gap:8mm;
  padding-bottom:4mm;border-bottom:.5pt solid var(--soft)}
.mast .id{display:flex;align-items:center;gap:2.8mm}
.mast .wm{font-family:var(--serif);font-size:15pt;line-height:1;letter-spacing:-.01em;white-space:nowrap}
.mast .wm i{color:var(--accent)}
.mast .tl{margin-top:1mm;font-size:6.8pt;letter-spacing:.18em;text-transform:uppercase;color:var(--grey)}
.mast .r{text-align:right;font-size:6.8pt;letter-spacing:.18em;text-transform:uppercase;color:var(--grey);line-height:1.8}
.mast .r b{color:var(--ink);font-weight:600}

/* Bloc titre : petit libellé, grand titre serif dont la fin est en italique bordeaux. */
.kicker{font-size:7pt;letter-spacing:.24em;text-transform:uppercase;color:var(--grey);margin:13mm 0 3.5mm}
h1{font-family:var(--serif);font-weight:400;font-size:36pt;line-height:.98;letter-spacing:-.02em;margin:0;text-wrap:balance}
h1 i{color:var(--accent)}
.sub{margin:3.5mm 0 0;font-family:var(--serif);font-size:13pt;line-height:1.3;color:var(--grey)}

/* Informations : libellé · pointillés · valeur (comme les lignes des media kits). */
.meta{margin:9mm 0 0;padding:0}
.meta .row{display:flex;align-items:baseline;gap:3mm;padding:1.9mm 0;break-inside:avoid}
.meta dt{margin:0;font-size:8.6pt;color:var(--grey);white-space:nowrap}
.meta .lead{flex:1;min-width:6mm;border-bottom:.7pt dotted var(--faint);transform:translateY(-.9mm)}
.meta dd{margin:0;font-family:var(--serif);font-size:12.5pt;line-height:1.25;text-align:right;max-width:62%}

/* Sections : filet fin, petit libellé espacé, puis le contenu. */
.sec{margin-top:9mm;padding-top:4.5mm;border-top:.5pt solid var(--soft)}
.sec>h2{margin:0 0 3.5mm;font-size:7pt;font-weight:600;letter-spacing:.24em;text-transform:uppercase;color:var(--grey);break-after:avoid}
.pre{white-space:pre-wrap;font-size:9.8pt;line-height:1.72}
.lede{font-family:var(--serif);font-size:13pt;line-height:1.42;white-space:pre-wrap}
.muted{color:var(--grey)}

/* Chiffres clés : grands chiffres serif, séparés par des filets verticaux. */
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:5mm 0}
.kpi{padding:0 4mm;border-left:.5pt solid var(--soft);break-inside:avoid}
.kpi:nth-child(4n+1){border-left:0;padding-left:0}
.kpi .n{display:block;font-family:var(--serif);font-size:24pt;line-height:1;color:var(--accent);
  font-variant-numeric:tabular-nums;white-space:nowrap}
.kpi .c{display:block;margin-top:1.8mm;font-size:7.6pt;line-height:1.35;color:var(--grey)}

/* Liste à tirets */
ul.ticks{margin:0;padding:0;list-style:none}
ul.ticks li{position:relative;padding-left:6mm;margin:0 0 2.2mm;break-inside:avoid}
ul.ticks li::before{content:"—";position:absolute;left:0;color:var(--accent)}

/* Bandeau chiffré du bilan : budget → CA, retour sur investissement. */
.money{display:flex;align-items:flex-end;gap:7mm;flex-wrap:wrap;margin-top:9mm;padding:5mm 0;
  border-top:.5pt solid var(--soft);border-bottom:.5pt solid var(--soft)}
.money .k{display:block;font-size:7pt;letter-spacing:.22em;text-transform:uppercase;color:var(--grey);margin-bottom:1.6mm}
.money b{display:block;font-family:var(--serif);font-weight:400;font-size:24pt;line-height:1;white-space:nowrap}
.money .arrow{font-family:var(--serif);font-size:20pt;line-height:1;color:var(--faint);padding-bottom:.6mm}
.money .roi{margin-left:auto;text-align:right}
.money .roi b{color:var(--accent)}

/* Annexe de captures */
.shots{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}
.shots figure{margin:0;border:.5pt solid var(--soft);border-radius:1.5mm;overflow:hidden;
  height:56mm;display:grid;place-items:center;background:#fafaf8;break-inside:avoid}
.shots img{width:100%;height:100%;object-fit:contain;display:block}

/* Pied de document */
.foot{margin-top:12mm;padding-top:3.5mm;border-top:.5pt solid var(--soft);display:flex;justify-content:space-between;
  gap:6mm;font-size:6.8pt;letter-spacing:.16em;text-transform:uppercase;color:var(--faint)}

/* Numéro de page en marge (navigateurs qui le gèrent, dont Chrome). */
@page{size:A4;margin:14mm 14mm 16mm;
  @bottom-right{content:counter(page) " / " counter(pages);font-family:"Instrument Sans",Helvetica,Arial,sans-serif;
    font-size:7pt;letter-spacing:.12em;color:#a3a39e}}
@media print{.wrap{max-width:none;padding:0}}
`;
/**
* Nom de fichier proposé à l'enregistrement PDF (= `<title>` du document).
* Assemble les morceaux non vides (« Facture TTP-2026-004 », « Nike x Sarah ») avec
* un tiret simple et retire ce qu'un nom de fichier n'accepte pas (/ : * ? " < > | …).
*/
function pdfFileTitle(...parts) {
	return parts.map((p) => String(p ?? "").replace(/[\u2013\u2014]/g, "-").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean).join(" - ").slice(0, 120).trim();
}
/** `<head>` complet : titre (= nom de fichier proposé), polices, style commun + style propre. */
function docHead(title, extraCss = "") {
	return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc$2(title)}</title><style>${fontFaces()}${BASE_CSS}${extraCss}</style></head>`;
}
/**
* CONTRATS (Marque × Créateur, UGC, représentation) : mise en page de vrai document
* juridique, plus sobre que les autres documents (demande de Marc, 2026-10-07 : « mal
* alignés, trop de pages, ça fait trop IA »). Encre seule, titre centré, articles
* « Article 1. Titre » alignés à gauche, texte justifié et coupé proprement, conditions
* en grille sur deux colonnes, signatures côte à côte, paraphes et « Page n sur N » en
* bas de chaque page. Les articles peuvent passer d'une page à l'autre (plus de fins de
* page vides) ; seuls le titre d'un article et le bloc de signatures restent groupés.
* Classes préfixées `ct-` : rien ne déborde sur la facture, le brief ou le bilan.
*/
const CONTRACT_CSS = `
@page{margin:16mm 17mm 18mm;
  @bottom-left{content:"Paraphes\\00a0:\\00a0\\00a0\\00a0_______________\\00a0\\00a0\\00a0_______________";font-family:"Instrument Sans",Helvetica,Arial,sans-serif;
    font-size:7.4pt;letter-spacing:0;color:#8a8a85}
  @bottom-right{content:"Page " counter(page) " sur " counter(pages);font-family:"Instrument Sans",Helvetica,Arial,sans-serif;
    font-size:7.4pt;letter-spacing:0;color:#8a8a85}}
.ct{font-size:9.3pt;line-height:1.5;color:#1d1d1b}
.ct-head{display:flex;align-items:center;justify-content:space-between;gap:8mm;padding-bottom:3.2mm;border-bottom:.6pt solid var(--ink)}
.ct-head .id{display:flex;align-items:center;gap:2.6mm}
.ct-head .wm{display:block;font-family:var(--serif);font-size:14pt;line-height:1;color:var(--ink)}
.ct-head .tl{display:block;margin-top:.9mm;font-size:7.6pt;color:var(--grey)}
.ct-head .r{text-align:right;font-size:7.8pt;line-height:1.55;color:var(--grey)}
.ct-head .r b{color:var(--ink);font-weight:600}
.ct-title{margin:11mm 0 0;text-align:center}
.ct-title h1{font-family:var(--serif);font-weight:400;font-size:24pt;line-height:1.08;letter-spacing:-.005em;margin:0;text-wrap:balance}
.ct-title p{margin:2.2mm 0 0;font-size:9pt;color:var(--grey)}
.ct-intro{margin:9mm 0 0;text-align:justify;hyphens:auto;-webkit-hyphens:auto}
.ct-art{margin-top:5mm}
.ct-art>h2{margin:0 0 1.5mm;font-family:var(--sans);font-size:9.6pt;font-weight:600;line-height:1.35;letter-spacing:0;
  text-transform:none;color:var(--ink);break-after:avoid;page-break-after:avoid}
.ct-art>h3{margin:2.6mm 0 1mm;font-size:9.3pt;font-weight:600;color:var(--ink);break-after:avoid;page-break-after:avoid}
.ct-art p{margin:0 0 1.5mm;text-align:justify;hyphens:auto;-webkit-hyphens:auto;orphans:3;widows:3}
.ct-art ul{margin:.6mm 0 1.8mm;padding:0;list-style:none}
.ct-art li{position:relative;margin:0 0 .9mm;padding-left:5mm;text-align:justify;hyphens:auto;-webkit-hyphens:auto}
.ct-art li::before{content:"–";position:absolute;left:1.2mm;color:var(--grey)}
.ct-terms{display:grid;grid-template-columns:1fr 1fr;column-gap:9mm;margin:2mm 0 0;padding:0;border-bottom:.5pt solid var(--soft)}
.ct-terms>div{display:grid;grid-template-columns:30mm 1fr;gap:3mm;padding:1.6mm 0;border-top:.5pt solid var(--soft);break-inside:avoid}
.ct-terms dt{margin:0;font-size:8.4pt;color:var(--grey)}
.ct-terms dd{margin:0;font-size:9pt;color:var(--ink)}
.ct-sign{margin-top:9mm;break-inside:avoid;page-break-inside:avoid}
.ct-sign .place{margin:0 0 5mm}
.ct-sign .cols{display:grid;grid-template-columns:1fr 1fr;gap:12mm}
.ct-sign .who{font-weight:600;color:var(--ink)}
.ct-sign .det{margin-top:.6mm;min-height:9.6mm;font-size:8.8pt;line-height:1.45;color:var(--grey);white-space:pre-line}
.ct-sign .box{position:relative;margin-top:3mm;height:25mm;border:.5pt solid #cfcfca;border-radius:1mm}
.ct-sign .box img.sig{position:absolute;inset:1.5mm 3mm;width:calc(100% - 6mm);height:calc(100% - 3mm);object-fit:contain;object-position:left center}
.ct-sign .cap{margin-top:1.6mm;font-size:7.8pt;line-height:1.4;color:var(--grey)}
.ct-signtext{margin-top:9mm;white-space:pre-line;break-inside:avoid}
.ct-legal{margin-top:8mm;padding-top:3mm;border-top:.5pt solid var(--soft);font-size:7.6pt;line-height:1.5;color:var(--faint)}
`;
/** En-tête de contrat : monogramme + nom à gauche, nature du document à droite (lignes déjà échappées). */
function contractHead(name, tagline, right) {
	const nice = name.trim().split(/\s+/).map((w, k) => k > 0 && w === w.toUpperCase() ? w.charAt(0) + w.slice(1).toLowerCase() : w).join(" ");
	return `<header class="ct-head"><span class="id">${ttpLogoImg(26)}<span><span class="wm">${esc$2(nice)}</span><span class="tl">${esc$2(tagline)}</span></span></span><span class="r">${right.filter(Boolean).join("<br>")}</span></header>`;
}
/** Titre de contrat centré, avec une ligne de précisions en dessous. */
function contractTitle(title, sub) {
	return `<div class="ct-title"><h1>${esc$2(title)}</h1>${sub ? `<p>${esc$2(sub)}</p>` : ""}</div>`;
}
/** <img> de la signature pour le cadre de l'agence ("" si aucune ou désactivée). */
function sigImgHtml() {
	return "";
}
// src/lib/representationContract.ts
const RC_META = {
	brandTitle: "TTP AGENCY",
	brandSubtitle: "Talent Management & Influence Commerciale",
	footer: "TTP AGENCY • 143 avenue Thiers, 69006 Lyon • marc@ttpcreators.pro • ttpcreators.pro",
	agencyBlock: "L'AGENCE — TTP AGENCY, société immatriculée au Registre du Commerce et des Sociétés de Lyon sous le numéro 921 151 726, dont le siège social est sis 143 avenue Thiers, 69006 Lyon, représentée par Marc Maher Bouraoui, co-fondateur, dûment habilité aux fins des présentes.\nContact : marc@ttpcreators.pro · 07 66 25 98 03 · ttpcreators.pro.\nCi-après « l'Agence ».",
	preambule: "Considérant que le Talent exerce une activité d'influenceur au sens de l'article 1er de la loi n°2023-451 du 9 juin 2023 visant à encadrer l'influence commerciale (modifiée par l'ordonnance n°2024-978 du 6 novembre 2024), et dans le respect des dispositions du Code de la consommation relatives aux pratiques commerciales (articles L.121-1 et suivants) ;\n\nConsidérant que l'Agence dispose d'un réseau professionnel, d'une expertise en négociation et gestion de campagnes, ainsi que des outils de monétisation optimale de l'activité du Talent ;\n\nIl a été convenu ce qui suit.",
	signatures: "Fait à {lieuSignature}, le {dateSignature}, en deux (2) exemplaires originaux.\n\nPour l'Agence\nTTP AGENCY\nMarc Maher Bouraoui, Co-fondateur\n\n_______________________\n\nPour le Talent\n{talentNom}\n\n_______________________\n(signature précédée de la mention manuscrite « Lu et approuvé »)",
	emailAgence: "partnerships@ttpcreators.pro"
};
const RC_FIELDS = [
	{
		key: "variante",
		label: "Type de représentation",
		type: "select",
		default: "exclusif",
		group: "Général",
		options: [{
			value: "exclusif",
			label: "Exclusif"
		}, {
			value: "nonexclusif",
			label: "Non exclusif"
		}],
		help: "Pilote la commission par défaut, l'exclusivité et le titre."
	},
	{
		key: "contratTest",
		label: "Mention « Contrat test » dans le titre",
		type: "bool",
		default: "true",
		group: "Général"
	},
	{
		key: "titrePersonnalise",
		label: "Sous-titre / mention personnalisée",
		type: "text",
		default: "",
		group: "Général"
	},
	{
		key: "lieuSignature",
		label: "Lieu de signature",
		type: "text",
		default: "Lyon",
		group: "Général"
	},
	{
		key: "dateSignature",
		label: "Date de signature",
		type: "date",
		default: "",
		group: "Général"
	},
	{
		key: "talentNom",
		label: "Nom et prénom du Talent",
		type: "text",
		default: "",
		group: "Talent"
	},
	{
		key: "talentDateNaissance",
		label: "Date de naissance",
		type: "date",
		default: "",
		group: "Talent"
	},
	{
		key: "talentAdresse",
		label: "Adresse complète",
		type: "text",
		default: "",
		group: "Talent"
	},
	{
		key: "talentSiret",
		label: "SIRET / statut juridique",
		type: "text",
		default: "",
		group: "Talent"
	},
	{
		key: "talentEmailPro",
		label: "Email professionnel géré",
		type: "text",
		default: "",
		group: "Talent",
		help: "Requis si gestion de la boîte mail."
	},
	{
		key: "talentStatutTva",
		label: "Statut TVA du Talent",
		type: "select",
		default: "franchise",
		group: "Talent",
		options: [{
			value: "franchise",
			label: "Franchise en base (non assujetti)"
		}, {
			value: "assujetti",
			label: "Assujetti à la TVA"
		}]
	},
	{
		key: "modeDuree",
		label: "Régime de durée",
		type: "select",
		default: "determinee",
		group: "Durée",
		options: [{
			value: "determinee",
			label: "Durée déterminée (fin de plein droit)"
		}, {
			value: "reconductible",
			label: "Reconductible"
		}]
	},
	{
		key: "dureeMois",
		label: "Durée (mois)",
		type: "number",
		default: "2",
		group: "Durée"
	},
	{
		key: "dateDebut",
		label: "Date de début",
		type: "date",
		default: "",
		group: "Durée",
		help: "Si durée déterminée ; sinon = date de signature."
	},
	{
		key: "dateFin",
		label: "Date de fin (incluse)",
		type: "date",
		default: "",
		group: "Durée",
		help: "Auto = début + durée − 1 j si laissé vide."
	},
	{
		key: "taciteReconduction",
		label: "Tacite reconduction",
		type: "bool",
		default: "false",
		group: "Durée"
	},
	{
		key: "periodeReconductionMois",
		label: "Période de reconduction (mois)",
		type: "number",
		default: "4",
		group: "Durée"
	},
	{
		key: "preavisJours",
		label: "Préavis de dénonciation (jours)",
		type: "number",
		default: "30",
		group: "Durée"
	},
	{
		key: "essaiActif",
		label: "Période d'essai réciproque",
		type: "bool",
		default: "true",
		group: "Durée"
	},
	{
		key: "essaiJours",
		label: "Durée période d'essai (jours)",
		type: "number",
		default: "15",
		group: "Durée"
	},
	{
		key: "essaiParEmail",
		label: "Résiliation d'essai par email admise",
		type: "bool",
		default: "false",
		group: "Durée"
	},
	{
		key: "resiliationLibre",
		label: "Résiliation libre à tout moment (e-mail ou message)",
		type: "bool",
		default: "false",
		group: "Durée",
		help: "Remplace l'article 10.1."
	},
	{
		key: "resiliationLibreJours",
		label: "Préavis de résiliation libre (jours)",
		type: "number",
		default: "1",
		group: "Durée"
	},
	{
		key: "modeCommission",
		label: "Barème de commission",
		type: "select",
		default: "parOrigine",
		group: "Commission",
		options: [{
			value: "parOrigine",
			label: "Par origine du deal (apporté / initié)"
		}, {
			value: "uniforme",
			label: "Taux uniforme"
		}]
	},
	{
		key: "regimeFiscalComm",
		label: "Base de la commission",
		type: "select",
		default: "HT",
		group: "Commission",
		options: [{
			value: "HT",
			label: "Hors taxes (HT)"
		}, {
			value: "TTC",
			label: "Toutes taxes comprises (TTC)"
		}]
	},
	{
		key: "commApportee",
		label: "Taux — deal apporté & géré Agence (%)",
		type: "number",
		default: "30",
		group: "Commission",
		help: "Mode par origine."
	},
	{
		key: "commInitiee",
		label: "Taux — deal initié Talent, géré Agence (%)",
		type: "number",
		default: "15",
		group: "Commission",
		help: "Mode par origine."
	},
	{
		key: "commUniforme",
		label: "Taux uniforme (%)",
		type: "number",
		default: "20",
		group: "Commission",
		help: "Mode uniforme."
	},
	{
		key: "commAutonome",
		label: "Taux — collaborations autonomes (%)",
		type: "number",
		default: "0",
		group: "Commission"
	},
	{
		key: "seuil",
		label: "Seuil de commission (€, avantages inclus)",
		type: "number",
		default: "100",
		group: "Commission"
	},
	{
		key: "avantagesNatureInclus",
		label: "Avantages en nature dans l'assiette",
		type: "bool",
		default: "true",
		group: "Commission"
	},
	{
		key: "giftingSeuilStrict",
		label: "Avantages comptés si gifting 100 % ET > seuil",
		type: "bool",
		default: "false",
		group: "Commission"
	},
	{
		key: "mandatEncaissement",
		label: "Mandat d'encaissement (l'Agence encaisse et reverse le net)",
		type: "bool",
		default: "true",
		group: "Encaissement"
	},
	{
		key: "reversJours",
		label: "Reversement du net (jours ouvrés)",
		type: "number",
		default: "7",
		group: "Encaissement"
	},
	{
		key: "contestationVirementJours",
		label: "Justificatif de non-réception (jours ouvrés)",
		type: "number",
		default: "5",
		group: "Encaissement"
	},
	{
		key: "gestionMail",
		label: "Gestion de la boîte mail professionnelle",
		type: "bool",
		default: "false",
		group: "Boîte mail"
	},
	{
		key: "mailChangementAccesHeures",
		label: "Info changement d'accès (heures)",
		type: "number",
		default: "24",
		group: "Boîte mail"
	},
	{
		key: "mailRevocationHeures",
		label: "Cessation de consultation après fin (heures)",
		type: "number",
		default: "24",
		group: "Boîte mail"
	},
	{
		key: "visibiliteEmail",
		label: "Afficher partnerships@ttpcreators.pro sur les profils",
		type: "bool",
		default: "true",
		group: "Options"
	},
	{
		key: "visibiliteMiseEnDemeureJours",
		label: "Mise en demeure visibilité (jours ouvrés)",
		type: "number",
		default: "7",
		group: "Options"
	},
	{
		key: "reportingMensuel",
		label: "Reporting mensuel",
		type: "bool",
		default: "true",
		group: "Options"
	},
	{
		key: "exclusivite",
		label: "Clause d'exclusivité active",
		type: "bool",
		default: "true",
		group: "Options"
	},
	{
		key: "collabAutonomeRegime",
		label: "Collaborations initiées par le Talent (Art. 7)",
		type: "select",
		default: "viaAgence",
		group: "Options",
		options: [
			{
				value: "viaAgence",
				label: "Doivent passer par l'Agence"
			},
			{
				value: "informer",
				label: "Gérées par le Talent, mais information de l'Agence"
			},
			{
				value: "libre",
				label: "Gérées librement par le Talent, sans obligation d'informer"
			}
		],
		help: "Si le Talent démarche lui-même une marque / relance un ancien client : doit-il informer l'Agence, ou peut-il gérer entièrement de son côté ?"
	},
	{
		key: "charteEthique",
		label: "Charte éthique TTP / ARPP",
		type: "bool",
		default: "true",
		group: "Options"
	},
	{
		key: "clausePenaleActive",
		label: "Clause pénale",
		type: "bool",
		default: "true",
		group: "Juridique"
	},
	{
		key: "clausePenaleMois",
		label: "Clause pénale (mois de commission moyenne)",
		type: "number",
		default: "2",
		group: "Juridique"
	},
	{
		key: "retardPaiementJours",
		label: "Retard de paiement = faute grave (jours)",
		type: "number",
		default: "30",
		group: "Juridique"
	},
	{
		key: "imageApresTermeMois",
		label: "Droit à l'image après le terme (mois)",
		type: "number",
		default: "12",
		group: "Juridique",
		help: "0 = durée du contrat uniquement."
	},
	{
		key: "confidentialiteApresAns",
		label: "Confidentialité après le terme (années)",
		type: "number",
		default: "3",
		group: "Juridique"
	},
	{
		key: "approcheDirecteHeures",
		label: "Info d'une approche directe (heures)",
		type: "number",
		default: "48",
		group: "Juridique"
	},
	{
		key: "mediationOrg",
		label: "Organe de médiation",
		type: "select",
		default: "cciLyon",
		group: "Juridique",
		options: [{
			value: "cciLyon",
			label: "CCI de Lyon"
		}, {
			value: "mediateurInfluence",
			label: "Médiateur spécialisé influence"
		}]
	},
	{
		key: "mediationDelaiJours",
		label: "Délai de médiation (jours)",
		type: "number",
		default: "30",
		group: "Juridique"
	},
	{
		key: "tribunal",
		label: "Tribunal compétent",
		type: "text",
		default: "Tribunal Judiciaire de Lyon",
		group: "Juridique"
	},
	{
		key: "clauseL44110",
		label: "Réf. art. L.441-10 (marque défaillante, hors mandat)",
		type: "bool",
		default: "false",
		group: "Juridique",
		help: "Intérêts + indemnité réclamés à la marque débitrice."
	},
	{
		key: "clauseRGPD",
		label: "Mention RGPD (données de la boîte mail)",
		type: "bool",
		default: "true",
		group: "Juridique"
	}
];
const RC_VARIANTS = [{
	key: "exclusif",
	label: "Exclusif — Contrat test (durée déterminée)",
	title: "CONTRAT DE REPRÉSENTATION — TALENT MANAGEMENT — EXCLUSIF",
	commissionSummary: "30 % HT si apporté & géré par l'Agence ; 15 % HT si initié par le Talent et géré par l'Agence ; 0 % pour les collaborations autonomes. Aucune commission < 100 €.",
	defaults: {
		variante: "exclusif",
		contratTest: "true",
		modeDuree: "determinee",
		dureeMois: "2",
		taciteReconduction: "false",
		preavisJours: "0",
		essaiActif: "true",
		essaiJours: "15",
		essaiParEmail: "false",
		mandatEncaissement: "true",
		reversJours: "7",
		contestationVirementJours: "5",
		gestionMail: "false",
		visibiliteEmail: "true",
		visibiliteMiseEnDemeureJours: "7",
		reportingMensuel: "true",
		modeCommission: "parOrigine",
		regimeFiscalComm: "HT",
		commApportee: "30",
		commInitiee: "15",
		commAutonome: "0",
		seuil: "100",
		avantagesNatureInclus: "true",
		giftingSeuilStrict: "false",
		exclusivite: "true",
		collabAutonomeRegime: "viaAgence",
		clausePenaleActive: "true",
		clausePenaleMois: "2",
		retardPaiementJours: "30",
		imageApresTermeMois: "12",
		confidentialiteApresAns: "3",
		approcheDirecteHeures: "48",
		charteEthique: "true",
		mediationOrg: "cciLyon",
		mediationDelaiJours: "30",
		talentStatutTva: "franchise"
	}
}, {
	key: "nonexclusif",
	label: "Non exclusif — Gestion boîte mail",
	title: "CONTRAT DE REPRÉSENTATION — TALENT MANAGEMENT — NON EXCLUSIF",
	commissionSummary: "20 % TTC pour les deals apportés ou gérés par l'Agence ; 0 % pour les collaborations gérées intégralement par le Talent. Aucune commission < 100 €.",
	defaults: {
		variante: "nonexclusif",
		contratTest: "false",
		modeDuree: "reconductible",
		dureeMois: "4",
		taciteReconduction: "true",
		periodeReconductionMois: "4",
		preavisJours: "30",
		essaiActif: "true",
		essaiJours: "30",
		essaiParEmail: "true",
		mandatEncaissement: "true",
		reversJours: "7",
		contestationVirementJours: "5",
		gestionMail: "true",
		mailChangementAccesHeures: "24",
		mailRevocationHeures: "24",
		visibiliteEmail: "true",
		visibiliteMiseEnDemeureJours: "7",
		reportingMensuel: "true",
		modeCommission: "uniforme",
		regimeFiscalComm: "TTC",
		commUniforme: "20",
		commAutonome: "0",
		seuil: "100",
		avantagesNatureInclus: "true",
		giftingSeuilStrict: "true",
		exclusivite: "false",
		collabAutonomeRegime: "informer",
		clausePenaleActive: "true",
		clausePenaleMois: "3",
		retardPaiementJours: "30",
		imageApresTermeMois: "0",
		confidentialiteApresAns: "3",
		approcheDirecteHeures: "48",
		charteEthique: "true",
		mediationOrg: "cciLyon",
		mediationDelaiJours: "30",
		talentStatutTva: "franchise"
	}
}];
const RC_ARTICLES = [
	{
		id: "parties",
		number: "",
		title: "Entre les soussignés",
		variant: "both",
		body: "ENTRE LES SOUSSIGNÉS :\n\n{agencyBlock}\n\nET\n\nLE TALENT — {talentNom}, né(e) le {talentDateNaissance}, demeurant {talentAdresse}, exerçant sous le SIRET / statut : {talentSiret}.\nCi-après « le Talent ».\n\nEnsemble « les Parties »."
	},
	{
		id: "art1_objet_exclusif",
		number: "Article 1",
		title: "Objet du contrat",
		variant: "exclusif",
		body: "Le Talent confie à l'Agence, qui l'accepte, un mandat de représentation de manière EXCLUSIVE aux fins de :\n• représenter le Talent auprès de toutes marques, annonceurs et tiers, pour toute collaboration commerciale ;\n• assurer la gestion et le traitement des demandes entrantes via la boîte mail professionnelle du Talent (qualification, réponses, transfert, suivi) ;\n• négocier et sécuriser les contrats (volets financier, juridique, logistique) ;\n• gérer les encaissements et paiements au nom et pour le compte du Talent (mandat d'encaissement) ;\n• accompagner le développement stratégique du Talent (conseil éditorial, positionnement, diversification).\n\nCaractère exclusif — Pendant toute la durée du présent contrat, le Talent s'interdit de conclure, directement ou par l'intermédiaire d'un tiers, toute collaboration commerciale sans intervention préalable de l'Agence, sous réserve des exceptions prévues à l'article 4."
	},
	{
		id: "art1_objet_nonexclusif",
		number: "Article 1",
		title: "Objet du contrat",
		variant: "nonexclusif",
		body: "Le Talent confie à l'Agence, qui l'accepte, un mandat de représentation à caractère NON EXCLUSIF aux fins de :\n• représenter le Talent pour les collaborations apportées ou gérées par l'Agence ;\n• assurer la gestion et le traitement des demandes entrantes via la boîte mail professionnelle du Talent (qualification, réponses, transfert, suivi) ;\n• négocier et sécuriser les contrats (volets financier, juridique, logistique) ;\n• gérer les encaissements et paiements dans le cadre des deals où l'Agence est impliquée (mandat d'encaissement) ;\n• accompagner le développement stratégique du Talent (conseil éditorial, positionnement, diversification).\n\nCaractère non exclusif — Le Talent conserve la liberté de conclure directement des collaborations sans passer par l'Agence, sans obligation de tout confier à cette dernière."
	},
	{
		id: "art2_champ_exclusif",
		number: "Article 2",
		title: "Champ d'application",
		variant: "exclusif",
		body: "Le présent contrat couvre l'ensemble des activités monétisables du Talent : publications, stories, Reels, contenus TikTok ; contenus UGC ; événements, shootings, activations ; lancements de produits ou projets gérés par l'Agence ; et toute rémunération, en numéraire ou en avantages en nature, d'une valeur supérieure ou égale à {seuil} €.\nL'exclusivité s'applique à toutes les plateformes, présentes ou futures (Instagram, TikTok, YouTube et autres)."
	},
	{
		id: "art2_champ_nonexclusif",
		number: "Article 2",
		title: "Champ d'application",
		variant: "nonexclusif",
		body: "Le présent contrat couvre les activités monétisables pour lesquelles le Talent fait appel à l'Agence : partenariats sponsorisés, contenus UGC, événements, rémunérations diverses, ainsi que les demandes entrantes via la boîte mail professionnelle traitées par l'Agence.\nLe Talent n'a aucune obligation de tout confier à l'Agence."
	},
	{
		id: "art3_missions",
		number: "Article 3",
		title: "Missions de l'Agence",
		variant: "both",
		body: "L'Agence s'engage à :\n• prospecter et identifier des opportunités de collaboration ;\n• négocier les meilleures conditions (tarifs, droits, durées d'exploitation, exclusivités) ;\n• rédiger et sécuriser les contrats ;\n• gérer la logistique (briefs, validations, relances, reporting marques) ;\n• encaisser et reverser au Talent le montant NET, dans les {reversJours} jours ouvrés suivant la réception effective des fonds."
	},
	{
		id: "art3_mail_missions",
		number: "Article 3",
		title: "Missions de l'Agence — gestion de la boîte mail",
		variant: "both",
		includeIf: "gestionMail",
		body: "Au titre de la gestion complète de la boîte mail professionnelle du Talent, l'Agence assure : la consultation chaque jour ouvré, la qualification des demandes, la réponse aux sollicitations commerciales, le transfert immédiat des emails non commerciaux ou personnels, et l'archivage CRM."
	},
	{
		id: "art3_reporting",
		number: "Article 3",
		title: "Missions de l'Agence — reporting",
		variant: "both",
		includeIf: "reportingMensuel",
		body: "L'Agence établit un reporting mensuel synthétique (deals en cours, chiffre d'affaires généré, performances), incluant le cas échéant l'activité de la boîte mail professionnelle lorsque celle-ci est gérée par l'Agence."
	},
	{
		id: "art3bis_acces_mail",
		number: "Article 3 bis",
		title: "Accès à la boîte mail professionnelle",
		variant: "both",
		includeIf: "gestionMail",
		body: "3 bis.1 — Le Talent transmet à l'Agence les accès nécessaires (identifiants ou accès délégué de type Google Workspace) à la boîte mail {talentEmailPro}. Le Talent s'interdit de répondre directement aux emails professionnels à caractère commercial sans en informer l'Agence, et informe l'Agence de tout changement de mot de passe ou d'accès dans un délai de {mailChangementAccesHeures} heures.\n\n3 bis.2 — L'Agence s'engage à n'utiliser les accès à aucune fin étrangère à l'exécution du présent contrat, à une confidentialité stricte, et à ne prendre aucun engagement financier au nom du Talent sans son accord exprès.\n\n3 bis.3 — Les accès sont strictement limités à la durée du contrat. En cas de résiliation, les accès sont révoqués immédiatement et l'Agence cesse toute consultation dans un délai de {mailRevocationHeures} heures suivant la fin du préavis. Le traitement des données personnelles contenues dans la boîte mail s'effectue dans le respect du Règlement (UE) 2016/679 (RGPD)."
	},
	{
		id: "art_visibilite",
		number: "Article 7 bis",
		title: "Visibilité de l'Agence",
		variant: "both",
		includeIf: "visibiliteEmail",
		body: "Le Talent s'engage à afficher de manière visible l'adresse {emailAgence} sur l'ensemble de ses comptes et profils publics actifs (section Contact / Bio / Description ; bouton d'action « E-mail » sur Instagram, lien en bio TikTok, ou toute autre modalité claire), et ce pendant toute la durée du contrat.\nLe non-respect de cette obligation, après mise en demeure restée sans effet pendant {visibiliteMiseEnDemeureJours} jours ouvrés, constitue un manquement au sens de l'article relatif à la résiliation pour faute grave."
	},
	{
		id: "art4_remuneration_parOrigine",
		number: "Article 4",
		title: "Rémunération de l'Agence",
		variant: "both",
		includeIf: "modeCommissionParOrigine",
		body: "4.1 Principe — La commission de l'Agence est déterminée selon l'origine du deal et calculée sur la rémunération brute perçue par le Talent (numéraire + valeur des avantages en nature). Elle s'entend {regimeFiscalComm}.\nSeuil — Aucune commission n'est due si la rémunération brute est inférieure à {seuil} € (avantages inclus) ; les taux s'appliquent à compter de {seuil} €.\n\n4.2 Barème —\n• Deal apporté ET géré par l'Agence : {commApportee} % {regimeFiscalComm}.\n• Deal initié par le Talent, géré par l'Agence : {commInitiee} % {regimeFiscalComm}.\n• Collaboration autonome (article 4.3) : {commAutonome} %.\n\nCes conditions particulières, individuellement négociées, dérogent le cas échéant aux conditions générales.\n\n4.3 Collaborations autonomes (exception stricte) — À titre exceptionnel et sous réserve de l'accord écrit préalable de l'Agence, le Talent peut conclure directement, sans commission, des partenariats non commerciaux ou des échanges entre pairs. Toute collaboration commerciale conclue hors de ce cadre, sans accord préalable, constitue une violation de l'exclusivité et entraîne l'application de la clause pénale prévue à l'article Fin et résiliation.\n\n4.4 Avantages en nature — Les dotations ne sont pas réductrices du numéraire. Leur valeur n'est intégrée à l'assiette de la commission que si la contrepartie est à 100 % en gifting et que la valeur est supérieure à {seuil} €."
	},
	{
		id: "art4_remuneration_uniforme",
		number: "Article 4",
		title: "Rémunération de l'Agence",
		variant: "both",
		includeIf: "modeCommissionUniforme",
		body: "4.1 Principe — La commission de l'Agence est calculée sur la rémunération brute perçue par le Talent (numéraire + valeur des avantages en nature) et s'élève à {commUniforme} % {regimeFiscalComm}.\nSeuil — Aucune commission n'est due si la rémunération brute est inférieure à {seuil} € (avantages inclus) ; les taux s'appliquent à compter de {seuil} €.\n\n4.2 Barème —\n• Deal apporté par l'Agence, géré par l'Agence : {commUniforme} % {regimeFiscalComm}.\n• Deal apporté par le Talent, géré / négocié par l'Agence à sa demande : {commUniforme} % {regimeFiscalComm}.\n• Deal apporté ET géré intégralement par le Talent : {commAutonome} % (le Talent en informe néanmoins l'Agence).\n\nLes conditions particulières, individuellement négociées, dérogent le cas échéant aux conditions générales.\n\n4.3 Régime fiscal de la commission — La commission s'entend {regimeFiscalComm}. Lorsqu'elle s'entend TTC, le prélèvement s'opère net du taux applicable quelle que soit la situation fiscale du Talent.{mentionFranchiseTva}\n\n4.4 Avantages en nature — Les dotations ne sont pas réductrices du numéraire. Leur valeur n'est intégrée à l'assiette de la commission que si la contrepartie est à 100 % en gifting et que la valeur est supérieure à {seuil} €."
	},
	{
		id: "art5_mandat_encaissement",
		number: "Article 5",
		title: "Mandat d'encaissement",
		variant: "both",
		includeIf: "mandatEncaissement",
		body: "5.1 Le Talent donne mandat à l'Agence pour recevoir les rémunérations directement auprès des marques, en vérifier la conformité (montant, délais, conditions), et lui reverser le montant net dans les {reversJours} jours ouvrés suivant l'encaissement effectif, déduction faite de la commission. Une quittance et un relevé détaillé accompagnent chaque virement.\n\n5.2 Impayés — La responsabilité de tout impayé incombe exclusivement à la marque. L'Agence n'est pas garante des sommes dues et se limite à une diligence de recouvrement. Si le Talent conteste un virement, il fournit un justificatif bancaire de non-réception dans un délai de {contestationVirementJours} jours ouvrés."
	},
	{
		id: "art5_facturation_directe",
		number: "Article 5",
		title: "Modalités de paiement",
		variant: "both",
		includeIf: "mandatEncaissementFalse",
		body: "L'Agence ne procède à aucun encaissement pour le compte du Talent. Le Talent perçoit directement les rémunérations des marques et règle à l'Agence sa commission sur facture, à réception des fonds. En cas de défaillance de la marque, l'Agence assure une diligence de recouvrement ; la responsabilité de l'impayé incombe à la marque, l'Agence n'en étant pas garante.{clauseL44110Marque}"
	},
	{
		id: "art6_duree_determinee",
		number: "Article 6",
		title: "Durée et terme",
		variant: "both",
		includeIf: "modeDureeDeterminee",
		body: "6.1 Le présent contrat est conclu pour une durée DÉTERMINÉE de {dureeMois} mois, du {dateDebut} au {dateFin} inclus. Il ne fait l'objet d'AUCUNE tacite reconduction et prend fin de plein droit à son terme. Toute poursuite de la relation nécessite la conclusion d'un nouveau contrat.\n\n6.2 Période d'essai — Les Parties conviennent d'une période d'essai réciproque correspondant aux {essaiJours} premiers jours du contrat, durant laquelle chaque Partie peut résilier sans motif, par lettre recommandée avec accusé de réception, avec effet immédiat.{mentionEssaiEmail}"
	},
	{
		id: "art6_duree_reconductible",
		number: "Article 6",
		title: "Durée et renouvellement",
		variant: "both",
		includeIf: "modeDureeReconductible",
		body: "6.1 Le présent contrat est conclu pour une durée initiale de {dureeMois} mois à compter de la signature. Il est TACITEMENT reconductible par périodes successives de {periodeReconductionMois} mois, sauf dénonciation par lettre recommandée avec accusé de réception moyennant un préavis de {preavisJours} jours.\n\n6.2 Période d'essai — Les Parties conviennent d'une période d'essai réciproque correspondant aux {essaiJours} premiers jours du contrat, durant laquelle chaque Partie peut résilier sans motif, par lettre recommandée avec accusé de réception, avec effet immédiat.{mentionEssaiEmail}"
	},
	{
		id: "art7_obligations",
		number: "Article 7",
		title: "Obligations du Talent",
		variant: "both",
		body: "Le Talent s'engage à :\n• fournir mensuellement ses insights analytics (plateformes, données démographiques, performances) ;\n• respecter les briefs, livrables et échéances convenus ;\n• informer l'Agence de toute approche directe de marque dans un délai de {approcheDirecteHeures} heures ;\n• respecter la charte éthique TTP (aucun contenu illégal, haineux, discriminatoire ou contraire aux recommandations de l'ARPP) ;\n• assumer la responsabilité de ses contenus et indemniser l'Agence en cas de litige lié à ceux-ci.\n\n{art7Collab}"
	},
	{
		id: "art7_obligations_mail",
		number: "Article 7",
		title: "Obligations du Talent — accès mail",
		variant: "both",
		includeIf: "gestionMail",
		body: "Le Talent s'engage en outre à maintenir les accès à la boîte mail professionnelle actifs pendant toute la durée du contrat."
	},
	{
		id: "art8_pi_image",
		number: "Article 8",
		title: "Propriété intellectuelle et droit à l'image",
		variant: "both",
		body: "8.1 Le Talent conserve la pleine propriété de ses contenus. Les droits d'exploitation consentis aux marques sont négociés au cas par cas.\n\n8.2 Le Talent accorde à l'Agence un droit NON exclusif, gratuit et mondial d'utiliser son image, son nom et ses identifiants dans ses communications commerciales (portfolio, site, pitchs), {dureeDroitImage}."
	},
	{
		id: "art9_confidentialite",
		number: "Article 9",
		title: "Confidentialité",
		variant: "both",
		body: "Les Parties sont tenues à une obligation de confidentialité absolue portant sur les conditions financières, les stratégies internes et les informations relatives aux marques, prospects et partenaires{mentionContenuMail}. Cette obligation s'applique pendant toute la durée du contrat et pendant {confidentialiteApresAns} ans après son terme.{mentionRgpdConfid}"
	},
	{
		id: "art10_fin_terme",
		number: "Article 10",
		title: "Fin et résiliation",
		variant: "both",
		includeIf: "finAuTerme",
		body: "10.1 Le contrat prend fin de plein droit à son terme, le {dateFin}, sans qu'aucune formalité ne soit requise."
	},
	{
		id: "art10_fin_amiable",
		number: "Article 10",
		title: "Fin et résiliation",
		variant: "both",
		includeIf: "finAmiable",
		body: "10.1 Après la période d'essai, chaque Partie peut résilier à l'amiable, sans motif, par lettre recommandée avec accusé de réception, moyennant un préavis de {preavisJours} jours."
	},
	{
		id: "art10_resiliation_libre",
		number: "Article 10",
		title: "Fin et résiliation",
		variant: "both",
		includeIf: "resiliationLibre",
		body: "10.1 Résiliation libre — Chaque Partie peut résilier le présent contrat à tout moment, sans motif, par simple notification écrite (e-mail ou message), moyennant un préavis de {preavisResiliationLibre}. La résiliation prend effet {effetResiliationLibre}. Les deals signés avant cette date restent gérés par l'Agence jusqu'à leur terme, conformément à l'article 10.3, et la commission correspondante reste due."
	},
	{
		id: "art10_faute_grave",
		number: "Article 10",
		title: "Fin et résiliation — faute grave",
		variant: "both",
		body: "10.2 Résiliation anticipée pour faute grave — En cas de manquement grave (retard de paiement supérieur à {retardPaiementJours} jours, atteinte à l'image, violation de la confidentialité{mentionExclusiviteFaute}{mentionMailFaute}), la Partie lésée peut résilier par lettre recommandée avec accusé de réception motivée, avec effet immédiat.\n\n10.3 Deals en cours — L'Agence continue de gérer les deals en cours{mentionJusquauTerme} ; la commission correspondante reste due."
	},
	{
		id: "art10_revocation_mail",
		number: "Article 10",
		title: "Fin et résiliation — révocation des accès mail",
		variant: "both",
		includeIf: "gestionMail",
		body: "10.4 Révocation des accès — Les accès à la boîte mail sont révoqués à la date d'effet de la fin du contrat ; l'Agence cesse toute consultation dans un délai de {mailRevocationHeures} heures."
	},
	{
		id: "art10_clause_penale",
		number: "Article 10",
		title: "Fin et résiliation — clause pénale",
		variant: "both",
		includeIf: "clausePenaleActive",
		body: "10.{numClausePenale} Clause pénale — {libelleClausePenale} ouvre droit, au profit de l'Agence, à des dommages-intérêts forfaitaires égaux à {clausePenaleMois} mois de commission moyenne, sans préjudice de tout autre recours."
	},
	{
		id: "art11_responsabilite",
		number: "Article 11",
		title: "Responsabilité",
		variant: "both",
		body: "11.1 L'Agence est responsable de la bonne exécution de son mandat. Elle n'est pas responsable des contenus du Talent ni des impayés dès lors qu'elle a accompli les démarches de diligence et de recouvrement.\n\n11.2 Le Talent est seul responsable de ses contenus (respect de la loi, des recommandations de l'ARPP et des droits des tiers) et indemnise l'Agence de tout préjudice en résultant."
	},
	{
		id: "art11_responsabilite_mail",
		number: "Article 11",
		title: "Responsabilité — gestion de la boîte mail",
		variant: "both",
		includeIf: "gestionMail",
		body: "11.3 Gestion de la boîte mail — L'Agence agit avec diligence et loyauté. Elle n'est pas responsable d'un email manqué en cas d'indisponibilité technique ou de force majeure."
	},
	{
		id: "art12_litiges",
		number: "Article 12",
		title: "Litiges et loi applicable",
		variant: "both",
		body: "Le présent contrat est régi par le droit français. En cas de différend, les Parties s'engagent à rechercher une solution amiable préalable, au besoin par la médiation {organeMediation}. À défaut d'accord dans un délai de {mediationDelaiJours} jours, le {tribunal} sera seul compétent."
	}
];
const MONTHS = [
	"janvier",
	"février",
	"mars",
	"avril",
	"mai",
	"juin",
	"juillet",
	"août",
	"septembre",
	"octobre",
	"novembre",
	"décembre"
];
function frLong(iso) {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? "").trim());
	if (!m) return iso || "……………";
	const d = Number(m[3]);
	return `${d === 1 ? "1er" : d} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}
/**
* Dernier jour du contrat : début + N mois, moins un jour (15 mars + 12 mois = 14 mars).
* Quand le mois d'arrivée n'a pas ce jour (31 août + 6 mois : pas de 31 février), le
* contrat finit le dernier jour de ce mois (28 février), jamais en mars.
*/
function addMonthsMinusDay(iso, months) {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso ?? "").trim());
	if (!m) return "";
	const y = Number(m[1]);
	const mo = Number(m[2]) - 1 + (Number(months) || 0);
	const day = Number(m[3]);
	const lastDay = new Date(y, mo + 1, 0).getDate();
	const d = day > lastDay ? new Date(y, mo, lastDay) : new Date(y, mo, day - 1);
	const p = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const is = (c, k) => c[k] === "true";
/** Valeur d'un placeholder (config / champ créateur / figé / calculé). */
function ph(key, c) {
	switch (key) {
		case "agencyBlock": return RC_META.agencyBlock;
		case "emailAgence": return RC_META.emailAgence;
		case "talentNom": return c.talentNom || "……………";
		case "talentDateNaissance": return frLong(c.talentDateNaissance);
		case "dateSignature": return frLong(c.dateSignature);
		case "dateDebut": return frLong(c.dateDebut || c.dateSignature);
		case "dateFin":
			if (c.dateFin) return frLong(c.dateFin);
			return frLong(addMonthsMinusDay(c.dateDebut || c.dateSignature, Number(c.dureeMois || "0")));
		case "mentionFranchiseTva": return c.regimeFiscalComm === "TTC" && c.talentStatutTva === "franchise" ? " Le Talent relevant de la franchise en base de TVA, aucune TVA additionnelle n'est due." : "";
		case "clauseL44110Marque": return is(c, "clauseL44110") ? " Les intérêts de retard et l'indemnité forfaitaire de recouvrement prévus à l'article L.441-10 du Code de commerce sont, le cas échéant, réclamés à la marque défaillante." : "";
		case "mentionEssaiEmail": return is(c, "essaiParEmail") ? " La résiliation durant la période d'essai peut également intervenir par email confirmé." : "";
		case "dureeDroitImage": {
			const n = Number(c.imageApresTermeMois || "0");
			return n > 0 ? `pour la durée du contrat ET pendant ${n} mois suivant son terme` : "pour la seule durée du contrat, ce droit prenant fin à la date d'effet de la résiliation ou du non-renouvellement";
		}
		case "mentionContenuMail": return is(c, "gestionMail") ? ", ainsi que sur le contenu de la boîte mail professionnelle consulté par l'Agence" : "";
		case "mentionRgpdConfid": return is(c, "gestionMail") && is(c, "clauseRGPD") ? " Le traitement des données personnelles s'effectue conformément au Règlement (UE) 2016/679 (RGPD)." : "";
		case "mentionExclusiviteFaute": return c.variante === "exclusif" && is(c, "exclusivite") ? " ou de l'exclusivité" : "";
		case "mentionMailFaute": return is(c, "gestionMail") ? ", utilisation abusive des accès à la boîte mail" : "";
		case "art7Collab": {
			const regime = c.collabAutonomeRegime || (c.variante === "exclusif" ? "viaAgence" : "informer");
			if (regime === "libre") return "Collaborations initiées par le Talent — Le Talent demeure libre d'initier, de négocier et de gérer intégralement, par ses propres moyens (démarchage direct d'une marque, relance d'anciens partenaires, contacts personnels), les collaborations qu'il obtient de son propre chef. Ces collaborations, menées de bout en bout par le Talent, sont hors du périmètre du présent mandat : elles n'ouvrent droit à aucune commission au profit de l'Agence, et le Talent n'est pas tenu d'en informer cette dernière.";
			if (regime === "informer") return "Collaborations initiées par le Talent — Le Talent peut initier et gérer lui-même des collaborations qu'il obtient par ses propres moyens (démarchage direct d'une marque, relance d'anciens partenaires). Il s'engage toutefois à en informer l'Agence, à des fins de transparence, de suivi et de cohérence de son image ; la commission éventuellement applicable est celle prévue à l'article 4.";
			return "Collaborations initiées par le Talent — Toute opportunité de collaboration commerciale que le Talent viendrait à initier lui-même (démarchage direct d'une marque, relance d'anciens partenaires) est portée à la connaissance de l'Agence, qui en assure la gestion, la négociation et la conclusion. Le Talent s'interdit de conclure directement une collaboration commerciale sans l'intervention préalable de l'Agence.";
		}
		case "preavisResiliationLibre": return joursEnLettres(Number(c.resiliationLibreJours || "1"));
		case "effetResiliationLibre": return Number(c.resiliationLibreJours || "1") === 1 ? "le lendemain de la notification" : "à l'expiration de ce préavis";
		case "mentionJusquauTerme": return c.modeDuree === "determinee" ? " jusqu'à leur terme" : "";
		case "numClausePenale": return is(c, "gestionMail") ? "5" : "4";
		case "libelleClausePenale": return c.variante === "exclusif" ? "Toute violation avérée de l'exclusivité (collaboration conclue sans l'Agence, contournement)" : "Toute violation avérée des obligations du Talent ayant causé un préjudice à l'Agence (non-déclaration d'une collaboration manageable, contournement)";
		case "organeMediation": return c.mediationOrg === "mediateurInfluence" ? "(médiateur spécialisé en influence commerciale)" : "(CCI de Lyon)";
		default: return c[key] ?? "";
	}
}
const NOMBRES = [
	"zéro",
	"un",
	"deux",
	"trois",
	"quatre",
	"cinq",
	"six",
	"sept",
	"huit",
	"neuf",
	"dix",
	"onze",
	"douze",
	"treize",
	"quatorze",
	"quinze",
	"seize"
];
/** 1 → « un (1) jour », 7 → « sept (7) jours » (chiffres seuls au-delà de seize). */
function joursEnLettres(n) {
	const v = Number.isFinite(n) && n > 0 ? Math.round(n) : 1;
	const unit = v > 1 ? "jours" : "jour";
	return NOMBRES[v] ? `${NOMBRES[v]} (${v}) ${unit}` : `${v} ${unit}`;
}
/**
* Espaces insécables dans les montants (typo FR) : "5 000 € HT" ne se coupe plus
* en fin de ligne — milliers, avant €/%, et entre €/% et HT/TTC.
*/
function nbspFr(text) {
	return text.replace(/(\d)[ \u202f](?=\d{3}(?!\d))/g, "$1\xA0").replace(/(\d) (?=[€%])/g, "$1\xA0").replace(/([€%]) (?=(?:HT|TTC)\b)/g, "$1\xA0");
}
function resolve(text, c) {
	return nbspFr(text.replace(/\{(\w+)\}/g, (_, k) => ph(k, c)));
}
function includeOk(token, c) {
	if (!token) return true;
	switch (token) {
		case "modeCommissionParOrigine": return c.modeCommission === "parOrigine";
		case "modeCommissionUniforme": return c.modeCommission === "uniforme";
		case "mandatEncaissementFalse": return !is(c, "mandatEncaissement");
		case "modeDureeDeterminee": return c.modeDuree === "determinee";
		case "modeDureeReconductible": return c.modeDuree === "reconductible";
		case "finAuTerme": return c.modeDuree === "determinee" && !is(c, "resiliationLibre");
		case "finAmiable": return c.modeDuree === "reconductible" && !is(c, "resiliationLibre");
		default: return is(c, token);
	}
}
/** Assemble le contrat de représentation pour une configuration donnée. */
function buildRepresentation(config) {
	const variante = config.variante === "nonexclusif" ? "nonexclusif" : "exclusif";
	const v = RC_VARIANTS.find((x) => x.key === variante) ?? RC_VARIANTS[0];
	const articles = RC_ARTICLES.filter((a) => (a.variant === "both" || a.variant === variante) && includeOk(a.includeIf, config)).map((a) => {
		let number = a.number;
		if (a.id === "art_visibilite") number = variante === "exclusif" ? "Article 7 bis" : "Article 3 ter";
		return {
			number,
			title: a.title,
			body: resolve(a.body, config)
		};
	});
	const titleBits = [v.title];
	if (is(config, "contratTest")) titleBits.push("CONTRAT TEST");
	return {
		title: titleBits.join(" — "),
		subtitle: (config.titrePersonnalise || "").trim(),
		articles,
		preambule: resolve(RC_META.preambule, config),
		signatures: resolve(RC_META.signatures, config)
	};
}
const esc$1 = (s) => String(s ?? "").replace(/[<>&]/g, (ch) => ({
	"<": "&lt;",
	">": "&gt;",
	"&": "&amp;"
})[ch] ?? ch);
function htmlBody(text) {
	return esc$1(text).split("\n").map((l) => l.startsWith("• ") ? `<li>${l.slice(2)}</li>` : l.trim() === "" ? "" : `<p>${l}</p>`).join("").replace(/(<li>.*?<\/li>)+/g, (m) => `<ul>${m}</ul>`);
}
/** « CONTRAT DE REPRÉSENTATION » → « Contrat de représentation » (titre en capitales → phrase). */
function sentence(s) {
	const low = s.trim().toLowerCase();
	return low.charAt(0).toUpperCase() + low.slice(1);
}
/** « Article 7 bis » → 7.1 (pour remettre les articles dans l'ordre) ; sans numéro → -1. */
function articleRank(n) {
	const m = /(\d+)\s*(bis|ter|quater)?/i.exec(n || "");
	if (!m) return -1;
	return Number(m[1]) + ({
		bis: .1,
		ter: .2,
		quater: .3
	}[(m[2] || "").toLowerCase()] ?? 0);
}
/**
* Signatures : « Fait à … » puis un bloc par partie, côte à côte, avec un cadre pour
* signer. Le texte vient tel quel de RC_META.signatures ; seules les lignes de
* soulignés sont remplacées par le cadre. Format inattendu → texte brut, sans perte.
*/
function signaturesHTML(text) {
	const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
	const parties = paras.filter((p) => /^Pour\s/.test(p));
	if (parties.length !== 2) return `<div class="ct-signtext">${esc$1(text)}</div>`;
	const place = paras.filter((p) => !/^Pour\s/.test(p) && !/^_{3,}/.test(p) && !/\(signature/i.test(p));
	const note = paras.find((p) => /\(signature/i.test(p))?.replace(/^_{3,}\s*/, "").trim() ?? "";
	const col = (p, withNote) => {
		const [who, ...rest] = p.split("\n");
		const sig = /TTP|agence/i.test(who) ? sigImgHtml() : "";
		return `<div><div class="who">${esc$1(who)}</div>${rest.length ? `<div class="det">${esc$1(rest.join("\n"))}</div>` : ""}<div class="box">${sig}</div>${withNote && note ? `<div class="cap">${esc$1(note)}</div>` : ""}</div>`;
	};
	return `<div class="ct-sign">${place.map((p) => `<p class="place">${esc$1(p)}</p>`).join("")}<div class="cols">${col(parties[0], false)}${col(parties[1], true)}</div></div>`;
}
/** Contrat HTML imprimable (PDF) : mise en page « contrat » commune (CONTRACT_CSS, pdfDoc.ts). */
function representationHTML(config) {
	const c = buildRepresentation(config);
	const indexed = c.articles.map((a, idx) => ({
		...a,
		idx,
		rank: articleRank(a.number)
	}));
	const head = indexed.filter((a) => a.rank < 0);
	const numbered = indexed.filter((a) => a.rank >= 0).sort((a, b) => a.rank - b.rank || a.idx - b.idx);
	const groups = [];
	for (const a of [...head, ...numbered]) {
		const [base, ...more] = a.title.split(/\s+—\s+/);
		const last = groups[groups.length - 1];
		if (last && a.number && last.number === a.number) last.parts.push({
			sub: more.join(" — ") || (base !== last.title ? base : ""),
			body: a.body
		});
		else groups.push({
			number: a.number,
			title: base,
			parts: [{
				sub: more.join(" — "),
				body: a.body
			}]
		});
	}
	const articles = groups.map((g) => {
		const first = g.parts[0]?.body.trim() ?? "";
		return `<section class="ct-art">${!g.number && first.toLowerCase().startsWith(g.title.toLowerCase()) ? "" : `<h2>${g.number ? `${esc$1(g.number)}. ` : ""}${esc$1(g.title)}</h2>`}${g.parts.map((p) => `${p.sub ? `<h3>${esc$1(sentence(p.sub))}</h3>` : ""}${htmlBody(p.body)}`).join("")}</section>`;
	}).join("");
	const [headTitle, ...more] = c.title.split(/\s+—\s+/);
	const details = [...more.map(sentence), c.subtitle].filter(Boolean).join(" · ");
	return `${docHead(pdfFileTitle("Contrat de représentation", config.variante === "nonexclusif" ? "non exclusif" : "exclusif", config.talentNom), CONTRACT_CSS)}<body><div class="wrap ct">
${contractHead(RC_META.brandTitle, RC_META.brandSubtitle, [
		"<b>Contrat de représentation</b>",
		esc$1(docToday()),
		"Confidentiel"
	])}
${contractTitle(sentence(headTitle || c.title), details)}
<section class="ct-art" style="margin-top:9mm"><h2>Préambule</h2>${htmlBody(c.preambule)}</section>
${articles}
${signaturesHTML(c.signatures)}
<div class="ct-legal">${esc$1(RC_META.footer)}</div>
</div></body></html>`;
}
/** Réglages par défaut d'une variante (« exclusif » ou « nonexclusif ») : champs puis valeurs de la variante. */
function rcDefaultConfig(variant) {
	const base = {};
	for (const f of RC_FIELDS) base[f.key] = f.default;
	const v = RC_VARIANTS.find((x) => x.key === variant) ?? RC_VARIANTS[0];
	return {
		...base,
		...v.defaults
	};
}
// src/lib/money.ts
/**
* Helpers « argent » PURS (aucune dépendance : ni React, ni Supabase). Isolés
* ici pour que les tests Vitest puissent les couvrir SANS charger le client
* Supabase (qui, importé, initialise un client Realtime → plantait en CI sur
* Node sans WebSocket natif). Réexportés par appState.ts pour compatibilité.
*/
/** Lit UN nombre déjà isolé (sans signe ni suffixe) : "3000", "1200,50", "1.234,50", "1234.5".
*  Gère le séparateur décimal FR (virgule) sans l'écraser — sinon "3 000,00 €"
*  était lu 300000 (×100). Le point est lu comme séparateur de milliers quand
*  il y a aussi une virgule ("1.234,50") ou qu'il est suivi de 3 chiffres
*  ("5.000 €" → 5000) ; sinon comme décimale ("1234.5"). */
function readNumber(raw) {
	let s = raw.replace(/[^0-9.,-]/g, "");
	const lastComma = s.lastIndexOf(",");
	const lastDot = s.lastIndexOf(".");
	if (lastComma >= 0 && lastDot >= 0) {
		if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
		else s = s.replace(/,/g, "");
	} else if (lastComma >= 0) s = (s.match(/,/g) || []).length > 1 ? s.replace(/,/g, "") : s.replace(",", ".");
	else if (lastDot >= 0) {
		const dots = (s.match(/\./g) || []).length;
		const intPart = s.slice(0, s.indexOf(".")).replace("-", "");
		if (dots > 1 || /^\d+\.\d{3}$/.test(s.replace("-", "")) && intPart !== "0") s = s.replace(/\./g, "");
	}
	const n = parseFloat(s);
	return Number.isFinite(n) ? n : 0;
}
/** Les nombres d'une saisie, avec leur suffixe k/K (×1000) ou M (×1 000 000).
*  Les espaces entre groupes de 3 chiffres sont des séparateurs de milliers
*  ("3 000 €" = UN nombre) ; tout le reste sépare deux nombres ("2 x 500 €"). */
function amountTokens(s) {
	const joined = s.replace(/(\d)\s+(?=\d{3}(?!\d))/g, "$1");
	const out = [];
	for (const m of joined.matchAll(/(-?)(\d[\d.,]*)(?:\s*([kKmM])(?![a-zA-ZÀ-ÿ]))?/g)) {
		const mult = m[3] === "k" || m[3] === "K" ? 1e3 : m[3] === "m" || m[3] === "M" ? 1e6 : 1;
		const n = readNumber(m[2]) * mult;
		out.push(m[1] ? -n : n);
	}
	return out;
}
/**
* Montant texte → nombre, ou null si la saisie est vide, illisible ou AMBIGUË.
* Ambiguë = plusieurs nombres (« 800 € x 2 », « 2 x 500 € », « 1 000 + 500 »,
* « 800 / 1 000 », « 500 et 300 ») : on ne devine pas le calcul, on ne calcule rien.
* À utiliser partout où un montant faux partirait chez une marque ou un créateur
* (budget du bilan, cachets du rapport mensuel). « 3k » → 3000, « 1,5k€ » → 1500.
*/
function parseAmountStrict(x) {
	if (typeof x === "number") return Number.isFinite(x) ? x : null;
	const tokens = amountTokens(String(x ?? ""));
	if (tokens.length !== 1) return null;
	const n = Math.round(tokens[0] * 100) / 100;
	return Number.isFinite(n) ? n : null;
}
/** Parse un montant texte ("3 000 €", "1 200,50 €", "1.234,50", "1234.5", "3k", "1,5 M€")
*  en nombre ; 0 si vide ou illisible. Saisie à plusieurs nombres : ancien comportement
*  conservé pour les écrans existants (chiffres collés) ; pour un calcul qui part chez
*  une marque, utiliser parseAmountStrict. */
function parseAmount(x) {
	if (typeof x === "number") return Number.isFinite(x) ? x : 0;
	const strict = parseAmountStrict(x);
	if (strict !== null) return strict;
	return readNumber(String(x ?? "").replace(/\s/g, ""));
}
// src/lib/brandContract.ts
/**
* Moteur des contrats Marque × Créateur et UGC : clauses, conditions particulières et
* document HTML. Pur (ni React ni Supabase) : la page Contrats s'en sert pour son aperçu et
* son PDF, et Alfred (agents/alfred/contrats.mjs, généré depuis contractRender.ts) pour
* envoyer sur Telegram exactement le contrat que l'app aurait fait.
*/
const TYPE_META = {
	marque: {
		chip: "Marque × Créateur",
		label: "MARQUE × CRÉATEUR",
		title: "Contrat de partenariat commercial"
	},
	repr: {
		chip: "Représentation",
		label: "AGENCE × CRÉATEUR",
		title: "Contrat de représentation"
	},
	ugc: {
		chip: "Contrat UGC",
		label: "CONTRAT UGC",
		title: "Cession de droits UGC"
	}
};
const CLAUSES = [
	{
		l: "Art. 1 — Objet",
		v: "Le présent contrat définit les conditions de la prestation et les engagements réciproques des parties."
	},
	{
		l: "Art. 2 — Rémunération & paiement",
		v: "Les sommes sont versées par virement à 30 jours. Tout retard entraîne des pénalités au taux BCE + 10 pts et une indemnité forfaitaire de 40 € (art. L441-10 C. com.)."
	},
	{
		l: "Art. 3 — Droits d'auteur sur les contenus",
		v: "Le créateur conserve la propriété de ses contenus. La cession éventuelle de droits d'exploitation porte sur des contenus déterminés (jamais sur ses œuvres futures — art. L131-1 CPI) : chaque droit cédé fait l'objet d'une mention distincte, le domaine d'exploitation étant délimité quant à son étendue, sa destination, son lieu et sa durée (art. L131-3 CPI). Toute réutilisation hors périmètre fait l'objet d'un avenant."
	},
	{
		l: "Art. 4 — Droit à l'image",
		v: "L'autorisation d'utiliser l'image de la personne du créateur est distincte de la cession des droits d'auteur (art. 9 C. civ.) et limitée aux supports, au territoire, à la durée et aux contextes expressément stipulés. Elle exclut tout usage de nature à porter atteinte à sa réputation. Aucun usage hors de ce cadre sans accord écrit."
	},
	{
		l: "Art. 5 — Droit moral",
		v: "Le droit moral du créateur sur ses œuvres est inaliénable, perpétuel et imprescriptible (art. L121-1 CPI) : respect de son nom, de sa qualité et de l'intégrité de l'œuvre. Toute modification substantielle d'un contenu requiert son accord."
	},
	{
		l: "Art. 6 — Indépendance des parties",
		v: "Le créateur agit en prestataire indépendant : il conserve sa liberté éditoriale et de réalisation, n'est soumis à aucun lien de subordination et assume ses propres cotisations sociales. Aucune stipulation du contrat ne saurait caractériser un contrat de travail."
	},
	{
		l: "Art. 7 — Transparence publicitaire",
		v: "Tout contenu à visée commerciale est identifié de façon claire et lisible (« Publicité » ou « Collaboration commerciale »), conformément à la loi n° 2023-451 du 9 juin 2023 encadrant l'influence commerciale (modifiée par l'ord. n° 2024-978 du 6 nov. 2024), au droit de la consommation et aux recommandations de l'ARPP. Le cas échéant, les images retouchées (« Images retouchées ») et générées par IA (« Images virtuelles ») sont signalées."
	},
	{
		l: "Art. 8 — Données personnelles (RGPD)",
		v: "Les parties traitent les données conformément au Règlement (UE) 2016/679 (RGPD) et à la loi Informatique et Libertés. Finalité limitée à l'exécution du contrat."
	},
	{
		l: "Art. 9 — Confidentialité & résiliation",
		v: "Obligation de confidentialité réciproque. Résiliation possible pour manquement grave après mise en demeure restée infructueuse sous 15 jours."
	},
	{
		l: "Art. 10 — Force majeure",
		v: "Aucune partie n'est responsable d'un manquement dû à un cas de force majeure au sens de l'art. 1218 C. civ. ; les obligations sont suspendues le temps de l'empêchement."
	},
	{
		l: "Art. 11 — Droit applicable & litiges",
		v: "Contrat régi par le droit français. À défaut d'accord amiable (médiation préalable), compétence des tribunaux de Lyon (art. 42 CPC — sous réserve des règles impératives protégeant le for du défendeur non-commerçant)."
	}
];
const COLLAB_OPTS = [
	{
		v: "sponso",
		label: "Post sponsorisé"
	},
	{
		v: "ugc",
		label: "UGC (sans diffusion)"
	},
	{
		v: "gifting",
		label: "Placement / gifting"
	},
	{
		v: "ambassador",
		label: "Ambassadeur (long terme)"
	},
	{
		v: "event",
		label: "Prestation événementielle"
	}
];
const PAYMENT_OPTS = [
	{
		v: "30j",
		label: "Virement · 30 j fin de mois"
	},
	{
		v: "livraison",
		label: "À la livraison"
	},
	{
		v: "acompte",
		label: "50 % acompte · 50 % livraison"
	},
	{
		v: "45j",
		label: "Virement · 45 j"
	}
];
const TVA_OPTS = [{
	v: "non",
	label: "Non assujetti (art. 293 B CGI)"
}, {
	v: "20",
	label: "TVA 20 %"
}];
const EXCL_OPTS = [
	{
		v: "non",
		label: "Aucune"
	},
	{
		v: "cat30",
		label: "Catégorie · 30 jours"
	},
	{
		v: "cat90",
		label: "Catégorie · 90 jours"
	},
	{
		v: "total",
		label: "Secteur complet · durée du contrat"
	}
];
const labelOf = (opts, v) => opts.find((o) => o.v === v)?.label ?? v;
function objetOf(collab, brand) {
	const b = brand || "—";
	switch (collab) {
		case "ugc": return `Production de contenus UGC pour ${b}`;
		case "gifting": return `Placement de produit · ${b}`;
		case "ambassador": return `Programme ambassadeur · ${b}`;
		case "event": return `Prestation événementielle · ${b}`;
		default: return `Campagne ${b}`;
	}
}
function rightsValue(s) {
	switch (s.rights) {
		case "repost": return `Repost organique · ${s.rightsDuration}`;
		case "paid": return `Paid media / whitelisting · ${s.rightsDuration}`;
		case "buyout": return `Cession totale (buyout) · ${s.rightsDuration}`;
		default: return "Organique, compte du créateur uniquement";
	}
}
function payClause(payment) {
	switch (payment) {
		case "livraison": return "Les sommes sont versées par virement à la livraison et à la validation des contenus. Tout retard entraîne des pénalités au taux BCE + 10 pts et une indemnité forfaitaire de 40 € (art. L441-10 C. com.).";
		case "acompte": return "50 % du montant sont versés à la signature (acompte), le solde à la livraison et à la validation des contenus. Tout retard entraîne les pénalités légales (art. L441-10 C. com.).";
		case "45j": return "Les sommes sont versées par virement à 45 jours. Tout retard entraîne des pénalités au taux BCE + 10 pts et une indemnité forfaitaire de 40 € (art. L441-10 C. com.).";
		default: return "Les sommes sont versées par virement à 30 jours fin de mois. Tout retard entraîne des pénalités au taux BCE + 10 pts et une indemnité forfaitaire de 40 € (art. L441-10 C. com.).";
	}
}
function rightsClause(s) {
	const terr = s.territory;
	const dur = s.rightsDuration;
	switch (s.rights) {
		case "repost": return `Le créateur conserve la propriété de ses contenus et autorise l'Annonceur à les reposter sur ses propres canaux organiques (sans achat média), pour une durée de ${dur}, sur le territoire : ${terr}. Toute diffusion payante fait l'objet d'un avenant.`;
		case "paid": return `Le créateur cède à l'Annonceur les droits d'exploitation des contenus en publicité payante (whitelisting / paid media), pour une durée de ${dur}, sur le territoire : ${terr}. Cession limitée aux supports et à la durée stipulés.`;
		case "buyout": return `Cession totale (buyout) : le créateur cède l'ensemble des droits d'exploitation des contenus, tous supports, sur le territoire : ${terr}, pour une durée de ${dur}. Rémunération incluse dans le montant.`;
		default: return "Le créateur conserve la pleine propriété de ses contenus, publiés sur son seul compte. Aucune réutilisation par l'Annonceur hors de son compte n'est autorisée sans avenant.";
	}
}
/**
* Clauses adaptées au cas de figure : Art. 2/3 réécrits + clauses optionnelles.
* `htValue` sert à insérer la clause de vigilance sociale quand elle devient obligatoire.
*/
function buildClauses(s, htValue = 0) {
	const base = [
		CLAUSES[0],
		{
			l: "Art. 2 — Rémunération & paiement",
			v: payClause(s.payment)
		},
		{
			l: "Art. 3 — Droits d'auteur & droits d'usage",
			v: rightsClause(s)
		},
		...CLAUSES.slice(3)
	];
	let n = base.length + 1;
	const opt = [];
	if (s.exclScope !== "non") {
		const detail = s.exclScope === "total" ? "opérant dans le même secteur d'activité, pour toute la durée du contrat" : `de la même catégorie de produits, pendant ${s.exclScope === "cat90" ? "90" : "30"} jours à compter de la publication`;
		opt.push({
			l: `Art. ${n++} — Exclusivité`,
			v: `Pendant la période d'exclusivité, le créateur s'interdit toute collaboration rémunérée avec une marque concurrente ${detail}.`
		});
	}
	if (s.defraiement) opt.push({
		l: `Art. ${n++} — Frais & défraiement`,
		v: "L'Annonceur prend en charge les produits nécessaires à la prestation ainsi que les frais de déplacement et d'hébergement engagés à sa demande, sur présentation de justificatifs."
	});
	if (htValue >= 5e3) opt.push({
		l: `Art. ${n++} — Vigilance sociale`,
		v: "La prestation étant d'un montant au moins égal à 5 000 € HT, le créateur remet à la signature, puis tous les six mois jusqu'au terme, une attestation de vigilance URSSAF de moins de six mois (art. L8222-1, R8222-1 et D8222-5 C. trav.), dont l'authenticité est vérifiée auprès de l'organisme de recouvrement."
	});
	return [...base, ...opt];
}
const esc = (s) => String(s ?? "").replace(/[<>&]/g, (c) => ({
	"<": "&lt;",
	">": "&gt;",
	"&": "&amp;"
})[c] ?? c);
function refFor(name) {
	let h = 0;
	for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 900;
	return `TTP-${(/* @__PURE__ */ new Date()).getFullYear()}-${String(90 + h).padStart(3, "0")}`;
}
function contractHTML(o) {
	const { ref, meta, ctName, brand, parties, terms, clauses } = o;
	const termRows = terms.map((t) => `<div><dt>${esc(t.l)}</dt><dd>${esc(t.v)}</dd></div>`).join("");
	const clauseBlocks = clauses.map((c, i) => `<section class="ct-art"><h2>Article ${i + 1}. ${esc(c.l.replace(/^Art(?:icle)?\.?\s*\d+\s*[—–-]\s*/i, ""))}</h2><p>${esc(c.v)}</p></section>`).join("");
	const kind = meta.label.charAt(0) + meta.label.slice(1).toLowerCase().replace("× créateur", "× Créateur").replace("ugc", "UGC");
	return `${docHead(pdfFileTitle(`Contrat ${ref}`, [brand, ctName].filter(Boolean).join(" x ")), CONTRACT_CSS)}<body><div class="wrap ct">
${contractHead("TTP Creators", "Talent management · Lyon et Genève", [
		`<b>${esc(kind)}</b>`,
		`Réf. ${esc(ref)} · ${esc(docToday())}`,
		"Confidentiel"
	])}
${contractTitle(meta.title, `${ctName} × ${brand || "[Marque]"}`)}
<p class="ct-intro">${esc(parties)}</p>
<section class="ct-art"><h2>Conditions particulières</h2><dl class="ct-terms">${termRows}</dl></section>
${clauseBlocks}
<div class="ct-sign"><div class="cols">
  <div><div class="who">Pour TTP Creators</div><div class="box">${sigImgHtml()}</div><div class="cap">Date et signature, précédées de « Lu et approuvé »</div></div>
  <div><div class="who">Pour ${esc(ctName)}</div><div class="box"></div><div class="cap">Date et signature, précédées de « Lu et approuvé »</div></div>
</div></div>
<div class="ct-legal">Contrat régi par le droit français · Conforme RGPD (UE 2016/679) · Directive 2011/83/UE · Fait à Lyon. Document généré par TTP Suite.</div>
</div></body></html>`;
}
/** Les parties et les conditions particulières du contrat. */
function brandTerms(f, ctDisplay) {
	const { ctType, brand, deliverables, value, duration, collab, territory, defraiement } = f;
	const exclLabel = labelOf(EXCL_OPTS, f.exclScope);
	const commClean = String(f.commission).replace(/[^0-9.]/g, "") || "20";
	const payTerms = [{
		l: "Modalités",
		v: labelOf(PAYMENT_OPTS, f.payment)
	}, {
		l: "TVA",
		v: labelOf(TVA_OPTS, f.tva)
	}];
	if (ctType === "marque") return {
		parties: `ENTRE ${brand || "[Annonceur]"} (l'Annonceur) ET ${ctDisplay}, représenté(e) par TTP Creators (l'Agent).`,
		terms: [
			{
				l: "Objet",
				v: objetOf(collab, brand)
			},
			{
				l: "Nature",
				v: labelOf(COLLAB_OPTS, collab)
			},
			{
				l: "Livrables",
				v: deliverables || "—"
			},
			{
				l: "Montant",
				v: nbspFr(value || "—")
			},
			{
				l: "Cession de droits",
				v: rightsValue(f)
			},
			{
				l: "Territoire",
				v: territory
			},
			{
				l: "Exclusivité",
				v: exclLabel
			},
			{
				l: "Durée",
				v: duration || "—"
			},
			{
				l: "Commission TTP",
				v: `${commClean}% du montant`
			},
			...defraiement ? [{
				l: "Frais & produits",
				v: "Pris en charge par l'Annonceur"
			}] : [],
			...payTerms
		]
	};
	if (ctType === "repr") return {
		parties: `ENTRE ${ctDisplay} (le Créateur) ET TTP Creators (l'Agent), pour la gestion de sa carrière.`,
		terms: [
			{
				l: "Objet",
				v: "Représentation exclusive"
			},
			{
				l: "Commission",
				v: `${commClean}%`
			},
			{
				l: "Exclusivité",
				v: exclLabel
			},
			{
				l: "Durée",
				v: duration || "—"
			},
			{
				l: "Périmètre",
				v: "Négo · contrats · facturation"
			},
			...payTerms
		]
	};
	return {
		parties: `ENTRE ${brand || "[Client]"} (le Client) ET ${ctDisplay} (Créateur UGC), via TTP Creators.`,
		terms: [
			{
				l: "Objet",
				v: `Contenus UGC pour ${brand || "—"}`
			},
			{
				l: "Livrables",
				v: deliverables || "—"
			},
			{
				l: "Montant",
				v: nbspFr(value || "—")
			},
			{
				l: "Cession de droits",
				v: rightsValue(f)
			},
			{
				l: "Territoire",
				v: territory
			},
			{
				l: "Exclusivité",
				v: exclLabel
			},
			{
				l: "Durée",
				v: duration || "—"
			},
			...defraiement ? [{
				l: "Frais & produits",
				v: "Pris en charge par l'Annonceur"
			}] : [],
			...payTerms
		]
	};
}
/** Toutes les clauses (socle adapté au cas de figure, puis clauses ajoutées), espaces insécables posées. */
function brandClauses(s, value, extra) {
	return [...buildClauses(s, parseAmount(value)), ...extra.map((e) => ({
		l: e.l,
		v: e.v
	}))].map((c) => ({
		...c,
		v: nbspFr(c.v)
	}));
}
/** Nom du créateur tel qu'il s'affiche dans le contrat (« léa martin » → « Léa Martin »). */
function ctDisplayName(ctName) {
	if (ctName === "[Créateur]") return ctName;
	return String(ctName ?? "").toLowerCase().replace(/(^|[\s'’-])([a-zà-ÿ])/g, (_m, a, b) => a + b.toUpperCase());
}
/** Le contrat complet (HTML du PDF) pour ces réglages : le même que « Générer le PDF » dans l'app. */
function brandContractDoc(f, ctName) {
	const ctDisplay = ctDisplayName(ctName);
	const meta = TYPE_META[f.ctType];
	const ref = refFor(ctName);
	const { parties, terms } = brandTerms(f, ctDisplay);
	const html = contractHTML({
		ref,
		meta,
		ctName: ctDisplay,
		brand: f.brand,
		parties,
		terms,
		clauses: brandClauses(f, f.value, f.extra)
	});
	return {
		ref,
		title: meta.title,
		html
	};
}
// src/lib/contractRender.ts
/**
* Contrat rendu hors de l'app, pour Alfred : à partir des mêmes entrées que l'outil
* `preparer_contrat` (marque, montant, livrables… ou `representation`), le HTML exact que la
* page Contrats aurait fait (même moteur, mêmes clauses, même mise en page). Alfred le reçoit
* tout fait dans `agents/alfred/contrats.mjs` (généré par `npm run alfred:contrats`) et
* l'envoie en PDF sur Telegram. La signature de l'agence n'y est pas : elle se pose quand Marc
* génère le contrat dans l'app.
*/
function renderContract(a) {
	const ctName = typeof a.createur === "string" ? a.createur.replace(/\s+/g, " ").trim().slice(0, 80) : "";
	if (!ctName) return { erreur: "Indique le créateur (createur)." };
	const r = normaliserBrouillon(a, {
		id: "alfred",
		ts: Date.now(),
		ctName,
		externe: estRepresentation(a)
	});
	if ("erreur" in r) return r;
	const d = r.brouillon;
	if (d.ctType === "repr") {
		const config = {
			...rcDefaultConfig(d.config?.variante ?? "exclusif"),
			...d.config
		};
		return {
			html: representationHTML(config),
			titre: `Contrat de représentation · ${config.talentNom}`
		};
	}
	if (!d.form) return { erreur: "Contrat incomplet." };
	const doc = brandContractDoc({
		...d.form,
		extra: d.form.extra.map((c) => ({
			l: c.l,
			v: c.v
		}))
	}, d.ctName);
	return {
		html: doc.html,
		titre: `${doc.title} · ${d.brand} × ${d.ctName}`
	};
}
export { renderContract };
