-- Rapport d'avancement hebdomadaire au client (AUT-10, PRD complémentaire §8, lot 4c) : paramètre
-- du cabinet. Plage du lot : 0306 à 0319. Ne redéfinit PAS `tentatives_auth_regles` (voir 0550).
--
-- Une ligne par cabinet, créée à la première modification ; sans ligne, les valeurs par défaut
-- s'appliquent (fonction activée : elle ne crée que des BROUILLONS INTERNES, jamais visibles du
-- client avant la validation du chef de mission).
-- - `actif` : la tâche hebdomadaire prépare les brouillons ; faux, elle ne produit rien.
-- - `envoi_email` : option « envoyer le rapport validé par e-mail », DÉSACTIVÉE et NON BRANCHÉE :
--   `CHECK (envoi_email = false)`, aucun code d'envoi ne lit cette colonne. L'écran la montre
--   désactivée. L'activer exigera une nouvelle migration, un ADR et un circuit d'envoi validé.
--
-- RLS `isolation` ; table interne, fermée au portail (`portail_interdit`). Pas de suppression.
-- SQLSTATE du domaine (second préfixe « MQ », MQU01 à MQU10 réservés à ce chantier) : voir 0307.

CREATE TABLE avancement_parametres (
  cabinet_id uuid PRIMARY KEY REFERENCES cabinets (id) ON DELETE CASCADE,
  actif boolean NOT NULL DEFAULT true,
  envoi_email boolean NOT NULL DEFAULT false CHECK (envoi_email = false),
  modifie_par uuid,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE avancement_parametres ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON avancement_parametres
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON avancement_parametres AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON avancement_parametres FROM missionpilot_app;
