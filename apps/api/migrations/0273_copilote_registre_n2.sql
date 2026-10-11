-- Copilote (AGT-08) : le standard relève le niveau maximal de l'agent « copilote » de N1 à N2.
--
-- Le semis de 0260 plafonnait le copilote à N1 (suggestion à la demande). Depuis l'audit de
-- sécurité du copilote, PROPOSER puis CONFIRMER une action modifiante (créer une tâche) exige un
-- niveau effectif d'au moins N2 (« brouillon, validation humaine obligatoire avant tout usage » :
-- la proposition est le brouillon, la confirmation de l'utilisateur la validation) ; la LECTURE
-- reste permise dès N1. Un cabinet qui plafonne l'agent à N1 (agents_restrictions) interdit donc
-- toute écriture du copilote ; N0 ou la désactivation l'arrêtent entièrement.
--
-- Le registre standard est en ajout seul (MPG01) : l'évolution est la version 2 de l'agent, avec
-- ses notes de version, jamais une modification de la version 1. Niveau PROPOSÉ, à valider au
-- pilote (comme les autres niveaux du semis).

INSERT INTO agents_registre (code, version, nom, mission, ne_fait_jamais, entrees, outils_autorises,
  droits, briques, taches, niveau_max, schema_sortie, lit_contenu_client, notes_version)
SELECT code, 2, nom, mission, ne_fait_jamais, entrees, outils_autorises,
  droits, briques, taches, 'N2', schema_sortie, lit_contenu_client,
  'Niveau maximal relevé de N1 à N2 : proposer et confirmer une action modifiante (tâche) exige N2 ; la lecture reste permise dès N1.'
FROM agents_registre
WHERE code = 'copilote' AND version = 1
ON CONFLICT (code, version) DO NOTHING;
