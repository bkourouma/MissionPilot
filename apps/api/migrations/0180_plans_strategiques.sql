-- Planification stratégique (service #3, PLA-01 à PLA-05, SOC-06).
--
-- Un plan stratégique est rattaché à une mission (donc à son entreprise
-- cliente). Ses contenus (diagnostic, SWOT, vision et mission, axes,
-- objectifs, initiatives) sont des ÉLÉMENTS dont chaque état est une VERSION
-- en ajout seul : on ne modifie jamais un contenu, on ajoute une version.
--
-- Statut du contenu (SOC-06), porté par chaque version :
-- - « brouillon » : saisi par un humain, jamais validé ;
-- - « brouillon_ia » : réservé au lot de rédaction assistée (aucun appel IA
--   ici ; l'IA ne produit jamais de chiffre) ;
-- - « modifie » : modifié après une validation ou après un brouillon IA ;
-- - « valide » : même contenu que la version précédente, validé par un
--   responsable de la mission (contrôle applicatif) qui n'a écrit AUCUNE
--   version depuis la dernière validation, sauf associé ou directeur de CETTE
--   mission (séparation des tâches, contrôlée aussi ici).
--
-- Exposition au client : rien n'est partagé par défaut (`partage_client`
-- faux) ; le partage exige que la version courante de chaque élément et la
-- dernière version du modèle financier soient validées (déclencheur). Les
-- tables du plan restent invisibles du portail (politique `portail_interdit`)
-- tant qu'une route du portail ne les sert pas explicitement.
--
-- Lien vers une notation publiée (#1) : en attente des tables de la notation
-- (ajout par une migration ultérieure de la plage 0180–0199).

CREATE TABLE plans_strategiques (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  titre text NOT NULL CHECK (length(btrim(titre)) BETWEEN 1 AND 200 AND titre !~ '[[:cntrl:]]'),
  -- PLA-06 (DECISIONS.md) : 5 ans par défaut, de 3 à 5 ans, fixé à la création.
  horizon smallint NOT NULL DEFAULT 5 CHECK (horizon BETWEEN 3 AND 5),
  devise text NOT NULL DEFAULT 'XOF' CHECK (devise IN ('XOF', 'XAF', 'EUR', 'USD')),
  partage_client boolean NOT NULL DEFAULT false,
  partage_par uuid,
  partage_le timestamptz,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, partage_par) REFERENCES utilisateurs (cabinet_id, id),
  CHECK (partage_client = (partage_par IS NOT NULL AND partage_le IS NOT NULL))
);
CREATE INDEX plans_strategiques_mission_idx ON plans_strategiques (cabinet_id, mission_id, cree_le, id);
ALTER TABLE plans_strategiques ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON plans_strategiques
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON plans_strategiques AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
-- Seuls le titre et le partage se modifient ; aucune suppression.
REVOKE UPDATE, DELETE ON plans_strategiques FROM missionpilot_app;
GRANT UPDATE (titre, partage_client, partage_par, partage_le) ON plans_strategiques TO missionpilot_app;

CREATE TABLE plan_elements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN
    ('diagnostic', 'swot', 'vision_mission', 'axe', 'objectif', 'initiative')),
  -- Objectif → axe ; initiative → axe ou objectif ; autres : sans parent.
  parent_id uuid,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, plan_id, id),
  FOREIGN KEY (cabinet_id, plan_id) REFERENCES plans_strategiques (cabinet_id, id),
  FOREIGN KEY (cabinet_id, plan_id, parent_id) REFERENCES plan_elements (cabinet_id, plan_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  CHECK ((type IN ('objectif', 'initiative')) = (parent_id IS NOT NULL))
);
-- Diagnostic, SWOT, vision et mission : un seul par plan.
CREATE UNIQUE INDEX plan_elements_unique_uniq ON plan_elements (plan_id, type)
  WHERE type IN ('diagnostic', 'swot', 'vision_mission');
CREATE INDEX plan_elements_plan_idx ON plan_elements (cabinet_id, plan_id, cree_le, id);
ALTER TABLE plan_elements ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON plan_elements
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON plan_elements AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON plan_elements FROM missionpilot_app;

CREATE TABLE plan_element_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  element_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  statut_contenu text NOT NULL CHECK (statut_contenu IN ('brouillon', 'brouillon_ia', 'modifie', 'valide')),
  -- Textes du contenu (schémas Zod par type, packages/shared/src/schemas/plans.ts).
  contenu jsonb NOT NULL CHECK (jsonb_typeof(contenu) = 'object' AND octet_length(contenu::text) <= 100000),
  -- Élément retiré du plan (l'historique reste) ; une version ultérieure peut le rétablir.
  retire boolean NOT NULL DEFAULT false,
  -- Initiative seulement (PLA-04, PLA-05) : responsable, dates, budget, statut.
  responsable_id uuid,
  debut date CHECK (debut BETWEEN '2000-01-01' AND '2100-12-31'),
  echeance date CHECK (echeance BETWEEN '2000-01-01' AND '2100-12-31'),
  budget bigint CHECK (budget >= 0),
  statut_initiative text CHECK (statut_initiative IN
    ('a_lancer', 'en_cours', 'terminee', 'suspendue', 'abandonnee')),
  -- Auteur de la version ; pour une version « valide », le valideur.
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (element_id, version),
  FOREIGN KEY (cabinet_id, element_id) REFERENCES plan_elements (cabinet_id, id),
  FOREIGN KEY (cabinet_id, responsable_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id),
  CHECK (debut IS NULL OR echeance IS NULL OR debut <= echeance)
);
CREATE INDEX plan_element_versions_idx ON plan_element_versions (cabinet_id, element_id, version DESC);
ALTER TABLE plan_element_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON plan_element_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON plan_element_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON plan_element_versions FROM missionpilot_app;

-- Ajout seul, même pour le propriétaire.
CREATE FUNCTION refuser_modification_plan() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Plan stratégique en ajout seul : ajouter une nouvelle version.'
      USING ERRCODE = 'MPS01';
  END $$;

CREATE TRIGGER plan_elements_ajout_seul BEFORE UPDATE OR DELETE ON plan_elements
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_plan();
CREATE TRIGGER plan_element_versions_ajout_seul BEFORE UPDATE OR DELETE ON plan_element_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_plan();

-- Un utilisateur du portail n'est jamais responsable d'une initiative (fonction de 0113).
CREATE TRIGGER plan_element_versions_sans_portail BEFORE INSERT ON plan_element_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('responsable_id');

/*
 * Séparation des tâches : le valideur `p_valideur` d'un contenu du plan
 * `p_plan` est dispensé de la règle « pas l'auteur » s'il est associé ou
 * directeur de la mission du plan.
 */
CREATE FUNCTION plan_valideur_dispense(p_plan uuid, p_valideur uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (SELECT 1 FROM utilisateurs u WHERE u.id = p_valideur AND 'associe' = ANY (u.roles))
        OR EXISTS (SELECT 1 FROM plans_strategiques p JOIN missions m ON m.id = p.mission_id
                   WHERE p.id = p_plan AND m.directeur_id = p_valideur) $$;

-- Parent cohérent : objectif sous un axe ; initiative sous un axe ou un objectif.
CREATE FUNCTION controler_plan_element() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_type_parent text;
  BEGIN
    IF NEW.parent_id IS NULL THEN RETURN NEW; END IF;
    SELECT type INTO v_type_parent FROM plan_elements WHERE id = NEW.parent_id;
    IF (NEW.type = 'objectif' AND v_type_parent IS DISTINCT FROM 'axe')
       OR (NEW.type = 'initiative' AND v_type_parent NOT IN ('axe', 'objectif')) THEN
      RAISE EXCEPTION 'Parent incompatible avec ce type d''élément.' USING ERRCODE = 'MPS02';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER plan_elements_controle BEFORE INSERT ON plan_elements
  FOR EACH ROW EXECUTE FUNCTION controler_plan_element();

/*
 * Cohérence d'une version : numéro suivant, statut admis après le précédent,
 * champs d'initiative réservés aux initiatives, validation à contenu
 * identique par une personne qui n'a écrit aucune version depuis la dernière
 * validation (sauf dispense).
 */
CREATE FUNCTION controler_plan_element_version() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    e plan_elements%ROWTYPE;
    p plan_element_versions%ROWTYPE;
    v_derniere_validation integer;
  BEGIN
    SELECT * INTO e FROM plan_elements WHERE id = NEW.element_id;
    SELECT * INTO p FROM plan_element_versions WHERE element_id = NEW.element_id
      ORDER BY version DESC LIMIT 1;
    IF (p.id IS NULL AND NEW.version <> 1) OR (p.id IS NOT NULL AND NEW.version <> p.version + 1) THEN
      RAISE EXCEPTION 'Numéro de version inattendu.' USING ERRCODE = 'MPS02';
    END IF;
    IF e.type = 'initiative' THEN
      IF NEW.statut_initiative IS NULL OR NEW.budget IS NULL OR NEW.echeance IS NULL THEN
        RAISE EXCEPTION 'Initiative : statut, budget et échéance obligatoires.' USING ERRCODE = 'MPS02';
      END IF;
    ELSIF NEW.responsable_id IS NOT NULL OR NEW.debut IS NOT NULL OR NEW.echeance IS NOT NULL
          OR NEW.budget IS NOT NULL OR NEW.statut_initiative IS NOT NULL THEN
      RAISE EXCEPTION 'Champs réservés aux initiatives.' USING ERRCODE = 'MPS02';
    END IF;
    IF NEW.statut_contenu = 'brouillon' AND p.id IS NOT NULL AND p.statut_contenu <> 'brouillon' THEN
      RAISE EXCEPTION 'Un contenu validé ou proposé par l''IA ne redevient pas un brouillon.'
        USING ERRCODE = 'MPS02';
    END IF;
    IF NEW.statut_contenu = 'modifie' AND p.id IS NULL THEN
      RAISE EXCEPTION 'Première version : brouillon attendu.' USING ERRCODE = 'MPS02';
    END IF;
    IF NEW.statut_contenu = 'valide' THEN
      IF p.id IS NULL OR p.statut_contenu = 'valide' THEN
        RAISE EXCEPTION 'Rien à valider.' USING ERRCODE = 'MPS02';
      END IF;
      IF (NEW.contenu, NEW.retire, NEW.responsable_id, NEW.debut, NEW.echeance, NEW.budget, NEW.statut_initiative)
         IS DISTINCT FROM (p.contenu, p.retire, p.responsable_id, p.debut, p.echeance, p.budget, p.statut_initiative) THEN
        RAISE EXCEPTION 'Une validation reprend le contenu à l''identique.' USING ERRCODE = 'MPS02';
      END IF;
      SELECT max(version) INTO v_derniere_validation FROM plan_element_versions
        WHERE element_id = NEW.element_id AND statut_contenu = 'valide';
      IF EXISTS (SELECT 1 FROM plan_element_versions
                 WHERE element_id = NEW.element_id AND auteur_id = NEW.auteur_id
                   AND version > coalesce(v_derniere_validation, 0))
         AND NOT plan_valideur_dispense(e.plan_id, NEW.auteur_id) THEN
        RAISE EXCEPTION 'L''auteur d''un contenu ne le valide pas lui-même.' USING ERRCODE = 'MPS03';
      END IF;
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER plan_element_versions_controle BEFORE INSERT ON plan_element_versions
  FOR EACH ROW EXECUTE FUNCTION controler_plan_element_version();
