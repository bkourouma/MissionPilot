-- Ingestion de documents (lot 11, ADR-009, décision OCR local) : méthode de lecture `ocr` (OCR local réel) et
-- corrections proposées pour un texte lu par OCR.
--
-- 1. La méthode `ocr_simule` (adaptateur de test, lot 6) reste valide ; `ocr` désigne la reconnaissance de
--    caractères réelle, exécutée localement sur le serveur (aucun service externe). Comme pour `ocr_simule`, une
--    page lue par OCR porte une confiance (0 à 1000), une page d'une autre méthode n'en porte jamais.
-- 2. `corrections_ocr` : propositions de correction d'un montant que la tolérance aux confusions classiques de
--    l'OCR (O/0, l/1, virgule/point) a retrouvé sur la page citée. Une proposition n'est JAMAIS appliquée
--    automatiquement : la ligne reste rejetée, l'état part en revue et la proposition est montrée au relecteur.
--    Tableau JSON borné (100 entrées, 40 000 octets), sans clé étrangère, purgé avec le texte des pages
--    (décision + 90 jours, voir 0526).
--
-- Une migration commitée ne se modifie jamais : les contraintes de 0521 sont retrouvées par leur définition puis
-- remplacées (les noms sont ceux de PostgreSQL, non déclarés en 0521). Aucun nouveau SQLSTATE ; aucune politique
-- ni droit à ajouter (colonne d'une table qui a déjà RLS et `portail_interdit`).

DO $$
DECLARE
  v_nom text;
BEGIN
  FOR v_nom IN
    SELECT c.conname FROM pg_constraint c
    WHERE c.conrelid = 'ingestion_documents'::regclass AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%ocr_simule%'
  LOOP
    EXECUTE format('ALTER TABLE ingestion_documents DROP CONSTRAINT %I', v_nom);
  END LOOP;
  FOR v_nom IN
    SELECT c.conname FROM pg_constraint c
    WHERE c.conrelid = 'ingestion_pages'::regclass AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%ocr_simule%'
  LOOP
    EXECUTE format('ALTER TABLE ingestion_pages DROP CONSTRAINT %I', v_nom);
  END LOOP;
END $$;

ALTER TABLE ingestion_documents
  ADD CONSTRAINT ingestion_documents_methode_check
  CHECK (methode IS NULL OR methode IN ('texte', 'ocr_simule', 'ocr', 'tableur'));

ALTER TABLE ingestion_pages
  ADD CONSTRAINT ingestion_pages_methode_check
  CHECK (methode IN ('texte', 'ocr_simule', 'ocr', 'tableur')),
  ADD CONSTRAINT ingestion_pages_confiance_methode_check
  CHECK ((methode IN ('ocr_simule', 'ocr')) = (confiance_pm IS NOT NULL));

ALTER TABLE ingestion_documents
  ADD COLUMN corrections_ocr jsonb
  CHECK (corrections_ocr IS NULL OR (
    jsonb_typeof(corrections_ocr) = 'array'
    AND jsonb_array_length(corrections_ocr) <= 100
    AND octet_length(corrections_ocr::text) <= 40000));
