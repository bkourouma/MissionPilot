-- Référentiel de méthodes (lot STD) — amorçage du STANDARD MissionPilot :
-- deux méthodes phares (PRD complémentaire §20, « deux méthodes phares
-- d'abord ») décrites en briques, avec les règles de modulation d'exemple du
-- PRD §4.4 et leurs cas types. Version 1 publiée (immuable ensuite, MPM01).
--
-- - « Notation d'entreprise » (service #1) : cadrage, collecte, analyse des
--   écarts de perception, notation, restitution ; moteurs de
--   `packages/engines` référencés par code (`MOTEURS_STANDARD`).
-- - « Plan stratégique » (service #3) : diagnostic, orientations,
--   initiatives, modèle financier, pilotage.
-- Temps types, classes de risque et niveaux d'autonomie : valeurs proposées,
-- à calibrer par le comité méthode (puis par l'historique réel, CAP-02).
-- Codes d'agents (`agent`) : ceux du registre du lot AGT (0260 : collecte,
-- documentaire, analyste, redacteur…).

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
      VALUES (v_methode, 1, 'Version initiale du standard MissionPilot (vague 1).')
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

DO $$
DECLARE v uuid;
BEGIN
  -- =========================================================================
  -- Notation d'entreprise
  -- =========================================================================
  v := pg_temp.methode('notation', 'notation_entreprise', 'Notation d''entreprise',
    'Note de maturité managériale fiable, explicable et comparable : cadrage, collecte par questionnaires, analyse des écarts de perception, calcul par le moteur, revue et publication par un expert, restitution.');

  PERFORM pg_temp.etape(v, 1, 'cadrage', 'Cadrage', 'Périmètre, populations de répondants, calendrier.');
  PERFORM pg_temp.etape(v, 2, 'collecte', 'Collecte', 'Questionnaires, relances, documents.');
  PERFORM pg_temp.etape(v, 3, 'analyse', 'Analyse des écarts de perception', 'Notes par population, écarts, analyse financière.');
  PERFORM pg_temp.etape(v, 4, 'notation', 'Notation', 'Calcul par le moteur, ajustements motivés, revue et publication.');
  PERFORM pg_temp.etape(v, 5, 'restitution', 'Restitution', 'Rapport, restitution aux dirigeants, plan d''action.');

  PERFORM pg_temp.brique(v, 'cadrage', 1, 'cadrage_mission', 'Cadrage de la notation',
    'Fixer avec le dirigeant le périmètre, les populations de répondants, le calendrier et les livrables.',
    'Proposition signée ; organigramme', NULL, NULL, 'R2', NULL, 'Note de cadrage validée par le dirigeant',
    'Périmètre, populations et calendrier validés', 0.5, 'Chef de mission', 'N1', true);
  PERFORM pg_temp.brique(v, 'cadrage', 2, 'questionnaire_preliminaire', 'Questionnaire préliminaire des dirigeants',
    'Recueillir la vision des dirigeants et la culture managériale (NOT-02).',
    'Liste des dirigeants', 'questionnaires.etat', NULL, 'R1', NULL, 'Réponses des dirigeants',
    'Tous les dirigeants ont répondu ou ont été relancés deux fois', 0.25, 'Consultant', 'N2', true);
  PERFORM pg_temp.brique(v, 'cadrage', 3, 'entretiens_individuels', 'Entretiens individuels',
    'Conduire des entretiens avec les dirigeants et les managers clés.',
    'Guide d''entretien ; liste des personnes', NULL, NULL, 'R1', NULL, 'Comptes rendus d''entretien',
    'Chaque entretien a un compte rendu relu', 2, 'Consultant senior', 'N1', true);
  PERFORM pg_temp.brique(v, 'cadrage', 4, 'atelier_unique', 'Atelier unique de 3 heures',
    'Remplacer les entretiens individuels par un atelier collectif unique (petite structure).',
    'Liste des participants', NULL, NULL, 'R1', NULL, 'Compte rendu d''atelier',
    'Compte rendu relu par le chef de mission', 0.5, 'Consultant senior', 'N1', false);

  PERFORM pg_temp.brique(v, 'collecte', 1, 'envoi_questionnaires', 'Envoi des questionnaires par population',
    'Envoyer une version validée du questionnaire aux dirigeants, managers et équipes.',
    'Version validée du questionnaire ; répondants désignés', 'questionnaires.etat', NULL, 'R1', NULL,
    'Envois et répondants', 'Au moins 3 répondants désignés par population', 0.25, 'Consultant', 'N1', true);
  PERFORM pg_temp.brique(v, 'collecte', 2, 'relances_repondants', 'Relances des répondants',
    'Relancer automatiquement les répondants à J+3 et J+7.',
    'Envois en cours', NULL, 'collecte', 'R0', NULL, 'Relances journalisées',
    'Relances envoyées ou date limite atteinte', 0, NULL, 'N3', true);
  PERFORM pg_temp.brique(v, 'collecte', 3, 'collecte_documents', 'Collecte des documents',
    'Rassembler les états financiers, l''organigramme et les procédures.',
    'Liste des pièces demandées', NULL, 'documentaire', 'R1', NULL, 'Documents classés',
    'Chaque pièce reçue ou signalée manquante', 0.5, 'Consultant', 'N2', true);
  PERFORM pg_temp.brique(v, 'collecte', 4, 'reconstitution_ca', 'Reconstitution du chiffre d''affaires',
    'Reconstituer le chiffre d''affaires par les encaissements bancaires et Mobile Money.',
    'Relevés bancaires et Mobile Money sur 12 mois', NULL, 'analyste', 'R2', NULL,
    'Chiffre d''affaires reconstitué et écart au déclaré', 'Écart au chiffre déclaré expliqué ou signalé',
    1.5, 'Consultant senior', 'N1', false);

  PERFORM pg_temp.brique(v, 'analyse', 1, 'notation_repondants', 'Notes par répondant et par population',
    'Calculer les notes de chaque répondant et de chaque population.',
    'Réponses soumises', 'questionnaires.notation_repondants', NULL, 'R1', NULL, 'Notes par population',
    'Toutes les réponses soumises sont notées', 0, NULL, 'N0', true);
  PERFORM pg_temp.brique(v, 'analyse', 2, 'ecarts_perception', 'Analyse des écarts de perception',
    'Comparer les réponses des dirigeants, des managers et des équipes sur chaque pratique.',
    'Réponses au questionnaire par population ; au moins 3 répondants par population',
    'notation.ecarts_perception', 'redacteur', 'R2',
    'Validation du consultant, relecture du chef de mission',
    'Section « Écarts de perception » du rapport de notation, graphique, assertions candidates au registre des preuves',
    'Chaque écart au-dessus du seuil commenté ; aucune hypothèse sans preuve ou mention « à vérifier en entretien »',
    0.5, 'Consultant senior', 'N2', true);
  PERFORM pg_temp.brique(v, 'analyse', 3, 'analyse_financiere', 'Analyse financière',
    'Lire les états financiers et les ratios clés de l''entreprise.',
    'États financiers des trois derniers exercices', NULL, 'analyste', 'R2', NULL,
    'Section financière du rapport', 'Chaque ratio cité vient d''un état financier identifié', 1,
    'Consultant senior', 'N2', true);
  PERFORM pg_temp.brique(v, 'analyse', 4, 'gouvernance_familiale', 'Gouvernance familiale et succession',
    'Évaluer la gouvernance familiale, la séparation des patrimoines et la préparation de la succession.',
    'Statuts ; pacte familial s''il existe', NULL, NULL, 'R2', NULL, 'Section « Gouvernance familiale »',
    'Succession et rôles familiaux documentés', 0.5, 'Consultant senior', 'N1', false);
  PERFORM pg_temp.brique(v, 'analyse', 5, 'forces_faiblesses', 'Forces et faiblesses',
    'Dégager les forces et les faiblesses par dimension à partir des notes calculées.',
    'Notes par dimension', 'notation.forces_faiblesses', 'redacteur', 'R1', NULL,
    'Liste des forces et faiblesses', 'Chaque constat renvoie à une dimension notée', 0.25, 'Consultant', 'N2', true);

  PERFORM pg_temp.brique(v, 'notation', 1, 'calcul_note', 'Calcul de la note',
    'Calculer le score global et la classe par le moteur de notation (jamais par l''IA).',
    'Grille validée ; réponses soumises', 'notation.score_global', NULL, 'R1', NULL,
    'Version de notation calculée', 'Calcul reproductible depuis la grille et les réponses', 0.25,
    'Consultant', 'N0', true);
  PERFORM pg_temp.brique(v, 'notation', 2, 'ajustements_motives', 'Ajustements motivés',
    'Ajuster une note de dimension avec un motif écrit, tracé dans l''historique.',
    'Version calculée', 'notation.ajustement', NULL, 'R2', NULL, 'Ajustements tracés',
    'Chaque ajustement est motivé', 0.25, 'Directeur de mission', 'N1', true);
  PERFORM pg_temp.brique(v, 'notation', 3, 'revue_publication', 'Revue et publication de la note',
    'Relire la notation et la publier.', 'Notation soumise', NULL, NULL, 'R3',
    'Publication par un expert métier qui n''est ni l''auteur du calcul, ni d''un ajustement, ni de la soumission (NOT-07)',
    'Notation publiée', 'Revue terminée et publication signée', 0.5, 'Expert métier', 'N0', true);

  PERFORM pg_temp.brique(v, 'restitution', 1, 'rapport_notation', 'Rapport de notation',
    'Rédiger le rapport de notation à partir des seuls chiffres calculés et des constats validés.',
    'Notation publiée ; constats validés', NULL, 'redacteur', 'R3', NULL,
    'Rapport de notation (PDF et Word)', 'Toute affirmation est sourcée ou signée comme avis d''expert',
    1.5, 'Chef de mission', 'N2', true);
  PERFORM pg_temp.brique(v, 'restitution', 2, 'restitution_dirigeants', 'Restitution aux dirigeants',
    'Présenter la note, les écarts et les priorités aux dirigeants.', 'Rapport de notation', NULL, NULL,
    'R2', NULL, 'Support de restitution', 'Restitution tenue et questions consignées', 0.5,
    'Directeur de mission', 'N1', true);
  PERFORM pg_temp.brique(v, 'restitution', 3, 'plan_action', 'Plan d''action priorisé',
    'Proposer un plan d''action priorisé depuis la bibliothèque d''initiatives (NOT-17).',
    'Faiblesses ; capacité du client', NULL, 'redacteur', 'R2', NULL, 'Plan d''action',
    'Chaque action renvoie à une faiblesse constatée', 0.5, 'Consultant senior', 'N2', true);

  PERFORM pg_temp.element(v, 'rapport_notation', 'livrable', 'rapport_de_notation', 'Rapport de notation',
    'Rapport PDF et Word, mention de la contribution IA.', false, true);
  PERFORM pg_temp.element(v, 'restitution_dirigeants', 'livrable', 'synthese_dirigeants',
    'Synthèse pour les dirigeants', NULL, false, true);
  PERFORM pg_temp.element(v, 'envoi_questionnaires', 'gabarit', 'questionnaire', 'Questionnaire de notation',
    'Complet par défaut ; « essentiel » pour une petite structure.', false, true);
  PERFORM pg_temp.element(v, 'forces_faiblesses', 'gabarit', 'lecture_indicateurs', 'Lecture des indicateurs',
    'Standard ou saisonnière.', false, true);
  PERFORM pg_temp.element(v, 'envoi_questionnaires', 'item', 'pilotage_strategique', 'Pilotage stratégique',
    NULL, true, true);
  PERFORM pg_temp.element(v, 'envoi_questionnaires', 'item', 'maitrise_couts', 'Maîtrise des coûts', NULL, true, true);
  PERFORM pg_temp.element(v, 'envoi_questionnaires', 'item', 'gestion_talents', 'Gestion des talents', NULL, false, true);
  PERFORM pg_temp.element(v, 'gouvernance_familiale', 'item', 'item_succession', 'Préparation de la succession',
    NULL, false, false);
  PERFORM pg_temp.element(v, 'envoi_questionnaires', 'item', 'gouvernance_publique', 'Gouvernance publique',
    'Items propres aux entreprises dont l''État est actionnaire.', false, false);
  PERFORM pg_temp.element(v, 'analyse_financiere', 'item', 'delais_creances_publiques',
    'Délais de paiement des créances publiques', NULL, false, false);
  PERFORM pg_temp.element(v, 'plan_action', 'kpi_type', 'kpi_pertes_post_recolte', 'Pertes post-récolte',
    'Part de la récolte perdue entre la récolte et la vente.', false, false);
  PERFORM pg_temp.element(v, 'analyse_financiere', 'risque_type', 'comptes_non_fiables',
    'Comptes non fiables', NULL, false, true);
  PERFORM pg_temp.element(v, 'relances_repondants', 'automatisation', 'relances_j3_j7', 'Relances à J+3 et J+7',
    NULL, false, true);

  INSERT INTO methode_rubriques (version_id, brique_id, code, libelle, dimension, ancrages)
  SELECT v, b.id, r.code, r.libelle, r.dimension, r.ancrages::jsonb
    FROM methode_briques b,
    (VALUES
      ('pilotage_performance', 'Pilotage de la performance', 'pilotage', '[
        {"niveau": 1, "description": "Aucun indicateur suivi ; les décisions se prennent au jour le jour.", "exemples": []},
        {"niveau": 2, "description": "Quelques chiffres suivis ponctuellement, sans cible ni revue.", "exemples": [{"contexte": "PME agro-industrielle", "texte": "Le volume collecté est connu en fin de campagne seulement."}]},
        {"niveau": 3, "description": "Tableau de bord mensuel avec cibles, revu en comité de direction.", "exemples": [{"contexte": "PME agro-industrielle", "texte": "Rendement usine et coût par tonne suivis chaque mois, lus par campagne."}]},
        {"niveau": 4, "description": "Indicateurs reliés aux objectifs, écarts analysés et actions correctives suivies.", "exemples": []},
        {"niveau": 5, "description": "Pilotage prospectif : prévisions, scénarios et revue de performance ritualisée.", "exemples": []}
      ]'),
      ('gouvernance', 'Gouvernance', 'gouvernance', '[
        {"niveau": 1, "description": "Décisions concentrées sur une personne, sans instance ni trace écrite.", "exemples": []},
        {"niveau": 2, "description": "Instances prévues par les statuts mais rarement réunies.", "exemples": [{"contexte": "Entreprise familiale", "texte": "Assemblée annuelle tenue pour la forme, sans débat."}]},
        {"niveau": 3, "description": "Conseil réuni régulièrement, procès-verbaux tenus.", "exemples": []},
        {"niveau": 4, "description": "Rôles séparés, comités spécialisés, administrateurs indépendants.", "exemples": []},
        {"niveau": 5, "description": "Gouvernance évaluée chaque année ; succession préparée et documentée.", "exemples": []}
      ]')
    ) AS r(code, libelle, dimension, ancrages)
   WHERE b.version_id = v AND b.code = 'ecarts_perception';

  PERFORM pg_temp.regle(v, '{"code": "petite_structure", "libelle": "Effectif inférieur à 20", "priorite": 10,
    "condition": {"type": "comparaison", "facteur": "effectif", "comparateur": "inferieur", "valeur": 20},
    "effets": [{"type": "activer_brique", "brique": "atelier_unique"},
               {"type": "retirer_brique", "brique": "entretiens_individuels"},
               {"type": "gabarit", "cible": "questionnaire", "choix": "essentiel"}]}');
  PERFORM pg_temp.regle(v, '{"code": "comptes_fragiles", "libelle": "Comptes non certifiés et part d''espèces forte", "priorite": 20,
    "condition": {"type": "tous", "conditions": [
      {"type": "comparaison", "facteur": "fiabilite_comptes", "comparateur": "egal", "valeur": "non_certifies"},
      {"type": "comparaison", "facteur": "part_informel", "comparateur": "egal", "valeur": "forte"}]},
    "effets": [{"type": "formulation", "cible": "analyse_financiere", "choix": "indicative"},
               {"type": "activer_brique", "brique": "reconstitution_ca"},
               {"type": "relever_classe_risque", "cible": "analyse_financiere", "classe": "R3"}]}');
  PERFORM pg_temp.regle(v, '{"code": "gouvernance_familiale", "libelle": "Actionnariat familial", "priorite": 10,
    "condition": {"type": "comparaison", "facteur": "actionnariat", "comparateur": "egal", "valeur": "familial"},
    "effets": [{"type": "activer_brique", "brique": "gouvernance_familiale"},
               {"type": "activer_item", "item": "item_succession"}]}');
  PERFORM pg_temp.regle(v, '{"code": "etat_actionnaire", "libelle": "État actionnaire", "priorite": 10,
    "condition": {"type": "comparaison", "facteur": "actionnariat", "comparateur": "egal", "valeur": "etat"},
    "effets": [{"type": "activer_item", "item": "gouvernance_publique"},
               {"type": "activer_item", "item": "delais_creances_publiques"}]}');
  PERFORM pg_temp.regle(v, '{"code": "filiere_agricole", "libelle": "Filière agricole", "priorite": 10,
    "condition": {"type": "au_moins_un", "conditions": [
      {"type": "comparaison", "facteur": "filieres", "comparateur": "dans",
       "valeur": ["cacao", "anacarde", "cafe", "coton", "hevea", "palmier_huile"]},
      {"type": "comparaison", "facteur": "agricole", "comparateur": "egal", "valeur": true}]},
    "effets": [{"type": "recommandation_candidate", "recommandation": "kpi_pertes_post_recolte"},
               {"type": "formulation", "cible": "lecture_indicateurs", "choix": "saisonniere"}]}');

  PERFORM pg_temp.cas(v, 'pme_familiale_cacao', 'PME familiale de la filière cacao, comptes fragiles', '{
    "contexte": {"effectif": 12, "fiabilite_comptes": "non_certifies", "part_informel": "forte",
                 "actionnariat": "familial", "filieres": ["cacao"], "agricole": true},
    "attendu": {
      "presents": [{"type": "activer_brique", "brique": "atelier_unique"},
                   {"type": "retirer_brique", "brique": "entretiens_individuels"},
                   {"type": "gabarit", "cible": "questionnaire", "choix": "essentiel"},
                   {"type": "formulation", "cible": "analyse_financiere", "choix": "indicative"},
                   {"type": "activer_brique", "brique": "reconstitution_ca"},
                   {"type": "relever_classe_risque", "cible": "analyse_financiere", "classe": "R3"},
                   {"type": "activer_brique", "brique": "gouvernance_familiale"},
                   {"type": "activer_item", "item": "item_succession"},
                   {"type": "recommandation_candidate", "recommandation": "kpi_pertes_post_recolte"}],
      "regles_declenchees": ["petite_structure", "comptes_fragiles", "gouvernance_familiale", "filiere_agricole"],
      "conflits_non_resolus": 0}}');
  PERFORM pg_temp.cas(v, 'grande_banque', 'Grande banque filiale de groupe, comptes certifiés', '{
    "contexte": {"effectif": 800, "fiabilite_comptes": "certifies", "part_informel": "faible",
                 "actionnariat": "filiale_groupe", "filieres": ["banque"], "agricole": false},
    "attendu": {
      "absents": [{"type": "activer_brique", "brique": "atelier_unique"},
                  {"type": "formulation", "cible": "analyse_financiere", "choix": "indicative"}],
      "regles_declenchees": [], "conflits_non_resolus": 0}}');
  PERFORM pg_temp.cas(v, 'societe_etat', 'Société à participation publique', '{
    "contexte": {"effectif": 450, "fiabilite_comptes": "certifies", "actionnariat": "etat"},
    "attendu": {
      "presents": [{"type": "activer_item", "item": "gouvernance_publique"},
                   {"type": "activer_item", "item": "delais_creances_publiques"}],
      "regles_declenchees": ["etat_actionnaire"]}}');

  PERFORM pg_temp.publier(v);

  -- =========================================================================
  -- Plan stratégique
  -- =========================================================================
  v := pg_temp.methode('plan_strategique', 'plan_strategique', 'Plan stratégique',
    'Du diagnostic au modèle financier : orientations, initiatives et feuille de route, modèle financier calculé par le moteur, KPI de pilotage, restitution.');

  PERFORM pg_temp.etape(v, 1, 'diagnostic', 'Diagnostic', 'Diagnostic stratégique, SWOT, analyse financière historique.');
  PERFORM pg_temp.etape(v, 2, 'orientations', 'Orientations', 'Vision, mission, axes et objectifs.');
  PERFORM pg_temp.etape(v, 3, 'initiatives', 'Initiatives et feuille de route', 'Portefeuille, dépendances, recalage.');
  PERFORM pg_temp.etape(v, 4, 'modele_financier', 'Modèle financier', 'Hypothèses, calcul, scénarios.');
  PERFORM pg_temp.etape(v, 5, 'pilotage', 'Pilotage et restitution', 'KPI d''objectif, restitution du plan.');

  PERFORM pg_temp.brique(v, 'diagnostic', 1, 'diagnostic_strategique', 'Diagnostic stratégique',
    'Établir le diagnostic, en s''appuyant sur une notation publiée quand elle existe.',
    'Notation publiée du client (facultative) ; entretiens', NULL, 'redacteur', 'R2', NULL,
    'Élément « diagnostic » du plan', 'Diagnostic validé par un responsable de la mission', 1,
    'Consultant senior', 'N2', true);
  PERFORM pg_temp.brique(v, 'diagnostic', 2, 'swot', 'Matrice SWOT',
    'Synthétiser forces, faiblesses, opportunités et menaces.', 'Diagnostic', NULL, 'redacteur',
    'R1', NULL, 'Élément « SWOT » du plan', 'Chaque point renvoie au diagnostic', 0.5, 'Consultant', 'N2', true);
  PERFORM pg_temp.brique(v, 'diagnostic', 3, 'analyse_historique', 'Analyse financière historique',
    'Analyser les trois derniers exercices.', 'États financiers', NULL, 'analyste', 'R2', NULL,
    'Base historique du modèle financier', 'Chaque chiffre vient d''un état financier identifié', 1,
    'Consultant senior', 'N2', true);
  PERFORM pg_temp.brique(v, 'diagnostic', 4, 'reconstitution_ca', 'Reconstitution du chiffre d''affaires',
    'Reconstituer le chiffre d''affaires par les encaissements bancaires et Mobile Money.',
    'Relevés bancaires et Mobile Money', NULL, 'analyste', 'R2', NULL, 'Chiffre d''affaires reconstitué',
    'Écart au chiffre déclaré expliqué ou signalé', 1.5, 'Consultant senior', 'N1', false);

  PERFORM pg_temp.brique(v, 'orientations', 1, 'vision_mission', 'Vision et mission',
    'Formuler la vision et la mission avec les dirigeants.', 'Diagnostic ; atelier dirigeants', NULL, NULL,
    'R2', NULL, 'Élément « vision et mission »', 'Validées par les dirigeants', 0.5, 'Directeur de mission', 'N1', true);
  PERFORM pg_temp.brique(v, 'orientations', 2, 'axes_objectifs', 'Axes et objectifs',
    'Décliner la vision en axes stratégiques et objectifs mesurables.', 'Vision et mission', NULL,
    'redacteur', 'R2', NULL, 'Axes et objectifs du plan', 'Chaque objectif a au moins un KPI', 1,
    'Consultant senior', 'N2', true);

  PERFORM pg_temp.brique(v, 'initiatives', 1, 'portefeuille_initiatives', 'Portefeuille d''initiatives',
    'Définir les initiatives : responsable, échéance, budget, statut.', 'Objectifs', NULL, NULL, 'R2', NULL,
    'Initiatives du plan', 'Chaque initiative a un porteur, une échéance et un budget', 1, 'Consultant senior',
    'N2', true);
  PERFORM pg_temp.brique(v, 'initiatives', 2, 'dependances_initiatives', 'Dépendances entre initiatives',
    'Déclarer les dépendances et refuser les cycles.', 'Initiatives', 'plan.dependances', NULL, 'R1', NULL,
    'Graphe des dépendances', 'Aucun cycle', 0.25, 'Consultant', 'N0', true);
  PERFORM pg_temp.brique(v, 'initiatives', 3, 'feuille_de_route', 'Feuille de route recalée',
    'Recaler les échéances selon les dépendances (PLA-05).', 'Initiatives et dépendances',
    'plan.feuille_de_route', NULL, 'R2', NULL, 'Feuille de route', 'Recalage relu par le chef de mission', 0.25,
    'Chef de mission', 'N0', true);

  PERFORM pg_temp.brique(v, 'modele_financier', 1, 'hypotheses', 'Hypothèses du modèle',
    'Poser les hypothèses de chiffre d''affaires, de charges, d''investissement et de financement.',
    'Analyse historique ; initiatives', NULL, NULL, 'R2', NULL, 'Hypothèses versionnées',
    'Chaque hypothèse est justifiée', 1, 'Consultant senior', 'N1', true);
  PERFORM pg_temp.brique(v, 'modele_financier', 2, 'calcul_modele', 'Calcul du modèle financier',
    'Calculer comptes prévisionnels, trésorerie et indicateurs par le moteur (jamais par l''IA).',
    'Hypothèses validées', 'plan.modele_financier', NULL, 'R3', NULL, 'Version du modèle financier',
    'Version validée par un responsable qui n''en est pas l''auteur', 0.25, 'Consultant senior', 'N0', true);
  PERFORM pg_temp.brique(v, 'modele_financier', 3, 'scenarios', 'Scénarios',
    'Comparer les scénarios prudent, central et ambitieux.', 'Version du modèle', 'plan.scenarios', NULL,
    'R2', NULL, 'Tableau des scénarios', 'Écarts entre scénarios commentés', 0.25, 'Consultant', 'N0', true);
  PERFORM pg_temp.brique(v, 'modele_financier', 4, 'bfr_saisonnier', 'BFR saisonnier',
    'Modéliser le besoin en fonds de roulement selon la campagne.', 'Calendrier de campagne', NULL, NULL,
    'R2', NULL, 'Hypothèses de BFR par mois', 'Pic de BFR identifié et financé', 0.5, 'Consultant senior',
    'N1', false);

  PERFORM pg_temp.brique(v, 'pilotage', 1, 'kpi_objectifs', 'KPI des objectifs',
    'Créer les KPI rattachés aux objectifs (PLA-10).', 'Objectifs', 'kpi.evaluation', NULL, 'R2', NULL,
    'KPI de pilotage', 'Chaque objectif a au moins un KPI avec cible', 0.5, 'Chef de mission', 'N1', true);
  PERFORM pg_temp.brique(v, 'pilotage', 2, 'restitution_plan', 'Restitution du plan',
    'Rédiger et présenter le plan stratégique.', 'Contenu validé du plan ; modèle validé', NULL,
    'redacteur', 'R3', NULL, 'Rapport de plan (PDF et Word)',
    'Tout le contenu reproduit est validé', 1, 'Directeur de mission', 'N2', true);

  PERFORM pg_temp.element(v, 'restitution_plan', 'livrable', 'document_plan', 'Plan stratégique', NULL, false, true);
  PERFORM pg_temp.element(v, 'calcul_modele', 'livrable', 'modele_financier', 'Modèle financier', NULL, false, true);
  PERFORM pg_temp.element(v, 'kpi_objectifs', 'gabarit', 'lecture_indicateurs', 'Lecture des indicateurs',
    'Standard ou saisonnière.', false, true);
  PERFORM pg_temp.element(v, 'analyse_historique', 'item', 'delais_creances_publiques',
    'Délais de paiement des créances publiques', 'Intégrés au BFR.', false, false);
  PERFORM pg_temp.element(v, 'kpi_objectifs', 'kpi_type', 'kpi_pertes_post_recolte', 'Pertes post-récolte',
    NULL, false, false);
  PERFORM pg_temp.element(v, 'portefeuille_initiatives', 'initiative_type', 'structuration_financiere',
    'Structuration de la fonction financière', NULL, false, true);
  PERFORM pg_temp.element(v, 'portefeuille_initiatives', 'initiative_type', 'digitalisation_ventes',
    'Digitalisation des ventes', NULL, false, true);
  PERFORM pg_temp.element(v, 'hypotheses', 'risque_type', 'risque_change', 'Risque de change', NULL, false, true);

  PERFORM pg_temp.regle(v, '{"code": "comptes_fragiles", "libelle": "Comptes non certifiés et part d''espèces forte", "priorite": 20,
    "condition": {"type": "tous", "conditions": [
      {"type": "comparaison", "facteur": "fiabilite_comptes", "comparateur": "egal", "valeur": "non_certifies"},
      {"type": "comparaison", "facteur": "part_informel", "comparateur": "egal", "valeur": "forte"}]},
    "effets": [{"type": "activer_brique", "brique": "reconstitution_ca"},
               {"type": "formulation", "cible": "modele_financier", "choix": "indicative"},
               {"type": "relever_classe_risque", "cible": "analyse_historique", "classe": "R3"}]}');
  PERFORM pg_temp.regle(v, '{"code": "etat_actionnaire", "libelle": "État actionnaire", "priorite": 10,
    "condition": {"type": "comparaison", "facteur": "actionnariat", "comparateur": "egal", "valeur": "etat"},
    "effets": [{"type": "activer_item", "item": "delais_creances_publiques"}]}');
  PERFORM pg_temp.regle(v, '{"code": "filiere_agricole", "libelle": "Filière agricole", "priorite": 10,
    "condition": {"type": "au_moins_un", "conditions": [
      {"type": "comparaison", "facteur": "filieres", "comparateur": "dans",
       "valeur": ["cacao", "anacarde", "cafe", "coton", "hevea", "palmier_huile"]},
      {"type": "comparaison", "facteur": "agricole", "comparateur": "egal", "valeur": true}]},
    "effets": [{"type": "activer_brique", "brique": "bfr_saisonnier"},
               {"type": "recommandation_candidate", "recommandation": "kpi_pertes_post_recolte"},
               {"type": "formulation", "cible": "lecture_indicateurs", "choix": "saisonniere"}]}');

  PERFORM pg_temp.cas(v, 'cooperative_anacarde', 'Coopérative d''anacarde aux comptes fragiles', '{
    "contexte": {"effectif": 35, "fiabilite_comptes": "non_certifies", "part_informel": "forte",
                 "actionnariat": "cooperative", "filieres": ["anacarde"], "agricole": true},
    "attendu": {
      "presents": [{"type": "activer_brique", "brique": "reconstitution_ca"},
                   {"type": "activer_brique", "brique": "bfr_saisonnier"},
                   {"type": "formulation", "cible": "modele_financier", "choix": "indicative"},
                   {"type": "recommandation_candidate", "recommandation": "kpi_pertes_post_recolte"}],
      "regles_declenchees": ["comptes_fragiles", "filiere_agricole"], "conflits_non_resolus": 0}}');
  PERFORM pg_temp.cas(v, 'societe_etat', 'Société à participation publique', '{
    "contexte": {"effectif": 450, "fiabilite_comptes": "certifies", "actionnariat": "etat", "agricole": false},
    "attendu": {
      "presents": [{"type": "activer_item", "item": "delais_creances_publiques"}],
      "absents": [{"type": "activer_brique", "brique": "bfr_saisonnier"}],
      "regles_declenchees": ["etat_actionnaire"]}}');

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
