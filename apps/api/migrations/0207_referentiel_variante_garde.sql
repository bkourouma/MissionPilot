-- Référentiel de méthodes (lot STD) — correctifs d'audit de sécurité, publication
-- d'une VARIANTE du cabinet (STD-02, STD-11).
--
-- 1. Une variante ne peut ni ABAISSER la classe de risque ni RELEVER le niveau
--    d'autonomie maximal d'une brique du standard dont elle part
--    (`base_standard_id`) : sans cela, un cabinet affaiblirait en un clic les
--    gardes humaines du standard (PRD complémentaire §7.1). Contrôle fait à la
--    publication, doublé de l'anomalie `CLASSE_ABAISSEE` / `AUTONOMIE_RELEVEE`
--    de `apps/api/src/standard/coherence.ts` (SQLSTATE MPM07).
-- 2. Quatre yeux : la variante n'est pas publiée par le créateur de la version,
--    sauf associé (SQLSTATE MPM08).
-- La fonction est REMPLACÉE (CREATE OR REPLACE) : tout le reste de 0201 est
-- conservé tel quel.

CREATE OR REPLACE FUNCTION controler_methode_version() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    m methodes%ROWTYPE;
    v_max integer;
    v_base_methode uuid;
    v_base_statut text;
    v_associe boolean;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      IF OLD.statut = 'publiee' THEN
        RAISE EXCEPTION 'Version publiée immuable.' USING ERRCODE = 'MPM01';
      END IF;
      RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
      IF OLD.statut = 'publiee' THEN
        RAISE EXCEPTION 'Version publiée immuable : créer une nouvelle version.' USING ERRCODE = 'MPM01';
      END IF;
      IF (NEW.cabinet_id, NEW.methode_id, NEW.version, NEW.base_standard_id, NEW.cree_par)
         IS DISTINCT FROM (OLD.cabinet_id, OLD.methode_id, OLD.version, OLD.base_standard_id, OLD.cree_par) THEN
        RAISE EXCEPTION 'Identité d''une version figée.' USING ERRCODE = 'MPM02';
      END IF;
      IF NEW.statut = 'publiee' AND NEW.base_standard_id IS NOT NULL THEN
        -- Variante : quatre yeux sauf associé.
        SELECT coalesce('associe' = ANY (roles), false) INTO v_associe
          FROM utilisateurs WHERE id = NEW.publie_par AND cabinet_id = NEW.cabinet_id;
        IF NEW.publie_par IS NOT DISTINCT FROM OLD.cree_par AND NOT coalesce(v_associe, false) THEN
          RAISE EXCEPTION 'Une variante n''est pas publiée par le créateur de la version (sauf associé).'
            USING ERRCODE = 'MPM08';
        END IF;
        -- Variante : ni classe de risque abaissée, ni autonomie relevée.
        IF EXISTS (
          SELECT 1
            FROM methode_briques b
            JOIN methode_briques s ON s.version_id = NEW.base_standard_id AND s.code = b.code
           WHERE b.version_id = NEW.id
             AND (CASE b.classe_risque WHEN 'R0' THEN 0 WHEN 'R1' THEN 1 WHEN 'R2' THEN 2 ELSE 3 END
                  < CASE s.classe_risque WHEN 'R0' THEN 0 WHEN 'R1' THEN 1 WHEN 'R2' THEN 2 ELSE 3 END
                  OR (CASE b.niveau_autonomie_max WHEN 'N0' THEN 0 WHEN 'N1' THEN 1 WHEN 'N2' THEN 2
                        WHEN 'N3' THEN 3 ELSE 4 END
                      > CASE s.niveau_autonomie_max WHEN 'N0' THEN 0 WHEN 'N1' THEN 1 WHEN 'N2' THEN 2
                          WHEN 'N3' THEN 3 ELSE 4 END))
        ) THEN
          RAISE EXCEPTION 'Une variante n''abaisse pas la classe de risque ni ne relève l''autonomie d''une brique du standard.'
            USING ERRCODE = 'MPM07';
        END IF;
      END IF;
      RETURN NEW;
    END IF;
    SELECT * INTO m FROM methodes WHERE id = NEW.methode_id;
    IF NOT FOUND OR m.cabinet_id IS DISTINCT FROM NEW.cabinet_id THEN
      RAISE EXCEPTION 'Version d''une méthode d''un autre propriétaire.' USING ERRCODE = 'MPM02';
    END IF;
    IF NEW.statut <> 'brouillon' THEN
      RAISE EXCEPTION 'Une version se crée en brouillon.' USING ERRCODE = 'MPM02';
    END IF;
    SELECT max(version) INTO v_max FROM methode_versions WHERE methode_id = NEW.methode_id;
    IF NEW.version <> coalesce(v_max, 0) + 1 THEN
      RAISE EXCEPTION 'Numéro de version inattendu.' USING ERRCODE = 'MPM02';
    END IF;
    IF NEW.base_standard_id IS NOT NULL THEN
      SELECT methode_id, statut INTO v_base_methode, v_base_statut
        FROM methode_versions WHERE id = NEW.base_standard_id;
      IF m.parent_id IS NULL OR v_base_methode IS DISTINCT FROM m.parent_id
         OR v_base_statut IS DISTINCT FROM 'publiee' THEN
        RAISE EXCEPTION 'Base : version publiée de la méthode du standard parente.' USING ERRCODE = 'MPM02';
      END IF;
    ELSIF m.parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'Une variante part d''une version publiée du standard.' USING ERRCODE = 'MPM02';
    END IF;
    RETURN NEW;
  END $$;
