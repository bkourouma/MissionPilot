-- Dossier client (lot DOS) — correctif d'audit de sécurité : la tolérance de contrôle choisie
-- par l'importateur ne décide plus d'une acceptation automatique (DOS-03).
--
-- Acceptation automatique : tous les contrôles passent ET tolérance nulle. Un état de
-- tolérance non nulle va en revue ; l'accepter exige un motif, comme un état en écart.
-- Fonction REMPLACÉE (CREATE OR REPLACE) : le reste de 0222 est conservé. SQLSTATE MPO04.

CREATE OR REPLACE FUNCTION controler_dossier_etat_decision() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_etat record;
  BEGIN
    SELECT e.controles_ok, e.cree_le, e.tolerance INTO v_etat FROM dossier_etats_financiers e
      WHERE e.id = NEW.etat_id;
    IF EXISTS (SELECT 1 FROM dossier_etats_financiers r WHERE r.remplace_id = NEW.etat_id) THEN
      RAISE EXCEPTION 'Un état financier remplacé ne reçoit plus de décision.' USING ERRCODE = 'MPO03';
    END IF;
    IF NEW.automatique AND (NOT v_etat.controles_ok OR v_etat.tolerance <> 0
                            OR v_etat.cree_le <> now()) THEN
      RAISE EXCEPTION 'Acceptation automatique refusée : tous les contrôles doivent passer à l''ingestion, à tolérance nulle.'
        USING ERRCODE = 'MPO04';
    END IF;
    IF NOT NEW.automatique AND NEW.decision = 'accepte'
       AND (NOT v_etat.controles_ok OR v_etat.tolerance <> 0) AND NEW.motif IS NULL THEN
      RAISE EXCEPTION 'Accepter un état dont des contrôles échouent ou de tolérance non nulle exige un motif.'
        USING ERRCODE = 'MPO04';
    END IF;
    RETURN NEW;
  END $$;
