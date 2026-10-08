-- Agents IA : corrections d'audit des évaluations de non-régression (AGT-04).
--
-- 1. FOURNISSEUR d'une évaluation et production. Une évaluation réussie sur le
--    fournisseur LOCAL déterministe (ia/evaluation.ts, écho des messages rendus)
--    prouve le câblage du prompt (variables, consignes, schéma, garde-chiffres),
--    pas la qualité d'un modèle. Elle ne suffit donc à activer une version de
--    prompt, à choisir un modèle ou à exécuter un agent que si la transaction
--    l'admet explicitement : réglage `app.evaluation_locale_admise = 'on'`, posé
--    par l'API hors production seulement (NODE_ENV de développement ou de test,
--    `reglerEvaluationLocale`). Sans ce réglage (production, accès direct), seule
--    une évaluation `fournisseur = 'openrouter'` compte. Défaut sûr : réglage
--    absent → strict.
-- 2. EXÉCUTION D'AGENT sous non-régression : une exécution d'agent (trace
--    agents_executions) n'existe que pour une version de prompt qui a réussi le
--    DERNIER jeu d'essai de son nom (règle du fournisseur ci-dessus). Un prompt
--    sans jeu d'essai ne sert aucun agent (MPG04).
--
-- Remplace les fonctions de 0264 (CREATE OR REPLACE : les déclencheurs restent).

-- Évaluation locale admise par la transaction courante (réglage de l'API, hors production).
CREATE FUNCTION evaluation_locale_admise() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce(current_setting('app.evaluation_locale_admise', true), '') = 'on' $$;

-- Évaluation réussie d'une version de prompt sur le dernier jeu de son nom, avec la règle du
-- fournisseur ; `p_modele` NULL : quel que soit le modèle.
CREATE FUNCTION prompt_evalue(p_cabinet uuid, p_nom text, p_prompt uuid, p_modele text)
  RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM agents_evaluations e
      WHERE e.cabinet_id = p_cabinet
        AND e.jeu_id = dernier_jeu_essai(p_cabinet, p_nom)
        AND e.prompt_id = p_prompt
        AND e.reussie
        AND (p_modele IS NULL OR e.modele = p_modele)
        AND (e.fournisseur = 'openrouter' OR evaluation_locale_admise()))
  $$;

CREATE OR REPLACE FUNCTION garder_activation_prompt() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF dernier_jeu_essai(NEW.cabinet_id, NEW.nom) IS NOT NULL
       AND NOT prompt_evalue(NEW.cabinet_id, NEW.nom, NEW.prompt_id, NULL) THEN
      RAISE EXCEPTION 'Activation refusée : aucune évaluation de non-régression réussie et admise de cette version.'
        USING ERRCODE = 'MPG04';
    END IF;
    RETURN NEW;
  END $$;

CREATE OR REPLACE FUNCTION garder_modele_tache() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v record;
  BEGIN
    IF TG_OP = 'UPDATE' AND OLD.modele = NEW.modele THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM ia_modeles_taches m
                                    WHERE m.cabinet_id = NEW.cabinet_id AND m.tache = NEW.tache
                                      AND m.modele = NEW.modele) THEN
      RETURN NEW;
    END IF;
    FOR v IN
      SELECT DISTINCT ON (p.nom) p.id, p.nom
      FROM ia_prompts p
      WHERE p.cabinet_id = NEW.cabinet_id AND p.tache = NEW.tache
        AND dernier_jeu_essai(NEW.cabinet_id, p.nom) IS NOT NULL
      ORDER BY p.nom,
        (p.id = (SELECT a.prompt_id FROM ia_prompt_activations a
                 WHERE a.cabinet_id = NEW.cabinet_id AND a.nom = p.nom
                 ORDER BY a.id DESC LIMIT 1)) DESC NULLS LAST,
        p.version DESC
    LOOP
      IF NOT prompt_evalue(NEW.cabinet_id, v.nom, v.id, NEW.modele) THEN
        RAISE EXCEPTION 'Modèle refusé : aucune évaluation de non-régression réussie et admise avec ce modèle.'
          USING ERRCODE = 'MPG04';
      END IF;
    END LOOP;
    RETURN NEW;
  END $$;

-- Une exécution d'agent porte sur une version de prompt évaluée (dernier jeu de son nom).
CREATE FUNCTION controler_execution_evaluee() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_prompt uuid;
  BEGIN
    SELECT d.prompt_id INTO v_prompt FROM ia_demandes d WHERE d.id = NEW.demande_id;
    IF v_prompt IS NULL OR dernier_jeu_essai(NEW.cabinet_id, NEW.prompt_nom) IS NULL
       OR NOT prompt_evalue(NEW.cabinet_id, NEW.prompt_nom, v_prompt, NULL) THEN
      RAISE EXCEPTION 'Exécution d''agent refusée : prompt sans évaluation de non-régression réussie et admise.'
        USING ERRCODE = 'MPG04';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER agents_executions_non_regression BEFORE INSERT ON agents_executions
  FOR EACH ROW EXECUTE FUNCTION controler_execution_evaluee();
