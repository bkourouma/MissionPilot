-- Limitation PERSISTANTE des codes de second facteur (SOC-02, constat M5).
--
-- Le limiteur en mémoire de l'API reste la première barrière, mais il se perd
-- au redémarrage et n'est pas partagé entre instances. Le compteur d'échecs
-- consécutifs est donc tenu en base, sur la ligne utilisateurs_2fa, lue et mise
-- à jour sous son verrou (FOR UPDATE) par verifierFacteur :
--   5 échecs → blocage 1 min, 8 → 15 min, 12 → 1 h (à chaque échec au-delà) ;
--   remise à zéro au premier succès.

ALTER TABLE utilisateurs_2fa
  ADD COLUMN echecs smallint NOT NULL DEFAULT 0 CHECK (echecs BETWEEN 0 AND 10000),
  ADD COLUMN bloque_jusqu_au timestamptz;
