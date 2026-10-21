-- Revue à froid (QUA-05) : évaluations de la grille et constats.
--
-- Une ÉVALUATION note un critère de la grille (version 1, huit critères) de 1 à 5, ou le déclare
-- sans objet (note NULL, commentaire obligatoire). Une seule ligne par (échantillon, critère),
-- modifiable tant que la revue n'est pas terminée. Un CONSTAT consigne un écart (gravité,
-- description, recommandation), ajouté et retiré tant que la revue n'est pas terminée, 100 au plus
-- par revue. Les deux sont tenus par le relecteur AFFECTÉ ; une revue terminée est figée (MQQ04).
-- Le score et la conclusion sont calculés par le moteur (`calculerRevueFroide`), jamais par le
-- modèle de langage.

CREATE TABLE qualite_froide_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  echantillon_id uuid NOT NULL,
  critere text NOT NULL CHECK (critere IN ('conformite_methode', 'solidite_preuves',
    'relecture_signature', 'acceptation_independance', 'satisfaction_client', 'budget_delais',
    'dossier_complet', 'usage_ia')),
  note smallint CHECK (note IS NULL OR note BETWEEN 1 AND 5),
  commentaire text CHECK (commentaire IS NULL OR length(btrim(commentaire)) BETWEEN 1 AND 2000),
  evaluateur_id uuid NOT NULL,
  evalue_le timestamptz NOT NULL DEFAULT now(),
  CHECK (note IS NOT NULL OR commentaire IS NOT NULL),
  UNIQUE (cabinet_id, id),
  CONSTRAINT qualite_froide_evaluations_critere_uniq UNIQUE (echantillon_id, critere),
  FOREIGN KEY (cabinet_id, echantillon_id) REFERENCES qualite_froide_echantillon (cabinet_id, id),
  FOREIGN KEY (cabinet_id, evaluateur_id) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE qualite_froide_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON qualite_froide_evaluations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON qualite_froide_evaluations AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON qualite_froide_evaluations FROM missionpilot_app;
GRANT UPDATE (note, commentaire, evaluateur_id, evalue_le) ON qualite_froide_evaluations
  TO missionpilot_app;

-- Revue modifiable : échantillon affecté ou en revue, par le relecteur affecté.
CREATE FUNCTION controler_qualite_froide_saisie() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_e record;
    v_auteur uuid;
    v_echantillon uuid;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      v_echantillon := OLD.echantillon_id;
    ELSE
      v_echantillon := NEW.echantillon_id;
    END IF;
    SELECT e.statut, e.relecteur_id INTO v_e FROM qualite_froide_echantillon e WHERE e.id = v_echantillon;
    IF v_e.statut = 'terminee' THEN
      RAISE EXCEPTION 'La revue est terminée : évaluations et constats sont figés.'
        USING ERRCODE = 'MQQ04';
    END IF;
    IF TG_OP = 'DELETE' THEN
      IF TG_TABLE_NAME = 'qualite_froide_evaluations' THEN
        RAISE EXCEPTION 'Une évaluation ne se supprime pas : elle se corrige.' USING ERRCODE = 'MQQ04';
      END IF;
      RETURN OLD;
    END IF;
    IF v_e.statut IS DISTINCT FROM 'affectee' AND v_e.statut IS DISTINCT FROM 'en_revue' THEN
      RAISE EXCEPTION 'La revue n''a pas de relecteur affecté.' USING ERRCODE = 'MQQ11';
    END IF;
    IF TG_TABLE_NAME = 'qualite_froide_evaluations' THEN
      v_auteur := NEW.evaluateur_id;
    ELSE
      v_auteur := NEW.auteur_id;
    END IF;
    IF v_auteur IS DISTINCT FROM v_e.relecteur_id THEN
      RAISE EXCEPTION 'Seul le relecteur affecté tient la grille et les constats.' USING ERRCODE = 'MQQ11';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.echantillon_id IS DISTINCT FROM OLD.echantillon_id
                             OR NEW.critere IS DISTINCT FROM OLD.critere) THEN
      RAISE EXCEPTION 'Le critère d''une évaluation ne change pas.' USING ERRCODE = 'MQQ04';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER qualite_froide_evaluations_controle BEFORE INSERT OR UPDATE OR DELETE
  ON qualite_froide_evaluations
  FOR EACH ROW EXECUTE FUNCTION controler_qualite_froide_saisie();

CREATE TABLE qualite_froide_constats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  echantillon_id uuid NOT NULL,
  critere text CHECK (critere IS NULL OR critere IN ('conformite_methode', 'solidite_preuves',
    'relecture_signature', 'acceptation_independance', 'satisfaction_client', 'budget_delais',
    'dossier_complet', 'usage_ia')),
  gravite text NOT NULL CHECK (gravite IN ('mineur', 'majeur', 'critique')),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 2000),
  recommandation text CHECK (recommandation IS NULL OR length(btrim(recommandation)) BETWEEN 1 AND 2000),
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, echantillon_id) REFERENCES qualite_froide_echantillon (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX qualite_froide_constats_idx ON qualite_froide_constats (cabinet_id, echantillon_id, cree_le, id);
ALTER TABLE qualite_froide_constats ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON qualite_froide_constats
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON qualite_froide_constats AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
-- Retrait permis (tant que la revue n'est pas terminée), aucune modification.
REVOKE UPDATE ON qualite_froide_constats FROM missionpilot_app;

CREATE FUNCTION controler_qualite_froide_constat() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'Un constat ne se modifie pas : retirer puis ajouter.' USING ERRCODE = 'MQQ04';
    END IF;
    IF TG_OP = 'INSERT'
       AND (SELECT count(*) FROM qualite_froide_constats c WHERE c.echantillon_id = NEW.echantillon_id) >= 100 THEN
      RAISE EXCEPTION 'Une revue porte 100 constats au plus.' USING ERRCODE = 'MQQ09';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END $$;
-- Le plafond se contrôle avant la règle d'état (même corps de déclencheur sur la saisie).
CREATE TRIGGER qualite_froide_constats_a_plafond BEFORE INSERT OR UPDATE OR DELETE ON qualite_froide_constats
  FOR EACH ROW EXECUTE FUNCTION controler_qualite_froide_constat();
CREATE TRIGGER qualite_froide_constats_controle BEFORE INSERT OR UPDATE OR DELETE ON qualite_froide_constats
  FOR EACH ROW EXECUTE FUNCTION controler_qualite_froide_saisie();
