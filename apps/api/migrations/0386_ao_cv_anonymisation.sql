-- Banque de CV (AO-04, lot AO-B) : anonymisation d'un CV (départ d'une personne, droit à
-- l'effacement). 0380 rend `ao_cv` et `ao_cv_versions` en ajout seul SANS moyen d'effacer : le
-- parcours d'une personne (employeurs, diplômes, nationalité) resterait lisible indéfiniment.
--
-- - `anonymise_le` (ao_cv et ao_cv_versions) : instant de l'anonymisation, une seule fois.
-- - L'anonymisation remplace le NOM du CV (« CV anonymisé »), détache le collaborateur et
--   remplace le CONTENU de chaque version par un contenu vide valide (titre « CV anonymisé »,
--   aucune expérience, diplôme, langue, secteur ni compétence), le motif des versions
--   suivantes par « Anonymisation ». Tout le reste (numéro, versions, dates, auteurs) est
--   conservé : la trace d'audit survit, pas les données personnelles.
-- - Les déclencheurs « ajout seul » n'admettent QUE cette anonymisation (jamais un UPDATE libre,
--   jamais un DELETE) ; le rôle applicatif n'a toujours aucun droit UPDATE/DELETE : elle passe
--   par la fonction SECURITY DEFINER `anonymiser_cv_ao`, bornée au cabinet du contexte.
-- - Une version ne s'ajoute plus à un CV anonymisé (MPW06).
-- Modèle : 0104_ia_conservation.sql. SQLSTATE du lot : MPW06 (CV inconnu, déjà anonymisé ou
-- anonymisé : plus de version).
-- Limite connue : le texte d'une offre technique déjà rédigée (section « organisation ») peut
-- citer le nom d'un expert ; ces versions sont en ajout seul et ne sont pas réécrites ici.

ALTER TABLE ao_cv ADD COLUMN anonymise_le timestamptz;
ALTER TABLE ao_cv_versions ADD COLUMN anonymise_le timestamptz;

DROP TRIGGER ao_cv_ajout_seul ON ao_cv;
DROP TRIGGER ao_cv_versions_ajout_seul ON ao_cv_versions;

CREATE FUNCTION ao_cv_ajout_seul() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'UPDATE'
       AND OLD.anonymise_le IS NULL
       AND NEW.anonymise_le IS NOT NULL
       AND NEW.nom = 'CV anonymisé'
       AND NEW.collaborateur_id IS NULL
       AND (to_jsonb(NEW) - 'nom' - 'collaborateur_id' - 'anonymise_le')
           = (to_jsonb(OLD) - 'nom' - 'collaborateur_id' - 'anonymise_le') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Banques et offres des appels d''offres en ajout seul : créer une nouvelle version.'
      USING ERRCODE = 'MPW01';
  END $$;
CREATE TRIGGER ao_cv_ajout_seul BEFORE UPDATE OR DELETE ON ao_cv
  FOR EACH ROW EXECUTE FUNCTION ao_cv_ajout_seul();

CREATE FUNCTION ao_cv_versions_ajout_seul() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'UPDATE'
       AND OLD.anonymise_le IS NULL
       AND NEW.anonymise_le IS NOT NULL
       AND NEW.titre = 'CV anonymisé'
       AND NEW.contenu = '{"titre":"CV anonymisé","secteurs":[],"competences":[],"experiences":[],"diplomes":[],"langues":[]}'::jsonb
       AND NEW.secteurs = '{}'
       AND NEW.langues = '{}'
       AND NEW.motif IS NOT DISTINCT FROM (CASE WHEN OLD.version = 1 THEN NULL ELSE 'Anonymisation' END)
       AND (to_jsonb(NEW) - 'contenu' - 'titre' - 'secteurs' - 'langues' - 'motif' - 'anonymise_le')
           = (to_jsonb(OLD) - 'contenu' - 'titre' - 'secteurs' - 'langues' - 'motif' - 'anonymise_le') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Banques et offres des appels d''offres en ajout seul : créer une nouvelle version.'
      USING ERRCODE = 'MPW01';
  END $$;
CREATE TRIGGER ao_cv_versions_ajout_seul BEFORE UPDATE OR DELETE ON ao_cv_versions
  FOR EACH ROW EXECUTE FUNCTION ao_cv_versions_ajout_seul();

-- Pas de nouvelle version sur un CV anonymisé (MPW06).
CREATE FUNCTION refuser_version_cv_anonymise() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM ao_cv c WHERE c.id = NEW.cv_id AND c.anonymise_le IS NOT NULL) THEN
      RAISE EXCEPTION 'Ce CV est anonymisé : aucune nouvelle version.' USING ERRCODE = 'MPW06';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER ao_cv_versions_sans_anonymise BEFORE INSERT ON ao_cv_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_version_cv_anonymise();

-- Anonymise un CV du cabinet du contexte et toutes ses versions ; renvoie le nombre de versions
-- anonymisées. CV inconnu de ce cabinet ou déjà anonymisé : MPW06.
CREATE FUNCTION anonymiser_cv_ao(p_cv uuid) RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_cabinet uuid := app_cabinet_id();
    v_n int;
  BEGIN
    IF v_cabinet IS NULL OR p_cv IS NULL OR app_portail_client_id() IS NOT NULL THEN
      RAISE EXCEPTION 'Paramètres de l''anonymisation du CV invalides.';
    END IF;
    UPDATE ao_cv
      SET nom = 'CV anonymisé', collaborateur_id = NULL, anonymise_le = now()
      WHERE id = p_cv AND cabinet_id = v_cabinet AND anonymise_le IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CV inconnu ou déjà anonymisé.' USING ERRCODE = 'MPW06';
    END IF;
    UPDATE ao_cv_versions
      SET contenu = '{"titre":"CV anonymisé","secteurs":[],"competences":[],"experiences":[],"diplomes":[],"langues":[]}'::jsonb,
          titre = 'CV anonymisé', secteurs = '{}', langues = '{}',
          motif = CASE WHEN version = 1 THEN NULL ELSE 'Anonymisation' END,
          anonymise_le = now()
      WHERE cv_id = p_cv AND cabinet_id = v_cabinet AND anonymise_le IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END $$;

REVOKE ALL ON FUNCTION anonymiser_cv_ao(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION anonymiser_cv_ao(uuid) TO missionpilot_app;
