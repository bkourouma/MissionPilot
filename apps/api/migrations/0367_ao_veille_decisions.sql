-- Journal des décisions sur les résultats de veille (AO-01), en AJOUT SEUL ; voir 0364.
-- Un écartement et un réexamen portent un motif (10 caractères au moins) ; la création de fiche
-- cite la fiche créée.

CREATE TABLE ao_veille_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  resultat_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('retenir', 'ecarter', 'reexaminer', 'creer_fiche')),
  motif text CHECK (motif IS NULL OR (length(btrim(motif)) >= 10 AND length(motif) <= 2000)),
  fiche_id uuid,
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, resultat_id) REFERENCES ao_veille_resultats (cabinet_id, id),
  FOREIGN KEY (cabinet_id, fiche_id) REFERENCES appels_offres (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id),
  CHECK (decision NOT IN ('ecarter', 'reexaminer') OR motif IS NOT NULL),
  CHECK ((decision = 'creer_fiche') = (fiche_id IS NOT NULL))
);
CREATE INDEX ao_veille_decisions_resultat_idx
  ON ao_veille_decisions (cabinet_id, resultat_id, cree_le);
ALTER TABLE ao_veille_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ao_veille_decisions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON ao_veille_decisions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON ao_veille_decisions FROM missionpilot_app;
CREATE TRIGGER ao_veille_decisions_ajout_seul BEFORE UPDATE OR DELETE ON ao_veille_decisions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_veille();

-- La décision s'accorde au statut courant du résultat (MQA05) : on retient un résultat nouveau,
-- on écarte un résultat nouveau ou retenu, on réexamine un résultat écarté, on crée la fiche
-- d'un résultat nouveau ou retenu.
CREATE FUNCTION controler_decision_veille() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_statut text;
  BEGIN
    SELECT r.statut INTO v_statut FROM ao_veille_resultats r WHERE r.id = NEW.resultat_id;
    IF NOT ((NEW.decision = 'retenir' AND v_statut = 'nouveau')
         OR (NEW.decision = 'ecarter' AND v_statut IN ('nouveau', 'retenu'))
         OR (NEW.decision = 'reexaminer' AND v_statut = 'ecarte')
         OR (NEW.decision = 'creer_fiche' AND v_statut IN ('nouveau', 'retenu'))) THEN
      RAISE EXCEPTION 'Décision incohérente avec l''état du résultat de veille.'
        USING ERRCODE = 'MQA05';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER ao_veille_decisions_controle BEFORE INSERT ON ao_veille_decisions
  FOR EACH ROW EXECUTE FUNCTION controler_decision_veille();
