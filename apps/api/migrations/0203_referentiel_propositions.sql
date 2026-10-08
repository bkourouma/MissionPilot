-- Référentiel de méthodes (lot STD) — comité méthode (STD-12) : circuit de
-- proposition, revue et publication des évolutions du référentiel.
--
-- Une proposition vise une méthode visible (standard ou du cabinet) ou aucune
-- (nouvelle méthode). Circuit : proposée → en revue → acceptée ou refusée ;
-- acceptée → publiée, en citant la version PUBLIÉE du cabinet qui la porte
-- (méthode visée ou sa variante). Le relecteur n'est jamais l'auteur (MPM05).
-- Le standard MissionPilot lui-même ne se publie que par ACC (migration) :
-- une proposition acceptée sur une méthode du standard est remontée au
-- comité d'ACC, ou publiée dans la variante du cabinet.

CREATE TABLE propositions_standard (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  methode_id uuid REFERENCES methodes (id),
  titre text NOT NULL CHECK (std_libelle_valide(titre, 200)),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 4000),
  statut text NOT NULL DEFAULT 'proposee'
    CHECK (statut IN ('proposee', 'en_revue', 'acceptee', 'refusee', 'publiee')),
  auteur_id uuid NOT NULL,
  relecteur_id uuid,
  avis text CHECK (avis IS NULL OR length(btrim(avis)) BETWEEN 1 AND 4000),
  version_publiee_id uuid REFERENCES methode_versions (id),
  cree_le timestamptz NOT NULL DEFAULT now(),
  revue_le timestamptz,
  decide_le timestamptz,
  publie_le timestamptz,
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, relecteur_id) REFERENCES utilisateurs (cabinet_id, id),
  CHECK ((statut = 'proposee') = (relecteur_id IS NULL)),
  CHECK ((statut IN ('acceptee', 'refusee', 'publiee')) = (decide_le IS NOT NULL)),
  CHECK ((statut = 'publiee') = (version_publiee_id IS NOT NULL AND publie_le IS NOT NULL)),
  CHECK (statut <> 'refusee' OR avis IS NOT NULL)
);
CREATE INDEX propositions_standard_tri_idx ON propositions_standard (cabinet_id, cree_le DESC, id DESC);
ALTER TABLE propositions_standard ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON propositions_standard
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON propositions_standard AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON propositions_standard FROM missionpilot_app;
GRANT UPDATE (statut, relecteur_id, avis, version_publiee_id, revue_le, decide_le, publie_le)
  ON propositions_standard TO missionpilot_app;

CREATE FUNCTION controler_proposition_standard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_cabinet uuid;
    v_statut text;
    v_methode uuid;
    v_parent uuid;
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.statut <> 'proposee' THEN
        RAISE EXCEPTION 'Une proposition naît « proposée ».' USING ERRCODE = 'MPM05';
      END IF;
      IF NEW.methode_id IS NOT NULL THEN
        SELECT cabinet_id INTO v_cabinet FROM methodes WHERE id = NEW.methode_id;
        IF NOT FOUND OR (v_cabinet IS NOT NULL AND v_cabinet <> NEW.cabinet_id) THEN
          RAISE EXCEPTION 'Méthode inconnue.' USING ERRCODE = 'MPM02';
        END IF;
      END IF;
      RETURN NEW;
    END IF;
    IF (NEW.cabinet_id, NEW.methode_id, NEW.titre, NEW.description, NEW.auteur_id, NEW.cree_le)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.methode_id, OLD.titre, OLD.description, OLD.auteur_id, OLD.cree_le)
       OR NOT ((OLD.statut = 'proposee' AND NEW.statut = 'en_revue')
            OR (OLD.statut = 'en_revue' AND NEW.statut IN ('acceptee', 'refusee'))
            OR (OLD.statut = 'acceptee' AND NEW.statut = 'publiee')) THEN
      RAISE EXCEPTION 'Transition de proposition invalide.' USING ERRCODE = 'MPM05';
    END IF;
    IF NEW.relecteur_id = NEW.auteur_id
       OR (OLD.relecteur_id IS NOT NULL AND NEW.relecteur_id IS DISTINCT FROM OLD.relecteur_id) THEN
      RAISE EXCEPTION 'L''auteur d''une proposition ne la relit pas.' USING ERRCODE = 'MPM05';
    END IF;
    IF NEW.statut = 'publiee' THEN
      SELECT v.cabinet_id, v.statut, v.methode_id, m.parent_id
        INTO v_cabinet, v_statut, v_methode, v_parent
        FROM methode_versions v JOIN methodes m ON m.id = v.methode_id
        WHERE v.id = NEW.version_publiee_id;
      IF NOT FOUND OR v_cabinet IS DISTINCT FROM NEW.cabinet_id OR v_statut <> 'publiee'
         OR (NEW.methode_id IS NOT NULL AND NEW.methode_id <> v_methode
             AND NEW.methode_id IS DISTINCT FROM v_parent) THEN
        RAISE EXCEPTION 'Publication : version publiée du cabinet portant la méthode visée.'
          USING ERRCODE = 'MPM05';
      END IF;
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER propositions_standard_controle BEFORE INSERT OR UPDATE ON propositions_standard
  FOR EACH ROW EXECUTE FUNCTION controler_proposition_standard();
CREATE TRIGGER propositions_standard_sans_suppression BEFORE DELETE ON propositions_standard
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_referentiel();
