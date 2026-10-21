-- Plafond de débit du rejeu Monte-Carlo (POST …/montecarlo/simulations/:simId/rejeu).
--
-- Le rejeu relance le moteur (~0,3 s pour 2000 tirages) sans rien écrire : il n'était pas limité. Il
-- laisse désormais une trace minimale, comptée par l'API : au plus 5 rejeux PAR PLAN sur 10 minutes
-- (valeur PROVISOIRE, à valider ; 429 TROP_DE_REJEUX). Compteur persistant, partagé entre instances.
-- (Le limiteur d'authentification, 0120/0544/0550, a ses espaces fixés par une fonction redéfinie en
-- entier à chaque migration : ajouter un espace ici serait écrasé par 0550.)
--
-- Les lignes de plus d'une heure sont purgées par l'API à chaque rejeu (DELETE autorisé, aucune donnée
-- métier). Table à RLS : politique `isolation` (cabinet) et RESTRICTIVE `portail_interdit`.

CREATE TABLE plan_rejeux_montecarlo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cabinet_id, plan_id) REFERENCES plans_strategiques (cabinet_id, id) ON DELETE CASCADE,
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX plan_rejeux_montecarlo_plan_idx ON plan_rejeux_montecarlo (plan_id, cree_le DESC);
ALTER TABLE plan_rejeux_montecarlo ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON plan_rejeux_montecarlo
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON plan_rejeux_montecarlo AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE ON plan_rejeux_montecarlo FROM missionpilot_app;
