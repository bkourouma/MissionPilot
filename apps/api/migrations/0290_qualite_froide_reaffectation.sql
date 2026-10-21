-- Revue à froid (QUA-05) : un relecteur ne se remplace pas pendant la revue.
--
-- Une fois la saisie commencée (échantillon `en_revue`), le relecteur affecté tient la grille et
-- les constats (MQQ11) : le remplacer laisserait des évaluations et des constats d'un auteur qui
-- n'est plus le relecteur. La réaffectation reste permise tant que la revue n'a pas commencé
-- (`affectee`). Déclencheur DISTINCT de `controler_qualite_froide_echantillon` (0287), qu'on ne
-- redéfinit pas ; il porte un nom qui se classe APRÈS lui (ordre alphabétique des déclencheurs),
-- si bien qu'une revue terminée reste refusée par MQQ04. SQLSTATE MQQ13.

CREATE FUNCTION controler_qualite_froide_reaffectation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF OLD.statut = 'en_revue' AND NEW.relecteur_id IS DISTINCT FROM OLD.relecteur_id THEN
      RAISE EXCEPTION 'Le relecteur ne se remplace pas une fois la revue commencée.'
        USING ERRCODE = 'MQQ13';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER qualite_froide_echantillon_controle_reaffectation BEFORE UPDATE
  ON qualite_froide_echantillon
  FOR EACH ROW EXECUTE FUNCTION controler_qualite_froide_reaffectation();
