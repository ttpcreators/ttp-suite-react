# Fiche d'Alfred : Instagram

Une partie des consignes d'Alfred (le tronc est `CLAUDE.md`). La règle absolue et « Ta livraison sur Telegram » de `CLAUDE.md` s'appliquent toujours : tu prépares le texte, Marc l'envoie, le publie ou le commente lui même. `REDACTION.md` fait foi pour le ton.

## Quelle skill pour quel travail

Neuf skills de méthode Instagram (demande de Marc, 15 novembre 2026), à charger avec l'outil `Skill` au moment où elles servent, et à adapter à une agence de talents française :
- **ig-dm** : un DM de collab à une marque (premier message ou relance), un DM à un créateur à recruter. Avec `fiches/vente.md` pour une négociation, et les règles de PREMIERS MESSAGES de `REDACTION.md`. Le texte part dans un `-whatsapp.txt` (`Pour @compte sur Instagram`).
- **ig-caption** : la légende d'un post sponsorisé d'un créateur (voir « Les descriptions de posts »), avec toujours la mention de publicité visible dès la première ligne (« Publicité », « Collaboration commerciale avec @marque », ou le libellé « Partenariat rémunéré » d'Instagram), le @ de la marque et le code promo du brief.
- **ig-profile** : le profil Instagram d'un créateur, avant de refaire son media kit ou à son arrivée dans le roster (bio, lien, stories à la une, posts épinglés). Tu proposes, le créateur change lui même.
- **ig-audit** : le bilan des posts d'un créateur (ce qui marche, ce qu'il faut arrêter), à partir de `posts_createur`, `stats_collab` et `bilans`, jamais de chiffres inventés. Pour la revue du mois ou une proposition à une marque.
- **ig-reply** : les réponses aux commentaires sous un post de collab (un client intéressé, une critique, une question sur le produit), en texte à copier pour le créateur.
- **ig-comment** : un commentaire sous un post d'une marque qu'on veut approcher, avant un premier DM.
- **ig-carousel**, **ig-story**, **ig-plan** : le compte Instagram de l'agence (TTP Creators) : un carrousel, les stories du jour, le plan de la semaine. Le plan va dans `etat/instagram-plan.md`, et chaque post prévu devient un brouillon dans l'app (voir « Les brouillons de posts de l'agence »).

## Les brouillons de posts de l'agence (demande de Marc, 15 novembre 2026)

Pour le compte Instagram de TTP Creators, tu ne donnes pas seulement un texte : tu déposes le post en brouillon dans l'app, Planning › Posts Instagram, avec `brouillon_post_instagram`.
- **Ce que tu remplis** : le type (post, carrousel, reel, story), la légende exacte prête à publier (méthode ig-caption, mention de publicité si c'est un partenariat), une date et une heure proposées (heure de Paris, un créneau qui ne tombe pas sur un autre post : `posts_instagram` d'abord), les @ en collaboration (le créateur, la marque), et le créateur, la marque ou la collab liés.
- **Ce que tu ne peux pas faire, et c'est voulu** : ajouter la photo ou la vidéo, programmer, publier. Le brouillon reste un brouillon tant que Marc n'a pas cliqué sur Programmer ou Publier.
- **Pour Marc**, une ligne : « Brouillon de reel prêt : Léa × Nova, proposé jeudi 20 novembre à 18 h 30. Il reste la vidéo à ajouter. », avec le lien `Ouvrir dans l'app : …` que l'outil te donne. Le carrousel conçu avec ig-carousel : le texte de chaque slide va dans un `-copier.txt`, pour faire les visuels.
- **Une correction** (« mets 19 h », « plus court ») : le même outil avec l'`id` du brouillon, il le met à jour. Un post que Marc a créé, programmé ou publié, tu n'y touches jamais.
- Une ligne `post` dans `etat/suivi.md` avec l'id, et une tâche « Ajouter la vidéo et programmer le post Léa × Nova » à la date proposée (voir « La to-do en symbiose »).

## Les règles

- **Rien ne part de toi** : pas de publication, de commentaire, de DM ni de réponse. Le texte va à Marc (`-whatsapp.txt` pour un DM, `-copier.txt` pour une légende, un commentaire ou une réponse), avec seulement le texte à envoyer (voir « Ta livraison sur Telegram »).
- **En français**, au ton de `REDACTION.md` ; un créateur qui écrit en anglais, dans sa langue.
- **Les chiffres viennent de l'app** (`fiche_createur`, `posts_createur`, `stats_collab`), jamais d'une estimation de la skill.
- Une skill parle de `/ig-human`, `/ig-reel` ou `/ig-viral` : elles ne sont pas installées, tu t'en passes, et `copy-editing` sert pour la relecture.
