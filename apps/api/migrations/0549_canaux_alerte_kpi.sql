-- Canaux simulés (lot 3c, SPEC-3c §17 O-26) : option « alertes de KPI par WhatsApp » du compte de canal.
--
-- Les alertes de KPI sortantes (KPI-06) et les rappels de mesure vers des utilisateurs INTERNES du
-- cabinet par WhatsApp (gabarit `alerte_kpi`) sont DÉSACTIVÉS par défaut : aucune des trois options
-- existantes (relance J+10, synthèse hebdomadaire, saisie de KPI) ne les couvre. Colonne additive,
-- sans nouveau code SQLSTATE ; la règle d'activation du compte (MPH04) reste celle de 0540.

ALTER TABLE canaux_comptes ADD COLUMN alerte_kpi boolean NOT NULL DEFAULT false;
