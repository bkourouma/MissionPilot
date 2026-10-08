-- Relances des factures échues (FIN-09) : paramètres par cabinet, historique
-- des relances en AJOUT SEUL, tâche planifiée quotidienne.
-- Délais par défaut (J+7, J+15, J+30 après l'échéance, niveaux 1 à 3) :
-- VALEURS DE DÉPART à faire valider par le métier (`valeurs_validees`).
-- L'envoi automatique de l'e-mail au contact du client est désactivé par
-- défaut : la relance est alors préparée et le gestionnaire notifié.

CREATE TABLE parametres_relances (
  cabinet_id uuid PRIMARY KEY REFERENCES cabinets (id) ON DELETE CASCADE,
  delais_relance smallint[] NOT NULL DEFAULT '{7,15,30}'
    CHECK (cardinality(delais_relance) BETWEEN 1 AND 3
           AND 1 <= ALL (delais_relance) AND 365 >= ALL (delais_relance)),
  relances_actives boolean NOT NULL DEFAULT true,
  envoi_email_client boolean NOT NULL DEFAULT false,
  valeurs_validees boolean NOT NULL DEFAULT false,
  modifie_par uuid,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE parametres_relances ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON parametres_relances
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON parametres_relances FROM missionpilot_app;

-- Historique : une relance automatique par facture et par niveau (index
-- unique : le planificateur relancé deux fois ne double jamais une relance).
-- L'e-mail préparé (destinataire, sujet, corps) est conservé tel quel.
CREATE TABLE relances_factures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  facture_id uuid NOT NULL,
  niveau smallint NOT NULL CHECK (niveau BETWEEN 1 AND 3),
  mode text NOT NULL CHECK (mode IN ('automatique', 'manuelle')),
  date_relance date NOT NULL CHECK (date_relance BETWEEN '2000-01-01' AND '2100-12-31'),
  jours_retard int NOT NULL CHECK (jours_retard BETWEEN 0 AND 40000),
  destinataire_email text CHECK (destinataire_email IS NULL OR length(destinataire_email) <= 254),
  email_sujet text CHECK (email_sujet IS NULL OR length(email_sujet) <= 250),
  email_texte text CHECK (email_texte IS NULL OR length(email_texte) <= 5000),
  -- Vrai si l'e-mail a été confié au transport (envoi immédiat ou file d'e-mails).
  email_envoye boolean NOT NULL DEFAULT false,
  cree_par uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK (mode = 'automatique' OR cree_par IS NOT NULL),
  CHECK (NOT email_envoye OR destinataire_email IS NOT NULL),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, facture_id) REFERENCES factures (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE UNIQUE INDEX relances_factures_auto_uniq ON relances_factures (cabinet_id, facture_id, niveau)
  WHERE mode = 'automatique';
CREATE INDEX relances_factures_facture_idx ON relances_factures (cabinet_id, facture_id, cree_le);
ALTER TABLE relances_factures ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON relances_factures
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON relances_factures FROM missionpilot_app;

CREATE TRIGGER relances_factures_ajout_seul BEFORE UPDATE OR DELETE ON relances_factures
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_finance();

-- Tâche récurrente quotidienne « relances_factures » (clé relances_factures:AAAA-MM-JJ),
-- planifiée seulement pour les cabinets qui ont au moins une facture émise
-- échue à cette date (contrôle structurel : le solde est calculé par le
-- moteur dans le handler). SECURITY DEFINER : exécutée hors contexte de cabinet.
CREATE FUNCTION planifier_relances_factures(p_cle text, p_execute_a timestamptz, p_date date)
  RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_n int;
  BEGIN
    IF p_cle !~ '^relances_factures:[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'Clé de relance invalide.';
    END IF;
    INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle)
      SELECT c.id, 'relances_factures', jsonb_build_object('date', p_date), p_execute_a, p_cle
      FROM cabinets c
      WHERE EXISTS (SELECT 1 FROM factures f WHERE f.cabinet_id = c.id AND f.nature = 'facture'
                    AND f.statut = 'emise' AND f.date_echeance < p_date)
      ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END $$;
REVOKE ALL ON FUNCTION planifier_relances_factures(text, timestamptz, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION planifier_relances_factures(text, timestamptz, date) TO missionpilot_app;
