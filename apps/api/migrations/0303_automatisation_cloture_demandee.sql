-- Moteur d'automatisation (lot AUT-CORE, ADR-006) : l'événement `mission.cloture_demandee`
-- (PRD complémentaire §8.2, « clôture demandée → check-list bloquante, bilan, retour
-- d'expérience, enquête de satisfaction ») est désormais publié PAR LA BASE, comme
-- `mission.signee` et `mission.jalon_atteint` (0302), au passage de la mission au statut
-- « à clôturer » (valeur `a_cloturer`, cycle de 0011 : en_cours → a_cloturer → cloturee).
-- Avant cette migration aucun code ne le publiait : l'automatisation standard « rappel de la
-- check-list de clôture » ne pouvait jamais se déclencher.
--
-- Même modèle que 0302 (`automatisation_publier_base`) :
-- - NON BLOQUANT : toute erreur est absorbée par la sous-transaction de la fonction de
--   publication, le changement de statut de la mission se poursuit ;
-- - rien n'est publié depuis une transaction du portail client ;
-- - contenu = identifiants seulement (la mission), jamais un montant ;
-- - source `base` : aucune personne n'est enregistrée à l'origine (le mode d'exécution
--   « droits de la personne à l'origine » est donc refusé pour cet événement, comme pour les
--   autres événements publiés par la base) ;
-- - IDEMPOTENT par mission ET par passage : la clé porte l'horodatage de la transition
--   (microseconde, UTC). Une mission rouverte (« à clôturer » → « en cours ») puis de nouveau
--   mise « à clôturer » publie un NOUVEL événement (au-delà du délai d'anti-répétition
--   ci-dessous) ; rejouer le même passage (même
--   transaction) n'en crée pas un second. Seul un passage VERS « à clôturer » publie : la
--   clôture (« cloturee ») et un UPDATE qui laisse le statut inchangé ne publient rien.
-- - ANTI-RÉPÉTITION : une mission qui bascule « en cours » → « à clôturer » → « en cours » en
--   boucle ne spamme pas son directeur (un événement, un traitement, une exécution et des
--   e-mails par aller-retour, la clé changeant à chaque transaction) : rien n'est publié si un
--   événement du même code existe déjà pour cette mission depuis moins de 10 minutes
--   (délai « à valider » par le métier, constante c_delai_repetition ci-dessous).
-- Aucun nouveau SQLSTATE : cette migration n'ajoute ni table, ni contrainte, ni exception.

CREATE FUNCTION automatisation_cloture_demandee() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    -- Délai minimal entre deux événements « clôture demandée » d'une même mission ; à valider.
    c_delai_repetition CONSTANT interval := interval '10 minutes';
    v_recent boolean := false;
  BEGIN
    BEGIN
      SELECT EXISTS (
        SELECT 1 FROM automatisation_evenements e
        WHERE e.cabinet_id = NEW.cabinet_id AND e.code = 'mission.cloture_demandee'
          AND e.mission_id = NEW.id AND e.cree_le > now() - c_delai_repetition)
        INTO v_recent;
    EXCEPTION WHEN OTHERS THEN
      v_recent := false;
    END;
    IF v_recent THEN
      RETURN NULL;
    END IF;
    PERFORM automatisation_publier_base(NEW.cabinet_id, 'mission.cloture_demandee',
      jsonb_build_object('mission_id', NEW.id),
      NEW.id::text || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISSUS'),
      NEW.id);
    RETURN NULL;
  END $$;

CREATE TRIGGER automatisation_cloture_demandee AFTER UPDATE OF statut ON missions
  FOR EACH ROW WHEN (NEW.statut = 'a_cloturer' AND OLD.statut <> 'a_cloturer')
  EXECUTE FUNCTION automatisation_cloture_demandee();
