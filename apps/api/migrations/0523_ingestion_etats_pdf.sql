-- Ingestion de documents (lot 6, ADR-009), DOS-03 : un état financier peut venir d'un PDF (texte extrait, chaque
-- ligne citant sa page). `origine` accepte 'pdf' en plus de 'saisie', 'csv' et 'excel' ; le reste de 0222 (ajout
-- seul, contrôles du moteur, acceptation automatique doublée en base par MPO04) est conservé tel quel.
-- Une liasse SYSCOHADA en Excel garde l'origine 'excel' (références de cellule), une liasse en PDF l'origine 'pdf'.

ALTER TABLE dossier_etats_financiers DROP CONSTRAINT dossier_etats_financiers_origine_check;
ALTER TABLE dossier_etats_financiers
  ADD CONSTRAINT dossier_etats_financiers_origine_check CHECK (origine IN ('saisie', 'csv', 'excel', 'pdf'));
