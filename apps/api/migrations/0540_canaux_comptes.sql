-- Canaux externes SIMULÉS (lot 3c, SPEC-3c §6.1) : comptes de canal.
--
-- Règle ferme : aucun fournisseur réel. Un compte de canal décrit seulement l'état du canal d'un
-- cabinet (actif ou non, options) ; le fournisseur est toujours `simule` (CHECK) tant qu'aucun
-- adaptateur réel n'existe. L'identifiant public du compte (`cpt-` + 16 hexadécimaux) est
-- GÉNÉRÉ par le serveur, jamais saisi : il sert à résoudre le cabinet d'un webhook entrant sans
-- rien révéler sur l'existence d'un compte d'un autre cabinet.
--
-- Codes SQLSTATE du lot (lettre H, SPEC-3c §6.10) : MPH01 à MPH12.
-- MPH04 : l'activation d'un compte est réservée à un associé actif du cabinet (doublé en base du
-- contrôle d'API, comme MPU02) ; désactiver reste permis à tout titulaire de `canaux.gerer`.

CREATE TABLE canaux_comptes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  canal text NOT NULL CHECK (canal IN ('whatsapp', 'sms')),
  fournisseur text NOT NULL DEFAULT 'simule' CHECK (fournisseur = 'simule'),
  identifiant_compte text NOT NULL CHECK (identifiant_compte ~ '^cpt-[0-9a-f]{16}$'),
  actif boolean NOT NULL DEFAULT false,
  repli_sms boolean NOT NULL DEFAULT true,
  relance_questionnaire_j10 boolean NOT NULL DEFAULT true,
  synthese_hebdo boolean NOT NULL DEFAULT false,
  saisie_kpi boolean NOT NULL DEFAULT false,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_le timestamptz NOT NULL DEFAULT now(),
  modifie_par uuid NOT NULL,
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, canal),
  UNIQUE (canal, identifiant_compte),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE canaux_comptes ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON canaux_comptes
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON canaux_comptes AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON canaux_comptes FROM missionpilot_app;

CREATE FUNCTION controler_canal_compte() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.cabinet_id, NEW.canal, NEW.identifiant_compte, NEW.fournisseur)
         IS DISTINCT FROM (OLD.cabinet_id, OLD.canal, OLD.identifiant_compte, OLD.fournisseur) THEN
      RAISE EXCEPTION 'Compte de canal : canal, identifiant et fournisseur sont figés.'
        USING ERRCODE = 'MPH04';
    END IF;
    IF NEW.actif AND (TG_OP = 'INSERT' OR NOT OLD.actif) THEN
      IF NOT EXISTS (SELECT 1 FROM utilisateurs u
                     WHERE u.id = NEW.modifie_par AND u.actif AND 'associe' = ANY (u.roles)) THEN
        RAISE EXCEPTION 'Activer un canal est réservé à un associé du cabinet.'
          USING ERRCODE = 'MPH04';
      END IF;
    END IF;
    NEW.modifie_le := now();
    RETURN NEW;
  END $$;
CREATE TRIGGER canaux_comptes_controle BEFORE INSERT OR UPDATE ON canaux_comptes
  FOR EACH ROW EXECUTE FUNCTION controler_canal_compte();

-- Résolution du cabinet d'un webhook entrant (route publique signée, hors contexte de cabinet) :
-- rend (cabinet_id, compte_id) d'un compte ACTIF, rien d'autre ; nul si inconnu ou inactif.
-- Paramètres validés : un identifiant mal formé ou un canal inconnu est une erreur.
CREATE FUNCTION resoudre_compte_canal(p_canal text, p_identifiant text)
  RETURNS TABLE (cabinet_id uuid, compte_id uuid)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF p_canal IS NULL OR p_canal NOT IN ('whatsapp', 'sms')
       OR p_identifiant IS NULL OR p_identifiant !~ '^cpt-[0-9a-f]{16}$' THEN
      RAISE EXCEPTION 'Résolution du compte de canal : paramètres invalides.';
    END IF;
    RETURN QUERY
      SELECT c.cabinet_id, c.id FROM canaux_comptes c
      WHERE c.canal = p_canal AND c.identifiant_compte = p_identifiant AND c.actif;
  END $$;

REVOKE ALL ON FUNCTION resoudre_compte_canal(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resoudre_compte_canal(text, text) TO missionpilot_app;
