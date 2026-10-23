-- Ingestion de documents (lot 11, ADR-009) : les corrections OCR suivent la rétention du texte des pages.
--
-- `ingestion_documents.corrections_ocr` (0525) recopie des extraits du texte lu par OCR (libellé, texte lu, montant
-- proposé). Décision du superviseur : elle est purgée avec le texte des pages, à la même échéance (décision de
-- l'extraction ou de l'état, ou fin du traitement, + 90 jours ; voir 0524). L'état financier et ses lignes restent.
--
-- 1. `purger_textes_ingestion` : définition de 0524 reprise à l'identique (mêmes paramètres, bornes, vérifications et
--    conditions de sélection), la mise à NULL de `corrections_ocr` s'ajoutant à la datation de `texte_purge_le`.
--    Droits inchangés (CREATE OR REPLACE les conserve ; rappelés par prudence).
-- 2. `controler_ingestion_document` : définition de 0521 reprise à l'identique ; sur un document terminal, la
--    datation de la purge accepte désormais que `corrections_ocr` passe à NULL dans le même UPDATE (toute autre
--    colonne restant inchangée). Sans cela le déclencheur refuserait la purge (MQG01).
--
-- Aucun nouveau SQLSTATE.

CREATE OR REPLACE FUNCTION purger_textes_ingestion(p_maintenant timestamptz, p_jours int, p_limite int DEFAULT 1000)
  RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_cabinet uuid := app_cabinet_id();
    v_test text := nullif(current_setting('app.horloge_test', true), '');
    v_reference timestamptz := clock_timestamp();
    v_ids uuid[];
    v_n int;
  BEGIN
    IF v_cabinet IS NULL OR p_maintenant IS NULL OR p_jours IS NULL OR p_limite IS NULL
       OR p_jours NOT BETWEEN 90 AND 3650 OR p_limite NOT BETWEEN 1 AND 10000 THEN
      RAISE EXCEPTION 'Paramètres de la purge des textes d''ingestion invalides.';
    END IF;
    IF v_test IS NOT NULL AND current_database() LIKE '%\_test' THEN
      v_reference := v_test::timestamptz;
    END IF;
    IF p_maintenant > v_reference + interval '1 minute' THEN
      RAISE EXCEPTION 'Date de la purge des textes d''ingestion dans le futur.';
    END IF;
    SELECT coalesce(array_agg(x.id), ARRAY[]::uuid[]) INTO v_ids FROM (
      SELECT d.id
      FROM ingestion_documents d
      WHERE d.cabinet_id = v_cabinet
        AND d.statut IN ('termine', 'echec')
        AND d.texte_purge_le IS NULL
        AND NOT EXISTS (SELECT 1 FROM ingestion_extractions x
                        WHERE x.document_id = d.id AND x.cabinet_id = v_cabinet
                          AND x.statut IN ('brouillon_ia', 'modifie'))
        AND (
          -- Extraction(s) : la plus récente décision.
          CASE
            WHEN EXISTS (SELECT 1 FROM ingestion_extractions x
                         WHERE x.document_id = d.id AND x.cabinet_id = v_cabinet) THEN
              (SELECT max(x.valide_le) FROM ingestion_extractions x
               WHERE x.document_id = d.id AND x.cabinet_id = v_cabinet)
            WHEN d.etat_financier_id IS NOT NULL THEN
              coalesce(
                (SELECT e.cree_le FROM dossier_etats_decisions e
                 WHERE e.etat_id = d.etat_financier_id AND e.cabinet_id = v_cabinet),
                CASE WHEN EXISTS (SELECT 1 FROM dossier_etats_financiers r
                                  WHERE r.remplace_id = d.etat_financier_id AND r.cabinet_id = v_cabinet)
                     THEN d.termine_le END)
            ELSE d.termine_le
          END
        ) < p_maintenant - make_interval(days => p_jours)
        AND d.termine_le < p_maintenant - make_interval(days => p_jours)
      ORDER BY d.termine_le, d.id
      LIMIT p_limite) x;
    DELETE FROM ingestion_pages p WHERE p.cabinet_id = v_cabinet AND p.document_id = ANY (v_ids);
    UPDATE ingestion_documents d SET texte_purge_le = p_maintenant, corrections_ocr = NULL
      WHERE d.cabinet_id = v_cabinet AND d.id = ANY (v_ids) AND d.texte_purge_le IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END $$;

REVOKE ALL ON FUNCTION purger_textes_ingestion(timestamptz, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purger_textes_ingestion(timestamptz, int, int) TO missionpilot_app;

CREATE OR REPLACE FUNCTION controler_ingestion_document() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_version record;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Un document ingéré ne se supprime pas.' USING ERRCODE = 'MQG01';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.statut <> 'en_file' OR NEW.resultat IS NOT NULL OR NEW.etat_financier_id IS NOT NULL THEN
        RAISE EXCEPTION 'Un document ingéré naît « en_file », sans résultat.' USING ERRCODE = 'MQG01';
      END IF;
      IF NEW.version_methode_id IS NOT NULL THEN
        SELECT v.cabinet_id, v.statut INTO v_version FROM methode_versions v WHERE v.id = NEW.version_methode_id;
        IF v_version.cabinet_id IS DISTINCT FROM NEW.cabinet_id OR v_version.statut <> 'brouillon' THEN
          RAISE EXCEPTION 'La version cible est un brouillon du cabinet.' USING ERRCODE = 'MQG03';
        END IF;
      END IF;
      RETURN NEW;
    END IF;
    IF (NEW.cabinet_id, NEW.usage, NEW.client_id, NEW.dd_dossier_id, NEW.version_methode_id, NEW.nom,
        NEW.format, NEW.sha256, NEW.taille, NEW.parametres, NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM
       (OLD.cabinet_id, OLD.usage, OLD.client_id, OLD.dd_dossier_id, OLD.version_methode_id, OLD.nom,
        OLD.format, OLD.sha256, OLD.taille, OLD.parametres, OLD.cree_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'Document ingéré : identité non modifiable.' USING ERRCODE = 'MQG01';
    END IF;
    IF OLD.statut IN ('termine', 'echec') THEN
      -- Terminal : seuls passent la relance d'une structuration (termine -> structuration, voir ci-dessous) et la
      -- datation, une fois, de la purge du texte des pages (fonction purger_textes_ingestion, 0524), avec l'effacement
      -- des corrections OCR (0526).
      IF NOT (
           (OLD.statut = 'termine' AND NEW.statut = 'structuration' AND OLD.usage <> 'etat_financier'
            AND OLD.texte_purge_le IS NULL)
        OR (NEW.statut = OLD.statut AND OLD.texte_purge_le IS NULL AND NEW.texte_purge_le IS NOT NULL
            AND NEW.corrections_ocr IS NULL
            AND (to_jsonb(NEW) - 'texte_purge_le' - 'corrections_ocr')
              = (to_jsonb(OLD) - 'texte_purge_le' - 'corrections_ocr'))) THEN
        RAISE EXCEPTION 'Document ingéré terminé : non modifiable.' USING ERRCODE = 'MQG01';
      END IF;
    END IF;
    IF NEW.statut <> OLD.statut AND NOT (
         (OLD.statut = 'en_file' AND NEW.statut IN ('extraction', 'echec'))
      OR (OLD.statut = 'extraction' AND NEW.statut IN ('en_file', 'structuration', 'echec'))
      OR (OLD.statut = 'structuration' AND NEW.statut IN ('termine', 'echec'))
      OR (OLD.statut = 'termine' AND NEW.statut = 'structuration')) THEN
      RAISE EXCEPTION 'Document ingéré : transition % vers % refusée.', OLD.statut, NEW.statut
        USING ERRCODE = 'MQG01';
    END IF;
    RETURN NEW;
  END $$;
