-- TITRE : TTP Suite · Alfred, le bras droit et talent manager (2026-11-06)
-- ============================================================================
-- L'agent « Talent manager » (section Agents) devient Alfred, choisi par Marc les
-- 5 et 6 novembre 2026 : il tourne sur le Mac de Marc (agents/alfred, launchd), répond
-- tout de suite sur son propre bot Telegram, fait le point du lundi au vendredi à 9 h et
-- 17 h, prépare des brouillons (mails dans Gmail, envoyés sur « oui » de Marc ; devis dans
-- Facturation), tient la to-do et pose des rappels. Données seulement, aucun changement de
-- structure. Sans risque à relancer.
-- ============================================================================
update agent.agents set
  nom = 'Alfred',
  emoji = '🎩',
  role = 'Bras droit et talent manager : répond à Marc sur Telegram, prépare les réponses aux marques, les devis, les relances de factures et les messages aux créateurs, tient la to-do et les rappels.',
  consignes = replace(consignes,
    '1. Tu n''envoies jamais rien : mails en brouillon (creer_brouillon_mail), DM et WhatsApp dans la file « À valider » (proposer_action).',
    '1. Rien ne part sans un « oui » de Marc : mails en brouillon (creer_brouillon_mail) montrés sur Telegram et envoyés sur son « oui » (envoyer_brouillon), devis en brouillon (preparer_devis), messages WhatsApp livrés sur Telegram, qu''il copie et envoie lui même.'),
  routines = '[{"nom": "Le passage du matin", "quand": "Du lundi au vendredi à 9 h", "consigne": "Mails des marques reçus depuis le dernier passage : un brouillon de réponse pour chaque vraie demande, un devis en brouillon quand une marque demande un prix. Relances des factures en retard. Messages aux créateurs : fins de contrat et d''exclusivité, anniversaires, tournages, publications et briefs des 2 prochains jours. Résumé et textes WhatsApp sur Telegram."}, {"nom": "Le passage du soir", "quand": "Du lundi au vendredi à 17 h", "consigne": "Seulement les mails des marques reçus depuis le matin (brouillons de réponse et devis), et un message créateur s''il y a une urgence pour demain. Résumé sur Telegram."}]'::jsonb,
  maj_le = now()
where slug = 'talent-manager';

-- Contrôle : nom = Alfred, 2 routines, règle 1 à jour.
select nom, jsonb_array_length(routines) as routines, position('envoyer_brouillon' in consignes) > 0 as regle_a_jour
from agent.agents where slug = 'talent-manager';
