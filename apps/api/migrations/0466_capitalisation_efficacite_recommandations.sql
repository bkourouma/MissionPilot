-- Capitalisation (lot CAP, lot 5b) — efficacité des recommandations (CAP-03), recommandations.
--
-- Initiative recommandée -> mise en oeuvre -> effet mesuré sur les KPI -> score d'efficacité par
-- contexte (PRD complémentaire §12, CAP-03). Tables et moteur PROPRES à la capitalisation : les
-- plans stratégiques (0180) et les KPI (0160) ne sont que LUS (clés étrangères, contrôles).
--
-- SQLSTATE du domaine (préfixe MQK, plage MQK01–MQK19 de ce lot) :
--   MQK01 historique et instantanés d'efficacité en ajout seul ;
--   MQK02 cohérence (KPI de la mission, initiative du plan de la mission) ;
--   MQK03 identité de la recommandation figée (seuls le statut et la date de mise en oeuvre
--         évoluent) ;
--   MQK04 transition de statut interdite (recommandee -> mise_en_oeuvre | abandonnee, états
--         terminaux) ou date de mise en oeuvre future ;
--   MQK05 instantané d'efficacité sur une recommandation non mise en oeuvre.
--
-- Une recommandation par (mission, KPI observé) ; secteur et taille sont COPIÉS du client à la
-- création (le contexte ne bouge plus ensuite). `valeur_cible` est l'effet attendu sur le KPI.
-- Aucun contenu IA : tout chiffre vient du moteur (packages/engines/src/capitalisation/efficacite.ts).

CREATE FUNCTION cap_efficacite_ajout_seul() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Historique d''efficacité des recommandations en ajout seul.'
      USING ERRCODE = 'MQK01';
  END $$;

CREATE TABLE cap_recommandations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  kpi_id uuid NOT NULL,
  plan_initiative_id uuid,
  libelle text NOT NULL CHECK (length(btrim(libelle)) BETWEEN 1 AND 200 AND libelle !~ '[[:cntrl:]]'),
  type_initiative text NOT NULL
    CHECK (length(btrim(type_initiative)) BETWEEN 1 AND 80 AND type_initiative !~ '[[:cntrl:]]'),
  secteur text CHECK (secteur IS NULL OR length(secteur) BETWEEN 1 AND 120),
  taille text CHECK (taille IS NULL OR taille IN ('tpe', 'pme', 'eti', 'grande_entreprise')),
  valeur_cible numeric NOT NULL CHECK (abs(valeur_cible) < 1e15 AND scale(valeur_cible) <= 6),
  statut text NOT NULL DEFAULT 'recommandee'
    CHECK (statut IN ('recommandee', 'mise_en_oeuvre', 'abandonnee')),
  mise_en_oeuvre_le date CHECK (mise_en_oeuvre_le BETWEEN '2000-01-01' AND '2100-12-31'),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, mission_id, kpi_id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, kpi_id) REFERENCES kpi_definitions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, plan_initiative_id) REFERENCES plan_elements (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  CHECK ((statut = 'mise_en_oeuvre') = (mise_en_oeuvre_le IS NOT NULL))
);
CREATE INDEX cap_recommandations_tri_idx ON cap_recommandations (cabinet_id, cree_le DESC, id DESC);
CREATE INDEX cap_recommandations_mission_idx ON cap_recommandations (cabinet_id, mission_id);
ALTER TABLE cap_recommandations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON cap_recommandations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON cap_recommandations AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON cap_recommandations FROM missionpilot_app;
GRANT UPDATE (statut, mise_en_oeuvre_le) ON cap_recommandations TO missionpilot_app;

CREATE FUNCTION controler_cap_recommandation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_kpi_mission uuid;
  BEGIN
    IF TG_OP = 'INSERT' THEN
      SELECT d.mission_id INTO v_kpi_mission FROM kpi_definitions d WHERE d.id = NEW.kpi_id;
      IF v_kpi_mission IS DISTINCT FROM NEW.mission_id THEN
        RAISE EXCEPTION 'Le KPI doit appartenir à la mission de la recommandation.'
          USING ERRCODE = 'MQK02';
      END IF;
      IF NEW.plan_initiative_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM plan_elements e JOIN plans_strategiques p ON p.id = e.plan_id
           WHERE e.id = NEW.plan_initiative_id AND e.type = 'initiative'
             AND p.mission_id = NEW.mission_id) THEN
        RAISE EXCEPTION 'L''initiative doit appartenir au plan stratégique de la mission.'
          USING ERRCODE = 'MQK02';
      END IF;
      IF NEW.statut <> 'recommandee' THEN
        RAISE EXCEPTION 'Une recommandation naît au statut « recommandee ».' USING ERRCODE = 'MQK04';
      END IF;
      RETURN NEW;
    END IF;
    IF (NEW.cabinet_id, NEW.mission_id, NEW.kpi_id, NEW.plan_initiative_id, NEW.libelle,
        NEW.type_initiative, NEW.secteur, NEW.taille, NEW.valeur_cible, NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.mission_id, OLD.kpi_id, OLD.plan_initiative_id,
        OLD.libelle, OLD.type_initiative, OLD.secteur, OLD.taille, OLD.valeur_cible, OLD.cree_par,
        OLD.cree_le) THEN
      RAISE EXCEPTION 'L''identité d''une recommandation est figée.' USING ERRCODE = 'MQK03';
    END IF;
    IF OLD.statut <> 'recommandee' THEN
      RAISE EXCEPTION 'La recommandation est dans un état terminal.' USING ERRCODE = 'MQK04';
    END IF;
    IF NEW.statut = 'recommandee' THEN
      RAISE EXCEPTION 'Le statut doit changer (mise en oeuvre ou abandon).' USING ERRCODE = 'MQK04';
    END IF;
    IF NEW.statut = 'mise_en_oeuvre' AND NEW.mise_en_oeuvre_le > current_date THEN
      RAISE EXCEPTION 'La date de mise en oeuvre ne peut pas être future.' USING ERRCODE = 'MQK04';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER cap_recommandations_controle BEFORE INSERT OR UPDATE ON cap_recommandations
  FOR EACH ROW EXECUTE FUNCTION controler_cap_recommandation();
CREATE TRIGGER cap_recommandations_sans_suppression BEFORE DELETE ON cap_recommandations
  FOR EACH ROW EXECUTE FUNCTION cap_efficacite_ajout_seul();

-- Historique des changements de statut, en ajout seul.
CREATE TABLE cap_recommandation_statuts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  recommandation_id uuid NOT NULL,
  statut text NOT NULL CHECK (statut IN ('recommandee', 'mise_en_oeuvre', 'abandonnee')),
  mise_en_oeuvre_le date,
  motif text CHECK (motif IS NULL OR length(btrim(motif)) BETWEEN 1 AND 500),
  par uuid NOT NULL,
  le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, recommandation_id) REFERENCES cap_recommandations (cabinet_id, id),
  FOREIGN KEY (cabinet_id, par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX cap_recommandation_statuts_idx
  ON cap_recommandation_statuts (cabinet_id, recommandation_id, le, id);
ALTER TABLE cap_recommandation_statuts ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON cap_recommandation_statuts
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON cap_recommandation_statuts AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON cap_recommandation_statuts FROM missionpilot_app;
CREATE TRIGGER cap_recommandation_statuts_ajout_seul
  BEFORE UPDATE OR DELETE ON cap_recommandation_statuts
  FOR EACH ROW EXECUTE FUNCTION cap_efficacite_ajout_seul();
