-- Référentiel de méthodes — service candidat « Business plan bancable et
-- recherche de financement » (PRD complémentaire §4, §11.3 PLA-17 et §11.6 :
-- un service s'ajoute au référentiel par assemblage de briques, sans
-- développement spécifique). Méthode du STANDARD (`cabinet_id` NULL), version 1
-- publiée, écrite comme 0205.
--
-- Briques réutilisées : modèle financier et scénarios (moteurs `plan.*`),
-- bancabilité PLA-17 (ratios calculés par `analyserBancabilite` de
-- `packages/engines`), dossier bancaire (modèle de rapport `dossier_bancaire`,
-- migration 0424, aucun nouveau modèle), veille des guichets.
--
-- PROVISOIRE : tout le contenu (briques, temps types, classes de risque,
-- rubriques, règles, cas types) est une proposition de départ, à valider par un
-- expert métier avant tout usage client. L'IA propose, l'expert dispose ; aucun
-- chiffre ne vient du modèle de langage.
--
-- Les briques « bancabilité » et « plan de financement » n'ont pas de moteur
-- (`moteur` NULL) : `MOTEURS_STANDARD` ne contient aucun code « plan.bancabilite » ;
-- le calcul est décrit dans `entrees` et `objet`.

CREATE FUNCTION pg_temp.methode(p_service text, p_code text, p_libelle text, p_description text)
  RETURNS uuid
  LANGUAGE plpgsql
  AS $$
  DECLARE v_methode uuid; v_version uuid;
  BEGIN
    INSERT INTO methodes (service_id, code, libelle, description)
      SELECT id, p_code, p_libelle, p_description FROM services_conseil
       WHERE cabinet_id IS NULL AND code = p_service
      RETURNING id INTO v_methode;
    INSERT INTO methode_versions (methode_id, version, notes_version)
      VALUES (v_methode, 1,
        'PROVISOIRE — contenu à valider par un expert métier avant tout usage client. Version initiale du service candidat.')
      RETURNING id INTO v_version;
    RETURN v_version;
  END $$;

CREATE FUNCTION pg_temp.etape(p_version uuid, p_ordre integer, p_code text, p_libelle text, p_description text)
  RETURNS void
  LANGUAGE sql
  AS $$ INSERT INTO methode_etapes (version_id, ordre, code, libelle, description)
        VALUES (p_version, p_ordre, p_code, p_libelle, p_description) $$;

CREATE FUNCTION pg_temp.brique(
  p_version uuid, p_etape text, p_ordre integer, p_code text, p_libelle text, p_objet text,
  p_entrees text, p_moteur text, p_agent text, p_classe text, p_garde text, p_sortie text,
  p_termine text, p_temps numeric, p_profil text, p_niveau text, p_active boolean)
  RETURNS void
  LANGUAGE sql
  AS $$
    INSERT INTO methode_briques (version_id, etape_id, ordre, code, libelle, objet, entrees, moteur,
      agent, classe_risque, garde, sortie, definition_termine, temps_type_jours, profil_temps,
      niveau_autonomie_max, active_par_defaut)
    SELECT p_version, e.id, p_ordre, p_code, p_libelle, p_objet, p_entrees, p_moteur, p_agent,
      p_classe, p_garde, p_sortie, p_termine, p_temps, p_profil, p_niveau, p_active
      FROM methode_etapes e WHERE e.version_id = p_version AND e.code = p_etape $$;

CREATE FUNCTION pg_temp.element(
  p_version uuid, p_brique text, p_type text, p_code text, p_libelle text, p_description text,
  p_essentiel boolean, p_actif boolean)
  RETURNS void
  LANGUAGE sql
  AS $$
    INSERT INTO methode_elements (version_id, brique_id, type, code, libelle, description, essentiel,
      actif_par_defaut)
    VALUES (p_version, (SELECT id FROM methode_briques WHERE version_id = p_version AND code = p_brique),
      p_type, p_code, p_libelle, p_description, p_essentiel, p_actif) $$;

CREATE FUNCTION pg_temp.regle(p_version uuid, p_regle jsonb) RETURNS void
  LANGUAGE sql
  AS $$ INSERT INTO methode_regles (version_id, code, regle) VALUES (p_version, p_regle ->> 'code', p_regle) $$;

CREATE FUNCTION pg_temp.cas(p_version uuid, p_code text, p_libelle text, p_cas jsonb) RETURNS void
  LANGUAGE sql
  AS $$ INSERT INTO methode_cas_types (version_id, code, libelle, cas) VALUES (p_version, p_code, p_libelle, p_cas) $$;

CREATE FUNCTION pg_temp.publier(p_version uuid) RETURNS void
  LANGUAGE sql
  AS $$ UPDATE methode_versions SET statut = 'publiee', publie_le = now() WHERE id = p_version $$;

INSERT INTO services_conseil (code, libelle, description, ordre) VALUES
  ('business_plan_bancable', 'Business plan bancable et recherche de financement',
   'Service candidat (provisoire, à valider par un expert métier) : du diagnostic financier au dossier bancaire et au suivi des demandes de financement.',
   7);

DO $$
DECLARE v uuid;
BEGIN
  v := pg_temp.methode('business_plan_bancable', 'business_plan_bancable',
    'Business plan bancable et recherche de financement',
    'PROVISOIRE — contenu à valider par un expert métier avant tout usage client. Du cadrage du projet au dossier bancaire : diagnostic financier historique, modèle financier calculé par le moteur, bancabilité (PLA-17), plan de financement, dossier et suivi des demandes auprès des guichets.');

  INSERT INTO notes_contexte (cible_type, cible_code, contexte, texte) VALUES
    ('methode', 'business_plan_bancable', 'Contenu provisoire',
     'À valider par un expert métier : briques, temps types, classes de risque, rubriques et règles sont des propositions de départ.');

  PERFORM pg_temp.etape(v, 1, 'cadrage_projet', 'Cadrage du projet', 'Projet à financer, besoin, interlocuteurs, pièces attendues.');
  PERFORM pg_temp.etape(v, 2, 'diagnostic_financier', 'Diagnostic financier historique', 'Documents, états financiers, fiabilité de l''information.');
  PERFORM pg_temp.etape(v, 3, 'modele_financier', 'Modèle financier', 'Hypothèses, calcul par le moteur, scénarios.');
  PERFORM pg_temp.etape(v, 4, 'bancabilite', 'Bancabilité et plan de financement', 'Ratios bancaires (PLA-17) et plan de financement du projet.');
  PERFORM pg_temp.etape(v, 5, 'dossier_financement', 'Dossier et recherche de financement', 'Dossier bancaire, guichets, demandes et suivi.');
  PERFORM pg_temp.etape(v, 6, 'restitution', 'Restitution', 'Présentation au dirigeant et suites.');

  -- Cadrage
  PERFORM pg_temp.brique(v, 'cadrage_projet', 1, 'cadrage_projet', 'Cadrage du projet',
    'Fixer avec le dirigeant le projet à financer, le montant recherché, le calendrier et les financeurs visés. À valider par un expert.',
    'Proposition signée ; description du projet', NULL, NULL, 'R2', NULL,
    'Note de cadrage validée par le dirigeant', 'Projet, besoin de financement et calendrier validés',
    1, 'Chef de mission', 'N1', true);

  -- Diagnostic financier historique
  PERFORM pg_temp.brique(v, 'diagnostic_financier', 1, 'collecte_documentaire', 'Collecte documentaire',
    'Rassembler les états financiers, relevés bancaires, contrats et pièces administratives. À valider par un expert.',
    'Liste des pièces demandées', NULL, 'documentaire', 'R1', NULL, 'Documents classés',
    'Chaque pièce reçue ou signalée manquante', 2, 'Consultant', 'N2', true);
  PERFORM pg_temp.brique(v, 'diagnostic_financier', 2, 'analyse_historique', 'Analyse financière historique',
    'Analyser les trois derniers exercices : activité, rentabilité, structure financière, trésorerie. À valider par un expert.',
    'États financiers des trois derniers exercices', NULL, 'analyste', 'R2', NULL,
    'Base historique du modèle financier', 'Chaque chiffre vient d''un état financier identifié',
    2, 'Consultant senior', 'N2', true);
  PERFORM pg_temp.brique(v, 'diagnostic_financier', 3, 'reconstitution_ca', 'Reconstitution du chiffre d''affaires',
    'Reconstituer le chiffre d''affaires par les encaissements bancaires et Mobile Money quand les comptes sont fragiles. Inactive par défaut. À valider par un expert.',
    'Relevés bancaires et Mobile Money sur 12 mois', NULL, 'analyste', 'R2', NULL,
    'Chiffre d''affaires reconstitué et écart au déclaré', 'Écart au chiffre déclaré expliqué ou signalé',
    1.5, 'Consultant senior', 'N1', false);

  -- Modèle financier
  PERFORM pg_temp.brique(v, 'modele_financier', 1, 'hypotheses', 'Hypothèses du modèle',
    'Poser les hypothèses de chiffre d''affaires, de charges, d''investissement et de financement. À valider par un expert.',
    'Analyse historique ; description du projet', NULL, NULL, 'R2', NULL, 'Hypothèses versionnées',
    'Chaque hypothèse est justifiée', 2, 'Consultant senior', 'N1', true);
  PERFORM pg_temp.brique(v, 'modele_financier', 2, 'calcul_modele', 'Calcul du modèle financier',
    'Calculer comptes prévisionnels, trésorerie et indicateurs par le moteur (jamais par l''IA). À valider par un expert.',
    'Hypothèses validées', 'plan.modele_financier', NULL, 'R3',
    'Version validée par un responsable qui n''est pas l''auteur de la version',
    'Version du modèle financier', 'Version validée par un responsable qui n''en est pas l''auteur',
    0.5, 'Consultant senior', 'N0', true);
  PERFORM pg_temp.brique(v, 'modele_financier', 3, 'scenarios', 'Scénarios',
    'Comparer les scénarios prudent, central et ambitieux. À valider par un expert.',
    'Version du modèle', 'plan.scenarios', NULL, 'R2', NULL, 'Tableau des scénarios',
    'Écarts entre scénarios commentés', 0.5, 'Consultant', 'N0', true);
  PERFORM pg_temp.brique(v, 'modele_financier', 4, 'bfr_saisonnier', 'BFR saisonnier',
    'Modéliser le besoin en fonds de roulement selon la campagne ; inactive par défaut, activée pour les filières agricoles. À valider par un expert.',
    'Calendrier de campagne ; version du modèle', NULL, NULL, 'R2', NULL, 'Hypothèses de BFR par mois',
    'Pic de BFR identifié et financé', 1, 'Consultant senior', 'N1', false);

  -- Bancabilité et plan de financement
  PERFORM pg_temp.brique(v, 'bancabilite', 1, 'bancabilite_pla17', 'Bancabilité (PLA-17)',
    'Calculer les ratios bancaires du projet (couverture du service de la dette, endettement, dette nette sur EBE, capacité de remboursement, BFR en jours) par le moteur de bancabilité (analyserBancabilite), uniquement depuis une version VALIDÉE du modèle financier. Aucun code de moteur dédié n''existe dans le référentiel : le calcul est porté par l''existant (apps/api/src/plans/bancabilite.ts). À valider par un expert.',
    'Version validée du modèle financier ; échéancier de la dette prévue', NULL, NULL, 'R2',
    'Ratios non modifiables à la main ; commentaire relu par un responsable',
    'Ratios de bancabilité et lecture commentée', 'Tous les ratios viennent du moteur et d''une version validée',
    1, 'Consultant senior', 'N0', true);
  PERFORM pg_temp.brique(v, 'bancabilite', 2, 'plan_financement', 'Plan de financement',
    'Construire le plan de financement du projet (emplois et ressources, apport, concours demandés) à partir de la version validée du modèle financier ; les montants sortent du moteur, pas du modèle de langage. Pas de moteur dédié dans le référentiel. À valider par un expert.',
    'Version validée du modèle financier ; ratios de bancabilité', NULL, NULL, 'R3',
    'Validation par un responsable', 'Plan de financement équilibré emplois-ressources',
    'Emplois et ressources équilibrés, chaque concours rattaché à un guichet ou à un apport',
    1.5, 'Chef de mission', 'N1', true);

  -- Dossier et recherche de financement
  PERFORM pg_temp.brique(v, 'dossier_financement', 1, 'dossier_bancaire', 'Dossier bancaire',
    'Dossier bancaire (PDF/Word) rendu par le moteur de rapports existant, modèle dossier_bancaire ; aucun nouveau modèle de rapport. Contenu validé uniquement. À valider par un expert.',
    'Version validée du modèle financier ; ratios de bancabilité ; contenu validé', NULL, 'redacteur', 'R3',
    'Validation par le directeur de mission avant tout envoi à un financeur',
    'Dossier bancaire (PDF et Word)', 'Tout le contenu reproduit est validé et chaque chiffre est sourcé',
    3, 'Chef de mission', 'N2', true);
  PERFORM pg_temp.brique(v, 'dossier_financement', 2, 'veille_guichets', 'Veille des guichets de financement',
    'Repérer les guichets du cabinet adaptés au profil du client. À valider par un expert.',
    'Profil du client ; liste des guichets du cabinet', NULL, NULL, 'R1', NULL,
    'Liste des guichets du cabinet rapprochés du profil du client par le moteur de rapprochement déterministe ; aucune source externe',
    'Liste des guichets rapprochés relue', 1, 'Consultant', 'N2', true);
  PERFORM pg_temp.brique(v, 'dossier_financement', 3, 'suivi_demandes', 'Préparation et suivi des demandes de financement',
    'Préparer les demandes, suivre les réponses et les relances auprès des financeurs. À valider par un expert.',
    'Dossier bancaire ; guichets rapprochés', NULL, NULL, 'R2', NULL, 'Tableau de suivi des demandes',
    'Chaque demande a un statut et une prochaine échéance', 3, 'Consultant senior', 'N1', true);

  -- Restitution
  PERFORM pg_temp.brique(v, 'restitution', 1, 'restitution_dirigeant', 'Restitution au dirigeant',
    'Présenter au dirigeant le plan, la bancabilité, le dossier et les prochaines étapes. À valider par un expert.',
    'Dossier bancaire ; suivi des demandes', NULL, NULL, 'R2', NULL, 'Support de restitution',
    'Restitution tenue et décisions consignées', 1, 'Directeur de mission', 'N1', true);

  -- Éléments
  PERFORM pg_temp.element(v, 'dossier_bancaire', 'livrable', 'livrable_dossier_bancaire', 'Dossier bancaire',
    'PDF et Word, modèle de rapport dossier_bancaire, mention de la contribution IA.', false, true);
  PERFORM pg_temp.element(v, 'calcul_modele', 'livrable', 'modele_financier', 'Modèle financier', NULL, false, true);
  PERFORM pg_temp.element(v, 'plan_financement', 'livrable', 'livrable_plan_financement', 'Plan de financement', NULL, false, true);
  PERFORM pg_temp.element(v, 'veille_guichets', 'livrable', 'liste_guichets_rapproches', 'Liste des guichets rapprochés',
    'Guichets du cabinet rapprochés du profil du client ; aucune source externe.', false, true);
  PERFORM pg_temp.element(v, 'dossier_bancaire', 'gabarit', 'format_dossier', 'Format du dossier',
    'Standard ou adapté à un financeur (banque, bailleur, fonds).', false, true);
  PERFORM pg_temp.element(v, 'scenarios', 'gabarit', 'lecture_indicateurs', 'Lecture des indicateurs',
    'Standard ou saisonnière.', false, true);
  PERFORM pg_temp.element(v, 'analyse_historique', 'item', 'delais_creances_publiques',
    'Délais de paiement des créances publiques', 'Intégrés au BFR.', false, false);
  PERFORM pg_temp.element(v, 'bancabilite_pla17', 'kpi_type', 'kpi_couverture_dette', 'Couverture du service de la dette',
    'Capacité des flux d''exploitation à couvrir le service de la dette.', false, true);
  PERFORM pg_temp.element(v, 'bancabilite_pla17', 'kpi_type', 'kpi_bfr_jours', 'BFR en jours',
    'Besoin en fonds de roulement exprimé en jours de chiffre d''affaires.', false, true);
  PERFORM pg_temp.element(v, 'hypotheses', 'risque_type', 'risque_change', 'Risque de change', NULL, false, true);
  PERFORM pg_temp.element(v, 'analyse_historique', 'risque_type', 'comptes_non_fiables', 'Comptes non fiables', NULL, false, true);
  PERFORM pg_temp.element(v, 'suivi_demandes', 'initiative_type', 'structuration_financiere',
    'Structuration de la fonction financière', NULL, false, true);

  -- Rubriques à ancrages
  INSERT INTO methode_rubriques (version_id, brique_id, code, libelle, dimension, ancrages)
  SELECT v, b.id, r.code, r.libelle, r.dimension, r.ancrages::jsonb
    FROM methode_briques b,
    (VALUES
      ('qualite_information_financiere', 'Qualité de l''information financière', 'information_financiere', '[
        {"niveau": 1, "description": "Pas de comptabilité tenue à jour ; aucun état financier disponible.", "exemples": []},
        {"niveau": 2, "description": "Comptabilité irrégulière, états financiers établis tardivement et non certifiés.", "exemples": [{"contexte": "PME informelle", "texte": "Les ventes sont reconstituées à partir du carnet de caisse."}]},
        {"niveau": 3, "description": "États financiers annuels établis dans les délais, rapprochés des relevés bancaires.", "exemples": []},
        {"niveau": 4, "description": "Situation intermédiaire trimestrielle et comptes certifiés.", "exemples": []},
        {"niveau": 5, "description": "Comptabilité analytique, clôtures mensuelles et suivi budgétaire revu par la direction.", "exemples": []}
      ]')
    ) AS r(code, libelle, dimension, ancrages)
   WHERE b.version_id = v AND b.code = 'analyse_historique';

  INSERT INTO methode_rubriques (version_id, brique_id, code, libelle, dimension, ancrages)
  SELECT v, b.id, r.code, r.libelle, r.dimension, r.ancrages::jsonb
    FROM methode_briques b,
    (VALUES
      ('solidite_plan_financement', 'Solidité du plan de financement', 'plan_financement', '[
        {"niveau": 1, "description": "Besoin de financement non chiffré ; aucun apport ni garantie identifiés.", "exemples": []},
        {"niveau": 2, "description": "Besoin chiffré sans lien avec le modèle ; apport et garanties incertains.", "exemples": []},
        {"niveau": 3, "description": "Emplois et ressources équilibrés à partir du modèle validé ; apport confirmé.", "exemples": []},
        {"niveau": 4, "description": "Plan testé sur les scénarios prudent et central ; garanties et calendrier de décaissement documentés.", "exemples": []},
        {"niveau": 5, "description": "Plan robuste aux scénarios, plusieurs sources de financement identifiées et lettres d''intention obtenues.", "exemples": []}
      ]')
    ) AS r(code, libelle, dimension, ancrages)
   WHERE b.version_id = v AND b.code = 'plan_financement';

  -- Règles de modulation
  PERFORM pg_temp.regle(v, '{"code": "comptes_fragiles", "libelle": "Comptes non certifiés et part d''espèces forte", "priorite": 20,
    "condition": {"type": "tous", "conditions": [
      {"type": "comparaison", "facteur": "fiabilite_comptes", "comparateur": "egal", "valeur": "non_certifies"},
      {"type": "comparaison", "facteur": "part_informel", "comparateur": "egal", "valeur": "forte"}]},
    "effets": [{"type": "activer_brique", "brique": "reconstitution_ca"},
               {"type": "formulation", "cible": "analyse_historique", "choix": "indicative"},
               {"type": "relever_classe_risque", "cible": "analyse_historique", "classe": "R3"}]}');
  PERFORM pg_temp.regle(v, '{"code": "filiere_agricole", "libelle": "Filière agricole ou campagne saisonnière", "priorite": 10,
    "condition": {"type": "au_moins_un", "conditions": [
      {"type": "comparaison", "facteur": "filieres", "comparateur": "dans",
       "valeur": ["cacao", "anacarde", "cafe", "coton", "hevea", "palmier_huile"]},
      {"type": "comparaison", "facteur": "saisonnalite", "comparateur": "egal", "valeur": "campagne_agricole"},
      {"type": "comparaison", "facteur": "agricole", "comparateur": "egal", "valeur": true}]},
    "effets": [{"type": "activer_brique", "brique": "bfr_saisonnier"},
               {"type": "formulation", "cible": "lecture_indicateurs", "choix": "saisonniere"}]}');
  PERFORM pg_temp.regle(v, '{"code": "etat_actionnaire", "libelle": "État actionnaire", "priorite": 10,
    "condition": {"type": "comparaison", "facteur": "actionnariat", "comparateur": "egal", "valeur": "etat"},
    "effets": [{"type": "activer_item", "item": "delais_creances_publiques"}]}');
  PERFORM pg_temp.regle(v, '{"code": "financeur_institutionnel", "libelle": "Banque, bailleur ou fonds impliqué", "priorite": 10,
    "condition": {"type": "comparaison", "facteur": "financeur", "comparateur": "dans",
                  "valeur": ["banque", "bailleur", "fonds"]},
    "effets": [{"type": "gabarit", "cible": "format_dossier", "choix": "financeur"}]}');
  PERFORM pg_temp.regle(v, '{"code": "exposition_change", "libelle": "Exposition au change", "priorite": 10,
    "condition": {"type": "comparaison", "facteur": "commerce_exterieur", "comparateur": "contient", "valeur": "change"},
    "effets": [{"type": "recommandation_candidate", "recommandation": "risque_change"}]}');
  PERFORM pg_temp.regle(v, '{"code": "entreprise_en_tension", "libelle": "Entreprise en tension ou en difficulté", "priorite": 10,
    "condition": {"type": "comparaison", "facteur": "situation", "comparateur": "dans", "valeur": ["tension", "difficulte"]},
    "effets": [{"type": "recommandation_candidate", "recommandation": "structuration_financiere"}]}');

  -- Cas types
  PERFORM pg_temp.cas(v, 'cooperative_anacarde_banque', 'Coopérative d''anacarde aux comptes fragiles, banque impliquée', '{
    "contexte": {"effectif": 35, "fiabilite_comptes": "non_certifies", "part_informel": "forte",
                 "actionnariat": "cooperative", "filieres": ["anacarde"], "agricole": true,
                 "saisonnalite": "campagne_agricole", "financeur": "banque",
                 "commerce_exterieur": ["export", "change"]},
    "attendu": {
      "presents": [{"type": "activer_brique", "brique": "reconstitution_ca"},
                   {"type": "formulation", "cible": "analyse_historique", "choix": "indicative"},
                   {"type": "relever_classe_risque", "cible": "analyse_historique", "classe": "R3"},
                   {"type": "activer_brique", "brique": "bfr_saisonnier"},
                   {"type": "formulation", "cible": "lecture_indicateurs", "choix": "saisonniere"},
                   {"type": "gabarit", "cible": "format_dossier", "choix": "financeur"},
                   {"type": "recommandation_candidate", "recommandation": "risque_change"}],
      "regles_declenchees": ["comptes_fragiles", "filiere_agricole", "financeur_institutionnel", "exposition_change"],
      "conflits_non_resolus": 0}}');
  PERFORM pg_temp.cas(v, 'societe_etat', 'Société à participation publique, comptes certifiés', '{
    "contexte": {"effectif": 450, "fiabilite_comptes": "certifies", "actionnariat": "etat",
                 "agricole": false, "financeur": "aucun"},
    "attendu": {
      "presents": [{"type": "activer_item", "item": "delais_creances_publiques"}],
      "absents": [{"type": "activer_brique", "brique": "bfr_saisonnier"},
                  {"type": "activer_brique", "brique": "reconstitution_ca"},
                  {"type": "gabarit", "cible": "format_dossier", "choix": "financeur"}],
      "regles_declenchees": ["etat_actionnaire"], "conflits_non_resolus": 0}}');
  PERFORM pg_temp.cas(v, 'pme_en_tension_fonds', 'PME importatrice en tension, fonds d''investissement', '{
    "contexte": {"effectif": 60, "fiabilite_comptes": "certifies", "situation": "tension",
                 "financeur": "fonds", "commerce_exterieur": ["importations_intrants", "change"],
                 "agricole": false},
    "attendu": {
      "presents": [{"type": "gabarit", "cible": "format_dossier", "choix": "financeur"},
                   {"type": "recommandation_candidate", "recommandation": "risque_change"},
                   {"type": "recommandation_candidate", "recommandation": "structuration_financiere"}],
      "absents": [{"type": "activer_brique", "brique": "reconstitution_ca"},
                  {"type": "activer_brique", "brique": "bfr_saisonnier"}],
      "regles_declenchees": ["financeur_institutionnel", "exposition_change", "entreprise_en_tension"],
      "conflits_non_resolus": 0}}');
  PERFORM pg_temp.cas(v, 'pme_standard', 'PME sans particularité, sans financeur désigné', '{
    "contexte": {"effectif": 40, "fiabilite_comptes": "certifies", "part_informel": "faible",
                 "financeur": "aucun", "saisonnalite": "aucune", "agricole": false},
    "attendu": {
      "absents": [{"type": "activer_brique", "brique": "reconstitution_ca"},
                  {"type": "activer_brique", "brique": "bfr_saisonnier"},
                  {"type": "gabarit", "cible": "format_dossier", "choix": "financeur"}],
      "regles_declenchees": [], "conflits_non_resolus": 0}}');

  PERFORM pg_temp.publier(v);
END $$;

DROP FUNCTION pg_temp.methode(text, text, text, text);
DROP FUNCTION pg_temp.etape(uuid, integer, text, text, text);
DROP FUNCTION pg_temp.brique(uuid, text, integer, text, text, text, text, text, text, text, text, text,
  text, numeric, text, text, boolean);
DROP FUNCTION pg_temp.element(uuid, text, text, text, text, text, boolean, boolean);
DROP FUNCTION pg_temp.regle(uuid, jsonb);
DROP FUNCTION pg_temp.cas(uuid, text, text, jsonb);
DROP FUNCTION pg_temp.publier(uuid);
