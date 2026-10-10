-- Appels d'offres (AO-01, AO-02, PRD complémentaire §9), lot AO-A, plage 0360–0379.
--
-- - appels_offres : fiche d'un appel d'offres saisie ou importée À LA MAIN (aucun connecteur
--   externe : la veille multi-sources viendra par des adaptateurs) ; cycle de vie
--   détecté → go/no-go → en réponse → déposé → gagné ou perdu, ou no-go. Le score de
--   rapprochement (AO-01) sort du moteur packages/engines/src/appels-offres ; la base ne fait
--   que le conserver.
-- - appels_offres_evenements : journal des changements de statut, en AJOUT SEUL.
-- - ao_evaluations : scores go/no-go calculés par le moteur (AO-02), en AJOUT SEUL ; les entrées
--   portent la marge estimée (FIN-02), retirée des réponses sans `finance.lire` par l'API.
-- - ao_decisions : décision go ou no-go d'un ASSOCIÉ, motivée, en AJOUT SEUL.
--
-- SQLSTATE du domaine (lettre A, « Appels d'offres ») :
-- MPA01 historique en ajout seul ou champ figé ; MPA02 transition de statut refusée ;
-- MPA03 décision absente, d'un non-associé ou incohérente ; MPA04 dépôt avec une exigence
-- obligatoire non satisfaite (0361) ; MPA05 extraction déjà tranchée (0361) ;
-- MPA06 matrice ou rétro-planning figés hors réponse (0361, 0362).
-- Le portail client n'y accède jamais (politique restrictive `portail_interdit`).

CREATE FUNCTION refuser_modification_ao() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Historique des appels d''offres en ajout seul.' USING ERRCODE = 'MPA01';
  END $$;

CREATE TABLE appels_offres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  reference text CHECK (reference IS NULL OR length(reference) BETWEEN 1 AND 80),
  titre text NOT NULL CHECK (length(btrim(titre)) >= 1 AND length(titre) <= 300),
  objet text CHECK (objet IS NULL OR length(objet) <= 4000),
  bailleur text CHECK (bailleur IS NULL OR length(bailleur) <= 150),
  pays text CHECK (pays IS NULL OR pays ~ '^[A-Z]{2}$'),
  secteur text CHECK (secteur IS NULL OR length(secteur) <= 120),
  montant_estime bigint CHECK (montant_estime IS NULL OR montant_estime >= 0),
  devise text NOT NULL DEFAULT 'XOF' CHECK (devise IN ('XOF', 'XAF', 'EUR', 'USD')),
  date_publication date CHECK (date_publication IS NULL
    OR date_publication BETWEEN '2000-01-01' AND '2100-12-31'),
  date_limite date CHECK (date_limite IS NULL OR date_limite BETWEEN '2000-01-01' AND '2100-12-31'),
  source text NOT NULL CHECK (source IN ('saisie', 'import')),
  source_libelle text CHECK (source_libelle IS NULL OR length(source_libelle) <= 150),
  -- Adresse de l'avis, jamais visitée par le serveur ; http(s) seulement (affichée en lien).
  url text CHECK (url IS NULL OR (length(url) <= 500 AND url ~* '^https?://[^\s<>"]+$')),
  mots_cles text[] NOT NULL DEFAULT '{}' CHECK (cardinality(mots_cles) <= 30),
  statut text NOT NULL DEFAULT 'detecte'
    CHECK (statut IN ('detecte', 'go_no_go', 'en_reponse', 'depose', 'gagne', 'perdu', 'no_go')),
  score_rapprochement smallint NOT NULL CHECK (score_rapprochement BETWEEN 0 AND 100),
  rapprochement jsonb NOT NULL,
  responsable_id uuid,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, responsable_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
-- Une référence d'avis n'est importée qu'une fois par cabinet (sans casse).
CREATE UNIQUE INDEX appels_offres_reference_uniq
  ON appels_offres (cabinet_id, lower(reference)) WHERE reference IS NOT NULL;
CREATE INDEX appels_offres_liste_idx ON appels_offres (cabinet_id, cree_le DESC, id DESC);
CREATE INDEX appels_offres_statut_idx ON appels_offres (cabinet_id, statut, date_limite);
ALTER TABLE appels_offres ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON appels_offres
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON appels_offres AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON appels_offres FROM missionpilot_app;
CREATE TRIGGER appels_offres_responsable_sans_portail
  BEFORE INSERT OR UPDATE OF responsable_id ON appels_offres
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('responsable_id');

CREATE TABLE appels_offres_evenements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  ao_id uuid NOT NULL,
  de_statut text CHECK (de_statut IS NULL OR de_statut IN
    ('detecte', 'go_no_go', 'en_reponse', 'depose', 'gagne', 'perdu', 'no_go')),
  vers_statut text NOT NULL CHECK (vers_statut IN
    ('detecte', 'go_no_go', 'en_reponse', 'depose', 'gagne', 'perdu', 'no_go')),
  motif text CHECK (motif IS NULL OR length(motif) BETWEEN 1 AND 2000),
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, ao_id) REFERENCES appels_offres (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX appels_offres_evenements_ao_idx
  ON appels_offres_evenements (cabinet_id, ao_id, cree_le);
ALTER TABLE appels_offres_evenements ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON appels_offres_evenements
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON appels_offres_evenements AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON appels_offres_evenements FROM missionpilot_app;
CREATE TRIGGER appels_offres_evenements_ajout_seul
  BEFORE UPDATE OR DELETE ON appels_offres_evenements
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_ao();

CREATE TABLE ao_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  ao_id uuid NOT NULL,
  numero int NOT NULL CHECK (numero >= 1),
  -- Entrées du moteur (dont la marge estimée, FIN-02) et résultat complet.
  entrees jsonb NOT NULL,
  score smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  recommandation text NOT NULL CHECK (recommandation IN ('go', 'a_examiner', 'no_go')),
  resultat jsonb NOT NULL,
  marge_renseignee boolean NOT NULL,
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, ao_id, id),
  UNIQUE (cabinet_id, ao_id, numero),
  FOREIGN KEY (cabinet_id, ao_id) REFERENCES appels_offres (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE ao_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ao_evaluations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON ao_evaluations AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON ao_evaluations FROM missionpilot_app;
CREATE TRIGGER ao_evaluations_ajout_seul BEFORE UPDATE OR DELETE ON ao_evaluations
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_ao();

CREATE TABLE ao_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  ao_id uuid NOT NULL,
  evaluation_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('go', 'no_go')),
  motif text NOT NULL CHECK (length(btrim(motif)) >= 10 AND length(motif) <= 2000),
  decideur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, ao_id) REFERENCES appels_offres (cabinet_id, id),
  -- L'évaluation citée est celle de la même fiche.
  FOREIGN KEY (cabinet_id, ao_id, evaluation_id) REFERENCES ao_evaluations (cabinet_id, ao_id, id),
  FOREIGN KEY (cabinet_id, decideur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX ao_decisions_ao_idx ON ao_decisions (cabinet_id, ao_id, cree_le DESC);
ALTER TABLE ao_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ao_decisions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON ao_decisions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON ao_decisions FROM missionpilot_app;
CREATE TRIGGER ao_decisions_ajout_seul BEFORE UPDATE OR DELETE ON ao_decisions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_ao();

-- Le décideur est un associé ACTIF (AO-02, doublé par `ao.decider` côté API) ; la fiche est en
-- go/no-go ou en réponse (un no-go peut arrêter une réponse engagée) ; l'évaluation citée est la
-- DERNIÈRE de la fiche.
CREATE FUNCTION controler_decision_ao() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_statut text;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM utilisateurs u WHERE u.id = NEW.decideur_id AND u.actif
                   AND 'associe' = ANY (u.roles)) THEN
      RAISE EXCEPTION 'La décision go/no-go revient à un associé.' USING ERRCODE = 'MPA03';
    END IF;
    SELECT a.statut INTO v_statut FROM appels_offres a WHERE a.id = NEW.ao_id FOR UPDATE;
    IF v_statut NOT IN ('go_no_go', 'en_reponse')
       OR (v_statut = 'en_reponse' AND NEW.decision = 'go') THEN
      RAISE EXCEPTION 'Aucune décision go/no-go attendue pour cet appel d''offres.'
        USING ERRCODE = 'MPA03';
    END IF;
    IF NEW.evaluation_id IS DISTINCT FROM (
         SELECT e.id FROM ao_evaluations e WHERE e.ao_id = NEW.ao_id
         ORDER BY e.numero DESC LIMIT 1) THEN
      RAISE EXCEPTION 'La décision porte sur la dernière évaluation go/no-go.'
        USING ERRCODE = 'MPA03';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER ao_decisions_controle BEFORE INSERT ON ao_decisions
  FOR EACH ROW EXECUTE FUNCTION controler_decision_ao();

-- Cycle de vie (doublé par `transitionAppelOffresAutorisee` du moteur) : identité figée,
-- transitions admises seulement, « en réponse » et « no-go » adossés à la dernière décision
-- de l'associé.
CREATE FUNCTION controler_appel_offres() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_decision text;
  BEGIN
    IF (NEW.cabinet_id, NEW.cree_par, NEW.cree_le, NEW.source)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.cree_par, OLD.cree_le, OLD.source) THEN
      RAISE EXCEPTION 'Identité d''un appel d''offres figée.' USING ERRCODE = 'MPA01';
    END IF;
    IF NEW.statut IS DISTINCT FROM OLD.statut THEN
      IF NOT ((OLD.statut = 'detecte' AND NEW.statut = 'go_no_go')
           OR (OLD.statut = 'go_no_go' AND NEW.statut IN ('en_reponse', 'no_go'))
           OR (OLD.statut = 'en_reponse' AND NEW.statut IN ('depose', 'no_go'))
           OR (OLD.statut = 'depose' AND NEW.statut IN ('gagne', 'perdu'))) THEN
        RAISE EXCEPTION 'Transition de statut refusée pour un appel d''offres.'
          USING ERRCODE = 'MPA02';
      END IF;
      IF NEW.statut IN ('en_reponse', 'no_go') THEN
        SELECT d.decision INTO v_decision FROM ao_decisions d WHERE d.ao_id = NEW.id
          ORDER BY d.cree_le DESC, d.id DESC LIMIT 1;
        IF v_decision IS DISTINCT FROM (CASE NEW.statut WHEN 'en_reponse' THEN 'go' ELSE 'no_go' END)
        THEN
          RAISE EXCEPTION 'Ce statut exige la décision correspondante d''un associé.'
            USING ERRCODE = 'MPA03';
        END IF;
      END IF;
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER appels_offres_controle BEFORE UPDATE ON appels_offres
  FOR EACH ROW EXECUTE FUNCTION controler_appel_offres();
