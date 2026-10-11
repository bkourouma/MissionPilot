-- Copilote (AGT-08) : conservation limitée des propositions d'actions (`copilote_actions`, 0271).
--
-- Une proposition garde `parametres` (titre de la tâche, assigné, mission) et `resume` (texte en
-- clair construit par le code) : des données de travail qui n'ont plus d'usage une fois la
-- proposition terminée. Ce fichier ajoute leur ANONYMISATION, sur le modèle de
-- `0104_ia_conservation.sql` :
--
-- - `anonymise_le` : instant où la proposition a été anonymisée (une seule fois). L'anonymisation
--   vide `parametres` (objet vide), remplace `resume` par un marqueur et neutralise `empreinte`
--   (64 zéros : l'empreinte d'un contenu effacé n'a plus de sens). Tout le reste de la ligne
--   (outil, utilisateur, statut, dates, résultat) est conservé : la trace de la décision survit au
--   contenu ; le journal d'audit ne contient de toute façon jamais ces textes.
-- - Une proposition est anonymisable quand elle est TERMINÉE (confirmée, annulée, expirée,
--   refusée) depuis plus de `p_jours` jours (30 : durée PROPOSÉE, à valider ; la fonction refuse
--   moins de 30). Une proposition « proposee » dont l'expiration est passée est d'abord marquée
--   « expiree » (décision datée de son expiration), puis suit la même règle.
-- - Le déclencheur d'états terminaux (MPG10, MPG11) n'admet QUE cette anonymisation, jamais un
--   UPDATE libre ; le rôle applicatif n'a toujours aucun droit de modifier les textes ; la purge
--   passe par la fonction SECURITY DEFINER `anonymiser_copilote_actions`, bornée au cabinet du
--   contexte (`app_cabinet_id()`), appelée par le job « copilote_purge ».
-- - Planification : un job par cabinet et par jour (clé `copilote_purge:AAAA-MM-JJ`), pour les
--   seuls cabinets ayant une proposition à traiter (`planifier_purge_copilote`).

ALTER TABLE copilote_actions ADD COLUMN anonymise_le timestamptz;
CREATE INDEX copilote_actions_purge_idx ON copilote_actions (cabinet_id, decide_le)
  WHERE anonymise_le IS NULL AND statut <> 'proposee';
CREATE INDEX copilote_actions_expiration_idx ON copilote_actions (cabinet_id, expire_le)
  WHERE statut = 'proposee';

CREATE OR REPLACE FUNCTION controler_copilote_action() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.statut <> 'proposee' OR NEW.anonymise_le IS NOT NULL THEN
        RAISE EXCEPTION 'Une action du copilote naît « proposee ».' USING ERRCODE = 'MPG10';
      END IF;
      RETURN NEW;
    END IF;
    -- Seule modification admise d'une proposition terminée : son anonymisation, une fois.
    IF OLD.anonymise_le IS NULL AND NEW.anonymise_le IS NOT NULL THEN
      IF OLD.statut = 'proposee'
         OR NEW.parametres <> '{}'::jsonb
         OR NEW.resume <> 'Proposition anonymisée (durée de conservation écoulée).'
         OR NEW.empreinte <> repeat('0', 64)
         OR (to_jsonb(NEW) - 'parametres' - 'resume' - 'empreinte' - 'anonymise_le')
            <> (to_jsonb(OLD) - 'parametres' - 'resume' - 'empreinte' - 'anonymise_le') THEN
        RAISE EXCEPTION 'Action du copilote : seule l''anonymisation prévue est admise.'
          USING ERRCODE = 'MPG11';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.anonymise_le IS NOT NULL THEN
      RAISE EXCEPTION 'Action du copilote anonymisée : non modifiable.' USING ERRCODE = 'MPG10';
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

-- Marque « expiree » les propositions échues du cabinet du contexte, puis anonymise les
-- propositions terminées depuis plus de p_jours jours (au plus p_limite par étape) ; renvoie le
-- nombre de propositions anonymisées. p_maintenant ne dépasse pas l'horloge de la base de plus
-- d'une minute (une date future avancerait l'échéance de toutes les propositions du cabinet).
CREATE FUNCTION anonymiser_copilote_actions(p_maintenant timestamptz, p_jours int,
                                            p_limite int DEFAULT 1000)
  RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_cabinet uuid := app_cabinet_id();
    v_n int;
  BEGIN
    IF v_cabinet IS NULL OR p_maintenant IS NULL OR p_jours IS NULL OR p_limite IS NULL
       OR p_jours NOT BETWEEN 30 AND 3650 OR p_limite NOT BETWEEN 1 AND 10000 THEN
      RAISE EXCEPTION 'Paramètres de la purge du copilote invalides.';
    END IF;
    IF p_maintenant > clock_timestamp() + interval '1 minute' THEN
      RAISE EXCEPTION 'Date de la purge du copilote dans le futur.';
    END IF;
    UPDATE copilote_actions
      SET statut = 'expiree', decide_le = expire_le
      WHERE id IN (
        SELECT x.id FROM copilote_actions x
        WHERE x.cabinet_id = v_cabinet AND x.statut = 'proposee' AND x.expire_le <= p_maintenant
        ORDER BY x.expire_le, x.id LIMIT p_limite)
        AND cabinet_id = v_cabinet AND statut = 'proposee';
    UPDATE copilote_actions
      SET parametres = '{}'::jsonb,
          resume = 'Proposition anonymisée (durée de conservation écoulée).',
          empreinte = repeat('0', 64),
          anonymise_le = p_maintenant
      WHERE id IN (
        SELECT x.id FROM copilote_actions x
        WHERE x.cabinet_id = v_cabinet AND x.anonymise_le IS NULL AND x.statut <> 'proposee'
          AND x.decide_le < p_maintenant - make_interval(days => p_jours)
        ORDER BY x.decide_le, x.id LIMIT p_limite)
        AND cabinet_id = v_cabinet AND anonymise_le IS NULL AND statut <> 'proposee';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END $$;

-- Un job par cabinet ayant une proposition échue ou à anonymiser (hors contexte de cabinet).
CREATE FUNCTION planifier_purge_copilote(p_cle text, p_execute_a timestamptz,
                                         p_maintenant timestamptz, p_jours int)
  RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_n int;
  BEGIN
    IF p_cle !~ '^copilote_purge:[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'Clé de purge du copilote invalide.';
    END IF;
    IF p_maintenant IS NULL OR p_execute_a IS NULL OR p_jours IS NULL
       OR p_jours NOT BETWEEN 30 AND 3650 THEN
      RAISE EXCEPTION 'Paramètres de planification de la purge du copilote invalides.';
    END IF;
    INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle)
      SELECT c.id, 'copilote_purge', '{}'::jsonb, p_execute_a, p_cle
      FROM cabinets c
      WHERE EXISTS (
        SELECT 1 FROM copilote_actions a
        WHERE a.cabinet_id = c.id
          AND ((a.statut = 'proposee' AND a.expire_le <= p_maintenant)
            OR (a.statut <> 'proposee' AND a.anonymise_le IS NULL
                AND a.decide_le < p_maintenant - make_interval(days => p_jours))))
      ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END $$;

REVOKE ALL ON FUNCTION anonymiser_copilote_actions(timestamptz, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION planifier_purge_copilote(text, timestamptz, timestamptz, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION anonymiser_copilote_actions(timestamptz, int, int) TO missionpilot_app;
GRANT EXECUTE ON FUNCTION planifier_purge_copilote(text, timestamptz, timestamptz, int)
  TO missionpilot_app;
