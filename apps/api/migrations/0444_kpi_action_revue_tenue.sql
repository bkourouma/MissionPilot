-- Actions correctives (KPI-18) : une action ne se rattache qu'à une revue TENUE (audit du lot
-- pilotage KPI, course revue/action).
--
-- Avant : le déclencheur de la 0442 vérifiait seulement que la revue appartenait à la mission ;
-- le contrôle « revue tenue » n'était fait que par l'API, sans verrou sur la revue. Une action
-- pouvait ainsi être insérée pendant la clôture de la revue, ou sur une revue clôturée ou annulée.
-- Désormais la base refuse (MPK27) toute insertion portant une `revue_id` dont le statut n'est pas
-- « tenue » ; la lecture prend un verrou partagé sur la revue (FOR SHARE), ce qui sérialise
-- l'insertion avec la clôture (UPDATE de la revue) : l'une des deux voit le résultat de l'autre.
--
-- SQLSTATE : MPK27 action rattachée à une revue qui n'est pas tenue (suite de MPK26, 0442).
-- Fonction redéfinie (CREATE OR REPLACE) ; la 0442 reste intacte.

CREATE OR REPLACE FUNCTION controler_kpi_action() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_revue_mission uuid;
    v_revue_statut text;
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NOT EXISTS (SELECT 1 FROM kpi_definitions d
                     WHERE d.id = NEW.kpi_id AND d.mission_id = NEW.mission_id) THEN
        RAISE EXCEPTION 'Le KPI de l''action n''appartient pas à sa mission.' USING ERRCODE = 'MPK10';
      END IF;
      IF NEW.alerte_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM kpi_alertes a WHERE a.id = NEW.alerte_id AND a.kpi_id = NEW.kpi_id) THEN
        RAISE EXCEPTION 'L''alerte de l''action concerne un autre KPI.' USING ERRCODE = 'MPK10';
      END IF;
      IF NEW.revue_id IS NOT NULL THEN
        SELECT r.mission_id, r.statut INTO v_revue_mission, v_revue_statut
          FROM kpi_revues r WHERE r.id = NEW.revue_id FOR SHARE;
        IF v_revue_mission IS DISTINCT FROM NEW.mission_id THEN
          RAISE EXCEPTION 'La revue de l''action concerne une autre mission.' USING ERRCODE = 'MPK10';
        END IF;
        IF v_revue_statut IS DISTINCT FROM 'tenue' THEN
          RAISE EXCEPTION 'Une action se rattache à une revue tenue et non clôturée.'
            USING ERRCODE = 'MPK27';
        END IF;
      END IF;
      IF NEW.decision_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM kpi_revue_decisions d WHERE d.id = NEW.decision_id AND d.revue_id = NEW.revue_id) THEN
        RAISE EXCEPTION 'La décision de l''action appartient à une autre revue.' USING ERRCODE = 'MPK10';
      END IF;
      IF EXISTS (SELECT 1 FROM missions m WHERE m.id = NEW.mission_id AND m.statut = 'cloturee') THEN
        RAISE EXCEPTION 'La mission est clôturée.' USING ERRCODE = 'MPK16';
      END IF;
      IF NEW.statut <> 'a_faire' THEN
        RAISE EXCEPTION 'Une action naît à faire.' USING ERRCODE = 'MPK26';
      END IF;
      SELECT coalesce(max(a.numero), 0) + 1 INTO NEW.numero
        FROM kpi_actions a WHERE a.mission_id = NEW.mission_id;
    ELSE
      IF (NEW.cabinet_id, NEW.mission_id, NEW.kpi_id, NEW.alerte_id, NEW.revue_id, NEW.decision_id,
          NEW.numero, NEW.cree_par, NEW.cree_le)
         IS DISTINCT FROM (OLD.cabinet_id, OLD.mission_id, OLD.kpi_id, OLD.alerte_id, OLD.revue_id,
          OLD.decision_id, OLD.numero, OLD.cree_par, OLD.cree_le) THEN
        RAISE EXCEPTION 'Rattachements et création d''une action sont figés.' USING ERRCODE = 'MPK11';
      END IF;
      IF OLD.statut IN ('terminee', 'abandonnee') AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION 'Une action terminée ou abandonnée ne se rouvre pas.' USING ERRCODE = 'MPK26';
      END IF;
      IF NEW.statut IS DISTINCT FROM OLD.statut AND NOT (
           (OLD.statut = 'a_faire' AND NEW.statut IN ('en_cours', 'terminee', 'abandonnee'))
           OR (OLD.statut = 'en_cours' AND NEW.statut IN ('terminee', 'abandonnee'))) THEN
        RAISE EXCEPTION 'Transition d''action invalide (% vers %).', OLD.statut, NEW.statut
          USING ERRCODE = 'MPK26';
      END IF;
    END IF;
    NEW.modifie_le := now();
    RETURN NEW;
  END $$;
