-- Reprise des relances de questionnaires restées en échec (DECISIONS.md, V2).
--
-- Tant que le handler « relance_questionnaire » n'était pas inscrit dans
-- REGISTRE_JOBS (jobs/registre.ts), le worker passait ces jobs directement en
-- « echec » avec l'erreur « Type de job inconnu : relance_questionnaire »
-- (ErreurJobDefinitive, sans nouvelle tentative) : aucune relance J+3 / J+7
-- n'était envoyée.
--
-- `reprendre_relances_questionnaire()` remet en attente ces SEULS jobs (type
-- ET message d'erreur exacts), compteur de tentatives remis à zéro,
-- exécutables tout de suite. Le handler reste sûr pour une relance tardive :
-- il ne relance que si l'envoi est toujours « envoyé », relances
-- automatiques actives, et seulement les répondants qui n'ont pas soumis ;
-- l'index unique (répondant, palier) de 0142 empêche tout doublon. Un job en
-- échec pour une autre raison (charge invalide, panne répétée) n'est PAS
-- repris : il relève d'une analyse.
--
-- Pas SECURITY DEFINER et aucun GRANT : seul le rôle propriétaire (celui des
-- migrations) l'exécute ; le rôle applicatif ne peut pas l'appeler.
--
-- Appel unique ci-dessous, à l'application de la migration. Pour rejouer la
-- reprise (par exemple si un ancien worker tournait encore pendant le
-- déploiement et a de nouveau mis des relances en échec), avec le rôle
-- propriétaire (DATABASE_OWNER_URL), après le déploiement du registre corrigé :
--
--   SELECT reprendre_relances_questionnaire();   -- renvoie le nombre de jobs repris

CREATE FUNCTION reprendre_relances_questionnaire() RETURNS int
  LANGUAGE plpgsql SET search_path = public, pg_temp
  AS $$
  DECLARE v_n int;
  BEGIN
    UPDATE jobs SET statut = 'en_attente', tentatives = 0, erreur = NULL, verrouille_le = NULL,
                    execute_a = now()
      WHERE type = 'relance_questionnaire' AND statut = 'echec'
        AND erreur = 'Type de job inconnu : relance_questionnaire';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END $$;
REVOKE ALL ON FUNCTION reprendre_relances_questionnaire() FROM PUBLIC;

SELECT reprendre_relances_questionnaire();
