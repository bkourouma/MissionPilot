-- Pagination par curseur de GET /missions et GET /opportunites (plus récentes
-- d'abord) : tri `cree_le DESC, id DESC` et comparaison de ligne
-- `(cree_le, id) < (curseur)`, servis par ces index dans le cabinet courant
-- (RLS : cabinet_id = app_cabinet_id()). Remplace la clé texte calculée, qui
-- imposait un parcours et un tri complets à chaque page.
CREATE INDEX missions_recentes_idx ON missions (cabinet_id, cree_le DESC, id DESC);
CREATE INDEX opportunites_recentes_idx ON opportunites (cabinet_id, cree_le DESC, id DESC);
