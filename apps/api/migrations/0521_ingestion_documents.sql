-- Ingestion de documents (lot 6, ADR-009) : DOS-03 (états financiers PDF / Excel / liasse), DD-02 (rapports),
-- DD-10 (salle de données), STD-13 (amorçage du standard).
--
-- Un document téléversé est ANALYSÉ, jamais conservé : l'objet de stockage est effacé à la fin du traitement
-- (`fichier_id` repasse à NULL) ; restent son empreinte, son nom assaini, sa taille et le TEXTE de ses pages
-- (`ingestion_pages`), seule source des références de page. Aucune clé étrangère vers `fichiers` : la purge des
-- orphelins (`fichier_orphelin`) n'est donc pas concernée et reste inchangée.
--
-- Chaîne : en_file -> extraction (texte des pages) -> structuration (IA ou règles, puis contrôles par les moteurs)
-- -> termine, ou echec (code d'erreur sans contenu). Le résultat n'est JAMAIS une décision : un état financier
-- passe par les contrôles du moteur (DOS-03), une lecture ou une proposition est un brouillon à valider
-- (`ingestion_extractions`, 0522).
--
-- SQLSTATE : MQG01 (transition de statut ou identité d'un document), MQG03 (rattachement : version cible).

CREATE TABLE ingestion_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  usage text NOT NULL CHECK (usage IN ('etat_financier', 'dd_rapport', 'dd_salle', 'standard_historique')),
  client_id uuid,
  dd_dossier_id uuid,
  version_methode_id uuid REFERENCES methode_versions (id),
  -- Nom ASSAINI (sans chemin, contrôle ni caractère réservé) : jamais le nom reçu tel quel.
  nom text NOT NULL CHECK (length(nom) BETWEEN 1 AND 200 AND nom !~ '[/\\[:cntrl:]]' AND nom NOT IN ('.', '..')),
  format text NOT NULL CHECK (format IN ('pdf', 'xlsx')),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  taille integer NOT NULL CHECK (taille BETWEEN 1 AND 10485760),
  -- Objet de stockage TEMPORAIRE : NULL une fois le document traité (aucune clé étrangère, voir l'en-tête).
  fichier_id uuid,
  -- Paramètres de l'usage (état financier : exercice, date_cloture, devise, tolerance) ; objet borné.
  parametres jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(parametres) = 'object' AND octet_length(parametres::text) <= 2000),
  statut text NOT NULL DEFAULT 'en_file' CHECK (statut IN ('en_file', 'extraction', 'structuration', 'termine', 'echec')),
  -- Résultat de la structuration : état créé, brouillon créé, IA indisponible (à relancer), rien d'exploitable.
  resultat text CHECK (resultat IS NULL OR resultat IN ('etat_cree', 'brouillon_cree', 'ia_indisponible', 'rien_trouve')),
  methode text CHECK (methode IS NULL OR methode IN ('texte', 'ocr_simule', 'tableur')),
  nb_pages integer CHECK (nb_pages IS NULL OR nb_pages BETWEEN 1 AND 200),
  nb_caracteres integer CHECK (nb_caracteres IS NULL OR nb_caracteres BETWEEN 0 AND 2000000),
  erreur_code text CHECK (erreur_code IS NULL OR erreur_code ~ '^[A-Z_]{1,60}$'),
  etat_financier_id uuid,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  termine_le timestamptz,
  -- Dernier demandeur d'une lecture (téléversement : cree_par ; relance : l'utilisateur qui relance) : il ne valide
  -- pas le brouillon qui en résulte (MQG02), sauf associé.
  derniere_demande_par uuid,
  -- Texte des pages purgé (conservation : décision de l'utilisateur du 2026-10-22, tranchée + 90 jours) ; fonction
  -- `purger_textes_ingestion` (0524). Les références de page restent, le texte n'existe plus.
  texte_purge_le timestamptz,
  UNIQUE (cabinet_id, id),
  CHECK (usage <> 'etat_financier' OR (client_id IS NOT NULL AND dd_dossier_id IS NULL AND version_methode_id IS NULL)),
  CHECK (usage NOT IN ('dd_rapport', 'dd_salle') OR (dd_dossier_id IS NOT NULL AND client_id IS NULL AND version_methode_id IS NULL)),
  CHECK (usage <> 'standard_historique' OR (version_methode_id IS NOT NULL AND client_id IS NULL AND dd_dossier_id IS NULL)),
  CHECK (etat_financier_id IS NULL OR usage = 'etat_financier'),
  CHECK ((statut = 'echec') = (erreur_code IS NOT NULL)),
  CHECK ((statut IN ('termine', 'echec')) = (termine_le IS NOT NULL)),
  CHECK (statut <> 'termine' OR resultat IS NOT NULL),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, dd_dossier_id) REFERENCES dd_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, etat_financier_id) REFERENCES dossier_etats_financiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, derniere_demande_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX ingestion_documents_client_idx ON ingestion_documents (cabinet_id, client_id, cree_le DESC, id)
  WHERE client_id IS NOT NULL;
CREATE INDEX ingestion_documents_dd_idx ON ingestion_documents (cabinet_id, dd_dossier_id, cree_le DESC, id)
  WHERE dd_dossier_id IS NOT NULL;
CREATE INDEX ingestion_documents_version_idx ON ingestion_documents (cabinet_id, version_methode_id, cree_le DESC, id)
  WHERE version_methode_id IS NOT NULL;
CREATE INDEX ingestion_documents_statut_idx ON ingestion_documents (cabinet_id, statut);
ALTER TABLE ingestion_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ingestion_documents
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON ingestion_documents AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON ingestion_documents FROM missionpilot_app;
CREATE TRIGGER ingestion_documents_auteur_sans_portail BEFORE INSERT ON ingestion_documents
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('cree_par');

-- Machine à états et identité (MQG01) ; version cible d'un amorçage (MQG03) : brouillon du cabinet.
CREATE FUNCTION controler_ingestion_document() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_version record;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Un document ingéré ne se supprime pas.' USING ERRCODE = 'MQG01';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.statut <> 'en_file' OR NEW.resultat IS NOT NULL OR NEW.etat_financier_id IS NOT NULL THEN
        RAISE EXCEPTION 'Un document ingéré naît « en_file », sans résultat.' USING ERRCODE = 'MQG01';
      END IF;
      IF NEW.version_methode_id IS NOT NULL THEN
        SELECT v.cabinet_id, v.statut INTO v_version FROM methode_versions v WHERE v.id = NEW.version_methode_id;
        IF v_version.cabinet_id IS DISTINCT FROM NEW.cabinet_id OR v_version.statut <> 'brouillon' THEN
          RAISE EXCEPTION 'La version cible est un brouillon du cabinet.' USING ERRCODE = 'MQG03';
        END IF;
      END IF;
      RETURN NEW;
    END IF;
    IF (NEW.cabinet_id, NEW.usage, NEW.client_id, NEW.dd_dossier_id, NEW.version_methode_id, NEW.nom,
        NEW.format, NEW.sha256, NEW.taille, NEW.parametres, NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM
       (OLD.cabinet_id, OLD.usage, OLD.client_id, OLD.dd_dossier_id, OLD.version_methode_id, OLD.nom,
        OLD.format, OLD.sha256, OLD.taille, OLD.parametres, OLD.cree_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'Document ingéré : identité non modifiable.' USING ERRCODE = 'MQG01';
    END IF;
    IF OLD.statut IN ('termine', 'echec') THEN
      -- Terminal : seuls passent la relance d'une structuration (termine -> structuration, voir ci-dessous) et la
      -- datation, une fois, de la purge du texte des pages (fonction purger_textes_ingestion, 0524).
      IF NOT (
           (OLD.statut = 'termine' AND NEW.statut = 'structuration' AND OLD.usage <> 'etat_financier'
            AND OLD.texte_purge_le IS NULL)
        OR (NEW.statut = OLD.statut AND OLD.texte_purge_le IS NULL AND NEW.texte_purge_le IS NOT NULL
            AND (to_jsonb(NEW) - 'texte_purge_le') = (to_jsonb(OLD) - 'texte_purge_le'))) THEN
        RAISE EXCEPTION 'Document ingéré terminé : non modifiable.' USING ERRCODE = 'MQG01';
      END IF;
    END IF;
    IF NEW.statut <> OLD.statut AND NOT (
         (OLD.statut = 'en_file' AND NEW.statut IN ('extraction', 'echec'))
      OR (OLD.statut = 'extraction' AND NEW.statut IN ('en_file', 'structuration', 'echec'))
      OR (OLD.statut = 'structuration' AND NEW.statut IN ('termine', 'echec'))
      OR (OLD.statut = 'termine' AND NEW.statut = 'structuration')) THEN
      RAISE EXCEPTION 'Document ingéré : transition % vers % refusée.', OLD.statut, NEW.statut
        USING ERRCODE = 'MQG01';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER ingestion_documents_controle BEFORE INSERT OR UPDATE OR DELETE ON ingestion_documents
  FOR EACH ROW EXECUTE FUNCTION controler_ingestion_document();

-- Texte des pages : ajout seul. Une page d'un tableur est une feuille ; `confiance_pm` (0 à 1000) n'existe que
-- pour une page reconnue par OCR. Le texte est un contenu CLIENT NON FIABLE (AGT-07) avant tout prompt.
CREATE TABLE ingestion_pages (
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  document_id uuid NOT NULL,
  numero integer NOT NULL CHECK (numero BETWEEN 1 AND 200),
  texte text NOT NULL CHECK (length(texte) <= 30000),
  methode text NOT NULL CHECK (methode IN ('texte', 'ocr_simule', 'tableur')),
  confiance_pm smallint CHECK (confiance_pm IS NULL OR confiance_pm BETWEEN 0 AND 1000),
  CHECK ((methode = 'ocr_simule') = (confiance_pm IS NOT NULL)),
  PRIMARY KEY (document_id, numero),
  FOREIGN KEY (cabinet_id, document_id) REFERENCES ingestion_documents (cabinet_id, id)
);
ALTER TABLE ingestion_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ingestion_pages
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON ingestion_pages AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON ingestion_pages FROM missionpilot_app;
