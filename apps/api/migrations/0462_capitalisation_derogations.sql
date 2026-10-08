-- Capitalisation (lot CAP) — analyse des dérogations (CAP-05).
--
-- Une proposition d'évolution du standard tirée d'un groupe de dérogations fréquentes (méthode,
-- brique, nature) est créée par le service du comité méthode (`propositions_standard`, lot STD,
-- circuit MPM05) ; ce registre garde le lien et les effectifs constatés par le moteur au moment
-- de la proposition, pour ne pas reproposer un groupe déjà soumis. Ajout seul (MPJ01).

CREATE TABLE cap_propositions_derogations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  cle text NOT NULL CHECK (length(cle) BETWEEN 1 AND 300 AND cle !~ '[[:cntrl:]]'),
  proposition_id uuid NOT NULL,
  missions integer NOT NULL CHECK (missions >= 0),
  derogations integer NOT NULL CHECK (derogations >= 0),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (proposition_id),
  FOREIGN KEY (cabinet_id, proposition_id) REFERENCES propositions_standard (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX cap_propositions_derogations_cle_idx ON cap_propositions_derogations (cabinet_id, cle);
ALTER TABLE cap_propositions_derogations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON cap_propositions_derogations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON cap_propositions_derogations AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON cap_propositions_derogations FROM missionpilot_app;
CREATE TRIGGER cap_propositions_derogations_ajout_seul
  BEFORE UPDATE OR DELETE ON cap_propositions_derogations
  FOR EACH ROW EXECUTE FUNCTION cap_ajout_seul();
