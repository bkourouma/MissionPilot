import {
  calculerBudget,
  ErreurFinance,
  figerTauxChange,
  GRILLE_SEUILS_PAR_DEFAUT,
  montant as montantMoteur,
  montantLigne,
  multiplierParRationnel,
  resoudreTauxGrade,
  roleApprobateur,
  sommer,
  sommerJours,
  soustraire,
  type Devise,
  type GrilleSeuils,
  type GrilleTaux,
  type LigneBudget,
  type Montant,
  type RoleApprobateur,
  type SyntheseBudget,
  type TauxChange,
  type TauxNegocie,
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
export const estFinance = (nature: NatureLigneBudget) => NATURES_FINANCE.includes(nature);

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

/**
 * Lignes saisies → lignes enregistrables (clé par défaut : nature + libellé).
 * Toute clé saisie commence par sa nature (« honoraires:… », « debours:… ») :
 * une ligne d'honoraires ne peut pas reprendre la clé d'une ligne de coût et
 * l'apparier à elle dans la comparaison des versions.
 */
export function lignesDepuisSaisie(saisie: LigneBudgetSaisie[]): LigneBudgetDb[] {
  for (const l of saisie) {
    if (l.cle !== undefined && !l.cle.startsWith(`${l.nature}:`)) {
      throw requeteInvalide(`La clé d'une ligne « ${l.nature} » commence par « ${l.nature}: ».`);
    }
  }
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
    if (cles.has(l.cle)) {
      // Sans citer la clé d'une ligne de coût : elle peut être invisible de l'auteur.
      throw requeteInvalide(
        estFinance(l.nature)
          ? "Deux lignes portent la même clé."
          : `Deux lignes portent la clé « ${l.cle} ».`,
      );
    }
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
 * Grille des taux de vente de la mission (FIN-02), par ordre de priorité :
 * 1. taux imposés à la signature, puis taux de la proposition d'origine
 *    (prix convenus avec le client : `fixes`) ;
 * 2. taux négociés du client de la mission dans sa devise, valides à la date
 *    (`negocies`, table taux_clients) ;
 * 3. taux standard du grade s'il est dans la devise de la mission.
 * La résolution 2 → 3 est faite par le moteur (`resoudreTauxGrade`).
 */
export interface GrilleVente {
  fixes: Record<string, Montant>;
  grille: GrilleTaux;
  clientId: string | undefined;
}

/** Taux négociés d'un client dans une devise, au format du moteur. */
export async function tauxNegociesClient(
  db: Db,
  clientId: string | undefined,
  devise: Devise,
): Promise<TauxNegocie[]> {
  if (!clientId) return [];
  const r = await db.query(
    `SELECT g.code, t.taux, t.valide_du::text AS valide_du, t.valide_au::text AS valide_au
     FROM taux_clients t JOIN grades g ON g.id = t.grade_id
     WHERE t.client_id = $1 AND t.devise = $2`,
    [clientId, devise],
  );
  return r.rows.map((t) => ({
    clientId,
    grade: t.code as string,
    taux: montantMoteur(nombre(t.taux), devise),
    ...(t.valide_du ? { valideDu: t.valide_du as string } : {}),
    ...(t.valide_au ? { valideAu: t.valide_au as string } : {}),
  }));
}

export async function chargerGrilleVente(
  db: Db,
  mission: Pick<MissionAcces, "devise" | "proposition_id"> & { client_id?: string | null },
  imposes: Record<string, number> = {},
): Promise<GrilleVente> {
  const devise = mission.devise as Devise;
  const grades = await db.query(
    `SELECT g.code, g.taux_vente_standard, g.devise, pt.taux_journalier AS taux_proposition
     FROM grades g
     LEFT JOIN proposition_taux pt ON pt.grade_id = g.id AND pt.proposition_id = $1`,
    [mission.proposition_id ?? null],
  );
  const fixes: Record<string, Montant> = {};
  const standard: Record<string, Montant> = {};
  for (const g of grades.rows) {
    const fixe =
      imposes[g.code] ?? (g.taux_proposition !== null ? nombre(g.taux_proposition) : undefined);
    if (fixe !== undefined) fixes[g.code] = montantMoteur(fixe, devise);
    if (g.devise === devise && g.taux_vente_standard !== null) {
      standard[g.code] = montantMoteur(nombre(g.taux_vente_standard), devise);
    }
  }
  const clientId = mission.client_id ?? undefined;
  return {
    fixes,
    grille: { standard, negocies: await tauxNegociesClient(db, clientId, devise) },
    clientId,
  };
}

/** Taux fixé (signature, proposition) pour ce grade, s'il existe. */
export function tauxFixe(g: GrilleVente, grade: string): Montant | undefined {
  return Object.hasOwn(g.fixes, grade) ? g.fixes[grade] : undefined;
}

/** Taux négocié valide à la date pour ce grade (moteur), ou undefined. */
export function tauxNegocie(g: GrilleVente, grade: string, date: string): Montant | undefined {
  if (g.clientId === undefined || (g.grille.negocies ?? []).length === 0) return undefined;
  const negocies: GrilleTaux = { standard: {}, negocies: g.grille.negocies ?? [] };
  try {
    return resoudreTauxGrade(negocies, { grade, clientId: g.clientId, date }).taux;
  } catch (error) {
    if (error instanceof ErreurFinance && error.code === "TAUX_INCONNU") return undefined;
    throw error;
  }
}

/**
 * Taux de vente d'un grade à une date : fixé, sinon négocié, sinon standard
 * (moteur ; TAUX_INCONNU si aucun).
 */
export function resoudreTauxVente(g: GrilleVente, grade: string, date: string): Montant {
  return (
    tauxFixe(g, grade) ??
    resoudreTauxGrade(g.grille, {
      grade,
      date,
      ...(g.clientId === undefined ? {} : { clientId: g.clientId }),
    }).taux
  );
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
  const grille = await chargerGrilleVente(db, mission, options.tauxVente ?? {});
  const moyennes = await coutMoyenParGrade(db, couts, devise);
  const lignes: LigneBudgetDb[] = [];
  const coutsManquants: string[] = [];
  for (const g of groupes) {
    const jours = sommerJours(g.jours);
    const perso = g.collaborateurId === null ? undefined : couts.get(g.collaborateurId);
    const venteSpecifique = perso && perso.devise === devise ? perso.vente : null;
    // Un taux négocié avec le client (sans taux fixé pour le grade) l'emporte
    // sur le taux de vente spécifique du collaborateur et sur le standard.
    const grade = g.gradeCode ?? "";
    const negocie =
      tauxFixe(grille, grade) === undefined ? tauxNegocie(grille, grade, options.date) : undefined;
    const prix =
      options.prixReference?.get(`honoraires:${g.cle}`) ??
      negocie?.valeur ??
      venteSpecifique ??
      resoudreTauxVente(grille, grade, options.date).valeur;
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

const ORDRE_APPROBATEURS: readonly RoleApprobateur[] = [
  "chef_mission",
  "directeur_mission",
  "associe",
];

/**
 * Rôle exigé pour valider une révision (FIN-15). Le palier porte sur le plus
 * grand des écarts d'honoraires, de coûts (coûts internes + sous-traitance +
 * débours non refacturables) et de marge, mesurés par rapport à la dernière
 * version validée ET, cumulés, depuis le budget initial : une suite de petites
 * révisions ne contourne pas le seuil. Le plus exigeant des rôles l'emporte.
 * Tout est calculé par le moteur finance (synthèse, écarts, paliers).
 */
export function roleApprobateurRevision(
  versions: VersionDb[],
  revision: VersionDb,
  mission: MissionAcces,
): RoleApprobateur {
  const grille = grilleSeuils(mission.devise_reference ?? mission.devise);
  const conversion =
    (mission.devise as Devise) === grille.deviseReference
      ? {}
      : { tauxChange: tauxChangeMission(mission) };
  const cible = calculerBudget(versVersionMoteur(revision));
  const couts = (s: SyntheseBudget) =>
    sommer([s.coutsInternes, s.sousTraitance, s.deboursNonRefacturables], s.devise);
  const references = [versionDeReference(versions), versions.find((v) => v.type === "initial")]
    .filter((v): v is VersionDb => v !== undefined)
    .map((v) => calculerBudget(versVersionMoteur(v)));
  const roles = references.flatMap((ref) =>
    [
      soustraire(cible.honoraires, ref.honoraires),
      soustraire(couts(cible), couts(ref)),
      soustraire(cible.marge, ref.marge),
    ].map((ecart) =>
      roleApprobateur({ objet: "revision_budget", montant: ecart, grille, ...conversion }),
    ),
  );
  return roles.reduce<RoleApprobateur>(
    (max, r) => (ORDRE_APPROBATEURS.indexOf(r) > ORDRE_APPROBATEURS.indexOf(max) ? r : max),
    "chef_mission",
  );
}

/* ----- Vues filtrées selon les droits (FIN-02) ----- */

/**
 * Ligne qui révèle un prix unitaire de la grille de taux (FIN-02) : honoraires
 * au temps, ou rattachés à un grade ou à un collaborateur (taux de vente
 * standard ou spécifique). Sans « finance.lire », ni son prix journalier ni
 * son montant ne sont renvoyés : seul le total des honoraires reste visible.
 */
export function revelePrixUnitaire(
  l: Pick<LigneBudgetDb, "nature" | "cle" | "jours" | "grade_code">,
): boolean {
  return (
    l.nature === "honoraires" &&
    (l.jours !== null ||
      l.grade_code !== null ||
      l.cle.startsWith("honoraires:grade:") ||
      l.cle.startsWith("honoraires:collaborateur:"))
  );
}

/**
 * Ligne visible : sans « finance.lire », les coûts internes et la sous-traitance
 * sont ABSENTS et les honoraires au taux d'un grade ou d'un collaborateur sont
 * sans prix ni montant ; sans « budget.lire_montants », aucun montant n'est renvoyé.
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
  if (droits.finance || (droits.montants && !revelePrixUnitaire(l))) {
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
