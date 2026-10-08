-- Fichiers orphelins et quota de stockage (SOC-05).
--
-- Un fichier est ORPHELIN s'il n'est rattaché à aucune version de document
-- ni à aucun débours, et pas déjà marqué supprimé. Les orphelins de plus de
-- 24 h sont purgés par le job « purge_fichiers_orphelins » (marquage puis
-- effacement de l'objet de stockage), planifié au plus une fois par heure et
-- par cabinet (clé `purge_fichiers:AAAA-MM-JJTHH`), pour les seuls cabinets
-- qui en ont.

CREATE FUNCTION fichier_orphelin(p_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = public, pg_temp
  AS $$
    SELECT NOT EXISTS (SELECT 1 FROM mission_documents d WHERE d.fichier_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM debours b WHERE b.justificatif_fichier_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = p_id) $$;

-- Octets occupés par le cabinet courant (fichiers non supprimés). Fonction
-- d'invocateur : RLS s'applique, seul le cabinet du contexte est compté.
CREATE FUNCTION octets_stockage_utilises() RETURNS bigint
  LANGUAGE sql STABLE SET search_path = public, pg_temp
  AS $$
    SELECT coalesce(sum(f.taille), 0)::bigint FROM fichiers f
    WHERE f.cabinet_id = app_cabinet_id()
      AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = f.id) $$;

CREATE FUNCTION planifier_purge_fichiers(p_cle text, p_execute_a timestamptz, p_seuil timestamptz)
  RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_n int;
  BEGIN
    IF p_cle !~ '^purge_fichiers:[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}$' THEN
      RAISE EXCEPTION 'Clé de purge invalide.';
    END IF;
    INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle)
      SELECT c.id, 'purge_fichiers_orphelins', '{}'::jsonb, p_execute_a, p_cle
      FROM cabinets c
      WHERE EXISTS (SELECT 1 FROM fichiers f WHERE f.cabinet_id = c.id AND f.cree_le < p_seuil
                    AND fichier_orphelin(f.id))
      ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END $$;
REVOKE ALL ON FUNCTION planifier_purge_fichiers(text, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION planifier_purge_fichiers(text, timestamptz, timestamptz) TO missionpilot_app;
