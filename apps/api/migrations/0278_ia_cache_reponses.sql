-- AGT-06 : cache des réponses IA, alertes du plafond de coût par mission.
--
-- - ia_parametres_cabinet.cache_actif : cache des réponses du modèle, DÉSACTIVÉ par défaut
--   (hypothèse prudente) ; le cabinet l'active par PUT /api/ia/parametres. Le désactiver vide
--   immédiatement le cache du cabinet (route).
-- - ia_cache_reponses : réponse BRUTE du modèle (texte encore MASQUÉ : jetons « [PERSONNE_1] »…,
--   jamais le texte démasqué), CHIFFRÉE (AES-256-GCM, trousseau applicatif, AAD liée au cabinet et
--   à la clé de cache : un chiffré recopié sur une autre ligne ne se déchiffre pas). La clé de
--   cache est une empreinte HMAC-SHA-256 (clé dérivée du serveur : une fuite de la base seule ne
--   permet pas de la recalculer) du prompt versionné (nom, version, contenu), du modèle et des
--   entrées masquées canonisées (ia/cache.ts). Durée de vie bornée : 24 heures au plus (CHECK) ;
--   une entrée échue n'est jamais servie, puis est supprimée (à l'écriture suivante du cabinet et
--   par le job « ia_conservation », planifié aussi pour les cabinets ayant une entrée échue).
--   Isolée par cabinet (RLS) et fermée au portail client. Jamais modifiée (ni UPDATE) : écrite,
--   lue, supprimée. Le déclencheur refuse une écriture quand le cache du cabinet est désactivé
--   (MQI01) : défense en profondeur, la route et l'orchestrateur le vérifient déjà.
-- - ia_consommations.issue « cache » : génération servie par le cache, inscrite à coût NUL
--   (aucun appel au fournisseur, plafonds non consommés), pour la traçabilité.
-- - ia_alertes_plafond_mission : alerte du plafond de coût d'une mission déjà envoyée (80 %,
--   100 %) pour une valeur de plafond donnée : une seule notification par seuil, réarmée quand le
--   plafond change (agents/plafonds.ts).
-- - planifier_conservation_ia : redéfinie pour planifier aussi le job des cabinets ayant une
--   entrée de cache échue (même clé, même job, même garde de format).

ALTER TABLE ia_parametres_cabinet ADD COLUMN cache_actif boolean NOT NULL DEFAULT false;

CREATE TABLE ia_cache_reponses (
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  cle text NOT NULL CHECK (cle ~ '^[0-9a-f]{64}$'),
  -- Traçabilité sans contenu : prompt versionné, tâche, modèle.
  prompt_nom text NOT NULL CHECK (prompt_nom ~ '^[a-z][a-z0-9_]{0,59}$'),
  prompt_version int NOT NULL CHECK (prompt_version >= 1),
  tache text NOT NULL CHECK (tache IN ('redaction', 'analyse', 'extraction', 'classification')),
  modele text NOT NULL
    CHECK (modele ~ '^[a-z0-9][a-z0-9._-]{0,63}/[a-z0-9][a-z0-9._-]{0,99}(:[a-z0-9._-]{1,30})?$'),
  reponse_chiffree bytea NOT NULL
    CHECK (octet_length(reponse_chiffree) BETWEEN 29 AND 1048576),
  cle_version smallint NOT NULL,
  cree_le timestamptz NOT NULL,
  expire_le timestamptz NOT NULL,
  CHECK (expire_le > cree_le AND expire_le <= cree_le + interval '24 hours'),
  PRIMARY KEY (cabinet_id, cle)
);
CREATE INDEX ia_cache_reponses_expiration_idx ON ia_cache_reponses (cabinet_id, expire_le);
ALTER TABLE ia_cache_reponses ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ia_cache_reponses
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON ia_cache_reponses AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE ON ia_cache_reponses FROM missionpilot_app;

-- FOR SHARE : une désactivation concurrente (UPDATE puis vidage, PUT /api/ia/parametres) attend
-- la fin de cette écriture, ou cette écriture voit la désactivation validée : aucune entrée ne
-- survit au vidage.
CREATE FUNCTION ia_cache_reponses_actif() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_actif boolean;
  BEGIN
    SELECT p.cache_actif INTO v_actif FROM ia_parametres_cabinet p
      WHERE p.cabinet_id = NEW.cabinet_id FOR SHARE;
    IF NOT coalesce(v_actif, false) THEN
      RAISE EXCEPTION 'Cache IA désactivé pour le cabinet.' USING ERRCODE = 'MQI01';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER ia_cache_reponses_actif BEFORE INSERT ON ia_cache_reponses
  FOR EACH ROW EXECUTE FUNCTION ia_cache_reponses_actif();

ALTER TABLE ia_consommations DROP CONSTRAINT ia_consommations_issue_check;
ALTER TABLE ia_consommations ADD CONSTRAINT ia_consommations_issue_check
  CHECK (issue IN ('succes', 'sortie_invalide', 'annulee', 'test', 'delai_depasse',
                   'reponse_invalide', 'cache'));
-- Une génération servie par le cache ne coûte rien.
ALTER TABLE ia_consommations ADD CONSTRAINT ia_consommations_cache_gratuit_check
  CHECK (issue <> 'cache' OR (cout_micro_usd = 0 AND demande_id IS NOT NULL));

CREATE TABLE ia_alertes_plafond_mission (
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  plafond_micro_usd bigint NOT NULL CHECK (plafond_micro_usd >= 0),
  seuil smallint NOT NULL CHECK (seuil IN (80, 100)),
  cree_le timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cabinet_id, mission_id, plafond_micro_usd, seuil),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id)
);
ALTER TABLE ia_alertes_plafond_mission ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ia_alertes_plafond_mission
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON ia_alertes_plafond_mission AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON ia_alertes_plafond_mission FROM missionpilot_app;

-- Même fonction que 0104, étendue aux cabinets ayant une entrée de cache échue.
CREATE OR REPLACE FUNCTION planifier_conservation_ia(p_cle text, p_execute_a timestamptz)
  RETURNS int
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE v_n int;
  BEGIN
    IF p_cle !~ '^ia_conservation:[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'Clé de conservation IA invalide.';
    END IF;
    INSERT INTO jobs (cabinet_id, type, charge, execute_a, cle)
      SELECT c.id, 'ia_conservation', '{}'::jsonb, p_execute_a, p_cle
      FROM cabinets c
      WHERE EXISTS (SELECT 1 FROM ia_demandes_purgeables(c.id, p_execute_a))
         OR EXISTS (SELECT 1 FROM ia_cache_reponses r
                    WHERE r.cabinet_id = c.id AND r.expire_le <= p_execute_a)
      ON CONFLICT (cabinet_id, cle) WHERE cle IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
  END $$;
REVOKE ALL ON FUNCTION planifier_conservation_ia(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION planifier_conservation_ia(text, timestamptz) TO missionpilot_app;
