-- Services candidats (PRD complémentaire §11.6, décision n° 6) : DIAGNOSTIC FLASH (5 jours, prix
-- fixe) puis BUSINESS PLAN BANCABLE. Paramètres PROPRES AU CABINET de ces deux services : le prix
-- fixe et son état de validation.
--
-- Aucune ligne et AUCUN prix par défaut (décision de l'utilisateur) : le prix est « à fixer par le
-- cabinet » ; le type de mission d'un service à prix fixe (diagnostic flash) ne s'active qu'une fois
-- le prix saisi (API, `activerTypes`). La fixation par un associé ou un directeur de mission écrit
-- la ligne.
--
-- Données FIN-02 : un prix de vente n'est pas un coût interne, mais la table reste interne au
-- cabinet (RESTRICTIVE `portail_interdit`). Un paramètre ne se supprime pas (on le remplace).

CREATE TABLE services_candidats_parametres (
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  service_code text NOT NULL CHECK (service_code IN ('diagnostic_flash', 'business_plan_bancable')),
  -- Prix fixe en unité entière de la devise (pas de décimales : FCFA, EUR, USD) ; NULL : à fixer.
  prix_fixe bigint CHECK (prix_fixe IS NULL OR prix_fixe BETWEEN 0 AND 9007199254740991),
  devise text NOT NULL CHECK (devise IN ('XOF', 'XAF', 'EUR', 'USD')),
  -- Mention libre du cabinet (ex. « DÉMONSTRATION »).
  commentaire text CHECK (commentaire IS NULL OR length(commentaire) <= 200),
  a_valider boolean NOT NULL DEFAULT true,
  modifie_par uuid NOT NULL,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cabinet_id, service_code),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE services_candidats_parametres ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON services_candidats_parametres
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON services_candidats_parametres AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON services_candidats_parametres FROM missionpilot_app;
REVOKE UPDATE ON services_candidats_parametres FROM missionpilot_app;
GRANT UPDATE (prix_fixe, devise, commentaire, a_valider, modifie_par, modifie_le)
  ON services_candidats_parametres TO missionpilot_app;
