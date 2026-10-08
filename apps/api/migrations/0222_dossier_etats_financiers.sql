-- États financiers multi-exercices du client (DOS-03, PRD complémentaire §5).
--
-- Un état est ingéré par saisie structurée, CSV ou classeur Excel ; chaque ligne garde la
-- référence de sa valeur dans la source (fichier, feuille, cellule, ligne ou page). Le
-- moteur `controlerEtatFinancier` (packages/engines/src/dossier) contrôle l'équilibre à
-- l'ingestion ; ses constats sont conservés avec l'état. L'extraction par l'IA depuis un
-- PDF n'est pas encore branchée (lot ultérieur) : la colonne `origine` l'accueillera.
--
-- Garanties tenues en base, même si le code applicatif était contourné :
-- - tout est en ajout seul (MPO01) ; une correction est un nouvel état qui remplace le
--   précédent du même exercice (MPO02) ; un seul état courant (ni remplacé ni rejeté) par
--   client et exercice (MPO02) ;
-- - les lignes naissent dans la transaction de leur état, avant toute décision (MPO04) ;
-- - JAMAIS d'acceptation silencieuse (MPO04) : une acceptation automatique exige que tous
--   les contrôles du moteur passent (`controles_ok`) et naît avec l'état ; une acceptation
--   humaine d'un état dont des contrôles échouent exige un motif ; une décision unique, et
--   jamais sur un état remplacé (MPO03).
-- La séparation des tâches (l'importateur ne force pas lui-même un état en écart, sauf
-- associé) est contrôlée par `apps/api/src/dossier/etats.ts`.

CREATE TABLE dossier_etats_financiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  exercice integer NOT NULL CHECK (exercice BETWEEN 1990 AND 2100),
  date_cloture date NOT NULL CHECK (date_cloture BETWEEN '1990-01-01' AND '2101-12-31'),
  devise text NOT NULL CHECK (devise IN ('XOF', 'XAF', 'EUR', 'USD')),
  origine text NOT NULL CHECK (origine IN ('saisie', 'csv', 'excel')),
  source_libelle text CHECK (source_libelle IS NULL OR length(btrim(source_libelle)) BETWEEN 1 AND 300),
  -- Fichier analysé (jamais conservé) : nom assaini, empreinte et taille du contenu reçu.
  fichier_nom text CHECK (fichier_nom IS NULL OR length(fichier_nom) BETWEEN 1 AND 200),
  fichier_sha256 text CHECK (fichier_sha256 IS NULL OR fichier_sha256 ~ '^[0-9a-f]{64}$'),
  fichier_taille integer CHECK (fichier_taille IS NULL OR fichier_taille BETWEEN 1 AND 10485760),
  tolerance bigint NOT NULL DEFAULT 0 CHECK (tolerance BETWEEN 0 AND 1000000),
  -- Constats du moteur à l'ingestion : contrôles passés (conforme ET complet) ou non.
  controles jsonb NOT NULL CHECK (jsonb_typeof(controles) = 'array'),
  totaux jsonb NOT NULL CHECK (jsonb_typeof(totaux) = 'object'),
  conforme boolean NOT NULL,
  complet boolean NOT NULL,
  controles_ok boolean NOT NULL,
  remplace_id uuid,
  importe_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK (controles_ok = (conforme AND complet)),
  CHECK ((origine = 'saisie') = (fichier_sha256 IS NULL)),
  CHECK (remplace_id IS NULL OR remplace_id <> id),
  UNIQUE (cabinet_id, id),
  UNIQUE (remplace_id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, remplace_id) REFERENCES dossier_etats_financiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, importe_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX dossier_etats_client_idx
  ON dossier_etats_financiers (cabinet_id, client_id, exercice, cree_le);
ALTER TABLE dossier_etats_financiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dossier_etats_financiers
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dossier_etats_financiers AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dossier_etats_financiers FROM missionpilot_app;

CREATE TABLE dossier_etats_lignes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  etat_id uuid NOT NULL,
  rang integer NOT NULL CHECK (rang BETWEEN 1 AND 1000),
  code text NOT NULL CHECK (code ~ '^[A-Za-z0-9_.-]{1,40}$'),
  libelle text NOT NULL CHECK (length(btrim(libelle)) BETWEEN 1 AND 200),
  section text NOT NULL CHECK (section IN ('actif', 'passif', 'charges', 'produits', 'resultat')),
  montant bigint NOT NULL CHECK (montant BETWEEN -1000000000000000 AND 1000000000000000),
  parent_code text CHECK (parent_code IS NULL OR parent_code ~ '^[A-Za-z0-9_.-]{1,40}$'),
  role text CHECK (role IS NULL OR role IN ('total', 'resultat_exercice', 'resultat_net')),
  -- Référence de la valeur : fichier, feuille, cellule, ligne ou page.
  reference jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(reference) = 'object'
    AND octet_length(reference::text) <= 1000),
  UNIQUE (cabinet_id, id),
  UNIQUE (etat_id, rang),
  UNIQUE (etat_id, code),
  FOREIGN KEY (cabinet_id, etat_id) REFERENCES dossier_etats_financiers (cabinet_id, id)
);
ALTER TABLE dossier_etats_lignes ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dossier_etats_lignes
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dossier_etats_lignes AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dossier_etats_lignes FROM missionpilot_app;

CREATE TABLE dossier_etats_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  etat_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('accepte', 'rejete')),
  -- Automatique : tous les contrôles passent ; le système décide, sans décideur humain.
  automatique boolean NOT NULL,
  motif text CHECK (motif IS NULL OR length(btrim(motif)) BETWEEN 1 AND 2000),
  decideur_id uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK (automatique = (decideur_id IS NULL)),
  CHECK (NOT automatique OR decision = 'accepte'),
  CHECK (decision <> 'rejete' OR motif IS NOT NULL),
  UNIQUE (cabinet_id, id),
  UNIQUE (etat_id),
  FOREIGN KEY (cabinet_id, etat_id) REFERENCES dossier_etats_financiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, decideur_id) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE dossier_etats_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dossier_etats_decisions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dossier_etats_decisions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dossier_etats_decisions FROM missionpilot_app;
CREATE TRIGGER dossier_etats_decisions_ajout_seul BEFORE UPDATE OR DELETE ON dossier_etats_decisions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dossier();

-- Un seul état courant par client et exercice ; un remplacement vise l'état courant.
CREATE FUNCTION controler_dossier_etat() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_courant uuid;
  BEGIN
    IF TG_OP <> 'INSERT' THEN
      RAISE EXCEPTION 'Le dossier client est en ajout seul : corriger par un nouvel enregistrement.'
        USING ERRCODE = 'MPO01';
    END IF;
    SELECT e.id INTO v_courant FROM dossier_etats_financiers e
      WHERE e.client_id = NEW.client_id AND e.exercice = NEW.exercice
        AND NOT EXISTS (SELECT 1 FROM dossier_etats_financiers r WHERE r.remplace_id = e.id)
        AND NOT EXISTS (SELECT 1 FROM dossier_etats_decisions d
                        WHERE d.etat_id = e.id AND d.decision = 'rejete')
      LIMIT 1;
    IF v_courant IS DISTINCT FROM NEW.remplace_id THEN
      RAISE EXCEPTION 'Un nouvel état financier remplace l''état courant du même exercice, et lui seul.'
        USING ERRCODE = 'MPO02';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER dossier_etats_controle BEFORE INSERT OR UPDATE OR DELETE ON dossier_etats_financiers
  FOR EACH ROW EXECUTE FUNCTION controler_dossier_etat();

-- Lignes : dans la transaction de leur état, avant toute décision.
CREATE FUNCTION controler_dossier_etat_ligne() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP <> 'INSERT' THEN
      RAISE EXCEPTION 'Le dossier client est en ajout seul : corriger par un nouvel enregistrement.'
        USING ERRCODE = 'MPO01';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM dossier_etats_financiers e
                   WHERE e.id = NEW.etat_id AND e.cree_le = now())
       OR EXISTS (SELECT 1 FROM dossier_etats_decisions d WHERE d.etat_id = NEW.etat_id) THEN
      RAISE EXCEPTION 'Les lignes d''un état financier sont figées après son ingestion.'
        USING ERRCODE = 'MPO04';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER dossier_etats_lignes_controle BEFORE INSERT OR UPDATE OR DELETE ON dossier_etats_lignes
  FOR EACH ROW EXECUTE FUNCTION controler_dossier_etat_ligne();

-- Décision : jamais sur un état remplacé ; jamais d'acceptation silencieuse.
CREATE FUNCTION controler_dossier_etat_decision() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_etat record;
  BEGIN
    SELECT e.controles_ok, e.cree_le INTO v_etat FROM dossier_etats_financiers e
      WHERE e.id = NEW.etat_id;
    IF EXISTS (SELECT 1 FROM dossier_etats_financiers r WHERE r.remplace_id = NEW.etat_id) THEN
      RAISE EXCEPTION 'Un état financier remplacé ne reçoit plus de décision.' USING ERRCODE = 'MPO03';
    END IF;
    IF NEW.automatique AND (NOT v_etat.controles_ok OR v_etat.cree_le <> now()) THEN
      RAISE EXCEPTION 'Acceptation automatique refusée : tous les contrôles doivent passer à l''ingestion.'
        USING ERRCODE = 'MPO04';
    END IF;
    IF NOT NEW.automatique AND NEW.decision = 'accepte' AND NOT v_etat.controles_ok
       AND NEW.motif IS NULL THEN
      RAISE EXCEPTION 'Accepter un état dont des contrôles échouent exige un motif.'
        USING ERRCODE = 'MPO04';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER dossier_etats_decisions_controle BEFORE INSERT ON dossier_etats_decisions
  FOR EACH ROW EXECUTE FUNCTION controler_dossier_etat_decision();
