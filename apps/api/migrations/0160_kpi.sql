-- Pilotage par KPI (service #4, KPI-01 à KPI-04).
--
-- - kpi_parametres  : réglages du cabinet (rappels, délai de grâce, nombre
--   de périodes de dégradation). VALEURS DE DÉPART à faire valider.
-- - kpi_definitions : KPI rattaché à une mission ET à son entreprise
--   cliente (même client, contrôlé). Sens de lecture, nature, fréquence et
--   début de suivi sont FIGÉS après création (ils fixent l'interprétation de
--   l'historique) ; le reste est modifiable et journalisé par l'API.
-- - kpi_cibles      : historique VERSIONNÉ des cibles, en ajout seul. La
--   cible d'une période est la version de plus grand (a_partir_de, version)
--   telle que a_partir_de <= début de la période.
-- - kpi_contributeurs : utilisateurs du portail du client autorisés à
--   saisir les mesures de CE KPI (partage explicite, remplacé en bloc).
-- - kpi_mesures     : mesures datées, en AJOUT SEUL. Une correction est une
--   nouvelle ligne qui `remplace` la précédente (motif obligatoire) ; une
--   annulation est une ligne sans valeur qui remplace la mesure. Une mesure
--   n'est remplacée qu'une fois (index unique) ; la mesure active d'une date
--   est unique ; une chaîne compte au plus 20 corrections puis une annulation
--   (`rang_correction`, MAX_CORRECTIONS_PAR_MESURE de kpi/mesures.ts). Jamais
--   d'UPDATE ni de DELETE, même pour le propriétaire.
--
-- Volume borné (déni de service) : le suivi commence au plus 10 ans avant la
-- création du KPI ; la date d'arrêté (schéma partagé) et la somme des
-- périodes évaluées par requête (kpi/tableau.ts) sont bornées par l'API.
--
-- Portail client (0113) : lecture des KPI de son entreprise ; aucune écriture
-- sauf l'ajout d'une mesure d'origine « portail » par un contributeur désigné
-- (politiques restrictives PAR COMMANDE ci-dessous).
-- - kpi_alertes     : alertes détectées (moteur), une par KPI, code et
--   période (clé d'idempotence) ; kpi_rappels : rappels de mesure en retard,
--   un par KPI et période due. Ajout seul.
--
-- Aucun calcul ici : statuts, taux, tendances, projections et alertes
-- sortent de packages/engines/src/kpi ; les contrôles SQL sont structurels.
-- SQLSTATE du domaine : MPK01 (champ figé), MPK02 (cohérence), MPK03
-- (mesure sur un KPI inactif), MPK04 (mesure en double à la même date),
-- MPK05 (historique en ajout seul), MPK06 (date hors période de suivi),
-- MPK07 (trop de corrections successives d'une même mesure).

CREATE TABLE kpi_parametres (
  cabinet_id uuid PRIMARY KEY REFERENCES cabinets (id) ON DELETE CASCADE,
  rappels_actifs boolean NOT NULL DEFAULT true,
  delai_grace_jours smallint NOT NULL DEFAULT 5 CHECK (delai_grace_jours BETWEEN 0 AND 60),
  periodes_degradation smallint NOT NULL DEFAULT 3 CHECK (periodes_degradation BETWEEN 1 AND 24),
  valeurs_validees boolean NOT NULL DEFAULT false,
  modifie_par uuid,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE kpi_parametres ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON kpi_parametres
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON kpi_parametres AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON kpi_parametres FROM missionpilot_app;

CREATE TABLE kpi_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  client_id uuid NOT NULL,
  libelle text NOT NULL CHECK (length(libelle) BETWEEN 1 AND 200),
  description text CHECK (description IS NULL OR length(description) <= 2000),
  unite text NOT NULL CHECK (length(unite) BETWEEN 1 AND 40),
  perspective text CHECK (perspective IS NULL
    OR perspective IN ('finances', 'clients', 'processus', 'apprentissage')),
  sens text NOT NULL CHECK (sens IN ('plus_haut_mieux', 'plus_bas_mieux')),
  nature text NOT NULL CHECK (nature IN ('flux', 'stock')),
  frequence text NOT NULL
    CHECK (frequence IN ('hebdomadaire', 'mensuelle', 'trimestrielle', 'semestrielle', 'annuelle')),
  ponderation numeric(10, 4) NOT NULL DEFAULT 1 CHECK (ponderation >= 0 AND ponderation <= 1000),
  -- Seuils de statut propres au KPI (sinon 0,95 / 0,80 du moteur, KPI-03).
  seuil_vert numeric(5, 4),
  seuil_orange numeric(5, 4),
  -- Seuils d'alerte KPI-04 : valeur haute, basse, variation relative maximale.
  alerte_haut numeric,
  alerte_bas numeric,
  alerte_variation numeric(9, 4) CHECK (alerte_variation IS NULL
    OR (alerte_variation >= 0 AND alerte_variation <= 100)),
  proprietaire_id uuid,
  debut_suivi date NOT NULL CHECK (debut_suivi BETWEEN '2000-01-01' AND '2100-12-31'),
  fin_suivi date CHECK (fin_suivi IS NULL OR fin_suivi BETWEEN '2000-01-01' AND '2100-12-31'),
  rappels_actifs boolean NOT NULL DEFAULT true,
  actif boolean NOT NULL DEFAULT true,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_par uuid,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((seuil_vert IS NULL) = (seuil_orange IS NULL)),
  CHECK (seuil_vert IS NULL OR (seuil_orange >= 0 AND seuil_orange < seuil_vert AND seuil_vert <= 1)),
  CHECK (alerte_haut IS NULL OR (abs(alerte_haut) < 1e15 AND scale(alerte_haut) <= 6)),
  CHECK (alerte_bas IS NULL OR (abs(alerte_bas) < 1e15 AND scale(alerte_bas) <= 6)),
  CHECK (alerte_haut IS NULL OR alerte_bas IS NULL OR alerte_bas <= alerte_haut),
  CHECK (fin_suivi IS NULL OR fin_suivi >= debut_suivi),
  -- Au plus 10 ans d'historique avant la création (nombre de périodes évaluées borné).
  CONSTRAINT kpi_definitions_debut_suivi_borne
    CHECK (debut_suivi >= (cree_le AT TIME ZONE 'UTC')::date - interval '10 years'),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, proprietaire_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX kpi_definitions_mission_idx ON kpi_definitions (cabinet_id, mission_id, lower(libelle));
CREATE INDEX kpi_definitions_actifs_idx ON kpi_definitions (cabinet_id) WHERE actif;
ALTER TABLE kpi_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON kpi_definitions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
-- Portail (0113) : seulement les KPI de l'entreprise cliente de la session ;
-- l'API restreint EN PLUS aux KPI dont l'utilisateur est contributeur.
CREATE POLICY portail ON kpi_definitions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL OR client_id = app_portail_client_id());
-- Portail en lecture seule. Le verrou `SELECT … FOR UPDATE` de la saisie applique
-- le USING des politiques UPDATE (vrai ici) : il reste possible ; toute
-- modification effective échoue sur le WITH CHECK.
CREATE POLICY portail_sans_modification ON kpi_definitions AS RESTRICTIVE FOR UPDATE
  USING (true) WITH CHECK (app_portail_client_id() IS NULL);
CREATE POLICY portail_sans_creation ON kpi_definitions AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_portail_client_id() IS NULL);
REVOKE DELETE ON kpi_definitions FROM missionpilot_app;

CREATE FUNCTION controler_kpi_definition() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.cabinet_id, NEW.mission_id, NEW.client_id, NEW.sens, NEW.nature,
         NEW.frequence, NEW.debut_suivi, NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.mission_id, OLD.client_id, OLD.sens, OLD.nature,
         OLD.frequence, OLD.debut_suivi, OLD.cree_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'Sens, nature, fréquence, mission et début de suivi d''un KPI sont figés.'
        USING ERRCODE = 'MPK01';
    END IF;
    IF TG_OP = 'INSERT' AND NOT EXISTS (
         SELECT 1 FROM missions m WHERE m.id = NEW.mission_id AND m.client_id = NEW.client_id) THEN
      RAISE EXCEPTION 'Le KPI doit porter sur le client de sa mission.' USING ERRCODE = 'MPK02';
    END IF;
    NEW.modifie_le := now();
    RETURN NEW;
  END $$;
CREATE TRIGGER kpi_definitions_controle BEFORE INSERT OR UPDATE ON kpi_definitions
  FOR EACH ROW EXECUTE FUNCTION controler_kpi_definition();
-- Le propriétaire (responsable notifié) est un membre du cabinet, jamais un utilisateur du portail.
CREATE TRIGGER kpi_definitions_proprietaire_sans_portail
  BEFORE INSERT OR UPDATE OF proprietaire_id ON kpi_definitions
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('proprietaire_id');

-- Ajout seul, même pour le propriétaire de la base.
CREATE FUNCTION refuser_modification_kpi() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Historique KPI en ajout seul : corriger par une nouvelle ligne.'
      USING ERRCODE = 'MPK05';
  END $$;

CREATE TABLE kpi_cibles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  kpi_id uuid NOT NULL,
  version int NOT NULL CHECK (version >= 1),
  -- NULL : « sans cible » à partir de cette période.
  valeur numeric CHECK (valeur IS NULL OR (abs(valeur) < 1e15 AND scale(valeur) <= 6)),
  -- Premier jour d'une période de la fréquence du KPI (normalisé par l'API, moteur).
  a_partir_de date NOT NULL CHECK (a_partir_de BETWEEN '2000-01-01' AND '2100-12-31'),
  motif text CHECK (motif IS NULL OR length(motif) BETWEEN 1 AND 500),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, kpi_id, version),
  FOREIGN KEY (cabinet_id, kpi_id) REFERENCES kpi_definitions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE kpi_cibles ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON kpi_cibles
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail ON kpi_cibles AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL
         OR EXISTS (SELECT 1 FROM kpi_definitions d WHERE d.id = kpi_cibles.kpi_id));
-- Les cibles se définissent dans le cabinet seulement.
CREATE POLICY portail_sans_creation ON kpi_cibles AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_portail_client_id() IS NULL);
CREATE POLICY portail_sans_suppression ON kpi_cibles AS RESTRICTIVE FOR DELETE
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON kpi_cibles FROM missionpilot_app;
CREATE TRIGGER kpi_cibles_ajout_seul BEFORE UPDATE OR DELETE ON kpi_cibles
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_kpi();

-- Numéro de version attribué par la base (l'API verrouille le KPI avant d'écrire).
CREATE FUNCTION numeroter_kpi_cible() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    SELECT coalesce(max(c.version), 0) + 1 INTO NEW.version
      FROM kpi_cibles c WHERE c.kpi_id = NEW.kpi_id;
    RETURN NEW;
  END $$;
CREATE TRIGGER kpi_cibles_version BEFORE INSERT ON kpi_cibles
  FOR EACH ROW EXECUTE FUNCTION numeroter_kpi_cible();

CREATE TABLE kpi_contributeurs (
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  kpi_id uuid NOT NULL,
  utilisateur_id uuid NOT NULL,
  ajoute_par uuid NOT NULL,
  ajoute_le timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cabinet_id, kpi_id, utilisateur_id),
  FOREIGN KEY (cabinet_id, kpi_id) REFERENCES kpi_definitions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, utilisateur_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, ajoute_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX kpi_contributeurs_utilisateur_idx ON kpi_contributeurs (cabinet_id, utilisateur_id);
ALTER TABLE kpi_contributeurs ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON kpi_contributeurs
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail ON kpi_contributeurs AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL
         OR EXISTS (SELECT 1 FROM kpi_definitions d WHERE d.id = kpi_contributeurs.kpi_id));
-- La désignation des contributeurs appartient au cabinet seul.
CREATE POLICY portail_sans_creation ON kpi_contributeurs AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_portail_client_id() IS NULL);
CREATE POLICY portail_sans_modification ON kpi_contributeurs AS RESTRICTIVE FOR UPDATE
  USING (app_portail_client_id() IS NULL);
CREATE POLICY portail_sans_suppression ON kpi_contributeurs AS RESTRICTIVE FOR DELETE
  USING (app_portail_client_id() IS NULL);

-- Un contributeur est un utilisateur du portail du MÊME client, dirigeant ou contributeur.
CREATE FUNCTION controler_kpi_contributeur() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NOT EXISTS (
         SELECT 1 FROM kpi_definitions d
         JOIN utilisateurs_portail up ON up.client_id = d.client_id
         JOIN utilisateurs u ON u.id = up.utilisateur_id
         WHERE d.id = NEW.kpi_id AND up.utilisateur_id = NEW.utilisateur_id
           AND u.roles && ARRAY['client_dirigeant', 'client_contributeur']) THEN
      RAISE EXCEPTION 'Contributeur hors du portail de ce client.' USING ERRCODE = 'MPK02';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER kpi_contributeurs_controle BEFORE INSERT OR UPDATE ON kpi_contributeurs
  FOR EACH ROW EXECUTE FUNCTION controler_kpi_contributeur();

CREATE TABLE kpi_mesures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  kpi_id uuid NOT NULL,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  date_mesure date NOT NULL CHECK (date_mesure BETWEEN '2000-01-01' AND '2100-12-31'),
  valeur numeric CHECK (valeur IS NULL OR (abs(valeur) < 1e15 AND scale(valeur) <= 6)),
  annulation boolean NOT NULL DEFAULT false,
  remplace_id uuid,
  motif text CHECK (motif IS NULL OR length(motif) BETWEEN 1 AND 500),
  commentaire text CHECK (commentaire IS NULL OR length(commentaire) BETWEEN 1 AND 1000),
  justificatif text CHECK (justificatif IS NULL OR length(justificatif) BETWEEN 1 AND 500),
  origine text NOT NULL CHECK (origine IN ('cabinet', 'portail')),
  saisie_par uuid NOT NULL,
  saisie_le timestamptz NOT NULL DEFAULT now(),
  -- Remplacements successifs depuis la mesure d'origine (0) ; calculé par le déclencheur :
  -- au plus 20 corrections, plus l'annulation finale (21).
  rang_correction smallint NOT NULL DEFAULT 0 CHECK (rang_correction BETWEEN 0 AND 21),
  CHECK (annulation = (valeur IS NULL)),
  CHECK (NOT annulation OR remplace_id IS NOT NULL),
  CHECK (remplace_id IS NULL OR motif IS NOT NULL),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, kpi_id) REFERENCES kpi_definitions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, remplace_id) REFERENCES kpi_mesures (cabinet_id, id),
  FOREIGN KEY (cabinet_id, saisie_par) REFERENCES utilisateurs (cabinet_id, id)
);
-- Une mesure n'est remplacée (corrigée ou annulée) qu'une seule fois.
CREATE UNIQUE INDEX kpi_mesures_remplace_uniq ON kpi_mesures (cabinet_id, remplace_id)
  WHERE remplace_id IS NOT NULL;
CREATE INDEX kpi_mesures_kpi_idx ON kpi_mesures (cabinet_id, kpi_id, date_mesure);
ALTER TABLE kpi_mesures ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON kpi_mesures
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail ON kpi_mesures AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL
         OR EXISTS (SELECT 1 FROM kpi_definitions d WHERE d.id = kpi_mesures.kpi_id));
-- Origine prouvée par la transaction : dans le portail, une mesure « portail » saisie
-- par un contributeur DÉSIGNÉ du KPI ; hors portail, une mesure « cabinet ».
CREATE POLICY origine ON kpi_mesures AS RESTRICTIVE FOR INSERT
  WITH CHECK (CASE WHEN app_portail_client_id() IS NULL THEN origine = 'cabinet'
    ELSE origine = 'portail' AND EXISTS (
      SELECT 1 FROM kpi_contributeurs k
      WHERE k.kpi_id = kpi_mesures.kpi_id AND k.utilisateur_id = kpi_mesures.saisie_par) END);
REVOKE UPDATE, DELETE ON kpi_mesures FROM missionpilot_app;
CREATE TRIGGER kpi_mesures_ajout_seul BEFORE UPDATE OR DELETE ON kpi_mesures
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_kpi();

-- Contrôles d'une nouvelle mesure (l'API verrouille le KPI avant d'écrire :
-- les contrôles d'unicité ci-dessous sont sérialisés par KPI).
CREATE FUNCTION controler_kpi_mesure() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_kpi kpi_definitions%ROWTYPE; v_rang int;
  BEGIN
    SELECT * INTO v_kpi FROM kpi_definitions d WHERE d.id = NEW.kpi_id;
    IF NOT FOUND OR NOT v_kpi.actif THEN
      RAISE EXCEPTION 'KPI inactif : aucune mesure ne peut être saisie.' USING ERRCODE = 'MPK03';
    END IF;
    IF NEW.date_mesure < v_kpi.debut_suivi
       OR (v_kpi.fin_suivi IS NOT NULL AND NEW.date_mesure > v_kpi.fin_suivi)
       OR NEW.date_mesure > current_date THEN
      RAISE EXCEPTION 'Date de mesure hors de la période de suivi du KPI.' USING ERRCODE = 'MPK06';
    END IF;
    NEW.rang_correction := 0;
    IF NEW.remplace_id IS NOT NULL THEN
      SELECT m.rang_correction + 1 INTO v_rang FROM kpi_mesures m
        WHERE m.id = NEW.remplace_id AND m.kpi_id = NEW.kpi_id AND NOT m.annulation;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Mesure à corriger inconnue pour ce KPI.' USING ERRCODE = 'MPK02';
      END IF;
      -- Chaîne bornée (MAX_CORRECTIONS_PAR_MESURE, kpi/mesures.ts) : au plus 20
      -- corrections, puis une annulation reste possible (la date se ressaisit).
      IF v_rang > 20 AND NOT NEW.annulation THEN
        RAISE EXCEPTION 'Une mesure se corrige au plus 20 fois : annulez-la puis ressaisissez-la.'
          USING ERRCODE = 'MPK07';
      END IF;
      NEW.rang_correction := v_rang;
    END IF;
    IF NOT NEW.annulation AND EXISTS (
         SELECT 1 FROM kpi_mesures m
         WHERE m.kpi_id = NEW.kpi_id AND m.date_mesure = NEW.date_mesure AND NOT m.annulation
           AND m.id IS DISTINCT FROM NEW.remplace_id
           AND NOT EXISTS (SELECT 1 FROM kpi_mesures r WHERE r.remplace_id = m.id)) THEN
      RAISE EXCEPTION 'Une mesure existe déjà à cette date : corrigez-la.' USING ERRCODE = 'MPK04';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER kpi_mesures_controle BEFORE INSERT ON kpi_mesures
  FOR EACH ROW EXECUTE FUNCTION controler_kpi_mesure();

CREATE TABLE kpi_alertes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  kpi_id uuid NOT NULL,
  code text NOT NULL CHECK (code IN ('DEGRADATION_CONSECUTIVE', 'MESURE_EN_RETARD', 'SEUIL_HAUT',
    'SEUIL_BAS', 'VARIATION')),
  periode_cle text NOT NULL CHECK (periode_cle ~ '^[0-9]{4}(-(W[0-9]{2}|[0-9]{2}|T[1-4]|S[12]))?$'),
  details jsonb NOT NULL DEFAULT '{}',
  detectee_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, kpi_id, code, periode_cle),
  FOREIGN KEY (cabinet_id, kpi_id) REFERENCES kpi_definitions (cabinet_id, id)
);
ALTER TABLE kpi_alertes ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON kpi_alertes
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON kpi_alertes AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON kpi_alertes FROM missionpilot_app;
CREATE TRIGGER kpi_alertes_ajout_seul BEFORE UPDATE OR DELETE ON kpi_alertes
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_kpi();

CREATE TABLE kpi_rappels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  kpi_id uuid NOT NULL,
  periode_cle text NOT NULL CHECK (periode_cle ~ '^[0-9]{4}(-(W[0-9]{2}|[0-9]{2}|T[1-4]|S[12]))?$'),
  destinataires int NOT NULL CHECK (destinataires >= 0),
  envoye_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, kpi_id, periode_cle),
  FOREIGN KEY (cabinet_id, kpi_id) REFERENCES kpi_definitions (cabinet_id, id)
);
ALTER TABLE kpi_rappels ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON kpi_rappels
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON kpi_rappels AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON kpi_rappels FROM missionpilot_app;
CREATE TRIGGER kpi_rappels_ajout_seul BEFORE UPDATE OR DELETE ON kpi_rappels
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_kpi();

-- Tâche quotidienne « kpi_suivi » (clé kpi_suivi:AAAA-MM-JJ) : alertes et
-- rappels de mesure en retard, pour les seuls cabinets ayant un KPI actif
-- suivi à cette date. SECURITY DEFINER : exécutée hors contexte de cabinet.
CREATE FUNCTION planifier_suivi_kpi(p_cle text, p_execute_a timestamptz, p_date date)
  RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_n int;
  BEGIN
    IF p_cle !~ '^kpi_suivi:[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'Clé de suivi KPI invalide.';
    END IF;
    INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle)
      SELECT c.id, 'kpi_suivi', jsonb_build_object('date', p_date), p_execute_a, p_cle
      FROM cabinets c
      WHERE EXISTS (SELECT 1 FROM kpi_definitions d WHERE d.cabinet_id = c.id AND d.actif
                    AND d.debut_suivi <= p_date)
      ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END $$;
REVOKE ALL ON FUNCTION planifier_suivi_kpi(text, timestamptz, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION planifier_suivi_kpi(text, timestamptz, date) TO missionpilot_app;
