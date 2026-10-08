import {
  echeanceDepuisDuree,
  syntheseEfficacite,
  type ContexteEfficacite,
  type ObservationEfficacite,
} from "@missionpilot/engines";
import {
  initiativeTypeDonneesSchema,
  NIVEAU_RISQUE_INITIATIVE_LIBELLES,
  type InitiativeTypeCreation,
  type InitiativeTypeDonnees,
  type InitiativeTypeObservation,
  type PlanInitiativeDepuisBibliotheque,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { montant, traduireErreursPg } from "../db/outils.js";
import { AppError, conflit, introuvable, requeteInvalide } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import { exigerPlanRedigeable, exigerPlanVisible } from "./acces.js";
import { creerElement } from "./elements.js";

/*
 * Bibliothèque d'initiatives types (PLA-13) : standard (lisible de tous, posé
 * par migration, 0422) et initiatives du cabinet (variante d'une initiative du
 * standard, ou propre au cabinet), en versions ajout seul (0421).
 *
 * Vue du cabinet : ses initiatives, plus celles du standard qu'il n'a pas
 * déclinées en variante ; une initiative dont la version courante est retirée
 * n'y figure plus (une variante retirée masque aussi l'initiative du standard).
 *
 * Efficacité observée : observations du cabinet (0 à 100) avec leur contexte ;
 * pour une variante, celles de l'initiative du standard comptent aussi. La
 * synthèse par contexte (secteur, taille, pays) vient du moteur
 * (syntheseEfficacite) : jamais extrapolée sous le seuil d'observations.
 *
 * Droits (routes/plans-augmentes.ts) : lecture « plan.lire » ; gestion de la
 * bibliothèque du cabinet et observations « standard.gerer » (propriétaire de
 * la variante cabinet, STD-03) ; création d'une initiative du plan depuis la
 * bibliothèque « plan.ecrire » (règles de l'élément du plan, plans/elements.ts).
 */

interface LigneType {
  id: string;
  code: string;
  cabinet_id: string | null;
  standard_id: string | null;
  version: number;
  titre: string;
  description: string | null;
  perspective: string | null;
  prerequis: string[];
  risques: { libelle: string; niveau: keyof typeof NIVEAU_RISQUE_INITIATIVE_LIBELLES }[];
  cout_min: string;
  cout_type: string;
  cout_max: string;
  devise: string;
  duree_type_jours: number;
  charge_type_jours: number | null;
  retire: boolean;
  version_le: string;
}

const COLONNES = `t.id, t.code, t.cabinet_id, t.standard_id, v.version, v.titre, v.description,
  v.perspective, v.prerequis, v.risques, v.cout_min, v.cout_type, v.cout_max, v.devise,
  v.duree_type_jours, v.charge_type_jours, v.retire, v.cree_le AS version_le`;

const DEPUIS = `initiatives_types t
  JOIN LATERAL (SELECT * FROM initiative_type_versions x WHERE x.initiative_type_id = t.id
                ORDER BY x.version DESC LIMIT 1) v ON true`;

function vueType(t: LigneType) {
  return {
    id: t.id,
    code: t.code,
    origine: t.cabinet_id === null ? "standard" : t.standard_id ? "variante" : "cabinet",
    standard_id: t.standard_id,
    version: t.version,
    titre: t.titre,
    description: t.description,
    perspective: t.perspective,
    prerequis: t.prerequis,
    risques: t.risques,
    cout_min: montant(t.cout_min),
    cout_type: montant(t.cout_type),
    cout_max: montant(t.cout_max),
    devise: t.devise,
    duree_type_jours: t.duree_type_jours,
    charge_type_jours: t.charge_type_jours,
    retire: t.retire,
    version_le: t.version_le,
  };
}

async function lireType(db: Db, id: string): Promise<LigneType> {
  const r = await db.query(`SELECT ${COLONNES} FROM ${DEPUIS} WHERE t.id = $1`, [id]);
  if (!r.rows[0]) throw introuvable("Initiative type");
  return r.rows[0] as LigneType;
}

/** Observations du cabinet, par initiative type (une variante reprend celles du standard). */
async function observations(db: Db, types: readonly LigneType[]) {
  const ids = types.flatMap((t) => (t.standard_id ? [t.id, t.standard_id] : [t.id]));
  if (ids.length === 0) return new Map<string, ObservationEfficacite[]>();
  const r = await db.query(
    `SELECT initiative_type_id, secteur, taille, pays, efficacite FROM initiative_type_observations
     WHERE initiative_type_id = ANY($1::uuid[]) ORDER BY cree_le, id`,
    [ids],
  );
  const par = new Map<string, ObservationEfficacite[]>();
  for (const o of r.rows as (ObservationEfficacite & { initiative_type_id: string })[]) {
    const liste = par.get(o.initiative_type_id) ?? [];
    liste.push({ secteur: o.secteur, taille: o.taille, pays: o.pays, efficacite: o.efficacite });
    par.set(o.initiative_type_id, liste);
  }
  return par;
}

function efficacite(
  t: LigneType,
  par: Map<string, ObservationEfficacite[]>,
  contexte: ContexteEfficacite,
) {
  const obs = [...(par.get(t.id) ?? []), ...(t.standard_id ? (par.get(t.standard_id) ?? []) : [])];
  return syntheseEfficacite(obs, contexte);
}

const CONTEXTE_VIDE: ContexteEfficacite = { secteur: null, taille: null, pays: null };

/** Vue du cabinet, paginée par code ; efficacité observée dans `contexte`. */
export async function listerBibliotheque(
  db: Db,
  q: { limite: number; curseur?: string | undefined },
  contexte: ContexteEfficacite = CONTEXTE_VIDE,
) {
  const apres = decoderCurseur(q.curseur);
  const r = await db.query(
    `SELECT t.code AS cle_tri, ${COLONNES} FROM ${DEPUIS}
     WHERE NOT v.retire
       AND NOT (t.cabinet_id IS NULL
                AND EXISTS (SELECT 1 FROM initiatives_types c WHERE c.standard_id = t.id))
       AND ($1::text IS NULL OR (t.code, t.id) > ($1, $2::uuid))
     ORDER BY t.code, t.id LIMIT $3`,
    [apres?.[0] ?? null, apres?.[1] ?? null, q.limite + 1],
  );
  const page = paginer(r.rows as (LigneType & { cle_tri: string })[], q.limite);
  const par = await observations(db, page.elements);
  return {
    contexte,
    elements: page.elements.map((t) => ({
      ...vueType(t),
      efficacite: efficacite(t, par, contexte),
    })),
    curseur_suivant: page.curseur_suivant,
  };
}

/** Contexte d'efficacité d'un plan : celui de son client (secteur, taille, pays). */
export async function contexteDuPlan(db: Db, auth: Auth, planId: string) {
  const plan = await exigerPlanVisible(db, auth, planId);
  const r = await db.query("SELECT secteur, taille, pays FROM clients WHERE id = $1", [
    plan.client_id,
  ]);
  const c = r.rows[0] as ContexteEfficacite | undefined;
  return c ?? CONTEXTE_VIDE;
}

/** Nombre de versions renvoyées avec le détail d'une initiative type (les plus récentes). */
export const VERSIONS_PAR_DEFAUT = 50;

/**
 * Détail : version courante, `VERSIONS_PAR_DEFAUT` dernières versions, efficacité observée.
 * `versions_tronquees` signale qu'il existe des versions plus anciennes non renvoyées (la liste
 * n'est jamais coupée en silence).
 */
export async function lireInitiativeType(
  db: Db,
  id: string,
  contexte: ContexteEfficacite,
  limiteVersions = VERSIONS_PAR_DEFAUT,
) {
  const t = await lireType(db, id);
  const versions = await db.query(
    `SELECT v.version, v.titre, v.retire, v.auteur_id, u.nom AS auteur_nom, v.cree_le
     FROM initiative_type_versions v LEFT JOIN utilisateurs u ON u.id = v.auteur_id
     WHERE v.initiative_type_id = $1 ORDER BY v.version DESC LIMIT $2`,
    [id, limiteVersions + 1],
  );
  const par = await observations(db, [t]);
  return {
    ...vueType(t),
    efficacite: efficacite(t, par, contexte),
    versions: versions.rows.slice(0, limiteVersions),
    versions_tronquees: versions.rows.length > limiteVersions,
  };
}

/** Insertion d'une version ; deux écritures simultanées : la seconde répond 409 (unicité). */
async function insererVersionType(
  db: Db,
  auth: Auth,
  typeId: string,
  version: number,
  d: InitiativeTypeDonnees,
  retire: boolean,
) {
  await traduireErreursPg(
    db.query(
      `INSERT INTO initiative_type_versions (cabinet_id, initiative_type_id, version, titre,
       description, perspective, prerequis, risques, cout_min, cout_type, cout_max, devise,
       duree_type_jours, charge_type_jours, retire, auteur_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        auth.cabinetId,
        typeId,
        version,
        d.titre,
        d.description ?? null,
        d.perspective ?? null,
        JSON.stringify(d.prerequis),
        JSON.stringify(d.risques),
        d.cout_min,
        d.cout_type,
        d.cout_max,
        d.devise,
        d.duree_type_jours,
        d.charge_type_jours ?? null,
        retire,
        auth.utilisateurId,
      ],
    ),
    {
      initiative_type_versions_initiative_type_id_version_key:
        "L'initiative type vient d'être modifiée : rechargez la page.",
    },
  );
}

const UNIQUES = {
  initiatives_types_cabinet_id_code_key: "Ce code (ou cette variante) existe déjà dans le cabinet.",
};

/** Initiative propre au cabinet (code libre du standard) ou variante d'une initiative du standard. */
export async function creerInitiativeType(db: Db, auth: Auth, corps: InitiativeTypeCreation) {
  let code: string;
  let standardId: string | null = null;
  if ("standard_id" in corps) {
    const s = await db.query(
      "SELECT code FROM initiatives_types WHERE id = $1 AND cabinet_id IS NULL",
      [corps.standard_id],
    );
    if (!s.rows[0]) throw introuvable("Initiative du standard");
    code = s.rows[0].code as string;
    standardId = corps.standard_id;
  } else {
    const s = await db.query(
      "SELECT 1 FROM initiatives_types WHERE code = $1 AND cabinet_id IS NULL",
      [corps.code],
    );
    if (s.rowCount) {
      throw new AppError(
        409,
        "CODE_DU_STANDARD",
        "Ce code est celui d'une initiative du standard : en créer une variante.",
      );
    }
    code = corps.code;
  }
  const r = await traduireErreursPg(
    db.query(
      `INSERT INTO initiatives_types (cabinet_id, code, standard_id, cree_par)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [auth.cabinetId, code, standardId, auth.utilisateurId],
    ),
    UNIQUES,
  );
  const id = r.rows[0].id as string;
  await insererVersionType(db, auth, id, 1, corps.donnees, false);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "bibliotheque_initiatives.creer",
    entite: "initiative_type",
    entiteId: id,
    details: { code, standard_id: standardId },
  });
  return lireInitiativeType(db, id, CONTEXTE_VIDE);
}

/** Nouvelle version d'une initiative du cabinet (le standard ne se modifie pas : 409). */
export async function ajouterVersionInitiativeType(
  db: Db,
  auth: Auth,
  id: string,
  corps: { donnees: InitiativeTypeDonnees; retire: boolean },
) {
  const courante = await lireType(db, id);
  if (courante.cabinet_id === null) throw standardImmuable();
  const avant = canonique(
    initiativeTypeDonneesSchema.parse({
      titre: courante.titre,
      description: courante.description,
      perspective: courante.perspective,
      prerequis: courante.prerequis,
      risques: courante.risques,
      cout_min: montant(courante.cout_min),
      cout_type: montant(courante.cout_type),
      cout_max: montant(courante.cout_max),
      devise: courante.devise,
      duree_type_jours: courante.duree_type_jours,
      charge_type_jours: courante.charge_type_jours,
    }),
  );
  if (avant === canonique(corps.donnees) && corps.retire === courante.retire) {
    throw conflit("Contenu identique à la version courante.");
  }
  await insererVersionType(db, auth, id, courante.version + 1, corps.donnees, corps.retire);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: corps.retire ? "bibliotheque_initiatives.retirer" : "bibliotheque_initiatives.modifier",
    entite: "initiative_type",
    entiteId: id,
    details: { version: courante.version + 1 },
  });
  return lireInitiativeType(db, id, CONTEXTE_VIDE);
}

/** Forme comparable d'un contenu : champs facultatifs absents ramenés à null, ordre fixe. */
function canonique(d: InitiativeTypeDonnees): string {
  return JSON.stringify([
    d.titre,
    d.description ?? null,
    d.perspective ?? null,
    d.prerequis,
    d.risques.map((r) => [r.libelle, r.niveau]),
    d.cout_min,
    d.cout_type,
    d.cout_max,
    d.devise,
    d.duree_type_jours,
    d.charge_type_jours ?? null,
  ]);
}

const standardImmuable = () =>
  new AppError(
    409,
    "STANDARD_IMMUABLE",
    "Une initiative du standard ne se modifie pas : en créer une variante pour le cabinet.",
  );

/** Observation d'efficacité (initiative du standard ou du cabinet, initiative de plan visible). */
export async function ajouterObservation(
  db: Db,
  auth: Auth,
  id: string,
  corps: InitiativeTypeObservation,
) {
  await lireType(db, id);
  if (corps.plan_initiative_id) {
    const e = await db.query(
      "SELECT plan_id FROM plan_elements WHERE id = $1 AND type = 'initiative'",
      [corps.plan_initiative_id],
    );
    if (!e.rows[0]) throw requeteInvalide("Initiative de plan inconnue.");
    await exigerPlanVisible(db, auth, e.rows[0].plan_id as string).catch(() => {
      throw requeteInvalide("Initiative de plan inconnue.");
    });
  }
  const r = await db.query(
    `INSERT INTO initiative_type_observations (cabinet_id, initiative_type_id, secteur, taille, pays,
       efficacite, plan_initiative_id, commentaire, auteur_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, cree_le`,
    [
      auth.cabinetId,
      id,
      corps.secteur ?? null,
      corps.taille ?? null,
      corps.pays ?? null,
      corps.efficacite,
      corps.plan_initiative_id ?? null,
      corps.commentaire ?? null,
      auth.utilisateurId,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "bibliotheque_initiatives.observer",
    entite: "initiative_type",
    entiteId: id,
    details: { observation_id: r.rows[0].id, efficacite: corps.efficacite },
  });
  return { id: r.rows[0].id as string, initiative_type_id: id, cree_le: r.rows[0].cree_le };
}

/** Description de l'initiative du plan : description type, prérequis et risques (5 000 car. max). */
function descriptionDepuisType(t: LigneType): string | null {
  const parties = [
    t.description ?? "",
    t.prerequis.length ? `Prérequis : ${t.prerequis.join(" ; ")}.` : "",
    t.risques.length
      ? `Risques : ${t.risques.map((r) => `${r.libelle} (${NIVEAU_RISQUE_INITIATIVE_LIBELLES[r.niveau] ?? r.niveau})`).join(" ; ")}.`
      : "",
  ].filter(Boolean);
  const texte = parties.join("\n\n");
  return texte ? texte.slice(0, 5000) : null;
}

/**
 * Initiative du plan créée depuis la bibliothèque : titre, description (prérequis et risques),
 * budget = coût type (si la devise est celle du plan, sinon à saisir : 400), échéance = début +
 * durée type (moteur). Version 1 « brouillon » (plans/elements.ts) ; origine tracée (0421).
 */
export async function creerInitiativeDepuisBibliotheque(
  db: Db,
  auth: Auth,
  planId: string,
  corps: PlanInitiativeDepuisBibliotheque,
) {
  const plan = await exigerPlanRedigeable(db, auth, planId);
  const t = await lireType(db, corps.initiative_type_id);
  if (t.retire) throw conflit("Cette initiative type est retirée de la bibliothèque.");
  if (corps.budget === undefined && t.devise !== plan.devise) {
    throw new AppError(
      400,
      "DEVISE_DIFFERENTE",
      `Coût type en ${t.devise}, plan en ${plan.devise} : saisir le budget de l'initiative.`,
    );
  }
  const element = await creerElement(db, auth, planId, {
    type: "initiative",
    parent_id: corps.parent_id,
    donnees: {
      titre: corps.titre ?? t.titre,
      description: descriptionDepuisType(t),
      responsable_id: corps.responsable_id ?? null,
      debut: corps.debut,
      echeance: corps.echeance ?? echeanceDepuisDuree(corps.debut, t.duree_type_jours),
      budget: corps.budget ?? (montant(t.cout_type) as number),
      statut: "a_lancer",
    },
  });
  await db.query(
    `INSERT INTO plan_initiatives_origines (cabinet_id, plan_id, initiative_id, initiative_type_id,
       initiative_type_version, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [auth.cabinetId, planId, element.id, t.id, t.version, auth.utilisateurId],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "plan.initiative.depuis_bibliotheque",
    entite: "plan_element",
    entiteId: element.id,
    details: { plan_id: planId, initiative_type_id: t.id, version: t.version },
  });
  return { ...element, origine: { initiative_type_id: t.id, version: t.version, code: t.code } };
}
