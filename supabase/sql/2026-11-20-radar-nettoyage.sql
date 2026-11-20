-- TITRE : TTP Suite · Radar à marques : passer les faux positifs en « ignorée » (2026-11-20)
-- ============================================================================
-- Le radar (ig_radar, page Sourcing) contenait des mots courants pris pour des marques :
-- « every », « attention », « important », « signature », « her »… Meta retire les @ des
-- légendes, ig-sourcing devinait les noms de compte, et un mot courant est souvent aussi le
-- @ d'un vrai compte (« every » = un photographe). La règle a été corrigée dans
-- _shared/mentions.ts (PR radar-marques). Ce fichier applique la même règle aux lignes
-- déjà en base, en statut « nouveau » seulement :
--   mesure             : une mesure, une heure, un rang (« 10km », « 09h30 », « 3rd ») ;
--   mot_courant        : le nom est dans la liste STOP de mentions.ts ;
--   createur           : c'est une créatrice (roster, Scouting, ou lue par le radar), pas une marque ;
--   mot_de_la_langue   : simple mot écrit avec une majuscule dans au moins 2 légendes
--                        (« Attention »), sans indice fort (« merci x », « wearing x »), pas un
--                        contact, et dont le compte Meta ne passe pas la règle des marques ;
--   compte_pas_marque  : simple mot dont le compte Meta ne porte pas ce nom (nom affiché,
--                        site), ou a moins de 1 000 abonnés sans site à son nom, pas un contact.
-- Rien n'est supprimé : les lignes passent en « ignorée » (l'agence peut les remettre).
-- Les lignes « pipeline » et « ignorée » ne sont pas touchées. Peut être relancé sans risque.
-- Lancer tout le fichier d'un coup (la vue temporaire ne vit que le temps de la session).
-- ============================================================================
create or replace temp view radar_nettoyage as
with stop(w) as (select unnest(array[
    'a','about','ad','ads','adventure','affiliation','affilie','after','again','all','alors','also','always',
    'amazing','ambassadeur','ambassador','ambassadrice','an','and','animation','annee','another','any',
    'anybody','anyone','apparence','appearance','apres','architecture','are','arrangements','artist',
    'artists','as','assaisonner','astuce','astuces','asymmetrical','at','atelier','attention','aussi',
    'authentic','authentique','autre','autres','autumn','available','avant','avec','aventure','avoir','back',
    'basic','basics','basketball','be','beaucoup','beautiful','beauty','because','been','before','belle',
    'best','bien','big','bio','black','blue','bonheur','boutique','brush','but','butternut','cadeau',
    'cadeaux','cannelle','car','ces','cette','chacun','chacune','challenges','champignons','chaque',
    'charcuterie','chef','chopped','chose','christmas','classic','code','collab','collaborations',
    'collection','collector','color','colour','come','comme','commercial','commerciale','commerciales',
    'communaute','community','complement','compliments','composition','compromis','conseil','conseils',
    'contre','couper','courtesy','craftsmanship','creation','creations','croissant','croquante','custom',
    'cute','dancers','dans','day','days','dedicated','dedication','demain','depuis','des','design',
    'dessinateurs','detailing','details','dimanche','dimension','dire','direction','disponible','do','donc',
    'down','drole','each','ease','edition','electronics','elle','elles','embroidery','encore','endurance',
    'ensemble','entourage','entre','entrepreneurs','environment','episode','essentials','est','even','every',
    'everybody','everyone','everything','everywhere','expedition','experience','extreme','facebook','faire',
    'fait','fall','family','fashion','feel','finishers','first','fitness','flash','fleuriste','fois','follow',
    'food','for','frame','france','fresh','friday','friends','from','get','gifted','go','going','gold','golf',
    'good','goodness','got','grace','grand','grande','gravel','great','green','gym','habitudes','happy',
    'health','heater','helicopter','her','here','hier','highlights','him','his','histoire','history','home',
    'honey','horse','hotel','how','human','humans','humor','humour','if','ils','important','in','incroyable',
    'individual','indulgent','infiniment','initiative','inspiration','instagram','instructions','insulation',
    'intention','into','is','it','its','jamais','jardinage','jeudi','jolie','jour','jours','joy','just',
    'know','lancement','landscapes','last','laughter','launch','legendary','les','leur','leurs','lien','life',
    'link','listening','lit','little','local','look','looks','love','loved','lundi','lyon','made',
    'magnifique','maintenant','mais','maison','make','makeup','maman','management','many','mardi','mariage',
    'matcha','me','melted','membership','meme','memorable','memories','merci','mercredi','merit',
    'merveilleux','mes','messagerie','mille','mini','minimal','minimalism','minimalist','mois','moment',
    'moments','mon','monday','monde','more','morning','most','motivation','mountains','much','my','nationale',
    'nationwide','natural','nature','naturel','need','neighborhood','never','new','next','ni','nice','night',
    'nobody','noel','non','nos','not','nothing','notre','nous','nouveau','nouvelle','now','nutrients',
    'nutrition','of','off','offert','offerte','offertes','official','officiel','onctueuse','one','only','or',
    'organic','other','oui','our','out','outfit','over','overdressed','own','papa','papeterie','papier','par',
    'parachute','parfait','parfaite','parfaites','parfois','paris','partenaire','partenaires','partenariat',
    'partnership','passer','passion','passionne','pendant','people','personne','petit','petite','peu','photo',
    'photos','pink','planet','plein','pleins','plus','poise','portraits','post','pour','pourquoi','precious',
    'precise','premiering','premium','presented','pride','producer','production','programme','progression',
    'promo','protein','pub','publicite','qualite','quality','quand','que','qui','quoi','race','rare',
    'ravitaillement','raw','really','recette','red','reel','reels','refaire','reflector','remarkable',
    'remunere','remuneree','renaissance','rendez','renouveler','rentree','resistance','restaurants','rich',
    'ride','rien','rotation','route','routine','run','running','runs','sale','same','samedi','sans',
    'saturday','saupoudre','science','see','semaine','series','ses','sharp','sharpness','she','shop','side',
    'signature','silver','simple','skincare','small','smooth','snack','so','social','soldes','solutions',
    'some','someone','something','somewhere','son','sont','sous','souvenirs','spectacular','speed',
    'spiritual','sponsored','sponsorise','sponsorisee','sport','spring','statement','still','stimulate',
    'stories','storm','story','strangers','streaming','strong','studio','style','success','such','summer',
    'sunday','super','sur','take','temps','tes','thank','thanks','that','the','their','them','there','these',
    'they','think','this','those','three','thursday','tiktok','time','tips','to','toast','today','together',
    'tomorrow','ton','tonight','toujours','tous','tout','toute','toutes','training','transformation',
    'transformed','travel','tres','trop','trouvaille','tuesday','two','ultra','undeniable','une','up','us',
    'vendredi','vers','very','vibrant','video','videography','videos','vie','views','vintage','violinist',
    'visual','volleyball','vos','votre','vous','voyage','vraiment','wandering','want','was','water','way',
    'we','website','wedding','wednesday','week','weekend','were','what','when','where','white','who','why',
    'wildflowers','winter','with','workout','world','year','yellow','yes','yesterday','yoga','you','your',
    'youtube','zero','zoom'
  ])),
-- @ normalisé (comme igUser) : sans lien instagram.com, sans @, sans / ni ?.
connus as (
  select distinct lower(regexp_replace(regexp_replace(trim(instagram), '^(https?://)?(www\.)?instagram\.com/', '', 'i'), '^@|[/?#].*$', '', 'g')) u
  from public.contacts where instagram is not null
),
createurs as (
  select lower(regexp_replace(regexp_replace(trim(coalesce(nullif(instagram, ''), case when platform ilike '%insta%' then handle end)), '^(https?://)?(www\.)?instagram\.com/', '', 'i'), '^@|[/?#].*$', '', 'g')) u
  from public.creators
  union select lower(regexp_replace(regexp_replace(trim(handle), '^(https?://)?(www\.)?instagram\.com/', '', 'i'), '^@|[/?#].*$', '', 'g')) from public.creator_pool
  union select 'ttp.creators'
  -- créatrices dont le radar a lu les posts et qui ne sont pas des marques
  union select username from public.ig_profiles where scanned_at is not null and coalesce((data->>'isBrand')::boolean, false) = false
),
-- Mots écrits avec une majuscule dans au moins 2 légendes du radar (comme proseWords).
legendes as (
  select distinct on (x->>'url') x->>'url' url, x->>'cap' cap
  from public.ig_radar r, jsonb_array_elements(r.posts) x where coalesce(x->>'url', '') <> ''
),
mots as (
  select lower(m[1]) w, count(distinct l.url) n
  from legendes l, regexp_matches(l.cap, '(?:^|[^[:alnum:]_.@#''’])([A-Z][a-z]{2,})(?=$|[^[:alnum:]_''’])', 'g') m
  group by 1 having count(distinct l.url) >= 2
),
nouveaux as (
  select r.brand, r.posts, p.data, p.why
  from public.ig_radar r left join public.ig_profiles p on p.username = r.brand
  where r.status = 'nouveau'
),
-- Indice fort juste avant le mot dans un de ses posts (« merci x », « wearing x », « photo by x »…).
fort as (
  select n.brand from nouveaux n, jsonb_array_elements(n.posts) x
  where n.brand ~ '^[a-z]+$' and n.brand in (select w from mots)
    and (x->>'cap') ~* ('(^|[^[:alnum:]_.])(((merci|thanks|thank|thx|x|×|feat|ft|ambassador|ambassadrice|partner|partenaire|photographer|photographe|wearing|styled|styling|mua|collab|collaboration|partenariat|narrated|explorer|athlete|athlète|credit|credits|crédit)[:,.]?)|📸|🎥|📷|((photo|photos|photography|shot|narrated|styled|styling|made|designed|dress|robe|makeup|maquillage|hair|coiffure|look|tenue|outfit|video|vidéo|film|filmed|edited)[ ]+(by|par|with|avec|w)))[ ]+' || n.brand || '([^[:alnum:]_.]|$)')
  group by 1
),
-- Le compte lu chez Meta porte-t-il ce nom (comme ownsName) ?
profils as (
  select n.brand,
    coalesce((n.data->>'followers')::numeric, 0) abonnes,
    lower(regexp_replace(normalize(coalesce(n.data->>'name', ''), NFKD), '[\u0300-\u036f]', '', 'g')) nom,
    lower(regexp_replace(coalesce(n.data->>'website', ''), '^https?://(www\.)?', '', 'i')) site
  from nouveaux n
  where n.brand ~ '^[a-z]+$' and n.why is null and n.data is not null and n.data ? 'followers'
),
porte_nom as (
  select f.brand, f.abonnes,
    (length(regexp_replace(f.nom, '[^a-z0-9]', '', 'g')) >= 3
      and (regexp_replace(f.nom, '[^a-z0-9]', '', 'g') like '%' || f.brand || '%' or f.brand like '%' || regexp_replace(f.nom, '[^a-z0-9]', '', 'g') || '%'))
    or exists (select 1 from regexp_split_to_table(f.nom, '[^a-z0-9]+') t where length(t) >= 4 and f.brand like '%' || t || '%')
    or (select count(*) >= 3 and string_agg(left(t, 1), '') = f.brand from regexp_split_to_table(f.nom, '[^a-z0-9]+') t where t <> '')
    or exists (select 1 from regexp_split_to_table(f.site, '[^a-z0-9]+') t where t = f.brand or (length(t) >= 4 and (t like '%' || f.brand || '%' or f.brand like '%' || t || '%'))) as ok,
    regexp_replace(split_part(split_part(f.site, '/', 1), '.', 1), '[^a-z0-9]', '', 'g') = f.brand as site_a_son_nom
  from profils f
),
-- Comptes qui passent la nouvelle règle (brandAccountOk) : on ne les touche pas.
marques as (
  select n.brand from nouveaux n join porte_nom p on p.brand = n.brand
  where coalesce((n.data->>'isBrand')::boolean, false) and p.ok and (p.abonnes >= 1000 or p.site_a_son_nom)
)
select n.brand,
  case
    when n.brand ~ '^[0-9]+([.,][0-9]+)?(st|nd|rd|th|er|e|eme|h|hr|hrs|min|mins|s|sec|km|k|m|cm|mm|g|kg|mg|ml|cl|l|am|pm|x|j|an|ans|yo|y|d|w|kcal|cal)?[0-9]*$'
      or n.brand ~ '^[0-9]+x[0-9]+$' then 'mesure'
    when n.brand in (select w from stop) then 'mot_courant'
    when n.brand in (select u from createurs) then 'createur'
    when n.brand ~ '^[a-z]+$' and n.brand not in (select u from connus) and n.brand not in (select brand from marques)
      and n.brand in (select w from mots) and n.brand not in (select brand from fort) then 'mot_de_la_langue'
    when n.brand ~ '^[a-z]+$' and n.brand not in (select u from connus)
      and exists (select 1 from porte_nom p where p.brand = n.brand and (not p.ok or (p.abonnes < 1000 and not p.site_a_son_nom))) then 'compte_pas_marque'
  end as raison
from nouveaux n;

-- 1. Aperçu : combien de lignes par raison (lecture seule).
select raison, count(*) as lignes, (array_agg(brand order by brand))[1:15] as exemples
from radar_nettoyage where raison is not null group by raison order by lignes desc;

-- 2. Nettoyage : statut « ignore », rien n'est supprimé.
update public.ig_radar r set status = 'ignore'
from radar_nettoyage n
where n.brand = r.brand and n.raison is not null and r.status = 'nouveau';

select status, count(*) from public.ig_radar group by status order by status;
