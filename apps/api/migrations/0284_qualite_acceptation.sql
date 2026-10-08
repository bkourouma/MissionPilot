-- Acceptation de mission (QUA-07) : conflits d'intérêts simples et profil de risque du client.
--
-- - `qualite_relations_clients` : relations DÉCLARÉES entre deux clients du cabinet (même groupe,
--   investisseur et société cible, concurrents). Une relation vaut dans les deux sens. Donnée de
--   configuration : elle se retire (suppression journalisée), contrairement aux historiques.
-- - `qualite_acceptations` : chaque évaluation d'acceptation d'une mission est une ligne EN AJOUT
--   SEUL (rang croissant, la dernière fait foi). Les conflits sont CALCULÉS par le serveur au
--   moment de l'évaluation et figés dans la ligne ; le profil de risque porte les facteurs cochés,
--   le niveau calculé (le plus élevé des facteurs) et le niveau retenu (jamais en dessous).
--   Accepter malgré un conflit exige un motif (CHECK).
-- Tables internes : `portail_interdit`.

CREATE TABLE qualite_relations_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  client_lie_id uuid NOT NULL,
  nature text NOT NULL CHECK (nature IN ('meme_groupe', 'investisseur_cible', 'concurrent')),
  note text CHECK (note IS NULL OR length(btrim(note)) BETWEEN 1 AND 500),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK (client_id <> client_lie_id),
  UNIQUE (cabinet_id, id),
  CONSTRAINT qualite_relations_unique UNIQUE (cabinet_id, client_id, client_lie_id, nature),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_lie_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX qualite_relations_clients_lie_idx ON qualite_relations_clients (cabinet_id, client_lie_id);
ALTER TABLE qualite_relations_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON qualite_relations_clients
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON qualite_relations_clients AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE ON qualite_relations_clients FROM missionpilot_app;

-- Une relation symétrique ne se déclare pas deux fois (A-B puis B-A de même nature).
CREATE FUNCTION controler_qualite_relation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM qualite_relations_clients r
               WHERE r.client_id = NEW.client_lie_id AND r.client_lie_id = NEW.client_id
                 AND r.nature = NEW.nature) THEN
      RAISE EXCEPTION 'Cette relation est déjà déclarée dans l''autre sens.' USING ERRCODE = 'MPY07';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER qualite_relations_clients_controle BEFORE INSERT ON qualite_relations_clients
  FOR EACH ROW EXECUTE FUNCTION controler_qualite_relation();

CREATE TABLE qualite_acceptations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  client_id uuid NOT NULL,
  rang integer NOT NULL CHECK (rang >= 1),
  conflits jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(conflits) = 'array'),
  profil_risque jsonb NOT NULL CHECK (jsonb_typeof(profil_risque) = 'object'),
  niveau_risque text NOT NULL CHECK (niveau_risque IN ('faible', 'moyen', 'eleve')),
  decision text NOT NULL CHECK (decision IN ('en_attente', 'acceptee', 'acceptee_sous_conditions', 'refusee')),
  motif text CHECK (motif IS NULL OR length(btrim(motif)) BETWEEN 1 AND 2000),
  evalue_par uuid NOT NULL,
  evalue_le timestamptz NOT NULL DEFAULT now(),
  -- Sous conditions ou refusée : motivée. Acceptée malgré un conflit : motivée.
  CHECK (decision IN ('en_attente', 'acceptee') OR motif IS NOT NULL),
  CHECK (decision <> 'acceptee' OR jsonb_array_length(conflits) = 0 OR motif IS NOT NULL),
  UNIQUE (cabinet_id, id),
  UNIQUE (mission_id, rang),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, evalue_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE qualite_acceptations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON qualite_acceptations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON qualite_acceptations AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON qualite_acceptations FROM missionpilot_app;
CREATE TRIGGER qualite_acceptations_ajout_seul BEFORE UPDATE OR DELETE ON qualite_acceptations
  FOR EACH ROW EXECUTE FUNCTION qualite_ajout_seul();
