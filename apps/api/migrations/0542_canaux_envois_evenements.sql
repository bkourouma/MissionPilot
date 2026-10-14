-- Canaux simulés (lot 3c, SPEC-3c §6.3) : journal d'envois SANS contenu et événements reçus.
--
-- `canaux_envois` : une ligne par message sortant, jamais un texte, un numéro ni un nom
-- (empreinte HMAC du texte rendu et longueur seulement). La clé `cle` (unique par cabinet) rend
-- la mise en file idempotente ; l'envoi est « au plus une fois » (SPEC-3c §7.1) : un envoi
-- `en_cours` ou `incertain` n'est jamais renvoyé automatiquement.
-- `canaux_evenements_recus` : anti-rejeu et traçabilité du webhook, SANS texte ni numéro.
--
-- MPH03 : envoi, transition interdite, identité modifiée, suppression.

CREATE TABLE canaux_envois (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  canal text NOT NULL CHECK (canal IN ('whatsapp', 'sms')),
  compte_id uuid NOT NULL,
  destinataire_id uuid NOT NULL,
  gabarit text NOT NULL CHECK (gabarit ~ '^[a-z0-9_]{1,60}$'),
  categorie text NOT NULL CHECK (categorie IN ('verification', 'relance', 'synthese', 'alerte',
    'signature', 'reponse_service')),
  objet_type text NOT NULL CHECK (objet_type IN ('questionnaire_envoi', 'signature_demande',
    'kpi_saisie', 'synthese', 'verification', 'kpi_alerte')),
  objet_id uuid NOT NULL,
  cle text NOT NULL CHECK (length(cle) BETWEEN 1 AND 200),
  statut text NOT NULL DEFAULT 'reserve' CHECK (statut IN ('reserve', 'en_cours', 'accepte',
    'livre', 'lu', 'echec', 'bloque', 'incertain')),
  motif_blocage text CHECK (motif_blocage IN ('consentement_absent', 'consentement_retire',
    'numero_non_verifie', 'canal_inactif', 'destinataire_inactif', 'coupe_circuit',
    'plafond_destinataire', 'plafond_cabinet', 'plafond_reponses', 'fenetre_fermee')),
  id_externe text CHECK (id_externe IS NULL OR length(id_externe) BETWEEN 1 AND 100),
  code_refus text CHECK (code_refus IN ('NUMERO_NON_JOIGNABLE', 'GABARIT_REFUSE', 'QUOTA_ATTEINT',
    'FENETRE_FERMEE', 'INDISPONIBLE')),
  fournisseur text NOT NULL DEFAULT 'simule' CHECK (fournisseur = 'simule'),
  mode_fournisseur text NOT NULL DEFAULT 'simule' CHECK (mode_fournisseur = 'simule'),
  repli_de uuid,
  tentatives smallint NOT NULL DEFAULT 0 CHECK (tentatives BETWEEN 0 AND 20),
  longueur int CHECK (longueur IS NULL OR longueur BETWEEN 0 AND 5000),
  empreinte_contenu text CHECK (empreinte_contenu IS NULL OR empreinte_contenu ~ '^[0-9a-f]{64}$'),
  -- FIN-02 : absent des réponses sans `finance.lire` ; nul en simulé.
  cout_estime_micro_usd bigint CHECK (cout_estime_micro_usd IS NULL OR cout_estime_micro_usd >= 0),
  cree_le timestamptz NOT NULL DEFAULT now(),
  en_cours_le timestamptz,
  accepte_le timestamptz,
  termine_le timestamptz,
  CHECK ((statut = 'bloque') = (motif_blocage IS NOT NULL)),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, cle),
  FOREIGN KEY (cabinet_id, compte_id) REFERENCES canaux_comptes (cabinet_id, id),
  FOREIGN KEY (cabinet_id, destinataire_id, canal)
    REFERENCES canaux_destinataires (cabinet_id, id, canal),
  FOREIGN KEY (cabinet_id, repli_de) REFERENCES canaux_envois (cabinet_id, id)
);
CREATE UNIQUE INDEX canaux_envois_externe_uniq ON canaux_envois (cabinet_id, canal, id_externe)
  WHERE id_externe IS NOT NULL;
CREATE INDEX canaux_envois_destinataire_idx ON canaux_envois (cabinet_id, destinataire_id, cree_le DESC);
CREATE INDEX canaux_envois_cabinet_idx ON canaux_envois (cabinet_id, cree_le DESC, id);
CREATE INDEX canaux_envois_en_cours_idx ON canaux_envois (cabinet_id, en_cours_le)
  WHERE statut = 'en_cours';
ALTER TABLE canaux_envois ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON canaux_envois
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON canaux_envois AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON canaux_envois FROM missionpilot_app;

CREATE FUNCTION controler_canal_envoi() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Un envoi ne se supprime pas.' USING ERRCODE = 'MPH03';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.statut NOT IN ('reserve', 'bloque') THEN
        RAISE EXCEPTION 'Un envoi naît « reserve » ou « bloque ».' USING ERRCODE = 'MPH03';
      END IF;
      RETURN NEW;
    END IF;
    IF (NEW.cabinet_id, NEW.canal, NEW.destinataire_id, NEW.gabarit, NEW.categorie, NEW.objet_type,
        NEW.objet_id, NEW.cle, NEW.repli_de, NEW.compte_id)
       IS DISTINCT FROM
       (OLD.cabinet_id, OLD.canal, OLD.destinataire_id, OLD.gabarit, OLD.categorie, OLD.objet_type,
        OLD.objet_id, OLD.cle, OLD.repli_de, OLD.compte_id) THEN
      RAISE EXCEPTION 'Envoi : identité non modifiable.' USING ERRCODE = 'MPH03';
    END IF;
    IF OLD.id_externe IS NOT NULL AND NEW.id_externe IS DISTINCT FROM OLD.id_externe THEN
      RAISE EXCEPTION 'Envoi : identifiant externe non modifiable.' USING ERRCODE = 'MPH03';
    END IF;
    IF NEW.statut = OLD.statut THEN
      IF OLD.statut IN ('bloque', 'echec', 'incertain', 'lu') THEN
        RAISE EXCEPTION 'Envoi terminé : non modifiable.' USING ERRCODE = 'MPH03';
      END IF;
      RETURN NEW;
    END IF;
    IF NOT (
      (OLD.statut = 'reserve' AND NEW.statut IN ('en_cours', 'bloque'))
      OR (OLD.statut = 'en_cours' AND NEW.statut IN ('accepte', 'echec', 'incertain'))
      OR (OLD.statut = 'en_cours' AND NEW.statut = 'reserve' AND NEW.code_refus = 'INDISPONIBLE')
      OR (OLD.statut = 'accepte' AND NEW.statut IN ('livre', 'lu', 'echec'))
      OR (OLD.statut = 'livre' AND NEW.statut = 'lu')) THEN
      RAISE EXCEPTION 'Transition d''envoi interdite : % vers %.', OLD.statut, NEW.statut
        USING ERRCODE = 'MPH03';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER canaux_envois_controle BEFORE INSERT OR UPDATE OR DELETE ON canaux_envois
  FOR EACH ROW EXECUTE FUNCTION controler_canal_envoi();

CREATE TABLE canaux_evenements_recus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  canal text NOT NULL CHECK (canal IN ('whatsapp', 'sms')),
  compte_id uuid NOT NULL,
  evenement_id text NOT NULL CHECK (evenement_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  type text NOT NULL CHECK (type IN ('message', 'statut')),
  genre text CHECK (genre IN ('texte', 'audio', 'autre')),
  destinataire_id uuid,
  horodatage_fournisseur timestamptz,
  recu_le timestamptz NOT NULL DEFAULT now(),
  traitement text NOT NULL DEFAULT 'a_traiter' CHECK (traitement IN ('traite', 'ignore', 'a_traiter')),
  motif_ignore text CHECK (motif_ignore IS NULL OR motif_ignore ~ '^[a-z_]{1,60}$'),
  -- Une référence de média (jamais son contenu) : `ref_media`, `type_mime`, `duree_ms`.
  media jsonb CHECK (media IS NULL OR pg_column_size(media) <= 1024),
  UNIQUE (cabinet_id, canal, evenement_id),
  FOREIGN KEY (cabinet_id, compte_id) REFERENCES canaux_comptes (cabinet_id, id),
  FOREIGN KEY (cabinet_id, destinataire_id) REFERENCES canaux_destinataires (cabinet_id, id)
);
CREATE INDEX canaux_evenements_recus_purge_idx ON canaux_evenements_recus (cabinet_id, recu_le);
ALTER TABLE canaux_evenements_recus ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON canaux_evenements_recus
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON canaux_evenements_recus AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
