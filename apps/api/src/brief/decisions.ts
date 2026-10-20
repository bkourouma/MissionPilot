import {
  chargerVersions,
  roleApprobateurRevision,
  satisfaitRole,
  type VersionDb,
} from "../missions/budget.js";
import { estAssocie, type MissionAcces } from "../missions/acces.js";
import { valideInterne } from "../temps/outils.js";
import {
  a,
  base,
  dateFr,
  donneesFinancieres,
  enSource,
  enSourceFiltree,
  JOUR,
  PLAFOND_PAR_SOURCE,
  texte,
  type ContexteBrief,
  VISIBLE,
  type Extracteur,
} from "./commun.js";

/*
 * Famille « À décider » (1/2) : validations financières et administratives, retour d'expérience
 * et clôture. Chaque source reprend la règle de décision de la route qui valide, SANS jamais
 * proposer à quelqu'un l'élément qu'il a rédigé, soumis ou demandé (séparation des tâches).
 * Le lien mène à l'écran où la décision se prend ; la décision elle-même reste à cet écran.
 */

const ROLES_APPROBATEUR = ["chef_mission", "directeur_mission", "associe"] as const;

/** Facture soumise à approbation (FIN-15) : « facture.valider », jamais l'auteur (route approuver). */
export const facturesAApprouver: Extracteur = async (c) => {
  if (!a(c, "facture.valider")) return null;
  const requis = ROLES_APPROBATEUR.filter((r) => satisfaitRole(c.auth.roles, r));
  const r = await c.db.query(
    `SELECT f.id, f.numero, f.mission_id, m.intitule, ${JOUR("f.soumise_le")} AS depuis,
       f.net_a_payer, f.devise, count(*) OVER ()::int AS total_source
     FROM factures f JOIN missions m ON m.id = f.mission_id
     WHERE f.statut = 'a_approuver' AND ${VISIBLE}
       AND ($3::boolean OR m.directeur_id = $2)
       AND coalesce(f.role_approbateur, 'associe') = ANY ($4::text[])
       AND f.cree_par IS DISTINCT FROM $2 AND f.soumise_par IS DISTINCT FROM $2
       AND NOT ($2::uuid = ANY (f.modifie_par))
     ORDER BY f.soumise_le NULLS LAST, f.id LIMIT $5`,
    [...base(c), estAssocie(c.auth), [...requis], PLAFOND_PAR_SOURCE],
  );
  return enSource("decider", r.rows, (l) => ({
    type: "facture_a_approuver",
    entite_id: l.id as string,
    mission_id: l.mission_id as string,
    entite_libelle: texte(l.numero),
    mission_libelle: texte(l.intitule),
    lien: `/facturation/${l.id as string}`,
    faits: { nature: "attente", depuis: texte(l.depuis) },
    ...donneesFinancieres(c, l.net_a_payer, l.devise),
  }));
};

/** Débours soumis (FIN-05) : associé, chef ou directeur de la mission ; jamais son auteur. */
export const deboursAValider: Extracteur = async (c) => {
  if (!estAssocie(c.auth) && !a(c, "debours.valider")) return null;
  const r = await c.db.query(
    `SELECT d.id, d.mission_id, m.intitule, d.categorie, ${JOUR("d.soumis_le")} AS depuis,
       d.montant, d.devise, count(*) OVER ()::int AS total_source
     FROM debours d JOIN missions m ON m.id = d.mission_id
     WHERE d.statut = 'soumis' AND ${VISIBLE}
       AND ($3::boolean OR m.chef_id = $2 OR m.directeur_id = $2)
       AND d.auteur_id IS DISTINCT FROM $2
     ORDER BY d.soumis_le NULLS LAST, d.id LIMIT $4`,
    [...base(c), estAssocie(c.auth), PLAFOND_PAR_SOURCE],
  );
  return enSource("decider", r.rows, (l) => ({
    type: "debours_a_valider",
    entite_id: l.id as string,
    mission_id: l.mission_id as string,
    entite_libelle: texte(l.categorie),
    mission_libelle: texte(l.intitule),
    lien: `/missions/${l.mission_id as string}/debours`,
    faits: { nature: "attente", depuis: texte(l.depuis) },
    ...donneesFinancieres(c, l.montant, l.devise),
  }));
};

/**
 * Feuille de temps soumise (TPS-03) : chaque partie se décide par le chef ou le directeur de sa
 * mission, un associé, et les activités internes par qui valide en interne ; jamais l'auteur.
 */
export const feuillesAValider: Extracteur = async (c) => {
  if (!a(c, "temps.valider")) return null;
  const r = await c.db.query(
    `SELECT f.id, f.semaine::text AS semaine, co.nom, ${JOUR("f.soumise_le")} AS depuis,
       count(*) OVER ()::int AS total_source
     FROM feuilles_temps f JOIN collaborateurs co ON co.id = f.collaborateur_id
     WHERE f.statut = 'soumise' AND f.auteur_id IS DISTINCT FROM $1::uuid
       AND EXISTS (
         SELECT 1 FROM lignes_temps l LEFT JOIN missions m ON m.id = l.mission_id
         WHERE l.feuille_id = f.id
           AND NOT EXISTS (SELECT 1 FROM feuille_validations v WHERE v.feuille_id = f.id
                           AND v.cycle = f.cycle AND v.mission_id IS NOT DISTINCT FROM l.mission_id)
           AND CASE WHEN l.mission_id IS NULL THEN $3::boolean
                    ELSE ($2::boolean OR m.chef_id = $1 OR m.directeur_id = $1) END)
     ORDER BY f.soumise_le NULLS LAST, f.id LIMIT $4`,
    [c.auth.utilisateurId, estAssocie(c.auth), valideInterne(c.auth), PLAFOND_PAR_SOURCE],
  );
  return enSource("decider", r.rows, (l) => ({
    type: "feuille_a_valider",
    entite_id: l.id as string,
    mission_id: null,
    entite_libelle: `${String(l.nom)}, semaine du ${dateFr(l.semaine)}`,
    mission_libelle: null,
    lien: `/temps/feuilles/${l.id as string}`,
    faits: { nature: "attente", depuis: texte(l.depuis) },
  }));
};

/** Demande de congé (PLN-07) : « conges.valider », jamais sa propre demande. */
export const congesAValider: Extracteur = async (c) => {
  if (!a(c, "conges.valider")) return null;
  const r = await c.db.query(
    `SELECT ab.id, co.nom, ab.date_debut::text AS date_debut, ${JOUR("ab.cree_le")} AS depuis,
       count(*) OVER ()::int AS total_source
     FROM absences ab JOIN collaborateurs co ON co.id = ab.collaborateur_id
     WHERE ab.statut = 'demandee' AND ab.demandeur_id IS DISTINCT FROM $1::uuid
     ORDER BY ab.cree_le, ab.id LIMIT $2`,
    [c.auth.utilisateurId, PLAFOND_PAR_SOURCE],
  );
  return enSource("decider", r.rows, (l) => ({
    type: "conge_a_valider",
    entite_id: l.id as string,
    mission_id: null,
    entite_libelle: `${String(l.nom)}, à partir du ${dateFr(l.date_debut)}`,
    mission_libelle: null,
    lien: "/planning/conges/validation",
    faits: { nature: "attente", depuis: texte(l.depuis) },
  }));
};

/** Proposition soumise (MIS-05) : « proposition.valider » (associé), jamais son auteur. */
export const propositionsAValider: Extracteur = async (c) => {
  if (!a(c, "proposition.valider")) return null;
  const r = await c.db.query(
    `SELECT p.id, p.numero, p.intitule, ${JOUR("p.modifie_le")} AS depuis,
       count(*) OVER ()::int AS total_source
     FROM propositions p
     WHERE p.statut = 'a_valider' AND p.cree_par IS DISTINCT FROM $1::uuid
     ORDER BY p.modifie_le, p.id LIMIT $2`,
    [c.auth.utilisateurId, PLAFOND_PAR_SOURCE],
  );
  return enSource("decider", r.rows, (l) => ({
    type: "proposition_a_valider",
    entite_id: l.id as string,
    mission_id: null,
    entite_libelle: `${String(l.intitule)} (version ${String(l.numero)})`,
    mission_libelle: null,
    lien: `/pipeline/propositions/${l.id as string}`,
    faits: { nature: "attente", depuis: texte(l.depuis) },
  }));
};

/**
 * Retour d'expérience en brouillon (CAP-01) : validé par un associé, le chef ou le directeur de la
 * mission (`mission.planifier`, lecture `connaissance.lire`). Exception voulue du PRD : le chef
 * valide la version qu'il a lui-même demandée, donc pas de séparation à appliquer ici.
 */
export const retoursAValider: Extracteur = async (c) => {
  if (!a(c, "connaissance.lire") || !a(c, "mission.planifier")) return null;
  const r = await c.db.query(
    `SELECT t.id, t.mission_id, m.intitule, ${JOUR("t.ouvert_le")} AS depuis,
       count(*) OVER ()::int AS total_source
     FROM retours_experience t JOIN missions m ON m.id = t.mission_id
     WHERE t.statut = 'brouillon' AND ${VISIBLE}
       AND ($3::boolean OR m.chef_id = $2 OR m.directeur_id = $2)
     ORDER BY t.ouvert_le, t.id LIMIT $4`,
    [...base(c), estAssocie(c.auth), PLAFOND_PAR_SOURCE],
  );
  return enSource("decider", r.rows, (l) => ({
    type: "retour_a_valider",
    entite_id: l.id as string,
    mission_id: l.mission_id as string,
    entite_libelle: null,
    mission_libelle: texte(l.intitule),
    lien: `/connaissances/retours/${l.id as string}`,
    faits: { nature: "attente", depuis: texte(l.depuis) },
  }));
};

/**
 * Mission à clôturer (AUT-08) : « mission.cloturer » (directeur de mission, associé). Séparation des
 * tâches MPX03 (`cloture/evaluation.ts`, déclencheur 0323) : qui a accordé une dérogation EN VIGUEUR
 * de la check-list (dernière ligne « accordée » de chaque contrôle) ne clôt pas la mission, sauf
 * associé ; la mission ne lui est donc pas proposée.
 */
export const cloturesEnAttente: Extracteur = async (c) => {
  if (!a(c, "mission.cloturer")) return null;
  const r = await c.db.query(
    `SELECT m.id, m.intitule, ${JOUR("m.modifie_le")} AS depuis, count(*) OVER ()::int AS total_source
     FROM missions m
     WHERE m.statut = 'a_cloturer' AND ${VISIBLE}
       AND ($3::boolean OR NOT EXISTS (
         SELECT 1 FROM (
           SELECT DISTINCT ON (d.controle) d.action, d.par FROM cloture_derogations d
           WHERE d.mission_id = m.id ORDER BY d.controle, d.le DESC, d.id DESC
         ) l WHERE l.action = 'accordee' AND l.par = $2))
     ORDER BY m.modifie_le, m.id LIMIT $4`,
    [...base(c), estAssocie(c.auth), PLAFOND_PAR_SOURCE],
  );
  return enSource("decider", r.rows, (l) => ({
    type: "cloture_en_attente",
    entite_id: l.id as string,
    mission_id: l.id as string,
    entite_libelle: null,
    mission_libelle: texte(l.intitule),
    lien: `/missions/${l.id as string}/cloture`,
    faits: { nature: "attente", depuis: texte(l.depuis) },
  }));
};

type Ligne = Record<string, unknown>;

/**
 * Un non-associé ne valide une révision que si le palier d'approbation (FIN-15, moteur finance)
 * ne l'élève pas au rang d'associé. Le calcul reste interne : seul le RÔLE exigé en sort, jamais
 * un écart ni un montant. Palier non évaluable (devise hors grille) : la route refuse aussi.
 */
async function palierAtteint(c: ContexteBrief, l: Ligne): Promise<boolean> {
  try {
    const versions = await chargerVersions(c.db, l.mission_id as string);
    const revision = versions.find((v: VersionDb) => v.id === l.id);
    if (!revision) return false;
    const mission = {
      id: l.mission_id,
      statut: l.statut,
      devise: l.devise,
      directeur_id: l.directeur_id,
      chef_id: l.chef_id,
      client_id: l.client_id,
      date_debut: l.date_debut,
      date_signature: l.date_signature,
      taux_change: l.taux_change,
      devise_reference: l.devise_reference,
      proposition_id: l.proposition_id,
    } as MissionAcces;
    return satisfaitRole(c.auth.roles, roleApprobateurRevision(versions, revision, mission));
  } catch {
    return false;
  }
}

/**
 * Révision de budget en cours (FIN-03, FIN-15) : « budget.reviser », directeur de CETTE mission ou
 * associé (route valider), mission signée et non clôturée, jamais l'auteur de la révision (le brief
 * ne l'exempte pas même s'il est associé). Aucune trace de « soumission » n'existe : la révision
 * non figée est la trace, son ancienneté part de sa création. FIN-02 : ni montant, ni jour, ni
 * écart n'est lu dans l'élément ; seuls le numéro de révision et l'intitulé de la mission sortent.
 */
export const revisionsBudgetAValider: Extracteur = async (c) => {
  if (!a(c, "budget.reviser")) return null;
  const associe = estAssocie(c.auth);
  const r = await c.db.query(
    `SELECT b.id, b.numero, b.mission_id, m.intitule, m.statut, m.devise, m.directeur_id, m.chef_id,
       m.client_id, m.date_debut::text AS date_debut, m.date_signature::text AS date_signature,
       m.taux_change::text AS taux_change, m.devise_reference, m.proposition_id,
       ${JOUR("b.cree_le")} AS depuis, count(*) OVER ()::int AS total_source
     FROM budget_versions b JOIN missions m ON m.id = b.mission_id
     WHERE b.type = 'revise' AND NOT b.figee AND ${VISIBLE}
       AND m.statut IN ('signee', 'en_cours', 'a_cloturer')
       AND ($3::boolean OR m.directeur_id = $2)
       AND b.cree_par IS DISTINCT FROM $2::uuid
     ORDER BY b.cree_le, b.id LIMIT $4`,
    [...base(c), associe, PLAFOND_PAR_SOURCE],
  );
  const retenues: Ligne[] = [];
  for (const l of r.rows as Ligne[]) if (associe || (await palierAtteint(c, l))) retenues.push(l);
  const candidat = (l: Ligne) => ({
    type: "revision_budget_a_valider" as const,
    entite_id: l.id as string,
    mission_id: l.mission_id as string,
    entite_libelle: `révision n° ${String(l.numero)}`,
    mission_libelle: texte(l.intitule),
    lien: `/missions/${l.mission_id as string}/budget`,
    faits: { nature: "attente" as const, depuis: texte(l.depuis) },
  });
  return associe
    ? enSource("decider", r.rows, (l) => candidat(l))
    : enSourceFiltree("decider", r.rows, retenues.map(candidat));
};
