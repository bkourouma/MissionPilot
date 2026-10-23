-- Référentiel de méthodes (lot STD, STD-04 et STD-11) — modification ADDITIVE d'un facteur de
-- contexte PROPRE AU CABINET. Jusqu'ici (0200) `facteurs_contexte` était en ajout seul pour le
-- rôle applicatif : un cabinet ne pouvait ni corriger un libellé ni ajouter une valeur à une
-- énumération. Un facteur est lu par des règles de modulation, des cas types et des contextes de
-- mission déjà enregistrés : on peut donc l'enrichir, jamais l'appauvrir.
--
-- Droits : le rôle applicatif reçoit UPDATE sur les seules colonnes `libelle`, `description`,
-- `valeurs`, `min` et `max` (jamais sur l'identité : code, type, porteur, propriétaire).
-- DELETE reste refusé. La politique `isolation` limite l'UPDATE aux lignes du cabinet : une ligne
-- du standard (cabinet_id NULL) n'est jamais visible en écriture pour le rôle applicatif.
--
-- Déclencheur (défense en profondeur, y compris pour le propriétaire de la table) :
-- - MQS01 : identité figée (id, cabinet, code, type, porteur, ordre, date de création) ou facteur
--   du standard (traduit en 409 FACTEUR_FIGE) ;
-- - MQS02 : valeur d'énumération ou de liste retirée, ou borne resserrée — ajouter une borne là
--   où il n'y en avait pas, relever le minimum, abaisser le maximum ; supprimer une borne ou
--   l'élargir est permis (traduit en 409 FACTEUR_RETRAIT_INTERDIT).

GRANT UPDATE (libelle, description, valeurs, min, max) ON facteurs_contexte TO missionpilot_app;

CREATE FUNCTION controler_modification_facteur() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF OLD.cabinet_id IS NULL THEN
      RAISE EXCEPTION 'Facteur du standard figé.' USING ERRCODE = 'MQS01';
    END IF;
    IF (NEW.id, NEW.cabinet_id, NEW.code, NEW.type, NEW.porte_par, NEW.ordre, NEW.cree_le)
       IS DISTINCT FROM
       (OLD.id, OLD.cabinet_id, OLD.code, OLD.type, OLD.porte_par, OLD.ordre, OLD.cree_le) THEN
      RAISE EXCEPTION 'Identité d''un facteur de contexte figée.' USING ERRCODE = 'MQS01';
    END IF;
    IF OLD.valeurs IS NOT NULL AND (
         NEW.valeurs IS NULL
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(OLD.valeurs) AS o(v)
            WHERE NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements(NEW.valeurs) AS n(v) WHERE n.v ->> 'code' = o.v ->> 'code'
            )
         )
       ) THEN
      RAISE EXCEPTION 'Une valeur existante d''un facteur ne se retire pas.' USING ERRCODE = 'MQS02';
    END IF;
    IF NEW.min IS NOT NULL AND (OLD.min IS NULL OR NEW.min > OLD.min) THEN
      RAISE EXCEPTION 'Borne minimale resserrée : on élargit seulement.' USING ERRCODE = 'MQS02';
    END IF;
    IF NEW.max IS NOT NULL AND (OLD.max IS NULL OR NEW.max < OLD.max) THEN
      RAISE EXCEPTION 'Borne maximale resserrée : on élargit seulement.' USING ERRCODE = 'MQS02';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER facteurs_contexte_modification BEFORE UPDATE ON facteurs_contexte
  FOR EACH ROW EXECUTE FUNCTION controler_modification_facteur();
