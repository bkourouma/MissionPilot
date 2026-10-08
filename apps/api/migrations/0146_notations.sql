-- Notations (service 1, NOT-03 à NOT-08) : une notation par mission (donc
-- par entreprise cliente de la mission), des VERSIONS de calcul en ajout
-- seul, des ajustements motivés en ajout seul et un journal d'événements de
-- revue en ajout seul. Rien ne se modifie ni ne se supprime (MPN01).
--
-- - Chaque calcul (moteur @missionpilot/engines) crée une version : grille,
--   définition du questionnaire et résultat sont COPIÉS et horodatés.
-- - Le statut d'une version est DÉRIVÉ de ses événements : aucun →
--   brouillon ; soumission → en revue ; renvoi → brouillon ; publication →
--   publiée. Seule la DERNIÈRE version d'une notation reçoit ajustements et
--   événements ; on ne recalcule pas une version en revue (MPN02/MPN03).
-- - Une version publiée est immuable ; une correction passe par un nouveau
--   calcul (nouvelle version).
-- - Publication (NOT-07, DECISIONS.md) : SEUL un utilisateur actif au rôle
--   `expert_metier` publie (un associé ne publie pas seul), et il n'est ni
--   l'auteur du calcul, ni l'auteur d'un ajustement, ni celui qui a soumis la
--   version en revue (MPN04, en plus du contrôle applicatif et de la
--   permission « notation.publier »).
-- - Un calcul ne cite que des réponses SOUMISES de son questionnaire (MPN02).

CREATE TABLE notations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  client_id uuid NOT NULL,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, mission_id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX notations_client_idx ON notations (cabinet_id, client_id);
ALTER TABLE notations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON notations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON notations FROM missionpilot_app;

CREATE FUNCTION controler_notation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP <> 'INSERT' THEN
      RAISE EXCEPTION 'Une notation est en ajout seul.' USING ERRCODE = 'MPN01';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM missions m WHERE m.id = NEW.mission_id AND m.client_id = NEW.client_id) THEN
      RAISE EXCEPTION 'Le client de la notation n''est pas celui de la mission.' USING ERRCODE = 'MPN02';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER notations_controle BEFORE INSERT OR UPDATE OR DELETE ON notations
  FOR EACH ROW EXECUTE FUNCTION controler_notation();

CREATE TABLE notation_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  notation_id uuid NOT NULL,
  numero int NOT NULL CHECK (numero BETWEEN 1 AND 100000),
  envoi_id uuid NOT NULL,
  -- NULL : grille générique de MissionPilot (copiée dans `grille`).
  grille_version_id uuid,
  grille jsonb NOT NULL CHECK (jsonb_typeof(grille) = 'object'),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  secteur text CHECK (secteur IS NULL OR secteur ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  strategie text NOT NULL CHECK (strategie IN ('ignorer', 'penaliser')),
  reponses_ids uuid[] NOT NULL CHECK (cardinality(reponses_ids) >= 1),
  resultat jsonb NOT NULL CHECK (jsonb_typeof(resultat) = 'object'),
  ecarts jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(ecarts) = 'array'),
  calcule_par uuid NOT NULL,
  calcule_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, notation_id, numero),
  FOREIGN KEY (cabinet_id, notation_id) REFERENCES notations (cabinet_id, id),
  FOREIGN KEY (cabinet_id, envoi_id) REFERENCES questionnaire_envois (cabinet_id, id),
  FOREIGN KEY (cabinet_id, grille_version_id) REFERENCES notation_grille_versions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, calcule_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE notation_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON notation_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON notation_versions FROM missionpilot_app;

CREATE TABLE notation_ajustements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  version_id uuid NOT NULL,
  rang int NOT NULL CHECK (rang >= 1),
  dimension text NOT NULL CHECK (dimension ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  delta numeric(4, 1) NOT NULL CHECK (delta <> 0 AND delta BETWEEN -100 AND 100),
  motif text NOT NULL CHECK (length(btrim(motif)) BETWEEN 1 AND 2000),
  date_ajustement date NOT NULL CHECK (date_ajustement BETWEEN '2000-01-01' AND '2100-12-31'),
  score_avant numeric(4, 1) NOT NULL CHECK (score_avant BETWEEN 0 AND 100),
  score_apres numeric(4, 1) NOT NULL CHECK (score_apres BETWEEN 0 AND 100),
  plafonne boolean NOT NULL,
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, version_id, rang),
  FOREIGN KEY (cabinet_id, version_id) REFERENCES notation_versions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE notation_ajustements ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON notation_ajustements
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON notation_ajustements FROM missionpilot_app;

CREATE TABLE notation_evenements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  version_id uuid NOT NULL,
  rang int NOT NULL CHECK (rang >= 1),
  action text NOT NULL CHECK (action IN ('soumission', 'renvoi', 'publication')),
  motif text CHECK (motif IS NULL OR length(btrim(motif)) BETWEEN 1 AND 2000),
  par uuid NOT NULL,
  le timestamptz NOT NULL DEFAULT now(),
  CHECK (action <> 'renvoi' OR motif IS NOT NULL),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, version_id, rang),
  FOREIGN KEY (cabinet_id, version_id) REFERENCES notation_versions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE UNIQUE INDEX notation_evenements_publication_uniq ON notation_evenements (cabinet_id, version_id)
  WHERE action = 'publication';
ALTER TABLE notation_evenements ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON notation_evenements
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON notation_evenements FROM missionpilot_app;

/** Statut dérivé d'une version : dernier événement (par rang). */
CREATE FUNCTION notation_version_statut(p_version uuid) RETURNS text
  LANGUAGE sql STABLE
  AS $$
  SELECT CASE (SELECT e.action FROM notation_evenements e WHERE e.version_id = p_version
               ORDER BY e.rang DESC LIMIT 1)
    WHEN 'soumission' THEN 'en_revue'
    WHEN 'publication' THEN 'publiee'
    ELSE 'brouillon' END
  $$;

/** Vrai si la version est la dernière de sa notation. */
CREATE FUNCTION notation_version_derniere(p_version uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
  SELECT v.numero = (SELECT max(w.numero) FROM notation_versions w WHERE w.notation_id = v.notation_id)
  FROM notation_versions v WHERE v.id = p_version
  $$;

CREATE FUNCTION refuser_modification_notation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'L''historique de notation est en ajout seul : créer une nouvelle version.'
      USING ERRCODE = 'MPN01';
  END $$;

-- Nouveau calcul : numéro suivant, questionnaire de la même mission, réponses
-- soumises de CE questionnaire (sans doublon), grille validée, jamais
-- par-dessus une version en revue.
CREATE FUNCTION controler_notation_version() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_precedente uuid; v_max int;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM questionnaire_envois e JOIN notations n ON n.mission_id = e.mission_id
                   WHERE e.id = NEW.envoi_id AND n.id = NEW.notation_id) THEN
      RAISE EXCEPTION 'Le questionnaire n''appartient pas à la mission de la notation.' USING ERRCODE = 'MPN02';
    END IF;
    IF (SELECT count(DISTINCT x) FROM unnest(NEW.reponses_ids) AS x) <> cardinality(NEW.reponses_ids)
       OR EXISTS (SELECT 1 FROM unnest(NEW.reponses_ids) AS x(id)
                  WHERE NOT EXISTS (SELECT 1 FROM questionnaire_reponses q WHERE q.id = x.id
                                    AND q.envoi_id = NEW.envoi_id AND q.statut = 'soumise')) THEN
      RAISE EXCEPTION 'Un calcul ne cite que des réponses soumises de son questionnaire.'
        USING ERRCODE = 'MPN02';
    END IF;
    IF NEW.grille_version_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM notation_grille_versions g WHERE g.id = NEW.grille_version_id AND g.statut = 'valide') THEN
      RAISE EXCEPTION 'Seule une version de grille validée sert au calcul.' USING ERRCODE = 'MPN02';
    END IF;
    SELECT max(numero) INTO v_max FROM notation_versions WHERE notation_id = NEW.notation_id;
    IF NEW.numero <> coalesce(v_max, 0) + 1 THEN
      RAISE EXCEPTION 'Numéro de version de notation inattendu.' USING ERRCODE = 'MPN02';
    END IF;
    SELECT id INTO v_precedente FROM notation_versions WHERE notation_id = NEW.notation_id AND numero = v_max;
    IF v_precedente IS NOT NULL AND notation_version_statut(v_precedente) = 'en_revue' THEN
      RAISE EXCEPTION 'La version en revue doit être publiée ou renvoyée avant un nouveau calcul.'
        USING ERRCODE = 'MPN02';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER notation_versions_controle BEFORE INSERT ON notation_versions
  FOR EACH ROW EXECUTE FUNCTION controler_notation_version();
CREATE TRIGGER notation_versions_ajout_seul BEFORE UPDATE OR DELETE ON notation_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_notation();

-- Ajustement : seulement sur la dernière version, en brouillon, au rang suivant.
CREATE FUNCTION controler_notation_ajustement() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT coalesce(notation_version_derniere(NEW.version_id), false)
       OR notation_version_statut(NEW.version_id) <> 'brouillon' THEN
      RAISE EXCEPTION 'Seule la dernière version, en brouillon, s''ajuste.' USING ERRCODE = 'MPN02';
    END IF;
    IF NEW.rang <> coalesce((SELECT max(rang) FROM notation_ajustements WHERE version_id = NEW.version_id), 0) + 1 THEN
      RAISE EXCEPTION 'Rang d''ajustement inattendu.' USING ERRCODE = 'MPN02';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER notation_ajustements_controle BEFORE INSERT ON notation_ajustements
  FOR EACH ROW EXECUTE FUNCTION controler_notation_ajustement();
CREATE TRIGGER notation_ajustements_ajout_seul BEFORE UPDATE OR DELETE ON notation_ajustements
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_notation();

-- Revue : transitions autorisées ; publication par un expert métier actif,
-- avec séparation des tâches.
CREATE FUNCTION controler_notation_evenement() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_statut text;
  BEGIN
    IF NOT coalesce(notation_version_derniere(NEW.version_id), false) THEN
      RAISE EXCEPTION 'Seule la dernière version d''une notation passe en revue.' USING ERRCODE = 'MPN03';
    END IF;
    IF NEW.rang <> coalesce((SELECT max(rang) FROM notation_evenements WHERE version_id = NEW.version_id), 0) + 1 THEN
      RAISE EXCEPTION 'Rang d''événement inattendu.' USING ERRCODE = 'MPN03';
    END IF;
    v_statut := notation_version_statut(NEW.version_id);
    IF (NEW.action = 'soumission' AND v_statut <> 'brouillon')
       OR (NEW.action IN ('renvoi', 'publication') AND v_statut <> 'en_revue') THEN
      RAISE EXCEPTION 'Transition de revue refusée (statut %).', v_statut USING ERRCODE = 'MPN03';
    END IF;
    IF NEW.action = 'publication' AND NOT EXISTS (
         SELECT 1 FROM utilisateurs u WHERE u.id = NEW.par AND u.actif
         AND 'expert_metier' = ANY (u.roles)) THEN
      RAISE EXCEPTION 'Seul un expert métier publie une notation.' USING ERRCODE = 'MPN04';
    END IF;
    IF NEW.action = 'publication' AND (
         EXISTS (SELECT 1 FROM notation_versions v WHERE v.id = NEW.version_id AND v.calcule_par = NEW.par)
         OR EXISTS (SELECT 1 FROM notation_ajustements a WHERE a.version_id = NEW.version_id AND a.auteur_id = NEW.par)
         OR EXISTS (SELECT 1 FROM notation_evenements e WHERE e.version_id = NEW.version_id
                    AND e.action = 'soumission' AND e.par = NEW.par)) THEN
      RAISE EXCEPTION 'Le publieur ne peut pas être l''auteur du calcul, d''un ajustement ou de la soumission.'
        USING ERRCODE = 'MPN04';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER notation_evenements_controle BEFORE INSERT ON notation_evenements
  FOR EACH ROW EXECUTE FUNCTION controler_notation_evenement();
CREATE TRIGGER notation_evenements_ajout_seul BEFORE UPDATE OR DELETE ON notation_evenements
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_notation();
