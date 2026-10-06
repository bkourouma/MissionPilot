-- Journal d'audit (SOC-06) : index pour la consultation filtrée et paginée.
CREATE INDEX journal_audit_entite_idx ON journal_audit (cabinet_id, entite, entite_id, id DESC);
CREATE INDEX journal_audit_utilisateur_idx ON journal_audit (cabinet_id, utilisateur_id, id DESC);
