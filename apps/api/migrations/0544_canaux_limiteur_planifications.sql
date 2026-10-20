-- Canaux simulés (lot 3c, SPEC-3c §6.9) : espaces du limiteur persistant du webhook et
-- planifications récurrentes (fonctions SECURITY DEFINER étroites, modèle 0304).
--
-- Limiteur (0120) : deux espaces de plus, règles fixées EN BASE (l'appelant ne fournit ni plafond
-- ni fenêtre ni capacité) :
-- - `webhook_canal` : 600 requêtes par minute et par compte (une clé par compte, 100 000 clés) ;
-- - `webhook_invalide` : 30 signatures invalides par 5 minutes (clé unique globale, 10 clés).
-- La fonction reprend À L'IDENTIQUE les trois espaces existants.

CREATE OR REPLACE FUNCTION tentatives_auth_regles(
  p_espace text, OUT p_max int, OUT p_fenetre interval, OUT p_capacite int
) RETURNS record
  LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
  AS $$
  BEGIN
    CASE p_espace
      WHEN 'connexion' THEN -- mot de passe à la connexion (routes/auth.ts)
        p_max := 10; p_fenetre := interval '15 minutes'; p_capacite := 1000000;
      WHEN 'reauth' THEN -- mot de passe redemandé (auth/confirmer-identite.ts)
        p_max := 10; p_fenetre := interval '15 minutes'; p_capacite := 1000000;
      WHEN 'facteur' THEN -- tout code de second facteur (connexion, activation, confirmations)
        p_max := 10; p_fenetre := interval '15 minutes'; p_capacite := 1000000;
      WHEN 'webhook_canal' THEN -- requêtes du webhook entrant, par compte (canaux/webhook.ts)
        p_max := 600; p_fenetre := interval '1 minute'; p_capacite := 100000;
      WHEN 'webhook_invalide' THEN -- signatures invalides du webhook (clé unique globale)
        p_max := 30; p_fenetre := interval '5 minutes'; p_capacite := 10;
      ELSE
        RAISE EXCEPTION 'Espace du limiteur de tentatives inconnu.';
    END CASE;
  END $$;

-- Synthèse hebdomadaire du dirigeant (CLI-07) : une tâche par cabinet et par semaine (clé
-- `synthese_hebdo:AAAA-MM-JJ`, date d'un LUNDI), pour les seuls cabinets qui ont un compte
-- WhatsApp actif avec l'option « synthèse hebdomadaire ». Fonction STRICTE : aucun paramètre nul,
-- clé cohérente avec la date, heure d'exécution dans la fenêtre de la semaine visée (de la
-- veille à J+2), de sorte qu'un appel ne puisse ni occuper à l'avance la clé d'une semaine
-- lointaine ni différer indéfiniment une tâche.
CREATE FUNCTION planifier_synthese_hebdo(p_cle text, p_execute_a timestamptz, p_semaine date)
  RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_n int;
  BEGIN
    IF p_cle IS NULL OR p_execute_a IS NULL OR p_semaine IS NULL THEN
      RAISE EXCEPTION 'Planification de la synthèse hebdomadaire : paramètres obligatoires.';
    END IF;
    IF p_cle !~ '^synthese_hebdo:[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR right(p_cle, 10) <> p_semaine::text
       OR extract(isodow FROM p_semaine) <> 1 THEN
      RAISE EXCEPTION 'Clé de la synthèse hebdomadaire invalide (date d''un lundi attendue).';
    END IF;
    IF p_execute_a < (p_semaine::timestamp AT TIME ZONE 'UTC') - interval '1 day'
       OR p_execute_a > (p_semaine::timestamp AT TIME ZONE 'UTC') + interval '2 days' THEN
      RAISE EXCEPTION 'Heure d''exécution de la synthèse hebdomadaire hors de la semaine visée.';
    END IF;
    INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle, tentatives_max)
      SELECT c.id, 'canal_synthese_hebdo', jsonb_build_object('semaine', p_semaine), p_execute_a,
             p_cle, 3
      FROM cabinets c
      WHERE EXISTS (SELECT 1 FROM canaux_comptes k
                    WHERE k.cabinet_id = c.id AND k.canal = 'whatsapp' AND k.actif
                      AND k.synthese_hebdo)
      ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END $$;

-- Maintenance quotidienne des canaux (SPEC-3c §7.8) : une tâche par cabinet et par jour (clé
-- `canaux_maintenance:AAAA-MM-JJ`), pour les cabinets qui ont un compte de canal, une
-- transcription ou une demande de signature ouverte. Mêmes garde-fous que ci-dessus.
CREATE FUNCTION planifier_canaux_maintenance(p_cle text, p_execute_a timestamptz, p_jour date)
  RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_n int;
  BEGIN
    IF p_cle IS NULL OR p_execute_a IS NULL OR p_jour IS NULL THEN
      RAISE EXCEPTION 'Planification de la maintenance des canaux : paramètres obligatoires.';
    END IF;
    IF p_cle !~ '^canaux_maintenance:[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR right(p_cle, 10) <> p_jour::text THEN
      RAISE EXCEPTION 'Clé de la maintenance des canaux invalide.';
    END IF;
    IF p_execute_a < (p_jour::timestamp AT TIME ZONE 'UTC') - interval '1 day'
       OR p_execute_a > (p_jour::timestamp AT TIME ZONE 'UTC') + interval '2 days' THEN
      RAISE EXCEPTION 'Heure d''exécution de la maintenance des canaux hors de la journée visée.';
    END IF;
    INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle, tentatives_max)
      SELECT c.id, 'canaux_maintenance', jsonb_build_object('jour', p_jour), p_execute_a, p_cle, 3
      FROM cabinets c
      WHERE EXISTS (SELECT 1 FROM canaux_comptes k WHERE k.cabinet_id = c.id)
         OR EXISTS (SELECT 1 FROM transcriptions t WHERE t.cabinet_id = c.id)
         OR EXISTS (SELECT 1 FROM signatures_demandes s
                    WHERE s.cabinet_id = c.id AND s.statut IN ('brouillon', 'envoyee', 'partielle'))
      ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END $$;

REVOKE ALL ON FUNCTION planifier_synthese_hebdo(text, timestamptz, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION planifier_canaux_maintenance(text, timestamptz, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION planifier_synthese_hebdo(text, timestamptz, date) TO missionpilot_app;
GRANT EXECUTE ON FUNCTION planifier_canaux_maintenance(text, timestamptz, date) TO missionpilot_app;
