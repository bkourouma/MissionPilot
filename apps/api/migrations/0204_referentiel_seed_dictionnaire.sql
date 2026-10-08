-- Référentiel de méthodes (lot STD) — amorçage du STANDARD MissionPilot :
-- taxonomies (STD-10), facteurs de contexte typés (STD-04, PRD §4.3),
-- services (STD-01). Lignes du standard : `cabinet_id` NULL, propriété
-- d'ACC, lisibles par tous les cabinets, jamais modifiables par eux.
-- Libellés et listes proposés par défaut, à valider par le comité méthode.

-- Secteurs : sections de la CITI rév. 4 (Nations unies).
INSERT INTO taxonomie_entrees (taxonomie, code, libelle, ordre) VALUES
  ('secteur', 'citi_a', 'Agriculture, sylviculture et pêche', 1),
  ('secteur', 'citi_b', 'Activités extractives', 2),
  ('secteur', 'citi_c', 'Activités de fabrication', 3),
  ('secteur', 'citi_d', 'Production et distribution d''électricité, de gaz, de vapeur et climatisation', 4),
  ('secteur', 'citi_e', 'Distribution d''eau ; assainissement, gestion des déchets et remise en état', 5),
  ('secteur', 'citi_f', 'Construction', 6),
  ('secteur', 'citi_g', 'Commerce de gros et de détail ; réparation de véhicules automobiles et de motocycles', 7),
  ('secteur', 'citi_h', 'Transport et entreposage', 8),
  ('secteur', 'citi_i', 'Hébergement et restauration', 9),
  ('secteur', 'citi_j', 'Information et communication', 10),
  ('secteur', 'citi_k', 'Activités financières et d''assurance', 11),
  ('secteur', 'citi_l', 'Activités immobilières', 12),
  ('secteur', 'citi_m', 'Activités professionnelles, scientifiques et techniques', 13),
  ('secteur', 'citi_n', 'Activités de services administratifs et d''appui', 14),
  ('secteur', 'citi_o', 'Administration publique et défense ; sécurité sociale obligatoire', 15),
  ('secteur', 'citi_p', 'Enseignement', 16),
  ('secteur', 'citi_q', 'Santé humaine et action sociale', 17),
  ('secteur', 'citi_r', 'Arts, spectacles et loisirs', 18),
  ('secteur', 'citi_s', 'Autres activités de services', 19),
  ('secteur', 'citi_t', 'Activités des ménages en tant qu''employeurs ; production pour usage propre', 20),
  ('secteur', 'citi_u', 'Activités des organisations et organismes extraterritoriaux', 21);

INSERT INTO taxonomie_entrees (taxonomie, code, libelle, parent_code, ordre) VALUES
  ('filiere', 'cacao', 'Cacao', 'citi_a', 1),
  ('filiere', 'anacarde', 'Anacarde', 'citi_a', 2),
  ('filiere', 'cafe', 'Café', 'citi_a', 3),
  ('filiere', 'coton', 'Coton', 'citi_a', 4),
  ('filiere', 'hevea', 'Hévéa', 'citi_a', 5),
  ('filiere', 'palmier_huile', 'Palmier à huile', 'citi_a', 6),
  ('filiere', 'agroalimentaire', 'Agroalimentaire', 'citi_c', 7),
  ('filiere', 'mines', 'Mines', 'citi_b', 8),
  ('filiere', 'btp', 'Bâtiment et travaux publics', 'citi_f', 9),
  ('filiere', 'commerce', 'Commerce et distribution', 'citi_g', 10),
  ('filiere', 'transport', 'Transport et logistique', 'citi_h', 11),
  ('filiere', 'telecoms', 'Télécommunications', 'citi_j', 12),
  ('filiere', 'banque', 'Banque', 'citi_k', 13),
  ('filiere', 'assurance', 'Assurance', 'citi_k', 14),
  ('filiere', 'microfinance', 'Microfinance', 'citi_k', 15),
  ('filiere', 'sante', 'Santé', 'citi_q', 16),
  ('filiere', 'education', 'Éducation et formation', 'citi_p', 17);

INSERT INTO taxonomie_entrees (taxonomie, code, libelle, ordre) VALUES
  ('zone', 'uemoa', 'Union économique et monétaire ouest-africaine (UEMOA)', 1),
  ('zone', 'cemac', 'Communauté économique et monétaire de l''Afrique centrale (CEMAC)', 2),
  ('zone', 'hors_zone_franc', 'Hors zone franc', 3);

INSERT INTO taxonomie_entrees (taxonomie, code, libelle, parent_code, ordre) VALUES
  ('pays', 'bj', 'Bénin', 'uemoa', 1),
  ('pays', 'bf', 'Burkina Faso', 'uemoa', 2),
  ('pays', 'ci', 'Côte d''Ivoire', 'uemoa', 3),
  ('pays', 'gw', 'Guinée-Bissau', 'uemoa', 4),
  ('pays', 'ml', 'Mali', 'uemoa', 5),
  ('pays', 'ne', 'Niger', 'uemoa', 6),
  ('pays', 'sn', 'Sénégal', 'uemoa', 7),
  ('pays', 'tg', 'Togo', 'uemoa', 8),
  ('pays', 'cm', 'Cameroun', 'cemac', 9),
  ('pays', 'cf', 'République centrafricaine', 'cemac', 10),
  ('pays', 'cg', 'République du Congo', 'cemac', 11),
  ('pays', 'ga', 'Gabon', 'cemac', 12),
  ('pays', 'gq', 'Guinée équatoriale', 'cemac', 13),
  ('pays', 'td', 'Tchad', 'cemac', 14),
  ('pays', 'gn', 'Guinée', 'hors_zone_franc', 15),
  ('pays', 'cd', 'République démocratique du Congo', 'hors_zone_franc', 16),
  ('pays', 'mr', 'Mauritanie', 'hors_zone_franc', 17),
  ('pays', 'gh', 'Ghana', 'hors_zone_franc', 18),
  ('pays', 'ng', 'Nigeria', 'hors_zone_franc', 19),
  ('pays', 'ma', 'Maroc', 'hors_zone_franc', 20),
  ('pays', 'fr', 'France', 'hors_zone_franc', 21);

INSERT INTO taxonomie_entrees (taxonomie, code, libelle, description, ordre) VALUES
  ('taille', 'micro', 'Micro-entreprise', 'Repère indicatif : moins de 10 personnes ; définition nationale à appliquer.', 1),
  ('taille', 'petite', 'Petite entreprise', 'Repère indicatif : 10 à 49 personnes.', 2),
  ('taille', 'moyenne', 'Moyenne entreprise', 'Repère indicatif : 50 à 249 personnes.', 3),
  ('taille', 'grande', 'Grande entreprise', 'Repère indicatif : 250 personnes et plus.', 4);

INSERT INTO taxonomie_entrees (taxonomie, code, libelle, ordre) VALUES
  ('fonction', 'direction_generale', 'Direction générale', 1),
  ('fonction', 'finance', 'Finance et comptabilité', 2),
  ('fonction', 'ressources_humaines', 'Ressources humaines', 3),
  ('fonction', 'commercial', 'Commercial et marketing', 4),
  ('fonction', 'production', 'Production et opérations', 5),
  ('fonction', 'achats', 'Achats et approvisionnements', 6),
  ('fonction', 'systemes_information', 'Systèmes d''information', 7),
  ('fonction', 'juridique', 'Juridique et conformité', 8),
  ('fonction', 'controle_interne', 'Contrôle interne et audit', 9),
  ('processus', 'pilotage', 'Pilotage et gouvernance', 1),
  ('processus', 'realisation', 'Réalisation (production, vente)', 2),
  ('processus', 'support', 'Support (finance, RH, SI, achats)', 3),
  ('processus', 'mesure_amelioration', 'Mesure et amélioration', 4),
  ('kpi', 'financier', 'Indicateurs financiers', 1),
  ('kpi', 'commercial', 'Indicateurs commerciaux', 2),
  ('kpi', 'operationnel', 'Indicateurs opérationnels', 3),
  ('kpi', 'humain', 'Indicateurs humains', 4),
  ('kpi', 'gouvernance', 'Indicateurs de gouvernance', 5),
  ('risque', 'strategique', 'Risques stratégiques', 1),
  ('risque', 'financier', 'Risques financiers', 2),
  ('risque', 'operationnel', 'Risques opérationnels', 3),
  ('risque', 'conformite', 'Risques de conformité', 4),
  ('risque', 'change', 'Risque de change', 5);

-- Facteurs de contexte du standard (PRD §4.3).
CREATE FUNCTION pg_temp.valeurs(p_taxonomie text) RETURNS jsonb
  LANGUAGE sql STABLE
  AS $$ SELECT jsonb_agg(jsonb_build_object('code', code, 'libelle', libelle) ORDER BY ordre, code)
          FROM taxonomie_entrees WHERE cabinet_id IS NULL AND taxonomie = p_taxonomie $$;

CREATE FUNCTION pg_temp.liste(VARIADIC p text[]) RETURNS jsonb
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT jsonb_agg(jsonb_build_object('code', split_part(x, '=', 1), 'libelle', split_part(x, '=', 2))
                         ORDER BY n)
          FROM unnest(p) WITH ORDINALITY AS u(x, n) $$;

INSERT INTO facteurs_contexte (code, libelle, description, type, valeurs, min, max, porte_par, ordre) VALUES
  ('secteur', 'Secteur (CITI rév. 4)', 'Section de la CITI rév. 4.', 'enumeration',
    pg_temp.valeurs('secteur'), NULL, NULL, 'dossier', 1),
  ('filieres', 'Filières', 'Filières d''activité de l''entreprise.', 'liste',
    pg_temp.valeurs('filiere'), NULL, NULL, 'dossier', 2),
  ('agricole', 'Activité agricole', 'Vrai si l''activité dépend d''une campagne agricole.', 'booleen',
    NULL, NULL, NULL, 'dossier', 3),
  ('pays', 'Pays', 'Pays du siège.', 'enumeration', pg_temp.valeurs('pays'), NULL, NULL, 'dossier', 4),
  ('zone', 'Zone économique', 'Fiscalité, droit OHADA, devise et risque de change.', 'enumeration',
    pg_temp.valeurs('zone'), NULL, NULL, 'dossier', 5),
  ('effectif', 'Effectif', 'Nombre de personnes employées.', 'nombre', NULL, 0, 1000000, 'dossier', 6),
  ('chiffre_affaires', 'Chiffre d''affaires (millions de FCFA)', 'Dernier exercice connu.', 'nombre',
    NULL, 0, 100000000, 'dossier', 7),
  ('taille', 'Taille', 'Selon la définition nationale de la PME.', 'enumeration',
    pg_temp.valeurs('taille'), NULL, NULL, 'dossier', 8),
  ('actionnariat', 'Propriété et gouvernance', NULL, 'enumeration',
    pg_temp.liste('familial=Familiale', 'etat=État actionnaire', 'filiale_groupe=Filiale de groupe',
                  'cooperative=Coopérative', 'startup_financee=Start-up financée', 'autre=Autre'),
    NULL, NULL, 'dossier', 9),
  ('fiabilite_comptes', 'Fiabilité de l''information financière', NULL, 'enumeration',
    pg_temp.liste('certifies=Comptes certifiés', 'non_certifies=Comptes non certifiés',
                  'reconstitues=Comptes reconstitués'), NULL, NULL, 'dossier', 10),
  ('part_informel', 'Part de l''informel et des espèces', NULL, 'enumeration',
    pg_temp.liste('faible=Faible', 'moyenne=Moyenne', 'forte=Forte'), NULL, NULL, 'dossier', 11),
  ('commerce_exterieur', 'Exposition au commerce extérieur', NULL, 'liste',
    pg_temp.liste('importations_intrants=Importations d''intrants', 'export=Exportations',
                  'change=Exposition au change'), NULL, NULL, 'dossier', 12),
  ('saisonnalite', 'Saisonnalité', NULL, 'enumeration',
    pg_temp.liste('aucune=Aucune', 'campagne_agricole=Campagne agricole', 'saison_pluies=Saison des pluies',
                  'fetes=Fêtes'), NULL, NULL, 'dossier', 13),
  ('langues', 'Langues des répondants', NULL, 'liste',
    pg_temp.liste('francais=Français', 'anglais=Anglais', 'dioula=Dioula', 'wolof=Wolof',
                  'bambara=Bambara', 'lingala=Lingala', 'autre=Autre'), NULL, NULL, 'mission', 14),
  ('culture_manageriale', 'Culture managériale', 'Issue du questionnaire préliminaire des dirigeants (NOT-02).',
    'enumeration', pg_temp.liste('directive=Directive', 'participative=Participative', 'mixte=Mixte'),
    NULL, NULL, 'mission', 15),
  ('situation', 'Situation de l''entreprise', NULL, 'enumeration',
    pg_temp.liste('croissance=Croissance', 'stabilite=Stabilité', 'tension=Tension', 'difficulte=Difficulté'),
    NULL, NULL, 'dossier', 16),
  ('financeur', 'Financeur impliqué', NULL, 'enumeration',
    pg_temp.liste('aucun=Aucun', 'banque=Banque', 'bailleur=Bailleur de fonds', 'fonds=Fonds d''investissement'),
    NULL, NULL, 'mission', 17);

INSERT INTO services_conseil (code, libelle, description, ordre) VALUES
  ('notation', 'Notation d''entreprise', 'Service #1 : note de maturité fiable, explicable et comparable.', 1),
  ('due_diligence', 'Due diligence', 'Service #2 : démarche par hypothèses, verdicts sourcés.', 2),
  ('plan_strategique', 'Planification stratégique et modèle financier', 'Service #3 : du diagnostic au modèle financier.', 3),
  ('pilotage_kpi', 'Pilotage des KPI', 'Service #4 : tableau de bord et revues de performance.', 4),
  ('redressement', 'Redressement', 'Service #5 : pré-diagnostic et plan de redressement.', 5);

INSERT INTO notes_contexte (cible_type, cible_code, contexte, texte) VALUES
  ('facteur', 'part_informel', 'Afrique de l''Ouest',
   'Une part d''espèces forte rend fragiles les analyses fondées sur la seule comptabilité : rapprocher des flux bancaires et Mobile Money.'),
  ('facteur', 'saisonnalite', 'Filières agricoles',
   'Lire les indicateurs par campagne plutôt que par trimestre civil ; le BFR culmine pendant la campagne d''achat.'),
  ('facteur', 'actionnariat', 'État actionnaire',
   'Les délais de paiement des créances publiques allongent le BFR : les intégrer au modèle financier.');

DROP FUNCTION pg_temp.valeurs(text);
DROP FUNCTION pg_temp.liste(text[]);
