-- Observatoire (CAP-04) : seul chemin inter-cabinets, la fonction `obs_agregats`.
--
-- SECURITY DEFINER (lit les contributions de TOUS les cabinets adhérents, hors RLS), search_path
-- figé, EXECUTE retiré à PUBLIC et accordé au seul rôle applicatif. Elle :
-- - refuse hors contexte de cabinet et dans une transaction du portail (MQK24), un indicateur
--   inconnu (MQK26), un cabinet appelant sans adhésion active (MQK25) ET un cabinet adhérent qui
--   n'a aucune contribution ÉLIGIBLE (MQK27) : l'accès est réservé aux CONTRIBUTEURS (PRD
--   complémentaire §21 décision n° 1). Éligible = même règle que les agrégats : indicateur
--   demandé, mois civil clos, versée depuis la dernière adhésion ;
-- - ne retient que les cabinets dont l'adhésion est active À L'INSTANT de l'appel (un retrait
--   exclut aussitôt), et pour chacun son dernier versement d'un mois antérieur au mois courant
--   (gel mensuel, 0471) ET postérieur à sa dernière adhésion : une ré-adhésion ne réactive pas
--   d'anciennes contributions (un cabinet qui alterne retrait et adhésion ne fait pas osciller
--   les agrégats : il doit verser à nouveau, et ce versement n'apparaît qu'au mois suivant) ;
-- - ne renvoie QUE des agrégats par case (secteur × taille) : effectif d'entreprises, effectif de
--   cabinets, somme, histogramme par tranches de 10 points ; jamais une ligne, jamais un
--   identifiant ;
-- - applique déjà les seuils d'anonymat, calculés HORS DU CABINET APPELANT (règle de dominance,
--   décision de l'utilisateur) : une case n'est renvoyée que si elle compte au moins 5 entreprises
--   issues d'au moins 3 cabinets AUTRES que l'appelant. Un cabinet ne peut donc pas, en retranchant
--   ses propres données, isoler un résultat porté par moins de 3 autres cabinets. Une case sous
--   seuil n'est PAS renvoyée du tout (ni valeur ni existence). Les colonnes `*_autres` donnent ces
--   effectifs hors appelant ; le moteur (`packages/engines/src/capitalisation/observatoire.ts`)
--   re-vérifie les mêmes seuils sur elles.

CREATE FUNCTION obs_agregats(p_indicateur text)
  RETURNS TABLE (
    secteur text,
    taille text,
    effectif_entreprises integer,
    effectif_cabinets integer,
    effectif_entreprises_autres integer,
    effectif_cabinets_autres integer,
    somme numeric,
    histogramme integer[]
  )
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  #variable_conflict use_column
  DECLARE
    v_cabinet uuid := app_cabinet_id();
  BEGIN
    IF v_cabinet IS NULL OR app_portail_client_id() IS NOT NULL THEN
      RAISE EXCEPTION 'Observatoire : contexte de cabinet requis.' USING ERRCODE = 'MQK24';
    END IF;
    IF p_indicateur IS NULL OR p_indicateur NOT IN ('notation_score_global') THEN
      RAISE EXCEPTION 'Observatoire : indicateur inconnu.' USING ERRCODE = 'MQK26';
    END IF;
    IF NOT obs_adhesion_active(v_cabinet) THEN
      RAISE EXCEPTION 'Observatoire réservé aux cabinets adhérents.' USING ERRCODE = 'MQK25';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM obs_contributions c
       WHERE c.cabinet_id = v_cabinet AND c.indicateur = p_indicateur
         AND c.periode < obs_periode_courante()
         AND c.verse_le >= (SELECT e.le FROM obs_adhesion_evenements e
                             WHERE e.cabinet_id = v_cabinet AND e.action = 'adhesion'
                             ORDER BY e.rang DESC LIMIT 1)
    ) THEN
      RAISE EXCEPTION 'Observatoire réservé aux cabinets contributeurs.' USING ERRCODE = 'MQK27';
    END IF;
    RETURN QUERY
    WITH derniers AS (
      SELECT DISTINCT ON (e.cabinet_id) e.cabinet_id, e.action, e.le
        FROM obs_adhesion_evenements e
       ORDER BY e.cabinet_id, e.rang DESC
    ), eligibles AS (
      SELECT c.cabinet_id, c.periode, c.secteur, c.taille, c.valeur
        FROM obs_contributions c
        JOIN derniers d ON d.cabinet_id = c.cabinet_id AND d.action = 'adhesion'
       WHERE c.indicateur = p_indicateur
         AND c.periode < obs_periode_courante()
         AND c.verse_le >= d.le
    ), instantanes AS (
      SELECT g.cabinet_id, max(g.periode) AS periode
        FROM eligibles g
       GROUP BY g.cabinet_id
    ), retenues AS (
      SELECT g.secteur, g.taille, g.cabinet_id, g.valeur,
             least(floor(g.valeur / 10)::integer, 9) AS tranche
        FROM eligibles g
        JOIN instantanes i ON i.cabinet_id = g.cabinet_id AND i.periode = g.periode
    ), cases AS (
      SELECT r.secteur, r.taille,
             count(*)::integer AS n,
             count(DISTINCT r.cabinet_id)::integer AS k,
             (count(*) FILTER (WHERE r.cabinet_id <> v_cabinet))::integer AS n_autres,
             (count(DISTINCT r.cabinet_id) FILTER (WHERE r.cabinet_id <> v_cabinet))::integer AS k_autres,
             sum(r.valeur) AS s,
             ARRAY[
               count(*) FILTER (WHERE r.tranche = 0), count(*) FILTER (WHERE r.tranche = 1),
               count(*) FILTER (WHERE r.tranche = 2), count(*) FILTER (WHERE r.tranche = 3),
               count(*) FILTER (WHERE r.tranche = 4), count(*) FILTER (WHERE r.tranche = 5),
               count(*) FILTER (WHERE r.tranche = 6), count(*) FILTER (WHERE r.tranche = 7),
               count(*) FILTER (WHERE r.tranche = 8), count(*) FILTER (WHERE r.tranche = 9)
             ]::integer[] AS h
        FROM retenues r
       GROUP BY r.secteur, r.taille
    )
    SELECT x.secteur, x.taille, x.n, x.k, x.n_autres, x.k_autres, x.s, x.h
      FROM cases x
     WHERE x.n_autres >= 5 AND x.k_autres >= 3
     ORDER BY x.secteur, x.taille;
  END $$;
REVOKE ALL ON FUNCTION obs_agregats(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION obs_agregats(text) TO missionpilot_app;
