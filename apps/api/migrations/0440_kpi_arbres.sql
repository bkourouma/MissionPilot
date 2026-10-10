-- Arbres d'indicateurs (KPI-13, PRD complémentaire §11.4) : décomposition d'un
-- KPI en leviers.
--
-- - kpi_arbres        : un arbre par KPI racine (même mission, même cabinet).
-- - kpi_arbre_noeuds  : nœuds de l'arbre ; un nœud est lié à un KPI de la mission
--   (levier mesuré) ou libre. La racine porte le KPI racine. `relation` dit comment
--   les enfants du nœud se combinent (somme pondérée, produit) ; `coefficient` est le
--   poids du nœud dans la somme de son parent (1 sous un produit) ; `rang` fixe l'ordre
--   des frères (ordre de la substitution d'un produit). Le parent d'un nœud est FIGÉ
--   (aucun cycle possible) ; un nœud se désactive, il ne se supprime pas.
--
-- Aucun calcul ici : les valeurs et les contributions sortent de
-- packages/engines/src/kpi/arbre.ts ; les contrôles SQL sont structurels
-- (rattachement, taille, profondeur, cohérence des coefficients).
--
-- SQLSTATE du domaine KPI (suite de MPK01-07, 0160) :
--   MPK10 rattachement incohérent (KPI, alerte, revue ou décision d'une autre mission)
--   MPK11 champ figé (identité d'un arbre, nœud, revue, décision, action)
--   MPK12 parent de nœud invalide (autre arbre, inactif)
--   MPK13 arbre trop grand (50 nœuds actifs ou 6 niveaux sous la racine au plus)
--   MPK14 coefficient différent de 1 sous un produit
--   MPK15 désactivation refusée (racine, ou nœud qui a des enfants actifs)
--   MPK16 mission clôturée : aucune écriture
--   MPK05 (0160) historique en ajout seul, réutilisé par les historiques de ce lot.

CREATE TABLE kpi_arbres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  mission_id uuid NOT NULL,
  kpi_racine_id uuid NOT NULL,
  libelle text NOT NULL CHECK (length(libelle) BETWEEN 1 AND 200),
  description text CHECK (description IS NULL OR length(description) <= 2000),
  actif boolean NOT NULL DEFAULT true,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_par uuid,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  -- Un seul arbre par KPI racine.
  UNIQUE (cabinet_id, kpi_racine_id),
  FOREIGN KEY (cabinet_id, mission_id) REFERENCES missions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, kpi_racine_id) REFERENCES kpi_definitions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id)
);
CREATE INDEX kpi_arbres_mission_idx ON kpi_arbres (cabinet_id, mission_id, lower(libelle), id);
ALTER TABLE kpi_arbres ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON kpi_arbres
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON kpi_arbres AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON kpi_arbres FROM missionpilot_app;

CREATE FUNCTION controler_kpi_arbre() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NOT EXISTS (SELECT 1 FROM kpi_definitions d
                     WHERE d.id = NEW.kpi_racine_id AND d.mission_id = NEW.mission_id) THEN
        RAISE EXCEPTION 'Le KPI racine n''appartient pas à la mission de l''arbre.'
          USING ERRCODE = 'MPK10';
      END IF;
      IF EXISTS (SELECT 1 FROM missions m WHERE m.id = NEW.mission_id AND m.statut = 'cloturee') THEN
        RAISE EXCEPTION 'La mission est clôturée.' USING ERRCODE = 'MPK16';
      END IF;
    ELSIF (NEW.cabinet_id, NEW.mission_id, NEW.kpi_racine_id, NEW.cree_par, NEW.cree_le)
       IS DISTINCT FROM (OLD.cabinet_id, OLD.mission_id, OLD.kpi_racine_id, OLD.cree_par, OLD.cree_le) THEN
      RAISE EXCEPTION 'Mission, KPI racine et création d''un arbre sont figés.'
        USING ERRCODE = 'MPK11';
    END IF;
    NEW.modifie_le := now();
    RETURN NEW;
  END $$;
CREATE TRIGGER kpi_arbres_controle BEFORE INSERT OR UPDATE ON kpi_arbres
  FOR EACH ROW EXECUTE FUNCTION controler_kpi_arbre();

CREATE TABLE kpi_arbre_noeuds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id uuid NOT NULL REFERENCES cabinets (id) ON DELETE CASCADE,
  arbre_id uuid NOT NULL,
  -- NULL : la racine (une seule par arbre).
  parent_id uuid,
  -- KPI de la mission qui mesure ce levier ; NULL : levier libre (valeur à documenter).
  kpi_id uuid,
  libelle text NOT NULL CHECK (length(libelle) BETWEEN 1 AND 200),
  relation text NOT NULL DEFAULT 'somme' CHECK (relation IN ('somme', 'produit')),
  coefficient numeric(10, 4) NOT NULL DEFAULT 1 CHECK (abs(coefficient) <= 1000),
  rang smallint NOT NULL DEFAULT 0 CHECK (rang BETWEEN 0 AND 999),
  actif boolean NOT NULL DEFAULT true,
  cree_par uuid NOT NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  modifie_par uuid,
  modifie_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cabinet_id, id),
  FOREIGN KEY (cabinet_id, arbre_id) REFERENCES kpi_arbres (cabinet_id, id),
  FOREIGN KEY (cabinet_id, parent_id) REFERENCES kpi_arbre_noeuds (cabinet_id, id),
  FOREIGN KEY (cabinet_id, kpi_id) REFERENCES kpi_definitions (cabinet_id, id),
  FOREIGN KEY (cabinet_id, cree_par) REFERENCES utilisateurs (cabinet_id, id),
  FOREIGN KEY (cabinet_id, modifie_par) REFERENCES utilisateurs (cabinet_id, id),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
-- Une seule racine par arbre ; un KPI n'apparaît qu'une fois parmi les nœuds actifs d'un arbre.
CREATE UNIQUE INDEX kpi_arbre_noeuds_racine_uniq ON kpi_arbre_noeuds (cabinet_id, arbre_id)
  WHERE parent_id IS NULL;
CREATE UNIQUE INDEX kpi_arbre_noeuds_kpi_uniq ON kpi_arbre_noeuds (cabinet_id, arbre_id, kpi_id)
  WHERE kpi_id IS NOT NULL AND actif;
CREATE INDEX kpi_arbre_noeuds_arbre_idx ON kpi_arbre_noeuds (cabinet_id, arbre_id, rang, id);
CREATE INDEX kpi_arbre_noeuds_parent_idx ON kpi_arbre_noeuds (cabinet_id, parent_id);
ALTER TABLE kpi_arbre_noeuds ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolation ON kpi_arbre_noeuds
  USING (cabinet_id = app_cabinet_id()) WITH CHECK (cabinet_id = app_cabinet_id());
CREATE POLICY portail_interdit ON kpi_arbre_noeuds AS RESTRICTIVE FOR ALL
  USING (app_portail_client_id() IS NULL);
REVOKE DELETE ON kpi_arbre_noeuds FROM missionpilot_app;

-- Bornes de l'arbre, rattachement des KPI, cohérence des coefficients, désactivation.
-- Fonction d'invocateur : la RLS du cabinet s'applique aux lectures.
CREATE FUNCTION controler_kpi_noeud() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_arbre kpi_arbres%ROWTYPE;
    v_parent kpi_arbre_noeuds%ROWTYPE;
    v_profondeur int;
  BEGIN
    SELECT * INTO v_arbre FROM kpi_arbres a WHERE a.id = NEW.arbre_id;
    IF TG_OP = 'UPDATE' THEN
      IF (NEW.cabinet_id, NEW.arbre_id, NEW.parent_id, NEW.cree_par, NEW.cree_le)
         IS DISTINCT FROM (OLD.cabinet_id, OLD.arbre_id, OLD.parent_id, OLD.cree_par, OLD.cree_le) THEN
        RAISE EXCEPTION 'Arbre, parent et création d''un nœud sont figés.' USING ERRCODE = 'MPK11';
      END IF;
      IF NEW.kpi_id IS DISTINCT FROM OLD.kpi_id AND NEW.parent_id IS NULL THEN
        RAISE EXCEPTION 'La racine porte le KPI racine de l''arbre.' USING ERRCODE = 'MPK10';
      END IF;
    END IF;
    IF NEW.kpi_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM kpi_definitions d WHERE d.id = NEW.kpi_id AND d.mission_id = v_arbre.mission_id) THEN
      RAISE EXCEPTION 'Le KPI du nœud n''appartient pas à la mission de l''arbre.'
        USING ERRCODE = 'MPK10';
    END IF;
    IF NEW.parent_id IS NULL AND NEW.kpi_id IS DISTINCT FROM v_arbre.kpi_racine_id THEN
      RAISE EXCEPTION 'La racine porte le KPI racine de l''arbre.' USING ERRCODE = 'MPK10';
    END IF;
    IF NEW.parent_id IS NOT NULL THEN
      SELECT * INTO v_parent FROM kpi_arbre_noeuds p WHERE p.id = NEW.parent_id;
      IF NOT FOUND OR v_parent.arbre_id <> NEW.arbre_id OR (TG_OP = 'INSERT' AND NOT v_parent.actif) THEN
        RAISE EXCEPTION 'Parent de nœud invalide.' USING ERRCODE = 'MPK12';
      END IF;
      IF v_parent.relation = 'produit' AND NEW.coefficient <> 1 THEN
        RAISE EXCEPTION 'Sous un produit, le coefficient d''un nœud est 1.' USING ERRCODE = 'MPK14';
      END IF;
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF EXISTS (SELECT 1 FROM missions m WHERE m.id = v_arbre.mission_id AND m.statut = 'cloturee') THEN
        RAISE EXCEPTION 'La mission est clôturée.' USING ERRCODE = 'MPK16';
      END IF;
      IF (SELECT count(*) FROM kpi_arbre_noeuds n WHERE n.arbre_id = NEW.arbre_id AND n.actif) >= 50 THEN
        RAISE EXCEPTION 'Un arbre compte au plus 50 nœuds actifs.' USING ERRCODE = 'MPK13';
      END IF;
      IF NEW.parent_id IS NOT NULL THEN
        WITH RECURSIVE ancetres AS (
          SELECT n.id, n.parent_id, 1 AS niveau FROM kpi_arbre_noeuds n WHERE n.id = NEW.parent_id
          UNION ALL
          SELECT n.id, n.parent_id, a.niveau + 1 FROM kpi_arbre_noeuds n
            JOIN ancetres a ON n.id = a.parent_id)
        SELECT max(niveau) INTO v_profondeur FROM ancetres;
        -- Le parent est à `v_profondeur - 1` niveaux sous la racine ; l'enfant, à `v_profondeur`.
        IF v_profondeur > 6 THEN
          RAISE EXCEPTION 'Un arbre compte au plus 6 niveaux sous la racine.' USING ERRCODE = 'MPK13';
        END IF;
      END IF;
    END IF;
    IF TG_OP = 'UPDATE' THEN
      IF OLD.actif AND NOT NEW.actif AND (NEW.parent_id IS NULL OR EXISTS (
           SELECT 1 FROM kpi_arbre_noeuds e WHERE e.parent_id = NEW.id AND e.actif)) THEN
        RAISE EXCEPTION 'Désactivez d''abord les enfants ; la racine ne se désactive pas.'
          USING ERRCODE = 'MPK15';
      END IF;
      IF NEW.relation = 'produit' AND OLD.relation <> 'produit' AND EXISTS (
           SELECT 1 FROM kpi_arbre_noeuds e WHERE e.parent_id = NEW.id AND e.coefficient <> 1) THEN
        RAISE EXCEPTION 'Sous un produit, le coefficient d''un nœud est 1.' USING ERRCODE = 'MPK14';
      END IF;
    END IF;
    NEW.modifie_le := now();
    RETURN NEW;
  END $$;
CREATE TRIGGER kpi_arbre_noeuds_controle BEFORE INSERT OR UPDATE ON kpi_arbre_noeuds
  FOR EACH ROW EXECUTE FUNCTION controler_kpi_noeud();
