-- Revue guidée (QUA-03) : éléments à parcourir, parcours de chaque relecteur, temps de revue.
--
-- Le risque principal n'est plus l'erreur de l'IA, c'est le relecteur qui valide sans lire
-- (PRD complémentaire §10). Les modules plans, rapports et preuves déposent les éléments à
-- parcourir (assertions fragiles, chiffres, recommandations) par `ajouterElementsRevue`
-- (apps/api/src/qualite/revue.ts) ; le relecteur les marque « vus » ; sa validation est
-- refusée tant que lui-même n'a pas parcouru tous les éléments obligatoires.
--
-- - `qualite_revue_elements` : ajout seul, un élément est repéré par sa clé stable `cle`
--   (re-déposer la même clé est sans effet) ; plus d'ajout une fois le suivi validé ou signé
--   (MPY03).
-- - `qualite_revue_vus` : ajout seul, un « vu » par (élément, relecteur) ; `vu_le` en fait foi ;
--   possible jusqu'à la signature (le signataire parcourt aussi).
-- - `qualite_revue_sessions` : temps de revue mesuré ; seule la clôture (fin, durée) se pose,
--   une fois (MPY04).

CREATE TABLE qualite_revue_elements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  suivi_id uuid NOT NULL,
  cle text NOT NULL CHECK (cle ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$'),
  kind text NOT NULL CHECK (kind IN ('assertion_fragile', 'chiffre', 'recommandation')),
  libelle text NOT NULL CHECK (length(btrim(libelle)) BETWEEN 1 AND 500 AND libelle !~ '[[:cntrl:]]'),
  ordre integer NOT NULL DEFAULT 0 CHECK (ordre BETWEEN 0 AND 100000),
  obligatoire boolean NOT NULL DEFAULT true,
  -- Traçabilité d'un chiffre (preuve, moteur, source de donnée) ; contrôlée par la définition de terminé.
  source text CHECK (source IS NULL OR length(btrim(source)) BETWEEN 1 AND 300),
  -- Objet du module d'origine (ex. « plan_element:<uuid> »), pour y renvoyer le relecteur.
  reference text CHECK (reference IS NULL OR length(reference) BETWEEN 1 AND 200),
  cree_par uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, suivi_id, id),
  UNIQUE (suivi_id, cle),
  FOREIGN KEY (cabinet_id, suivi_id) REFERENCES qualite_suivis (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX qualite_revue_elements_idx ON qualite_revue_elements (cabinet_id, suivi_id, ordre, id);
ALTER TABLE qualite_revue_elements ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON qualite_revue_elements
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON qualite_revue_elements AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON qualite_revue_elements FROM missionpilot_app;
CREATE TRIGGER qualite_revue_elements_ajout_seul BEFORE UPDATE OR DELETE ON qualite_revue_elements
  FOR EACH ROW EXECUTE FUNCTION qualite_ajout_seul();

CREATE FUNCTION controler_qualite_suivi_ouvert() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM qualite_suivis s WHERE s.id = NEW.suivi_id AND s.statut IN ('valide', 'signe')) THEN
      RAISE EXCEPTION 'Le suivi qualité est validé : plus d''élément de revue à ajouter.'
        USING ERRCODE = 'MPY03';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER qualite_revue_elements_ouvert BEFORE INSERT ON qualite_revue_elements
  FOR EACH ROW EXECUTE FUNCTION controler_qualite_suivi_ouvert();

CREATE TABLE qualite_revue_vus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  suivi_id uuid NOT NULL,
  element_id uuid NOT NULL,
  utilisateur_id uuid NOT NULL,
  vu_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (element_id, utilisateur_id),
  FOREIGN KEY (cabinet_id, suivi_id, element_id) REFERENCES qualite_revue_elements (cabinet_id, suivi_id, id),
  FOREIGN KEY (cabinet_id, utilisateur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX qualite_revue_vus_idx ON qualite_revue_vus (cabinet_id, suivi_id, utilisateur_id);
ALTER TABLE qualite_revue_vus ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON qualite_revue_vus
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON qualite_revue_vus AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON qualite_revue_vus FROM missionpilot_app;
CREATE TRIGGER qualite_revue_vus_ajout_seul BEFORE UPDATE OR DELETE ON qualite_revue_vus
  FOR EACH ROW EXECUTE FUNCTION qualite_ajout_seul();
-- Le signataire parcourt aussi : un « vu » reste possible sur un suivi validé, plus sur un suivi signé.
CREATE FUNCTION controler_qualite_vu_ouvert() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM qualite_suivis s WHERE s.id = NEW.suivi_id AND s.statut = 'signe') THEN
      RAISE EXCEPTION 'Le livrable est signé : le parcours de revue est clos.' USING ERRCODE = 'MPY03';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER qualite_revue_vus_ouvert BEFORE INSERT ON qualite_revue_vus
  FOR EACH ROW EXECUTE FUNCTION controler_qualite_vu_ouvert();

CREATE TABLE qualite_revue_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  suivi_id uuid NOT NULL,
  utilisateur_id uuid NOT NULL,
  debut timestamptz NOT NULL DEFAULT now(),
  fin timestamptz,
  -- Durée retenue en secondes (plafonnée par le code : une session oubliée ouverte ne gonfle pas le temps).
  duree_secondes integer CHECK (duree_secondes IS NULL OR duree_secondes >= 0),
  CHECK ((fin IS NULL) = (duree_secondes IS NULL)),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, suivi_id) REFERENCES qualite_suivis (cabinet_id, id),
  FOREIGN KEY (cabinet_id, utilisateur_id) REFERENCES utilisateurs (cabinet_id, id)
);
-- Une seule session ouverte par relecteur et par suivi.
CREATE UNIQUE INDEX qualite_revue_sessions_ouverte_uniq
  ON qualite_revue_sessions (suivi_id, utilisateur_id) WHERE fin IS NULL;
CREATE INDEX qualite_revue_sessions_idx ON qualite_revue_sessions (cabinet_id, suivi_id, debut);
ALTER TABLE qualite_revue_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON qualite_revue_sessions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON qualite_revue_sessions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON qualite_revue_sessions FROM missionpilot_app;
GRANT UPDATE (fin, duree_secondes) ON qualite_revue_sessions TO missionpilot_app;

CREATE FUNCTION controler_qualite_session() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une session de revue ne se supprime pas.' USING ERRCODE = 'MPY04';
    END IF;
    IF OLD.fin IS NOT NULL OR NEW.fin IS NULL OR NEW.fin < OLD.debut
       OR NEW.cabinet_id IS DISTINCT FROM OLD.cabinet_id OR NEW.suivi_id IS DISTINCT FROM OLD.suivi_id
       OR NEW.utilisateur_id IS DISTINCT FROM OLD.utilisateur_id OR NEW.debut IS DISTINCT FROM OLD.debut THEN
      RAISE EXCEPTION 'Une session de revue ne se clôt qu''une fois.' USING ERRCODE = 'MPY04';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER qualite_revue_sessions_controle BEFORE UPDATE OR DELETE ON qualite_revue_sessions
  FOR EACH ROW EXECUTE FUNCTION controler_qualite_session();
