-- Capitalisation (lot CAP) — matrice de compétences des collaborateurs (CAP-06).
--
-- - competences : référentiel du cabinet ; une compétence cite les briques (codes du référentiel
--   de méthodes) et les types de livrable qui en apportent la preuve d'usage.
-- - competence_declarations : niveau DÉCLARÉ (1 notions, 2 pratique, 3 maîtrise, 4 expertise)
--   par la personne ou par un responsable ; ajout seul (MPJ01).
-- - competence_decisions : validation ou refus d'une déclaration, définitif (une décision par
--   déclaration) ; jamais par la personne évaluée, ni par le déclarant sauf associé (MPJ04).
-- - competence_preuves : preuves d'usage tirées des missions (temps passé sur une brique) et des
--   revues (auteur ou relecteur d'un livrable suivi par la qualité) ; ajout seul, dédoublonnées.
--   Une preuve ne fixe JAMAIS un niveau : seul un humain habilité valide un niveau.

CREATE TABLE competences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (std_code_valide(code)),
  libelle text NOT NULL CHECK (std_libelle_valide(libelle, 200)),
  description text CHECK (description IS NULL OR length(description) <= 2000),
  briques text[] NOT NULL DEFAULT '{}',
  types_livrable text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, code),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  CHECK (cardinality(briques) <= 50),
  CHECK (cardinality(briques) = 0
    OR array_to_string(briques, ' ') ~ '^[a-z0-9_.-]{1,120}( [a-z0-9_.-]{1,120})*$'),
  CHECK (types_livrable <@ ARRAY['rapport', 'notation', 'plan', 'questionnaire', 'etat', 'autre']::text[])
);
ALTER TABLE competences ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON competences
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON competences AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON competences FROM missionpilot_app;
REVOKE UPDATE ON competences FROM missionpilot_app;
GRANT UPDATE (libelle, description, briques, types_livrable, active, modifie_le) ON competences
  TO missionpilot_app;

CREATE TABLE competence_declarations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  collaborateur_id uuid NOT NULL,
  competence_id uuid NOT NULL,
  niveau smallint NOT NULL CHECK (niveau BETWEEN 1 AND 4),
  commentaire text CHECK (commentaire IS NULL OR length(btrim(commentaire)) BETWEEN 1 AND 1000),
  declare_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, collaborateur_id) REFERENCES collaborateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, competence_id) REFERENCES competences (cabinet_id, id),
  FOREIGN KEY (cabinet_id, declare_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX competence_declarations_idx
  ON competence_declarations (cabinet_id, collaborateur_id, competence_id, cree_le DESC);
ALTER TABLE competence_declarations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON competence_declarations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON competence_declarations AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON competence_declarations FROM missionpilot_app;
CREATE TRIGGER competence_declarations_ajout_seul
  BEFORE UPDATE OR DELETE ON competence_declarations
  FOR EACH ROW EXECUTE FUNCTION cap_ajout_seul();

CREATE TABLE competence_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  declaration_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('validee', 'refusee')),
  commentaire text CHECK (commentaire IS NULL OR length(btrim(commentaire)) BETWEEN 1 AND 1000),
  decide_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (declaration_id),
  FOREIGN KEY (cabinet_id, declaration_id) REFERENCES competence_declarations (cabinet_id, id),
  FOREIGN KEY (cabinet_id, decide_par) REFERENCES utilisateurs (cabinet_id, id),
  CHECK (decision = 'validee' OR commentaire IS NOT NULL)
);
ALTER TABLE competence_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON competence_decisions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON competence_decisions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON competence_decisions FROM missionpilot_app;
CREATE TRIGGER competence_decisions_ajout_seul BEFORE UPDATE OR DELETE ON competence_decisions
  FOR EACH ROW EXECUTE FUNCTION cap_ajout_seul();

-- Séparation des tâches doublée en base (MPJ04) : ni la personne évaluée, ni son déclarant
-- (sauf associé actif) ne décident de la déclaration.
CREATE FUNCTION controler_decision_competence() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_declare_par uuid;
    v_utilisateur uuid;
  BEGIN
    SELECT d.declare_par, c.utilisateur_id INTO v_declare_par, v_utilisateur
      FROM competence_declarations d JOIN collaborateurs c ON c.id = d.collaborateur_id
      WHERE d.id = NEW.declaration_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Déclaration inconnue.' USING ERRCODE = 'MPJ05';
    END IF;
    IF NEW.decide_par = v_utilisateur THEN
      RAISE EXCEPTION 'Un niveau ne se valide pas par la personne évaluée.' USING ERRCODE = 'MPJ04';
    END IF;
    IF NEW.decide_par = v_declare_par AND NOT EXISTS (
         SELECT 1 FROM utilisateurs u WHERE u.id = NEW.decide_par AND u.actif
           AND 'associe' = ANY (u.roles)) THEN
      RAISE EXCEPTION 'Le déclarant ne valide pas sa propre déclaration (sauf associé).'
        USING ERRCODE = 'MPJ04';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER competence_decisions_controle BEFORE INSERT ON competence_decisions
  FOR EACH ROW EXECUTE FUNCTION controler_decision_competence();

CREATE TABLE competence_preuves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  collaborateur_id uuid NOT NULL,
  competence_id uuid NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('temps_brique', 'livrable_auteur', 'revue')),
  -- Mission (temps sur une brique) ou suivi qualité (livrable rédigé ou relu).
  source_id uuid NOT NULL,
  mission_id uuid NOT NULL,
  centiemes bigint CHECK (centiemes IS NULL OR centiemes >= 0),
  date_preuve date NOT NULL CHECK (date_preuve BETWEEN '2000-01-01' AND '2100-12-31'),
  detail text CHECK (detail IS NULL OR (length(detail) BETWEEN 1 AND 300 AND detail !~ '[[:cntrl:]]')),
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (collaborateur_id, competence_id, source_type, source_id),
  FOREIGN KEY (cabinet_id, collaborateur_id) REFERENCES collaborateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, competence_id) REFERENCES competences (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  CHECK ((source_type = 'temps_brique') = (source_id = mission_id AND centiemes IS NOT NULL))
);
CREATE INDEX competence_preuves_idx
  ON competence_preuves (cabinet_id, collaborateur_id, competence_id, date_preuve DESC);
ALTER TABLE competence_preuves ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON competence_preuves
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON competence_preuves AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON competence_preuves FROM missionpilot_app;
CREATE TRIGGER competence_preuves_ajout_seul BEFORE UPDATE OR DELETE ON competence_preuves
  FOR EACH ROW EXECUTE FUNCTION cap_ajout_seul();
