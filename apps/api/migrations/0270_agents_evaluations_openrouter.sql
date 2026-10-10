-- Agents IA : rejeu RÉEL des évaluations de non-régression sur OpenRouter (AGT-04, ADR-005).
--
-- Jusqu'ici, seules des évaluations sur le fournisseur LOCAL déterministe existaient (0264,
-- 0265) : admises hors production seulement, elles ne suffisent pas à activer un prompt ou un
-- modèle en production. Cette migration prépare le rejeu sur le vrai fournisseur par la file
-- `jobs` (job `agents_evaluation_openrouter`, plafonné en coût).
--
-- SQLSTATE (lettre G) :
--   MPG09 demande d'évaluation incohérente : transition d'état interdite, demande terminée
--         modifiée, jeu ou prompt étranger, résultat rattaché à une demande qui n'est pas en
--         cours, évaluation « openrouter » sans demande ni appel enregistré (cf. plus bas),
--         demande « reussie » sans évaluation.
--
-- - agents_evaluations_demandes : une DEMANDE de rejeu (ligne MUTABLE : en_file → en_cours →
--   état terminal, jamais modifiée ensuite). États : en_file, en_cours, reussie, echouee,
--   incomplete, ignoree. « ignoree » : aucun appel fait (coupe-circuit IA du cabinet ou de
--   l'agent, clé absente) et rien d'écrit dans agents_evaluations ; la cause dit pourquoi.
--   Coût, jetons et progression y sont tenus à jour cas par cas. Une seule demande en file
--   ou en cours PAR CABINET : index unique partiel (le rejeu est payant et occupe la file
--   `jobs`, partagée entre cabinets : pas de rejeux en rafale).
-- - agents_evaluations (ajout seul) : colonnes `statut` (reussie, echouee, incomplete ; NULL pour
--   les évaluations locales antérieures), `cause`, jetons, `demande_id`. Le coût existait déjà
--   (cout_micro_usd). La contrainte « réussie = tous les cas réussis » est relâchée en « réussie
--   exige tous les cas réussis » : une évaluation dont tous les cas ont réussi mais qui a dépassé
--   le plafond de coût est INCOMPLÈTE, jamais réussie. La règle d'aptitude de 0265
--   (prompt_evalue : fournisseur openrouter OU réglage local, ET réussie) reconnaît telle quelle
--   une évaluation `openrouter` réussie ; une évaluation incomplète ou échouée a reussie = false.
--
--   GARDE DE PROVENANCE (défense en profondeur de la garde MPG04 d'activation en production) : une
--   évaluation `openrouter` n'existe que née d'une DEMANDE de rejeu (demande_id et statut non NULL,
--   CHECK) ; si elle est RÉUSSIE, le déclencheur exige en plus, pour cette demande, au moins
--   `cas_total` appels inscrits dans ia_consommations en issue `succes` (un appel réussi par cas
--   candidat) et le même nombre de cas que la demande. Côté demande, l'état « reussie » exige une
--   évaluation réussie qui en provient, et une demande « en_file » ne passe qu'à « en_cours »,
--   « echouee » ou « ignoree ».
--   LIMITE RESTANTE (dette) : ces gardes arrêtent un INSERT direct, un code qui oublierait la
--   provenance ou une injection qui ne contrôle qu'une table ; elles n'arrêtent PAS le même rôle
--   applicatif exécutant du SQL arbitraire (il peut forger la demande, les appels inscrits et
--   l'évaluation, dans cet ordre). La garde complète exigerait une fonction SECURITY DEFINER
--   réservée au job, seule habilitée à écrire ces trois lignes, avec REVOKE INSERT/UPDATE pour le
--   rôle applicatif : non faite ici, notée en dette.
-- - ia_consommations : colonne `evaluation_demande_id` ; les appels d'une évaluation n'ont pas de
--   demande de génération (ia_demandes) mais comptent dans le plafond mensuel du cabinet comme
--   toute génération (couts.ts les somme sans distinction).

CREATE TABLE agents_evaluations_demandes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  jeu_id uuid NOT NULL,
  prompt_id uuid NOT NULL,
  modele text NOT NULL
    CHECK (modele ~ '^[a-z0-9][a-z0-9._-]{0,63}/[a-z0-9][a-z0-9._-]{0,99}(:[a-z0-9._-]{1,30})?$'),
  statut text NOT NULL DEFAULT 'en_file'
    CHECK (statut IN ('en_file', 'en_cours', 'reussie', 'echouee', 'incomplete', 'ignoree')),
  -- Code de la cause d'un état terminal autre que « reussie » (PLAFOND_EVALUATION, …).
  cause text CHECK (cause IS NULL OR cause ~ '^[A-Z][A-Z0-9_]{2,59}$'),
  evaluation_id uuid,
  cas_total int NOT NULL CHECK (cas_total BETWEEN 1 AND 50),
  cas_traites int NOT NULL DEFAULT 0 CHECK (cas_traites BETWEEN 0 AND cas_total),
  appels int NOT NULL DEFAULT 0 CHECK (appels >= 0),
  tokens_entree bigint NOT NULL DEFAULT 0 CHECK (tokens_entree >= 0),
  tokens_sortie bigint NOT NULL DEFAULT 0 CHECK (tokens_sortie >= 0),
  cout_micro_usd bigint NOT NULL DEFAULT 0 CHECK (cout_micro_usd >= 0),
  -- Estimation prudente avant lancement et plafond appliqué à CETTE évaluation (µUSD).
  cout_estime_micro_usd bigint NOT NULL CHECK (cout_estime_micro_usd >= 0),
  plafond_evaluation_micro_usd bigint NOT NULL CHECK (plafond_evaluation_micro_usd >= 0),
  demande_par uuid NOT NULL,
  job_id uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  debut_le timestamptz,
  termine_le timestamptz,
  UNIQUE (cabinet_id, id),
  CHECK (statut <> 'reussie' OR evaluation_id IS NOT NULL),
  CHECK (statut <> 'ignoree' OR cause IS NOT NULL),
  CHECK (statut IN ('en_file', 'en_cours') OR termine_le IS NOT NULL),
  FOREIGN KEY (cabinet_id, jeu_id) REFERENCES agents_jeux_essai (cabinet_id, id),
  FOREIGN KEY (cabinet_id, prompt_id) REFERENCES ia_prompts (cabinet_id, id),
  FOREIGN KEY (cabinet_id, demande_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX agents_evaluations_demandes_liste_idx
  ON agents_evaluations_demandes (cabinet_id, cree_le DESC, id DESC);
CREATE INDEX agents_evaluations_demandes_prompt_idx
  ON agents_evaluations_demandes (cabinet_id, prompt_id, cree_le DESC);
-- Une seule demande en file ou en cours par cabinet : pas de double dépense, pas de rafale qui
-- occuperait la file de jobs (partagée entre cabinets). Le quota sur 24 h est compté par l'API.
CREATE UNIQUE INDEX agents_evaluations_demandes_unique_en_cours
  ON agents_evaluations_demandes (cabinet_id)
  WHERE statut IN ('en_file', 'en_cours');
ALTER TABLE agents_evaluations_demandes ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON agents_evaluations_demandes
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON agents_evaluations_demandes AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON agents_evaluations_demandes FROM missionpilot_app;

CREATE FUNCTION controler_agents_evaluation_demande() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.statut <> 'en_file' THEN
        RAISE EXCEPTION 'Une demande d''évaluation naît « en_file ».' USING ERRCODE = 'MPG09';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM agents_jeux_essai j JOIN ia_prompts p ON p.nom = j.prompt_nom
                     WHERE j.id = NEW.jeu_id AND p.id = NEW.prompt_id
                       AND j.cabinet_id = NEW.cabinet_id AND p.cabinet_id = NEW.cabinet_id) THEN
        RAISE EXCEPTION 'Demande d''évaluation : prompt étranger au jeu d''essai.'
          USING ERRCODE = 'MPG09';
      END IF;
      RETURN NEW;
    END IF;
    -- UPDATE : l'identité de la demande ne change pas ; un état terminal est définitif ;
    -- « en_cours » ne revient pas à « en_file ».
    IF NEW.cabinet_id <> OLD.cabinet_id OR NEW.jeu_id <> OLD.jeu_id
       OR NEW.prompt_id <> OLD.prompt_id OR NEW.modele <> OLD.modele
       OR NEW.demande_par <> OLD.demande_par OR NEW.cout_estime_micro_usd <> OLD.cout_estime_micro_usd
       OR NEW.plafond_evaluation_micro_usd <> OLD.plafond_evaluation_micro_usd
       OR NEW.cas_total <> OLD.cas_total OR NEW.cree_le <> OLD.cree_le THEN
      RAISE EXCEPTION 'Demande d''évaluation : identité non modifiable.' USING ERRCODE = 'MPG09';
    END IF;
    IF OLD.statut NOT IN ('en_file', 'en_cours')
       OR (OLD.statut = 'en_cours' AND NEW.statut = 'en_file') THEN
      RAISE EXCEPTION 'Demande d''évaluation terminée ou en cours : état non modifiable.'
        USING ERRCODE = 'MPG09';
    END IF;
    -- Une demande en file ne devient pas « reussie » ni « incomplete » sans avoir été en cours ;
    -- « ignoree » (aucun appel) n'existe que depuis « en_file ».
    IF (OLD.statut = 'en_file' AND NEW.statut NOT IN ('en_file', 'en_cours', 'echouee', 'ignoree'))
       OR (OLD.statut = 'en_cours' AND NEW.statut = 'ignoree') THEN
      RAISE EXCEPTION 'Demande d''évaluation : transition d''état interdite.' USING ERRCODE = 'MPG09';
    END IF;
    -- « reussie » : seulement avec l'évaluation réussie qui provient de CETTE demande.
    IF NEW.statut = 'reussie' AND NOT EXISTS (
         SELECT 1 FROM agents_evaluations e
         WHERE e.id = NEW.evaluation_id AND e.cabinet_id = NEW.cabinet_id
           AND e.demande_id = NEW.id AND e.reussie) THEN
      RAISE EXCEPTION 'Demande d''évaluation « reussie » sans évaluation réussie issue de cette demande.'
        USING ERRCODE = 'MPG09';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER agents_evaluations_demandes_controle
  BEFORE INSERT OR UPDATE ON agents_evaluations_demandes
  FOR EACH ROW EXECUTE FUNCTION controler_agents_evaluation_demande();

-- agents_evaluations : statut, cause, jetons, demande d'origine.
ALTER TABLE agents_evaluations ADD CONSTRAINT agents_evaluations_cabinet_id_id_key
  UNIQUE (cabinet_id, id);
ALTER TABLE agents_evaluations
  ADD COLUMN tokens_entree bigint NOT NULL DEFAULT 0 CHECK (tokens_entree >= 0),
  ADD COLUMN tokens_sortie bigint NOT NULL DEFAULT 0 CHECK (tokens_sortie >= 0),
  ADD COLUMN statut text CHECK (statut IN ('reussie', 'echouee', 'incomplete')),
  ADD COLUMN cause text CHECK (cause IS NULL OR cause ~ '^[A-Z][A-Z0-9_]{2,59}$'),
  ADD COLUMN demande_id uuid;
ALTER TABLE agents_evaluations
  ADD CONSTRAINT agents_evaluations_statut_coherent
    CHECK (statut IS NULL OR ((statut = 'reussie') = reussie)),
  ADD CONSTRAINT agents_evaluations_statut_demande
    CHECK (statut IS NULL OR demande_id IS NOT NULL),
  ADD CONSTRAINT agents_evaluations_demande_fk
    FOREIGN KEY (cabinet_id, demande_id) REFERENCES agents_evaluations_demandes (cabinet_id, id);
CREATE INDEX agents_evaluations_demande_idx ON agents_evaluations (cabinet_id, demande_id)
  WHERE demande_id IS NOT NULL;

ALTER TABLE agents_evaluations_demandes ADD CONSTRAINT agents_evaluations_demandes_evaluation_fk
  FOREIGN KEY (cabinet_id, evaluation_id) REFERENCES agents_evaluations (cabinet_id, id);

-- « Réussie » exige tous les cas réussis ; l'inverse n'est plus vrai (plafond de coût dépassé).
DO $$
DECLARE v_nom text;
BEGIN
  SELECT conname INTO v_nom FROM pg_constraint
    WHERE conrelid = 'agents_evaluations'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%reussie = (cas_reussis = cas_total)%';
  IF v_nom IS NULL THEN
    RAISE EXCEPTION 'Contrainte « reussie = (cas_reussis = cas_total) » introuvable.';
  END IF;
  EXECUTE format('ALTER TABLE agents_evaluations DROP CONSTRAINT %I', v_nom);
END $$;
ALTER TABLE agents_evaluations ADD CONSTRAINT agents_evaluations_reussie_coherente
  CHECK (NOT reussie OR cas_reussis = cas_total);

-- Une évaluation `openrouter` naît d'une demande de rejeu (provenance : cf. en-tête).
ALTER TABLE agents_evaluations ADD CONSTRAINT agents_evaluations_openrouter_provenance
  CHECK (fournisseur <> 'openrouter' OR (demande_id IS NOT NULL AND statut IS NOT NULL));

-- Contrôle d'insertion (remplace 0264) : prompt du jeu ; si l'évaluation vient d'une demande de
-- rejeu, la demande est EN COURS, du même prompt, du même jeu et du même modèle. Une évaluation
-- `openrouter` EXIGE sa demande ; réussie, elle exige en plus les appels inscrits de cette demande.
CREATE OR REPLACE FUNCTION controler_agent_evaluation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_cas_total int;
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM agents_jeux_essai j JOIN ia_prompts p ON p.nom = j.prompt_nom
                   WHERE j.id = NEW.jeu_id AND p.id = NEW.prompt_id) THEN
      RAISE EXCEPTION 'Évaluation : prompt étranger au jeu d''essai.' USING ERRCODE = 'MPG05';
    END IF;
    IF NEW.fournisseur = 'openrouter' AND (NEW.demande_id IS NULL OR NEW.statut IS NULL) THEN
      RAISE EXCEPTION 'Évaluation openrouter sans demande de rejeu.' USING ERRCODE = 'MPG09';
    END IF;
    IF NEW.demande_id IS NOT NULL THEN
      SELECT d.cas_total INTO v_cas_total FROM agents_evaluations_demandes d
        WHERE d.id = NEW.demande_id AND d.cabinet_id = NEW.cabinet_id AND d.statut = 'en_cours'
          AND d.prompt_id = NEW.prompt_id AND d.jeu_id = NEW.jeu_id AND d.modele = NEW.modele;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Évaluation : demande de rejeu absente, terminée ou différente.'
          USING ERRCODE = 'MPG09';
      END IF;
      IF NEW.fournisseur = 'openrouter' AND NEW.cas_total <> v_cas_total THEN
        RAISE EXCEPTION 'Évaluation openrouter : nombre de cas différent de celui de la demande.'
          USING ERRCODE = 'MPG09';
      END IF;
    END IF;
    -- Réussie : au moins un appel réussi inscrit par cas candidat (les appels de comparaison à la
    -- version active s'y ajoutent seulement, jamais en moins).
    IF NEW.fournisseur = 'openrouter' AND NEW.reussie AND (
         SELECT count(*) FROM ia_consommations c
         WHERE c.cabinet_id = NEW.cabinet_id AND c.evaluation_demande_id = NEW.demande_id
           AND c.issue = 'succes') < NEW.cas_total THEN
      RAISE EXCEPTION 'Évaluation openrouter réussie sans les appels inscrits correspondants.'
        USING ERRCODE = 'MPG09';
    END IF;
    RETURN NEW;
  END $$;

-- ia_consommations : appel d'une évaluation (sans demande de génération).
ALTER TABLE ia_consommations ADD COLUMN evaluation_demande_id uuid;
ALTER TABLE ia_consommations ADD CONSTRAINT ia_consommations_evaluation_fk
  FOREIGN KEY (cabinet_id, evaluation_demande_id)
  REFERENCES agents_evaluations_demandes (cabinet_id, id);
CREATE INDEX ia_consommations_evaluation_idx ON ia_consommations (cabinet_id, evaluation_demande_id)
  WHERE evaluation_demande_id IS NOT NULL;
DO $$
DECLARE v_nom text;
BEGIN
  SELECT conname INTO v_nom FROM pg_constraint
    WHERE conrelid = 'ia_consommations'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%demande_id IS NULL%';
  IF v_nom IS NULL THEN
    RAISE EXCEPTION 'Contrainte « issue test ⇔ demande_id NULL » introuvable.';
  END IF;
  EXECUTE format('ALTER TABLE ia_consommations DROP CONSTRAINT %I', v_nom);
END $$;
-- « test » : aucune demande ; sinon exactement UNE origine (demande de génération OU évaluation).
ALTER TABLE ia_consommations ADD CONSTRAINT ia_consommations_origine_check
  CHECK (CASE WHEN issue = 'test' THEN demande_id IS NULL AND evaluation_demande_id IS NULL
              ELSE num_nonnulls(demande_id, evaluation_demande_id) = 1 END);
