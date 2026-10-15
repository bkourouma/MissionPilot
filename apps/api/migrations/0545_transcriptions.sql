-- Canaux simulés (lot 3c, SPEC-3c §6.5) : transcriptions d'un audio téléversé (AGT-11).
--
-- L'IA propose, l'expert dispose : la transcription automatique (version 1, `automatique`) est un
-- BROUILLON à relire ; une correction humaine ajoute une version `humaine` ; la validation exige
-- un valideur différent de l'auteur de la dernière version humaine (sauf associé). Une
-- transcription non validée ne nourrit rien d'autre que ses propres routes.
-- Le consentement de la personne enregistrée est déclaré ET référencé (colonnes obligatoires).
--
-- MPH06 : versions en ajout seul (hors anonymisation prévue, fonction `anonymiser_transcriptions`).
-- MPH07 : validation ou rejet refusé (statut, valideur dernier modificateur, motif absent).

CREATE TABLE transcriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  fichier_id uuid NOT NULL,
  origine text NOT NULL DEFAULT 'televersement' CHECK (origine = 'televersement'),
  langue_demandee text NOT NULL CHECK (langue_demandee IN ('fr', 'dyu', 'wol', 'bam', 'lin', 'auto')),
  langue_detectee text CHECK (langue_detectee IN ('fr', 'dyu', 'wol', 'bam', 'lin')),
  enregistrement_consenti boolean NOT NULL CHECK (enregistrement_consenti),
  reference_consentement text NOT NULL CHECK (length(btrim(reference_consentement)) BETWEEN 10 AND 500),
  duree_declaree_ms int CHECK (duree_declaree_ms IS NULL OR duree_declaree_ms BETWEEN 1 AND 1800000),
  duree_audio_ms int CHECK (duree_audio_ms IS NULL OR duree_audio_ms BETWEEN 0 AND 1800000),
  confiance_pm smallint CHECK (confiance_pm IS NULL OR confiance_pm BETWEEN 0 AND 1000),
  statut text NOT NULL DEFAULT 'en_file' CHECK (statut IN ('en_file', 'en_cours', 'a_relire',
    'validee', 'rejetee', 'echec')),
  erreur_code text CHECK (erreur_code IS NULL OR erreur_code ~ '^[A-Z_]{1,60}$'),
  fournisseur text NOT NULL DEFAULT 'simule' CHECK (fournisseur = 'simule'),
  mode_fournisseur text NOT NULL DEFAULT 'simule' CHECK (mode_fournisseur = 'simule'),
  -- FIN-02 : absent des réponses sans `finance.lire` ; nul en simulé.
  cout_estime_micro_usd bigint CHECK (cout_estime_micro_usd IS NULL OR cout_estime_micro_usd >= 0),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  termine_le timestamptz,
  valide_par uuid,
  valide_le timestamptz,
  motif_rejet text CHECK (motif_rejet IS NULL OR length(btrim(motif_rejet)) BETWEEN 1 AND 1000),
  audio_supprime_le timestamptz,
  anonymise_le timestamptz,
  CHECK ((statut IN ('validee', 'rejetee')) = (valide_par IS NOT NULL AND valide_le IS NOT NULL)),
  CHECK ((statut = 'rejetee') = (motif_rejet IS NOT NULL)),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, fichier_id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, fichier_id) REFERENCES fichiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, valide_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX transcriptions_mission_idx ON transcriptions (cabinet_id, mission_id, cree_le DESC, id);
CREATE INDEX transcriptions_statut_idx ON transcriptions (cabinet_id, statut);
ALTER TABLE transcriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON transcriptions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON transcriptions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON transcriptions FROM missionpilot_app;

CREATE TABLE transcriptions_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  transcription_id uuid NOT NULL,
  numero int NOT NULL CHECK (numero >= 1),
  origine text NOT NULL CHECK (origine IN ('automatique', 'humaine')),
  texte text NOT NULL CHECK (length(texte) <= 200000),
  -- Version 1 seulement : [{ debut_ms, fin_ms, texte, confiance }…], 5 000 éléments au plus.
  segments jsonb CHECK (segments IS NULL OR (jsonb_typeof(segments) = 'array'
    AND jsonb_array_length(segments) <= 5000)),
  auteur_id uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((origine = 'automatique') = (auteur_id IS NULL)),
  CHECK (segments IS NULL OR numero = 1),
  UNIQUE (transcription_id, numero),
  FOREIGN KEY (cabinet_id, transcription_id) REFERENCES transcriptions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE transcriptions_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON transcriptions_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON transcriptions_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON transcriptions_versions FROM missionpilot_app;

-- Ajout seul ; seule exception : l'anonymisation (texte remplacé, segments vidés, une fois), faite
-- par la fonction SECURITY DEFINER `anonymiser_transcriptions` (modèle 0104 et 0274).
CREATE FUNCTION transcriptions_versions_ajout_seul() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'UPDATE'
       AND OLD.texte <> '[texte purgé]'
       AND NEW.texte = '[texte purgé]'
       AND NEW.segments IS NOT DISTINCT FROM (CASE WHEN OLD.segments IS NULL THEN NULL ELSE '[]'::jsonb END)
       AND (to_jsonb(NEW) - 'texte' - 'segments') = (to_jsonb(OLD) - 'texte' - 'segments') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Versions de transcription en ajout seul : ajouter une version.'
      USING ERRCODE = 'MPH06';
  END $$;
CREATE TRIGGER transcriptions_versions_ajout_seul BEFORE UPDATE OR DELETE ON transcriptions_versions
  FOR EACH ROW EXECUTE FUNCTION transcriptions_versions_ajout_seul();

-- Machine à états de la transcription et séparation des tâches.
CREATE FUNCTION controler_transcription() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_dernier uuid;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une transcription ne se supprime pas.' USING ERRCODE = 'MPH07';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.statut <> 'en_file' THEN
        RAISE EXCEPTION 'Une transcription naît « en_file ».' USING ERRCODE = 'MPH07';
      END IF;
      RETURN NEW;
    END IF;
    IF (NEW.cabinet_id, NEW.mission_id, NEW.fichier_id, NEW.origine, NEW.langue_demandee,
        NEW.enregistrement_consenti, NEW.reference_consentement, NEW.duree_declaree_ms, NEW.cree_par,
        NEW.cree_le)
       IS DISTINCT FROM
       (OLD.cabinet_id, OLD.mission_id, OLD.fichier_id, OLD.origine, OLD.langue_demandee,
        OLD.enregistrement_consenti, OLD.reference_consentement, OLD.duree_declaree_ms, OLD.cree_par,
        OLD.cree_le) THEN
      RAISE EXCEPTION 'Transcription : identité non modifiable.' USING ERRCODE = 'MPH07';
    END IF;
    -- Statut terminal : seuls l'effacement de l'audio et l'anonymisation (une fois chacun) se datent.
    IF OLD.statut IN ('validee', 'rejetee', 'echec') THEN
      IF NEW.statut = OLD.statut
         AND ((OLD.audio_supprime_le IS NULL AND NEW.audio_supprime_le IS NOT NULL)
              OR (OLD.anonymise_le IS NULL AND NEW.anonymise_le IS NOT NULL))
         AND (to_jsonb(NEW) - 'audio_supprime_le' - 'anonymise_le')
             = (to_jsonb(OLD) - 'audio_supprime_le' - 'anonymise_le') THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'Transcription terminée : non modifiable.' USING ERRCODE = 'MPH07';
    END IF;
    IF NEW.statut = OLD.statut THEN
      RETURN NEW; -- mise à jour de progression d'un statut non terminal (reprise du job)
    END IF;
    IF NOT (
      (OLD.statut = 'en_file' AND NEW.statut IN ('en_cours', 'echec'))
      OR (OLD.statut = 'en_cours' AND NEW.statut IN ('en_file', 'a_relire', 'echec'))
      OR (OLD.statut = 'a_relire' AND NEW.statut IN ('validee', 'rejetee'))) THEN
      RAISE EXCEPTION 'Transcription : transition % vers % refusée.', OLD.statut, NEW.statut
        USING ERRCODE = 'MPH07';
    END IF;
    IF NEW.statut = 'validee' THEN
      -- Valideur différent de l'auteur de la dernière version HUMAINE, sauf associé.
      SELECT v.auteur_id INTO v_dernier FROM transcriptions_versions v
        WHERE v.transcription_id = NEW.id AND v.origine = 'humaine'
        ORDER BY v.numero DESC LIMIT 1;
      IF v_dernier IS NOT NULL AND v_dernier = NEW.valide_par AND NOT EXISTS (
           SELECT 1 FROM utilisateurs u
           WHERE u.id = NEW.valide_par AND u.actif AND 'associe' = ANY (u.roles)) THEN
        RAISE EXCEPTION 'Le dernier modificateur ne valide pas sa propre correction.'
          USING ERRCODE = 'MPH07';
      END IF;
    END IF;
    IF NEW.statut = 'rejetee' AND NEW.motif_rejet IS NULL THEN
      RAISE EXCEPTION 'Un rejet exige un motif.' USING ERRCODE = 'MPH07';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER transcriptions_controle BEFORE INSERT OR UPDATE OR DELETE ON transcriptions
  FOR EACH ROW EXECUTE FUNCTION controler_transcription();

-- Anonymise le texte des transcriptions VALIDÉES depuis plus de p_jours jours (au moins 90),
-- dans le cabinet du contexte (au plus p_limite versions par appel) ; renvoie le nombre de
-- versions anonymisées. p_maintenant ne dépasse pas l'horloge de la base de plus d'une minute
-- (une date future avancerait l'échéance de toutes les transcriptions du cabinet) ; réglage
-- `app.horloge_test` honoré dans une base « _test » seulement (même mécanisme que 0104).
CREATE FUNCTION anonymiser_transcriptions(p_maintenant timestamptz, p_jours int,
                                          p_limite int DEFAULT 1000)
  RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_cabinet uuid := app_cabinet_id();
    v_test text := nullif(current_setting('app.horloge_test', true), '');
    v_reference timestamptz := clock_timestamp();
    v_n int;
  BEGIN
    IF v_cabinet IS NULL OR p_maintenant IS NULL OR p_jours IS NULL OR p_limite IS NULL
       OR p_jours NOT BETWEEN 90 AND 3650 OR p_limite NOT BETWEEN 1 AND 10000 THEN
      RAISE EXCEPTION 'Paramètres de l''anonymisation des transcriptions invalides.';
    END IF;
    IF v_test IS NOT NULL AND current_database() LIKE '%\_test' THEN
      v_reference := v_test::timestamptz;
    END IF;
    IF p_maintenant > v_reference + interval '1 minute' THEN
      RAISE EXCEPTION 'Date de l''anonymisation des transcriptions dans le futur.';
    END IF;
    UPDATE transcriptions_versions v
      SET texte = '[texte purgé]',
          segments = CASE WHEN v.segments IS NULL THEN NULL ELSE '[]'::jsonb END
      WHERE v.id IN (
        SELECT x.id FROM transcriptions_versions x
        JOIN transcriptions t ON t.id = x.transcription_id AND t.cabinet_id = x.cabinet_id
        WHERE x.cabinet_id = v_cabinet AND t.statut = 'validee'
          AND t.valide_le < p_maintenant - make_interval(days => p_jours)
          AND x.texte <> '[texte purgé]'
        ORDER BY x.id LIMIT p_limite)
        AND cabinet_id = v_cabinet;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    UPDATE transcriptions t SET anonymise_le = p_maintenant
      WHERE t.cabinet_id = v_cabinet AND t.statut = 'validee' AND t.anonymise_le IS NULL
        AND t.valide_le < p_maintenant - make_interval(days => p_jours)
        AND NOT EXISTS (SELECT 1 FROM transcriptions_versions x
                        WHERE x.transcription_id = t.id AND x.texte <> '[texte purgé]');
    RETURN v_n;
  END $$;

REVOKE ALL ON FUNCTION anonymiser_transcriptions(timestamptz, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION anonymiser_transcriptions(timestamptz, int, int) TO missionpilot_app;
