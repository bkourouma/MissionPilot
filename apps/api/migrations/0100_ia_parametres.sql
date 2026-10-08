-- Socle IA de la V2 (ADR-003) : paramétrage par cabinet.
--
-- - ia_parametres_cabinet : interrupteur, plafond mensuel de coût (en
--   micro-dollars US, unité des tarifs OpenRouter), clé API OpenRouter PROPRE
--   au cabinet, facultative, CHIFFRÉE par le trousseau applicatif
--   (AES-256-GCM, AAD liée au cabinet, version de clé pour la rotation). La
--   clé n'est jamais relue par une route : seul l'orchestrateur la déchiffre,
--   au moment de l'appel. Sans clé de cabinet : clé de plateforme
--   (OPENROUTER_API_KEY), sinon gabarits déterministes.
-- - ia_modeles_taches : modèle choisi par le cabinet pour une tâche. Sans
--   ligne, le modèle RECOMMANDÉ défini dans le code s'applique.
-- - ia_alertes_plafond : alerte de consommation déjà envoyée (80 %, 100 %)
--   pour un mois : une seule notification par seuil et par mois.

CREATE TABLE ia_parametres_cabinet (
  cabinet_id uuid PRIMARY KEY REFERENCES cabinets (id) ON DELETE CASCADE,
  ia_activee boolean NOT NULL DEFAULT true,
  plafond_mensuel_micro_usd bigint NOT NULL DEFAULT 50000000
    CHECK (plafond_mensuel_micro_usd BETWEEN 0 AND 100000000000),
  cle_chiffree bytea CHECK (cle_chiffree IS NULL OR octet_length(cle_chiffree) BETWEEN 29 AND 2048),
  cle_version smallint,
  cle_modifiee_le timestamptz,
  modifie_par uuid,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((cle_chiffree IS NULL) = (cle_version IS NULL)),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE ia_parametres_cabinet ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ia_parametres_cabinet
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON ia_parametres_cabinet FROM missionpilot_app;

CREATE TABLE ia_modeles_taches (
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  tache text NOT NULL
    CHECK (tache IN ('redaction', 'analyse', 'extraction', 'classification', 'embedding')),
  -- Liste blanche de FORMAT (fournisseur/modèle[:variante]) : aucun caractère
  -- qui puisse détourner l'URL ou le corps de la requête.
  modele text NOT NULL
    CHECK (modele ~ '^[a-z0-9][a-z0-9._-]{0,63}/[a-z0-9][a-z0-9._-]{0,99}(:[a-z0-9._-]{1,30})?$'),
  modifie_par uuid NOT NULL,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cabinet_id, tache),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE ia_modeles_taches ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ia_modeles_taches
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

CREATE TABLE ia_alertes_plafond (
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mois date NOT NULL CHECK (extract(day FROM mois) = 1),
  seuil smallint NOT NULL CHECK (seuil IN (80, 100)),
  cree_le timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cabinet_id, mois, seuil)
);
ALTER TABLE ia_alertes_plafond ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ia_alertes_plafond
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON ia_alertes_plafond FROM missionpilot_app;
