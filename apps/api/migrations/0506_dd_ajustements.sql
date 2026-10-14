-- Ajustements des experts (DD-08) : trace des écarts de l'expert à une proposition d'un moteur ou de
-- la bibliothèque, en AJOUT SEUL. Écrite par l'API seulement (aucune route POST), dans la
-- transaction de l'écriture qui la provoque : verdict différent de l'indication du moteur
-- (`champ = 'verdict'`), niveau d'un risque différent de la gravité indicative du signal d'origine
-- (`champ = 'niveau'`), ajustement multiplicatif d'un dimensionnement (`champ = 'resultat'`).
--
-- `cible_id` désigne dd_verdicts.id, dd_elements.id (un risque) ou dd_dimensionnements.id selon
-- `cible_type` : référence polymorphe, donc contrôlée par déclencheur (MPZ22) plutôt que par clé
-- étrangère. Les valeurs avant et après sont des TEXTES déjà formatés par les moteurs.

CREATE TABLE dd_ajustements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  dossier_id uuid NOT NULL,
  cible_type text NOT NULL CHECK (cible_type IN ('verdict', 'risque', 'dimensionnement')),
  cible_id uuid NOT NULL,
  champ text NOT NULL CHECK (length(champ) BETWEEN 1 AND 120),
  valeur_avant text NOT NULL CHECK (length(valeur_avant) <= 500),
  valeur_apres text NOT NULL CHECK (length(valeur_apres) <= 500),
  motif text NOT NULL CHECK (length(motif) BETWEEN 10 AND 1000),
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES dd_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX dd_ajustements_dossier_idx ON dd_ajustements (cabinet_id, dossier_id, numero DESC);
ALTER TABLE dd_ajustements ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_ajustements
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dd_ajustements AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dd_ajustements FROM missionpilot_app;
CREATE TRIGGER dd_ajustements_ajout_seul BEFORE UPDATE OR DELETE ON dd_ajustements
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();
CREATE TRIGGER dd_ajustements_auteur_sans_portail BEFORE INSERT ON dd_ajustements
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('auteur_id');

-- La cible existe, du type annoncé, dans le dossier (MPZ22).
CREATE FUNCTION controler_dd_ajustement() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_existe boolean;
  BEGIN
    v_existe := CASE NEW.cible_type
      WHEN 'verdict' THEN EXISTS (SELECT 1 FROM dd_verdicts v
        WHERE v.id = NEW.cible_id AND v.dossier_id = NEW.dossier_id)
      WHEN 'risque' THEN EXISTS (SELECT 1 FROM dd_elements e
        WHERE e.id = NEW.cible_id AND e.dossier_id = NEW.dossier_id AND e.type = 'risque')
      WHEN 'dimensionnement' THEN EXISTS (SELECT 1 FROM dd_dimensionnements m
        WHERE m.id = NEW.cible_id AND m.dossier_id = NEW.dossier_id)
      ELSE false
    END;
    IF NOT v_existe THEN
      RAISE EXCEPTION 'La cible de l''ajustement n''existe pas dans ce dossier.'
        USING ERRCODE = 'MPZ22';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER dd_ajustements_controle BEFORE INSERT ON dd_ajustements
  FOR EACH ROW EXECUTE FUNCTION controler_dd_ajustement();
