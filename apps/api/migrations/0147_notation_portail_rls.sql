-- Notation et portail client : aucune table de notation n'est visible ni
-- modifiable dans une transaction du portail (le partage d'un rapport publié
-- avec le client relèvera d'un partage explicite, NOT-08, V3).

CREATE POLICY portail_interdit ON notation_grilles AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
CREATE POLICY portail_interdit ON notation_grille_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
CREATE POLICY portail_interdit ON notations AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
CREATE POLICY portail_interdit ON notation_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
CREATE POLICY portail_interdit ON notation_ajustements AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
CREATE POLICY portail_interdit ON notation_evenements AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
