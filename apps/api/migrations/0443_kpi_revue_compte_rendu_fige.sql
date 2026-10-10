-- Revue de performance (KPI-17) : le compte rendu est FIGÉ à la tenue (audit du lot pilotage KPI).
--
-- Avant : le compte rendu d'une revue « tenue » se réécrivait à volonté, sans historique, jusqu'à la
-- clôture (0441 ne le figeait qu'après la clôture). Désormais il se saisit tant que la revue est
-- planifiée ou à l'instant de la tenue (POST /kpi/revues/:id/tenir) ; une fois la revue tenue, il ne
-- change plus (MPK22), comme l'ordre du jour, la date d'arrêté et le dossier. Aucun historique de
-- versions n'est donc nécessaire : ce qui a été acté en séance ne se réécrit pas.
--
-- Fonction redéfinie (CREATE OR REPLACE) ; la 0441 reste intacte. Même SQLSTATE qu'avant (MPK22).

CREATE OR REPLACE FUNCTION controler_kpi_revue() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.statut <> 'planifiee' THEN
        RAISE EXCEPTION 'Une revue naît planifiée.' USING ERRCODE = 'MPK20';
      END IF;
      IF EXISTS (SELECT 1 FROM missions m WHERE m.id = NEW.mission_id AND m.statut = 'cloturee') THEN
        RAISE EXCEPTION 'La mission est clôturée.' USING ERRCODE = 'MPK16';
      END IF;
      SELECT coalesce(max(r.numero), 0) + 1 INTO NEW.numero
        FROM kpi_revues r WHERE r.mission_id = NEW.mission_id;
    ELSE
      IF (NEW.cabinet_id, NEW.mission_id, NEW.numero, NEW.cree_par, NEW.cree_le)
         IS DISTINCT FROM (OLD.cabinet_id, OLD.mission_id, OLD.numero, OLD.cree_par, OLD.cree_le) THEN
        RAISE EXCEPTION 'Mission, numéro et création d''une revue sont figés.' USING ERRCODE = 'MPK11';
      END IF;
      IF NEW.statut IS DISTINCT FROM OLD.statut AND NOT (
           (OLD.statut = 'planifiee' AND NEW.statut IN ('tenue', 'annulee'))
           OR (OLD.statut = 'tenue' AND NEW.statut = 'cloturee')) THEN
        RAISE EXCEPTION 'Transition de revue invalide (% vers %).', OLD.statut, NEW.statut
          USING ERRCODE = 'MPK21';
      END IF;
      -- Figé dès la tenue : ce qui a été examiné et acté ne se réécrit pas (compte rendu compris).
      IF OLD.statut IN ('tenue', 'cloturee') AND (NEW.ordre_du_jour, NEW.date_reference, NEW.dossier,
           NEW.titre, NEW.date_prevue, NEW.tenue_le, NEW.tenue_par, NEW.compte_rendu)
         IS DISTINCT FROM (OLD.ordre_du_jour, OLD.date_reference, OLD.dossier,
           OLD.titre, OLD.date_prevue, OLD.tenue_le, OLD.tenue_par, OLD.compte_rendu) THEN
        RAISE EXCEPTION 'Le contenu d''une revue tenue (compte rendu compris) est figé.'
          USING ERRCODE = 'MPK22';
      END IF;
      IF OLD.statut = 'annulee' AND (NEW IS DISTINCT FROM OLD) THEN
        RAISE EXCEPTION 'Une revue annulée ne change plus.' USING ERRCODE = 'MPK21';
      END IF;
      IF OLD.statut = 'tenue' AND NEW.statut = 'cloturee' AND (
           EXISTS (SELECT 1 FROM kpi_revue_decisions d
                   WHERE d.revue_id = NEW.id AND d.statut IN ('ouverte', 'en_cours'))
           OR EXISTS (SELECT 1 FROM kpi_actions a
                      WHERE a.revue_id = NEW.id AND a.statut IN ('a_faire', 'en_cours'))) THEN
        RAISE EXCEPTION 'Des décisions ou des actions de la revue sont encore ouvertes.'
          USING ERRCODE = 'MPK23';
      END IF;
    END IF;
    NEW.modifie_le := now();
    RETURN NEW;
  END $$;
