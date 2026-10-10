-- Amorçage de la bibliothèque d'initiatives types du STANDARD (PLA-13) :
-- huit initiatives génériques de conseil en management et gouvernance
-- (DECISIONS.md, métiers couverts), sans contenu propriétaire. Coûts et
-- durées types INDICATIFS en XOF, à calibrer par les experts au pilote ; un
-- cabinet les adapte par une variante, sans modifier le standard.

-- Deux instructions : le déclencheur des versions relit l'initiative type insérée.
INSERT INTO initiatives_types (code) VALUES
    ('tableau_de_bord_pilotage'),
    ('refonte_organisation'),
    ('controle_interne'),
    ('digitalisation_processus'),
    ('formation_managers'),
    ('recouvrement_creances'),
    ('reduction_couts'),
    ('developpement_commercial');

INSERT INTO initiative_type_versions (initiative_type_id, version, titre, description, perspective,
  prerequis, risques, cout_min, cout_type, cout_max, devise, duree_type_jours, charge_type_jours)
SELECT t.id, 1, v.titre, v.description, v.perspective, v.prerequis::jsonb, v.risques::jsonb,
  v.cout_min, v.cout_type, v.cout_max, 'XOF', v.duree, v.charge
FROM initiatives_types t JOIN (VALUES
  ('tableau_de_bord_pilotage', 'Tableau de bord de pilotage',
   'Définir les indicateurs clés, leurs responsables et le rituel de revue mensuelle de la direction.',
   'processus',
   '["Objectifs stratégiques validés", "Données de gestion disponibles"]',
   '[{"libelle": "Données sources peu fiables", "niveau": "moyen"}, {"libelle": "Rituel de revue abandonné", "niveau": "moyen"}]',
   5000000, 12000000, 25000000, 90, 40),
  ('refonte_organisation', 'Refonte de l''organisation',
   'Revoir l''organigramme, les fiches de poste et les délégations de pouvoir.',
   'apprentissage',
   '["Diagnostic organisationnel", "Soutien explicite de la direction générale"]',
   '[{"libelle": "Résistance au changement", "niveau": "eleve"}, {"libelle": "Départs de compétences clés", "niveau": "moyen"}]',
   8000000, 20000000, 45000000, 180, 80),
  ('controle_interne', 'Dispositif de contrôle interne',
   'Cartographier les risques, formaliser les contrôles clés et organiser leur suivi.',
   'processus',
   '["Processus principaux décrits", "Responsable du contrôle interne désigné"]',
   '[{"libelle": "Contrôles formalisés mais non appliqués", "niveau": "eleve"}]',
   10000000, 25000000, 50000000, 240, 100),
  ('digitalisation_processus', 'Digitalisation d''un processus clé',
   'Outiller un processus (facturation, achats, ventes) pour réduire délais et erreurs.',
   'processus',
   '["Processus cible décrit", "Budget d''investissement disponible"]',
   '[{"libelle": "Dépassement du budget informatique", "niveau": "eleve"}, {"libelle": "Faible adoption par les équipes", "niveau": "moyen"}]',
   15000000, 40000000, 100000000, 270, 120),
  ('formation_managers', 'Programme de formation des managers',
   'Former l''encadrement au pilotage par objectifs et à l''animation d''équipe.',
   'apprentissage',
   '["Référentiel de compétences managériales"]',
   '[{"libelle": "Indisponibilité des managers", "niveau": "moyen"}]',
   3000000, 8000000, 15000000, 120, 30),
  ('recouvrement_creances', 'Amélioration du recouvrement des créances',
   'Mettre en place les relances, les conditions de paiement et le suivi du délai client.',
   'finances',
   '["Balance âgée des créances fiable"]',
   '[{"libelle": "Dégradation de la relation client", "niveau": "faible"}]',
   2000000, 6000000, 12000000, 90, 25),
  ('reduction_couts', 'Plan de réduction des coûts',
   'Identifier et mettre en œuvre les leviers d''économie sur les charges externes et les achats.',
   'finances',
   '["Comptabilité analytique ou analyse des charges disponible"]',
   '[{"libelle": "Économies non pérennes", "niveau": "moyen"}, {"libelle": "Atteinte à la qualité de service", "niveau": "moyen"}]',
   4000000, 10000000, 20000000, 150, 45),
  ('developpement_commercial', 'Plan de développement commercial',
   'Segmenter les clients, définir l''offre et organiser la prospection.',
   'clients',
   '["Analyse du portefeuille clients", "Force de vente identifiée"]',
   '[{"libelle": "Cycle de vente plus long que prévu", "niveau": "moyen"}]',
   6000000, 15000000, 35000000, 180, 60)
) AS v (code, titre, description, perspective, prerequis, risques, cout_min, cout_type, cout_max,
        duree, charge)
ON v.code = t.code AND t.cabinet_id IS NULL;
