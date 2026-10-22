-- Ingestion de documents (lot 6, ADR-009) : conservation du texte extrait des pages.
--
-- Décision de l'utilisateur du 2026-10-22 : le texte extrait des pages est conservé jusqu'à la validation de
-- l'extraction + 90 jours, puis purgé ; l'état financier validé et le brouillon validé restent. Les références de
-- page restent valables (numéro, extrait déjà recopié dans le brouillon), seul le texte de la page disparaît.
--
-- Un document est PURGEABLE quand il est terminal (`termine` ou `echec`), que son texte n'a pas déjà été purgé ET que
-- p_jours jours (90 à 3650) se sont écoulés depuis :
--   - la décision de sa dernière extraction (`valide_le`, validée OU rejetée), s'il en a une ; un brouillon encore
--     ouvert (`brouillon_ia`, `modifie`) l'exclut, quelle que soit son ancienneté ;
--   - sinon, pour un état financier, la décision de l'état (`dossier_etats_decisions.cree_le`) ; un état encore
--     « en revue » (sans décision, non remplacé) n'est jamais purgé ; un état remplacé sans décision compte depuis la
--     fin du traitement ;
--   - sinon (échec, `ia_indisponible`, `rien_trouve`), la fin du traitement (`termine_le`).
-- La purge SUPPRIME les lignes `ingestion_pages` du document et date `texte_purge_le` (une seule fois, le
-- déclencheur de 0521 n'accepte que cette datation sur un document terminal). Elle ne touche ni l'état financier, ni
-- les brouillons, ni le document. `ingestion_pages` est en ajout seul pour le rôle applicatif : seule cette fonction
-- supprime.
--
-- Aucun nouveau SQLSTATE.

-- Au plus p_limite documents par appel, dans le cabinet du contexte ; renvoie le nombre de documents purgés.
-- p_maintenant ne dépasse pas l'horloge de la base de plus d'une minute (une date future avancerait l'échéance de
-- tous les documents du cabinet) ; réglage `app.horloge_test` honoré dans une base « _test » seulement (même
-- mécanisme que `anonymiser_transcriptions`, 0545).
CREATE FUNCTION purger_textes_ingestion(p_maintenant timestamptz, p_jours int, p_limite int DEFAULT 1000)
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
    UPDATE ingestion_documents d SET texte_purge_le = p_maintenant
      WHERE d.cabinet_id = v_cabinet AND d.id = ANY (v_ids) AND d.texte_purge_le IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END $$;

REVOKE ALL ON FUNCTION purger_textes_ingestion(timestamptz, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purger_textes_ingestion(timestamptz, int, int) TO missionpilot_app;

-- Planification quotidienne : une tâche par cabinet et par jour (clé `ingestion_maintenance:AAAA-MM-JJ`), pour les
-- cabinets qui ont un document terminal au texte non purgé ou un objet marqué « retire » dont l'effacement peut encore
-- être à reprendre (marqué depuis moins de 30 jours : `fichiers_suppressions` est en ajout seul et ne dit pas si
-- l'objet a été effacé, la condition ne peut donc pas être « il existe une ligne », vraie à jamais ; passé 30 jours
-- sans succès, la reprise n'est plus planifiée seule, elle reste tentée à chaque exécution du job). Un document terminal
-- dont `fichier_id` est resté renseigné SANS marquage récent ne planifie rien. Mêmes garde-fous que `planifier_canaux_maintenance` (0544).
CREATE FUNCTION planifier_ingestion_maintenance(p_cle text, p_execute_a timestamptz, p_jour date)
  RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_n int;
  BEGIN
    IF p_cle IS NULL OR p_execute_a IS NULL OR p_jour IS NULL THEN
      RAISE EXCEPTION 'Planification de la maintenance de l''ingestion : paramètres obligatoires.';
    END IF;
    IF p_cle !~ '^ingestion_maintenance:[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR right(p_cle, 10) <> p_jour::text THEN
      RAISE EXCEPTION 'Clé de la maintenance de l''ingestion invalide.';
    END IF;
    IF p_execute_a < (p_jour::timestamp AT TIME ZONE 'UTC') - interval '1 day'
       OR p_execute_a > (p_jour::timestamp AT TIME ZONE 'UTC') + interval '2 days' THEN
      RAISE EXCEPTION 'Heure d''exécution de la maintenance de l''ingestion hors de la journée visée.';
    END IF;
    INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle, tentatives_max)
      SELECT c.id, 'ingestion_maintenance', jsonb_build_object('jour', p_jour), p_execute_a, p_cle, 3
      FROM cabinets c
      WHERE EXISTS (SELECT 1 FROM ingestion_documents d
                    WHERE d.cabinet_id = c.id
                      AND d.statut IN ('termine', 'echec') AND d.texte_purge_le IS NULL)
         OR EXISTS (SELECT 1 FROM fichiers_suppressions s
                    WHERE s.cabinet_id = c.id AND s.motif = 'retire'
                      AND s.supprime_le > p_execute_a - interval '30 days')
      ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END $$;

REVOKE ALL ON FUNCTION planifier_ingestion_maintenance(text, timestamptz, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION planifier_ingestion_maintenance(text, timestamptz, date) TO missionpilot_app;
