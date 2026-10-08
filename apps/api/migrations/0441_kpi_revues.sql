-- Revue de performance ritualisée (KPI-17, PRD complémentaire §11.4).
--
-- - kpi_revues                    : une revue d'une mission. Cycle : planifiée (ordre du
--   jour généré par le moteur et éditable) → tenue (le dossier est FIGÉ à cet instant :
--   ce qui a été examiné) → clôturée (toutes les décisions et actions liées sont
--   terminées ou abandonnées) ; ou annulée tant qu'elle n'est pas tenue. L'ordre du jour,
--   la date d'arrêté et le dossier ne changent plus une fois la revue tenue.
-- - kpi_revue_decisions           : décisions prises en revue (responsable, échéance),
--   suivies jusqu'à leur exécution ou leur abandon motivé.
-- - kpi_revue_decision_evenements : historique des décisions, en AJOUT SEUL.
--
-- Aucun calcul ici : l'ordre du jour sort de packages/engines/src/kpi/revue.ts, le
-- dossier du tableau de bord (moteur KPI). Codes SQLSTATE : voir 0440 (MPK10-16) ;
--   MPK20 revue : statut initial invalide (toute revue naît « planifiée »)
--   MPK21 revue : transition de statut invalide
--   MPK22 revue : contenu figé (ordre du jour, date d'arrêté, dossier après la tenue ;
--         compte rendu après la clôture)
--   MPK23 revue : clôture refusée tant qu'une décision ou une action liée est ouverte
--   MPK24 décision : seulement dans une revue tenue
--   MPK25 décision : transition invalide (un état terminal ne se rouvre pas)

CREATE TABLE kpi_revues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  -- Numérotée par mission (déclencheur), à partir de 1.
  numero int NOT NULL,
  titre text NOT NULL CHECK (length(titre) BETWEEN 1 AND 200),
  date_prevue date NOT NULL CHECK (date_prevue BETWEEN '2000-01-01' AND '2100-12-31'),
  -- Date d'arrêté des KPI examinés.
  date_reference date NOT NULL CHECK (date_reference BETWEEN '2000-01-01' AND '2100-12-31'),
  statut text NOT NULL DEFAULT 'planifiee'
    CHECK (statut IN ('planifiee', 'tenue', 'cloturee', 'annulee')),
  animateur_id uuid,
  ordre_du_jour jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(ordre_du_jour) = 'array' AND jsonb_array_length(ordre_du_jour) <= 40),
  -- Dossier figé à la tenue (modèle de rapport rapports/modele.ts).
  dossier jsonb CHECK (dossier IS NULL OR jsonb_typeof(dossier) = 'object'),
  compte_rendu text CHECK (compte_rendu IS NULL OR length(compte_rendu) <= 8000),
  tenue_le timestamptz,
  tenue_par uuid,
  cloturee_le timestamptz,
  cloturee_par uuid,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_par uuid,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, mission_id, numero),
  CHECK ((statut IN ('tenue', 'cloturee')) = (dossier IS NOT NULL AND tenue_le IS NOT NULL)),
  CHECK ((statut = 'cloturee') = (cloturee_le IS NOT NULL)),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, animateur_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, tenue_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cloturee_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX kpi_revues_mission_idx ON kpi_revues (cabinet_id, mission_id, date_prevue DESC, id);
ALTER TABLE kpi_revues ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON kpi_revues
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON kpi_revues AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON kpi_revues FROM missionpilot_app;
CREATE TRIGGER kpi_revues_animateur_sans_portail
  BEFORE INSERT OR UPDATE OF animateur_id ON kpi_revues
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('animateur_id');

CREATE TABLE kpi_revue_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  revue_id uuid NOT NULL,
  -- Numérotée par revue (déclencheur), à partir de 1.
  numero int NOT NULL,
  libelle text NOT NULL CHECK (length(libelle) BETWEEN 1 AND 500),
  kpi_id uuid,
  responsable_id uuid,
  echeance date CHECK (echeance IS NULL OR echeance BETWEEN '2000-01-01' AND '2100-12-31'),
  statut text NOT NULL DEFAULT 'ouverte'
    CHECK (statut IN ('ouverte', 'en_cours', 'executee', 'abandonnee')),
  motif text CHECK (motif IS NULL OR length(motif) BETWEEN 1 AND 500),
  cloturee_le timestamptz,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_par uuid,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, revue_id, numero),
  CHECK (statut <> 'abandonnee' OR motif IS NOT NULL),
  CHECK ((statut IN ('executee', 'abandonnee')) = (cloturee_le IS NOT NULL)),
  FOREIGN KEY (cabinet_id, revue_id) REFERENCES kpi_revues (cabinet_id, id),
  FOREIGN KEY (cabinet_id, kpi_id) REFERENCES kpi_definitions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, responsable_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX kpi_revue_decisions_revue_idx ON kpi_revue_decisions (cabinet_id, revue_id, numero);
CREATE INDEX kpi_revue_decisions_ouvertes_idx ON kpi_revue_decisions (cabinet_id, revue_id)
  WHERE statut IN ('ouverte', 'en_cours');
ALTER TABLE kpi_revue_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON kpi_revue_decisions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON kpi_revue_decisions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON kpi_revue_decisions FROM missionpilot_app;
CREATE TRIGGER kpi_revue_decisions_responsable_sans_portail
  BEFORE INSERT OR UPDATE OF responsable_id ON kpi_revue_decisions
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('responsable_id');

-- Contrôles d'une revue. Fonction d'invocateur : la RLS du cabinet s'applique aux lectures.
CREATE FUNCTION controler_kpi_revue() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.statut <> 'planifiee' THEN
        RAISE EXCEPTION 'Une revue naît planifiée.' USING ERRCODE = 'MPK20';
      END IF;
      IF EXISTS (SELECT 1 FROM missions m WHERE m.id = NEW.mission_id AND m.statut = 'cloturee') THEN
        RAISE EXCEPTION 'La mission est clôturée.' USING ERRCODE = 'MPK16';
      END IF;
      SELECT coalesce(max(r.numero), 0) + 1 INTO NEW.numero
        FROM kpi_revues r WHERE r.mission_id = NEW.mission_id;
    ELSE
      IF (NEW.cabinet_id, NEW.mission_id, NEW.numero, NEW.cree_par, NEW.cree_le)
         IS DISTINCT FROM (OLD.cabinet_id, OLD.mission_id, OLD.numero, OLD.cree_par, OLD.cree_le) THEN
        RAISE EXCEPTION 'Mission, numéro et création d''une revue sont figés.' USING ERRCODE = 'MPK11';
      END IF;
      IF NEW.statut IS DISTINCT FROM OLD.statut AND NOT (
           (OLD.statut = 'planifiee' AND NEW.statut IN ('tenue', 'annulee'))
           OR (OLD.statut = 'tenue' AND NEW.statut = 'cloturee')) THEN
        RAISE EXCEPTION 'Transition de revue invalide (% vers %).', OLD.statut, NEW.statut
          USING ERRCODE = 'MPK21';
      END IF;
      -- Figé dès la tenue : ce qui a été examiné ne se réécrit pas.
      IF OLD.statut IN ('tenue', 'cloturee') AND (NEW.ordre_du_jour, NEW.date_reference, NEW.dossier,
           NEW.titre, NEW.date_prevue, NEW.tenue_le, NEW.tenue_par)
         IS DISTINCT FROM (OLD.ordre_du_jour, OLD.date_reference, OLD.dossier,
           OLD.titre, OLD.date_prevue, OLD.tenue_le, OLD.tenue_par) THEN
        RAISE EXCEPTION 'Le contenu d''une revue tenue est figé.' USING ERRCODE = 'MPK22';
      END IF;
      IF OLD.statut = 'cloturee' AND NEW.compte_rendu IS DISTINCT FROM OLD.compte_rendu THEN
        RAISE EXCEPTION 'Le compte rendu d''une revue clôturée est figé.' USING ERRCODE = 'MPK22';
      END IF;
      IF OLD.statut = 'annulee' AND (NEW IS DISTINCT FROM OLD) THEN
        RAISE EXCEPTION 'Une revue annulée ne change plus.' USING ERRCODE = 'MPK21';
      END IF;
      IF OLD.statut = 'tenue' AND NEW.statut = 'cloturee' AND (
           EXISTS (SELECT 1 FROM kpi_revue_decisions d
                   WHERE d.revue_id = NEW.id AND d.statut IN ('ouverte', 'en_cours'))
           OR EXISTS (SELECT 1 FROM kpi_actions a
                      WHERE a.revue_id = NEW.id AND a.statut IN ('a_faire', 'en_cours'))) THEN
        RAISE EXCEPTION 'Des décisions ou des actions de la revue sont encore ouvertes.'
          USING ERRCODE = 'MPK23';
      END IF;
    END IF;
    NEW.modifie_le := now();
    RETURN NEW;
  END $$;
CREATE TRIGGER kpi_revues_controle BEFORE INSERT OR UPDATE ON kpi_revues
  FOR EACH ROW EXECUTE FUNCTION controler_kpi_revue();

-- Contrôles d'une décision : seulement dans une revue tenue, KPI de la mission de la revue,
-- transitions d'état (un état terminal ne se rouvre pas), numérotation par revue.
CREATE FUNCTION controler_kpi_decision() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_revue kpi_revues%ROWTYPE;
  BEGIN
    SELECT * INTO v_revue FROM kpi_revues r WHERE r.id = NEW.revue_id;
    IF NEW.kpi_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM kpi_definitions d WHERE d.id = NEW.kpi_id AND d.mission_id = v_revue.mission_id) THEN
      RAISE EXCEPTION 'Le KPI de la décision n''appartient pas à la mission de la revue.'
        USING ERRCODE = 'MPK10';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF v_revue.statut IS DISTINCT FROM 'tenue' THEN
        RAISE EXCEPTION 'Une décision se prend dans une revue tenue.' USING ERRCODE = 'MPK24';
      END IF;
      IF NEW.statut <> 'ouverte' THEN
        RAISE EXCEPTION 'Une décision naît ouverte.' USING ERRCODE = 'MPK25';
      END IF;
      SELECT coalesce(max(d.numero), 0) + 1 INTO NEW.numero
        FROM kpi_revue_decisions d WHERE d.revue_id = NEW.revue_id;
    ELSE
      IF (NEW.cabinet_id, NEW.revue_id, NEW.numero, NEW.cree_par, NEW.cree_le)
         IS DISTINCT FROM (OLD.cabinet_id, OLD.revue_id, OLD.numero, OLD.cree_par, OLD.cree_le) THEN
        RAISE EXCEPTION 'Revue, numéro et création d''une décision sont figés.' USING ERRCODE = 'MPK11';
      END IF;
      IF OLD.statut IN ('executee', 'abandonnee') AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION 'Une décision exécutée ou abandonnée ne se rouvre pas.' USING ERRCODE = 'MPK25';
      END IF;
      IF NEW.statut IS DISTINCT FROM OLD.statut AND NOT (
           (OLD.statut = 'ouverte' AND NEW.statut IN ('en_cours', 'executee', 'abandonnee'))
           OR (OLD.statut = 'en_cours' AND NEW.statut IN ('executee', 'abandonnee'))) THEN
        RAISE EXCEPTION 'Transition de décision invalide (% vers %).', OLD.statut, NEW.statut
          USING ERRCODE = 'MPK25';
      END IF;
      IF v_revue.statut = 'cloturee' THEN
        RAISE EXCEPTION 'La revue est clôturée.' USING ERRCODE = 'MPK24';
      END IF;
    END IF;
    NEW.modifie_le := now();
    RETURN NEW;
  END $$;
CREATE TRIGGER kpi_revue_decisions_controle BEFORE INSERT OR UPDATE ON kpi_revue_decisions
  FOR EACH ROW EXECUTE FUNCTION controler_kpi_decision();

CREATE TABLE kpi_revue_decision_evenements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  decision_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('creation', 'statut', 'modification')),
  statut_avant text,
  statut_apres text NOT NULL,
  commentaire text CHECK (commentaire IS NULL OR length(commentaire) BETWEEN 1 AND 1000),
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, decision_id) REFERENCES kpi_revue_decisions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX kpi_revue_decision_evenements_idx
  ON kpi_revue_decision_evenements (cabinet_id, decision_id, cree_le, id);
ALTER TABLE kpi_revue_decision_evenements ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON kpi_revue_decision_evenements
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON kpi_revue_decision_evenements AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON kpi_revue_decision_evenements FROM missionpilot_app;
CREATE TRIGGER kpi_revue_decision_evenements_ajout_seul
  BEFORE UPDATE OR DELETE ON kpi_revue_decision_evenements
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_kpi();
