-- Planification (PLN-04 à PLN-10) et notifications in-app (SOC-08).
-- Toute table porte cabinet_id, RLS (politique `isolation`) et des clés
-- étrangères composites (cabinet_id, id) : une référence reste dans le cabinet.

-- Affectations (PLN-04) : nominative (collaborateur) OU profil à pourvoir
-- (grade, compétence facultative). Jours alloués au centième ; le pas de saisie
-- du cabinet est vérifié par l'API. Le grade d'une affectation nominative est
-- celui du collaborateur (grade_id reste NULL).
CREATE TABLE affectations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  tache_id uuid NOT NULL,
  collaborateur_id uuid,
  grade_id uuid,
  competence text CHECK (competence IS NULL OR length(competence) BETWEEN 1 AND 80),
  jours_alloues numeric(8, 2) NOT NULL CHECK (jours_alloues > 0),
  date_debut date NOT NULL,
  date_fin date NOT NULL,
  cree_par uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  CHECK (date_fin >= date_debut),
  CHECK ((collaborateur_id IS NULL) = (grade_id IS NOT NULL)),
  CHECK (collaborateur_id IS NULL OR competence IS NULL),
  UNIQUE (cabinet_id, id),
  -- La tâche appartient à la mission (clé composite) ; supprimer la tâche
  -- supprime ses affectations (planification, pas historique).
  FOREIGN KEY (cabinet_id, mission_id, tache_id)
    REFERENCES mission_taches (cabinet_id, mission_id, id) ON DELETE CASCADE,
  FOREIGN KEY (cabinet_id, collaborateur_id) REFERENCES collaborateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, grade_id) REFERENCES grades (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX affectations_mission_idx ON affectations (mission_id, tache_id);
CREATE INDEX affectations_charge_idx ON affectations (cabinet_id, collaborateur_id, date_debut, date_fin)
  WHERE collaborateur_id IS NOT NULL;
ALTER TABLE affectations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON affectations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

-- Congés et absences (PLN-07). Circuit : demandee → validee | refusee (motif
-- obligatoire) ; demandee | validee → annulee (par le demandeur, avant le début).
-- Historique intact : pas de suppression, et un déclencheur fige tout sauf le
-- statut et la décision.
CREATE TABLE absences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  collaborateur_id uuid NOT NULL,
  demandeur_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('conge_paye', 'maladie', 'formation', 'autre')),
  date_debut date NOT NULL,
  date_fin date NOT NULL,
  commentaire text CHECK (commentaire IS NULL OR length(commentaire) <= 500),
  statut text NOT NULL DEFAULT 'demandee'
    CHECK (statut IN ('demandee', 'validee', 'refusee', 'annulee')),
  motif_refus text CHECK (motif_refus IS NULL OR length(motif_refus) <= 500),
  decide_par uuid,
  decide_le timestamptz,
  annulee_le timestamptz,
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK (date_fin >= date_debut),
  CHECK (statut <> 'refusee' OR (motif_refus IS NOT NULL AND length(btrim(motif_refus)) > 0)),
  CHECK (statut NOT IN ('validee', 'refusee') OR (decide_par IS NOT NULL AND decide_le IS NOT NULL)),
  CHECK ((statut = 'annulee') = (annulee_le IS NOT NULL)),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, collaborateur_id) REFERENCES collaborateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, demandeur_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, decide_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX absences_collaborateur_idx ON absences (cabinet_id, collaborateur_id, date_debut, date_fin);
CREATE INDEX absences_tri_idx ON absences (cabinet_id, date_debut DESC, id);
ALTER TABLE absences ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON absences
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON absences FROM missionpilot_app;

CREATE FUNCTION refuser_modification_absence() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF (NEW.cabinet_id, NEW.collaborateur_id, NEW.demandeur_id, NEW.type, NEW.date_debut,
        NEW.date_fin, NEW.commentaire, NEW.cree_le)
       IS DISTINCT FROM
       (OLD.cabinet_id, OLD.collaborateur_id, OLD.demandeur_id, OLD.type, OLD.date_debut,
        OLD.date_fin, OLD.commentaire, OLD.cree_le) THEN
      RAISE EXCEPTION 'Une absence enregistrée ne change que de statut.' USING ERRCODE = 'MPF03';
    END IF;
    IF NEW.statut IS DISTINCT FROM OLD.statut AND NOT (
         (OLD.statut = 'demandee' AND NEW.statut IN ('validee', 'refusee', 'annulee'))
      OR (OLD.statut = 'validee' AND NEW.statut = 'annulee')) THEN
      RAISE EXCEPTION 'Transition de statut d''absence refusée.' USING ERRCODE = 'MPF03';
    END IF;
    IF OLD.statut IN ('refusee', 'annulee') THEN
      RAISE EXCEPTION 'Absence refusée ou annulée : plus aucune modification.' USING ERRCODE = 'MPF03';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER absences_figees BEFORE UPDATE ON absences
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_absence();

-- Notifications in-app (SOC-08) : texte brut, lien relatif interne. Le rôle
-- applicatif ne peut que créer, lire et marquer comme lue (colonne lue_le).
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  destinataire_id uuid NOT NULL,
  type text NOT NULL CHECK (type ~ '^[a-z_]{1,60}$'),
  titre text NOT NULL CHECK (length(titre) BETWEEN 1 AND 200),
  corps text NOT NULL DEFAULT '' CHECK (length(corps) <= 2000),
  lien text CHECK (lien IS NULL OR (lien ~ '^/[A-Za-z0-9._~/?=&%#-]*$' AND lien !~ '^//'
                                    AND length(lien) <= 300)),
  lue_le timestamptz,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, destinataire_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX notifications_destinataire_idx
  ON notifications (cabinet_id, destinataire_id, (lue_le IS NOT NULL), cree_le DESC);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON notifications
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON notifications FROM missionpilot_app;
GRANT UPDATE (lue_le) ON notifications TO missionpilot_app;

-- Jours fériés pré-remplis par défaut (SOC-04) : valeurs à faire valider par le cabinet.
ALTER TABLE cabinet_feries ADD COLUMN a_valider boolean NOT NULL DEFAULT false;
