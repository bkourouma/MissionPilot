-- Check-list de clôture standard et paramétrable (AUT-08, PRD complémentaire §8).
--
-- Le modèle est propre à chaque cabinet : un item par contrôle déterministe NOMMÉ (liste fermée,
-- implémentée dans `apps/api/src/cloture/controles.ts`), activable et bloquant ou non. Absence de
-- ligne pour un contrôle : valeurs par défaut du code (`CONTROLE_CLOTURE_DEFAUTS`). Aucune règle
-- libre, aucun montant : les contrôles comptent des écarts, les montants viennent des moteurs.
-- Le modèle se modifie (paramétrage du cabinet, `cabinet.gerer`, journalisé) ; l'historique des
-- résultats et des dérogations par mission est en ajout seul (0321, 0322).

CREATE TABLE cloture_modele_items (
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  controle text NOT NULL CHECK (controle IN ('temps_valides', 'debours_traites', 'factures_emises',
    'livrables_signes', 'encaissements_soldes', 'satisfaction_demandee', 'capitalisation_faite')),
  actif boolean NOT NULL,
  bloquant boolean NOT NULL,
  modifie_par uuid NOT NULL,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cabinet_id, controle),
  -- Un item inactif ne bloque jamais.
  CHECK (actif OR NOT bloquant),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE cloture_modele_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON cloture_modele_items
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON cloture_modele_items AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON cloture_modele_items FROM missionpilot_app;
