-- Durcissement du registre des preuves (audit de sécurité du lot PRV, 2026-10-08).
--
-- Les migrations 0240 à 0242 sont commitées : leurs fonctions de contrôle sont REMPLACÉES ici
-- (CREATE OR REPLACE), les déclencheurs existants les appellent donc sans changement.
--
-- - `est_membre_actif_mission` : utilisateur actif, directeur ou chef de la mission, ou membre de
--   son équipe. Fonction d'appelant (pas SECURITY DEFINER) : elle lit sous la RLS du cabinet.
-- - `est_expert_ou_associe` : utilisateur actif portant le rôle `expert_metier` ou `associe`.
-- - Versions de preuve (MPV02) : un fichier lié est rattaché à la mission (document de la mission)
--   ou au client (fait du dossier client), ou est un fichier encore orphelin téléversé par la
--   personne qui saisit ; un fichier supprimé n'est jamais lié ; une correction peut garder le
--   fichier de la version précédente. L'auteur désigné est la personne qui saisit, l'auteur de la
--   version précédente, ou un membre actif de la mission.
-- - Versions d'assertion : un avis d'expert n'est signé que par un expert métier ou un associé
--   (MPV04) ; la classe de risque ne s'abaisse que par eux (MPV06).
-- - Arbitrages : « contradiction levée » est refusée à l'auteur de l'assertion (identité ou version
--   courante) et à l'auteur ou au saisisseur de la version arbitrée de la preuve contraire, sauf
--   associé (MPV07).

CREATE FUNCTION est_membre_actif_mission(p_mission uuid, p_utilisateur uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM utilisateurs u
      WHERE u.id = p_utilisateur AND u.actif
        AND (EXISTS (SELECT 1 FROM missions m WHERE m.id = p_mission
                       AND (m.directeur_id = u.id OR m.chef_id = u.id))
             OR EXISTS (SELECT 1 FROM mission_equipe e WHERE e.mission_id = p_mission
                          AND e.utilisateur_id = u.id)))
  $$;

CREATE FUNCTION est_expert_ou_associe(p_utilisateur uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM utilisateurs u
      WHERE u.id = p_utilisateur AND u.actif
        AND u.roles && ARRAY['expert_metier', 'associe']::text[])
  $$;

CREATE OR REPLACE FUNCTION controler_preuve_version() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_mission uuid;
    v_client uuid;
    v_precedente record;
  BEGIN
    SELECT p.mission_id, p.client_id INTO v_mission, v_client FROM preuves p WHERE p.id = NEW.preuve_id;
    IF NEW.version <> (SELECT coalesce(max(v.version), 0) + 1 FROM preuve_versions v
                       WHERE v.preuve_id = NEW.preuve_id) THEN
      RAISE EXCEPTION 'Les versions d''une preuve se suivent sans trou.' USING ERRCODE = 'MPV03';
    END IF;
    SELECT v.auteur_id, v.fichier_id INTO v_precedente FROM preuve_versions v
      WHERE v.preuve_id = NEW.preuve_id ORDER BY v.version DESC LIMIT 1;
    IF NEW.document_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM mission_documents d WHERE d.id = NEW.document_id AND d.mission_id = v_mission) THEN
      RAISE EXCEPTION 'Le document lié n''appartient pas à la mission de la preuve.'
        USING ERRCODE = 'MPV02';
    END IF;
    IF NEW.reponse_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM questionnaire_reponses r JOIN questionnaire_envois e ON e.id = r.envoi_id
         WHERE r.id = NEW.reponse_id AND e.mission_id = v_mission) THEN
      RAISE EXCEPTION 'La réponse liée n''appartient pas à la mission de la preuve.'
        USING ERRCODE = 'MPV02';
    END IF;
    IF NEW.fichier_id IS NOT NULL
       AND NEW.fichier_id IS DISTINCT FROM v_precedente.fichier_id
       AND (EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = NEW.fichier_id)
            OR NOT (
              EXISTS (SELECT 1 FROM mission_documents d
                      WHERE d.fichier_id = NEW.fichier_id AND d.mission_id = v_mission)
              OR EXISTS (SELECT 1 FROM dossier_faits f
                         WHERE f.source_document_id = NEW.fichier_id AND f.client_id = v_client)
              OR (EXISTS (SELECT 1 FROM fichiers f
                          WHERE f.id = NEW.fichier_id AND f.envoye_par = NEW.cree_par)
                  AND NOT EXISTS (SELECT 1 FROM mission_documents d WHERE d.fichier_id = NEW.fichier_id)
                  AND NOT EXISTS (SELECT 1 FROM rapports_mission r WHERE r.fichier_id = NEW.fichier_id)
                  AND NOT EXISTS (SELECT 1 FROM debours b
                                  WHERE b.justificatif_fichier_id = NEW.fichier_id)
                  AND NOT EXISTS (SELECT 1 FROM dossier_faits f
                                  WHERE f.source_document_id = NEW.fichier_id)))) THEN
      RAISE EXCEPTION 'Le fichier lié n''est rattaché ni à la mission ni au client de la preuve.'
        USING ERRCODE = 'MPV02';
    END IF;
    IF NEW.auteur_id <> NEW.cree_par
       AND NEW.auteur_id IS DISTINCT FROM v_precedente.auteur_id
       AND NOT est_membre_actif_mission(v_mission, NEW.auteur_id) THEN
      RAISE EXCEPTION 'L''auteur d''une preuve est un membre actif de la mission.'
        USING ERRCODE = 'MPV02';
    END IF;
    RETURN NEW;
  END $$;

CREATE OR REPLACE FUNCTION controler_assertion_version() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_classe_precedente text;
    v_rangs constant text[] := ARRAY['R0', 'R1', 'R2', 'R3'];
  BEGIN
    IF NEW.version <> (SELECT coalesce(max(v.version), 0) + 1 FROM assertion_versions v
                       WHERE v.assertion_id = NEW.assertion_id) THEN
      RAISE EXCEPTION 'Les versions d''une assertion se suivent sans trou.' USING ERRCODE = 'MPV03';
    END IF;
    IF NEW.signe_par IS NOT NULL AND NEW.signe_par <> NEW.cree_par THEN
      RAISE EXCEPTION 'Un avis d''expert est signé par l''auteur de la version.'
        USING ERRCODE = 'MPV04';
    END IF;
    IF NEW.signe_par IS NOT NULL AND NOT est_expert_ou_associe(NEW.signe_par) THEN
      RAISE EXCEPTION 'Un avis d''expert est signé par un expert métier ou un associé.'
        USING ERRCODE = 'MPV04';
    END IF;
    SELECT v.classe_risque INTO v_classe_precedente FROM assertion_versions v
      WHERE v.assertion_id = NEW.assertion_id ORDER BY v.version DESC LIMIT 1;
    IF v_classe_precedente IS NOT NULL
       AND array_position(v_rangs, NEW.classe_risque) < array_position(v_rangs, v_classe_precedente)
       AND NOT est_expert_ou_associe(NEW.cree_par) THEN
      RAISE EXCEPTION 'Seul un expert métier ou un associé abaisse la classe de risque d''une assertion.'
        USING ERRCODE = 'MPV06';
    END IF;
    RETURN NEW;
  END $$;

CREATE OR REPLACE FUNCTION controler_preuve_arbitrage() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_lien record;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM assertions a WHERE a.id = NEW.assertion_id
                   AND a.mission_id = NEW.mission_id) THEN
      RAISE EXCEPTION 'L''assertion n''appartient pas à la mission.' USING ERRCODE = 'MPV02';
    END IF;
    SELECT l.action, l.sens INTO v_lien FROM assertion_preuve_liens l
      WHERE l.assertion_id = NEW.assertion_id AND l.preuve_id = NEW.preuve_id
      ORDER BY l.numero DESC LIMIT 1;
    IF v_lien.action IS DISTINCT FROM 'lier' OR v_lien.sens IS DISTINCT FROM 'contre' THEN
      RAISE EXCEPTION 'Seule une preuve liée « contre » l''assertion s''arbitre.'
        USING ERRCODE = 'MPV05';
    END IF;
    IF NEW.preuve_version <> (SELECT max(v.version) FROM preuve_versions v
                              WHERE v.preuve_id = NEW.preuve_id) THEN
      RAISE EXCEPTION 'La preuve a été corrigée depuis : arbitrer sa version courante.'
        USING ERRCODE = 'MPV05';
    END IF;
    -- Séparation des tâches : qui a écrit l'assertion ou la preuve contraire ne l'écarte pas seul.
    IF NEW.decision = 'contradiction_levee'
       AND NOT EXISTS (SELECT 1 FROM utilisateurs u
                       WHERE u.id = NEW.arbitre_par AND 'associe' = ANY (u.roles))
       AND (EXISTS (SELECT 1 FROM assertions a
                    WHERE a.id = NEW.assertion_id AND a.cree_par = NEW.arbitre_par)
            OR EXISTS (SELECT 1 FROM assertion_versions av
                       WHERE av.assertion_id = NEW.assertion_id AND av.cree_par = NEW.arbitre_par
                         AND av.version = (SELECT max(x.version) FROM assertion_versions x
                                           WHERE x.assertion_id = NEW.assertion_id))
            OR EXISTS (SELECT 1 FROM preuve_versions pv
                       WHERE pv.preuve_id = NEW.preuve_id AND pv.version = NEW.preuve_version
                         AND (pv.cree_par = NEW.arbitre_par OR pv.auteur_id = NEW.arbitre_par))) THEN
      RAISE EXCEPTION 'L''auteur de l''assertion ou de la preuve contraire ne lève pas lui-même la contradiction.'
        USING ERRCODE = 'MPV07';
    END IF;
    RETURN NEW;
  END $$;
