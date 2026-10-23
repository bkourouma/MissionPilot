-- Ingestion de documents (lot 6, ADR-009) : brouillons produits par l'IA à partir du texte d'un document.
--
-- L'IA propose, l'expert dispose : une extraction naît `brouillon_ia`, un humain la corrige (`modifie`, le contenu
-- change, jamais le document ni la nature) puis un valideur la valide ou la rejette. Un brouillon non validé ne
-- nourrit RIEN (ni la due diligence, ni la méthode, ni un rapport). Le valideur n'est ni l'auteur du téléversement, ni
-- le demandeur de la lecture, ni le dernier à avoir modifié le contenu, sauf associé (MQG02, comme MPH07).
--
-- nature `lecture_document` (DD-02, DD-10) : résumé et éléments d'un document, chacun avec sa page et un extrait
-- recopié ; nature `standard_proposition` (STD-13) : étapes, briques, éléments et rubriques proposés pour un
-- brouillon de méthode. Le contenu est un objet JSON borné, relu par le code (jamais pris tel quel).
--
-- SQLSTATE : MQG02 (machine à états, séparation des tâches, identité).

CREATE TABLE ingestion_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  document_id uuid NOT NULL,
  nature text NOT NULL CHECK (nature IN ('lecture_document', 'standard_proposition')),
  statut text NOT NULL DEFAULT 'brouillon_ia' CHECK (statut IN ('brouillon_ia', 'modifie', 'valide', 'rejete')),
  contenu jsonb NOT NULL CHECK (jsonb_typeof(contenu) = 'object' AND octet_length(contenu::text) <= 300000),
  -- Demande de l'orchestrateur (ia_demandes) dont le brouillon est issu ; sans clé étrangère (conservation propre).
  ia_demande_id uuid,
  -- Des extraits ou des nombres du brouillon ne se retrouvent pas dans la page citée : à acquitter pour valider.
  chiffres_non_verifies boolean NOT NULL DEFAULT false,
  cree_par uuid NOT NULL,
  -- Utilisateur qui a demandé la lecture (auteur du téléversement, ou celui qui l'a relancée) : comme l'auteur du
  -- document (`cree_par`) et le dernier modificateur, il ne valide pas le brouillon (MQG02), sauf associé.
  demande_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_par uuid,
  modifie_le timestamptz,
  valide_par uuid,
  valide_le timestamptz,
  motif_rejet text CHECK (motif_rejet IS NULL OR length(btrim(motif_rejet)) BETWEEN 1 AND 1000),
  -- Application d'une proposition validée (STD-13) : identifiants des éléments créés dans le brouillon cible.
  resultat jsonb CHECK (resultat IS NULL OR (jsonb_typeof(resultat) = 'object' AND octet_length(resultat::text) <= 20000)),
  UNIQUE (cabinet_id, id),
  CHECK ((statut = 'modifie') = (modifie_par IS NOT NULL AND modifie_le IS NOT NULL)
         OR (statut IN ('valide', 'rejete'))),
  CHECK ((statut IN ('valide', 'rejete')) = (valide_par IS NOT NULL AND valide_le IS NOT NULL)),
  CHECK ((statut = 'rejete') = (motif_rejet IS NOT NULL)),
  CHECK (resultat IS NULL OR statut = 'valide'),
  FOREIGN KEY (cabinet_id, document_id) REFERENCES ingestion_documents (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, demande_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, valide_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX ingestion_extractions_document_idx ON ingestion_extractions (cabinet_id, document_id, cree_le DESC, id);
-- Un seul brouillon ouvert par document (une relance exige de trancher le précédent).
CREATE UNIQUE INDEX ingestion_extractions_ouverte_uniq ON ingestion_extractions (document_id)
  WHERE statut IN ('brouillon_ia', 'modifie');
ALTER TABLE ingestion_extractions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON ingestion_extractions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON ingestion_extractions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON ingestion_extractions FROM missionpilot_app;
CREATE TRIGGER ingestion_extractions_auteur_sans_portail BEFORE INSERT ON ingestion_extractions
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('cree_par');

CREATE FUNCTION controler_ingestion_extraction() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une extraction ne se supprime pas.' USING ERRCODE = 'MQG02';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.statut <> 'brouillon_ia' THEN
        RAISE EXCEPTION 'Une extraction naît « brouillon_ia ».' USING ERRCODE = 'MQG02';
      END IF;
      RETURN NEW;
    END IF;
    IF (NEW.cabinet_id, NEW.document_id, NEW.nature, NEW.ia_demande_id, NEW.cree_par, NEW.demande_par, NEW.cree_le)
       IS DISTINCT FROM
       (OLD.cabinet_id, OLD.document_id, OLD.nature, OLD.ia_demande_id, OLD.cree_par, OLD.demande_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'Extraction : identité non modifiable.' USING ERRCODE = 'MQG02';
    END IF;
    IF OLD.statut IN ('valide', 'rejete') THEN
      RAISE EXCEPTION 'Extraction tranchée : non modifiable.' USING ERRCODE = 'MQG02';
    END IF;
    IF NEW.statut IN ('brouillon_ia', 'modifie') THEN
      -- Correction humaine : le brouillon reste ouvert, seul le contenu et le drapeau de vérification changent.
      IF NEW.statut = 'brouillon_ia' THEN
        RAISE EXCEPTION 'Extraction : retour à « brouillon_ia » refusé.' USING ERRCODE = 'MQG02';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.statut = 'valide' THEN
      -- Valideur différent de l'auteur du téléversement, du demandeur de la lecture et du dernier modificateur,
      -- sauf associé.
      IF NEW.valide_par IN (OLD.cree_par, OLD.demande_par, OLD.modifie_par) AND NOT EXISTS (
           SELECT 1 FROM utilisateurs u
           WHERE u.id = NEW.valide_par AND u.actif AND 'associe' = ANY (u.roles)) THEN
        RAISE EXCEPTION 'L''auteur, le demandeur ou le dernier modificateur ne valide pas son propre brouillon.'
          USING ERRCODE = 'MQG02';
      END IF;
      IF (NEW.contenu IS DISTINCT FROM OLD.contenu) THEN
        RAISE EXCEPTION 'Extraction : le contenu ne change pas au moment de la validation.' USING ERRCODE = 'MQG02';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER ingestion_extractions_controle BEFORE INSERT OR UPDATE OR DELETE ON ingestion_extractions
  FOR EACH ROW EXECUTE FUNCTION controler_ingestion_extraction();
