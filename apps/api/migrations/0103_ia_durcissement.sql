-- Durcissement du socle IA (audit de sécurité du 2026-10-06).
--
-- - ia_reservations : coût ESTIMÉ d'un appel au fournisseur, inscrit sous le
--   verrou du plafond du cabinet AVANT l'appel, dans la même transaction que
--   la vérification, et compté avec la consommation (ia/couts.ts,
--   consommeDuMois) : des appels simultanés ne dépassent plus le plafond.
--   Soldée (supprimée) à la clôture, dans la transaction qui inscrit le coût
--   réel. Une réservation orpheline (processus arrêté pendant l'appel) cesse
--   de compter à `expire_le`. Sans demande : test du fournisseur.
-- - ia_consommations : issues « delai_depasse » et « reponse_invalide »
--   (l'appel a pu être facturé : compté au coût ESTIMÉ) ; `source_cle` (clé
--   du cabinet ou de la plateforme), base du plafond de plateforme.
-- - ia_parametres_cabinet.ia_activee : FAUX par défaut ; l'IA ne s'utilise
--   qu'après une activation explicite par le cabinet.
-- - ia_demandes : index du quota journalier par utilisateur.

CREATE TABLE ia_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  demande_id uuid,
  cout_estime_micro_usd bigint NOT NULL CHECK (cout_estime_micro_usd >= 0),
  cree_le timestamptz NOT NULL DEFAULT now(),
  expire_le timestamptz NOT NULL,
  CHECK (expire_le > cree_le),
  UNIQUE (cabinet_id, demande_id),
  FOREIGN KEY (cabinet_id, demande_id) REFERENCES ia_demandes (cabinet_id, id)
);
CREATE INDEX ia_reservations_expiration_idx ON ia_reservations (cabinet_id, expire_le);
ALTER TABLE ia_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ia_reservations
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
-- Une réservation naît puis disparaît (soldée ou expirée) : jamais modifiée.
REVOKE UPDATE ON ia_reservations FROM missionpilot_app;

ALTER TABLE ia_consommations DROP CONSTRAINT ia_consommations_issue_check;
ALTER TABLE ia_consommations ADD CONSTRAINT ia_consommations_issue_check
  CHECK (issue IN ('succes', 'sortie_invalide', 'annulee', 'test', 'delai_depasse',
                   'reponse_invalide'));
-- Lignes antérieures (développement seulement) : clé de plateforme par défaut.
ALTER TABLE ia_consommations ADD COLUMN source_cle text NOT NULL DEFAULT 'plateforme'
  CHECK (source_cle IN ('cabinet', 'plateforme'));
ALTER TABLE ia_consommations ALTER COLUMN source_cle DROP DEFAULT;

ALTER TABLE ia_parametres_cabinet ALTER COLUMN ia_activee SET DEFAULT false;
-- Les lignes existantes (développement seulement) ont reçu l'ancien défaut
-- (vrai) sans activation explicite : l'IA est à réactiver par le cabinet.
UPDATE ia_parametres_cabinet SET ia_activee = false;

CREATE INDEX ia_demandes_demandeur_idx ON ia_demandes (cabinet_id, demandeur_id, cree_le);
