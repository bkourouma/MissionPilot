-- Envois de questionnaires aux répondants d'une entreprise cliente (SOC-10).
--
-- Un envoi rattache une version VALIDÉE d'un modèle à une mission et au client
-- de cette mission ; la définition est COPIÉE dans l'envoi (figée). Modes :
-- individuel, par fonction (libellé de fonction obligatoire par répondant),
-- collectif (UNE réponse partagée, verrouillée à la première soumission).
-- Les répondants sont des utilisateurs du portail ACTIFS de ce client, au
-- rôle de dirigeant ou de contributeur client (DECISIONS.md, V2).
--
-- Réponses : brouillon (sauvegarde automatique) puis soumission ; une réponse
-- soumise est figée (MPQ04). Aucune suppression.

CREATE TABLE questionnaire_envois (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  client_id uuid NOT NULL,
  version_id uuid NOT NULL,
  definition jsonb NOT NULL,
  titre text NOT NULL CHECK (length(titre) BETWEEN 1 AND 200),
  mode text NOT NULL CHECK (mode IN ('individuel', 'collectif', 'par_fonction')),
  statut text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'envoye', 'clos')),
  relances_auto boolean NOT NULL DEFAULT true,
  date_limite date CHECK (date_limite IS NULL OR date_limite BETWEEN '2000-01-01' AND '2100-12-31'),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  envoye_par uuid,
  envoye_le timestamptz,
  clos_par uuid,
  clos_le timestamptz,
  CHECK ((statut = 'brouillon') = (envoye_le IS NULL)),
  CHECK ((envoye_le IS NULL) = (envoye_par IS NULL)),
  CHECK ((statut = 'clos') = (clos_le IS NOT NULL)),
  CHECK ((clos_le IS NULL) = (clos_par IS NULL)),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, version_id) REFERENCES questionnaire_versions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, envoye_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, clos_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX questionnaire_envois_mission_idx ON questionnaire_envois (cabinet_id, mission_id, cree_le DESC, id);
CREATE INDEX questionnaire_envois_client_idx ON questionnaire_envois (cabinet_id, client_id);
ALTER TABLE questionnaire_envois ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON questionnaire_envois
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON questionnaire_envois FROM missionpilot_app;

-- Création : client de la mission, version validée, définition copiée.
-- Modification : identité figée, statut brouillon → envoyé → clos seulement.
CREATE FUNCTION controler_questionnaire_envoi() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_definition jsonb;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Un envoi de questionnaire ne se supprime pas.' USING ERRCODE = 'MPQ02';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NOT EXISTS (SELECT 1 FROM missions m WHERE m.id = NEW.mission_id AND m.client_id = NEW.client_id) THEN
        RAISE EXCEPTION 'Le client de l''envoi n''est pas celui de la mission.' USING ERRCODE = 'MPQ02';
      END IF;
      SELECT v.definition INTO v_definition FROM questionnaire_versions v
        WHERE v.id = NEW.version_id AND v.statut = 'valide';
      IF v_definition IS NULL THEN
        RAISE EXCEPTION 'Seule une version validée s''envoie.' USING ERRCODE = 'MPQ02';
      END IF;
      IF NEW.statut <> 'brouillon' THEN
        RAISE EXCEPTION 'Un envoi naît en brouillon.' USING ERRCODE = 'MPQ02';
      END IF;
      NEW.definition := v_definition;
      RETURN NEW;
    END IF;
    IF (NEW.cabinet_id, NEW.mission_id, NEW.client_id, NEW.version_id, NEW.definition, NEW.titre,
        NEW.mode, NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.mission_id, OLD.client_id, OLD.version_id, OLD.definition,
        OLD.titre, OLD.mode, OLD.cree_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'L''identité d''un envoi de questionnaire est figée.' USING ERRCODE = 'MPQ02';
    END IF;
    IF OLD.statut = 'clos' THEN
      RAISE EXCEPTION 'Un envoi clos est figé.' USING ERRCODE = 'MPQ02';
    END IF;
    IF NEW.statut <> OLD.statut AND NOT (
         (OLD.statut = 'brouillon' AND NEW.statut = 'envoye')
         OR (OLD.statut = 'envoye' AND NEW.statut = 'clos')) THEN
      RAISE EXCEPTION 'Transition de statut d''envoi refusée.' USING ERRCODE = 'MPQ02';
    END IF;
    IF (NEW.envoye_par, NEW.envoye_le) IS DISTINCT FROM (OLD.envoye_par, OLD.envoye_le)
       AND OLD.envoye_le IS NOT NULL THEN
      RAISE EXCEPTION 'La date d''envoi est figée.' USING ERRCODE = 'MPQ02';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER questionnaire_envois_controle BEFORE INSERT OR UPDATE OR DELETE ON questionnaire_envois
  FOR EACH ROW EXECUTE FUNCTION controler_questionnaire_envoi();

CREATE TABLE questionnaire_repondants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  envoi_id uuid NOT NULL,
  utilisateur_id uuid NOT NULL,
  client_id uuid NOT NULL,
  fonction text CHECK (fonction IS NULL OR (length(btrim(fonction)) BETWEEN 1 AND 120
    AND fonction !~ '[[:cntrl:]]')),
  ajoute_par uuid NOT NULL,
  ajoute_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, envoi_id, utilisateur_id),
  FOREIGN KEY (cabinet_id, envoi_id) REFERENCES questionnaire_envois (cabinet_id, id),
  FOREIGN KEY (cabinet_id, utilisateur_id) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, ajoute_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX questionnaire_repondants_utilisateur_idx ON questionnaire_repondants (cabinet_id, utilisateur_id);
ALTER TABLE questionnaire_repondants ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON questionnaire_repondants
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE UPDATE, DELETE ON questionnaire_repondants FROM missionpilot_app;

-- Répondant : utilisateur du portail actif du client de l'envoi (dirigeant ou
-- contributeur), fonction obligatoire en mode « par fonction », envoi en
-- brouillon. Liste figée ensuite.
CREATE FUNCTION controler_questionnaire_repondant() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_envoi record;
  BEGIN
    IF TG_OP <> 'INSERT' THEN
      RAISE EXCEPTION 'La liste des répondants est figée.' USING ERRCODE = 'MPQ03';
    END IF;
    SELECT e.client_id, e.mode, e.statut INTO v_envoi FROM questionnaire_envois e WHERE e.id = NEW.envoi_id;
    IF NOT FOUND OR v_envoi.client_id <> NEW.client_id THEN
      RAISE EXCEPTION 'Répondant d''un autre client.' USING ERRCODE = 'MPQ03';
    END IF;
    IF v_envoi.statut <> 'brouillon' THEN
      RAISE EXCEPTION 'Les répondants se désignent avant l''envoi.' USING ERRCODE = 'MPQ03';
    END IF;
    IF v_envoi.mode = 'par_fonction' AND NEW.fonction IS NULL THEN
      RAISE EXCEPTION 'La fonction du répondant est obligatoire.' USING ERRCODE = 'MPQ03';
    END IF;
    IF NOT EXISTS (
         SELECT 1 FROM utilisateurs_portail up JOIN utilisateurs u ON u.id = up.utilisateur_id
         WHERE up.utilisateur_id = NEW.utilisateur_id AND up.client_id = NEW.client_id
           AND up.statut = 'actif' AND u.actif
           AND u.roles && ARRAY['client_dirigeant', 'client_contributeur']) THEN
      RAISE EXCEPTION 'Le répondant doit être un dirigeant ou un contributeur actif du client.'
        USING ERRCODE = 'MPQ03';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER questionnaire_repondants_controle BEFORE INSERT OR UPDATE OR DELETE
  ON questionnaire_repondants FOR EACH ROW EXECUTE FUNCTION controler_questionnaire_repondant();

-- Réponses : une par répondant (individuel, par fonction), ou UNE partagée
-- (collectif : repondant_id NULL). `saisies` : dernier auteur et date de
-- saisie par question (collectif), tenu par le moteur.
CREATE TABLE questionnaire_reponses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  envoi_id uuid NOT NULL,
  repondant_id uuid,
  client_id uuid NOT NULL,
  reponses jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(reponses) = 'object'),
  saisies jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(saisies) = 'object'),
  statut text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'soumise')),
  revision int NOT NULL DEFAULT 1 CHECK (revision >= 1),
  modifie_par uuid NOT NULL,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  soumise_par uuid,
  soumise_le timestamptz,
  CHECK ((statut = 'soumise') = (soumise_par IS NOT NULL)),
  CHECK ((soumise_par IS NULL) = (soumise_le IS NULL)),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, envoi_id) REFERENCES questionnaire_envois (cabinet_id, id),
  FOREIGN KEY (cabinet_id, repondant_id) REFERENCES questionnaire_repondants (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, soumise_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE UNIQUE INDEX questionnaire_reponses_individuelle_uniq ON questionnaire_reponses (cabinet_id, envoi_id, repondant_id)
  WHERE repondant_id IS NOT NULL;
CREATE UNIQUE INDEX questionnaire_reponses_collective_uniq ON questionnaire_reponses (cabinet_id, envoi_id)
  WHERE repondant_id IS NULL;
ALTER TABLE questionnaire_reponses ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON questionnaire_reponses
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON questionnaire_reponses FROM missionpilot_app;

-- Une réponse naît et change seulement tant que l'envoi est « envoyé » ;
-- soumise, elle est verrouillée (collectif : à la PREMIÈRE soumission).
CREATE FUNCTION controler_questionnaire_reponse() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_envoi record;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une réponse de questionnaire ne se supprime pas.' USING ERRCODE = 'MPQ04';
    END IF;
    IF TG_OP = 'UPDATE' THEN
      IF OLD.statut = 'soumise' THEN
        RAISE EXCEPTION 'La réponse est soumise : elle est verrouillée.' USING ERRCODE = 'MPQ04';
      END IF;
      IF (NEW.cabinet_id, NEW.envoi_id, NEW.repondant_id, NEW.client_id)
         IS DISTINCT FROM (OLD.cabinet_id, OLD.envoi_id, OLD.repondant_id, OLD.client_id) THEN
        RAISE EXCEPTION 'L''identité d''une réponse est figée.' USING ERRCODE = 'MPQ04';
      END IF;
      NEW.revision := OLD.revision + 1;
      NEW.modifie_le := now();
    END IF;
    SELECT e.client_id, e.mode, e.statut INTO v_envoi FROM questionnaire_envois e WHERE e.id = NEW.envoi_id;
    IF NOT FOUND OR v_envoi.client_id <> NEW.client_id OR v_envoi.statut <> 'envoye' THEN
      RAISE EXCEPTION 'Ce questionnaire n''accepte pas de réponse.' USING ERRCODE = 'MPQ04';
    END IF;
    IF (v_envoi.mode = 'collectif') <> (NEW.repondant_id IS NULL) THEN
      RAISE EXCEPTION 'Réponse incompatible avec le mode du questionnaire.' USING ERRCODE = 'MPQ04';
    END IF;
    IF NEW.repondant_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM questionnaire_repondants r WHERE r.id = NEW.repondant_id AND r.envoi_id = NEW.envoi_id) THEN
      RAISE EXCEPTION 'Répondant étranger à cet envoi.' USING ERRCODE = 'MPQ04';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER questionnaire_reponses_controle BEFORE INSERT OR UPDATE OR DELETE
  ON questionnaire_reponses FOR EACH ROW EXECUTE FUNCTION controler_questionnaire_reponse();
