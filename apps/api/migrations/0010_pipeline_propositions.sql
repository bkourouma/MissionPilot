-- Pipeline commercial (MIS-04) et propositions techniques et financières (MIS-05).
-- Montants en entiers d'unités mineures de la devise indiquée.

CREATE TABLE opportunites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  intitule text NOT NULL CHECK (length(intitule) BETWEEN 1 AND 200),
  type_mission_id uuid,
  montant_estime bigint NOT NULL DEFAULT 0 CHECK (montant_estime >= 0),
  devise text NOT NULL DEFAULT 'XOF' CHECK (devise IN ('XOF', 'XAF', 'EUR', 'USD')),
  probabilite smallint NOT NULL DEFAULT 50 CHECK (probabilite BETWEEN 0 AND 100),
  etape text NOT NULL DEFAULT 'prospection'
    CHECK (etape IN ('prospection', 'qualification', 'proposition', 'negociation')),
  statut text NOT NULL DEFAULT 'ouverte' CHECK (statut IN ('ouverte', 'gagnee', 'perdue')),
  motif_perte text CHECK (motif_perte IS NULL OR length(motif_perte) <= 1000),
  responsable_id uuid,
  date_cloture_prevue date,
  cloturee_le timestamptz,
  cree_par uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  -- Une opportunité perdue porte toujours son motif ; une autre n'en a pas.
  CHECK ((statut = 'perdue') = (motif_perte IS NOT NULL AND length(btrim(motif_perte)) > 0)),
  CHECK ((statut = 'ouverte') = (cloturee_le IS NULL)),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, type_mission_id) REFERENCES types_mission (cabinet_id, id),
  FOREIGN KEY (cabinet_id, responsable_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX opportunites_statut_idx ON opportunites (cabinet_id, statut, etape);
ALTER TABLE opportunites ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON opportunites
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

-- Une proposition est une version numérotée par opportunité. Une fois validée,
-- elle est figée : seul son statut avance (envoyée, acceptée, refusée).
CREATE TABLE propositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  opportunite_id uuid NOT NULL,
  type_mission_id uuid NOT NULL,
  numero int NOT NULL CHECK (numero >= 1),
  intitule text NOT NULL CHECK (length(intitule) BETWEEN 1 AND 200),
  devise text NOT NULL CHECK (devise IN ('XOF', 'XAF', 'EUR', 'USD')),
  date_reference date NOT NULL,
  equipe jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(equipe) = 'array'),
  statut text NOT NULL DEFAULT 'brouillon'
    CHECK (statut IN ('brouillon', 'a_valider', 'validee', 'envoyee', 'acceptee', 'refusee')),
  validee_par uuid,
  validee_le timestamptz,
  envoyee_le timestamptz,
  repondue_le timestamptz,
  cree_par uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((statut IN ('validee', 'envoyee', 'acceptee', 'refusee')) = (validee_par IS NOT NULL)),
  UNIQUE (cabinet_id, id),
  UNIQUE (opportunite_id, numero),
  FOREIGN KEY (cabinet_id, opportunite_id) REFERENCES opportunites (cabinet_id, id),
  FOREIGN KEY (cabinet_id, type_mission_id) REFERENCES types_mission (cabinet_id, id),
  FOREIGN KEY (cabinet_id, validee_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE propositions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON propositions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON propositions FROM missionpilot_app;

-- Découpage copié du modèle : 1 = phase, 2 = lot, 3 = tâche.
CREATE TABLE proposition_elements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  proposition_id uuid NOT NULL,
  parent_id uuid,
  niveau smallint NOT NULL CHECK (niveau BETWEEN 1 AND 3),
  libelle text NOT NULL CHECK (length(libelle) BETWEEN 1 AND 200),
  ordre int NOT NULL DEFAULT 0,
  est_livrable boolean NOT NULL DEFAULT false,
  est_jalon boolean NOT NULL DEFAULT false,
  CHECK ((niveau = 1) = (parent_id IS NULL)),
  UNIQUE (cabinet_id, proposition_id, id),
  FOREIGN KEY (cabinet_id, proposition_id) REFERENCES propositions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, proposition_id, parent_id)
    REFERENCES proposition_elements (cabinet_id, proposition_id, id) ON DELETE CASCADE
);
CREATE INDEX proposition_elements_idx ON proposition_elements (proposition_id, niveau, ordre);
ALTER TABLE proposition_elements ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON proposition_elements
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

-- Jours par grade d'un élément.
CREATE TABLE proposition_lignes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  proposition_id uuid NOT NULL,
  element_id uuid NOT NULL,
  grade_id uuid NOT NULL,
  jours numeric(8, 2) NOT NULL CHECK (jours >= 0),
  UNIQUE (element_id, grade_id),
  FOREIGN KEY (cabinet_id, proposition_id, element_id)
    REFERENCES proposition_elements (cabinet_id, proposition_id, id) ON DELETE CASCADE,
  FOREIGN KEY (cabinet_id, grade_id) REFERENCES grades (cabinet_id, id)
);
ALTER TABLE proposition_lignes ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON proposition_lignes
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

-- Taux de vente journalier par grade retenu dans la proposition (null : à renseigner).
CREATE TABLE proposition_taux (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  proposition_id uuid NOT NULL,
  grade_id uuid NOT NULL,
  taux_journalier bigint CHECK (taux_journalier >= 0),
  UNIQUE (proposition_id, grade_id),
  FOREIGN KEY (cabinet_id, proposition_id) REFERENCES propositions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, grade_id) REFERENCES grades (cabinet_id, id)
);
ALTER TABLE proposition_taux ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON proposition_taux
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

-- Proposition figée (validée ou au-delà) : contenu immuable, en base.
-- SECURITY DEFINER : le contrôle ne dépend pas de la visibilité RLS de l'appelant.
CREATE FUNCTION proposition_est_figee(p_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT coalesce((SELECT statut IN ('validee', 'envoyee', 'acceptee', 'refusee')
                         FROM propositions WHERE id = p_id), false) $$;

CREATE FUNCTION refuser_contenu_proposition_figee() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_proposition uuid;
  BEGIN
    IF TG_OP = 'DELETE' THEN v_proposition := OLD.proposition_id;
    ELSE v_proposition := NEW.proposition_id;
    END IF;
    IF proposition_est_figee(v_proposition)
       OR (TG_OP = 'UPDATE' AND proposition_est_figee(OLD.proposition_id)) THEN
      RAISE EXCEPTION 'Proposition figée : contenu non modifiable.' USING ERRCODE = 'MPF02';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER proposition_elements_figee BEFORE INSERT OR UPDATE OR DELETE ON proposition_elements
  FOR EACH ROW EXECUTE FUNCTION refuser_contenu_proposition_figee();
CREATE TRIGGER proposition_lignes_figee BEFORE INSERT OR UPDATE OR DELETE ON proposition_lignes
  FOR EACH ROW EXECUTE FUNCTION refuser_contenu_proposition_figee();
CREATE TRIGGER proposition_taux_figee BEFORE INSERT OR UPDATE OR DELETE ON proposition_taux
  FOR EACH ROW EXECUTE FUNCTION refuser_contenu_proposition_figee();

-- Sur la proposition elle-même : une fois figée, seuls le statut (vers l'avant)
-- et ses dates de suivi changent.
CREATE FUNCTION refuser_modification_proposition_figee() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_suivi text[] := ARRAY['statut', 'envoyee_le', 'repondue_le', 'modifie_le'];
  BEGIN
    IF OLD.statut IN ('validee', 'envoyee', 'acceptee', 'refusee') THEN
      IF NEW.statut IN ('brouillon', 'a_valider')
         OR (to_jsonb(NEW) - v_suivi) IS DISTINCT FROM (to_jsonb(OLD) - v_suivi) THEN
        RAISE EXCEPTION 'Proposition figée : contenu non modifiable.' USING ERRCODE = 'MPF02';
      END IF;
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER propositions_figee BEFORE UPDATE ON propositions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_proposition_figee();

REVOKE ALL ON FUNCTION proposition_est_figee(uuid) FROM PUBLIC;
