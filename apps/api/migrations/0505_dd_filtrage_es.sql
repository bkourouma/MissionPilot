-- Filtrage environnemental et social (DD-14) : listes d'exclusion paramétrables, revues d'un
-- dossier et décisions sur les exclusions touchées, en AJOUT SEUL.
--
-- - dd_exclusion_listes          : identité d'une liste (générale, ou d'un investisseur client).
-- - dd_exclusion_liste_versions  : règles (mots-clés, secteurs, pays) saisies par le cabinet ;
--   `reference_cadre` est le NOM d'un cadre public dont la liste s'inspire, jamais un extrait.
-- - dd_filtrages                 : une revue E&S d'un dossier (la dernière fait foi) : déclarations,
--   huit thèmes, résultat de `filtrerExclusions` (packages/engines) figé ; la synthèse E&S est
--   recalculée à chaque lecture avec les décisions.
-- - dd_filtrage_decisions        : journal des décisions sur une règle touchée (confirmée ou
--   écartée comme faux positif) ; le décideur n'est pas l'auteur du filtrage, sauf associé (MPZ28).
--
-- SQLSTATE : MPZ22 (structure des règles, assertion d'un thème d'une autre mission), MPZ23
-- (versions sans trou), MPZ28 (séparation des tâches ; règle absente des règles touchées, signalée
-- par l'indice `regle_inconnue`).

-- Tableau JSON de textes : au plus `p_max` éléments de 1 à `p_longueur` caractères, éventuellement
-- des codes de référentiel (`std_code_valide`) ou des textes significatifs (`p_significatif` : au
-- moins une lettre ou un chiffre, comme `normaliserTexteDd` du moteur de filtrage ; un caractère
-- non ASCII passe aussi, pour ne pas dépendre de la locale de la base).
CREATE FUNCTION dd_json_textes_valides(p_valeur jsonb, p_max integer, p_longueur integer,
                                       p_code boolean, p_significatif boolean DEFAULT false)
  RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF jsonb_typeof(p_valeur) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(p_valeur) > p_max THEN RETURN false; END IF;
    RETURN NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_valeur) e
      WHERE jsonb_typeof(e.value) IS DISTINCT FROM 'string'
         OR length(btrim(e.value #>> '{}')) NOT BETWEEN 1 AND p_longueur
         OR (p_code AND NOT std_code_valide(e.value #>> '{}'))
         OR (p_significatif AND NOT ((e.value #>> '{}') ~ '[[:alnum:]]'
                                     OR (e.value #>> '{}') ~ '[^\x01-\x7F]')));
  END $$;

-- Une règle d'exclusion : code, libellé, mots-clés (≤ 10 de 60 caractères, chacun avec une lettre
-- ou un chiffre), secteurs (≤ 20), pays (≤ 20), au moins un critère renseigné. Mêmes plafonds que
-- `regleExclusionSchema` (packages/shared).
CREATE FUNCTION dd_regle_exclusion_valide(p_regle jsonb) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF jsonb_typeof(p_regle) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
    IF jsonb_typeof(p_regle -> 'code') IS DISTINCT FROM 'string'
       OR NOT std_code_valide(p_regle ->> 'code')
       OR jsonb_typeof(p_regle -> 'libelle') IS DISTINCT FROM 'string'
       OR NOT std_libelle_valide(p_regle ->> 'libelle', 200) THEN
      RETURN false;
    END IF;
    IF NOT dd_json_textes_valides(p_regle -> 'mots_cles', 10, 60, false, true)
       OR NOT dd_json_textes_valides(p_regle -> 'secteur_codes', 20, 120, true)
       OR NOT dd_json_textes_valides(p_regle -> 'pays_codes', 20, 120, true) THEN
      RETURN false;
    END IF;
    RETURN (jsonb_array_length(p_regle -> 'mots_cles') + jsonb_array_length(p_regle -> 'secteur_codes')
            + jsonb_array_length(p_regle -> 'pays_codes')) >= 1;
  END $$;

CREATE TABLE dd_exclusion_listes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  nom text NOT NULL CHECK (std_libelle_valide(nom, 200)),
  client_id uuid,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (cabinet_id, nom),
  FOREIGN KEY (cabinet_id, client_id) REFERENCES clients (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
ALTER TABLE dd_exclusion_listes ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_exclusion_listes
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dd_exclusion_listes AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dd_exclusion_listes FROM missionpilot_app;
CREATE TRIGGER dd_exclusion_listes_ajout_seul BEFORE UPDATE OR DELETE ON dd_exclusion_listes
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();
CREATE TRIGGER dd_exclusion_listes_auteur_sans_portail BEFORE INSERT ON dd_exclusion_listes
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('cree_par');

CREATE TABLE dd_exclusion_liste_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  liste_id uuid NOT NULL,
  version int NOT NULL CHECK (version BETWEEN 1 AND 200),
  regles jsonb NOT NULL,
  reference_cadre text CHECK (reference_cadre IS NULL OR length(reference_cadre) BETWEEN 1 AND 300),
  motif text CHECK (motif IS NULL OR length(motif) BETWEEN 1 AND 500),
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  UNIQUE (liste_id, version),
  UNIQUE (cabinet_id, liste_id, version),
  CHECK ((version = 1) = (motif IS NULL)),
  -- Mêmes plafonds que le schéma (100 règles) : une règle valide du schéma l'est aussi ici.
  CHECK (jsonb_typeof(regles) = 'array' AND jsonb_array_length(regles) BETWEEN 1 AND 100),
  -- Lecture bornée en octets : 100 règles au maximum du schéma (libellé de 200 caractères, 10
  -- mots-clés de 60, 20 secteurs et 20 pays de 120 caractères) pèsent environ 600 Ko en ASCII.
  CONSTRAINT dd_exclusion_liste_versions_regles_octets CHECK (octet_length(regles::text) <= 700000),
  FOREIGN KEY (cabinet_id, liste_id) REFERENCES dd_exclusion_listes (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX dd_exclusion_liste_versions_courante_idx
  ON dd_exclusion_liste_versions (cabinet_id, liste_id, version DESC);
ALTER TABLE dd_exclusion_liste_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_exclusion_liste_versions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dd_exclusion_liste_versions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dd_exclusion_liste_versions FROM missionpilot_app;
CREATE TRIGGER dd_exclusion_liste_versions_ajout_seul
  BEFORE UPDATE OR DELETE ON dd_exclusion_liste_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();
CREATE TRIGGER dd_exclusion_liste_versions_numerotation BEFORE INSERT ON dd_exclusion_liste_versions
  FOR EACH ROW EXECUTE FUNCTION dd_numeroter_version('liste_id');
CREATE TRIGGER dd_exclusion_liste_versions_auteur_sans_portail
  BEFORE INSERT ON dd_exclusion_liste_versions
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('cree_par');

-- Structure des règles (MPZ22) : chacune valide, codes uniques dans la liste.
CREATE FUNCTION controler_dd_exclusion_liste_version() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF jsonb_typeof(NEW.regles) = 'array' THEN
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.regles) r
                 WHERE NOT dd_regle_exclusion_valide(r.value)) THEN
        RAISE EXCEPTION 'Règle d''exclusion mal formée (code, libellé, au moins un critère).'
          USING ERRCODE = 'MPZ22';
      END IF;
      IF (SELECT count(DISTINCT r.value ->> 'code') FROM jsonb_array_elements(NEW.regles) r)
         <> jsonb_array_length(NEW.regles) THEN
        RAISE EXCEPTION 'Les codes des règles d''une liste sont distincts.' USING ERRCODE = 'MPZ22';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER dd_exclusion_liste_versions_controle BEFORE INSERT ON dd_exclusion_liste_versions
  FOR EACH ROW EXECUTE FUNCTION controler_dd_exclusion_liste_version();

CREATE TABLE dd_filtrages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  dossier_id uuid NOT NULL,
  liste_version_id uuid NOT NULL,
  declarations jsonb NOT NULL,
  themes jsonb NOT NULL,
  resultat jsonb NOT NULL,
  auteur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  CHECK (jsonb_typeof(declarations) = 'object'),
  CONSTRAINT dd_filtrages_declarations_octets CHECK (octet_length(declarations::text) <= 20000),
  CHECK (jsonb_typeof(themes) = 'array' AND jsonb_array_length(themes) <= 8),
  CONSTRAINT dd_filtrages_themes_octets CHECK (octet_length(themes::text) <= 20000),
  CHECK (jsonb_typeof(resultat) = 'object' AND octet_length(resultat::text) <= 200000),
  FOREIGN KEY (cabinet_id, dossier_id) REFERENCES dd_dossiers (cabinet_id, id),
  FOREIGN KEY (cabinet_id, liste_version_id)
    REFERENCES dd_exclusion_liste_versions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, auteur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX dd_filtrages_dossier_idx ON dd_filtrages (cabinet_id, dossier_id, numero DESC);
ALTER TABLE dd_filtrages ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_filtrages
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dd_filtrages AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dd_filtrages FROM missionpilot_app;
CREATE TRIGGER dd_filtrages_ajout_seul BEFORE UPDATE OR DELETE ON dd_filtrages
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();
CREATE TRIGGER dd_filtrages_auteur_sans_portail BEFORE INSERT ON dd_filtrages
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('auteur_id');

-- L'assertion citée par un thème appartient à la mission du dossier (MPZ22).
CREATE FUNCTION controler_dd_filtrage() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_mission uuid;
    v_theme jsonb;
    v_assertion text;
  BEGIN
    SELECT d.mission_id INTO v_mission FROM dd_dossiers d WHERE d.id = NEW.dossier_id;
    IF jsonb_typeof(NEW.themes) = 'array' THEN
      FOR v_theme IN SELECT t.value FROM jsonb_array_elements(NEW.themes) t LOOP
        v_assertion := CASE WHEN jsonb_typeof(v_theme) = 'object' THEN v_theme ->> 'assertion_id' END;
        IF v_assertion IS NOT NULL THEN
          IF v_assertion !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             OR NOT EXISTS (SELECT 1 FROM assertions a
                            WHERE a.id = v_assertion::uuid AND a.mission_id = v_mission) THEN
            RAISE EXCEPTION 'L''assertion d''un thème n''appartient pas à la mission du dossier.'
              USING ERRCODE = 'MPZ22';
          END IF;
        END IF;
      END LOOP;
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER dd_filtrages_controle BEFORE INSERT ON dd_filtrages
  FOR EACH ROW EXECUTE FUNCTION controler_dd_filtrage();

CREATE TABLE dd_filtrage_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  numero bigint GENERATED ALWAYS AS IDENTITY,
  filtrage_id uuid NOT NULL,
  regle_code text NOT NULL CHECK (std_code_valide(regle_code)),
  decision text NOT NULL CHECK (decision IN ('confirmee', 'ecartee')),
  motif text NOT NULL CHECK (length(motif) BETWEEN 10 AND 1000),
  decideur_id uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, filtrage_id) REFERENCES dd_filtrages (cabinet_id, id),
  FOREIGN KEY (cabinet_id, decideur_id) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX dd_filtrage_decisions_idx
  ON dd_filtrage_decisions (cabinet_id, filtrage_id, regle_code, numero DESC);
ALTER TABLE dd_filtrage_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON dd_filtrage_decisions
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON dd_filtrage_decisions AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE UPDATE, DELETE ON dd_filtrage_decisions FROM missionpilot_app;
CREATE TRIGGER dd_filtrage_decisions_ajout_seul BEFORE UPDATE OR DELETE ON dd_filtrage_decisions
  FOR EACH ROW EXECUTE FUNCTION refuser_modification_dd();
CREATE TRIGGER dd_filtrage_decisions_auteur_sans_portail BEFORE INSERT ON dd_filtrage_decisions
  FOR EACH ROW EXECUTE FUNCTION refuser_utilisateur_portail('decideur_id');

-- MPZ28 : la règle figure dans les règles touchées du filtrage, OU dans celles d'un filtrage
-- antérieur du même dossier (une exclusion confirmée plus tôt se lève dans le dernier filtrage,
-- même si les activités déclarées ne la touchent plus) ; sinon indice `regle_inconnue` ;
-- le décideur n'est l'auteur ni du filtrage visé ni d'un filtrage PLUS RÉCENT du dossier (numéro
-- supérieur ou égal), sauf associé : sinon l'auteur du dernier filtrage lèverait lui-même, sur un
-- filtrage antérieur, l'exclusion que son propre filtrage ne touche plus (même règle que l'API).
CREATE FUNCTION controler_dd_filtrage_decision() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    f record;
  BEGIN
    SELECT x.auteur_id, x.resultat, x.dossier_id, x.numero INTO f
      FROM dd_filtrages x WHERE x.id = NEW.filtrage_id;
    IF NOT EXISTS (SELECT 1 FROM dd_filtrages g,
                        jsonb_array_elements(CASE WHEN jsonb_typeof(g.resultat -> 'touches') = 'array'
                                                  THEN g.resultat -> 'touches' ELSE '[]'::jsonb END) t
                   WHERE g.dossier_id = f.dossier_id AND g.numero <= f.numero
                     AND jsonb_typeof(t.value) = 'object'
                     AND t.value ->> 'regle' = NEW.regle_code) THEN
      RAISE EXCEPTION 'Cette règle ne figure pas parmi les règles touchées du filtrage.'
        USING ERRCODE = 'MPZ28', HINT = 'regle_inconnue';
    END IF;
    IF NOT est_associe_dd(NEW.decideur_id)
       AND (NEW.decideur_id = f.auteur_id
            OR EXISTS (SELECT 1 FROM dd_filtrages g
                       WHERE g.dossier_id = f.dossier_id AND g.numero >= f.numero
                         AND g.auteur_id = NEW.decideur_id)) THEN
      RAISE EXCEPTION 'L''auteur du filtrage (ou d''un filtrage plus récent) ne décide pas lui-même d''une exclusion.'
        USING ERRCODE = 'MPZ28';
    END IF;
    RETURN NEW;
  END $$;
CREATE TRIGGER dd_filtrage_decisions_controle BEFORE INSERT ON dd_filtrage_decisions
  FOR EACH ROW EXECUTE FUNCTION controler_dd_filtrage_decision();
