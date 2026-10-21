-- Validation réservée au directeur de la mission (hypothèse métier du lot 2, décision du superviseur
-- 2026-10-21), DOUBLÉE en base : redéfinit les fonctions des déclencheurs de `red_plan_versions` (0486,
-- commitée : non modifiée) et de `red_clotures` (0490). Le valideur doit être `missions.directeur_id` de la
-- mission du dossier ; une mission sans directeur ne valide rien (MPZ07, message distinct). Le reste des
-- fonctions est repris À L'IDENTIQUE. Les déclencheurs existants pointent déjà vers ces fonctions.

CREATE OR REPLACE FUNCTION red_controler_plan_version() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_derniere int; v_directeur uuid;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une version de plan ne se supprime pas.' USING ERRCODE = 'MPZ01';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.statut <> 'brouillon' THEN
        RAISE EXCEPTION 'Une version de plan naît en brouillon.' USING ERRCODE = 'MPZ06';
      END IF;
      RETURN NEW;
    END IF;
    -- UPDATE : la seule transition admise est la validation.
    IF OLD.statut <> 'brouillon' OR NEW.statut <> 'valide' THEN
      RAISE EXCEPTION 'Seule la validation d''un brouillon est admise.' USING ERRCODE = 'MPZ06';
    END IF;
    IF (NEW.cabinet_id, NEW.dossier_id, NEW.version, NEW.date_reference, NEW.contenu, NEW.empreinte,
        NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.dossier_id, OLD.version, OLD.date_reference, OLD.contenu,
        OLD.empreinte, OLD.cree_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'Le contenu d''une version de plan est figé.' USING ERRCODE = 'MPZ04';
    END IF;
    SELECT max(v.version) INTO v_derniere FROM red_plan_versions v WHERE v.dossier_id = NEW.dossier_id;
    IF NEW.version <> v_derniere THEN
      RAISE EXCEPTION 'Seule la dernière version du plan se valide.' USING ERRCODE = 'MPZ05';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM utilisateurs u
                   WHERE u.id = NEW.valide_par AND u.actif
                     AND u.roles && ARRAY['associe', 'directeur_mission']) THEN
      RAISE EXCEPTION 'Le plan est validé par un associé ou un directeur de mission actif.'
        USING ERRCODE = 'MPZ07';
    END IF;
    -- 0492 : seul le directeur de la mission valide le plan, et une mission sans directeur ne valide rien.
    SELECT m.directeur_id INTO v_directeur
      FROM red_dossiers d JOIN missions m ON m.cabinet_id = d.cabinet_id AND m.id = d.mission_id
      WHERE d.id = NEW.dossier_id;
    IF v_directeur IS NULL THEN
      RAISE EXCEPTION 'Une mission sans directeur ne valide ni plan ni bilan de clôture.'
        USING ERRCODE = 'MPZ07';
    END IF;
    IF NEW.valide_par <> v_directeur THEN
      RAISE EXCEPTION 'Seul le directeur de la mission valide le plan.'
        USING ERRCODE = 'MPZ07';
    END IF;
    IF NEW.valide_par = NEW.cree_par AND NOT red_valideur_dispense(NEW.valide_par) THEN
      RAISE EXCEPTION 'Le créateur d''une version de plan ne la valide pas lui-même.'
        USING ERRCODE = 'MPZ07';
    END IF;
    RETURN NEW;
  END $$;

CREATE OR REPLACE FUNCTION red_controler_cloture() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE v_derniere int; v_directeur uuid;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Un bilan de clôture ne se supprime pas.' USING ERRCODE = 'MPZ01';
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.statut <> 'brouillon' THEN
        RAISE EXCEPTION 'Un bilan de clôture naît en brouillon.' USING ERRCODE = 'MPZ06';
      END IF;
      -- Les contrôles consignés et la colonne `complet` concordent.
      IF jsonb_typeof(NEW.contenu -> 'complet') IS DISTINCT FROM 'boolean'
         OR (NEW.contenu ->> 'complet')::boolean <> NEW.complet
         OR NEW.complet <> red_cloture_controles_vrais(NEW.contenu) THEN
        RAISE EXCEPTION 'Les contrôles de complétude consignés ne concordent pas avec le bilan.'
          USING ERRCODE = 'MPZ18';
      END IF;
      RETURN NEW;
    END IF;
    -- UPDATE : un bilan validé est figé.
    IF OLD.statut = 'valide' THEN
      RAISE EXCEPTION 'Le bilan de clôture validé est figé.' USING ERRCODE = 'MPZ17';
    END IF;
    -- La seule transition admise est la validation d'un brouillon.
    IF NEW.statut <> 'valide' THEN
      RAISE EXCEPTION 'Seule la validation d''un brouillon est admise.' USING ERRCODE = 'MPZ06';
    END IF;
    IF (NEW.cabinet_id, NEW.dossier_id, NEW.version, NEW.date_reference, NEW.contenu, NEW.empreinte,
        NEW.complet, NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.dossier_id, OLD.version, OLD.date_reference, OLD.contenu,
        OLD.empreinte, OLD.complet, OLD.cree_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'Le contenu d''un bilan de clôture est figé.' USING ERRCODE = 'MPZ04';
    END IF;
    SELECT max(c.version) INTO v_derniere FROM red_clotures c WHERE c.dossier_id = NEW.dossier_id;
    IF NEW.version <> v_derniere THEN
      RAISE EXCEPTION 'Seule la dernière version du bilan de clôture se valide.' USING ERRCODE = 'MPZ05';
    END IF;
    IF NOT NEW.complet OR NOT red_cloture_controles_vrais(NEW.contenu) THEN
      RAISE EXCEPTION 'Le bilan de clôture est incomplet : un contrôle bloquant n''est pas satisfait.'
        USING ERRCODE = 'MPZ18';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM utilisateurs u
                   WHERE u.id = NEW.valide_par AND u.actif
                     AND u.roles && ARRAY['associe', 'directeur_mission']) THEN
      RAISE EXCEPTION 'Le bilan est validé par un associé ou un directeur de mission actif.'
        USING ERRCODE = 'MPZ07';
    END IF;
    -- 0492 : seul le directeur de la mission valide le bilan de clôture, et une mission sans directeur ne valide rien.
    SELECT m.directeur_id INTO v_directeur
      FROM red_dossiers d JOIN missions m ON m.cabinet_id = d.cabinet_id AND m.id = d.mission_id
      WHERE d.id = NEW.dossier_id;
    IF v_directeur IS NULL THEN
      RAISE EXCEPTION 'Une mission sans directeur ne valide ni plan ni bilan de clôture.'
        USING ERRCODE = 'MPZ07';
    END IF;
    IF NEW.valide_par <> v_directeur THEN
      RAISE EXCEPTION 'Seul le directeur de la mission valide le bilan de clôture.'
        USING ERRCODE = 'MPZ07';
    END IF;
    IF NEW.valide_par = NEW.cree_par AND NOT red_valideur_dispense(NEW.valide_par) THEN
      RAISE EXCEPTION 'Le créateur d''un bilan de clôture ne le valide pas lui-même.'
        USING ERRCODE = 'MPZ07';
    END IF;
    RETURN NEW;
  END $$;
