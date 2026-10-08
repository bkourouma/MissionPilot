-- Plancher des paramètres de confiance (NOT-11, audit des lots notation augmentée).
--
-- Un compte qui cumule `associe` et `expert_metier` pouvait fixer un seuil de 0 et une cible d'un
-- seul répondant, puis publier : la garde de publication (MPN10) devenait sans objet. L'API
-- refuse désormais cette modification à un expert métier (SEPARATION_DES_TACHES) et le schéma
-- partagé impose un plancher ; ce fichier le double en base. Valeurs À CALIBRER AU PILOTE (les
-- changer exige une nouvelle migration et la mise à jour de SEUIL_CONFIANCE_PLANCHER et
-- REPONDANTS_CIBLE_PLANCHER de packages/shared).
--
-- Les contraintes sont ajoutées NOT VALID : les lignes existantes ne sont pas réexaminées (une
-- base qui aurait déjà un seuil plus bas le garde jusqu'à sa prochaine modification), toute
-- écriture à venir est contrôlée.

ALTER TABLE notation_parametres
  ADD CONSTRAINT notation_parametres_seuil_plancher CHECK (seuil_confiance >= 0.3) NOT VALID,
  ADD CONSTRAINT notation_parametres_repondants_plancher CHECK (repondants_cible >= 2) NOT VALID;
