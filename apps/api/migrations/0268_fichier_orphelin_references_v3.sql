-- Un fichier cité par une preuve, un fait ou un facteur du dossier client n'est
-- pas orphelin. Reprend `fichier_orphelin` de 0130 (mêmes options : LANGUAGE sql
-- STABLE, search_path figé ; CREATE OR REPLACE conserve propriété et droits) en
-- ajoutant les références posées après elle :
--   - preuve_versions.fichier_id        (0240, registre des preuves) ;
--   - dossier_faits.source_document_id  (0220, faits du dossier) ;
--   - dossier_facteurs.source_document_id (0221, facteurs de contexte).
-- Sans cela, la purge à 24 h (stockage/purge.ts) effaçait un fichier cité
-- seulement par l'une de ces lignes, en ajout seul donc non modifiables.
--
-- Numéro 0268 (et non une plage plus basse) : une fonction LANGUAGE sql est
-- vérifiée à la création, les tables citées doivent donc déjà exister.
-- Les autres colonnes REFERENCES fichiers (0070 fichiers_suppressions, 0071
-- mission_documents, 0072 debours, 0130 rapports_mission) sont déjà couvertes.

CREATE OR REPLACE FUNCTION fichier_orphelin(p_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = public, pg_temp
  AS $$
    SELECT NOT EXISTS (SELECT 1 FROM mission_documents d WHERE d.fichier_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM debours b WHERE b.justificatif_fichier_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM rapports_mission r WHERE r.fichier_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM preuve_versions v WHERE v.fichier_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM dossier_faits f WHERE f.source_document_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM dossier_facteurs g WHERE g.source_document_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = p_id) $$;
