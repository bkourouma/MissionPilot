-- Hypothèses, liens aux assertions et verdicts (DD-09) : « chaque verdict est sourcé ».
--
-- - dd_hypothese_liens     : JOURNAL des liens hypothèse -> assertion du registre des preuves
--   (modèle assertion_preuve_liens, 0242) : `lier` avec un sens (soutient, contredit), `delier` ;
--   l'état courant d'un couple est son dernier événement.
-- - dd_verdicts            : une PROPOSITION de verdict (ajout seul) avec la photographie des
--   assertions citées (identifiant, version, sens, indice, lecture). `indication_moteur` est
--   calculée par l'API depuis packages/engines (jamais reçue du client) ; un verdict qui s'en écarte
--   exige un motif d'au moins 20 caractères. Un verdict confirmé ou infirmé SANS assertion citée,
--   ou citant une assertion non liée à l'hypothèse dans ce sens, est refusé (MPZ24).
-- - dd_verdict_validations : décision d'un TIERS (ajout seul, une par verdict). Le verdict ne prend
--   effet qu'une fois validé : valideur ni proposant, ni créateur de l'hypothèse, ni auteur d'une
--   de ses versions, ni créateur d'une assertion citée, sauf associé (MPZ25, modèle MPV07 de
--   0243 et MPW05 de 0385) ; le verdict doit être le DERNIER de son hypothèse et l'hypothèse ne
--   doit pas avoir changé depuis (MPZ27).
--
-- SQLSTATE : MPZ22 (rattachement), MPZ24, MPZ25, MPZ27, MPZ32 (un seul verdict en attente par
-- hypothèse). État dérivé d'une hypothèse (verdict en vigueur, en attente, ouverte) : code de l'API.

CREATE TABLE dd_hypothese_liens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  dossier_id uuid NOT NULL,
  hypothese_id uuid NOT NULL,
  assertion_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('lier', 'delier')),
  sens text CHECK (sens IN ('soutient', 'contredit')),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  CHECK ((action = 'lier') = (sens IS NOT NULL)),
  FOREIGN KEY (cabinet_id, dossier_id, hypothese_id)
    REFERENCES dd_elements (cabinet_id, dossier_id, id),
  FOREIGN KEY (cabinet_id, assertion_id) REFERENCES assertions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX dd_hypothese_liens_couple_idx
  ON dd_hypothese_liens (cabinet_id, hypothese_id, assertion_id, numero DESC);
CREATE INDEX dd_hypothese_liens_dossier_idx ON dd_hypothese_liens (cabinet_id, dossier_id);
ALTER TABLE dd_hypothese_liens ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_hypothese_liens
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dd_hypothese_liens AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dd_hypothese_liens FROM missionpilot_app;
CREATE TRIGGER dd_hypothese_liens_ajout_seul BEFORE UPDATE OR DELETE ON dd_hypothese_liens
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();
CREATE TRIGGER dd_hypothese_liens_auteur_sans_portail BEFORE INSERT ON dd_hypothese_liens
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('cree_par');

-- L'élément est une hypothèse, l'assertion appartient à la mission du dossier, on ne délie que ce
-- qui est lié (MPZ22).
CREATE FUNCTION controler_dd_hypothese_lien() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_dernier text;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM dd_elements e
                   WHERE e.id = NEW.hypothese_id AND e.dossier_id = NEW.dossier_id
                     AND e.type = 'hypothese') THEN
      RAISE EXCEPTION 'Le lien doit viser une hypothèse du dossier.' USING ERRCODE = 'MPZ22';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM assertions a
                   JOIN dd_dossiers d ON d.mission_id = a.mission_id
                   WHERE a.id = NEW.assertion_id AND d.id = NEW.dossier_id) THEN
      RAISE EXCEPTION 'L''assertion n''appartient pas à la mission du dossier.'
        USING ERRCODE = 'MPZ22';
    END IF;
    IF NEW.action = 'delier' THEN
      SELECT l.action INTO v_dernier FROM dd_hypothese_liens l
        WHERE l.hypothese_id = NEW.hypothese_id AND l.assertion_id = NEW.assertion_id
        ORDER BY l.numero DESC LIMIT 1;
      IF v_dernier IS DISTINCT FROM 'lier' THEN
        RAISE EXCEPTION 'Cette assertion n''est pas liée à l''hypothèse.' USING ERRCODE = 'MPZ22';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER dd_hypothese_liens_controle BEFORE INSERT ON dd_hypothese_liens
  FOR EACH ROW EXECUTE FUNCTION controler_dd_hypothese_lien();

CREATE TABLE dd_verdicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  dossier_id uuid NOT NULL,
  hypothese_id uuid NOT NULL,
  hypothese_version int NOT NULL CHECK (hypothese_version BETWEEN 1 AND 200),
  verdict text NOT NULL CHECK (verdict IN ('confirmee', 'infirmee', 'non_concluante')),
  indication_moteur text NOT NULL
    CHECK (indication_moteur IN ('confirmee', 'infirmee', 'non_concluante')),
  motif text NOT NULL CHECK (length(motif) BETWEEN 1 AND 2000),
  assertions_citees jsonb NOT NULL,
  proposee_par uuid NOT NULL,
  proposee_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  CHECK (jsonb_typeof(assertions_citees) = 'array' AND jsonb_array_length(assertions_citees) <= 50),
  -- 50 photographies de ~200 octets : 20 Ko laissent de la marge sans admettre un remplissage.
  CONSTRAINT dd_verdicts_citees_octets CHECK (octet_length(assertions_citees::text) <= 20000),
  CHECK (verdict = 'non_concluante' OR jsonb_array_length(assertions_citees) >= 1),
  CHECK (verdict = indication_moteur OR length(motif) >= 20),
  FOREIGN KEY (cabinet_id, dossier_id, hypothese_id)
    REFERENCES dd_elements (cabinet_id, dossier_id, id),
  FOREIGN KEY (cabinet_id, proposee_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX dd_verdicts_hypothese_idx ON dd_verdicts (cabinet_id, hypothese_id, numero DESC);
CREATE INDEX dd_verdicts_dossier_idx ON dd_verdicts (cabinet_id, dossier_id, numero DESC);
ALTER TABLE dd_verdicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_verdicts
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dd_verdicts AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dd_verdicts FROM missionpilot_app;
CREATE TRIGGER dd_verdicts_ajout_seul BEFORE UPDATE OR DELETE ON dd_verdicts
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();
CREATE TRIGGER dd_verdicts_auteur_sans_portail BEFORE INSERT ON dd_verdicts
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('proposee_par');

-- Cohérence d'une proposition : MPZ22 (hypothèse non retirée, version lue = version courante),
-- MPZ32 (aucun autre verdict en attente), MPZ24 (chaque assertion citée est liée à l'hypothèse dans
-- le sens de la photographie, de la mission du dossier ; confirmé = au moins un soutien, infirmé =
-- au moins une contradiction).
CREATE FUNCTION controler_dd_verdict() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_mission uuid;
    v_version integer;
    v_retire boolean;
    v_citee jsonb;
    v_id uuid;
    v_dernier record;
    v_vues uuid[] := '{}';
    v_soutiens integer := 0;
    v_contre integer := 0;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM dd_elements e
                   WHERE e.id = NEW.hypothese_id AND e.dossier_id = NEW.dossier_id
                     AND e.type = 'hypothese') THEN
      RAISE EXCEPTION 'Un verdict porte sur une hypothèse du dossier.' USING ERRCODE = 'MPZ22';
    END IF;
    SELECT v.version, v.retire INTO v_version, v_retire FROM dd_element_versions v
      WHERE v.element_id = NEW.hypothese_id ORDER BY v.version DESC LIMIT 1;
    IF v_retire IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'L''hypothèse est retirée : aucun verdict.' USING ERRCODE = 'MPZ22';
    END IF;
    IF NEW.hypothese_version IS DISTINCT FROM v_version THEN
      RAISE EXCEPTION 'L''hypothèse a changé depuis la lecture : rechargez puis recommencez.'
        USING ERRCODE = 'MPZ22';
    END IF;
    IF EXISTS (SELECT 1 FROM dd_verdicts x
               WHERE x.hypothese_id = NEW.hypothese_id
                 AND NOT EXISTS (SELECT 1 FROM dd_verdict_validations y WHERE y.verdict_id = x.id)) THEN
      RAISE EXCEPTION 'Un verdict de cette hypothèse attend déjà une décision.'
        USING ERRCODE = 'MPZ32';
    END IF;
    SELECT d.mission_id INTO v_mission FROM dd_dossiers d WHERE d.id = NEW.dossier_id;
    IF jsonb_typeof(NEW.assertions_citees) = 'array' THEN
      FOR v_citee IN SELECT c.value FROM jsonb_array_elements(NEW.assertions_citees) c LOOP
        IF jsonb_typeof(v_citee) IS DISTINCT FROM 'object'
           OR coalesce(v_citee ->> 'assertion_id', '')
              !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           OR coalesce(v_citee ->> 'sens', '') NOT IN ('soutient', 'contredit') THEN
          RAISE EXCEPTION 'Assertion citée mal formée.' USING ERRCODE = 'MPZ24';
        END IF;
        v_id := (v_citee ->> 'assertion_id')::uuid;
        IF v_id = ANY (v_vues) THEN
          RAISE EXCEPTION 'Une assertion ne se cite qu''une fois.' USING ERRCODE = 'MPZ24';
        END IF;
        v_vues := v_vues || v_id;
        IF NOT EXISTS (SELECT 1 FROM assertions a WHERE a.id = v_id AND a.mission_id = v_mission) THEN
          RAISE EXCEPTION 'L''assertion citée n''appartient pas à la mission du dossier.'
            USING ERRCODE = 'MPZ24';
        END IF;
        SELECT l.action, l.sens INTO v_dernier FROM dd_hypothese_liens l
          WHERE l.hypothese_id = NEW.hypothese_id AND l.assertion_id = v_id
          ORDER BY l.numero DESC LIMIT 1;
        IF v_dernier.action IS DISTINCT FROM 'lier'
           OR v_dernier.sens IS DISTINCT FROM (v_citee ->> 'sens') THEN
          RAISE EXCEPTION 'L''assertion citée n''est pas liée à l''hypothèse dans ce sens.'
            USING ERRCODE = 'MPZ24';
        END IF;
        IF v_citee ->> 'sens' = 'soutient' THEN
          v_soutiens := v_soutiens + 1;
        ELSE
          v_contre := v_contre + 1;
        END IF;
      END LOOP;
    END IF;
    IF (NEW.verdict = 'confirmee' AND v_soutiens = 0)
       OR (NEW.verdict = 'infirmee' AND v_contre = 0) THEN
      RAISE EXCEPTION 'Un verdict confirmé ou infirmé cite au moins une assertion qui le soutient.'
        USING ERRCODE = 'MPZ24';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER dd_verdicts_controle BEFORE INSERT ON dd_verdicts
  FOR EACH ROW EXECUTE FUNCTION controler_dd_verdict();

CREATE TABLE dd_verdict_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  verdict_id uuid NOT NULL UNIQUE,
  decision text NOT NULL CHECK (decision IN ('valide', 'rejete')),
  motif text CHECK (motif IS NULL OR length(motif) BETWEEN 1 AND 1000),
  valide_par uuid NOT NULL,
  valide_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  CHECK (decision = 'valide' OR motif IS NOT NULL),
  FOREIGN KEY (cabinet_id, verdict_id) REFERENCES dd_verdicts (cabinet_id, id),
  FOREIGN KEY (cabinet_id, valide_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE dd_verdict_validations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_verdict_validations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dd_verdict_validations AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dd_verdict_validations FROM missionpilot_app;
CREATE TRIGGER dd_verdict_validations_ajout_seul BEFORE UPDATE OR DELETE ON dd_verdict_validations
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();
CREATE TRIGGER dd_verdict_validations_auteur_sans_portail BEFORE INSERT ON dd_verdict_validations
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('valide_par');

-- MPZ27 : le verdict est le DERNIER de son hypothèse, l'hypothèse n'a pas changé depuis et chaque
-- assertion citée est toujours liée (même sens), non abandonnée, à la version photographiée ;
-- MPZ25 : séparation des tâches (sauf associé), même règle que le contrôle de l'API : ni le
-- proposant, ni le créateur ou l'auteur d'une version de l'hypothèse, ni le créateur d'une
-- assertion citée ou l'auteur de N'IMPORTE LAQUELLE de ses versions.
CREATE FUNCTION controler_dd_verdict_validation() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v record;
    v_courante integer;
    v_citee jsonb;
    v_id uuid;
    v_lien record;
    v_assertion record;
  BEGIN
    SELECT x.hypothese_id, x.hypothese_version, x.numero, x.proposee_par, x.assertions_citees
      INTO v FROM dd_verdicts x WHERE x.id = NEW.verdict_id;
    -- Seule une VALIDATION exige un verdict à jour : un verdict périmé peut toujours être rejeté
    -- (sinon il bloquerait l'hypothèse, MPZ32).
    IF NEW.decision = 'valide' THEN
      IF EXISTS (SELECT 1 FROM dd_verdicts y
                 WHERE y.hypothese_id = v.hypothese_id AND y.numero > v.numero) THEN
        RAISE EXCEPTION 'Ce verdict n''est plus le dernier de son hypothèse.' USING ERRCODE = 'MPZ27';
      END IF;
      SELECT max(ev.version) INTO v_courante FROM dd_element_versions ev
        WHERE ev.element_id = v.hypothese_id;
      IF v_courante IS DISTINCT FROM v.hypothese_version THEN
        RAISE EXCEPTION 'L''hypothèse a changé depuis la proposition de ce verdict.'
          USING ERRCODE = 'MPZ27';
      END IF;
      -- Chaque assertion citée est toujours liée dans le même sens, non abandonnée, à la version
      -- photographiée : sinon le verdict reposerait sur une source qui a changé depuis (MPZ27).
      FOR v_citee IN SELECT c.value FROM jsonb_array_elements(v.assertions_citees) c LOOP
        v_id := (v_citee ->> 'assertion_id')::uuid;
        SELECT l.action, l.sens INTO v_lien FROM dd_hypothese_liens l
          WHERE l.hypothese_id = v.hypothese_id AND l.assertion_id = v_id
          ORDER BY l.numero DESC LIMIT 1;
        SELECT av.statut, av.version INTO v_assertion FROM assertion_versions av
          WHERE av.assertion_id = v_id ORDER BY av.version DESC LIMIT 1;
        IF v_lien.action IS DISTINCT FROM 'lier'
           OR v_lien.sens IS DISTINCT FROM (v_citee ->> 'sens')
           OR v_assertion.statut IS NULL OR v_assertion.statut = 'abandonnee'
           OR v_assertion.version IS DISTINCT FROM (v_citee ->> 'version')::integer THEN
          RAISE EXCEPTION 'Une assertion citée a changé depuis la proposition de ce verdict.'
            USING ERRCODE = 'MPZ27';
        END IF;
      END LOOP;
    END IF;
    IF NOT est_associe_dd(NEW.valide_par)
       AND (NEW.valide_par = v.proposee_par
            OR EXISTS (SELECT 1 FROM dd_elements e
                       WHERE e.id = v.hypothese_id AND e.cree_par = NEW.valide_par)
            OR EXISTS (SELECT 1 FROM dd_element_versions ev
                       WHERE ev.element_id = v.hypothese_id AND ev.auteur_id = NEW.valide_par)
            OR EXISTS (
              SELECT 1 FROM jsonb_array_elements(v.assertions_citees) c
                JOIN assertions a ON a.id = (c.value ->> 'assertion_id')::uuid
              WHERE a.cree_par = NEW.valide_par
                 OR EXISTS (SELECT 1 FROM assertion_versions av
                            WHERE av.assertion_id = a.id AND av.cree_par = NEW.valide_par))) THEN
      RAISE EXCEPTION 'Un verdict ne se valide ni par son proposant, ni par l''auteur de l''hypothèse ou d''une assertion citée.'
        USING ERRCODE = 'MPZ25';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER dd_verdict_validations_controle BEFORE INSERT ON dd_verdict_validations
  FOR EACH ROW EXECUTE FUNCTION controler_dd_verdict_validation();
