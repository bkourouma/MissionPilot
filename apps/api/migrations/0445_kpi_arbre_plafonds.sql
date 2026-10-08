-- Arbres d'indicateurs (KPI-13) : plafonds appliqués aussi à la RÉACTIVATION et au total des nœuds
-- (audit du lot pilotage KPI).
--
-- Avant (0440) : les 50 nœuds actifs et le parent actif ne se contrôlaient qu'à l'INSERT. Un nœud
-- désactivé pouvait être réactivé (UPDATE actif = true) au-delà de 50 nœuds actifs, ou sous un
-- parent désactivé ; et le nombre TOTAL de nœuds (désactivés compris, jamais supprimés) n'était pas
-- borné, alors que les lectures sont plafonnées : une lecture pouvait tronquer l'arbre en silence.
-- Désormais :
--   - réactivation : parent actif (MPK12) et au plus 50 nœuds actifs (MPK13) ;
--   - insertion : au plus 200 nœuds au total, désactivés compris (MPK13) ; les 50 actifs ne
--     s'appliquent qu'à un nœud inséré actif.
-- `noeudsDe` (apps/api/src/kpi/arbres.ts) lit donc tout l'arbre sans plafond arbitraire.
--
-- Fonction redéfinie (CREATE OR REPLACE) ; la 0440 reste intacte. Mêmes SQLSTATE qu'avant.

CREATE OR REPLACE FUNCTION controler_kpi_noeud() RETURNS trigger
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
      -- Un parent désactivé n'accueille ni nouveau nœud ni réactivation d'un enfant.
      IF NOT FOUND OR v_parent.arbre_id <> NEW.arbre_id
         OR (NOT v_parent.actif AND (TG_OP = 'INSERT' OR (NEW.actif AND NOT OLD.actif))) THEN
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
      IF (SELECT count(*) FROM kpi_arbre_noeuds n WHERE n.arbre_id = NEW.arbre_id) >= 200 THEN
        RAISE EXCEPTION 'Un arbre compte au plus 200 nœuds, désactivés compris.' USING ERRCODE = 'MPK13';
      END IF;
      IF NEW.actif AND (SELECT count(*) FROM kpi_arbre_noeuds n
                        WHERE n.arbre_id = NEW.arbre_id AND n.actif) >= 50 THEN
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
      -- Réactivation : mêmes plafonds qu'à l'insertion (le nœud est inactif : il n'est pas compté).
      IF NOT OLD.actif AND NEW.actif AND (SELECT count(*) FROM kpi_arbre_noeuds n
                                          WHERE n.arbre_id = NEW.arbre_id AND n.actif) >= 50 THEN
        RAISE EXCEPTION 'Un arbre compte au plus 50 nœuds actifs.' USING ERRCODE = 'MPK13';
      END IF;
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
