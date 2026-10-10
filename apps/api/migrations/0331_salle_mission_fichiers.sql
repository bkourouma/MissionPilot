-- Salle de mission (CLI-01) : fichiers déposés par le client depuis le portail.
--
-- 1. Un fichier cité par un dépôt de la salle de mission n'est pas orphelin : `fichier_orphelin`
--    (dernière définition : 0268) reprend TOUTES les références existantes et ajoute
--    `salle_depots.fichier_id`, sinon la purge à 24 h (stockage/purge.ts) effacerait la pièce.
--    CREATE OR REPLACE conserve propriété et droits ; numéro après 0330 (table citée).
--    Toute migration ultérieure qui redéfinit cette fonction doit garder cette référence.
--
-- 2. Portail : un utilisateur du portail téléverse SES fichiers (route de dépôt de la salle de
--    mission, seule route ouverte qui écrit un fichier ; liste blanche, portail/garde.ts). La
--    politique `portail_sans_insert` de 0113 est remplacée par `portail_depot` : insertion dans
--    une transaction du portail seulement si `envoye_par` est l'utilisateur du portail de la
--    transaction. La lecture (`portail`, 0113) admet en plus SES propres fichiers (l'insertion
--    renvoie la ligne créée) et ceux des dépôts de la salle visibles du portail (dépôts de SON
--    entreprise sur une demande envoyée, politique `portail` de `salle_depots`, 0330), à côté
--    des livrables partagés. Le contenu n'est jamais servi au portail par ces routes : seules
--    les métadonnées (nom, type, taille) sont projetées.
--
-- 3. Quota : `octets_stockage_utilises` (0073) devient SECURITY DEFINER, bornée au cabinet de la
--    transaction (`app_cabinet_id()`, posé par withTenant). Dans une transaction du portail, la
--    RLS ne montre que les fichiers visibles du client : la somme d'invocateur sous-estimerait
--    l'espace occupé et le quota du cabinet ne serait plus tenu. Elle ne renvoie qu'un nombre
--    au code serveur, jamais servi au client.

CREATE OR REPLACE FUNCTION fichier_orphelin(p_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = public, pg_temp
  AS $$
    SELECT NOT EXISTS (SELECT 1 FROM mission_documents d WHERE d.fichier_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM debours b WHERE b.justificatif_fichier_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM rapports_mission r WHERE r.fichier_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM preuve_versions v WHERE v.fichier_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM dossier_faits f WHERE f.source_document_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM dossier_facteurs g WHERE g.source_document_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM salle_depots x WHERE x.fichier_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = p_id) $$;

DROP POLICY portail_sans_insert ON fichiers;
CREATE POLICY portail_depot ON fichiers AS RESTRICTIVE FOR INSERT
  WITH CHECK (app_portail_client_id() IS NULL OR envoye_par = app_portail_utilisateur());

DROP POLICY portail ON fichiers;
CREATE POLICY portail ON fichiers AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL
         OR EXISTS (SELECT 1 FROM mission_documents d WHERE d.fichier_id = fichiers.id)
         OR EXISTS (SELECT 1 FROM salle_depots x WHERE x.fichier_id = fichiers.id)
         OR envoye_par = app_portail_utilisateur());

CREATE OR REPLACE FUNCTION octets_stockage_utilises() RETURNS bigint
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT coalesce(sum(f.taille), 0)::bigint FROM fichiers f
    WHERE f.cabinet_id = app_cabinet_id()
      AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = f.id) $$;
REVOKE ALL ON FUNCTION octets_stockage_utilises() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION octets_stockage_utilises() TO missionpilot_app;
