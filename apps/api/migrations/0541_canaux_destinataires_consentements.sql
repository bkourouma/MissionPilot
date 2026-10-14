-- Canaux simulés (lot 3c, SPEC-3c §6.2) : destinataires (numéro vérifié, chiffré) et consentements
-- (historique en ajout seul).
--
-- Un numéro par utilisateur ET par canal. Le numéro n'est JAMAIS stocké en clair : chiffré
-- (AES-256-GCM, AAD liée à la ligne), empreinte HMAC pour retrouver l'expéditeur d'un message,
-- masque d'affichage. Aucune donnée réelle : les fournisseurs simulés refusent les numéros hors
-- de la plage de test (SPEC-3c §4.1), l'API refuse de les enregistrer.
--
-- MPH01 : historique de consentements en ajout seul (UPDATE, DELETE refusés + REVOKE).
-- MPH02 : consentement incohérent (numéro non vérifié, source ou acteur incohérents,
--         réactivation après STOP hors portail).
-- MPH12 : numéro modifié resté vérifié ; utilisateur non rattachable ; vérification sans code.

CREATE TABLE canaux_destinataires (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  utilisateur_id uuid NOT NULL,
  canal text NOT NULL CHECK (canal IN ('whatsapp', 'sms')),
  numero_chiffre bytea NOT NULL,
  numero_cle_version smallint NOT NULL,
  -- Empreinte HMAC du numéro ; `empreinte_cle_version` : version de clé qui l'a calculée (une
  -- rotation de TFA_MASTER_KEY la réécrit avec la clé courante, sans toucher à la vérification).
  numero_empreinte text NOT NULL CHECK (numero_empreinte ~ '^[0-9a-f]{64}$'),
  empreinte_cle_version smallint NOT NULL,
  numero_masque text NOT NULL CHECK (length(numero_masque) BETWEEN 4 AND 20),
  verifie_le timestamptz,
  code_empreinte text CHECK (code_empreinte IS NULL OR code_empreinte ~ '^[0-9a-f]{64}$'),
  code_expire_le timestamptz,
  code_essais smallint NOT NULL DEFAULT 0 CHECK (code_essais BETWEEN 0 AND 5),
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((code_empreinte IS NULL) = (code_expire_le IS NULL)),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, id, canal),
  UNIQUE (cabinet_id, utilisateur_id, canal),
  FOREIGN KEY (cabinet_id, utilisateur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX canaux_destinataires_utilisateur_idx ON canaux_destinataires (cabinet_id, utilisateur_id);
-- Un numéro VÉRIFIÉ n'est pas partagé entre deux personnes : l'expéditeur d'un message est univoque.
-- L'unicité ne porte QUE sur les numéros vérifiés (audit de sécurité, M5) : enregistrer un numéro déjà
-- vérifié par un autre ne révèle rien (pas d'oracle « numéro déjà utilisé ») ; le conflit se tranche à
-- la vérification du code, qui échoue sans détail. Un numéro non vérifié ne reçoit aucun message
-- entrant (rejeté par défaut), un vérifié prime à la recherche de l'expéditeur.
CREATE UNIQUE INDEX canaux_destinataires_numero_verifie_uniq
  ON canaux_destinataires (cabinet_id, canal, numero_empreinte) WHERE verifie_le IS NOT NULL;
CREATE INDEX canaux_destinataires_empreinte_idx
  ON canaux_destinataires (cabinet_id, canal, numero_empreinte);
ALTER TABLE canaux_destinataires ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON canaux_destinataires
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
-- Le portail ne voit et n'écrit que SA ligne.
CREATE POLICY portail ON canaux_destinataires AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL OR utilisateur_id = app_portail_utilisateur_id());
REVOKE DELETE ON canaux_destinataires FROM missionpilot_app;

CREATE FUNCTION controler_canal_destinataire() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_changement boolean;
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NOT EXISTS (SELECT 1 FROM utilisateurs u
                     WHERE u.id = NEW.utilisateur_id AND u.actif
                       AND NOT (u.roles <@ ARRAY['client_investisseur', 'expert_externe'])) THEN
        RAISE EXCEPTION 'Destinataire : utilisateur actif rattachable requis.'
          USING ERRCODE = 'MPH12';
      END IF;
      IF NEW.verifie_le IS NOT NULL THEN
        RAISE EXCEPTION 'Un numéro naît non vérifié.' USING ERRCODE = 'MPH12';
      END IF;
      NEW.modifie_le := now();
      RETURN NEW;
    END IF;
    IF (NEW.cabinet_id, NEW.utilisateur_id, NEW.canal)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.utilisateur_id, OLD.canal) THEN
      RAISE EXCEPTION 'Destinataire : utilisateur et canal sont figés.' USING ERRCODE = 'MPH12';
    END IF;
    -- Changement de numéro : masque différent, ou empreinte différente sous la MÊME version de
    -- clé (une réécriture par rotation change aussi la version, sans changer de numéro).
    v_changement := NEW.numero_masque IS DISTINCT FROM OLD.numero_masque
      OR (NEW.numero_empreinte IS DISTINCT FROM OLD.numero_empreinte
          AND NEW.empreinte_cle_version = OLD.empreinte_cle_version);
    IF v_changement THEN
      NEW.verifie_le := NULL;
      NEW.code_empreinte := NULL;
      NEW.code_expire_le := NULL;
      NEW.code_essais := 0;
    ELSIF OLD.verifie_le IS NULL AND NEW.verifie_le IS NOT NULL THEN
      -- La vérification consomme un code posé (code effacé dans la même écriture).
      IF OLD.code_empreinte IS NULL OR NEW.code_empreinte IS NOT NULL THEN
        RAISE EXCEPTION 'Numéro vérifié sans code validé.' USING ERRCODE = 'MPH12';
      END IF;
    ELSIF OLD.verifie_le IS NOT NULL AND NEW.verifie_le IS DISTINCT FROM OLD.verifie_le THEN
      RAISE EXCEPTION 'La date de vérification d''un numéro ne change pas.' USING ERRCODE = 'MPH12';
    END IF;
    NEW.modifie_le := now();
    RETURN NEW;
  END $$;
CREATE TRIGGER canaux_destinataires_controle BEFORE INSERT OR UPDATE ON canaux_destinataires
  FOR EACH ROW EXECUTE FUNCTION controler_canal_destinataire();

CREATE TABLE canaux_consentements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  destinataire_id uuid NOT NULL,
  canal text NOT NULL CHECK (canal IN ('whatsapp', 'sms')),
  statut text NOT NULL CHECK (statut IN ('accorde', 'retire')),
  source text NOT NULL CHECK (source IN ('portail', 'recueilli_cabinet', 'retrait_portail',
    'retrait_cabinet', 'message_stop', 'changement_numero', 'desactivation_utilisateur')),
  mention_version text CHECK (mention_version IS NULL OR mention_version ~ '^[a-z0-9-]{1,40}$'),
  mention_empreinte text CHECK (mention_empreinte IS NULL OR mention_empreinte ~ '^[0-9a-f]{64}$'),
  reference_preuve text CHECK (reference_preuve IS NULL OR length(btrim(reference_preuve)) BETWEEN 10 AND 500),
  acteur_id uuid,
  evenement_ref text CHECK (evenement_ref IS NULL OR evenement_ref ~ '^[A-Za-z0-9_-]{1,100}$'),
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK ((statut = 'accorde') = (source IN ('portail', 'recueilli_cabinet'))),
  CHECK ((source = 'recueilli_cabinet') = (reference_preuve IS NOT NULL)),
  CHECK (source <> 'portail' OR (mention_version IS NOT NULL AND mention_empreinte IS NOT NULL)),
  CHECK (acteur_id IS NOT NULL OR source = 'message_stop'),
  FOREIGN KEY (cabinet_id, destinataire_id, canal)
    REFERENCES canaux_destinataires (cabinet_id, id, canal),
  FOREIGN KEY (cabinet_id, acteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
-- L'état courant est la dernière ligne (id le plus grand) d'un destinataire.
CREATE INDEX canaux_consentements_courant_idx ON canaux_consentements (cabinet_id, destinataire_id, id DESC);
ALTER TABLE canaux_consentements ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON canaux_consentements
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
-- Le portail ne lit et n'écrit que les consentements de SON destinataire.
CREATE POLICY portail ON canaux_consentements AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL OR EXISTS (
    SELECT 1 FROM canaux_destinataires d
    WHERE d.id = canaux_consentements.destinataire_id
      AND d.utilisateur_id = app_portail_utilisateur_id()));
REVOKE UPDATE, DELETE ON canaux_consentements FROM missionpilot_app;

CREATE FUNCTION refuser_modification_consentement() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Historique des consentements en ajout seul : ajouter une ligne.'
      USING ERRCODE = 'MPH01';
  END $$;
CREATE TRIGGER canaux_consentements_ajout_seul BEFORE UPDATE OR DELETE ON canaux_consentements
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_consentement();

CREATE FUNCTION controler_canal_consentement() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_dest record;
    v_dernier record;
  BEGIN
    SELECT d.utilisateur_id, d.verifie_le INTO v_dest
      FROM canaux_destinataires d WHERE d.id = NEW.destinataire_id;
    IF NEW.statut = 'accorde' THEN
      IF v_dest.verifie_le IS NULL THEN
        RAISE EXCEPTION 'Consentement impossible : numéro non vérifié.' USING ERRCODE = 'MPH02';
      END IF;
      IF NEW.source = 'portail' AND NEW.acteur_id IS DISTINCT FROM v_dest.utilisateur_id THEN
        RAISE EXCEPTION 'Seule la personne concernée accorde son consentement par son espace.'
          USING ERRCODE = 'MPH02';
      END IF;
      IF NEW.source = 'recueilli_cabinet' AND NOT EXISTS (
           SELECT 1 FROM utilisateurs u
           WHERE u.id = NEW.acteur_id AND u.actif
             AND u.roles && ARRAY['associe', 'directeur_mission']) THEN
        RAISE EXCEPTION 'Un consentement recueilli est enregistré par un associé ou un directeur de mission.'
          USING ERRCODE = 'MPH02';
      END IF;
      -- Après un STOP, seule la personne redonne son accord (par son espace).
      SELECT c.statut, c.source INTO v_dernier FROM canaux_consentements c
        WHERE c.destinataire_id = NEW.destinataire_id ORDER BY c.id DESC LIMIT 1;
      IF v_dernier.statut = 'retire' AND v_dernier.source = 'message_stop'
         AND NEW.source <> 'portail' THEN
        RAISE EXCEPTION 'Après STOP, seule la personne redonne son accord.' USING ERRCODE = 'MPH02';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER canaux_consentements_controle BEFORE INSERT ON canaux_consentements
  FOR EACH ROW EXECUTE FUNCTION controler_canal_consentement();
