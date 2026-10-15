-- Canaux simulés (lot 3c, SPEC-3c §6.8) : fichiers audio et références de fichiers.
--
-- 1. `fichiers_type_mime_check` s'étend aux quatre types audio acceptés par la liste blanche du
--    contenu (stockage/detection.ts) : audio/ogg, audio/mpeg, audio/mp4, audio/wav.
-- 2. `fichier_orphelin` est redéfinie en reprenant INTÉGRALEMENT la dernière définition (0384 :
--    documents de mission, justificatifs de débours, rapports, versions de preuve, faits et
--    facteurs du dossier client, dépôts de la salle de mission, pièces d'appel d'offres non
--    retirées, suppressions) puis en citant `transcriptions.fichier_id` et
--    `signatures_demandes.fichier_id` : un audio rattaché à une transcription, un PDF d'une demande
--    de signature ne sont pas orphelins (la purge à 24 h les effacerait sinon).
--
-- Numéro 0548 : la fonction LANGUAGE sql est vérifiée à la création, `transcriptions` (0545) et
-- `signatures_demandes` (0546) doivent exister. Toute migration ultérieure qui redéfinit
-- `fichier_orphelin` reprend TOUTES ces références, y compris celles-ci (le test d'inventaire
-- `fichiers-orphelins-references.test.ts` échoue sinon).

ALTER TABLE fichiers DROP CONSTRAINT fichiers_type_mime_check;
ALTER TABLE fichiers ADD CONSTRAINT fichiers_type_mime_check CHECK (type_mime IN (
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv', 'text/plain',
  'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav'));

CREATE OR REPLACE FUNCTION fichier_orphelin(p_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = public, pg_temp
  AS $$
    SELECT NOT EXISTS (SELECT 1 FROM mission_documents d WHERE d.fichier_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM debours b WHERE b.justificatif_fichier_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM rapports_mission r WHERE r.fichier_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM preuve_versions v WHERE v.fichier_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM dossier_faits f WHERE f.source_document_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM dossier_facteurs g WHERE g.source_document_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM salle_depots x WHERE x.fichier_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM ao_attestations a
                       WHERE a.fichier_id = p_id AND a.retiree_le IS NULL)
       AND NOT EXISTS (SELECT 1 FROM transcriptions t WHERE t.fichier_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM signatures_demandes s WHERE s.fichier_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = p_id) $$;
