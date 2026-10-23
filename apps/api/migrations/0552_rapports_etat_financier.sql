-- REDÉFINITION DE `rapports_mission` À SIGNALER (table partagée du moteur de rapports, SOC-07) :
-- cette migration réécrit les contraintes `rapports_mission_modele_check`, `_niveau_check` et
-- `_source_check` (une contrainte CHECK ne s'étend pas : elle se réécrit en entier). À relire à
-- chaque fusion avec un autre lot qui ajoute un modèle de rapport.
--
-- NUMÉRO : 0552 (attribution centrale du superviseur ; hors de la plage DOS/PRV du lot 4b car une
-- réécriture numérotée avant 0508 serait écrasée par elle). Elle s'applique APRÈS 0508 (note au
-- comité) et 0551 (rapport de clôture du redressement, lot 2).
--
-- Rapport d'état financier du dossier client : nouveau modèle `etat_financier`, enregistré comme
-- les autres dans `rapports_mission` (ajout seul, 0130). Rendu des états financiers ACCEPTÉS du
-- dossier du client de la mission (`dossier_etats_financiers`, 0222), chiffres produits par le
-- moteur `syntheseEtatsFinanciers` (packages/engines/src/dossier), sans aucun calcul dans l'API ;
-- niveau « dossier » (lecture : « dossier.lire »). Ce sont des données DU CLIENT : aucune donnée
-- FIN-02 du cabinet n'y entre. Aucune source versionnée : `notation_id`, `plan_id`, `dd_note_id`,
-- `variante` et `version_source` restent nuls ; la cohérence mission/client est contrôlée par l'API
-- (rapports/etat-financier.ts) et l'état utilisé est tracé au journal d'audit.
--
-- UNION EXACTE des valeurs, sans en retirer aucune :
--   modèles : etat_avancement, notation, plan_strategique, dossier_bancaire, note_comite (0508),
--             cloture_redressement (0551), etat_financier (ici) ;
--   niveaux : base, jours, finance, notation, plan, dd (0508), red (0551), dossier (ici).
-- `controler_source_rapport()` (0508, puis 0551) n'est PAS redéfinie : le nouveau modèle n'a aucune
-- règle de source en base.
--
-- Écrite pour l'état fusionné avec 0551. Si la colonne `red_cloture_id` n'existe pas encore (lot 2
-- non fusionné), le bloc ci-dessous produit la contrainte sans la branche `cloture_redressement`
-- ni le niveau `red` ; avec 0551 appliquée, il produit l'union complète. Aucune colonne vers
-- `fichiers` : `fichier_orphelin` est inchangée.

DO $$
DECLARE
  v_red boolean := EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'rapports_mission'
      AND column_name = 'red_cloture_id');
  v_modeles text := '''etat_avancement'', ''notation'', ''plan_strategique'', ''dossier_bancaire'', '
    || '''note_comite''' || CASE WHEN v_red THEN ', ''cloture_redressement''' ELSE '' END
    || ', ''etat_financier''';
  v_niveaux text := '''base'', ''jours'', ''finance'', ''notation'', ''plan'', ''dd'''
    || CASE WHEN v_red THEN ', ''red''' ELSE '' END || ', ''dossier''';
  v_sans_red text := CASE WHEN v_red THEN ' AND red_cloture_id IS NULL' ELSE '' END;
  v_source text;
BEGIN
  v_source :=
    '(modele = ''etat_avancement'' AND notation_id IS NULL AND plan_id IS NULL'
      || ' AND version_source IS NULL AND niveau IN (''base'', ''jours'', ''finance'')'
      || ' AND dd_note_id IS NULL AND variante IS NULL' || v_sans_red || ')'
    || ' OR (modele = ''notation'' AND notation_id IS NOT NULL AND plan_id IS NULL'
      || ' AND version_source IS NOT NULL AND niveau = ''notation'''
      || ' AND dd_note_id IS NULL AND variante IS NULL' || v_sans_red || ')'
    || ' OR (modele = ''plan_strategique'' AND plan_id IS NOT NULL AND notation_id IS NULL'
      || ' AND niveau = ''plan'' AND dd_note_id IS NULL AND variante IS NULL' || v_sans_red || ')'
    || ' OR (modele = ''dossier_bancaire'' AND plan_id IS NOT NULL AND notation_id IS NULL'
      || ' AND version_source IS NOT NULL AND niveau = ''plan'''
      || ' AND dd_note_id IS NULL AND variante IS NULL' || v_sans_red || ')'
    || ' OR (modele = ''note_comite'' AND dd_note_id IS NOT NULL AND version_source IS NOT NULL'
      || ' AND variante IS NOT NULL AND notation_id IS NULL AND plan_id IS NULL'
      || ' AND niveau = ''dd''' || v_sans_red || ')'
    || CASE WHEN v_red THEN
      ' OR (modele = ''cloture_redressement'' AND red_cloture_id IS NOT NULL'
      || ' AND version_source IS NOT NULL AND notation_id IS NULL AND plan_id IS NULL'
      || ' AND dd_note_id IS NULL AND variante IS NULL AND niveau = ''red'')'
      ELSE '' END
    || ' OR (modele = ''etat_financier'' AND notation_id IS NULL AND plan_id IS NULL'
      || ' AND version_source IS NULL AND dd_note_id IS NULL AND variante IS NULL'
      || v_sans_red || ' AND niveau = ''dossier'')';

  ALTER TABLE rapports_mission
    DROP CONSTRAINT rapports_mission_modele_check,
    DROP CONSTRAINT rapports_mission_niveau_check,
    DROP CONSTRAINT rapports_mission_source_check;
  EXECUTE format('ALTER TABLE rapports_mission ADD CONSTRAINT rapports_mission_modele_check CHECK (modele IN (%s))', v_modeles);
  EXECUTE format('ALTER TABLE rapports_mission ADD CONSTRAINT rapports_mission_niveau_check CHECK (niveau IN (%s))', v_niveaux);
  EXECUTE format('ALTER TABLE rapports_mission ADD CONSTRAINT rapports_mission_source_check CHECK (%s)', v_source);
END $$;
