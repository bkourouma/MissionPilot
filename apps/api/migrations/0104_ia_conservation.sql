-- Conservation des générations IA (HANDOFF n° 3 ; SECURITY.md).
--
-- `ia_generations.texte` est le texte DÉMASQUÉ (les termes sensibles y sont
-- remis) : il ne doit pas être gardé sans durée.
--
-- - ia_parametres_cabinet.conservation_jours : durée de conservation du texte
--   d'une génération par cabinet, 365 jours par défaut (30 à 3 650). Un cabinet
--   sans ligne de paramètres a la durée par défaut.
-- - ia_generations.texte_purge_le : instant où le texte a été anonymisé.
--   L'anonymisation vide `texte` (chaîne vide), met `donnees` à NULL et
--   `nombres_non_verifies` à []. TOUT le reste de la ligne (version, statut,
--   auteur, empreintes, sources, coût, drapeaux de chiffres) est conservé :
--   la trace d'audit de la décision humaine survit au texte.
-- - Une demande est purgeable quand sa DERNIÈRE version a plus de
--   `conservation_jours` jours (une génération encore éditée n'est jamais
--   vidée sous les pieds de l'utilisateur). Toutes ses versions, y compris la
--   version validée, sont alors anonymisées : le contenu livré au client vit
--   dans ses propres livrables, pas dans cette trace.
-- - Le déclencheur « ajout seul » reste la règle : il n'autorise QUE cette
--   anonymisation (même ligne, texte vidé, purge datée une seule fois). Le
--   rôle applicatif n'a toujours aucun droit UPDATE/DELETE ; la purge passe
--   par la fonction SECURITY DEFINER `purger_textes_ia`, restreinte au cabinet
--   du contexte, appelée par le job « ia_conservation ».
-- - Planification : un job par cabinet et par jour (clé `ia_conservation:AAAA-MM-JJ`),
--   seulement pour les cabinets ayant au moins une demande purgeable.

ALTER TABLE ia_parametres_cabinet
  ADD COLUMN conservation_jours int NOT NULL DEFAULT 365
    CHECK (conservation_jours BETWEEN 30 AND 3650);

ALTER TABLE ia_generations ADD COLUMN texte_purge_le timestamptz;
CREATE INDEX ia_generations_purge_idx ON ia_generations (cabinet_id, demande_id)
  WHERE texte_purge_le IS NULL;

DROP TRIGGER ia_generations_ajout_seul ON ia_generations;
CREATE FUNCTION ia_generations_ajout_seul() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'UPDATE'
       AND OLD.texte_purge_le IS NULL
       AND NEW.texte_purge_le IS NOT NULL
       AND NEW.texte = ''
       AND NEW.donnees IS NULL
       AND NEW.nombres_non_verifies = '[]'::jsonb
       AND (to_jsonb(NEW) - 'texte' - 'donnees' - 'nombres_non_verifies' - 'texte_purge_le')
           = (to_jsonb(OLD) - 'texte' - 'donnees' - 'nombres_non_verifies' - 'texte_purge_le') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Historique IA en ajout seul : créer une nouvelle version.'
      USING ERRCODE = 'MPI01';
  END $$;
CREATE TRIGGER ia_generations_ajout_seul BEFORE UPDATE OR DELETE ON ia_generations
  FOR EACH ROW EXECUTE FUNCTION ia_generations_ajout_seul();

-- Demandes du cabinet dont le texte est à anonymiser à l'instant donné.
CREATE FUNCTION ia_demandes_purgeables(p_cabinet uuid, p_maintenant timestamptz)
  RETURNS TABLE (demande_id uuid)
  LANGUAGE sql STABLE SET search_path = public, pg_temp
  AS $$
    SELECT g.demande_id
    FROM ia_generations g
    WHERE g.cabinet_id = p_cabinet AND g.texte_purge_le IS NULL
    GROUP BY g.demande_id
    HAVING max(g.cree_le) < p_maintenant - make_interval(days => coalesce(
      (SELECT p.conservation_jours FROM ia_parametres_cabinet p WHERE p.cabinet_id = p_cabinet),
      365)) $$;

-- Anonymise le texte des demandes échues du cabinet du contexte (au plus
-- p_limite versions par appel) ; renvoie le nombre de versions anonymisées.
-- p_maintenant ne dépasse pas l'horloge de la base de plus d'une minute (voir plus bas).
CREATE FUNCTION purger_textes_ia(p_maintenant timestamptz, p_limite int DEFAULT 1000)
  RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_cabinet uuid := app_cabinet_id();
    v_test text := nullif(current_setting('app.horloge_test', true), '');
    v_reference timestamptz := clock_timestamp();
    v_n int;
  BEGIN
    IF v_cabinet IS NULL OR p_maintenant IS NULL OR p_limite IS NULL
       OR p_limite NOT BETWEEN 1 AND 10000 THEN
      RAISE EXCEPTION 'Paramètres de la purge IA invalides.';
    END IF;
    -- L'instant vient de l'appelant (horloge du worker) : une date future avancerait
    -- l'échéance de TOUS les textes du cabinet. Marge d'une minute pour le décalage
    -- d'horloge ; réglage `app.horloge_test` (même mécanisme que 0120) honoré dans une
    -- base « _test » seulement, où il remplace l'horloge de référence.
    IF v_test IS NOT NULL AND current_database() LIKE '%\_test' THEN
      v_reference := v_test::timestamptz;
    END IF;
    IF p_maintenant > v_reference + interval '1 minute' THEN
      RAISE EXCEPTION 'Date de la purge IA dans le futur.';
    END IF;
    UPDATE ia_generations g
      SET texte = '', donnees = NULL, nombres_non_verifies = '[]'::jsonb,
          texte_purge_le = p_maintenant
      WHERE g.id IN (
        SELECT x.id FROM ia_generations x
        WHERE x.cabinet_id = v_cabinet AND x.texte_purge_le IS NULL
          AND x.demande_id IN (SELECT demande_id FROM ia_demandes_purgeables(v_cabinet, p_maintenant))
        ORDER BY x.cree_le, x.id LIMIT p_limite);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END $$;

CREATE FUNCTION planifier_conservation_ia(p_cle text, p_execute_a timestamptz) RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_n int;
  BEGIN
    IF p_cle !~ '^ia_conservation:[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'Clé de conservation IA invalide.';
    END IF;
    INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle)
      SELECT c.id, 'ia_conservation', '{}'::jsonb, p_execute_a, p_cle
      FROM cabinets c
      WHERE EXISTS (SELECT 1 FROM ia_demandes_purgeables(c.id, p_execute_a))
      ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END $$;

REVOKE ALL ON FUNCTION ia_demandes_purgeables(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION purger_textes_ia(timestamptz, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION planifier_conservation_ia(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purger_textes_ia(timestamptz, int) TO missionpilot_app;
GRANT EXECUTE ON FUNCTION planifier_conservation_ia(text, timestamptz) TO missionpilot_app;
