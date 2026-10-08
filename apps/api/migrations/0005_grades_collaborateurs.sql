-- Grades, collaborateurs et leurs coûts (PLN-05, PLN-08, FIN-02).
-- Les montants sont des entiers en unités mineures de la devise indiquée.
-- Le taux de vente standard d'un grade et toute la table collaborateur_couts
-- sont des données financières : l'API ne les sert qu'avec « finance.lire ».

CREATE TABLE grades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[a-z0-9_]{1,40}$'),
  libelle text NOT NULL CHECK (length(libelle) BETWEEN 1 AND 80),
  ordre int NOT NULL DEFAULT 0,
  taux_vente_standard bigint CHECK (taux_vente_standard >= 0),
  devise text NOT NULL DEFAULT 'XOF' CHECK (devise IN ('XOF', 'XAF', 'EUR', 'USD')),
  actif boolean NOT NULL DEFAULT true,
  -- Valeur de départ fournie par MissionPilot, à valider par le métier.
  a_valider boolean NOT NULL DEFAULT false,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, code),
  UNIQUE (cabinet_id, id)
);
ALTER TABLE grades ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON grades
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON grades FROM missionpilot_app;

CREATE TABLE collaborateurs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  utilisateur_id uuid,
  nom text NOT NULL CHECK (length(nom) BETWEEN 1 AND 160),
  grade_id uuid,
  competences text[] NOT NULL DEFAULT '{}',
  secteurs text[] NOT NULL DEFAULT '{}',
  langues text[] NOT NULL DEFAULT '{}',
  capacite_pct smallint NOT NULL DEFAULT 100 CHECK (capacite_pct BETWEEN 0 AND 100),
  type text NOT NULL DEFAULT 'interne' CHECK (type IN ('interne', 'externe', 'sous_traitant')),
  actif boolean NOT NULL DEFAULT true,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, utilisateur_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, grade_id) REFERENCES grades (cabinet_id, id)
);
CREATE UNIQUE INDEX collaborateurs_utilisateur_uniq ON collaborateurs (cabinet_id, utilisateur_id)
  WHERE utilisateur_id IS NOT NULL;
CREATE INDEX collaborateurs_tri_idx ON collaborateurs (cabinet_id, lower(nom), id);
ALTER TABLE collaborateurs ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON collaborateurs
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON collaborateurs FROM missionpilot_app;

-- Historique des coûts : une révision ajoute une ligne datée, rien ne se modifie.
CREATE TABLE collaborateur_couts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  collaborateur_id uuid NOT NULL,
  cout_journalier bigint CHECK (cout_journalier >= 0),
  taux_vente_specifique bigint CHECK (taux_vente_specifique >= 0),
  cout_achat bigint CHECK (cout_achat >= 0),
  devise text NOT NULL CHECK (devise IN ('XOF', 'XAF', 'EUR', 'USD')),
  depuis_le date NOT NULL,
  cree_par uuid,
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK (cout_journalier IS NOT NULL OR taux_vente_specifique IS NOT NULL OR cout_achat IS NOT NULL),
  UNIQUE (collaborateur_id, depuis_le),
  FOREIGN KEY (cabinet_id, collaborateur_id) REFERENCES collaborateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE collaborateur_couts ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON collaborateur_couts
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON collaborateur_couts FROM missionpilot_app;
