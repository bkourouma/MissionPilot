-- Clé d'idempotence des saisies de temps (HANDOFF n° 5 ; rejeu hors ligne).
--
-- Le client hors ligne (apps/web/src/lib/hors-ligne) rejoue ses saisies par
-- `PUT /feuilles-temps/:id/lignes` avec un en-tête `Idempotency-Key`. Un PUT
-- complet rejoué redonne le même état, mais un rejeu TARDIF (réponse perdue,
-- puis saisie plus récente depuis un autre appareil) écraserait la saisie plus
-- récente : l'API enregistre donc la clé la première fois et ne ré-applique
-- jamais deux fois la même clé.
--
-- - Unicité par cabinet, utilisateur ET clé : deux utilisateurs peuvent tirer
--   la même clé sans se voir ni se gêner.
-- - `empreinte` : SHA-256 du contenu des lignes. Même clé avec un autre contenu
--   ou une autre feuille = clé réutilisée à tort, refusée (409).
-- - La ligne naît dans la transaction de la saisie : une saisie refusée
--   (feuille soumise, période clôturée…) annule aussi la clé, et le client peut
--   la rejouer. Une clé n'a donc de sens qu'après une saisie APPLIQUÉE.
-- - Les clés de plus de 30 jours sont supprimées au fil des saisies de leur
--   utilisateur (la file hors ligne ne garde pas une entrée aussi longtemps).
-- - Le portail n'y a aucun accès.

CREATE TABLE saisies_idempotence (
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  utilisateur_id uuid NOT NULL,
  cle text NOT NULL CHECK (cle ~ '^[A-Za-z0-9_-]{8,100}$'),
  feuille_id uuid NOT NULL,
  empreinte text NOT NULL CHECK (empreinte ~ '^[0-9a-f]{64}$'),
  cree_le timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cabinet_id, utilisateur_id, cle),
  FOREIGN KEY (cabinet_id, utilisateur_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, feuille_id) REFERENCES feuilles_temps (cabinet_id, id)
);
CREATE INDEX saisies_idempotence_age_idx ON saisies_idempotence (cabinet_id, utilisateur_id, cree_le);
ALTER TABLE saisies_idempotence ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON saisies_idempotence
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON saisies_idempotence AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
-- Une clé n'est jamais modifiée.
REVOKE UPDATE ON saisies_idempotence FROM missionpilot_app;
