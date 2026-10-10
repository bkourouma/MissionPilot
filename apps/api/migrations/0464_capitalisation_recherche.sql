-- Capitalisation (lot CAP) — recherche unifiée plein texte français (CAP-07).
--
-- Index GIN sur l'expression EXACTE employée par les requêtes de `capitalisation/recherche.ts`
-- (`cap_tsv(...)`, 0460) : missions (intitulé, secteur, activité), livrables (nom du document),
-- preuves (source précise et extrait de la version). Les retours d'expérience ont leur index
-- dans 0460. Aucune donnée n'est copiée : les droits restent ceux des tables d'origine (RLS du
-- cabinet, puis visibilité de la mission et permissions vérifiées par l'API). Pas de pgvector :
-- la recherche sémantique reste facultative (DECISIONS.md, « Recherche sémantique »).

CREATE INDEX missions_recherche_idx ON missions
  USING gin (cap_tsv(intitule || ' ' || coalesce(secteur, '') || ' ' || coalesce(activite, '')));

CREATE INDEX mission_documents_recherche_idx ON mission_documents USING gin (cap_tsv(nom));

CREATE INDEX preuve_versions_recherche_idx ON preuve_versions
  USING gin (cap_tsv(source_precise || ' ' || coalesce(extrait, '')));
