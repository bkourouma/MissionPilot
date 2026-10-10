-- Registre des actions correctives (KPI-18, PRD complémentaire §11.4).
--
-- - kpi_actions            : action corrective sur un KPI, éventuellement rattachée à
--   l'alerte qui l'a déclenchée (`kpi_alertes`, 0160) et à la décision de revue qui
--   l'a décidée (`kpi_revue_decisions`, 0441). Responsable, échéance et statut ; une
--   action « terminée » porte sa date d'effet (le jour dès lequel l'effet est mesuré).
-- - kpi_action_evenements  : historique des actions, en AJOUT SEUL (création, changement
--   de statut, modification, commentaire).
--
-- L'EFFICACITÉ n'est pas stockée : elle est recalculée à chaque lecture par le moteur
-- (packages/engines/src/kpi/efficacite.ts : variation avant/après sur les périodes
-- closes) ; elle ne peut donc pas diverger des mesures ni être saisie à la main.
-- Codes SQLSTATE : voir 0440 (MPK10-16) ;
--   MPK26 action : transition de statut invalide (un état terminal ne se rouvre pas)

CREATE TABLE kpi_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  kpi_id uuid NOT NULL,
  alerte_id uuid,
  revue_id uuid,
  decision_id uuid,
  -- Numérotée par mission (déclencheur), à partir de 1.
  numero int NOT NULL,
  titre text NOT NULL CHECK (length(titre) BETWEEN 1 AND 200),
  description text CHECK (description IS NULL OR length(description) <= 2000),
  responsable_id uuid NOT NULL,
  echeance date NOT NULL CHECK (echeance BETWEEN '2000-01-01' AND '2100-12-31'),
  statut text NOT NULL DEFAULT 'a_faire'
    CHECK (statut IN ('a_faire', 'en_cours', 'terminee', 'abandonnee')),
  -- Jour dès lequel l'effet de l'action est mesuré ; obligatoire (et seulement) si terminée.
  date_effet date CHECK (date_effet IS NULL OR date_effet BETWEEN '2000-01-01' AND '2100-12-31'),
  motif text CHECK (motif IS NULL OR length(motif) BETWEEN 1 AND 500),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_par uuid,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, mission_id, numero),
  CHECK ((statut = 'terminee') = (date_effet IS NOT NULL)),
  CHECK (statut <> 'abandonnee' OR motif IS NOT NULL),
  -- Une décision implique sa revue.
  CHECK (decision_id IS NULL OR revue_id IS NOT NULL),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, kpi_id) REFERENCES kpi_definitions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, alerte_id) REFERENCES kpi_alertes (cabinet_id, id),
  FOREIGN KEY (cabinet_id, revue_id) REFERENCES kpi_revues (cabinet_id, id),
  FOREIGN KEY (cabinet_id, decision_id) REFERENCES kpi_revue_decisions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, responsable_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX kpi_actions_mission_idx ON kpi_actions (cabinet_id, mission_id, echeance, id);
CREATE INDEX kpi_actions_kpi_idx ON kpi_actions (cabinet_id, kpi_id, echeance, id);
CREATE INDEX kpi_actions_alerte_idx ON kpi_actions (cabinet_id, alerte_id) WHERE alerte_id IS NOT NULL;
CREATE INDEX kpi_actions_revue_idx ON kpi_actions (cabinet_id, revue_id) WHERE revue_id IS NOT NULL;
CREATE INDEX kpi_actions_ouvertes_idx ON kpi_actions (cabinet_id, echeance)
  WHERE statut IN ('a_faire', 'en_cours');
ALTER TABLE kpi_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON kpi_actions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON kpi_actions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON kpi_actions FROM missionpilot_app;
CREATE TRIGGER kpi_actions_responsable_sans_portail
  BEFORE INSERT OR UPDATE OF responsable_id ON kpi_actions
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('responsable_id');

-- Rattachements (KPI, alerte, revue, décision de la même mission), transitions, numérotation.
-- Fonction d'invocateur : la RLS du cabinet s'applique aux lectures.
CREATE FUNCTION controler_kpi_action() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NOT EXISTS (SELECT 1 FROM kpi_definitions d
                     WHERE d.id = NEW.kpi_id AND d.mission_id = NEW.mission_id) THEN
        RAISE EXCEPTION 'Le KPI de l''action n''appartient pas à sa mission.' USING ERRCODE = 'MPK10';
      END IF;
      IF NEW.alerte_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM kpi_alertes a WHERE a.id = NEW.alerte_id AND a.kpi_id = NEW.kpi_id) THEN
        RAISE EXCEPTION 'L''alerte de l''action concerne un autre KPI.' USING ERRCODE = 'MPK10';
      END IF;
      IF NEW.revue_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM kpi_revues r WHERE r.id = NEW.revue_id AND r.mission_id = NEW.mission_id) THEN
        RAISE EXCEPTION 'La revue de l''action concerne une autre mission.' USING ERRCODE = 'MPK10';
      END IF;
      IF NEW.decision_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM kpi_revue_decisions d WHERE d.id = NEW.decision_id AND d.revue_id = NEW.revue_id) THEN
        RAISE EXCEPTION 'La décision de l''action appartient à une autre revue.' USING ERRCODE = 'MPK10';
      END IF;
      IF EXISTS (SELECT 1 FROM missions m WHERE m.id = NEW.mission_id AND m.statut = 'cloturee') THEN
        RAISE EXCEPTION 'La mission est clôturée.' USING ERRCODE = 'MPK16';
      END IF;
      IF NEW.statut <> 'a_faire' THEN
        RAISE EXCEPTION 'Une action naît à faire.' USING ERRCODE = 'MPK26';
      END IF;
      SELECT coalesce(max(a.numero), 0) + 1 INTO NEW.numero
        FROM kpi_actions a WHERE a.mission_id = NEW.mission_id;
    ELSE
      IF (NEW.cabinet_id, NEW.mission_id, NEW.kpi_id, NEW.alerte_id, NEW.revue_id, NEW.decision_id,
          NEW.numero, NEW.cree_par, NEW.cree_le)
         IS DISTINCT FROM (OLD.cabinet_id, OLD.mission_id, OLD.kpi_id, OLD.alerte_id, OLD.revue_id,
          OLD.decision_id, OLD.numero, OLD.cree_par, OLD.cree_le) THEN
        RAISE EXCEPTION 'Rattachements et création d''une action sont figés.' USING ERRCODE = 'MPK11';
      END IF;
      IF OLD.statut IN ('terminee', 'abandonnee') AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION 'Une action terminée ou abandonnée ne se rouvre pas.' USING ERRCODE = 'MPK26';
      END IF;
      IF NEW.statut IS DISTINCT FROM OLD.statut AND NOT (
           (OLD.statut = 'a_faire' AND NEW.statut IN ('en_cours', 'terminee', 'abandonnee'))
           OR (OLD.statut = 'en_cours' AND NEW.statut IN ('terminee', 'abandonnee'))) THEN
        RAISE EXCEPTION 'Transition d''action invalide (% vers %).', OLD.statut, NEW.statut
          USING ERRCODE = 'MPK26';
      END IF;
    END IF;
    NEW.modifie_le := now();
    RETURN NEW;
  END $$;
CREATE TRIGGER kpi_actions_controle BEFORE INSERT OR UPDATE ON kpi_actions
  FOR EACH ROW EXECUTE FUNCTION controler_kpi_action();

CREATE TABLE kpi_action_evenements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  action_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('creation', 'statut', 'modification', 'commentaire')),
  statut_avant text,
  statut_apres text NOT NULL,
  commentaire text CHECK (commentaire IS NULL OR length(commentaire) BETWEEN 1 AND 1000),
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, action_id) REFERENCES kpi_actions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX kpi_action_evenements_idx ON kpi_action_evenements (cabinet_id, action_id, cree_le, id);
ALTER TABLE kpi_action_evenements ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON kpi_action_evenements
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON kpi_action_evenements AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON kpi_action_evenements FROM missionpilot_app;
CREATE TRIGGER kpi_action_evenements_ajout_seul BEFORE UPDATE OR DELETE ON kpi_action_evenements
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_kpi();
