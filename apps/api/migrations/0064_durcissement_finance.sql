-- Durcissement de la finance V1 (audit de sécurité du lot finance).
--
-- 1. TRUNCATE. Les déclencheurs « ajout seul » de 0060, 0061 et 0062 sont
--    FOR EACH ROW : ils ne voient ni ne refusent un TRUNCATE, qui vide la
--    table sans passer par les lignes. Le rôle applicatif n'a pas le droit
--    TRUNCATE (privilèges par défaut : SELECT, INSERT, UPDATE, DELETE), mais
--    le propriétaire l'a. Le commentaire de 0060 (« Ajout seul, même pour le
--    propriétaire : aucune modification ni suppression ») était donc trompeur :
--    il ne couvrait ni TRUNCATE ni la désactivation d'un déclencheur. On ajoute
--    ici un déclencheur BEFORE TRUNCATE FOR EACH STATEMENT, avec la même
--    fonction de refus (SQLSTATE MPE01), sur chaque historique financier. Un
--    TRUNCATE … CASCADE depuis une table parente (factures, clients) déclenche
--    aussi ces refus. Restent hors d'atteinte d'une base : un propriétaire qui
--    désactive ou supprime un déclencheur (ALTER TABLE … DISABLE TRIGGER) ;
--    c'est la relecture des migrations qui l'empêche.
-- 2. Fonctions de déclencheur SECURITY DEFINER : REVOKE ALL … FROM PUBLIC
--    (elles ne s'appellent qu'en déclencheur, jamais directement).

CREATE TRIGGER encaissements_sans_troncature BEFORE TRUNCATE ON encaissements
  FOR EACH STATEMENT EXECUTE FUNCTION refuser_modification_finance();
CREATE TRIGGER imputations_sans_troncature BEFORE TRUNCATE ON imputations
  FOR EACH STATEMENT EXECUTE FUNCTION refuser_modification_finance();
CREATE TRIGGER contre_passations_sans_troncature BEFORE TRUNCATE ON contre_passations
  FOR EACH STATEMENT EXECUTE FUNCTION refuser_modification_finance();
CREATE TRIGGER relances_factures_sans_troncature BEFORE TRUNCATE ON relances_factures
  FOR EACH STATEMENT EXECUTE FUNCTION refuser_modification_finance();
-- Le déclencheur de ligne du bilan (controler_bilan_mission) ne sait pas
-- refuser un TRUNCATE (OLD et NEW y sont nuls) : même fonction de refus.
CREATE TRIGGER bilans_mission_sans_troncature BEFORE TRUNCATE ON bilans_mission
  FOR EACH STATEMENT EXECUTE FUNCTION refuser_modification_finance();

COMMENT ON FUNCTION refuser_modification_finance() IS
  'Historique financier en ajout seul (SQLSTATE MPE01) : refuse UPDATE et DELETE (déclencheurs de ligne, 0060, 0061) et TRUNCATE (déclencheurs d''instruction, 0064), y compris pour le propriétaire. Ne protège pas contre la désactivation d''un déclencheur par le propriétaire.';

REVOKE ALL ON FUNCTION controler_imputation() FROM PUBLIC;
REVOKE ALL ON FUNCTION controler_encaissement() FROM PUBLIC;
REVOKE ALL ON FUNCTION controler_annulation_facture() FROM PUBLIC;
