-- Durcissement issu de l'audit de sécurité des missions, du budget et des propositions.

-- F3. Une invitation n'est utilisable que si son auteur est un associé actif
-- DU MÊME cabinet : plus d'invitation sans auteur (invite_par NULL).
-- CREATE OR REPLACE conserve les droits (REVOKE PUBLIC, GRANT missionpilot_app).
CREATE OR REPLACE FUNCTION resoudre_invitation(p_jeton_hash text)
  RETURNS TABLE (invitation_id uuid, cabinet_id uuid, email text, roles text[])
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT i.id, i.cabinet_id, i.email, i.roles FROM invitations i
        WHERE i.jeton_hash = p_jeton_hash AND i.expire_le > now() AND i.acceptee_le IS NULL
          AND EXISTS (
                SELECT 1 FROM utilisateurs u
                WHERE u.id = i.invite_par AND u.cabinet_id = i.cabinet_id
                  AND u.actif AND 'associe' = ANY (u.roles)) $$;

-- F4. Une version de budget figée a toujours un valideur (signataire pour le
-- budget initial, valideur de la révision sinon).
ALTER TABLE budget_versions
  ADD CONSTRAINT budget_versions_figee_validee CHECK (NOT figee OR validee_par IS NOT NULL);

-- F5. Signature figée (MIS-07, FIN-04) : la proposition d'origine et le mode
-- de facturation ne changent plus non plus après la signature.
CREATE OR REPLACE FUNCTION refuser_modification_signature() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF OLD.date_signature IS NOT NULL AND
       (NEW.date_signature, NEW.signee_par, NEW.devise, NEW.taux_change, NEW.devise_reference,
        NEW.proposition_id, NEW.mode_facturation)
         IS DISTINCT FROM
       (OLD.date_signature, OLD.signee_par, OLD.devise, OLD.taux_change, OLD.devise_reference,
        OLD.proposition_id, OLD.mode_facturation) THEN
      RAISE EXCEPTION 'Mission signée : signature, devise, taux de change, proposition et mode de facturation sont figés.'
        USING ERRCODE = 'MPF01';
    END IF;
    RETURN NEW;
  END $$;

-- F7. Une seule proposition acceptée par opportunité (verrou en base, en plus
-- du contrôle applicatif sous verrou de l'opportunité).
CREATE UNIQUE INDEX propositions_acceptee_uniq ON propositions (opportunite_id)
  WHERE statut = 'acceptee';
