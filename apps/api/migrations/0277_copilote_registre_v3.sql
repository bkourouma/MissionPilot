-- Copilote (AGT-08) : version 3 de l'agent « copilote » dans le registre standard.
--
-- La fiche /agents décrivait le copilote de la version 2 (lecture, création de tâche) ; depuis, le
-- copilote propose aussi d'AJOUTER UN COMMENTAIRE sur une mission et d'ENREGISTRER LA RELANCE d'une
-- facture échue (sans e-mail au client), et répond à deux lectures de plus (mes missions en
-- retard, retards sur les feuilles de temps de l'équipe). Chaque action suit le même modèle de
-- sécurité : proposition résolue par le code, confirmation à usage unique par le même utilisateur
-- (5 minutes), droits revérifiés, exécution par le service existant, jamais d'exécution directe ;
-- elles exigent un niveau effectif N2 au moins (la lecture reste permise dès N1).
--
-- Le registre standard est en ajout seul (MPG01) : l'évolution est la version 3, avec ses notes de
-- version, jamais une modification des versions 1 et 2 (même modèle que 0273).
--
-- - outils_autorises : liste FERMÉE du registre (OUTILS_AGENT, CHECK de 0260) ; les outils du
--   copilote (creer_tache, ajouter_commentaire, planifier_relance) n'y figurent pas, ils sont
--   décrits dans la mission, `ne_fait_jamais` et les notes. Ajout de « proposer_relance »
--   (proposition d'une relance, confirmée par l'utilisateur) à la liste de la version 2.
-- - droits : « copilote.utiliser », la permission que chaque route du copilote exige ; chaque
--   outil applique en plus le droit le plus étroit de l'écran correspondant (copilote/catalogue.ts).

INSERT INTO agents_registre (code, version, nom, mission, ne_fait_jamais, entrees, outils_autorises,
  droits, briques, taches, niveau_max, schema_sortie, lit_contenu_client, notes_version)
SELECT code, 3, nom,
  'Interface conversationnelle unique : répond aux questions de lecture dans les droits de l''utilisateur et propose trois actions (créer une tâche, ajouter un commentaire sur une mission, enregistrer la relance d''une facture échue) que l''utilisateur confirme une à une ; jamais d''exécution directe.',
  'Agir hors des droits de l''utilisateur ; exécuter une action sans sa confirmation explicite (à usage unique, 5 minutes) ; produire un chiffre (ils viennent des moteurs de calcul) ; écrire au client ou lui envoyer un e-mail ; mentionner ou notifier une personne à la place de l''utilisateur.',
  entrees,
  ARRAY['lire_mission', 'lire_planning', 'lire_kpi', 'proposer_brouillon', 'proposer_relance'],
  ARRAY['copilote.utiliser'], briques, taches, 'N2', schema_sortie, lit_contenu_client,
  'Fiche mise à jour : lectures « mes missions en retard » et « retards sur les feuilles de temps de l''équipe » ; actions confirmées creer_tache, ajouter_commentaire (mission visible, sans mention) et planifier_relance (relance manuelle d''une facture échue, sans e-mail au client, sans montant). Confirmation obligatoire à usage unique, niveau N2 requis pour toute action, jamais d''exécution directe.'
FROM agents_registre
WHERE code = 'copilote' AND version = 2
ON CONFLICT (code, version) DO NOTHING;
