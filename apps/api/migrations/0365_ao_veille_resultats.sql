-- Résultats de veille dédoublonnés (AO-01), voir l'en-tête de 0364.

CREATE TABLE ao_veille_resultats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  -- Clé de dédoublonnage calculée par le moteur (référence externe, sinon titre+bailleur+date limite).
  cle text NOT NULL CHECK (length(cle) BETWEEN 1 AND 700),
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
  -- Adresse de l'avis, jamais visitée par le serveur ; http(s) seulement (affichée en lien).
  url text CHECK (url IS NULL OR (length(url) <= 500 AND url ~* '^https?://[^\s<>"]+$')),
  mots_cles text[] NOT NULL DEFAULT '{}' CHECK (cardinality(mots_cles) <= 30),
  statut text NOT NULL DEFAULT 'nouveau'
    CHECK (statut IN ('nouveau', 'retenu', 'ecarte', 'fiche_creee')),
  -- Fiche liée : créée depuis ce résultat, ou déjà présente au moment du dédoublonnage.
  fiche_id uuid,
  score_rapprochement smallint NOT NULL CHECK (score_rapprochement BETWEEN 0 AND 100),
  rapprochement jsonb NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, cle),
  FOREIGN KEY (cabinet_id, fiche_id) REFERENCES appels_offres (cabinet_id, id),
  CHECK ((statut = 'fiche_creee') = (fiche_id IS NOT NULL))
);
CREATE INDEX ao_veille_resultats_liste_idx
  ON ao_veille_resultats (cabinet_id, score_rapprochement DESC, cree_le DESC, id);
CREATE INDEX ao_veille_resultats_statut_idx ON ao_veille_resultats (cabinet_id, statut);
ALTER TABLE ao_veille_resultats ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ao_veille_resultats
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON ao_veille_resultats AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON ao_veille_resultats FROM missionpilot_app;
REVOKE UPDATE ON ao_veille_resultats FROM missionpilot_app;
GRANT UPDATE (statut, fiche_id, score_rapprochement, rapprochement, modifie_le)
  ON ao_veille_resultats TO missionpilot_app;

-- Transitions : nouveau → retenu | écarté | fiche créée ; retenu → écarté | fiche créée ;
-- écarté → nouveau (réexamen motivé) ; fiche créée est finale (MQA02).
CREATE FUNCTION controler_resultat_veille() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW.statut IS DISTINCT FROM OLD.statut THEN
      IF NOT ((OLD.statut = 'nouveau' AND NEW.statut IN ('retenu', 'ecarte', 'fiche_creee'))
           OR (OLD.statut = 'retenu' AND NEW.statut IN ('ecarte', 'fiche_creee'))
           OR (OLD.statut = 'ecarte' AND NEW.statut = 'nouveau')) THEN
        RAISE EXCEPTION 'Transition de statut refusée pour un résultat de veille.'
          USING ERRCODE = 'MQA02';
      END IF;
    ELSIF OLD.statut = 'fiche_creee' AND NEW.fiche_id IS DISTINCT FROM OLD.fiche_id THEN
      RAISE EXCEPTION 'Transition de statut refusée pour un résultat de veille.'
        USING ERRCODE = 'MQA02';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER ao_veille_resultats_controle BEFORE UPDATE ON ao_veille_resultats
  FOR EACH ROW EXECUTE FUNCTION controler_resultat_veille();

-- Plafond de résultats par cabinet (déni de service) : MQA03.
CREATE FUNCTION plafonner_resultats_veille() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF (SELECT count(*) FROM ao_veille_resultats r WHERE r.cabinet_id = NEW.cabinet_id) >= 5000 THEN
      RAISE EXCEPTION 'Plafond de résultats de veille atteint.' USING ERRCODE = 'MQA03';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER ao_veille_resultats_plafond BEFORE INSERT ON ao_veille_resultats
  FOR EACH ROW EXECUTE FUNCTION plafonner_resultats_veille();
