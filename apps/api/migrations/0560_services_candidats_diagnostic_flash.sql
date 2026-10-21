-- Service candidat « Diagnostic flash » (PRD complémentaire §4 et §11.6) :
-- ajout d'un service au référentiel SANS développement spécifique, par simple
-- assemblage de briques existantes (questionnaire court, documentaire, analyse,
-- rapport court). 5 jours, prix fixe, porte d'entrée commerciale.
--
-- Méthode du STANDARD (cabinet_id NULL), version 1 publiée (immuable ensuite,
-- MPM01). CONTENU PROVISOIRE : briques, temps types, classes de risque,
-- rubriques et règles sont des propositions de départ à valider par un expert
-- métier avant tout usage client. Aucun nouveau facteur de contexte (0204) ni
-- nouveau moteur : seuls des codes de `MOTEURS_STANDARD` et d'agents du
-- registre 0260 sont référencés. Le rapport court est rendu par le moteur de
-- rapports existant (modèle état d'avancement).

INSERT INTO services_conseil (code, libelle, description, ordre) VALUES
  ('diagnostic_flash', 'Diagnostic flash',
   'Service candidat : diagnostic de 5 jours à prix fixe, porte d''entrée commerciale (contenu provisoire, à valider par un expert métier).', 6);

INSERT INTO notes_contexte (cible_type, cible_code, contexte, texte) VALUES
  ('methode', 'diagnostic_flash', 'Contenu provisoire',
   'À valider par un expert métier : briques, temps types, classes de risque, rubriques et règles sont des propositions de départ.');

CREATE FUNCTION pg_temp.methode(p_service text, p_code text, p_libelle text, p_description text, p_notes text)
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
      VALUES (v_methode, 1, p_notes)
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
  v := pg_temp.methode('diagnostic_flash', 'diagnostic_flash', 'Diagnostic flash',
    'PROVISOIRE — contenu à valider par un expert métier avant tout usage client. Diagnostic de 5 jours à prix fixe : cadrage, collecte (questionnaire court, entretien, documents), analyse, rapport court et restitution, avec proposition de suite.',
    'PROVISOIRE — contenu à valider par un expert métier avant tout usage client. Version initiale du service candidat « Diagnostic flash ».');

  PERFORM pg_temp.etape(v, 1, 'cadrage', 'Cadrage (J1)', 'Périmètre, interlocuteurs, pièces demandées.');
  PERFORM pg_temp.etape(v, 2, 'collecte', 'Collecte (J1 à J3)', 'Questionnaire court, entretien du dirigeant, documents.');
  PERFORM pg_temp.etape(v, 3, 'analyse', 'Analyse (J3 à J4)', 'Lecture rapide des constats et des chiffres fournis.');
  PERFORM pg_temp.etape(v, 4, 'restitution', 'Restitution (J5)', 'Rapport court, restitution au dirigeant, proposition de suite.');

  PERFORM pg_temp.brique(v, 'cadrage', 1, 'cadrage_express', 'Cadrage express',
    'Fixer avec le dirigeant le périmètre, les interlocuteurs et la liste des pièces à fournir en une séance. Temps type à valider par un expert.',
    'Proposition signée ; coordonnées du dirigeant', NULL, NULL, 'R2', NULL,
    'Note de cadrage d''une page validée par le dirigeant',
    'Périmètre, interlocuteurs et pièces demandées validés (à valider par un expert)', 0.5, 'Chef de mission', 'N1', true);

  PERFORM pg_temp.brique(v, 'collecte', 1, 'questionnaire_court', 'Questionnaire court',
    'Faire remplir au dirigeant un questionnaire court de 8 items couvrant les grandes fonctions de l''entreprise.',
    'Questionnaire court ; dirigeant désigné', 'questionnaires.etat', NULL, 'R1', NULL,
    'Réponses du dirigeant', 'Tous les items essentiels renseignés (à valider par un expert)', 0.25,
    'Consultant', 'N2', true);
  PERFORM pg_temp.brique(v, 'collecte', 2, 'entretien_dirigeant', 'Entretien du dirigeant',
    'Conduire un entretien dirigé de deux heures pour compléter et nuancer les réponses.',
    'Réponses au questionnaire court', NULL, NULL, 'R1', NULL, 'Compte rendu d''entretien',
    'Compte rendu relu par le chef de mission (à valider par un expert)', 0.75, 'Consultant senior', 'N1', true);
  PERFORM pg_temp.brique(v, 'collecte', 3, 'revue_documentaire', 'Revue documentaire',
    'Rassembler et classer les pièces clés : états financiers, organigramme, principaux contrats.',
    'Liste des pièces demandées', NULL, 'documentaire', 'R1',
    'Contrôle humain du classement avant analyse', 'Documents classés, pièces manquantes signalées',
    'Chaque pièce reçue ou signalée manquante (à valider par un expert)', 0.5, 'Consultant', 'N2', true);
  PERFORM pg_temp.brique(v, 'collecte', 4, 'reconstitution_ca', 'Reconstitution du chiffre d''affaires',
    'Reconstituer le chiffre d''affaires par les encaissements bancaires et Mobile Money quand les comptes sont fragiles.',
    'Relevés bancaires et Mobile Money sur 12 mois', NULL, 'analyste', 'R2',
    'Revue du consultant senior ; chiffres issus d''un moteur de calcul, jamais du modèle de langage',
    'Chiffre d''affaires reconstitué et écart au déclaré',
    'Écart au chiffre déclaré expliqué ou signalé (à valider par un expert)',
    1.5, 'Consultant senior', 'N1', false);

  PERFORM pg_temp.brique(v, 'analyse', 1, 'analyse_flash', 'Analyse flash',
    'Dégager en une journée un petit nombre de constats priorisés à partir des réponses, de l''entretien et des documents.',
    'Réponses du questionnaire ; compte rendu d''entretien ; documents classés', NULL, 'analyste', 'R2',
    'Validation du consultant senior ; l''IA propose, l''expert dispose',
    'Constats priorisés avec renvoi à leur source',
    'Chaque constat cite sa source ou porte la mention « à vérifier » (à valider par un expert)',
    1.25, 'Consultant senior', 'N2', true);
  PERFORM pg_temp.brique(v, 'analyse', 2, 'predia_redressement', 'Pré-diagnostic de redressement',
    'Repérer les signaux d''urgence de trésorerie et de créanciers (RED-01) quand l''entreprise est en tension ou en difficulté.',
    'Constats de l''analyse flash ; situation de trésorerie', NULL, 'analyste', 'R2',
    'Revue du directeur de mission', 'Note de pré-diagnostic de redressement',
    'Signaux d''urgence listés et suite proposée (à valider par un expert)', 1, 'Consultant senior', 'N1', false);

  PERFORM pg_temp.brique(v, 'restitution', 1, 'rapport_court', 'Rapport court',
    'Rédiger un rapport court de quelques pages à partir des seuls constats validés et des chiffres calculés.',
    'Constats validés', NULL, 'redacteur', 'R3',
    'Validation d''un expert avant toute remise au client ; le rapport porte la mention de la contribution IA',
    'Rapport court (PDF et Word)',
    'Toute affirmation est sourcée ou signée comme avis d''expert (à valider par un expert)', 1,
    'Chef de mission', 'N2', true);
  PERFORM pg_temp.brique(v, 'restitution', 2, 'restitution_flash', 'Restitution flash',
    'Présenter les constats et les priorités au dirigeant en une séance.', 'Rapport court', NULL, NULL, 'R2',
    NULL, 'Synthèse de restitution', 'Restitution tenue et questions consignées (à valider par un expert)',
    0.5, 'Directeur de mission', 'N1', true);
  PERFORM pg_temp.brique(v, 'restitution', 3, 'proposition_suite', 'Proposition de suite',
    'Proposer la suite commerciale : notation, plan stratégique ou redressement, selon les constats.',
    'Constats ; synthèse de restitution', NULL, NULL, 'R2',
    'Validation du directeur de mission avant envoi', 'Proposition de suite',
    'Suite recommandée et justifiée par les constats (à valider par un expert)', 0.25,
    'Directeur de mission', 'N1', true);

  PERFORM pg_temp.element(v, 'rapport_court', 'livrable', 'rapport_court_livrable', 'Rapport court',
    'Rendu par le moteur de rapports existant (modèle état d''avancement) ; aucun nouveau modèle de rapport.',
    false, true);
  PERFORM pg_temp.element(v, 'restitution_flash', 'livrable', 'synthese_restitution', 'Synthèse de restitution',
    NULL, false, true);
  PERFORM pg_temp.element(v, 'questionnaire_court', 'gabarit', 'questionnaire', 'Questionnaire court',
    'Complet par défaut ; « essentiel » pour une très petite structure.', false, true);
  PERFORM pg_temp.element(v, 'analyse_flash', 'gabarit', 'lecture_indicateurs', 'Lecture des indicateurs',
    'Standard ou saisonnière.', false, true);
  PERFORM pg_temp.element(v, 'questionnaire_court', 'item', 'gouvernance_dirigeant', 'Gouvernance du dirigeant',
    NULL, true, true);
  PERFORM pg_temp.element(v, 'questionnaire_court', 'item', 'pilotage_commercial', 'Pilotage commercial',
    NULL, true, true);
  PERFORM pg_temp.element(v, 'questionnaire_court', 'item', 'gestion_financiere', 'Gestion financière',
    NULL, true, true);
  PERFORM pg_temp.element(v, 'questionnaire_court', 'item', 'tresorerie', 'Trésorerie', NULL, true, true);
  PERFORM pg_temp.element(v, 'questionnaire_court', 'item', 'organisation', 'Organisation', NULL, true, true);
  PERFORM pg_temp.element(v, 'questionnaire_court', 'item', 'ressources_humaines', 'Ressources humaines',
    NULL, false, true);
  PERFORM pg_temp.element(v, 'questionnaire_court', 'item', 'systemes_information', 'Systèmes d''information',
    NULL, false, true);
  PERFORM pg_temp.element(v, 'questionnaire_court', 'item', 'risques', 'Risques', NULL, false, true);
  PERFORM pg_temp.element(v, 'analyse_flash', 'kpi_type', 'kpi_pertes_post_recolte', 'Pertes post-récolte',
    'Part de la récolte perdue entre la récolte et la vente.', false, false);
  PERFORM pg_temp.element(v, 'analyse_flash', 'risque_type', 'comptes_non_fiables', 'Comptes non fiables',
    NULL, false, true);

  INSERT INTO methode_rubriques (version_id, brique_id, code, libelle, dimension, ancrages)
  SELECT v, b.id, r.code, r.libelle, r.dimension, r.ancrages::jsonb
    FROM methode_briques b,
    (VALUES
      ('maitrise_gestion', 'Maîtrise de la gestion', 'pilotage', '[
        {"niveau": 1, "description": "Aucun chiffre de gestion suivi ; les décisions se prennent au jour le jour.", "exemples": []},
        {"niveau": 2, "description": "Quelques chiffres connus ponctuellement, sans cible ni revue.", "exemples": [{"contexte": "TPE commerciale", "texte": "Le chiffre d''affaires du mois n''est connu qu''en fin de trimestre."}]},
        {"niveau": 3, "description": "Suivi mensuel des ventes et de la trésorerie, revu par le dirigeant.", "exemples": [{"contexte": "PME de services", "texte": "Tableau mensuel des encaissements et des charges, lu chaque mois."}]},
        {"niveau": 4, "description": "Indicateurs reliés à des objectifs, écarts analysés et actions suivies.", "exemples": []},
        {"niveau": 5, "description": "Pilotage prospectif : prévisions de trésorerie et revue de performance ritualisée.", "exemples": []}
      ]')
    ) AS r(code, libelle, dimension, ancrages)
   WHERE b.version_id = v AND b.code = 'analyse_flash';

  PERFORM pg_temp.regle(v, '{"code": "tres_petite_structure", "libelle": "Effectif inférieur à 10", "priorite": 10,
    "condition": {"type": "comparaison", "facteur": "effectif", "comparateur": "inferieur", "valeur": 10},
    "effets": [{"type": "gabarit", "cible": "questionnaire", "choix": "essentiel"}]}');
  PERFORM pg_temp.regle(v, '{"code": "comptes_fragiles", "libelle": "Comptes non certifiés et part d''espèces forte", "priorite": 20,
    "condition": {"type": "tous", "conditions": [
      {"type": "comparaison", "facteur": "fiabilite_comptes", "comparateur": "egal", "valeur": "non_certifies"},
      {"type": "comparaison", "facteur": "part_informel", "comparateur": "egal", "valeur": "forte"}]},
    "effets": [{"type": "activer_brique", "brique": "reconstitution_ca"},
               {"type": "formulation", "cible": "analyse_flash", "choix": "indicative"},
               {"type": "relever_classe_risque", "cible": "analyse_flash", "classe": "R3"}]}');
  PERFORM pg_temp.regle(v, '{"code": "situation_tendue", "libelle": "Entreprise en tension ou en difficulté", "priorite": 10,
    "condition": {"type": "comparaison", "facteur": "situation", "comparateur": "dans", "valeur": ["tension", "difficulte"]},
    "effets": [{"type": "activer_brique", "brique": "predia_redressement"}]}');
  PERFORM pg_temp.regle(v, '{"code": "filiere_agricole", "libelle": "Filière agricole", "priorite": 10,
    "condition": {"type": "au_moins_un", "conditions": [
      {"type": "comparaison", "facteur": "filieres", "comparateur": "dans",
       "valeur": ["cacao", "anacarde", "cafe", "coton", "hevea", "palmier_huile"]},
      {"type": "comparaison", "facteur": "agricole", "comparateur": "egal", "valeur": true}]},
    "effets": [{"type": "recommandation_candidate", "recommandation": "kpi_pertes_post_recolte"},
               {"type": "formulation", "cible": "lecture_indicateurs", "choix": "saisonniere"}]}');

  PERFORM pg_temp.cas(v, 'tpe_agricole_comptes_fragiles', 'TPE agricole aux comptes fragiles', '{
    "contexte": {"effectif": 8, "fiabilite_comptes": "non_certifies", "part_informel": "forte",
                 "filieres": ["cacao"], "agricole": true},
    "attendu": {
      "presents": [{"type": "gabarit", "cible": "questionnaire", "choix": "essentiel"},
                   {"type": "activer_brique", "brique": "reconstitution_ca"},
                   {"type": "formulation", "cible": "analyse_flash", "choix": "indicative"},
                   {"type": "relever_classe_risque", "cible": "analyse_flash", "classe": "R3"},
                   {"type": "recommandation_candidate", "recommandation": "kpi_pertes_post_recolte"},
                   {"type": "formulation", "cible": "lecture_indicateurs", "choix": "saisonniere"}],
      "absents": [{"type": "activer_brique", "brique": "predia_redressement"}],
      "regles_declenchees": ["tres_petite_structure", "comptes_fragiles", "filiere_agricole"],
      "conflits_non_resolus": 0}}');
  PERFORM pg_temp.cas(v, 'pme_en_difficulte', 'PME en difficulté, comptes certifiés', '{
    "contexte": {"effectif": 60, "fiabilite_comptes": "certifies", "part_informel": "faible",
                 "situation": "difficulte", "agricole": false},
    "attendu": {
      "presents": [{"type": "activer_brique", "brique": "predia_redressement"}],
      "absents": [{"type": "activer_brique", "brique": "reconstitution_ca"},
                  {"type": "gabarit", "cible": "questionnaire", "choix": "essentiel"}],
      "regles_declenchees": ["situation_tendue"], "conflits_non_resolus": 0}}');
  PERFORM pg_temp.cas(v, 'entreprise_saine', 'Entreprise saine et stable, comptes certifiés', '{
    "contexte": {"effectif": 120, "fiabilite_comptes": "certifies", "part_informel": "faible",
                 "situation": "stabilite", "agricole": false},
    "attendu": {
      "absents": [{"type": "activer_brique", "brique": "reconstitution_ca"},
                  {"type": "activer_brique", "brique": "predia_redressement"},
                  {"type": "formulation", "cible": "analyse_flash", "choix": "indicative"}],
      "regles_declenchees": [], "conflits_non_resolus": 0}}');

  PERFORM pg_temp.publier(v);
END $$;

DROP FUNCTION pg_temp.methode(text, text, text, text, text);
DROP FUNCTION pg_temp.etape(uuid, integer, text, text, text);
DROP FUNCTION pg_temp.brique(uuid, text, integer, text, text, text, text, text, text, text, text, text,
  text, numeric, text, text, boolean);
DROP FUNCTION pg_temp.element(uuid, text, text, text, text, text, boolean, boolean);
DROP FUNCTION pg_temp.regle(uuid, jsonb);
DROP FUNCTION pg_temp.cas(uuid, text, text, jsonb);
DROP FUNCTION pg_temp.publier(uuid);
