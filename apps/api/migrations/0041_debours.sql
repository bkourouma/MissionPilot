-- Débours et notes de frais (FIN-05). Circuit : brouillon → soumis → valide |
-- rejete (motif) ; rejete → brouillon (correction) → soumis. Un débours validé
-- est figé : ni modification ni suppression. Validation par le chef ou le
-- directeur de la mission, ou un associé, jamais par l'auteur sauf associé
-- (contrôle applicatif ; le valideur est tracé par decide_par).
-- Le justificatif est une référence de fichier (chemin relatif), jamais le binaire.

CREATE TABLE debours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  collaborateur_id uuid NOT NULL,
  auteur_id uuid NOT NULL,
  date date NOT NULL CHECK (date BETWEEN '2000-01-01' AND '2100-12-31'),
  categorie text NOT NULL CHECK (categorie IN ('transport', 'hebergement', 'restauration',
    'per_diem', 'communication', 'fournitures', 'sous_traitance_locale', 'autre')),
  libelle text NOT NULL CHECK (length(libelle) BETWEEN 1 AND 200),
  montant bigint NOT NULL CHECK (montant > 0),
  devise text NOT NULL CHECK (devise IN ('XOF', 'XAF', 'EUR', 'USD')),
  refacturable boolean NOT NULL DEFAULT true,
  justificatif text CHECK (justificatif IS NULL OR (length(justificatif) BETWEEN 1 AND 500
    AND justificatif !~ '\.\.' AND justificatif !~ '\\' AND justificatif !~ '^/'
    AND justificatif !~* '^[a-z][a-z0-9+.-]*:' AND justificatif !~ '[[:cntrl:]]')),
  statut text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'soumis', 'valide', 'rejete')),
  motif_rejet text CHECK (motif_rejet IS NULL OR length(motif_rejet) <= 500),
  soumis_le timestamptz,
  decide_par uuid,
  decide_le timestamptz,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  CHECK (statut <> 'rejete' OR (motif_rejet IS NOT NULL AND length(btrim(motif_rejet)) > 0)),
  CHECK (statut NOT IN ('valide', 'rejete') OR (decide_par IS NOT NULL AND decide_le IS NOT NULL)),
  CHECK (statut = 'brouillon' OR soumis_le IS NOT NULL),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, mission_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, collaborateur_id) REFERENCES collaborateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, decide_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX debours_mission_idx ON debours (cabinet_id, mission_id, statut);
CREATE INDEX debours_auteur_idx ON debours (cabinet_id, auteur_id, date DESC, id);
ALTER TABLE debours ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON debours
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

-- Identité figée ; transitions contrôlées ; débours validé immuable ; seule
-- une saisie en brouillon ou rejetée se supprime.
CREATE FUNCTION controler_debours() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      IF OLD.statut NOT IN ('brouillon', 'rejete') THEN
        RAISE EXCEPTION 'Débours soumis ou validé : suppression refusée.' USING ERRCODE = 'MPB02';
      END IF;
      RETURN OLD;
    END IF;
    IF OLD.statut = 'valide' THEN
      RAISE EXCEPTION 'Débours validé : immuable.' USING ERRCODE = 'MPB02';
    END IF;
    IF (NEW.cabinet_id, NEW.mission_id, NEW.collaborateur_id, NEW.auteur_id, NEW.cree_le)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.mission_id, OLD.collaborateur_id, OLD.auteur_id, OLD.cree_le) THEN
      RAISE EXCEPTION 'Identité d''un débours figée.' USING ERRCODE = 'MPB02';
    END IF;
    IF NEW.statut IS DISTINCT FROM OLD.statut AND NOT (
         (OLD.statut IN ('brouillon', 'rejete') AND NEW.statut IN ('soumis', 'brouillon'))
      OR (OLD.statut = 'soumis' AND NEW.statut IN ('valide', 'rejete'))) THEN
      RAISE EXCEPTION 'Transition de statut de débours refusée.' USING ERRCODE = 'MPB02';
    END IF;
    -- Une saisie soumise ne change que par sa décision.
    IF OLD.statut = 'soumis' AND
       (NEW.date, NEW.categorie, NEW.libelle, NEW.montant, NEW.devise, NEW.refacturable, NEW.justificatif)
         IS DISTINCT FROM
       (OLD.date, OLD.categorie, OLD.libelle, OLD.montant, OLD.devise, OLD.refacturable, OLD.justificatif) THEN
      RAISE EXCEPTION 'Débours soumis : contenu figé.' USING ERRCODE = 'MPB02';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER debours_controle BEFORE UPDATE OR DELETE ON debours
  FOR EACH ROW EXECUTE FUNCTION controler_debours();
