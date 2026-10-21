-- Revue à froid (QUA-05) : plan d'amélioration continue.
--
-- Une ACTION corrige un constat ou améliore la pratique du cabinet : titre, responsable (utilisateur
-- actif du cabinet), échéance, statut a_faire → en_cours → faite | abandonnee. 500 actions au plus
-- par campagne. Les transitions valides sont celles du moteur (`transitionActionValide`) : une
-- action faite ou abandonnée est close et figée (MQQ06). Chaque changement écrit une ligne de
-- l'historique, en AJOUT SEUL (MQQ01) ; clôturer exige un commentaire.
-- Le plan continue après la clôture de la campagne : les actions s'ajoutent à une campagne close.

CREATE TABLE qualite_froide_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  campagne_id uuid NOT NULL,
  constat_id uuid,
  titre text NOT NULL CHECK (length(btrim(titre)) BETWEEN 1 AND 200 AND titre !~ '[[:cntrl:]]'),
  description text CHECK (description IS NULL OR length(btrim(description)) BETWEEN 1 AND 2000),
  responsable_id uuid NOT NULL,
  echeance date NOT NULL,
  statut text NOT NULL DEFAULT 'a_faire' CHECK (statut IN ('a_faire', 'en_cours', 'faite', 'abandonnee')),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  cloturee_le timestamptz,
  CHECK ((statut IN ('faite', 'abandonnee')) = (cloturee_le IS NOT NULL)),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, campagne_id) REFERENCES qualite_froide_campagnes (cabinet_id, id),
  FOREIGN KEY (cabinet_id, constat_id) REFERENCES qualite_froide_constats (cabinet_id, id),
  FOREIGN KEY (cabinet_id, responsable_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX qualite_froide_actions_campagne_idx
  ON qualite_froide_actions (cabinet_id, campagne_id, echeance, id);
CREATE INDEX qualite_froide_actions_responsable_idx
  ON qualite_froide_actions (cabinet_id, responsable_id, statut);
ALTER TABLE qualite_froide_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON qualite_froide_actions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON qualite_froide_actions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON qualite_froide_actions FROM missionpilot_app;
GRANT UPDATE (responsable_id, echeance, statut, modifie_le, cloturee_le)
  ON qualite_froide_actions TO missionpilot_app;

CREATE FUNCTION controler_qualite_froide_action() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_constat record;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une action du plan d''amélioration ne se supprime pas : elle s''abandonne.'
        USING ERRCODE = 'MQQ06';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.statut <> 'a_faire' THEN
        RAISE EXCEPTION 'Une action commence à faire.' USING ERRCODE = 'MQQ06';
      END IF;
      IF (SELECT count(*) FROM qualite_froide_actions a WHERE a.campagne_id = NEW.campagne_id) >= 500 THEN
        RAISE EXCEPTION 'Une campagne porte 500 actions au plus.' USING ERRCODE = 'MQQ09';
      END IF;
      IF NEW.constat_id IS NOT NULL THEN
        SELECT e.campagne_id, e.statut INTO v_constat
          FROM qualite_froide_constats c JOIN qualite_froide_echantillon e ON e.id = c.echantillon_id
          WHERE c.id = NEW.constat_id;
        IF v_constat.campagne_id IS DISTINCT FROM NEW.campagne_id OR v_constat.statut <> 'terminee' THEN
          RAISE EXCEPTION 'Le constat doit venir d''une revue terminée de la même campagne.'
            USING ERRCODE = 'MQQ12';
        END IF;
      END IF;
    ELSE
      IF NEW.cabinet_id IS DISTINCT FROM OLD.cabinet_id OR NEW.campagne_id IS DISTINCT FROM OLD.campagne_id
         OR NEW.constat_id IS DISTINCT FROM OLD.constat_id OR NEW.titre IS DISTINCT FROM OLD.titre
         OR NEW.description IS DISTINCT FROM OLD.description OR NEW.cree_par IS DISTINCT FROM OLD.cree_par
         OR NEW.cree_le IS DISTINCT FROM OLD.cree_le THEN
        RAISE EXCEPTION 'Seuls le statut, le responsable et l''échéance d''une action évoluent.'
          USING ERRCODE = 'MQQ06';
      END IF;
      IF OLD.statut IN ('faite', 'abandonnee') THEN
        RAISE EXCEPTION 'Une action close est figée.' USING ERRCODE = 'MQQ06';
      END IF;
      IF NEW.statut <> OLD.statut AND NOT (
           (OLD.statut = 'a_faire' AND NEW.statut IN ('en_cours', 'faite', 'abandonnee'))
           OR (OLD.statut = 'en_cours' AND NEW.statut IN ('a_faire', 'faite', 'abandonnee'))) THEN
        RAISE EXCEPTION 'Transition de statut impossible pour cette action.' USING ERRCODE = 'MQQ06';
      END IF;
    END IF;
    IF (TG_OP = 'INSERT' OR NEW.responsable_id IS DISTINCT FROM OLD.responsable_id)
       AND NOT EXISTS (SELECT 1 FROM utilisateurs u WHERE u.id = NEW.responsable_id AND u.actif) THEN
      RAISE EXCEPTION 'Le responsable doit être un utilisateur actif du cabinet.' USING ERRCODE = 'MQQ08';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER qualite_froide_actions_controle BEFORE INSERT OR UPDATE OR DELETE ON qualite_froide_actions
  FOR EACH ROW EXECUTE FUNCTION controler_qualite_froide_action();

CREATE TABLE qualite_froide_actions_historique (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  action_id uuid NOT NULL,
  rang integer NOT NULL CHECK (rang >= 1),
  de_statut text CHECK (de_statut IS NULL OR de_statut IN ('a_faire', 'en_cours', 'faite', 'abandonnee')),
  vers_statut text NOT NULL CHECK (vers_statut IN ('a_faire', 'en_cours', 'faite', 'abandonnee')),
  responsable_id uuid NOT NULL,
  echeance date NOT NULL,
  commentaire text CHECK (commentaire IS NULL OR length(btrim(commentaire)) BETWEEN 1 AND 2000),
  auteur_id uuid NOT NULL,
  le timestamptz NOT NULL DEFAULT now(),
  -- Clôturer une action se commente (résultat obtenu ou raison de l'abandon).
  CHECK (vers_statut NOT IN ('faite', 'abandonnee') OR commentaire IS NOT NULL),
  UNIQUE (cabinet_id, id),
  CONSTRAINT qualite_froide_actions_historique_rang_uniq UNIQUE (action_id, rang),
  FOREIGN KEY (cabinet_id, action_id) REFERENCES qualite_froide_actions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, responsable_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE qualite_froide_actions_historique ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON qualite_froide_actions_historique
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON qualite_froide_actions_historique AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON qualite_froide_actions_historique FROM missionpilot_app;
CREATE TRIGGER qualite_froide_actions_historique_ajout_seul
  BEFORE UPDATE OR DELETE ON qualite_froide_actions_historique
  FOR EACH ROW EXECUTE FUNCTION qualite_froide_ajout_seul();
