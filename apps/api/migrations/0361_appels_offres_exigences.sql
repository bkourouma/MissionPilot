-- Exigences d'un dossier d'appel d'offres et matrice de conformité (AO-03), lot AO-A.
--
-- - ao_dossiers : texte du dossier (collé, ou lu d'un fichier texte téléversé : seule son
--   empreinte et son nom sont gardés, jamais de clé vers `fichiers`), en AJOUT SEUL. Contenu
--   NON FIABLE (AGT-07) : il n'entre dans un prompt qu'encadré par l'orchestrateur ; les signaux
--   d'injection relevés sont conservés pour la relecture.
-- - ao_extractions : exigences PROPOSÉES (orchestrateur IA, ou découpage déterministe en repli),
--   brouillon tranché une seule fois par un humain (validée : les exigences retenues entrent dans
--   la matrice ; rejetée).
-- - ao_exigences : lignes de la matrice de conformité ; libellé, catégorie et caractère
--   obligatoire figés ; statut, commentaire, pièce et responsable évoluent jusqu'au dépôt, puis
--   la matrice est figée.
-- - ao_exigences_suivi : chaque état d'une ligne, en AJOUT SEUL, écrit par déclencheur.
--
-- SQLSTATE (lettre A, 0360) : MPA01 ajout seul ou champ figé ; MPA04 dépôt avec une exigence
-- obligatoire non satisfaite ou une matrice vide ; MPA05 extraction déjà tranchée ou
-- incohérente ; MPA06 matrice figée hors préparation de la réponse.

CREATE TABLE ao_dossiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  ao_id uuid NOT NULL,
  numero int NOT NULL CHECK (numero >= 1),
  source text NOT NULL CHECK (source IN ('texte', 'fichier')),
  nom_fichier text CHECK (nom_fichier IS NULL OR length(nom_fichier) BETWEEN 1 AND 255),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  texte text NOT NULL CHECK (length(texte) BETWEEN 1 AND 200000),
  signaux_injection text[] NOT NULL DEFAULT '{}' CHECK (cardinality(signaux_injection) <= 20),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, ao_id, id),
  UNIQUE (cabinet_id, ao_id, numero),
  CHECK ((source = 'fichier') = (nom_fichier IS NOT NULL)),
  FOREIGN KEY (cabinet_id, ao_id) REFERENCES appels_offres (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE ao_dossiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ao_dossiers
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON ao_dossiers AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON ao_dossiers FROM missionpilot_app;
CREATE TRIGGER ao_dossiers_ajout_seul BEFORE UPDATE OR DELETE ON ao_dossiers
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_ao();

CREATE TABLE ao_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  ao_id uuid NOT NULL,
  dossier_id uuid NOT NULL,
  methode text NOT NULL CHECK (methode IN ('ia', 'deterministe')),
  ia_demande_id uuid,
  -- Repli déterministe utilisé (IA indisponible ou sortie inexploitable).
  gabarit boolean NOT NULL,
  chiffres_non_verifies boolean NOT NULL DEFAULT false,
  tronque boolean NOT NULL DEFAULT false,
  propositions jsonb NOT NULL CHECK (jsonb_typeof(propositions) = 'array'),
  nombre int NOT NULL CHECK (nombre BETWEEN 0 AND 200),
  statut text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'validee', 'rejetee')),
  retenues int[] CHECK (retenues IS NULL OR cardinality(retenues) <= 200),
  motif text CHECK (motif IS NULL OR length(motif) BETWEEN 1 AND 1000),
  tranche_par uuid,
  tranche_le timestamptz,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, ao_id, id),
  CHECK ((statut = 'brouillon') = (tranche_par IS NULL AND tranche_le IS NULL)),
  CHECK (methode = 'ia' OR ia_demande_id IS NULL),
  FOREIGN KEY (cabinet_id, ao_id) REFERENCES appels_offres (cabinet_id, id),
  FOREIGN KEY (cabinet_id, ao_id, dossier_id) REFERENCES ao_dossiers (cabinet_id, ao_id, id),
  FOREIGN KEY (cabinet_id, ia_demande_id) REFERENCES ia_demandes (cabinet_id, id),
  FOREIGN KEY (cabinet_id, tranche_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX ao_extractions_ao_idx ON ao_extractions (cabinet_id, ao_id, cree_le DESC);
ALTER TABLE ao_extractions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ao_extractions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON ao_extractions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON ao_extractions FROM missionpilot_app;

-- Une extraction se tranche une fois (brouillon → validée ou rejetée) ; le reste est figé.
CREATE FUNCTION controler_extraction_ao() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une extraction ne se supprime pas.' USING ERRCODE = 'MPA01';
    END IF;
    IF (NEW.cabinet_id, NEW.ao_id, NEW.dossier_id, NEW.methode, NEW.ia_demande_id, NEW.gabarit,
        NEW.chiffres_non_verifies, NEW.tronque, NEW.propositions, NEW.nombre, NEW.cree_par,
        NEW.cree_le)
       IS DISTINCT FROM
       (OLD.cabinet_id, OLD.ao_id, OLD.dossier_id, OLD.methode, OLD.ia_demande_id, OLD.gabarit,
        OLD.chiffres_non_verifies, OLD.tronque, OLD.propositions, OLD.nombre, OLD.cree_par,
        OLD.cree_le) THEN
      RAISE EXCEPTION 'Les propositions d''une extraction sont figées.' USING ERRCODE = 'MPA01';
    END IF;
    IF OLD.statut <> 'brouillon' OR NEW.statut = 'brouillon' THEN
      RAISE EXCEPTION 'Cette extraction est déjà tranchée.' USING ERRCODE = 'MPA05';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER ao_extractions_controle BEFORE UPDATE OR DELETE ON ao_extractions
  FOR EACH ROW EXECUTE FUNCTION controler_extraction_ao();

CREATE TABLE ao_exigences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  ao_id uuid NOT NULL,
  numero int NOT NULL CHECK (numero BETWEEN 1 AND 2000),
  libelle text NOT NULL CHECK (length(btrim(libelle)) >= 1 AND length(libelle) <= 1000),
  categorie text NOT NULL CHECK (categorie IN
    ('administrative', 'technique', 'financiere', 'references', 'personnel', 'autre')),
  obligatoire boolean NOT NULL,
  reference text CHECK (reference IS NULL OR length(reference) BETWEEN 1 AND 60),
  origine text NOT NULL CHECK (origine IN ('manuelle', 'extraction')),
  extraction_id uuid,
  statut text NOT NULL DEFAULT 'a_traiter' CHECK (statut IN
    ('a_traiter', 'en_cours', 'conforme', 'partiel', 'non_conforme', 'sans_objet')),
  commentaire text CHECK (commentaire IS NULL OR length(commentaire) BETWEEN 1 AND 2000),
  piece text CHECK (piece IS NULL OR length(piece) BETWEEN 1 AND 300),
  responsable_id uuid,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_par uuid NOT NULL,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, ao_id, numero),
  CHECK ((origine = 'extraction') = (extraction_id IS NOT NULL)),
  -- Écarter une exigence obligatoire (« sans objet ») se motive.
  CHECK (statut <> 'sans_objet' OR NOT obligatoire OR commentaire IS NOT NULL),
  FOREIGN KEY (cabinet_id, ao_id) REFERENCES appels_offres (cabinet_id, id),
  FOREIGN KEY (cabinet_id, ao_id, extraction_id)
    REFERENCES ao_extractions (cabinet_id, ao_id, id),
  FOREIGN KEY (cabinet_id, responsable_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE ao_exigences ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ao_exigences
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON ao_exigences AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON ao_exigences FROM missionpilot_app;
CREATE TRIGGER ao_exigences_responsable_sans_portail
  BEFORE INSERT OR UPDATE OF responsable_id ON ao_exigences
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('responsable_id');

-- La matrice ne change que pendant la préparation de la réponse ; l'identité d'une exigence
-- (libellé, catégorie, caractère obligatoire, origine) est figée.
CREATE FUNCTION controler_exigence_ao() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une exigence ne se supprime pas : la déclarer sans objet.'
        USING ERRCODE = 'MPA01';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.cabinet_id, NEW.ao_id, NEW.numero, NEW.libelle, NEW.categorie,
        NEW.obligatoire, NEW.reference, NEW.origine, NEW.extraction_id, NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.ao_id, OLD.numero, OLD.libelle, OLD.categorie,
        OLD.obligatoire, OLD.reference, OLD.origine, OLD.extraction_id, OLD.cree_par, OLD.cree_le)
    THEN
      RAISE EXCEPTION 'L''identité d''une exigence est figée.' USING ERRCODE = 'MPA01';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM appels_offres a WHERE a.id = NEW.ao_id
                   AND a.statut IN ('detecte', 'go_no_go', 'en_reponse')) THEN
      RAISE EXCEPTION 'La matrice de conformité est figée hors préparation de la réponse.'
        USING ERRCODE = 'MPA06';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER ao_exigences_controle BEFORE INSERT OR UPDATE OR DELETE ON ao_exigences
  FOR EACH ROW EXECUTE FUNCTION controler_exigence_ao();

CREATE TABLE ao_exigences_suivi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  exigence_id uuid NOT NULL,
  statut text NOT NULL,
  commentaire text,
  piece text,
  responsable_id uuid,
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, exigence_id) REFERENCES ao_exigences (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX ao_exigences_suivi_idx ON ao_exigences_suivi (cabinet_id, exigence_id, cree_le);
ALTER TABLE ao_exigences_suivi ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ao_exigences_suivi
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON ao_exigences_suivi AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON ao_exigences_suivi FROM missionpilot_app;
CREATE TRIGGER ao_exigences_suivi_ajout_seul BEFORE UPDATE OR DELETE ON ao_exigences_suivi
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_ao();

-- Chaque état d'une ligne est tracé, quel que soit le chemin d'écriture.
CREATE FUNCTION tracer_exigence_ao() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'INSERT' OR (NEW.statut, NEW.commentaire, NEW.piece, NEW.responsable_id)
       IS DISTINCT FROM (OLD.statut, OLD.commentaire, OLD.piece, OLD.responsable_id) THEN
      INSERT INTO ao_exigences_suivi (cabinet_id, exigence_id, statut, commentaire, piece,
        responsable_id, auteur_id, cree_le)
      VALUES (NEW.cabinet_id, NEW.id, NEW.statut, NEW.commentaire, NEW.piece, NEW.responsable_id,
        NEW.modifie_par, NEW.modifie_le);
    END IF;
    RETURN NULL;
  END $$;
CREATE TRIGGER ao_exigences_trace AFTER INSERT OR UPDATE ON ao_exigences
  FOR EACH ROW EXECUTE FUNCTION tracer_exigence_ao();

-- Dépôt (AO-03) : matrice non vide et toutes les exigences obligatoires conformes ou sans objet
-- (doublé par `syntheseConformite` du moteur, 409 côté API).
CREATE OR REPLACE FUNCTION controler_appel_offres() RETURNS trigger
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
      IF NEW.statut = 'depose' AND (
           NOT EXISTS (SELECT 1 FROM ao_exigences x WHERE x.ao_id = NEW.id)
           OR EXISTS (SELECT 1 FROM ao_exigences x WHERE x.ao_id = NEW.id AND x.obligatoire
                      AND x.statut NOT IN ('conforme', 'sans_objet'))) THEN
        RAISE EXCEPTION 'Dépôt refusé : la matrice de conformité n''est pas satisfaite.'
          USING ERRCODE = 'MPA04';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
