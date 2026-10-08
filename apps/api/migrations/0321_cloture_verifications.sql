-- Résultats de vérification de la check-list de clôture, par mission (AUT-08).
--
-- Ajout seul (MPX01) : chaque évaluation qui change le résultat d'un contrôle, chaque attestation
-- et la vérification faite au moment de la clôture ajoutent une ligne ; on ne corrige jamais une
-- ligne. Le nombre d'écarts est un entier (jamais un montant). `origine` : « calcul » (contrôle
-- déterministe) ou « attestation » (déclaration humaine pour un contrôle sans donnée à calculer) ;
-- `bloquant` fige le réglage du modèle au moment de la vérification.
-- Codes SQLSTATE : MPX01 historique de vérification en ajout seul.

CREATE FUNCTION cloture_ajout_seul() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Historique de clôture en ajout seul : ajouter une nouvelle ligne.'
      USING ERRCODE = 'MPX01';
  END $$;

CREATE TABLE cloture_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  controle text NOT NULL CHECK (controle IN ('temps_valides', 'debours_traites', 'factures_emises',
    'livrables_signes', 'encaissements_soldes', 'satisfaction_demandee', 'capitalisation_faite')),
  resultat text NOT NULL CHECK (resultat IN ('conforme', 'non_conforme')),
  -- Écarts relevés ; NULL : le contrôle n'a pas pu conclure (attestation absente ou retirée).
  nombre_ecarts integer CHECK (nombre_ecarts IS NULL OR nombre_ecarts >= 0),
  bloquant boolean NOT NULL,
  origine text NOT NULL CHECK (origine IN ('calcul', 'attestation')),
  declencheur text NOT NULL CHECK (declencheur IN ('evaluation', 'attestation', 'cloture')),
  note text CHECK (note IS NULL OR length(btrim(note)) BETWEEN 1 AND 500),
  verifie_par uuid NOT NULL,
  verifie_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((resultat = 'conforme') = (nombre_ecarts = 0)),
  CHECK (origine = 'attestation' OR nombre_ecarts IS NOT NULL),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, verifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX cloture_verifications_idx
  ON cloture_verifications (cabinet_id, mission_id, controle, verifie_le DESC, id);
ALTER TABLE cloture_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON cloture_verifications
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON cloture_verifications AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON cloture_verifications FROM missionpilot_app;
CREATE TRIGGER cloture_verifications_ajout_seul BEFORE UPDATE OR DELETE ON cloture_verifications
  FOR EACH ROW EXECUTE FUNCTION cloture_ajout_seul();
