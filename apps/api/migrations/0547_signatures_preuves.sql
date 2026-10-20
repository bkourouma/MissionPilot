-- Canaux simulés (lot 3c, SPEC-3c §6.7) : journal de preuves d'une demande de signature, en ajout
-- seul et CHAÎNÉ (empreinte = SHA-256(empreinte précédente + "\n" + forme canonique de la ligne)).
--
-- La chaîne est calculée par l'API et vérifiée par le moteur `verifierChaine` à chaque lecture du
-- dossier de preuve ; la base garantit la forme : rang consécutif, empreinte précédente égale à
-- l'empreinte de la ligne précédente (64 zéros pour le rang 1), empreinte du document égale à celle
-- de la demande, horodatage croissant et proche de l'horloge de la base (5 s). L'horodatage est
-- celui de la base (`base_locale`) : ce n'est PAS un horodatage qualifié. L'adresse IP n'est pas
-- retenue (celle que voit l'API est celle du relais web) : `session_empreinte` est un HMAC de
-- l'empreinte du jeton de session.
--
-- MPH10 : preuve de signature, ajout seul, chaîne ou horodatage incohérents.

CREATE TABLE signatures_preuves (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  demande_id uuid NOT NULL,
  rang int NOT NULL CHECK (rang >= 1),
  type_evenement text NOT NULL CHECK (type_evenement IN ('demande_creee', 'invitation_envoyee',
    'document_consulte', 'reconfirmation_identite', 'signature_apposee', 'refus', 'annulation',
    'expiration', 'scellement')),
  signataire_id uuid,
  horodatage timestamptz NOT NULL,
  horodatage_source text NOT NULL DEFAULT 'base_locale' CHECK (horodatage_source = 'base_locale'),
  empreinte_document text NOT NULL CHECK (empreinte_document ~ '^[0-9a-f]{64}$'),
  authentification text CHECK (authentification IN ('mot_de_passe', 'mot_de_passe_et_2fa')),
  session_empreinte text CHECK (session_empreinte IS NULL OR session_empreinte ~ '^[0-9a-f]{64}$'),
  donnees jsonb NOT NULL DEFAULT '{}' CHECK (pg_column_size(donnees) <= 2048),
  empreinte_precedente text NOT NULL CHECK (empreinte_precedente ~ '^[0-9a-f]{64}$'),
  empreinte text NOT NULL CHECK (empreinte ~ '^[0-9a-f]{64}$'),
  UNIQUE (demande_id, rang),
  FOREIGN KEY (cabinet_id, demande_id) REFERENCES signatures_demandes (cabinet_id, id),
  FOREIGN KEY (cabinet_id, signataire_id) REFERENCES signatures_signataires (cabinet_id, id)
);
ALTER TABLE signatures_preuves ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON signatures_preuves
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON signatures_preuves AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON signatures_preuves FROM missionpilot_app;

CREATE FUNCTION refuser_modification_preuve_signature() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION 'Journal de preuves en ajout seul : ajouter une ligne.' USING ERRCODE = 'MPH10';
  END $$;
CREATE TRIGGER signatures_preuves_ajout_seul BEFORE UPDATE OR DELETE ON signatures_preuves
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_preuve_signature();

-- Chaîne : rang précédent + 1, empreinte précédente reprise, document de la demande, horodatage.
CREATE FUNCTION controler_signature_preuve() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_prec record;
    v_empreinte_document text;
  BEGIN
    SELECT p.rang, p.empreinte, p.horodatage INTO v_prec
      FROM signatures_preuves p WHERE p.demande_id = NEW.demande_id
      ORDER BY p.rang DESC LIMIT 1;
    IF NEW.rang IS DISTINCT FROM coalesce(v_prec.rang, 0) + 1 THEN
      RAISE EXCEPTION 'Preuve : rang inattendu.' USING ERRCODE = 'MPH10';
    END IF;
    IF NEW.empreinte_precedente IS DISTINCT FROM coalesce(v_prec.empreinte, repeat('0', 64)) THEN
      RAISE EXCEPTION 'Preuve : empreinte précédente incohérente.' USING ERRCODE = 'MPH10';
    END IF;
    SELECT d.empreinte_document INTO v_empreinte_document
      FROM signatures_demandes d WHERE d.id = NEW.demande_id;
    IF NEW.empreinte_document IS DISTINCT FROM v_empreinte_document THEN
      RAISE EXCEPTION 'Preuve : empreinte du document différente de celle de la demande.'
        USING ERRCODE = 'MPH10';
    END IF;
    IF (v_prec.horodatage IS NOT NULL AND NEW.horodatage < v_prec.horodatage)
       OR NEW.horodatage > clock_timestamp() + interval '5 seconds'
       OR NEW.horodatage < clock_timestamp() - interval '5 seconds' THEN
      RAISE EXCEPTION 'Preuve : horodatage décroissant ou éloigné de l''horloge de la base.'
        USING ERRCODE = 'MPH10';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER signatures_preuves_controle BEFORE INSERT ON signatures_preuves
  FOR EACH ROW EXECUTE FUNCTION controler_signature_preuve();
