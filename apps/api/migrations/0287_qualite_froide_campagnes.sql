-- Revue à froid des missions clôturées par échantillonnage (QUA-05) : campagnes et échantillon.
--
-- Une CAMPAGNE tire, avec une graine enregistrée, un échantillon de missions clôturées (critères :
-- période de clôture, types, directeurs, stratification, exclusion des missions déjà revues). La
-- population éligible au moment du tirage est COPIÉE dans la campagne (`population_ids`, 5000
-- missions au plus) avec son empreinte : le tirage se rejoue à l'identique (moteur
-- `packages/engines/src/qualite/echantillonnage.ts`) et ne dépend plus de l'état ultérieur des
-- missions. Critères, graine, population et échantillon sont IMMUABLES après la création ; seule la
-- clôture de la campagne change (MQQ02).
--
-- Un ÉCHANTILLON est une mission tirée, affectée à un relecteur INDÉPENDANT : jamais directeur,
-- chef, membre de l'équipe, affecté du planning, créateur, clôtureur ou signataire de la mission,
-- ni intervenant de ses suivis qualité (MQQ03, doublé par l'API et le moteur
-- `evaluerIndependanceRelecteur`). Une revue terminée est figée (MQQ04).
--
-- SQLSTATE de la revue à froid (lettre de domaine `Q`, MQQ01 à MQQ12) :
--   MQQ01 historique en ajout seul          MQQ02 campagne ou tirage figé
--   MQQ03 relecteur non indépendant         MQQ04 revue terminée figée
--   MQQ05 mission tirée invalide            MQQ06 transition d'action invalide
--   MQQ07 relecteur non habilité            MQQ08 responsable d'action invalide
--   MQQ09 plafond dépassé                   MQQ10 clôture de campagne prématurée
--   MQQ11 revue dans un état impossible     MQQ12 constat lié à l'action invalide
-- Tables internes : invisibles du portail (`portail_interdit`). Aucune suppression.

-- Violations d'indépendance d'un relecteur sur une mission (codes du moteur
-- `evaluerIndependanceRelecteur`). Doublure SQL du contrôle de l'API : la base le tient même si
-- le code est contourné.
CREATE FUNCTION qualite_froide_violations(p_mission uuid, p_relecteur uuid) RETURNS text[]
  LANGUAGE sql STABLE
  SET search_path = public, pg_temp
  AS $$
    SELECT coalesce(array_remove(ARRAY[
      CASE WHEN m.directeur_id = p_relecteur THEN 'DIRECTEUR' END,
      CASE WHEN m.chef_id = p_relecteur THEN 'CHEF' END,
      CASE WHEN EXISTS (SELECT 1 FROM mission_equipe e
                        WHERE e.mission_id = m.id AND e.utilisateur_id = p_relecteur)
           THEN 'EQUIPE' END,
      CASE WHEN EXISTS (SELECT 1 FROM affectations a JOIN collaborateurs c ON c.id = a.collaborateur_id
                        WHERE a.mission_id = m.id AND c.utilisateur_id = p_relecteur)
           THEN 'AFFECTE' END,
      CASE WHEN m.cree_par = p_relecteur THEN 'CREATEUR' END,
      CASE WHEN m.cloturee_par = p_relecteur THEN 'CLOTURE' END,
      CASE WHEN m.signee_par = p_relecteur THEN 'SIGNATAIRE' END,
      CASE WHEN EXISTS (
             SELECT 1 FROM qualite_suivis s
             WHERE s.mission_id = m.id
               AND (s.auteur_id = p_relecteur OR s.ouvert_par = p_relecteur
                    OR EXISTS (SELECT 1 FROM qualite_validations v
                               WHERE v.suivi_id = s.id AND v.acteur_id = p_relecteur)
                    OR EXISTS (SELECT 1 FROM qualite_signatures g
                               WHERE g.suivi_id = s.id AND g.signataire_id = p_relecteur)
                    OR EXISTS (SELECT 1 FROM qualite_verifications q
                               WHERE q.suivi_id = s.id AND q.par = p_relecteur)))
           THEN 'INTERVENANT_QUALITE' END
    ], NULL), ARRAY[]::text[])
    FROM missions m WHERE m.id = p_mission
  $$;

-- Ajout seul, même pour le propriétaire (historique des actions du plan d'amélioration).
CREATE FUNCTION qualite_froide_ajout_seul() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Historique de la revue à froid en ajout seul : ajouter une nouvelle ligne.'
      USING ERRCODE = 'MQQ01';
  END $$;

CREATE TABLE qualite_froide_campagnes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  intitule text NOT NULL CHECK (length(btrim(intitule)) BETWEEN 1 AND 200 AND intitule !~ '[[:cntrl:]]'),
  criteres jsonb NOT NULL CHECK (jsonb_typeof(criteres) = 'object'),
  taille_demandee integer NOT NULL CHECK (taille_demandee BETWEEN 1 AND 100),
  graine text NOT NULL CHECK (graine ~ '^[A-Za-z0-9_-]{1,64}$'),
  -- Copie de la population éligible au tirage (identifiants de missions), 5000 au plus.
  population_ids jsonb NOT NULL CHECK (jsonb_typeof(population_ids) = 'array'
    AND jsonb_array_length(population_ids) BETWEEN 1 AND 5000),
  empreinte_population text NOT NULL CHECK (empreinte_population ~ '^[0-9a-f]{14}$'),
  statut text NOT NULL DEFAULT 'ouverte' CHECK (statut IN ('ouverte', 'close')),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  cloturee_par uuid,
  cloturee_le timestamptz,
  CHECK ((statut = 'close') = (cloturee_le IS NOT NULL AND cloturee_par IS NOT NULL)),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cloturee_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX qualite_froide_campagnes_idx ON qualite_froide_campagnes (cabinet_id, cree_le DESC, id DESC);
ALTER TABLE qualite_froide_campagnes ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON qualite_froide_campagnes
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON qualite_froide_campagnes AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON qualite_froide_campagnes FROM missionpilot_app;
GRANT UPDATE (statut, cloturee_par, cloturee_le) ON qualite_froide_campagnes TO missionpilot_app;

-- Les tables lues par ce déclencheur (échantillon) sont créées plus bas : lecture à l'exécution.
CREATE FUNCTION controler_qualite_froide_campagne() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une campagne de revue à froid ne se supprime pas.' USING ERRCODE = 'MQQ02';
    END IF;
    IF NEW.cabinet_id IS DISTINCT FROM OLD.cabinet_id OR NEW.intitule IS DISTINCT FROM OLD.intitule
       OR NEW.criteres IS DISTINCT FROM OLD.criteres
       OR NEW.taille_demandee IS DISTINCT FROM OLD.taille_demandee
       OR NEW.graine IS DISTINCT FROM OLD.graine
       OR NEW.population_ids IS DISTINCT FROM OLD.population_ids
       OR NEW.empreinte_population IS DISTINCT FROM OLD.empreinte_population
       OR NEW.cree_par IS DISTINCT FROM OLD.cree_par OR NEW.cree_le IS DISTINCT FROM OLD.cree_le THEN
      RAISE EXCEPTION 'Critères, graine, population et échantillon d''une campagne sont figés.'
        USING ERRCODE = 'MQQ02';
    END IF;
    IF OLD.statut = 'close' THEN
      RAISE EXCEPTION 'La campagne est close.' USING ERRCODE = 'MQQ02';
    END IF;
    IF NEW.statut = 'close' AND EXISTS (
         SELECT 1 FROM qualite_froide_echantillon e
         WHERE e.campagne_id = NEW.id AND e.statut <> 'terminee') THEN
      RAISE EXCEPTION 'Toutes les revues doivent être terminées avant de clore la campagne.'
        USING ERRCODE = 'MQQ10';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER qualite_froide_campagnes_controle BEFORE UPDATE OR DELETE ON qualite_froide_campagnes
  FOR EACH ROW EXECUTE FUNCTION controler_qualite_froide_campagne();

CREATE TABLE qualite_froide_echantillon (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  campagne_id uuid NOT NULL,
  mission_id uuid NOT NULL,
  rang integer NOT NULL CHECK (rang BETWEEN 1 AND 100),
  -- Empreinte du tirage de la mission (moteur d'échantillonnage).
  cle text NOT NULL CHECK (cle ~ '^[0-9a-f]{14}$'),
  relecteur_id uuid,
  affecte_par uuid,
  affecte_le timestamptz,
  statut text NOT NULL DEFAULT 'a_affecter'
    CHECK (statut IN ('a_affecter', 'affectee', 'en_revue', 'terminee')),
  score numeric(5, 1) CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  conclusion text CHECK (conclusion IS NULL OR conclusion IN ('conforme', 'reserves', 'non_conforme')),
  synthese text CHECK (synthese IS NULL OR length(btrim(synthese)) BETWEEN 1 AND 4000),
  version_grille integer CHECK (version_grille IS NULL OR version_grille >= 1),
  terminee_le timestamptz,
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((statut = 'a_affecter') = (relecteur_id IS NULL)),
  CHECK ((relecteur_id IS NULL) = (affecte_par IS NULL) AND (relecteur_id IS NULL) = (affecte_le IS NULL)),
  CHECK ((statut = 'terminee') = (terminee_le IS NOT NULL)),
  CHECK (statut <> 'terminee'
         OR (conclusion IS NOT NULL AND synthese IS NOT NULL AND version_grille IS NOT NULL)),
  UNIQUE (cabinet_id, id),
  CONSTRAINT qualite_froide_echantillon_mission_uniq UNIQUE (campagne_id, mission_id),
  CONSTRAINT qualite_froide_echantillon_rang_uniq UNIQUE (campagne_id, rang),
  FOREIGN KEY (cabinet_id, campagne_id) REFERENCES qualite_froide_campagnes (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, relecteur_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, affecte_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX qualite_froide_echantillon_relecteur_idx
  ON qualite_froide_echantillon (cabinet_id, relecteur_id, statut) WHERE relecteur_id IS NOT NULL;
CREATE INDEX qualite_froide_echantillon_mission_idx ON qualite_froide_echantillon (cabinet_id, mission_id);
ALTER TABLE qualite_froide_echantillon ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON qualite_froide_echantillon
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON qualite_froide_echantillon AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON qualite_froide_echantillon FROM missionpilot_app;
GRANT UPDATE (relecteur_id, affecte_par, affecte_le, statut, score, conclusion, synthese,
              version_grille, terminee_le) ON qualite_froide_echantillon TO missionpilot_app;

CREATE FUNCTION controler_qualite_froide_echantillon() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_camp record;
    v_violations text[];
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Un échantillon de revue à froid ne se supprime pas.' USING ERRCODE = 'MQQ02';
    END IF;
    IF TG_OP = 'INSERT' THEN
      SELECT c.statut, c.population_ids INTO v_camp
        FROM qualite_froide_campagnes c WHERE c.id = NEW.campagne_id;
      IF v_camp.statut IS DISTINCT FROM 'ouverte' THEN
        RAISE EXCEPTION 'L''échantillon se tire à la création de la campagne, tant qu''elle est ouverte.'
          USING ERRCODE = 'MQQ02';
      END IF;
      IF NOT (v_camp.population_ids ? NEW.mission_id::text) THEN
        RAISE EXCEPTION 'La mission tirée ne fait pas partie de la population de la campagne.'
          USING ERRCODE = 'MQQ05';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM missions m WHERE m.id = NEW.mission_id AND m.statut = 'cloturee') THEN
        RAISE EXCEPTION 'Seule une mission clôturée du cabinet se tire en revue à froid.'
          USING ERRCODE = 'MQQ05';
      END IF;
    ELSE
      IF NEW.cabinet_id IS DISTINCT FROM OLD.cabinet_id OR NEW.campagne_id IS DISTINCT FROM OLD.campagne_id
         OR NEW.mission_id IS DISTINCT FROM OLD.mission_id OR NEW.rang IS DISTINCT FROM OLD.rang
         OR NEW.cle IS DISTINCT FROM OLD.cle THEN
        RAISE EXCEPTION 'L''échantillon tiré est figé.' USING ERRCODE = 'MQQ02';
      END IF;
      IF OLD.statut = 'terminee' THEN
        RAISE EXCEPTION 'La revue est terminée : elle est figée.' USING ERRCODE = 'MQQ04';
      END IF;
      IF NOT ((OLD.statut = 'a_affecter' AND NEW.statut IN ('a_affecter', 'affectee'))
              OR (OLD.statut = 'affectee' AND NEW.statut IN ('affectee', 'en_revue'))
              OR (OLD.statut = 'en_revue' AND NEW.statut IN ('en_revue', 'terminee'))) THEN
        RAISE EXCEPTION 'Passage de statut impossible pour cette revue.' USING ERRCODE = 'MQQ11';
      END IF;
    END IF;

    IF NEW.relecteur_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.relecteur_id IS DISTINCT FROM OLD.relecteur_id) THEN
      IF NOT EXISTS (SELECT 1 FROM utilisateurs u
                     WHERE u.id = NEW.relecteur_id AND u.actif
                       AND u.roles && ARRAY['associe', 'directeur_mission', 'expert_metier']::text[]) THEN
        RAISE EXCEPTION 'Le relecteur doit être un utilisateur actif habilité à la revue à froid.'
          USING ERRCODE = 'MQQ07';
      END IF;
      v_violations := qualite_froide_violations(NEW.mission_id, NEW.relecteur_id);
      IF cardinality(v_violations) > 0 THEN
        RAISE EXCEPTION 'Le relecteur n''est pas indépendant de la mission : %',
          array_to_string(v_violations, ', ') USING ERRCODE = 'MQQ03';
      END IF;
    END IF;

    -- Une mission tirée commence à affecter (contrôlé après l'indépendance du relecteur : une
    -- insertion directe déjà affectée à un non-indépendant est refusée pour cette raison d'abord).
    IF TG_OP = 'INSERT' AND NEW.statut <> 'a_affecter' THEN
      RAISE EXCEPTION 'Une mission tirée commence à affecter.' USING ERRCODE = 'MQQ11';
    END IF;

    IF NEW.statut = 'terminee' THEN
      -- Grille COMPLÈTE : les huit critères de la grille version 1 sont évalués.
      IF (SELECT count(*) FROM qualite_froide_evaluations v WHERE v.echantillon_id = NEW.id) < 8 THEN
        RAISE EXCEPTION 'La grille de revue doit être complète pour terminer la revue.'
          USING ERRCODE = 'MQQ11';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER qualite_froide_echantillon_controle BEFORE INSERT OR UPDATE OR DELETE
  ON qualite_froide_echantillon
  FOR EACH ROW EXECUTE FUNCTION controler_qualite_froide_echantillon();
