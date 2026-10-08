-- Une pièce justificative d'une référence d'appel d'offres (ao_attestations, 0381) non retirée
-- cite son fichier : il n'est pas orphelin. Reprend `fichier_orphelin` de 0331 (salle de mission,
-- qui reprenait 0268 et ajoutait `salle_depots.fichier_id`), avec les mêmes options (LANGUAGE
-- sql STABLE, search_path figé ; CREATE OR REPLACE conserve propriété et droits), en ajoutant
-- cette référence. Une pièce RETIRÉE ne retient plus son fichier : la purge à 24 h
-- (stockage/purge.ts) l'efface, la ligne de la pièce et ses métadonnées restent.
--
-- Numéro 0384 : la fonction LANGUAGE sql est vérifiée à la création, ao_attestations (0381) et
-- salle_depots (0330) doivent exister. Toute migration ultérieure qui redéfinit
-- `fichier_orphelin` reprend TOUTES ces références, y compris celle-ci.

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
       AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = p_id) $$;
