-- Rapports générés (SOC-07) : trace de chaque rapport produit par le moteur
-- de rapports (apps/api/src/rapports), relié au fichier du stockage qui le
-- contient et à sa mission. Ajout seul : le rôle applicatif ne modifie ni
-- ne supprime une ligne.
--
-- Un rapport N'EST PAS un document de mission (aucune version dans
-- mission_documents) : sa lecture ne suit pas les règles des documents, et
-- un document téléversé sous le même nom ne peut pas passer pour un rapport
-- généré (seules les lignes de cette table, écrites par le serveur, en sont).
--
-- `niveau` est calculé par le code d'après les sections incluses
-- (rapports/niveaux.ts) : « base » (ni jours ni finances), « jours »
-- (budget.lire_jours), « finance » (coûts, taux, marges : finance.lire, FIN-02).
-- La lecture (stockage/fichiers.ts `exigerFichierLisible`) exige À CHAQUE FOIS
-- la mission visible, « mission.lire » et les permissions du niveau, sans
-- condition d'auteur.
--
-- Conservation : NON TRAITÉE. Les rapports sont en ajout seul et ne sont
-- jamais purgés (ils ne sont pas orphelins pour `fichier_orphelin`) ; ils
-- comptent dans le quota de stockage du cabinet. Une durée de conservation et
-- une purge restent à décider (SECURITY.md §12).

CREATE TABLE rapports_mission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  fichier_id uuid NOT NULL,
  modele text NOT NULL CHECK (modele IN ('etat_avancement')),
  format text NOT NULL CHECK (format IN ('pdf', 'docx', 'pptx')),
  statut text NOT NULL CHECK (statut IN ('brouillon', 'valide')),
  niveau text NOT NULL CHECK (niveau IN ('base', 'jours', 'finance')),
  genere_par uuid NOT NULL,
  genere_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (fichier_id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, fichier_id) REFERENCES fichiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, genere_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX rapports_mission_idx ON rapports_mission (cabinet_id, mission_id, genere_le);
-- Débit des générations par utilisateur (rapports/enregistrement.ts).
CREATE INDEX rapports_mission_auteur_idx ON rapports_mission (cabinet_id, genere_par, genere_le);
ALTER TABLE rapports_mission ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON rapports_mission
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
-- Portail client (0113) : table interne, invisible dans une transaction du portail.
CREATE POLICY portail_interdit ON rapports_mission AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON rapports_mission FROM missionpilot_app;

-- Un fichier de rapport n'est pas orphelin (reprend 0073 en ajoutant les rapports) :
-- il n'est ni purgé à 24 h, ni retirable, ni rattachable à un document ou un débours.
CREATE OR REPLACE FUNCTION fichier_orphelin(p_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = public, pg_temp
  AS $$
    SELECT NOT EXISTS (SELECT 1 FROM mission_documents d WHERE d.fichier_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM debours b WHERE b.justificatif_fichier_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM rapports_mission r WHERE r.fichier_id = p_id)
       AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = p_id) $$;
