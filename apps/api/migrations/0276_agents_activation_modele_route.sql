-- Agents IA : l'aptitude d'une version de prompt est liée au MODÈLE ROUTÉ de sa tâche (AGT-04,
-- ADR-005 ; limite notée dans 0265 et SECURITY.md §15).
--
-- Avant : activer une version (ia_prompt_activations) ou tracer une exécution d'agent
-- (agents_executions) appelait `prompt_evalue` avec `p_modele` NULL : une évaluation réussie avec
-- N'IMPORTE QUEL modèle suffisait ; seul le contrôle applicatif `exigerPromptEvalue` liait
-- l'exécution au modèle de la tâche.
-- Désormais, la base exige une évaluation réussie et admise AVEC LE MODÈLE ROUTÉ de la tâche du
-- prompt au moment de l'activation (ou de la trace d'exécution) :
--   modele_route(cabinet, tache) = modèle choisi par le cabinet (ia_modeles_taches), sinon
--   modele_recommande(tache), REFLET EXACT de MODELES_RECOMMANDES (apps/api/src/ia/modeles.ts) ;
--   un test compare les deux pour chaque tâche : changer un modèle recommandé exige une migration
--   qui redéfinit modele_recommande.
-- Conséquences : une évaluation réussie sur un AUTRE modèle ne vaut pas activation ; après un
-- changement du modèle routé, une version évaluée seulement avec l'ancien modèle n'est plus
-- activable (le choix d'un modèle restait gardé par garder_modele_tache, inchangé).
-- `prompt_evalue` est inchangée ; seules les deux fonctions de déclencheur ci-dessous sont
-- remplacées (CREATE OR REPLACE, corps de 0265 repris à l'identique hors le modèle passé). Le
-- refus reste MPG04 (409 NON_REGRESSION_REQUISE). Limite inchangée : revenir au modèle recommandé
-- (suppression de la ligne de ia_modeles_taches) n'est pas gardé ; l'exécution d'un prompt non
-- évalué avec ce modèle est alors refusée (contrôle applicatif ET trace en base).

-- Modèle recommandé par tâche : miroir de MODELES_RECOMMANDES (ia/modeles.ts).
CREATE FUNCTION modele_recommande(p_tache text) RETURNS text
  LANGUAGE sql IMMUTABLE
  AS $$
    SELECT CASE p_tache
      WHEN 'redaction' THEN 'anthropic/claude-sonnet-4.5'
      WHEN 'analyse' THEN 'anthropic/claude-sonnet-4.5'
      WHEN 'extraction' THEN 'google/gemini-2.5-flash'
      WHEN 'classification' THEN 'google/gemini-2.5-flash'
      WHEN 'embedding' THEN 'openai/text-embedding-3-small'
    END
  $$;

-- Modèle routé d'une tâche pour un cabinet : celui du cabinet, sinon le recommandé (modeleDe).
CREATE FUNCTION modele_route(p_cabinet uuid, p_tache text) RETURNS text
  LANGUAGE sql STABLE
  AS $$
    SELECT coalesce(
      (SELECT m.modele FROM ia_modeles_taches m WHERE m.cabinet_id = p_cabinet AND m.tache = p_tache),
      modele_recommande(p_tache))
  $$;

CREATE OR REPLACE FUNCTION garder_activation_prompt() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF dernier_jeu_essai(NEW.cabinet_id, NEW.nom) IS NOT NULL
       AND NOT prompt_evalue(NEW.cabinet_id, NEW.nom, NEW.prompt_id,
             modele_route(NEW.cabinet_id, (SELECT p.tache FROM ia_prompts p
                                           WHERE p.id = NEW.prompt_id AND p.cabinet_id = NEW.cabinet_id))) THEN
      RAISE EXCEPTION 'Activation refusée : aucune évaluation de non-régression réussie et admise de cette version avec le modèle routé de sa tâche.'
        USING ERRCODE = 'MPG04';
    END IF;
    RETURN NEW;
  END $$;

-- Une exécution d'agent porte sur une version de prompt évaluée (dernier jeu de son nom) avec le
-- modèle routé de sa tâche.
CREATE OR REPLACE FUNCTION controler_execution_evaluee() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_prompt uuid;
  BEGIN
    SELECT d.prompt_id INTO v_prompt FROM ia_demandes d WHERE d.id = NEW.demande_id;
    IF v_prompt IS NULL OR dernier_jeu_essai(NEW.cabinet_id, NEW.prompt_nom) IS NULL
       OR NOT prompt_evalue(NEW.cabinet_id, NEW.prompt_nom, v_prompt,
                            modele_route(NEW.cabinet_id, NEW.tache)) THEN
      RAISE EXCEPTION 'Exécution d''agent refusée : prompt sans évaluation de non-régression réussie et admise.'
        USING ERRCODE = 'MPG04';
    END IF;
    RETURN NEW;
  END $$;
