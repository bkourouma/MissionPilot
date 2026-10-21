-- Veille multi-sources des appels d'offres (AO-01, PRD complémentaire §9), lot 5b, plage 0364–0379.
--
-- - ao_veille_sources     : activation par cabinet d'une source de veille (0364). Aucune ligne =
--   source DÉSACTIVÉE (défaut). Les adaptateurs sont SIMULÉS : aucun appel réseau, aucune clé.
-- - ao_veille_resultats   : un avis dédoublonné par cabinet (clé normalisée, 0365), son score de
--   rapprochement (moteur) et son statut ; seul le statut, le lien vers la fiche créée, le score
--   et le rapprochement évoluent.
-- - ao_veille_occurrences : chaque fois qu'un avis est vu (source, jour), EN AJOUT SEUL (0366).
-- - ao_veille_decisions   : journal des décisions (retenir, écarter, réexaminer, créer la fiche),
--   EN AJOUT SEUL (0367).
--
-- SQLSTATE du domaine (préfixe MQA, « veille des appels d'offres ») :
-- MQA01 historique de veille en ajout seul ;
-- MQA02 transition de statut d'un résultat refusée (0365) ;
-- MQA03 plafond de résultats par cabinet atteint, 5000 (0365) ;
-- MQA04 plafond d'occurrences par résultat atteint, 500 (0366) ;
-- MQA05 décision incohérente avec l'état du résultat (0367).
-- Le portail client n'y accède jamais (politique restrictive `portail_interdit`). Aucune marge ni
-- donnée FIN-02 : la veille ne porte que des avis publics et un score de rapprochement.

CREATE FUNCTION refuser_modification_veille() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Historique de la veille en ajout seul.' USING ERRCODE = 'MQA01';
  END $$;

CREATE TABLE ao_veille_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (code ~ '^[a-z0-9_]{1,40}$'),
  active boolean NOT NULL DEFAULT false,
  modifie_par uuid NOT NULL,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, code),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE ao_veille_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ao_veille_sources
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON ao_veille_sources AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON ao_veille_sources FROM missionpilot_app;
REVOKE UPDATE ON ao_veille_sources FROM missionpilot_app;
GRANT UPDATE (active, modifie_par, modifie_le) ON ao_veille_sources TO missionpilot_app;
