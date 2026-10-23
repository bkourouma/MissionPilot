-- Agents IA : garde de provenance du rejeu RÉEL des évaluations (AGT-04, ADR-005), dette de 0270.
--
-- Avant : des déclencheurs (MPG09) arrêtaient un INSERT direct, mais le rôle applicatif exécutant
-- du SQL arbitraire pouvait forger, dans l'ordre, la demande `en_cours`, les appels inscrits dans
-- `ia_consommations` (evaluation_demande_id) et l'évaluation « openrouter » réussie.
--
-- Désormais, les écritures qui PROUVENT un rejeu ne passent que par trois fonctions
-- SECURITY DEFINER étroites, appelées par le job `agents_evaluation_openrouter` :
--   rejeu_evaluation_demarrer        demande en_file → en_cours (seule voie) ;
--   rejeu_evaluation_inscrire_appel  appel inscrit dans ia_consommations + progression ;
--   rejeu_evaluation_terminer        évaluation « openrouter » + état terminal de la demande.
-- Chacune revérifie EN BASE : contexte de cabinet (hors portail), job du type de rejeu, EN COURS,
-- du même cabinet, dont la charge et la clé désignent la demande (et rattaché à elle) ; demande
-- dans l'état attendu ; jeu d'essai courant du prompt et nombre de cas égal à celui du jeu ;
-- paramètres bornés ; évaluation dont le coût et les jetons sont ceux CUMULÉS en base par les
-- inscriptions (jamais un chiffre fourni à la fin) ; réussie seulement avec tous les cas réussis
-- (recomptés dans le détail) et au moins `cas_total` appels réussis inscrits.
--
-- Écritures directes du rôle applicatif (le propriétaire, donc les fonctions SECURITY DEFINER,
-- les migrations et les semis de test, n'est pas concerné) :
--   * agents_evaluations : INSERT limité aux colonnes d'une évaluation LOCALE (demande_id,
--     statut, cause, jetons non accordés) ; la contrainte de provenance de 0270 rend donc une
--     évaluation « openrouter » impossible sans fonction ; UPDATE déjà révoqué (0264).
--   * agents_evaluations_demandes : INSERT limité aux colonnes d'une demande (naît « en_file »,
--     compteurs à zéro) ; UPDATE limité à statut, cause, termine_le, job_id, et un déclencheur
--     n'admet que les DÉCLASSEMENTS (« echouee », « ignoree ») et un job_id posé une fois, vers
--     le job de rejeu de cette demande.
--   * ia_consommations : un appel rattaché à une évaluation (evaluation_demande_id) est refusé ;
--     INSERT reste accordé (générations, copilote, test). Pas de REVOKE par colonne ici :
--     ia/couts.ts nomme encore la colonne (à NULL) dans son INSERT.
--   * jobs (type `agents_evaluation_openrouter` SEULEMENT, les autres types sont inchangés) :
--     naît « en_attente », une seule tentative, clé et charge de SA demande « en_file » ; type,
--     charge, clé, cabinet et tentatives figés ; le rôle applicatif ne le passe jamais « en_cours »
--     (seule la réservation du worker, `reserver_job_a`, SECURITY DEFINER, le fait), ne le remet
--     jamais en attente et ne rouvre pas un job terminé.
--
-- SQLSTATE (lettre G, plage 0260-0279) :
--   MPG12 écriture réservée au job de rejeu (déclencheurs ci-dessus) ;
--   MPG13 job de rejeu invalide (absent, autre cabinet, autre type, pas en cours, charge ou clé
--         d'une autre demande, autre job rattaché à la demande) ou contexte absent ;
--   MPG14 demande de rejeu dans un état incompatible (absente, pas en file / en cours, jeu
--         d'essai changé, nombre de cas différent du jeu, trop d'appels, réussite sans appels) ;
--   MPG15 paramètre invalide (nul, hors bornes, statut ou issue inconnus, détail incohérent).
--
-- MODÈLE DE MENACE ET LIMITE RÉSIDUELLE (à lire avant de s'y fier) : le worker et l'API utilisent
-- le MÊME rôle `missionpilot_app`. Une fonction accordée à ce rôle est donc appelable par du SQL
-- arbitraire de ce rôle, et `reserver_job_a` aussi. Ce qui est garanti : un INSERT ou un UPDATE
-- direct (une injection d'une instruction, un code qui oublierait la provenance) ne peut plus
-- produire une demande en cours, un appel d'évaluation inscrit ni une évaluation « openrouter » ;
-- un job de rejeu ne peut pas être inséré ou basculé « en_cours » à la main. Ce qui reste
-- faisable : du SQL arbitraire à plusieurs instructions qui met en file une demande et son job,
-- RÉSERVE lui-même ce job par `reserver_job_a` (ou agit pendant que le worker l'exécute et
-- devance son démarrage), puis appelle les trois fonctions dans l'ordre avec des appels
-- « succes » déclarés, peut encore forger une évaluation réussie. Le coût, les jetons et l'issue
-- d'un appel sont déclarés par l'appelant (la base ne connaît pas les tarifs). La forgerie laisse
-- des traces que ce rôle ne peut ni modifier ni effacer : évaluation et appels en ajout seul,
-- demande dont le job_id est posé une fois (la ligne du job elle-même reste supprimable par ce
-- rôle, comme tout job). La garde complète exige un rôle distinct pour le worker, seul titulaire
-- de EXECUTE sur `reserver_job_a` et sur ces fonctions (nouvel ADR) : non fait ici.

-- Job de rejeu valide pour cette demande dans ce cabinet, sinon MPG13. Fonctions internes (sans
-- SECURITY DEFINER propre) : appelées par les trois fonctions ci-dessous, donc avec leurs droits ;
-- jamais accordées au rôle applicatif.
CREATE FUNCTION rejeu_controler_job(p_job uuid, p_demande uuid, p_cabinet uuid) RETURNS void
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  DECLARE j record;
  BEGIN
    SELECT id, cabinet_id, type, statut, charge, cle INTO j FROM jobs WHERE id = p_job;
    IF NOT FOUND OR j.cabinet_id <> p_cabinet OR j.type <> 'agents_evaluation_openrouter'
       OR j.statut <> 'en_cours' OR (j.charge ->> 'demande_id') IS DISTINCT FROM p_demande::text
       OR j.cle IS DISTINCT FROM 'agents_evaluation_openrouter:' || p_demande::text THEN
      RAISE EXCEPTION 'Rejeu : job absent, terminé, d''un autre type, d''un autre cabinet ou d''une autre demande.'
        USING ERRCODE = 'MPG13';
    END IF;
  END $$;

-- Contexte du job (cabinet courant, hors portail) et demande verrouillée dans l'état attendu.
CREATE FUNCTION rejeu_demande_verrouillee(p_job uuid, p_demande uuid, p_statut text)
  RETURNS agents_evaluations_demandes
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_cabinet uuid := app_cabinet_id();
    d agents_evaluations_demandes;
  BEGIN
    IF v_cabinet IS NULL OR app_portail_client_id() IS NOT NULL THEN
      RAISE EXCEPTION 'Rejeu : contexte de cabinet absent.' USING ERRCODE = 'MPG13';
    END IF;
    IF p_job IS NULL OR p_demande IS NULL THEN
      RAISE EXCEPTION 'Rejeu : job ou demande non renseigné.' USING ERRCODE = 'MPG15';
    END IF;
    PERFORM rejeu_controler_job(p_job, p_demande, v_cabinet);
    SELECT * INTO d FROM agents_evaluations_demandes
      WHERE id = p_demande AND cabinet_id = v_cabinet FOR UPDATE;
    IF NOT FOUND OR d.statut <> p_statut THEN
      RAISE EXCEPTION 'Rejeu : demande absente ou dans un état incompatible.' USING ERRCODE = 'MPG14';
    END IF;
    IF d.job_id IS NOT NULL AND d.job_id <> p_job THEN
      RAISE EXCEPTION 'Rejeu : un autre job est rattaché à cette demande.' USING ERRCODE = 'MPG13';
    END IF;
    RETURN d;
  END $$;

-- Horodatage fourni par le job (horloge injectable) : ni avant le début, ni à plus d'un jour.
CREATE FUNCTION rejeu_horodatage_valide(p_t timestamptz, p_depuis timestamptz) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = public, pg_temp
  AS $$ SELECT p_t IS NOT NULL AND p_t >= p_depuis - interval '1 minute'
                AND p_t <= now() + interval '1 day' $$;

-- 1. Démarrage : seule voie de « en_file » à « en_cours ». Revérifie le jeu courant et le nombre
--    de cas ; rattache le job à la demande s'il ne l'était pas.
CREATE FUNCTION rejeu_evaluation_demarrer(p_job uuid, p_demande uuid, p_debut timestamptz)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    d agents_evaluations_demandes;
    v_nom text;
    v_cas int;
  BEGIN
    d := rejeu_demande_verrouillee(p_job, p_demande, 'en_file');
    IF NOT rejeu_horodatage_valide(p_debut, d.cree_le - interval '1 day') THEN
      RAISE EXCEPTION 'Rejeu : heure de début invalide.' USING ERRCODE = 'MPG15';
    END IF;
    SELECT p.nom, jsonb_array_length(j.cas) INTO v_nom, v_cas
      FROM ia_prompts p JOIN agents_jeux_essai j ON j.id = d.jeu_id AND j.cabinet_id = d.cabinet_id
      WHERE p.id = d.prompt_id AND p.cabinet_id = d.cabinet_id AND j.prompt_nom = p.nom;
    IF v_nom IS NULL OR d.jeu_id IS DISTINCT FROM dernier_jeu_essai(d.cabinet_id, v_nom)
       OR v_cas <> d.cas_total THEN
      RAISE EXCEPTION 'Rejeu : jeu d''essai changé ou nombre de cas différent du jeu.'
        USING ERRCODE = 'MPG14';
    END IF;
    UPDATE agents_evaluations_demandes
      SET statut = 'en_cours', debut_le = p_debut, job_id = p_job
      WHERE id = d.id;
  END $$;

-- 2. Appel du fournisseur réel inscrit (coût déclaré par le job, au tarif de ia/modeles.ts) et
--    progression cumulée EN BASE. Au plus deux appels par cas (candidate + version active).
CREATE FUNCTION rejeu_evaluation_inscrire_appel(
  p_job uuid, p_demande uuid, p_issue text, p_source_cle text, p_tokens_entree int,
  p_tokens_sortie int, p_cout bigint, p_tarif_connu boolean, p_duree_ms int, p_cree_le timestamptz)
  RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    d agents_evaluations_demandes;
    v_tache text;
  BEGIN
    d := rejeu_demande_verrouillee(p_job, p_demande, 'en_cours');
    IF p_issue IS NULL OR p_issue NOT IN ('succes', 'sortie_invalide', 'delai_depasse', 'reponse_invalide')
       OR p_source_cle IS NULL OR p_source_cle NOT IN ('cabinet', 'plateforme')
       OR p_tokens_entree IS NULL OR p_tokens_entree NOT BETWEEN 0 AND 2000000
       OR p_tokens_sortie IS NULL OR p_tokens_sortie NOT BETWEEN 0 AND 1000000
       OR p_cout IS NULL OR p_cout NOT BETWEEN 0 AND 100000000
       OR p_tarif_connu IS NULL OR p_duree_ms IS NULL OR p_duree_ms NOT BETWEEN 0 AND 3600000
       OR NOT rejeu_horodatage_valide(p_cree_le, d.debut_le) THEN
      RAISE EXCEPTION 'Rejeu : appel inscrit invalide.' USING ERRCODE = 'MPG15';
    END IF;
    IF d.appels >= 2 * d.cas_total THEN
      RAISE EXCEPTION 'Rejeu : plus d''appels que de cas à rejouer.' USING ERRCODE = 'MPG14';
    END IF;
    SELECT p.tache INTO v_tache FROM ia_prompts p WHERE p.id = d.prompt_id AND p.cabinet_id = d.cabinet_id;
    INSERT INTO ia_consommations (cabinet_id, demande_id, mission_id, tache, modele, issue,
        source_cle, tokens_entree, tokens_sortie, cout_micro_usd, tarif_connu, duree_ms, cree_le,
        evaluation_demande_id)
      VALUES (d.cabinet_id, NULL, NULL, v_tache, d.modele, p_issue, p_source_cle, p_tokens_entree,
        p_tokens_sortie, p_cout, p_tarif_connu, p_duree_ms, p_cree_le, d.id);
    UPDATE agents_evaluations_demandes
      SET appels = appels + 1, cout_micro_usd = cout_micro_usd + p_cout,
          tokens_entree = tokens_entree + p_tokens_entree,
          tokens_sortie = tokens_sortie + p_tokens_sortie
      WHERE id = d.id;
  END $$;

-- Paramètres de fin d'un rejeu cohérents avec la demande (MPG15 sinon).
CREATE FUNCTION rejeu_controler_fin(
  d agents_evaluations_demandes, p_statut text, p_cause text, p_cas_reussis int,
  p_regressions int, p_cas_traites int, p_resultats jsonb, p_termine_le timestamptz)
  RETURNS void
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF p_statut IS NULL OR p_statut NOT IN ('reussie', 'echouee', 'incomplete')
       OR (p_statut = 'reussie') <> (p_cause IS NULL)
       OR p_resultats IS NULL OR jsonb_typeof(p_resultats) <> 'array'
       OR jsonb_array_length(p_resultats) <> d.cas_total
       OR p_cas_reussis IS NULL OR p_cas_reussis NOT BETWEEN 0 AND d.cas_total
       OR p_regressions IS NULL OR p_regressions NOT BETWEEN 0 AND d.cas_total
       OR p_cas_traites IS NULL OR p_cas_traites NOT BETWEEN p_cas_reussis AND d.cas_total
       OR (p_statut = 'reussie' AND p_cas_reussis <> d.cas_total)
       OR NOT rejeu_horodatage_valide(p_termine_le, d.debut_le) THEN
      RAISE EXCEPTION 'Rejeu : résultat de l''évaluation invalide.' USING ERRCODE = 'MPG15';
    END IF;
    -- Le nombre de cas réussis est recompté dans le détail (jamais cru sur parole).
    IF (SELECT count(*) FROM jsonb_array_elements(p_resultats) x
        WHERE jsonb_typeof(x) = 'object' AND x -> 'reussi' = 'true'::jsonb) <> p_cas_reussis THEN
      RAISE EXCEPTION 'Rejeu : cas réussis incohérents avec le détail.' USING ERRCODE = 'MPG15';
    END IF;
  END $$;

-- 3. Fin : évaluation « openrouter » (coût et jetons CUMULÉS en base) et état terminal.
CREATE FUNCTION rejeu_evaluation_terminer(
  p_job uuid, p_demande uuid, p_statut text, p_cause text, p_cas_reussis int, p_regressions int,
  p_cas_traites int, p_resultats jsonb, p_prompt_reference uuid, p_termine_le timestamptz)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    d agents_evaluations_demandes;
    v_id uuid;
  BEGIN
    d := rejeu_demande_verrouillee(p_job, p_demande, 'en_cours');
    PERFORM rejeu_controler_fin(d, p_statut, p_cause, p_cas_reussis, p_regressions, p_cas_traites,
                                p_resultats, p_termine_le);
    -- Version de comparaison : une AUTRE version du même nom de prompt, du même cabinet.
    IF p_prompt_reference IS NOT NULL AND (p_prompt_reference = d.prompt_id OR NOT EXISTS (
         SELECT 1 FROM ia_prompts r JOIN ia_prompts p ON p.nom = r.nom AND p.cabinet_id = r.cabinet_id
         WHERE r.id = p_prompt_reference AND p.id = d.prompt_id AND r.cabinet_id = d.cabinet_id)) THEN
      RAISE EXCEPTION 'Rejeu : version de comparaison invalide.' USING ERRCODE = 'MPG15';
    END IF;
    IF p_statut = 'reussie' AND (
         SELECT count(*) FROM ia_consommations c
         WHERE c.cabinet_id = d.cabinet_id AND c.evaluation_demande_id = d.id
           AND c.issue = 'succes') < d.cas_total THEN
      RAISE EXCEPTION 'Rejeu : réussite sans un appel réussi inscrit par cas.' USING ERRCODE = 'MPG14';
    END IF;
    INSERT INTO agents_evaluations (cabinet_id, jeu_id, prompt_id, prompt_reference_id, modele,
        fournisseur, cas_total, cas_reussis, regressions, reussie, resultats, cout_micro_usd,
        tokens_entree, tokens_sortie, statut, cause, demande_id, lance_par)
      VALUES (d.cabinet_id, d.jeu_id, d.prompt_id, p_prompt_reference, d.modele, 'openrouter',
        d.cas_total, p_cas_reussis, p_regressions, p_statut = 'reussie', p_resultats,
        d.cout_micro_usd, d.tokens_entree, d.tokens_sortie, p_statut, p_cause, d.id, d.demande_par)
      RETURNING id INTO v_id;
    UPDATE agents_evaluations_demandes
      SET statut = p_statut, cause = p_cause, evaluation_id = v_id, cas_traites = p_cas_traites,
          termine_le = p_termine_le
      WHERE id = d.id;
    RETURN v_id;
  END $$;

REVOKE ALL ON FUNCTION rejeu_controler_job(uuid, uuid, uuid),
  rejeu_demande_verrouillee(uuid, uuid, text), rejeu_horodatage_valide(timestamptz, timestamptz),
  rejeu_controler_fin(agents_evaluations_demandes, text, text, int, int, int, jsonb, timestamptz),
  rejeu_evaluation_demarrer(uuid, uuid, timestamptz),
  rejeu_evaluation_inscrire_appel(uuid, uuid, text, text, int, int, bigint, boolean, int, timestamptz),
  rejeu_evaluation_terminer(uuid, uuid, text, text, int, int, int, jsonb, uuid, timestamptz)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rejeu_evaluation_demarrer(uuid, uuid, timestamptz),
  rejeu_evaluation_inscrire_appel(uuid, uuid, text, text, int, int, bigint, boolean, int, timestamptz),
  rejeu_evaluation_terminer(uuid, uuid, text, text, int, int, int, jsonb, uuid, timestamptz)
  TO missionpilot_app;

/* ----- Privilèges du rôle applicatif ----- */

REVOKE INSERT ON agents_evaluations FROM missionpilot_app;
GRANT INSERT (cabinet_id, jeu_id, prompt_id, prompt_reference_id, modele, fournisseur, cas_total,
  cas_reussis, regressions, reussie, resultats, lance_par) ON agents_evaluations TO missionpilot_app;

REVOKE INSERT, UPDATE ON agents_evaluations_demandes FROM missionpilot_app;
GRANT INSERT (cabinet_id, jeu_id, prompt_id, modele, cas_total, cout_estime_micro_usd,
  plafond_evaluation_micro_usd, demande_par) ON agents_evaluations_demandes TO missionpilot_app;
GRANT UPDATE (statut, cause, termine_le, job_id) ON agents_evaluations_demandes TO missionpilot_app;

/* ----- Déclencheurs : écritures réservées (le propriétaire de la table n'est pas concerné) ----- */

-- Demande : hors propriétaire, seulement des déclassements et un job_id posé une fois (son job).
CREATE FUNCTION garder_ecriture_rejeu_demande() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF current_user = (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = TG_RELID) THEN
      RETURN NEW;
    END IF;
    IF NEW.statut IS DISTINCT FROM OLD.statut AND NEW.statut NOT IN ('echouee', 'ignoree') THEN
      RAISE EXCEPTION 'Demande de rejeu : cet état n''est écrit que par le job de rejeu.'
        USING ERRCODE = 'MPG12';
    END IF;
    IF NEW.job_id IS DISTINCT FROM OLD.job_id AND (OLD.job_id IS NOT NULL OR NOT EXISTS (
         SELECT 1 FROM jobs j
         WHERE j.id = NEW.job_id AND j.cabinet_id = NEW.cabinet_id
           AND j.type = 'agents_evaluation_openrouter'
           AND j.cle = 'agents_evaluation_openrouter:' || NEW.id::text)) THEN
      RAISE EXCEPTION 'Demande de rejeu : job déjà rattaché ou étranger à la demande.'
        USING ERRCODE = 'MPG12';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER agents_evaluations_demandes_ecriture_rejeu
  BEFORE UPDATE ON agents_evaluations_demandes
  FOR EACH ROW EXECUTE FUNCTION garder_ecriture_rejeu_demande();

-- Évaluation « openrouter » ou rattachée à une demande : réservée (les droits par colonne
-- l'interdisent déjà ; ce déclencheur tient si un GRANT plus large revenait).
CREATE FUNCTION garder_ecriture_rejeu_evaluation() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF current_user <> (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = TG_RELID)
       AND (NEW.fournisseur <> 'local' OR NEW.demande_id IS NOT NULL OR NEW.statut IS NOT NULL) THEN
      RAISE EXCEPTION 'Évaluation de rejeu : écrite seulement par le job de rejeu.'
        USING ERRCODE = 'MPG12';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER agents_evaluations_ecriture_rejeu BEFORE INSERT ON agents_evaluations
  FOR EACH ROW EXECUTE FUNCTION garder_ecriture_rejeu_evaluation();

-- Appel rattaché à une évaluation : réservé à rejeu_evaluation_inscrire_appel.
CREATE FUNCTION garder_consommation_rejeu() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NEW.evaluation_demande_id IS NOT NULL AND current_user <> (
         SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = TG_RELID) THEN
      RAISE EXCEPTION 'Appel d''évaluation : inscrit seulement par le job de rejeu.'
        USING ERRCODE = 'MPG12';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER ia_consommations_ecriture_rejeu BEFORE INSERT ON ia_consommations
  FOR EACH ROW EXECUTE FUNCTION garder_consommation_rejeu();

-- Job de rejeu (ce type seulement) : naissance et transitions du rôle applicatif bornées.
CREATE FUNCTION garder_job_rejeu() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  BEGIN
    -- Autres types de jobs : aucun contrôle (premier test, avant toute lecture du catalogue).
    IF NEW.type <> 'agents_evaluation_openrouter'
       AND (TG_OP = 'INSERT' OR OLD.type <> 'agents_evaluation_openrouter') THEN
      RETURN NEW;
    END IF;
    IF current_user = (SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = TG_RELID) THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.statut <> 'en_attente' OR NEW.tentatives <> 0 OR NEW.tentatives_max <> 1
         OR NEW.verrouille_le IS NOT NULL
         OR NEW.cle IS DISTINCT FROM 'agents_evaluation_openrouter:' || (NEW.charge ->> 'demande_id')
         OR NOT EXISTS (SELECT 1 FROM agents_evaluations_demandes d
                        WHERE d.id::text = NEW.charge ->> 'demande_id'
                          AND d.cabinet_id = NEW.cabinet_id AND d.statut = 'en_file'
                          AND d.job_id IS NULL) THEN
        RAISE EXCEPTION 'Job de rejeu : naît en attente, une seule tentative, pour sa demande en file.'
          USING ERRCODE = 'MPG12';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.type <> OLD.type OR NEW.cabinet_id <> OLD.cabinet_id OR NEW.charge <> OLD.charge
       OR NEW.cle IS DISTINCT FROM OLD.cle OR NEW.tentatives <> OLD.tentatives
       OR NEW.tentatives_max <> OLD.tentatives_max
       OR (NEW.statut <> OLD.statut
           AND (OLD.statut IN ('termine', 'echec') OR NEW.statut IN ('en_cours', 'en_attente'))) THEN
      RAISE EXCEPTION 'Job de rejeu : réservé au worker (identité figée, jamais remis en cours ni en attente).'
        USING ERRCODE = 'MPG12';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER jobs_rejeu_evaluation BEFORE INSERT OR UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION garder_job_rejeu();

REVOKE ALL ON FUNCTION garder_ecriture_rejeu_demande(), garder_ecriture_rejeu_evaluation(),
  garder_consommation_rejeu(), garder_job_rejeu() FROM PUBLIC;
