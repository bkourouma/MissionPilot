import {
  calculerBudget,
  figerTauxChange,
  GRILLE_SEUILS_PAR_DEFAUT,
  montant as montantMoteur,
  montantLigne,
  multiplierParRationnel,
  resoudreTauxGrade,
  sommer,
  sommerJours,
  type Devise,
  type GrilleSeuils,
  type LigneBudget,
  type Montant,
  type RoleApprobateur,
  type SyntheseBudget,
  type TauxChange,
  type TypeVersionBudget,
  type VersionBudget,
} from "@missionpilot/engines";
import {
  NATURES_FINANCE,
  type LigneBudgetSaisie,
  type NatureLigneBudget,
} from "@missionpilot/shared";
import type { Db } from "../db/pool.js";
import { requeteInvalide } from "../errors.js";
import type { MissionAcces } from "./acces.js";
import { nombre, slug, type DroitsBudget } from "./outils.js";

/** Ligne de budget telle qu'enregistrée (montants en unités mineures de la devise de la version). */
export interface LigneBudgetDb {
  cle: string;
  libelle: string;
  nature: NatureLigneBudget;
  grade_code: string | null;
  jours: number | null;
  prix_journalier: number | null;
  montant_forfait: number | null;
  refacturable: boolean;
}

export interface VersionDb {
  id: string;
  numero: number;
  type: TypeVersionBudget;
  devise: Devise;
  figee: boolean;
  date_figeage: string | null;
  motif: string | null;
  role_approbateur: string | null;
  cree_par: string | null;
  cree_le: string;
  validee_par: string | null;
  validee_le: string | null;
  lignes: (LigneBudgetDb & { id: string; ordre: number })[];
}

const COLONNES_VERSION = `id, numero, type, devise, figee, date_figeage::text AS date_figeage, motif,
  role_approbateur, cree_par, cree_le, validee_par, validee_le`;

/** Versions de budget d'une mission, par numéro croissant, avec leurs lignes. */
export async function chargerVersions(db: Db, missionId: string): Promise<VersionDb[]> {
  const v = await db.query(
    `SELECT ${COLONNES_VERSION} FROM budget_versions WHERE mission_id = $1 ORDER BY numero`,
    [missionId],
  );
  const l = await db.query(
    `SELECT id, version_id, cle, libelle, nature, grade_code, jours::float8 AS jours,
       prix_journalier, montant_forfait, refacturable, ordre
     FROM budget_lignes WHERE mission_id = $1 ORDER BY ordre, cle`,
    [missionId],
  );
  return v.rows.map((version) => ({
    ...version,
    lignes: l.rows
      .filter((ligne) => ligne.version_id === version.id)
      .map(({ version_id: _v, ...ligne }) => ({
        ...ligne,
        prix_journalier: ligne.prix_journalier === null ? null : nombre(ligne.prix_journalier),
        montant_forfait: ligne.montant_forfait === null ? null : nombre(ligne.montant_forfait),
      })),
  })) as VersionDb[];
}

/** Version de référence : la dernière version figée (initiale ou révision validée). */
export const versionDeReference = (versions: VersionDb[]): VersionDb | undefined =>
  [...versions].reverse().find((v) => v.figee);

function versLigneMoteur(l: LigneBudgetDb, devise: Devise): LigneBudget {
  return {
    id: l.cle,
    libelle: l.libelle,
    nature: l.nature,
    ...(l.grade_code === null ? {} : { grade: l.grade_code }),
    valeur:
      l.jours !== null && l.prix_journalier !== null
        ? {
            type: "jours",
            jours: l.jours,
            prixJournalier: montantMoteur(l.prix_journalier, devise),
          }
        : { type: "forfait", montant: montantMoteur(l.montant_forfait ?? 0, devise) },
    refacturable: l.refacturable,
  };
}

/** Version au format du moteur finance (la clé stable sert d'identifiant de ligne). */
export function versVersionMoteur(
  v: Pick<VersionDb, "id" | "numero" | "type" | "devise" | "figee" | "motif"> & {
    date_figeage?: string | null;
    lignes: LigneBudgetDb[];
  },
): VersionBudget {
  return {
    id: v.id,
    numero: v.numero,
    type: v.type,
    devise: v.devise,
    figee: v.figee,
    ...(v.date_figeage ? { dateFigeage: v.date_figeage } : {}),
    ...(v.motif ? { motif: v.motif } : {}),
    lignes: v.lignes.map((l) => versLigneMoteur(l, v.devise)),
  };
}

/** Lignes saisies → lignes enregistrables (clé par défaut : nature + libellé). */
export function lignesDepuisSaisie(saisie: LigneBudgetSaisie[]): LigneBudgetDb[] {
  return saisie.map((l) => ({
    cle: l.cle ?? `${l.nature}:${slug(l.libelle)}`,
    libelle: l.libelle,
    nature: l.nature,
    grade_code: l.grade_code ?? null,
    jours: l.jours ?? null,
    prix_journalier: l.prix_journalier ?? null,
    montant_forfait: l.montant_forfait ?? null,
    refacturable: l.refacturable,
  }));
}

/** Enregistre les lignes d'une version (non figée : le déclencheur refuse sinon). */
export async function insererLignes(
  db: Db,
  cabinetId: string,
  missionId: string,
  versionId: string,
  lignes: LigneBudgetDb[],
): Promise<void> {
  const cles = new Set<string>();
  for (const [ordre, l] of lignes.entries()) {
    if (cles.has(l.cle)) throw requeteInvalide(`Deux lignes portent la clé « ${l.cle} ».`);
    cles.add(l.cle);
    await db.query(
      `INSERT INTO budget_lignes (cabinet_id, mission_id, version_id, cle, libelle, nature, grade_code,
         jours, prix_journalier, montant_forfait, refacturable, ordre)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        cabinetId,
        missionId,
        versionId,
        l.cle,
        l.libelle,
        l.nature,
        l.grade_code,
        l.jours,
        l.prix_journalier,
        l.montant_forfait,
        l.refacturable,
        ordre,
      ],
    );
  }
}

/* ----- Budget calculé depuis le découpage (jours par tâche × taux) ----- */

export interface OptionsCalcul {
  /** Date de référence des taux et des coûts (date de signature). */
  date: string;
  /** Taux de vente imposés par code de grade (signature), en devise de la mission. */
  tauxVente?: Record<string, number>;
  /** Prix journaliers de la version de référence, par clé de ligne (révision). */
  prixReference?: Map<string, number>;
}

export interface BudgetCalcule {
  lignes: LigneBudgetDb[];
  /** Grades ou collaborateurs sans coût connu dans la devise : coût interne non budgété. */
  coutsManquants: string[];
}

interface Groupe {
  cle: string;
  libelle: string;
  gradeCode: string | null;
  collaborateurId: string | null;
  collaborateurType: string | null;
  jours: number[];
}

async function groupesDeJours(db: Db, missionId: string): Promise<Groupe[]> {
  const r = await db.query(
    `SELECT l.jours::float8 AS jours, g.code AS grade_code, g.libelle AS grade_libelle,
       l.collaborateur_id, c.nom AS collaborateur_nom, c.type AS collaborateur_type,
       cg.code AS collaborateur_grade
     FROM tache_budget_lignes l
     LEFT JOIN grades g ON g.id = l.grade_id
     LEFT JOIN collaborateurs c ON c.id = l.collaborateur_id
     LEFT JOIN grades cg ON cg.id = c.grade_id
     WHERE l.mission_id = $1 AND l.jours > 0
     ORDER BY g.ordre NULLS LAST, g.code, c.nom, l.collaborateur_id`,
    [missionId],
  );
  const groupes = new Map<string, Groupe>();
  for (const l of r.rows) {
    const parPersonne = l.collaborateur_id !== null;
    const cle = parPersonne ? `collaborateur:${l.collaborateur_id}` : `grade:${l.grade_code}`;
    const g: Groupe = groupes.get(cle) ?? {
      cle,
      libelle: parPersonne ? l.collaborateur_nom : l.grade_libelle,
      gradeCode: parPersonne ? l.collaborateur_grade : l.grade_code,
      collaborateurId: parPersonne ? l.collaborateur_id : null,
      collaborateurType: parPersonne ? l.collaborateur_type : null,
      jours: [],
    };
    g.jours.push(nombre(l.jours));
    groupes.set(cle, g);
  }
  return [...groupes.values()];
}

/** Dernière ligne de coûts de chaque collaborateur à la date donnée. */
async function coutsALaDate(
  db: Db,
  date: string,
): Promise<
  Map<string, { cout: number | null; vente: number | null; achat: number | null; devise: string }>
> {
  const r = await db.query(
    `SELECT DISTINCT ON (collaborateur_id) collaborateur_id, cout_journalier, taux_vente_specifique,
       cout_achat, devise
     FROM collaborateur_couts WHERE depuis_le <= $1
     ORDER BY collaborateur_id, depuis_le DESC`,
    [date],
  );
  const n = (v: unknown) => (v === null ? null : nombre(v));
  return new Map(
    r.rows.map((c) => [
      c.collaborateur_id as string,
      {
        cout: n(c.cout_journalier),
        vente: n(c.taux_vente_specifique),
        achat: n(c.cout_achat),
        devise: c.devise as string,
      },
    ]),
  );
}

/**
 * Grille standard des taux de vente de la mission : taux imposés, sinon taux
 * de la proposition d'origine, sinon taux standard du grade s'il est dans la
 * devise de la mission.
 */
async function grilleStandard(
  db: Db,
  mission: MissionAcces,
  imposes: Record<string, number>,
): Promise<Record<string, Montant>> {
  const devise = mission.devise as Devise;
  const grades = await db.query(
    `SELECT g.code, g.taux_vente_standard, g.devise, pt.taux_journalier AS taux_proposition
     FROM grades g
     LEFT JOIN proposition_taux pt ON pt.grade_id = g.id AND pt.proposition_id = $1`,
    [mission.proposition_id],
  );
  const standard: Record<string, Montant> = {};
  for (const g of grades.rows) {
    const valeur =
      imposes[g.code] ??
      (g.taux_proposition !== null ? nombre(g.taux_proposition) : undefined) ??
      (g.devise === devise && g.taux_vente_standard !== null
        ? nombre(g.taux_vente_standard)
        : undefined);
    if (valeur !== undefined) standard[g.code] = montantMoteur(valeur, devise);
  }
  return standard;
}

/** Coût journalier moyen des collaborateurs internes actifs d'un grade, dans la devise. */
async function coutMoyenParGrade(
  db: Db,
  couts: Awaited<ReturnType<typeof coutsALaDate>>,
  devise: Devise,
): Promise<Map<string, Montant>> {
  const r = await db.query(
    `SELECT c.id, g.code FROM collaborateurs c JOIN grades g ON g.id = c.grade_id
     WHERE c.actif AND c.type = 'interne'`,
  );
  const parGrade = new Map<string, Montant[]>();
  for (const c of r.rows) {
    const cout = couts.get(c.id);
    if (!cout || cout.cout === null || cout.devise !== devise) continue;
    parGrade.set(c.code, [...(parGrade.get(c.code) ?? []), montantMoteur(cout.cout, devise)]);
  }
  return new Map(
    [...parGrade].map(([code, liste]) => [
      code,
      multiplierParRationnel(sommer(liste, devise), { num: 1n, den: BigInt(liste.length) }),
    ]),
  );
}

/**
 * Lignes de budget calculées depuis le budget en jours des tâches (FIN-01) :
 * honoraires = jours × taux de vente (grille via le moteur), coûts internes =
 * jours × coût journalier (moyen du grade, ou de la personne), achats des
 * externes et sous-traitants = jours × coût d'achat.
 */
export async function calculerDepuisDecoupage(
  db: Db,
  mission: MissionAcces,
  options: OptionsCalcul,
): Promise<BudgetCalcule> {
  const devise = mission.devise as Devise;
  const groupes = await groupesDeJours(db, mission.id);
  const couts = await coutsALaDate(db, options.date);
  const grille = { standard: await grilleStandard(db, mission, options.tauxVente ?? {}) };
  const moyennes = await coutMoyenParGrade(db, couts, devise);
  const lignes: LigneBudgetDb[] = [];
  const coutsManquants: string[] = [];
  for (const g of groupes) {
    const jours = sommerJours(g.jours);
    const perso = g.collaborateurId === null ? undefined : couts.get(g.collaborateurId);
    const venteSpecifique = perso && perso.devise === devise ? perso.vente : null;
    const prix =
      options.prixReference?.get(`honoraires:${g.cle}`) ??
      venteSpecifique ??
      resoudreTauxGrade(grille, { grade: g.gradeCode ?? "", date: options.date }).taux.valeur;
    const base = { grade_code: g.gradeCode, jours, montant_forfait: null, refacturable: false };
    lignes.push({
      ...base,
      cle: `honoraires:${g.cle}`,
      libelle: `Honoraires — ${g.libelle}`,
      nature: "honoraires",
      prix_journalier: prix,
    });
    const externe = g.collaborateurType !== null && g.collaborateurType !== "interne";
    const cout = externe
      ? perso && perso.devise === devise
        ? perso.achat
        : null
      : g.collaborateurId !== null
        ? perso && perso.devise === devise
          ? perso.cout
          : null
        : (moyennes.get(g.gradeCode ?? "")?.valeur ?? null);
    if (cout === null) {
      coutsManquants.push(g.cle);
      continue;
    }
    lignes.push({
      ...base,
      cle: `${externe ? "sous_traitance" : "cout_interne"}:${g.cle}`,
      libelle: `${externe ? "Sous-traitance" : "Coût interne"} — ${g.libelle}`,
      nature: externe ? "sous_traitance" : "cout_interne",
      prix_journalier: cout,
    });
  }
  return { lignes, coutsManquants };
}

/* ----- Taux de change figé et seuils d'approbation ----- */

/** Taux figé de la mission vers la devise du cabinet (FIN-04), au format du moteur. */
export function tauxChangeMission(mission: MissionAcces): TauxChange | undefined {
  if (!mission.date_signature || !mission.taux_change || !mission.devise_reference)
    return undefined;
  return figerTauxChange(
    mission.devise as Devise,
    mission.devise_reference as Devise,
    nombre(mission.taux_change),
    mission.date_signature,
  );
}

/**
 * Grille des seuils (FIN-15) : grille par défaut du moteur, exprimée en FCFA ;
 * elle s'applique telle quelle à un cabinet en XAF (parité 1:1 avec le XOF).
 */
export function grilleSeuils(deviseCabinet: string): GrilleSeuils {
  if (deviseCabinet === "XOF" || deviseCabinet === "XAF") {
    return { ...GRILLE_SEUILS_PAR_DEFAUT, deviseReference: deviseCabinet };
  }
  throw requeteInvalide(
    "Les seuils d'approbation sont définis en FCFA : devise du cabinet non prise en charge.",
  );
}

const RANG_APPROBATEUR: Record<RoleApprobateur, readonly string[]> = {
  chef_mission: ["chef_mission", "directeur_mission", "associe"],
  directeur_mission: ["directeur_mission", "associe"],
  associe: ["associe"],
};

export const satisfaitRole = (roles: readonly string[], requis: RoleApprobateur): boolean =>
  roles.some((r) => RANG_APPROBATEUR[requis].includes(r));

/* ----- Vues filtrées selon les droits (FIN-02) ----- */

const estFinance = (nature: NatureLigneBudget) => NATURES_FINANCE.includes(nature);

/**
 * Ligne visible : sans « finance.lire », les coûts internes et la sous-traitance
 * sont ABSENTS ; sans « budget.lire_montants », aucun montant n'est renvoyé.
 */
export function vueLigne(
  l: VersionDb["lignes"][number],
  devise: Devise,
  droits: DroitsBudget,
): Record<string, unknown> | null {
  if (estFinance(l.nature) && !droits.finance) return null;
  const vue: Record<string, unknown> = {
    id: l.id,
    cle: l.cle,
    libelle: l.libelle,
    nature: l.nature,
    grade_code: l.grade_code,
    jours: l.jours,
    refacturable: l.refacturable,
  };
  if (droits.montants || droits.finance) {
    vue.prix_journalier = l.prix_journalier;
    vue.montant_forfait = l.montant_forfait;
    vue.montant = montantLigne(versLigneMoteur(l, devise), devise).valeur;
  }
  return vue;
}

export function vueSynthese(s: SyntheseBudget, droits: DroitsBudget): Record<string, unknown> {
  const vue: Record<string, unknown> = { devise: s.devise, jours_vendus: s.joursVendus };
  if (droits.montants || droits.finance) {
    vue.honoraires = s.honoraires.valeur;
    vue.debours_refacturables = s.deboursRefacturables.valeur;
    vue.debours_non_refacturables = s.deboursNonRefacturables.valeur;
  }
  if (droits.finance) {
    vue.couts_internes = s.coutsInternes.valeur;
    vue.sous_traitance = s.sousTraitance.valeur;
    vue.marge = s.marge.valeur;
    vue.taux_marge = s.tauxMarge;
    vue.jours_production = s.joursProduction;
  }
  return vue;
}

export function vueVersion(v: VersionDb, droits: DroitsBudget): Record<string, unknown> {
  const { lignes, role_approbateur, ...entete } = v;
  return {
    ...entete,
    role_approbateur,
    synthese: vueSynthese(calculerBudget(versVersionMoteur(v)), droits),
    lignes: lignes.map((l) => vueLigne(l, v.devise, droits)).filter((l) => l !== null),
  };
}
