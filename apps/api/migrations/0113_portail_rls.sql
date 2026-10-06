-- Portail client (SOC-09) : défense en profondeur par RLS.
--
-- Première barrière (application) : liste blanche stricte des routes pour un
-- utilisateur du portail (apps/api/src/portail/garde.ts) et permissions
-- portail.* (aucune permission interne). Seconde barrière (ici) : toute
-- transaction d'une requête du portail pose, en plus du cabinet, le
-- paramètre de transaction `app.portail_client_id` (db/pool.ts, contexte
-- rangé par la garde : apps/api/src/portail/contexte.ts ; `avecPortail` le
-- pose aussi). Quand il est posé, des politiques RESTRICTIVES limitent les
-- tables lues par le portail aux lignes de CE client effectivement
-- partagées, EN LECTURE SEULE sauf les tables d'écriture du portail, et
-- rendent invisibles (et non modifiables) les tables internes sensibles
-- (coûts, taux, budgets, temps, équipe, journal…). Compléments : 0114.
--
-- Sans ce paramètre (toute l'application interne), les politiques ajoutées
-- sont neutres : `app_portail_client_id() IS NULL` est vrai. Aucun
-- comportement existant ne change.
--
-- Convention (test d'inventaire : apps/api/test/isolation.test.ts) : toute
-- table à RLS porte une politique RESTRICTIVE `portail` (lecture filtrée) ou
-- `portail_interdit` (rien). Une table LUE par le portail a sa politique
-- `portail` en FOR SELECT, plus `portail_sans_insert`, `portail_sans_update`
-- et `portail_sans_delete` ; seules les tables d'ÉCRITURE du portail gardent
-- une politique `portail` FOR ALL (sa condition vaut aussi WITH CHECK).
-- NB : un verrou de ligne (SELECT … FOR UPDATE / FOR SHARE) est soumis aux
-- politiques UPDATE : il est impossible sur une table en lecture seule.

CREATE FUNCTION app_portail_client_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.portail_client_id', true), '')::uuid $$;

-- Tables internes : rien n'est visible ni modifiable dans une transaction du portail.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'grades', 'collaborateurs', 'collaborateur_couts', 'types_mission', 'modele_elements',
    'opportunites', 'propositions', 'proposition_elements', 'proposition_lignes',
    'proposition_taux', 'mission_equipe', 'mission_phases', 'mission_lots', 'mission_taches',
    'tache_budget_lignes', 'mission_dependances', 'budget_versions', 'budget_lignes',
    'affectations', 'absences', 'activites_internes', 'periodes_temps', 'feuilles_temps',
    'lignes_temps', 'feuille_validations', 'reste_a_faire', 'corrections_temps', 'alertes_suivi',
    'rappels_temps', 'parametres_temps', 'parametres_facturation', 'taux_clients', 'debours',
    'echeances_facturation', 'echeance_temps', 'facturation_liens', 'sequences_facturation',
    'encaissements', 'contre_passations', 'parametres_relances', 'relances_factures',
    'bilans_mission', 'plan_comptable_cabinet', 'plan_comptable_validation', 'contacts_client',
    'commentaires', 'commentaire_revisions', 'commentaire_suppressions', 'taches_collaboration',
    'mission_document_statuts', 'invitations']
  LOOP
    EXECUTE format(
      'CREATE POLICY portail_interdit ON %I AS RESTRICTIVE FOR ALL USING (app_portail_client_id() IS NULL)',
      t);
  END LOOP;
END $$;

-- Journal d'audit : le portail y écrit (accès journalisés) mais n'y lit rien.
CREATE POLICY portail_interdit ON journal_audit AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL);

-- Tables lues par le portail : seulement CE client et ses partages, en LECTURE.
CREATE POLICY portail ON clients AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR id = app_portail_client_id());

CREATE POLICY portail ON utilisateurs_portail AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR client_id = app_portail_client_id());
CREATE POLICY portail ON portail_clients AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR client_id = app_portail_client_id());
CREATE POLICY portail ON portail_partages AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR client_id = app_portail_client_id());

-- Table d'ÉCRITURE du portail (validation d'un jalon par le dirigeant
-- client) : FOR ALL, la condition vaut aussi pour la ligne insérée.
CREATE POLICY portail ON portail_validations_jalons AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL OR client_id = app_portail_client_id());

CREATE POLICY portail ON missions AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR (
    client_id = app_portail_client_id()
    AND EXISTS (SELECT 1 FROM portail_partages p WHERE p.mission_id = missions.id
                AND p.client_id = missions.client_id AND p.document_id IS NULL)));

-- Les sous-requêtes sur missions et factures sont elles-mêmes filtrées par
-- leurs politiques : client ET partage sont revérifiés.
CREATE POLICY portail ON mission_jalons AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR (
    EXISTS (SELECT 1 FROM missions m WHERE m.id = mission_jalons.mission_id)
    AND EXISTS (SELECT 1 FROM portail_partages p WHERE p.mission_id = mission_jalons.mission_id
                AND p.document_id IS NULL AND p.jalons)));

CREATE POLICY portail ON mission_documents AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR (
    (statut_contenu IS NULL OR statut_contenu = 'valide')
    AND EXISTS (SELECT 1 FROM missions m WHERE m.id = mission_documents.mission_id)
    AND EXISTS (SELECT 1 FROM portail_partages p WHERE p.document_id = mission_documents.id)));

CREATE POLICY portail ON fichiers AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL
         OR EXISTS (SELECT 1 FROM mission_documents d WHERE d.fichier_id = fichiers.id));

CREATE POLICY portail ON factures AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR (
    client_id = app_portail_client_id() AND statut IN ('emise', 'annulee')
    AND EXISTS (SELECT 1 FROM missions m WHERE m.id = factures.mission_id)
    AND EXISTS (SELECT 1 FROM portail_partages p WHERE p.mission_id = factures.mission_id
                AND p.document_id IS NULL AND p.factures)));

CREATE POLICY portail ON facture_lignes AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL
         OR EXISTS (SELECT 1 FROM factures f WHERE f.id = facture_lignes.facture_id));

CREATE POLICY portail ON imputations AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL
         OR EXISTS (SELECT 1 FROM factures f WHERE f.id = imputations.facture_id));

-- Lecture seule dans une transaction du portail : aucune insertion,
-- modification ni suppression (une modification ou une suppression ne
-- touche aucune ligne ; une insertion est refusée).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clients', 'utilisateurs_portail', 'portail_clients', 'portail_partages', 'missions',
    'mission_jalons', 'mission_documents', 'fichiers', 'factures', 'facture_lignes', 'imputations']
  LOOP
    EXECUTE format('CREATE POLICY portail_sans_insert ON %I AS RESTRICTIVE FOR INSERT
                      WITH CHECK (app_portail_client_id() IS NULL)', t);
    EXECUTE format('CREATE POLICY portail_sans_update ON %I AS RESTRICTIVE FOR UPDATE
                      USING (app_portail_client_id() IS NULL)', t);
    EXECUTE format('CREATE POLICY portail_sans_delete ON %I AS RESTRICTIVE FOR DELETE
                      USING (app_portail_client_id() IS NULL)', t);
  END LOOP;
END $$;

-- Un utilisateur du portail n'est jamais désigné dans le cabinet : équipe de
-- mission, fiche collaborateur, tâche assignée, contact principal. Code
-- 23503 (référence invalide) : traduit en 400 par les routes existantes.
CREATE FUNCTION refuser_utilisateur_portail() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_id uuid := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
  BEGIN
    IF v_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM utilisateurs u WHERE u.id = v_id
         AND u.roles && ARRAY['client_dirigeant', 'client_contributeur', 'client_investisseur']) THEN
      RAISE EXCEPTION 'Un utilisateur du portail client ne peut pas être désigné ici.'
        USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER mission_equipe_sans_portail BEFORE INSERT OR UPDATE OF utilisateur_id ON mission_equipe
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('utilisateur_id');
CREATE TRIGGER collaborateurs_sans_portail BEFORE INSERT OR UPDATE OF utilisateur_id ON collaborateurs
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('utilisateur_id');
CREATE TRIGGER taches_collaboration_sans_portail BEFORE INSERT OR UPDATE OF assignee_id ON taches_collaboration
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('assignee_id');
CREATE TRIGGER missions_directeur_sans_portail BEFORE INSERT OR UPDATE OF directeur_id ON missions
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('directeur_id');
CREATE TRIGGER missions_chef_sans_portail BEFORE INSERT OR UPDATE OF chef_id ON missions
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('chef_id');
CREATE TRIGGER portail_clients_contact_interne BEFORE INSERT OR UPDATE ON portail_clients
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('contact_principal_id');
