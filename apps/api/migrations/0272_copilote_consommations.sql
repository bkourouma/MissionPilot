-- Copilote conversationnel (AGT-08) : appels du modèle de langage qui ROUTENT un message.
--
-- Le copilote n'envoie au modèle que le message masqué de l'utilisateur et le catalogue des
-- outils : il n'y a ni demande de génération (`ia_demandes`) ni évaluation de non-régression. Ses
-- appels s'inscrivent pourtant dans `ia_consommations` (ajout seul) et comptent dans le plafond
-- mensuel du cabinet comme tout appel facturé (`ia/couts.ts`, `consommeDuMois` somme toutes les
-- lignes). La colonne `copilote` désigne cette origine ; la contrainte d'origine de `0270`
-- (exactement UNE origine pour un appel autre que « test ») admet désormais trois origines : une
-- demande de génération, une évaluation, ou un échange du copilote. Un appel « test » n'a aucune
-- origine.

ALTER TABLE ia_consommations ADD COLUMN copilote boolean NOT NULL DEFAULT false;
ALTER TABLE ia_consommations DROP CONSTRAINT ia_consommations_origine_check;
ALTER TABLE ia_consommations ADD CONSTRAINT ia_consommations_origine_check
  CHECK (CASE WHEN issue = 'test'
              THEN demande_id IS NULL AND evaluation_demande_id IS NULL AND NOT copilote
              ELSE num_nonnulls(demande_id, evaluation_demande_id) + (CASE WHEN copilote THEN 1 ELSE 0 END) = 1
         END);
