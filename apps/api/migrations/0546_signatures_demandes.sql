-- Canaux simulés (lot 3c, SPEC-3c §6.6) : demandes de signature électronique d'un PDF de mission
-- (CLI-05, ADR-010) et leurs signataires.
--
-- Fournisseur LOCAL (simulé) : niveau « simple simulée », SANS valeur juridique. La demande porte
-- l'empreinte SHA-256 du PDF (égale à `fichiers.sha256`, MPH11) ; elle n'a AUCUN effet sur le
-- budget ni sur le statut de la mission (ADR-010). Une demande ne se modifie plus après l'envoi.
--
-- MPH08 : demande, transition interdite ou contenu figé modifié.
-- MPH09 : signataire incohérent (partie, rôle, ordre séquentiel, brouillon) ou demande `signee`
--         sans toutes les signatures.
-- MPH11 : demande sur un document non signable (fichier, empreinte, mission clôturée, client).

CREATE TABLE signatures_demandes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  -- Copie contrôlée du client de la mission (MPH11) : sert la politique du portail.
  client_id uuid NOT NULL,
  document_id uuid NOT NULL,
  fichier_id uuid NOT NULL,
  empreinte_document text NOT NULL CHECK (empreinte_document ~ '^[0-9a-f]{64}$'),
  objet text NOT NULL CHECK (objet IN ('lettre_mission', 'avenant', 'proces_verbal')),
  budget_version_id uuid,
  ordre text NOT NULL CHECK (ordre IN ('parallele', 'sequentiel')),
  statut text NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'envoyee', 'partielle',
    'signee', 'refusee', 'annulee', 'expiree')),
  expire_le timestamptz,
  fournisseur text NOT NULL DEFAULT 'local' CHECK (fournisseur = 'local'),
  mode_fournisseur text NOT NULL DEFAULT 'simule' CHECK (mode_fournisseur = 'simule'),
  reference_externe text CHECK (reference_externe IS NULL OR length(reference_externe) BETWEEN 1 AND 100),
  signataires_total smallint NOT NULL DEFAULT 0 CHECK (signataires_total BETWEEN 0 AND 10),
  signataires_signes smallint NOT NULL DEFAULT 0 CHECK (signataires_signes BETWEEN 0 AND 10),
  demandeur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  envoyee_le timestamptz,
  termine_le timestamptz,
  motif_fin text CHECK (motif_fin IS NULL OR length(btrim(motif_fin)) BETWEEN 1 AND 1000),
  CHECK (signataires_signes <= signataires_total),
  CHECK (budget_version_id IS NULL OR objet = 'avenant'),
  CHECK (statut <> 'brouillon' OR envoyee_le IS NULL),
  CHECK (statut IN ('brouillon', 'annulee') OR (envoyee_le IS NOT NULL AND expire_le IS NOT NULL)),
  CHECK ((statut IN ('signee', 'refusee', 'annulee', 'expiree')) = (termine_le IS NOT NULL)),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, document_id) REFERENCES mission_documents (cabinet_id, id),
  FOREIGN KEY (cabinet_id, fichier_id) REFERENCES fichiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, mission_id, budget_version_id)
    REFERENCES budget_versions (cabinet_id, mission_id, id),
  FOREIGN KEY (cabinet_id, demandeur_id) REFERENCES utilisateurs (cabinet_id, id)
);
-- Une seule demande ouverte par document.
CREATE UNIQUE INDEX signatures_demandes_ouverte_uniq ON signatures_demandes (cabinet_id, document_id)
  WHERE statut IN ('brouillon', 'envoyee', 'partielle');
CREATE INDEX signatures_demandes_mission_idx ON signatures_demandes (cabinet_id, mission_id, cree_le DESC, id);
CREATE INDEX signatures_demandes_client_idx ON signatures_demandes (cabinet_id, client_id);
ALTER TABLE signatures_demandes ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON signatures_demandes
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
REVOKE DELETE ON signatures_demandes FROM missionpilot_app;

CREATE TABLE signatures_signataires (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  demande_id uuid NOT NULL,
  utilisateur_id uuid NOT NULL,
  partie text NOT NULL CHECK (partie IN ('cabinet', 'client')),
  rang smallint NOT NULL CHECK (rang BETWEEN 1 AND 10),
  statut text NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'invite', 'signe',
    'refuse', 'expire')),
  invite_le timestamptz,
  decide_le timestamptz,
  motif_refus text CHECK (motif_refus IS NULL OR length(btrim(motif_refus)) BETWEEN 1 AND 1000),
  CHECK ((statut = 'refuse') = (motif_refus IS NOT NULL)),
  UNIQUE (cabinet_id, id),
  UNIQUE (demande_id, utilisateur_id),
  UNIQUE (demande_id, rang),
  FOREIGN KEY (cabinet_id, demande_id) REFERENCES signatures_demandes (cabinet_id, id),
  FOREIGN KEY (cabinet_id, utilisateur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX signatures_signataires_utilisateur_idx ON signatures_signataires (cabinet_id, utilisateur_id);
ALTER TABLE signatures_signataires ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON signatures_signataires
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());

-- Portail : lecture seule, SES demandes (client, statut hors brouillon, signataire invité) et SA
-- ligne de signataire ; aucune écriture directe (les écritures du portail passent par
-- `horsContextePortail`, SPEC-3c §12.3). Le portail ne voit jamais le nom d'un membre du cabinet.
CREATE POLICY portail ON signatures_signataires AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR utilisateur_id = app_portail_utilisateur_id());
CREATE POLICY portail ON signatures_demandes AS RESTRICTIVE FOR SELECT
  USING (app_portail_client_id() IS NULL OR (
    client_id = app_portail_client_id() AND statut <> 'brouillon'
    AND EXISTS (SELECT 1 FROM signatures_signataires s
                WHERE s.demande_id = signatures_demandes.id
                  AND s.utilisateur_id = app_portail_utilisateur_id())));
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['signatures_demandes', 'signatures_signataires'] LOOP
    EXECUTE format(
      'CREATE POLICY portail_sans_insert ON %I AS RESTRICTIVE FOR INSERT
         WITH CHECK (app_portail_client_id() IS NULL)', t);
    EXECUTE format(
      'CREATE POLICY portail_sans_update ON %I AS RESTRICTIVE FOR UPDATE
         USING (app_portail_client_id() IS NULL) WITH CHECK (app_portail_client_id() IS NULL)', t);
    EXECUTE format(
      'CREATE POLICY portail_sans_delete ON %I AS RESTRICTIVE FOR DELETE
         USING (app_portail_client_id() IS NULL)', t);
  END LOOP;
END $$;

-- Insertion : le document est signable (MPH11).
CREATE FUNCTION controler_signature_demande() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_doc record;
    v_mission record;
    v_fichier record;
    v_ouverts int;
    v_nb int;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une demande de signature ne se supprime pas.' USING ERRCODE = 'MPH08';
    END IF;
    IF TG_OP = 'INSERT' THEN
      SELECT d.mission_id, d.fichier_id, d.type INTO v_doc
        FROM mission_documents d WHERE d.id = NEW.document_id;
      SELECT m.client_id, m.statut INTO v_mission FROM missions m WHERE m.id = NEW.mission_id;
      SELECT f.type_mime, f.sha256 INTO v_fichier FROM fichiers f WHERE f.id = NEW.fichier_id;
      IF v_doc.mission_id IS DISTINCT FROM NEW.mission_id
         OR v_doc.fichier_id IS DISTINCT FROM NEW.fichier_id
         OR v_fichier.type_mime IS DISTINCT FROM 'application/pdf'
         OR v_fichier.sha256 IS DISTINCT FROM NEW.empreinte_document
         OR v_mission.statut = 'cloturee'
         OR v_mission.client_id IS DISTINCT FROM NEW.client_id
         OR (NEW.objet = 'lettre_mission' AND v_doc.type <> 'lettre_de_mission')
         OR (NEW.objet IN ('avenant', 'proces_verbal') AND v_doc.type <> 'autre') THEN
        RAISE EXCEPTION 'Document non signable (fichier, empreinte, mission ou client).'
          USING ERRCODE = 'MPH11';
      END IF;
      IF NEW.statut <> 'brouillon' OR NEW.signataires_total <> 0 OR NEW.signataires_signes <> 0 THEN
        RAISE EXCEPTION 'Une demande de signature naît en brouillon, sans signataire.'
          USING ERRCODE = 'MPH08';
      END IF;
      -- Au plus 20 demandes ouvertes par mission (SPEC-3c §13).
      SELECT count(*) INTO v_ouverts FROM signatures_demandes s
        WHERE s.mission_id = NEW.mission_id AND s.statut IN ('brouillon', 'envoyee', 'partielle');
      IF v_ouverts >= 20 THEN
        RAISE EXCEPTION 'Trop de demandes de signature ouvertes pour cette mission.'
          USING ERRCODE = 'MPH08';
      END IF;
      RETURN NEW;
    END IF;
    -- Contenu figé (document, fichier, empreinte, objet, ordre, mission, client, fournisseur).
    IF (NEW.cabinet_id, NEW.mission_id, NEW.client_id, NEW.document_id, NEW.fichier_id,
        NEW.empreinte_document, NEW.objet, NEW.ordre, NEW.budget_version_id, NEW.fournisseur,
        NEW.demandeur_id, NEW.cree_le)
       IS DISTINCT FROM
       (OLD.cabinet_id, OLD.mission_id, OLD.client_id, OLD.document_id, OLD.fichier_id,
        OLD.empreinte_document, OLD.objet, OLD.ordre, OLD.budget_version_id, OLD.fournisseur,
        OLD.demandeur_id, OLD.cree_le) THEN
      RAISE EXCEPTION 'Demande de signature : contenu figé.' USING ERRCODE = 'MPH08';
    END IF;
    IF OLD.statut IN ('signee', 'refusee', 'annulee', 'expiree') THEN
      RAISE EXCEPTION 'Demande de signature terminée : non modifiable.' USING ERRCODE = 'MPH08';
    END IF;
    IF OLD.statut <> 'brouillon' AND NEW.expire_le IS DISTINCT FROM OLD.expire_le THEN
      RAISE EXCEPTION 'Demande de signature : échéance figée après l''envoi.' USING ERRCODE = 'MPH08';
    END IF;
    IF NEW.statut <> OLD.statut AND NOT (
         (OLD.statut = 'brouillon' AND NEW.statut IN ('envoyee', 'annulee'))
         OR (OLD.statut = 'envoyee' AND NEW.statut IN ('partielle', 'signee', 'refusee', 'annulee', 'expiree'))
         OR (OLD.statut = 'partielle' AND NEW.statut IN ('signee', 'refusee', 'annulee', 'expiree'))) THEN
      RAISE EXCEPTION 'Demande de signature : transition % vers % interdite.', OLD.statut, NEW.statut
        USING ERRCODE = 'MPH08';
    END IF;
    IF NEW.statut = 'envoyee' AND OLD.statut = 'brouillon' THEN
      SELECT count(*) INTO v_nb FROM signatures_signataires s WHERE s.demande_id = NEW.id;
      IF v_nb < 1 OR NEW.signataires_total <> v_nb THEN
        RAISE EXCEPTION 'Envoi : au moins un signataire, compteur égal à leur nombre.'
          USING ERRCODE = 'MPH08';
      END IF;
      IF NEW.expire_le IS NULL OR NEW.envoyee_le IS NULL
         OR NEW.expire_le < NEW.envoyee_le + interval '1 day'
         OR NEW.expire_le > NEW.envoyee_le + interval '90 days' THEN
        RAISE EXCEPTION 'Envoi : échéance entre 1 et 90 jours après l''envoi.' USING ERRCODE = 'MPH08';
      END IF;
    END IF;
    IF NEW.statut IN ('partielle', 'signee') THEN
      SELECT count(*) INTO v_nb FROM signatures_signataires s
        WHERE s.demande_id = NEW.id AND s.statut = 'signe';
      IF NEW.signataires_signes <> v_nb THEN
        RAISE EXCEPTION 'Compteur de signatures incohérent.' USING ERRCODE = 'MPH09';
      END IF;
      IF NEW.statut = 'signee' AND NEW.signataires_signes <> NEW.signataires_total THEN
        RAISE EXCEPTION 'Demande signée sans toutes les signatures.' USING ERRCODE = 'MPH09';
      END IF;
      IF NEW.statut = 'partielle' AND NEW.signataires_signes = NEW.signataires_total THEN
        RAISE EXCEPTION 'Toutes les signatures sont posées : la demande est signée.'
          USING ERRCODE = 'MPH09';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER signatures_demandes_controle BEFORE INSERT OR UPDATE OR DELETE ON signatures_demandes
  FOR EACH ROW EXECUTE FUNCTION controler_signature_demande();

-- Signataires : composition seulement en brouillon, parties et rôles cohérents, ordre séquentiel.
CREATE FUNCTION controler_signature_signataire() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_demande record;
    v_ref record;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      SELECT d.statut INTO v_demande FROM signatures_demandes d WHERE d.id = OLD.demande_id;
      IF v_demande.statut IS DISTINCT FROM 'brouillon' THEN
        RAISE EXCEPTION 'Les signataires ne se retirent que pendant le brouillon.'
          USING ERRCODE = 'MPH09';
      END IF;
      RETURN OLD;
    END IF;
    SELECT d.statut, d.ordre, d.client_id, d.expire_le INTO v_demande
      FROM signatures_demandes d WHERE d.id = NEW.demande_id;
    IF TG_OP = 'INSERT' THEN
      IF v_demande.statut IS DISTINCT FROM 'brouillon' THEN
        RAISE EXCEPTION 'Les signataires s''ajoutent pendant le brouillon seulement.'
          USING ERRCODE = 'MPH09';
      END IF;
      IF NEW.statut <> 'en_attente' THEN
        RAISE EXCEPTION 'Un signataire naît « en_attente ».' USING ERRCODE = 'MPH09';
      END IF;
      IF NEW.partie = 'cabinet' AND NOT EXISTS (
           SELECT 1 FROM utilisateurs u WHERE u.id = NEW.utilisateur_id AND u.actif
             AND u.roles && ARRAY['associe', 'directeur_mission']) THEN
        RAISE EXCEPTION 'Signataire du cabinet : associé ou directeur de mission actif.'
          USING ERRCODE = 'MPH09';
      END IF;
      IF NEW.partie = 'client' AND NOT EXISTS (
           SELECT 1 FROM utilisateurs u
           JOIN utilisateurs_portail up ON up.utilisateur_id = u.id AND up.statut = 'actif'
             AND up.client_id = v_demande.client_id
           JOIN clients c ON c.id = up.client_id AND c.actif
           WHERE u.id = NEW.utilisateur_id AND u.actif AND 'client_dirigeant' = ANY (u.roles)) THEN
        RAISE EXCEPTION 'Signataire du client : dirigeant actif du portail du client de la mission.'
          USING ERRCODE = 'MPH09';
      END IF;
      RETURN NEW;
    END IF;
    IF (NEW.cabinet_id, NEW.demande_id, NEW.utilisateur_id, NEW.partie, NEW.rang)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.demande_id, OLD.utilisateur_id, OLD.partie, OLD.rang) THEN
      RAISE EXCEPTION 'Signataire : identité non modifiable.' USING ERRCODE = 'MPH09';
    END IF;
    IF NEW.statut = OLD.statut THEN
      IF NEW.invite_le IS DISTINCT FROM OLD.invite_le OR NEW.decide_le IS DISTINCT FROM OLD.decide_le
         OR NEW.motif_refus IS DISTINCT FROM OLD.motif_refus THEN
        RAISE EXCEPTION 'Signataire : dates et motif ne changent qu''avec le statut.'
          USING ERRCODE = 'MPH09';
      END IF;
      RETURN NEW;
    END IF;
    IF NOT (
      (OLD.statut = 'en_attente' AND NEW.statut IN ('invite', 'expire'))
      OR (OLD.statut = 'invite' AND NEW.statut IN ('signe', 'refuse', 'expire'))) THEN
      RAISE EXCEPTION 'Signataire : transition % vers % interdite.', OLD.statut, NEW.statut
        USING ERRCODE = 'MPH09';
    END IF;
    IF NEW.statut IN ('signe', 'refuse') THEN
      IF v_demande.statut NOT IN ('envoyee', 'partielle') THEN
        RAISE EXCEPTION 'La demande n''est pas ouverte à la signature.' USING ERRCODE = 'MPH09';
      END IF;
      IF clock_timestamp() > v_demande.expire_le THEN
        RAISE EXCEPTION 'La demande de signature est échue.' USING ERRCODE = 'MPH09';
      END IF;
    END IF;
    IF NEW.statut = 'signe' AND v_demande.ordre = 'sequentiel' AND EXISTS (
         SELECT 1 FROM signatures_signataires s
         WHERE s.demande_id = NEW.demande_id AND s.rang < NEW.rang AND s.statut <> 'signe') THEN
      RAISE EXCEPTION 'Ordre séquentiel : les signataires de rang inférieur signent d''abord.'
        USING ERRCODE = 'MPH09';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER signatures_signataires_controle BEFORE INSERT OR UPDATE OR DELETE ON signatures_signataires
  FOR EACH ROW EXECUTE FUNCTION controler_signature_signataire();
