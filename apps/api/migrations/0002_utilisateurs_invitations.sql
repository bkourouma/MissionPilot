-- Utilisateurs et invitations (SOC-02).
-- Clé composite (cabinet_id, id) : permet aux tables qui référencent un
-- utilisateur d'imposer, par clé étrangère, qu'il appartient au même cabinet
-- (les contrôles de clé étrangère ne sont pas soumis à RLS).
ALTER TABLE utilisateurs ADD CONSTRAINT utilisateurs_cabinet_id_uniq UNIQUE (cabinet_id, id);

CREATE INDEX invitations_email_en_attente_idx ON invitations (cabinet_id, lower(email))
  WHERE acceptee_le IS NULL;
