-- Groupes et filiales du dossier client (DOS-05, PRD complémentaire §5) : structure de détention.
--
-- `dossier_participations` : historique de détention en AJOUT SEUL (MPO01). Un enregistrement
-- dit « le détenteur détient points_base / 10 000 de la filiale à partir de date_effet ». Pour
-- une paire (détenteur, filiale), la participation en vigueur à une date est le dernier
-- enregistrement de date d'effet <= cette date (puis saisie la plus récente) ; 0 marque la FIN
-- de la détention (motif obligatoire). Rien ne se modifie ni ne se supprime : corriger = ajouter.
-- Ce n'est PAS une consolidation comptable légale (calculs : packages/engines, dossier/groupe.ts).
--
-- Le déclencheur BEFORE INSERT DOUBLE EN BASE les règles du moteur `controlerNouvelleDetention`
-- (règle prudente : dernier enregistrement de chaque paire, TOUTES DATES CONFONDUES, y compris à
-- effet futur ; le nouvel enregistrement remplace celui de sa paire) :
--   MQF01 le lien créerait un cycle de détention ;
--   MQF02 la somme des dernières parts des détenteurs d'une filiale dépasserait 10 000 ;
--   MQF03 fin de détention (0) sans détention antérieure > 0, de date d'effet <=, pour la paire ;
--   MQF04 le lien porterait la chaîne de détention la plus longue au-delà de 8 niveaux.
-- Les écritures d'un cabinet sont sérialisées par un verrou consultatif de transaction (même clé
-- que `apps/api/src/dossier/groupes.ts`). `ordre` (identité) départage deux saisies de même
-- instant, comme l'ordre d'entrée du moteur.
--
-- Interne au cabinet : rien de visible ni de modifiable depuis le portail client.
-- SQLSTATE de la lettre Q (partiQipations) : MQF01 à MQF04.

CREATE TABLE dossier_participations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  detenteur_id uuid NOT NULL,
  filiale_id uuid NOT NULL,
  points_base integer NOT NULL CHECK (points_base BETWEEN 0 AND 10000),
  date_effet date NOT NULL CHECK (date_effet BETWEEN '2000-01-01' AND '2100-12-31'),
  motif text CHECK (motif IS NULL OR length(btrim(motif)) BETWEEN 1 AND 500),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  ordre bigint GENERATED ALWAYS AS IDENTITY,
  CHECK (detenteur_id <> filiale_id),
  CHECK (points_base > 0 OR motif IS NOT NULL),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, detenteur_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, filiale_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX dossier_participations_paire_idx
  ON dossier_participations (cabinet_id, detenteur_id, filiale_id, date_effet DESC, cree_le DESC, ordre DESC);
CREATE INDEX dossier_participations_filiale_idx
  ON dossier_participations (cabinet_id, filiale_id, detenteur_id);
ALTER TABLE dossier_participations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dossier_participations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dossier_participations AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dossier_participations FROM missionpilot_app;
CREATE TRIGGER dossier_participations_ajout_seul BEFORE UPDATE OR DELETE ON dossier_participations
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dossier();

CREATE FUNCTION controler_dossier_participation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_cycle boolean;
  DECLARE v_somme bigint;
  DECLARE v_longueur integer;
  BEGIN
    -- Même clé que l'API : lectures cohérentes avec l'écriture, y compris hors API.
    PERFORM pg_advisory_xact_lock(hashtextextended('groupes:' || NEW.cabinet_id::text, 0));

    IF NEW.points_base = 0 THEN
      IF NOT EXISTS (SELECT 1 FROM dossier_participations p
                     WHERE p.cabinet_id = NEW.cabinet_id AND p.detenteur_id = NEW.detenteur_id
                       AND p.filiale_id = NEW.filiale_id AND p.points_base > 0
                       AND p.date_effet <= NEW.date_effet) THEN
        RAISE EXCEPTION 'Aucune détention antérieure à terminer pour cette paire.'
          USING ERRCODE = 'MQF03';
      END IF;
      RETURN NEW;
    END IF;

    -- Dernier enregistrement de chaque paire (toutes dates), la paire du nouveau lien exclue
    -- (le nouveau lien la remplace) ; cycle : la filiale détient-elle, directement ou non, le
    -- détenteur ? (profondeur bornée, aucun noeud revisité)
    WITH RECURSIVE derniers AS (
      SELECT d.detenteur_id, d.filiale_id, d.points_base FROM (
        SELECT DISTINCT ON (p.detenteur_id, p.filiale_id) p.detenteur_id, p.filiale_id, p.points_base
        FROM dossier_participations p
        WHERE p.cabinet_id = NEW.cabinet_id
          AND NOT (p.detenteur_id = NEW.detenteur_id AND p.filiale_id = NEW.filiale_id)
        ORDER BY p.detenteur_id, p.filiale_id, p.date_effet DESC, p.cree_le DESC, p.ordre DESC
      ) d WHERE d.points_base > 0
    ), descendants (id, chemin) AS (
      SELECT NEW.filiale_id, ARRAY[NEW.filiale_id]
      UNION ALL
      SELECT d.filiale_id, r.chemin || d.filiale_id
      FROM descendants r
      JOIN derniers d ON d.detenteur_id = r.id
      WHERE NOT d.filiale_id = ANY (r.chemin) AND cardinality(r.chemin) < 64
    )
    SELECT EXISTS (SELECT 1 FROM descendants WHERE id = NEW.detenteur_id),
           COALESCE((SELECT sum(d.points_base) FROM derniers d WHERE d.filiale_id = NEW.filiale_id), 0)
             + NEW.points_base
      INTO v_cycle, v_somme;
    IF v_cycle THEN
      RAISE EXCEPTION 'Cette détention créerait un cycle de détention.' USING ERRCODE = 'MQF01';
    END IF;

    IF v_somme > 10000 THEN
      RAISE EXCEPTION 'Les participations dans cette filiale dépasseraient 10 000 points de base.'
        USING ERRCODE = 'MQF02';
    END IF;

    -- Profondeur : plus long chemin amont + ce lien + plus long chemin aval <= 8 liens (comme
    -- PROFONDEUR_GROUPE_MAX du moteur). Le graphe est sans cycle ici (MQF01 vérifié).
    WITH RECURSIVE derniers AS (
      SELECT d.detenteur_id, d.filiale_id FROM (
        SELECT DISTINCT ON (p.detenteur_id, p.filiale_id) p.detenteur_id, p.filiale_id, p.points_base
        FROM dossier_participations p
        WHERE p.cabinet_id = NEW.cabinet_id
          AND NOT (p.detenteur_id = NEW.detenteur_id AND p.filiale_id = NEW.filiale_id)
        ORDER BY p.detenteur_id, p.filiale_id, p.date_effet DESC, p.cree_le DESC, p.ordre DESC
      ) d WHERE d.points_base > 0
    ), amont (id, prof) AS (
      SELECT NEW.detenteur_id, 0
      UNION ALL
      SELECT d.detenteur_id, r.prof + 1 FROM amont r JOIN derniers d ON d.filiale_id = r.id
      WHERE r.prof < 16
    ), aval (id, prof) AS (
      SELECT NEW.filiale_id, 0
      UNION ALL
      SELECT d.filiale_id, r.prof + 1 FROM aval r JOIN derniers d ON d.detenteur_id = r.id
      WHERE r.prof < 16
    )
    SELECT (SELECT max(prof) FROM amont) + 1 + (SELECT max(prof) FROM aval) INTO v_longueur;
    IF v_longueur > 8 THEN
      RAISE EXCEPTION 'La chaîne de détention dépasserait 8 niveaux.' USING ERRCODE = 'MQF04';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER dossier_participations_controle BEFORE INSERT ON dossier_participations
  FOR EACH ROW EXECUTE FUNCTION controler_dossier_participation();
