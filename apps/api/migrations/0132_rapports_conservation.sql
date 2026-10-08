-- Paramètres des rapports par cabinet : durée de conservation des rapports
-- générés et mention de la contribution de l'IA en pied de page.
--
-- CONSERVATION (reprend le « non traité » de 0130) : un rapport généré est
-- une COPIE datée de données qui restent en base (versions de notation, de
-- plan, temps validés…). Sur une mission EN COURS il peut être refait (les
-- données sont toujours là), mais PAS sur une mission clôturée : la génération
-- y est refusée (409), la purge d'un tel rapport est donc sans retour. C'est
-- pourquoi RACCOURCIR la durée exige la reconfirmation de l'identité
-- (rapports/parametres.ts). Son FICHIER est purgé
-- au-delà de la durée de conservation du cabinet, par le job
-- « purge_rapports » (rapports/purge.ts), planifié au plus une fois par jour
-- et par cabinet (clé `purge_rapports:AAAA-MM-JJ`), pour les seuls cabinets
-- qui ont un rapport à purger. La purge MARQUE le fichier supprimé
-- (`fichiers_suppressions`, motif « conservation ») puis efface l'objet du
-- stockage ; la ligne `rapports_mission` (ajout seul) reste comme trace, le
-- rapport disparaît des listes et son téléchargement répond 404.
-- Durée par défaut : 1 095 jours (3 ans), bornée de 90 à 3 650 jours.
-- VALEUR PAR DÉFAUT À VALIDER avec le conseil juridique avant le pilote
-- (DECISIONS.md, « Conservation » ; PRD complémentaire, « Conservation »).
--
-- MENTION IA (PRD complémentaire, décision 21.2) : au choix du cabinet, avec
-- une mention par défaut en pied de page des rapports (rapports/parametres.ts).
-- `mention_ia` NULL : texte par défaut ; `mention_ia_active` faux : aucune
-- mention.
--
-- Sans ligne pour un cabinet, les valeurs par défaut s'appliquent.

CREATE FUNCTION conservation_rapports_defaut() RETURNS int
  LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
  AS $$ SELECT 1095 $$;

CREATE TABLE rapports_parametres (
  cabinet_id uuid PRIMARY KEY REFERENCES cabinets (id) ON DELETE CASCADE,
  conservation_jours int NOT NULL DEFAULT conservation_rapports_defaut()
    CHECK (conservation_jours BETWEEN 90 AND 3650),
  mention_ia_active boolean NOT NULL DEFAULT true,
  mention_ia text CHECK (mention_ia IS NULL
    OR (length(btrim(mention_ia)) BETWEEN 1 AND 300 AND mention_ia !~ '[[:cntrl:]]')),
  modifie_par uuid NOT NULL,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE rapports_parametres ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON rapports_parametres
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
-- Portail client (0113) : table interne, invisible dans une transaction du portail.
CREATE POLICY portail_interdit ON rapports_parametres AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON rapports_parametres FROM missionpilot_app;

-- Nouveau motif de suppression d'un fichier : fin de conservation d'un rapport.
ALTER TABLE fichiers_suppressions
  DROP CONSTRAINT fichiers_suppressions_motif_check,
  ADD CONSTRAINT fichiers_suppressions_motif_check
    CHECK (motif IN ('orphelin', 'retire', 'conservation'));

-- Recherche des rapports anciens d'un cabinet (planification et purge).
CREATE INDEX rapports_mission_genere_idx ON rapports_mission (cabinet_id, genere_le);

-- Rapports à purger : fichier non supprimé, généré avant `p_maintenant` moins
-- la durée de conservation du cabinet.
CREATE FUNCTION planifier_purge_rapports(p_cle text, p_execute_a timestamptz,
                                         p_maintenant timestamptz)
  RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_n int;
  BEGIN
    IF p_cle !~ '^purge_rapports:[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'Clé de purge invalide.';
    END IF;
    IF p_maintenant IS NULL OR p_execute_a IS NULL THEN
      RAISE EXCEPTION 'Dates de purge obligatoires.';
    END IF;
    INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle)
      SELECT c.id, 'purge_rapports', '{}'::jsonb, p_execute_a, p_cle
      FROM cabinets c
      WHERE EXISTS (
        SELECT 1 FROM rapports_mission r
        WHERE r.cabinet_id = c.id
          AND r.genere_le < p_maintenant - make_interval(days => coalesce(
            (SELECT p.conservation_jours FROM rapports_parametres p WHERE p.cabinet_id = c.id),
            conservation_rapports_defaut()))
          AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = r.fichier_id))
      ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END $$;
REVOKE ALL ON FUNCTION planifier_purge_rapports(text, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION planifier_purge_rapports(text, timestamptz, timestamptz)
  TO missionpilot_app;
