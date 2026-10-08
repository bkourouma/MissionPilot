-- Générations IA tracées (SOC-06, ADR-003).
--
-- - ia_demandes : une demande de génération (cycle d'exécution : en file, en
--   cours, terminée, échec, annulée), son prompt (nom + version), l'entité
--   liée facultative et le demandeur. L'ENTRÉE envoyée au modèle n'est PAS
--   stockée en clair : seulement son empreinte HMAC à clé dérivée et la liste
--   des champs. Une demande en file porte son entrée CHIFFRÉE dans la charge
--   de son job, effacée à la fin du job ou à l'annulation.
-- - ia_generations : EN AJOUT SEUL. Une ligne par version du contenu :
--   version 1 « brouillon_ia » produite par le modèle (ou par le gabarit
--   déterministe, `gabarit` vrai) ; une modification humaine ajoute une
--   version « modifie » ; la validation ajoute une version « valide » au
--   même texte, qui FIGE le contenu (plus aucune version ensuite).
-- - ia_consommations : EN AJOUT SEUL. Un appel facturé au fournisseur
--   (succès, sortie invalide, demande annulée pendant l'appel) : modèle,
--   jetons, coût estimé en micro-dollars US. Source des coûts et du plafond.

CREATE TABLE ia_demandes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  tache text NOT NULL
    CHECK (tache IN ('redaction', 'analyse', 'extraction', 'classification', 'embedding')),
  prompt_id uuid NOT NULL,
  prompt_nom text NOT NULL,
  prompt_version int NOT NULL,
  mission_id uuid,
  entite_type text CHECK (entite_type IS NULL OR entite_type ~ '^[a-z][a-z_]{0,39}$'),
  entite_id uuid,
  demandeur_id uuid NOT NULL,
  statut text NOT NULL DEFAULT 'en_file'
    CHECK (statut IN ('en_file', 'en_cours', 'terminee', 'echec', 'annulee')),
  progression smallint NOT NULL DEFAULT 0 CHECK (progression BETWEEN 0 AND 100),
  job_id uuid,
  repli_si_plafond boolean NOT NULL DEFAULT false,
  entree_empreinte text NOT NULL CHECK (entree_empreinte ~ '^[0-9a-f]{64}$'),
  entree_cle_version smallint NOT NULL,
  entree_champs text[] NOT NULL CHECK (cardinality(entree_champs) <= 40),
  erreur_code text CHECK (erreur_code IS NULL OR erreur_code ~ '^[A-Z_]{1,60}$'),
  cree_le timestamptz NOT NULL DEFAULT now(),
  termine_le timestamptz,
  UNIQUE (cabinet_id, id),
  CHECK ((entite_type IS NULL) = (entite_id IS NULL)),
  CHECK ((statut IN ('terminee', 'echec', 'annulee')) = (termine_le IS NOT NULL)),
  FOREIGN KEY (cabinet_id, prompt_id) REFERENCES ia_prompts (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, demandeur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX ia_demandes_liste_idx ON ia_demandes (cabinet_id, cree_le DESC, id DESC);
CREATE INDEX ia_demandes_mission_idx ON ia_demandes (cabinet_id, mission_id) WHERE mission_id IS NOT NULL;
ALTER TABLE ia_demandes ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ia_demandes
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON ia_demandes FROM missionpilot_app;

-- Identité figée ; une demande terminée, en échec ou annulée ne change plus.
CREATE FUNCTION controler_ia_demande() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une demande IA n''est jamais supprimée.' USING ERRCODE = 'MPI01';
    END IF;
    IF (NEW.id, NEW.cabinet_id, NEW.tache, NEW.prompt_id, NEW.prompt_nom, NEW.prompt_version,
        NEW.mission_id, NEW.entite_type, NEW.entite_id, NEW.demandeur_id, NEW.entree_empreinte,
        NEW.entree_cle_version, NEW.entree_champs, NEW.cree_le, NEW.repli_si_plafond)
       IS DISTINCT FROM
       (OLD.id, OLD.cabinet_id, OLD.tache, OLD.prompt_id, OLD.prompt_nom, OLD.prompt_version,
        OLD.mission_id, OLD.entite_type, OLD.entite_id, OLD.demandeur_id, OLD.entree_empreinte,
        OLD.entree_cle_version, OLD.entree_champs, OLD.cree_le, OLD.repli_si_plafond) THEN
      RAISE EXCEPTION 'Identité d''une demande IA figée.' USING ERRCODE = 'MPI03';
    END IF;
    IF OLD.statut IN ('terminee', 'echec', 'annulee') THEN
      RAISE EXCEPTION 'Demande IA terminée : plus aucun changement.' USING ERRCODE = 'MPI03';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER ia_demandes_controle BEFORE UPDATE OR DELETE ON ia_demandes
  FOR EACH ROW EXECUTE FUNCTION controler_ia_demande();

CREATE TABLE ia_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  demande_id uuid NOT NULL,
  version int NOT NULL CHECK (version BETWEEN 1 AND 10000),
  statut_contenu text NOT NULL CHECK (statut_contenu IN ('brouillon_ia', 'modifie', 'valide')),
  fournisseur text NOT NULL CHECK (fournisseur IN ('openrouter', 'gabarit', 'humain')),
  modele text,
  duree_ms int CHECK (duree_ms IS NULL OR duree_ms >= 0),
  tokens_entree int CHECK (tokens_entree IS NULL OR tokens_entree >= 0),
  tokens_sortie int CHECK (tokens_sortie IS NULL OR tokens_sortie >= 0),
  cout_micro_usd bigint NOT NULL DEFAULT 0 CHECK (cout_micro_usd >= 0),
  texte text NOT NULL CHECK (length(texte) <= 100000),
  donnees jsonb,
  sources jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(sources) = 'array'),
  gabarit boolean NOT NULL,
  chiffres_non_verifies boolean NOT NULL,
  nombres_non_verifies jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(nombres_non_verifies) = 'array'),
  chiffres_acquittes boolean NOT NULL DEFAULT false,
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (demande_id, version),
  CHECK (statut_contenu <> 'valide' OR NOT chiffres_non_verifies OR chiffres_acquittes),
  CHECK ((version = 1) = (statut_contenu = 'brouillon_ia')),
  CHECK ((version = 1) = (fournisseur <> 'humain')),
  FOREIGN KEY (cabinet_id, demande_id) REFERENCES ia_demandes (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX ia_generations_demande_idx ON ia_generations (demande_id, version DESC);
ALTER TABLE ia_generations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ia_generations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON ia_generations FROM missionpilot_app;

CREATE TRIGGER ia_generations_ajout_seul BEFORE UPDATE OR DELETE ON ia_generations
  FOR EACH ROW EXECUTE FUNCTION ia_ajout_seul();

-- Versions consécutives ; la version 1 seulement pour une demande en cours
-- d'exécution ; rien après une validation ; une validation reprend le texte
-- et l'état des chiffres de la version qu'elle valide.
CREATE FUNCTION controler_ia_generation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_prec ia_generations%ROWTYPE;
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended('ia_generation:' || NEW.demande_id::text, 0));
    SELECT * INTO v_prec FROM ia_generations
      WHERE demande_id = NEW.demande_id ORDER BY version DESC LIMIT 1;
    IF NEW.version <> coalesce(v_prec.version, 0) + 1 THEN
      RAISE EXCEPTION 'Version de contenu non consécutive.' USING ERRCODE = 'MPI04';
    END IF;
    IF v_prec.statut_contenu = 'valide' THEN
      RAISE EXCEPTION 'Contenu validé : définitif.' USING ERRCODE = 'MPI04';
    END IF;
    IF NEW.statut_contenu = 'valide'
       AND (NEW.texte IS DISTINCT FROM v_prec.texte
            OR NEW.donnees IS DISTINCT FROM v_prec.donnees
            OR NEW.chiffres_non_verifies IS DISTINCT FROM v_prec.chiffres_non_verifies) THEN
      RAISE EXCEPTION 'Une validation reprend le contenu validé tel quel.' USING ERRCODE = 'MPI04';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER ia_generations_controle BEFORE INSERT ON ia_generations
  FOR EACH ROW EXECUTE FUNCTION controler_ia_generation();

CREATE TABLE ia_consommations (
  id bigserial PRIMARY KEY,
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  -- NULL pour l'appel minimal de POST /api/ia/parametres/tester (issue « test »).
  demande_id uuid,
  mission_id uuid,
  tache text NOT NULL,
  modele text NOT NULL,
  issue text NOT NULL CHECK (issue IN ('succes', 'sortie_invalide', 'annulee', 'test')),
  tokens_entree int NOT NULL CHECK (tokens_entree >= 0),
  tokens_sortie int NOT NULL CHECK (tokens_sortie >= 0),
  cout_micro_usd bigint NOT NULL CHECK (cout_micro_usd >= 0),
  tarif_connu boolean NOT NULL,
  duree_ms int NOT NULL CHECK (duree_ms >= 0),
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((issue = 'test') = (demande_id IS NULL)),
  FOREIGN KEY (cabinet_id, demande_id) REFERENCES ia_demandes (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id)
);
CREATE INDEX ia_consommations_mois_idx ON ia_consommations (cabinet_id, cree_le);
CREATE INDEX ia_consommations_mission_idx ON ia_consommations (cabinet_id, mission_id)
  WHERE mission_id IS NOT NULL;
ALTER TABLE ia_consommations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ia_consommations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON ia_consommations FROM missionpilot_app;

CREATE TRIGGER ia_consommations_ajout_seul BEFORE UPDATE OR DELETE ON ia_consommations
  FOR EACH ROW EXECUTE FUNCTION ia_ajout_seul();
