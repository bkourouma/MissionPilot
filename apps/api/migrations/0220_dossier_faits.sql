-- Dossier client vivant (DOS-01, DOS-02, PRD complémentaire §5) : faits datés et sourcés.
--
-- Un fait porte une catégorie, une clé (code de référentiel), une valeur TYPÉE
-- (jsonb de la forme de `valeurFaitSchema`, packages/shared/src/schemas/dossier.ts),
-- une date d'effet, une source (type, libellé, document et page éventuels,
-- référence), une fiabilité A à D, un auteur et une origine (saisie humaine ou
-- extraction par l'IA d'un document client).
--
-- Historique en AJOUT SEUL (MPO01) : jamais d'UPDATE ni de DELETE. Une
-- correction est un NOUVEAU fait qui en remplace un autre (`remplace_id`, un
-- remplaçant au plus par fait, même client, même catégorie, même clé ; un fait
-- rejeté ne se remplace pas : MPO02). Le statut se DÉRIVE : rejeté ou confirmé
-- par la décision (au plus une par fait, ajout seul), remplacé s'il a un
-- remplaçant, proposé sinon. Une décision ne porte pas sur un fait remplacé ;
-- un fait extrait par l'IA ne naît jamais confirmé : sa confirmation est une
-- transaction distincte de son extraction (MPO03, DECISIONS.md « chiffre
-- extrait d'un document client »). La séparation des tâches (le décideur
-- d'une proposition humaine n'en est pas l'auteur, sauf associé) est
-- contrôlée par `apps/api/src/dossier/faits.ts`.
--
-- Interne au cabinet : rien de visible ni de modifiable depuis le portail client.
-- SQLSTATE de la lettre O (dOssier client) : MPO01 à MPO05.

CREATE TABLE dossier_faits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  categorie text NOT NULL CHECK (categorie IN ('profil', 'organisation', 'processus',
    'produits_marches', 'finances', 'risques', 'parties_prenantes')),
  cle text NOT NULL CHECK (cle ~ '^[a-z0-9_.-]{1,120}$'),
  type_valeur text NOT NULL CHECK (type_valeur IN ('texte', 'nombre', 'montant', 'date', 'booleen')),
  valeur jsonb NOT NULL CHECK (jsonb_typeof(valeur) = 'object'
    AND octet_length(valeur::text) <= 8000 AND valeur ->> 'type' = type_valeur),
  date_effet date NOT NULL CHECK (date_effet BETWEEN '1900-01-01' AND '2100-12-31'),
  source_type text NOT NULL CHECK (source_type IN ('questionnaire', 'entretien', 'observation',
    'document', 'donnee_externe')),
  source_libelle text NOT NULL CHECK (length(btrim(source_libelle)) BETWEEN 1 AND 300),
  source_document_id uuid,
  source_page integer CHECK (source_page BETWEEN 1 AND 100000),
  source_reference text CHECK (source_reference IS NULL OR length(source_reference) BETWEEN 1 AND 120),
  fiabilite text NOT NULL CHECK (fiabilite IN ('A', 'B', 'C', 'D')),
  origine text NOT NULL CHECK (origine IN ('saisie', 'ia')),
  commentaire text CHECK (commentaire IS NULL OR length(commentaire) BETWEEN 1 AND 2000),
  remplace_id uuid,
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK (source_type = 'document' OR (source_document_id IS NULL AND source_page IS NULL)),
  CHECK (remplace_id IS NULL OR remplace_id <> id),
  UNIQUE (cabinet_id, id),
  -- Un fait n'a qu'un remplaçant : l'historique d'une valeur est une chaîne.
  UNIQUE (remplace_id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, remplace_id) REFERENCES dossier_faits (cabinet_id, id),
  FOREIGN KEY (cabinet_id, source_document_id) REFERENCES fichiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX dossier_faits_client_idx
  ON dossier_faits (cabinet_id, client_id, categorie, cle, date_effet, cree_le);
ALTER TABLE dossier_faits ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dossier_faits
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dossier_faits AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dossier_faits FROM missionpilot_app;

CREATE TABLE dossier_faits_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  fait_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('confirme', 'rejete')),
  motif text CHECK (motif IS NULL OR length(btrim(motif)) BETWEEN 1 AND 2000),
  decideur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK (decision <> 'rejete' OR motif IS NOT NULL),
  UNIQUE (cabinet_id, id),
  UNIQUE (fait_id),
  FOREIGN KEY (cabinet_id, fait_id) REFERENCES dossier_faits (cabinet_id, id),
  FOREIGN KEY (cabinet_id, decideur_id) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE dossier_faits_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dossier_faits_decisions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dossier_faits_decisions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dossier_faits_decisions FROM missionpilot_app;

-- Ajout seul, commun à toutes les tables du dossier client (0220 à 0223).
CREATE FUNCTION refuser_modification_dossier() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Le dossier client est en ajout seul : corriger par un nouvel enregistrement.'
      USING ERRCODE = 'MPO01';
  END $$;

CREATE TRIGGER dossier_faits_decisions_ajout_seul BEFORE UPDATE OR DELETE ON dossier_faits_decisions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dossier();

-- Remplacement cohérent : même client, même catégorie, même clé ; jamais un fait rejeté.
-- Lectures dans le contexte RLS de l'écriture (même cabinet, garanti par les clés composites).
CREATE FUNCTION controler_dossier_fait() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_ancien record;
  BEGIN
    IF TG_OP <> 'INSERT' THEN
      RAISE EXCEPTION 'Le dossier client est en ajout seul : corriger par un nouvel enregistrement.'
        USING ERRCODE = 'MPO01';
    END IF;
    IF NEW.remplace_id IS NOT NULL THEN
      SELECT f.client_id, f.categorie, f.cle INTO v_ancien FROM dossier_faits f
        WHERE f.id = NEW.remplace_id AND f.cabinet_id = NEW.cabinet_id;
      IF v_ancien.client_id IS DISTINCT FROM NEW.client_id
         OR v_ancien.categorie IS DISTINCT FROM NEW.categorie
         OR v_ancien.cle IS DISTINCT FROM NEW.cle THEN
        RAISE EXCEPTION 'Un fait ne remplace qu''un fait du même client, de même catégorie et de même clé.'
          USING ERRCODE = 'MPO02';
      END IF;
      IF EXISTS (SELECT 1 FROM dossier_faits_decisions d
                 WHERE d.fait_id = NEW.remplace_id AND d.decision = 'rejete') THEN
        RAISE EXCEPTION 'Un fait rejeté ne se remplace pas.' USING ERRCODE = 'MPO02';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER dossier_faits_controle BEFORE INSERT OR UPDATE OR DELETE ON dossier_faits
  FOR EACH ROW EXECUTE FUNCTION controler_dossier_fait();

-- Décision cohérente : jamais sur un fait remplacé ; un fait extrait par l'IA n'est jamais
-- confirmé dans la transaction qui l'a créé (now() = début de la transaction).
CREATE FUNCTION controler_dossier_fait_decision() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_fait record;
  BEGIN
    SELECT f.origine, f.cree_le INTO v_fait FROM dossier_faits f
      WHERE f.id = NEW.fait_id AND f.cabinet_id = NEW.cabinet_id;
    IF EXISTS (SELECT 1 FROM dossier_faits r WHERE r.remplace_id = NEW.fait_id) THEN
      RAISE EXCEPTION 'Un fait remplacé ne reçoit plus de décision.' USING ERRCODE = 'MPO03';
    END IF;
    IF v_fait.origine = 'ia' AND NEW.decision = 'confirme' AND v_fait.cree_le = now() THEN
      RAISE EXCEPTION 'Un fait extrait par l''IA est confirmé par un humain, jamais à sa création.'
        USING ERRCODE = 'MPO03';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER dossier_faits_decisions_controle BEFORE INSERT ON dossier_faits_decisions
  FOR EACH ROW EXECUTE FUNCTION controler_dossier_fait_decision();
