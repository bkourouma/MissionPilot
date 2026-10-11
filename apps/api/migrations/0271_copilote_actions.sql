-- Copilote conversationnel (AGT-08) : actions PROPOSÉES par le copilote, confirmées ensuite par
-- l'utilisateur (PRD complémentaire §7 : « toute action modifiante est confirmée »).
--
-- Le copilote n'exécute JAMAIS une action modifiante : il enregistre ici une proposition (outil,
-- paramètres déjà validés et résolus, résumé en français construit par le code, empreinte SHA-256
-- des paramètres, expiration à 5 minutes) ; l'exécution passe par la route de confirmation, pour
-- le MÊME utilisateur, une seule fois, sous verrou de ligne, après nouvelle vérification de ses
-- droits. Aucune conversation n'est conservée : seules ces propositions le sont.
--
-- SQLSTATE (lettre G, agents IA) :
--   MPG10 proposition terminée ou transition interdite : une proposition naît « proposee », ne
--         quitte cet état qu'une fois (confirmee, annulee, expiree, refusee) et ne change plus.
--   MPG11 proposition incohérente : identité (cabinet, utilisateur, outil, paramètres, empreinte,
--         résumé, dates de création et d'expiration) modifiée, confirmation sans résultat.
-- Plage AGT (0260-0279) ; la lettre et les numéros MPG10 et MPG11 étaient libres.
--
-- `resultat_id` : identifiant de l'objet créé par l'action confirmée ; son type dépend de l'outil
-- (une tâche de collaboration pour `creer_tache`), d'où l'absence de clé étrangère : l'outil est
-- un code validé par l'API (registre ACTIONS), pas par la base.

CREATE TABLE copilote_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  utilisateur_id uuid NOT NULL,
  outil text NOT NULL CHECK (outil ~ '^[a-z][a-z0-9_]{2,39}$'),
  parametres jsonb NOT NULL CHECK (jsonb_typeof(parametres) = 'object'),
  empreinte text NOT NULL CHECK (empreinte ~ '^[0-9a-f]{64}$'),
  resume text NOT NULL CHECK (length(btrim(resume)) BETWEEN 1 AND 1000),
  statut text NOT NULL DEFAULT 'proposee'
    CHECK (statut IN ('proposee', 'confirmee', 'annulee', 'expiree', 'refusee')),
  cree_le timestamptz NOT NULL DEFAULT now(),
  expire_le timestamptz NOT NULL,
  decide_le timestamptz,
  resultat_id uuid,
  UNIQUE (cabinet_id, id),
  CHECK (expire_le > cree_le),
  CHECK ((statut = 'proposee') = (decide_le IS NULL)),
  CHECK (statut <> 'confirmee' OR resultat_id IS NOT NULL),
  CHECK (statut = 'confirmee' OR resultat_id IS NULL),
  FOREIGN KEY (cabinet_id, utilisateur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX copilote_actions_utilisateur_idx
  ON copilote_actions (cabinet_id, utilisateur_id, cree_le DESC);

ALTER TABLE copilote_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON copilote_actions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
-- Le portail client n'atteint jamais le copilote : rien de visible ni de modifiable.
CREATE POLICY portail_interdit ON copilote_actions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);

-- Jamais de suppression ; seule la décision (statut, date, résultat) se renseigne, une fois.
REVOKE DELETE ON copilote_actions FROM missionpilot_app;
REVOKE UPDATE ON copilote_actions FROM missionpilot_app;
GRANT UPDATE (statut, decide_le, resultat_id) ON copilote_actions TO missionpilot_app;

CREATE FUNCTION controler_copilote_action() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.statut <> 'proposee' THEN
        RAISE EXCEPTION 'Une action du copilote naît « proposee ».' USING ERRCODE = 'MPG10';
      END IF;
      RETURN NEW;
    END IF;
    IF (NEW.cabinet_id, NEW.utilisateur_id, NEW.outil, NEW.parametres, NEW.empreinte, NEW.resume,
        NEW.cree_le, NEW.expire_le)
       IS DISTINCT FROM
       (OLD.cabinet_id, OLD.utilisateur_id, OLD.outil, OLD.parametres, OLD.empreinte, OLD.resume,
        OLD.cree_le, OLD.expire_le) THEN
      RAISE EXCEPTION 'Action du copilote : identité non modifiable.' USING ERRCODE = 'MPG11';
    END IF;
    IF OLD.statut <> 'proposee' THEN
      RAISE EXCEPTION 'Action du copilote terminée : état non modifiable.' USING ERRCODE = 'MPG10';
    END IF;
    IF NEW.statut = 'proposee' THEN
      RAISE EXCEPTION 'Action du copilote : une proposition ne change que par sa décision.'
        USING ERRCODE = 'MPG10';
    END IF;
    IF NEW.statut = 'confirmee' AND NEW.resultat_id IS NULL THEN
      RAISE EXCEPTION 'Action du copilote confirmée sans résultat.' USING ERRCODE = 'MPG11';
    END IF;
    RETURN NEW;
  END $$;

CREATE TRIGGER copilote_actions_controle BEFORE INSERT OR UPDATE ON copilote_actions
  FOR EACH ROW EXECUTE FUNCTION controler_copilote_action();
