-- Canaux simulés (lot 3c, SPEC-3c §6.4) : propositions de saisie de KPI reçues par message (KPI-14).
--
-- Une proposition n'est JAMAIS une mesure : le webhook n'écrit pas dans `kpi_mesures`. Seule la
-- reprise par un utilisateur du cabinet (kpi.saisir) insère la mesure (origine « cabinet »), puis
-- relie la proposition (`mesure_id`). La valeur est celle que l'analyse déterministe a extraite
-- (décimal exact), jamais le texte du message.
--
-- MPH05 : proposition de saisie, transition interdite, identité modifiée, reprise incohérente.

CREATE TABLE canaux_saisies_kpi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  kpi_id uuid NOT NULL,
  destinataire_id uuid NOT NULL,
  -- Un événement du webhook ne crée qu'une proposition.
  evenement_ref text NOT NULL CHECK (evenement_ref ~ '^[A-Za-z0-9_-]{1,100}$'),
  origine text NOT NULL CHECK (origine IN ('texte', 'vocal')),
  date_mesure date NOT NULL CHECK (date_mesure BETWEEN '2000-01-01' AND '2100-12-31'),
  valeur numeric(24, 6) NOT NULL CHECK (abs(valeur) < 1e15),
  vraisemblance text NOT NULL CHECK (vraisemblance IN ('ok', 'a_verifier', 'invraisemblable')),
  motif_vraisemblance text CHECK (motif_vraisemblance IS NULL OR motif_vraisemblance ~ '^[a-z_]{1,60}$'),
  statut text NOT NULL DEFAULT 'a_confirmer' CHECK (statut IN ('a_confirmer', 'confirmee',
    'refusee', 'expiree', 'rejetee_vraisemblance', 'reprise', 'rejetee_cabinet')),
  expire_le timestamptz NOT NULL,
  confirmee_le timestamptz,
  reprise_par uuid,
  reprise_le timestamptz,
  mesure_id uuid,
  motif_rejet text CHECK (motif_rejet IS NULL OR length(btrim(motif_rejet)) BETWEEN 1 AND 500),
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((statut = 'reprise') = (mesure_id IS NOT NULL)),
  CHECK ((statut = 'reprise') = (reprise_par IS NOT NULL)),
  CHECK (statut <> 'rejetee_cabinet' OR motif_rejet IS NOT NULL),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, evenement_ref),
  FOREIGN KEY (cabinet_id, kpi_id) REFERENCES kpi_definitions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, destinataire_id) REFERENCES canaux_destinataires (cabinet_id, id),
  FOREIGN KEY (cabinet_id, reprise_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mesure_id) REFERENCES kpi_mesures (cabinet_id, id)
);
CREATE INDEX canaux_saisies_kpi_destinataire_idx
  ON canaux_saisies_kpi (cabinet_id, destinataire_id, cree_le DESC);
CREATE INDEX canaux_saisies_kpi_attente_idx ON canaux_saisies_kpi (cabinet_id, expire_le)
  WHERE statut = 'a_confirmer';
CREATE INDEX canaux_saisies_kpi_kpi_idx ON canaux_saisies_kpi (cabinet_id, kpi_id, cree_le DESC);
ALTER TABLE canaux_saisies_kpi ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON canaux_saisies_kpi
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON canaux_saisies_kpi AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON canaux_saisies_kpi FROM missionpilot_app;

CREATE FUNCTION controler_canal_saisie_kpi() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une proposition de saisie ne se supprime pas.' USING ERRCODE = 'MPH05';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NOT ((NEW.statut = 'a_confirmer' AND NEW.vraisemblance IN ('ok', 'a_verifier'))
              OR (NEW.statut = 'rejetee_vraisemblance' AND NEW.vraisemblance = 'invraisemblable')) THEN
        RAISE EXCEPTION 'Proposition de saisie : état initial incohérent.' USING ERRCODE = 'MPH05';
      END IF;
      RETURN NEW;
    END IF;
    IF (NEW.cabinet_id, NEW.kpi_id, NEW.destinataire_id, NEW.valeur, NEW.date_mesure, NEW.origine,
        NEW.vraisemblance, NEW.evenement_ref, NEW.expire_le)
       IS DISTINCT FROM
       (OLD.cabinet_id, OLD.kpi_id, OLD.destinataire_id, OLD.valeur, OLD.date_mesure, OLD.origine,
        OLD.vraisemblance, OLD.evenement_ref, OLD.expire_le) THEN
      RAISE EXCEPTION 'Proposition de saisie : identité non modifiable.' USING ERRCODE = 'MPH05';
    END IF;
    IF NEW.statut = OLD.statut THEN
      RAISE EXCEPTION 'Proposition de saisie : une proposition ne change que par sa décision.'
        USING ERRCODE = 'MPH05';
    END IF;
    IF NOT (
      (OLD.statut = 'a_confirmer' AND NEW.statut IN ('confirmee', 'refusee', 'expiree'))
      OR (OLD.statut = 'confirmee' AND NEW.statut IN ('reprise', 'rejetee_cabinet'))) THEN
      RAISE EXCEPTION 'Proposition de saisie : transition % vers % interdite.', OLD.statut, NEW.statut
        USING ERRCODE = 'MPH05';
    END IF;
    IF NEW.statut = 'reprise' AND NOT EXISTS (
         SELECT 1 FROM kpi_mesures m WHERE m.id = NEW.mesure_id AND m.kpi_id = NEW.kpi_id) THEN
      RAISE EXCEPTION 'Reprise : la mesure doit appartenir au même KPI.' USING ERRCODE = 'MPH05';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER canaux_saisies_kpi_controle BEFORE INSERT OR UPDATE OR DELETE ON canaux_saisies_kpi
  FOR EACH ROW EXECUTE FUNCTION controler_canal_saisie_kpi();
