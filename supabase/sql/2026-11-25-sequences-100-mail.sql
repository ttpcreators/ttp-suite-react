-- ============================================================================
-- 2026-11-25 : séquences de prospection 100 % mail (décision de Gianni du 25/11, après le
-- premier vrai lot). Les séquences en cours bloquées sur une étape LinkedIn ou Instagram
-- (qu'on n'automatise pas) passent à la relance mail J+5, à la date du J0 + 5 jours.
-- Rien n'est envoyé : la séance du matin prépare la relance, Gianni valide.
-- Relançable sans risque (ne touche que les séquences en cours sur un canal autre que mail).
-- ============================================================================

update public.contacts
set sequence = sequence
  || jsonb_build_object(
       'etape', 'J+5',
       'canal', 'email',
       'prochaine', to_char((sequence->>'debut')::date + 5, 'YYYY-MM-DD'),
       'maj', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
     )
where sequence->>'statut' = 'en_cours'
  and coalesce(sequence->>'canal', '') <> 'email'
  and sequence->>'debut' ~ '^\d{4}-\d{2}-\d{2}$';

-- Contrôle : plus aucune séquence en cours hors mail.
select sequence->>'etape' as etape, sequence->>'canal' as canal, count(*)
from public.contacts where sequence->>'statut' = 'en_cours' group by 1, 2 order by 3 desc;
