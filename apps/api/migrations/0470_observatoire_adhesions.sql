-- Observatoire inter-cabinets (lot 5b, PRD complémentaire §12 CAP-04 et §21 décision n° 1) :
-- adhésion VOLONTAIRE du cabinet, DÉSACTIVÉE par défaut (aucun événement = non adhérent), accès
-- aux agrégats réservé aux cabinets adhérents (contributeurs), agrégats seuls (k-anonymat).
--
-- SQLSTATE : second préfixe de deux lettres `MQ` (CODING_STANDARDS §2 : plus aucune lettre libre
-- sous `MP`), lettre `K` pour la capitalisation du lot 5b, plages disjointes par tâche :
--   MQK01–MQK19 réservés à l'efficacité des recommandations (CAP-03, migrations 0466–0469) ;
--   MQK20–MQK39 réservés à l'observatoire (CAP-04, migrations 0470–0479), dont :
--     MQK20 historique d'adhésion en ajout seul ;
--     MQK21 transition d'adhésion refusée (adhérer en étant adhérent, se retirer sans l'être) ;
--     MQK22 versement refusé : adhésion inactive ;
--     MQK23 contribution immuable (aucune modification ; le retrait est une suppression) ;
--     MQK24 agrégats refusés hors contexte de cabinet ou dans une transaction du portail ;
--     MQK25 agrégats refusés : cabinet non adhérent ;
--     MQK26 indicateur inconnu.
--
-- Historique d'adhésion : journal en AJOUT SEUL (`obs_adhesion_evenements`), état courant = dernier
-- événement (par rang). Les rangs se suivent (calculés par le déclencheur sous verrou consultatif
-- du cabinet, doublés d'une unicité) : deux adhésions concurrentes ne passent pas toutes deux.

CREATE TABLE obs_adhesion_evenements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  rang integer NOT NULL CHECK (rang BETWEEN 1 AND 100000),
  action text NOT NULL CHECK (action IN ('adhesion', 'retrait')),
  motif text CHECK (motif IS NULL OR length(btrim(motif)) BETWEEN 1 AND 500),
  par uuid NOT NULL,
  le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, rang),
  FOREIGN KEY (cabinet_id, par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE obs_adhesion_evenements ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON obs_adhesion_evenements
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON obs_adhesion_evenements AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON obs_adhesion_evenements FROM missionpilot_app;

CREATE FUNCTION controler_obs_adhesion() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_derniere text;
    v_rang integer;
  BEGIN
    IF TG_OP <> 'INSERT' THEN
      RAISE EXCEPTION 'Historique d''adhésion à l''observatoire en ajout seul.' USING ERRCODE = 'MQK20';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('obs_adhesion:' || NEW.cabinet_id::text, 0));
    SELECT e.action, e.rang INTO v_derniere, v_rang
      FROM obs_adhesion_evenements e
     WHERE e.cabinet_id = NEW.cabinet_id
     ORDER BY e.rang DESC LIMIT 1;
    IF (NEW.action = 'adhesion' AND v_derniere = 'adhesion')
       OR (NEW.action = 'retrait' AND v_derniere IS DISTINCT FROM 'adhesion') THEN
      RAISE EXCEPTION 'Transition d''adhésion à l''observatoire refusée.' USING ERRCODE = 'MQK21';
    END IF;
    NEW.rang := coalesce(v_rang, 0) + 1;
    NEW.le := now();
    RETURN NEW;
  END $$;
CREATE TRIGGER obs_adhesion_evenements_controle
  BEFORE INSERT OR UPDATE OR DELETE ON obs_adhesion_evenements
  FOR EACH ROW EXECUTE FUNCTION controler_obs_adhesion();

-- Adhésion active d'un cabinet (dernier événement = adhésion). Fonction d'INVOCATEUR : appelée par
-- le rôle applicatif, elle ne lit que son propre cabinet (RLS) ; appelée depuis `obs_agregats`
-- (SECURITY DEFINER, 0472), elle lit tous les cabinets.
CREATE FUNCTION obs_adhesion_active(p_cabinet uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = public, pg_temp
  AS $$
    SELECT coalesce((SELECT e.action = 'adhesion' FROM obs_adhesion_evenements e
                      WHERE e.cabinet_id = p_cabinet ORDER BY e.rang DESC LIMIT 1), false)
  $$;
REVOKE ALL ON FUNCTION obs_adhesion_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION obs_adhesion_active(uuid) TO missionpilot_app;
