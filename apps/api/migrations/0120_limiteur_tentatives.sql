-- Limiteur de tentatives d'authentification PERSISTANT et PARTAGÉ entre
-- instances (SOC-02 ; dette SECURITY.md §15 « limiteurs en mémoire »).
--
-- Une ligne par (espace, clé) : `espace` distingue les limiteurs (connexion,
-- mot de passe redemandé, second facteur), `cle` est l'empreinte HMAC-SHA-256
-- de l'e-mail normalisé, calculée par l'API avec une clé dérivée de
-- TFA_MASTER_KEY (auth/limiteur.ts) : une fuite de la base seule ne permet pas
-- de retrouver ni de tester une adresse. Jamais l'adresse IP : celle que voit
-- l'API est celle du relais web, et X-Forwarded-For est falsifiable. L'e-mail
-- en clair n'est pas stocké.
--
-- Règles PAR ESPACE (`tentatives_auth_regles`), jamais fournies par l'appelant :
-- plafond, fenêtre et capacité sont des constantes de cette migration.
--
-- Fenêtre GLISSANTE : `instants` garde l'horodatage des tentatives réservées
-- dans la fenêtre (au plus le plafond) ; une tentative est refusée si le
-- plafond est atteint dans la fenêtre qui précède. `expire_le` est le moment où
-- la ligne ne porte plus aucune tentative utile (dernière tentative + fenêtre).
--
-- Atomicité : la ligne est verrouillée (FOR UPDATE) avant lecture et mise à
-- jour ; une nouvelle clé est créée par INSERT … ON CONFLICT DO NOTHING puis
-- relue sous verrou. N réservations simultanées ne dépassent donc jamais le
-- plafond.
--
-- Taille bornée (constat F4, puis audit du limiteur persistant, mineurs 1-2) :
-- capacité de 1 000 000 de clés par espace. À la création d'une clé, jusqu'à
-- 100 lignes expirées de l'espace sont purgées ; la taille de la table est
-- ESTIMÉE sans la parcourir (densité de la dernière analyse × pages actuelles,
-- méthode du planificateur) et l'espace n'est compté exactement que si
-- l'estimation approche la capacité (≥ 90 %), si la table n'a pas encore de
-- statistiques, ou si la capacité est petite (≤ 10 000 : comptage borné). Si
-- l'espace est plein, la ligne ÉVINÇABLE la plus ancienne est évincée ; une
-- ligne qui porte au moins 50 % du plafond dans la fenêtre (cible d'une attaque
-- en cours) ne l'est JAMAIS : si toutes le sont, la nouvelle clé est refusée.
-- Les lignes verrouillées par une autre transaction sont ignorées (SKIP
-- LOCKED) ; l'estimation peut retarder l'éviction d'un écart borné par la
-- fraîcheur des statistiques (analyse automatique).
--
-- Horloge : celle de la base (commune à toutes les instances). Le réglage de
-- transaction `app.horloge_test` (horodatage) la remplace SEULEMENT dans une
-- base dont le nom finit par « _test » : le rôle applicatif peut poser ce
-- réglage (paramètre libre de PostgreSQL), mais il est ignoré en production.
-- Il n'y donnerait d'ailleurs aucun pouvoir de plus que liberer_tentatives_auth.
--
-- Accès : le rôle applicatif n'a AUCUN droit sur la table (RLS activée sans
-- politique, privilèges retirés) ; il passe par trois fonctions SECURITY
-- DEFINER étroites, à search_path fixe, qui valident leurs paramètres
-- (`reserver_tentative_auth`, `liberer_tentatives_auth`,
-- `debloquer_tentatives_auth`). La mécanique paramétrée
-- (`tentative_auth_reserver`, `tentatives_auth_faire_place`) et l'horloge ne
-- lui sont pas accessibles ; les tests l'appellent avec le rôle propriétaire.

CREATE TABLE tentatives_auth (
  espace text NOT NULL CHECK (espace ~ '^[a-z_]{1,40}$'),
  cle text NOT NULL CHECK (cle ~ '^[0-9a-f]{64}$'),
  instants timestamptz[] NOT NULL CHECK (cardinality(instants) <= 1000),
  expire_le timestamptz NOT NULL,
  PRIMARY KEY (espace, cle)
);
CREATE INDEX tentatives_auth_expiration ON tentatives_auth (espace, expire_le);

ALTER TABLE tentatives_auth ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tentatives_auth FROM missionpilot_app;
REVOKE ALL ON tentatives_auth FROM PUBLIC;

-- Règles de chaque espace : plafond, fenêtre glissante, capacité.
CREATE FUNCTION tentatives_auth_regles(
  p_espace text, OUT p_max int, OUT p_fenetre interval, OUT p_capacite int
) LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
  AS $$
  BEGIN
    CASE p_espace
      WHEN 'connexion' THEN -- mot de passe à la connexion (routes/auth.ts)
        p_max := 10; p_fenetre := interval '15 minutes'; p_capacite := 1000000;
      WHEN 'reauth' THEN -- mot de passe redemandé (auth/confirmer-identite.ts)
        p_max := 10; p_fenetre := interval '15 minutes'; p_capacite := 1000000;
      WHEN 'facteur' THEN -- tout code de second facteur (connexion, activation, confirmations)
        p_max := 10; p_fenetre := interval '15 minutes'; p_capacite := 1000000;
      ELSE
        RAISE EXCEPTION 'Espace du limiteur de tentatives inconnu.';
    END CASE;
  END $$;

-- Horloge du limiteur (voir l'en-tête : réglage de test honoré dans une base « _test » seulement).
CREATE FUNCTION horloge_tentatives_auth() RETURNS timestamptz
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_test text := nullif(current_setting('app.horloge_test', true), '');
  BEGIN
    IF v_test IS NOT NULL AND current_database() LIKE '%\_test' THEN
      RETURN v_test::timestamptz;
    END IF;
    RETURN clock_timestamp();
  END $$;

-- Fait place à une nouvelle clé (voir l'en-tête) ; faux si l'espace est plein
-- de lignes protégées (au moins 50 % du plafond dans la fenêtre).
CREATE FUNCTION tentatives_auth_faire_place(
  p_espace text, p_max int, p_fenetre interval, p_capacite int, p_maintenant timestamptz
) RETURNS boolean
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_estime float8;
    v_n bigint;
  BEGIN
    DELETE FROM tentatives_auth t WHERE t.ctid IN (
      SELECT x.ctid FROM tentatives_auth x
      WHERE x.espace = p_espace AND x.expire_le <= p_maintenant
      LIMIT 100 FOR UPDATE SKIP LOCKED);
    IF p_capacite > 10000 THEN
      -- Estimation de toute la table (majorant de l'espace), sans parcours.
      SELECT CASE WHEN c.relpages > 0 AND c.reltuples >= 0
                  THEN c.reltuples / c.relpages
                       * (pg_relation_size(c.oid) / current_setting('block_size')::float8)
             END INTO v_estime
        FROM pg_class c WHERE c.oid = 'tentatives_auth'::regclass;
      IF v_estime IS NOT NULL AND v_estime < p_capacite * 0.9 THEN
        RETURN true;
      END IF;
    END IF;
    SELECT count(*) INTO v_n FROM tentatives_auth t WHERE t.espace = p_espace;
    IF v_n < p_capacite THEN
      RETURN true;
    END IF;
    -- Éviction de la ligne évinçable la plus ancienne ; jamais une ligne à ≥ 50 % du plafond.
    DELETE FROM tentatives_auth t WHERE t.ctid IN (
      SELECT x.ctid FROM tentatives_auth x
      WHERE x.espace = p_espace
        AND 2 * (SELECT count(*) FROM unnest(x.instants) i WHERE i > p_maintenant - p_fenetre)
            < p_max
      ORDER BY x.expire_le
      LIMIT 1 FOR UPDATE SKIP LOCKED);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n > 0;
  END $$;

-- Mécanique paramétrée de la réservation (rôle propriétaire seulement).
CREATE FUNCTION tentative_auth_reserver(
  p_espace text, p_cle text, p_max int, p_fenetre interval, p_capacite int
) RETURNS boolean
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_maintenant timestamptz := horloge_tentatives_auth();
    v_instants timestamptz[];
    v_n int;
  BEGIN
    IF p_espace IS NULL OR p_espace !~ '^[a-z_]{1,40}$' OR p_cle IS NULL
       OR p_cle !~ '^[0-9a-f]{64}$' OR p_max IS NULL OR p_max NOT BETWEEN 2 AND 1000
       OR p_fenetre IS NULL OR p_fenetre NOT BETWEEN interval '1 second' AND interval '1 day'
       OR p_capacite IS NULL OR p_capacite NOT BETWEEN 1 AND 10000000 THEN
      RAISE EXCEPTION 'Paramètres du limiteur de tentatives invalides.';
    END IF;

    SELECT t.instants INTO v_instants FROM tentatives_auth t
      WHERE t.espace = p_espace AND t.cle = p_cle FOR UPDATE;
    IF NOT FOUND THEN
      IF NOT tentatives_auth_faire_place(p_espace, p_max, p_fenetre, p_capacite, v_maintenant) THEN
        RETURN false;
      END IF;
      INSERT INTO tentatives_auth (espace, cle, instants, expire_le)
        VALUES (p_espace, p_cle, ARRAY[v_maintenant], v_maintenant + p_fenetre)
        ON CONFLICT (espace, cle) DO NOTHING;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n = 1 THEN
        RETURN true;
      END IF;
      -- Créée entre-temps par une requête simultanée : relue sous verrou.
      SELECT t.instants INTO v_instants FROM tentatives_auth t
        WHERE t.espace = p_espace AND t.cle = p_cle FOR UPDATE;
    END IF;

    -- Fenêtre glissante : seules les tentatives de la fenêtre qui précède comptent.
    SELECT coalesce(array_agg(i ORDER BY i), '{}') INTO v_instants
      FROM unnest(v_instants) i WHERE i > v_maintenant - p_fenetre;
    IF cardinality(v_instants) >= p_max THEN
      RETURN false;
    END IF;
    UPDATE tentatives_auth t
      SET instants = v_instants || v_maintenant,
          expire_le = greatest(t.expire_le, v_maintenant + p_fenetre)
      WHERE t.espace = p_espace AND t.cle = p_cle;
    RETURN true;
  END $$;

-- Réserve une tentative selon les règles de l'espace ; faux si le plafond de la
-- fenêtre est atteint ou si l'espace est plein de clés protégées.
CREATE FUNCTION reserver_tentative_auth(p_espace text, p_cle text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    r record;
  BEGIN
    IF p_cle IS NULL OR p_cle !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'Paramètres du limiteur de tentatives invalides.';
    END IF;
    SELECT * INTO r FROM tentatives_auth_regles(p_espace);
    RETURN tentative_auth_reserver(p_espace, p_cle, r.p_max, r.p_fenetre, r.p_capacite);
  END $$;

-- Efface le compteur d'une clé (authentification réussie).
CREATE FUNCTION liberer_tentatives_auth(p_espace text, p_cle text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF p_cle IS NULL OR p_cle !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'Paramètres du limiteur de tentatives invalides.';
    END IF;
    PERFORM tentatives_auth_regles(p_espace); -- espace connu, sinon exception
    DELETE FROM tentatives_auth WHERE espace = p_espace AND cle = p_cle;
  END $$;

-- Déblocage décidé par un gestionnaire du cabinet (routes/limiteur-admin.ts,
-- « cabinet.gerer », reconfirmation et journal) : efface le compteur de la clé ;
-- vrai si elle était BLOQUÉE (plafond atteint dans la fenêtre).
CREATE FUNCTION debloquer_tentatives_auth(p_espace text, p_cle text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    r record;
    v_instants timestamptz[];
  BEGIN
    IF p_cle IS NULL OR p_cle !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'Paramètres du limiteur de tentatives invalides.';
    END IF;
    SELECT * INTO r FROM tentatives_auth_regles(p_espace);
    DELETE FROM tentatives_auth t WHERE t.espace = p_espace AND t.cle = p_cle
      RETURNING t.instants INTO v_instants;
    RETURN v_instants IS NOT NULL
      AND (SELECT count(*) FROM unnest(v_instants) i
           WHERE i > horloge_tentatives_auth() - r.p_fenetre) >= r.p_max;
  END $$;

REVOKE ALL ON FUNCTION tentatives_auth_regles(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION horloge_tentatives_auth() FROM PUBLIC;
REVOKE ALL ON FUNCTION tentatives_auth_faire_place(text, int, interval, int, timestamptz)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION tentative_auth_reserver(text, text, int, interval, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION reserver_tentative_auth(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION liberer_tentatives_auth(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION debloquer_tentatives_auth(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserver_tentative_auth(text, text) TO missionpilot_app;
GRANT EXECUTE ON FUNCTION liberer_tentatives_auth(text, text) TO missionpilot_app;
GRANT EXECUTE ON FUNCTION debloquer_tentatives_auth(text, text) TO missionpilot_app;
