import {
  calculerBudget,
  convertir,
  ErreurFinance,
  figerTauxChange,
  montant as montantMoteur,
  sommer,
  sommerJours,
  valeurTemps,
  type Devise,
  type Montant,
  type SyntheseBudget,
  type TauxNegocie,
} from "@missionpilot/engines";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import {
  filtreVisibilite,
  STATUTS_SIGNES,
  voitToutesLesMissions,
  type MissionAcces,
} from "../missions/acces.js";
import {
  chargerGrilleVente,
  chargerVersions,
  resoudreTauxVente,
  versionDeReference,
  versVersionMoteur,
  type GrilleVente,
  type LigneBudgetDb,
  type VersionDb,
} from "../missions/budget.js";
import { nombre } from "../missions/outils.js";
import { jours } from "../temps/outils.js";
import { calculerSuiviMission, type SuiviMission } from "../temps/suivi.js";

/*
 * DONNÉES ET VALORISATION DES MISSIONS (FIN-11, FIN-12, bilan, indicateurs)
 *
 * Règles (toutes les opérations sur les montants passent par le moteur) :
 * - Temps : lignes des feuilles VALIDÉES (ou verrouillées) et corrections
 *   validées, comme le suivi (temps/suivi.ts) et la régie.
 * - Valeur produite : jours × taux de vente résolu comme la régie
 *   (facturation/echeancier.ts) : prix du budget signé pour le collaborateur,
 *   puis pour son grade, puis taux fixé, négocié ou standard du grade à la
 *   date (missions/budget.ts). Jours sans taux : « jours_non_valorises ».
 * - Valeur au taux standard (taux de réalisation) : taux de vente standard du
 *   grade dans la devise de la mission.
 * - Coûts : collaborateur interne → coût journalier chargé en vigueur à la
 *   date du temps (coûts internes) ; externe ou sous-traitant → coût d'achat
 *   en vigueur (sous-traitance). Coût absent ou dans une autre devise : jours
 *   comptés dans « jours_sans_cout ».
 * - Honoraires facturés : HT des lignes d'échéances (hors débours refacturés)
 *   des factures émises et des avoirs émis (négatifs) : une facture annulée
 *   et son avoir s'annulent.
 * - Débours non refacturés : débours validés non refacturables.
 * - Agrégation entre missions : chaque montant est converti dans la devise
 *   du cabinet au taux figé à la signature (moteur) ; sans taux, la mission
 *   est écartée et citée.
 */

export interface MissionDonnees {
  id: string;
  intitule: string;
  client_id: string;
  client_raison_sociale: string;
  type_mission_id: string | null;
  type_libelle: string | null;
  directeur_id: string | null;
  directeur_nom: string | null;
  chef_id: string | null;
  devise: Devise;
  statut: MissionAcces["statut"];
  mode_facturation: string;
  date_debut: string | null;
  date_fin: string | null;
  date_signature: string | null;
  taux_change: string | null;
  devise_reference: string | null;
  proposition_id: string | null;
  /** Date de clôture (AAAA-MM-JJ, UTC), ou null. */
  cloturee_le: string | null;
}

const COLONNES_MISSION = `m.id, m.intitule, m.client_id, cl.raison_sociale AS client_raison_sociale,
  m.type_mission_id, t.libelle AS type_libelle, m.directeur_id, d.nom AS directeur_nom, m.chef_id,
  m.devise, m.statut, m.mode_facturation, m.date_debut::text AS date_debut, m.date_fin::text AS date_fin,
  m.date_signature::text AS date_signature, m.taux_change::text AS taux_change, m.devise_reference,
  m.proposition_id, (m.cloturee_le AT TIME ZONE 'UTC')::date::text AS cloturee_le`;

/** Missions signées visibles de l'utilisateur (ou une liste précise). */
export async function chargerMissions(
  db: Db,
  auth: Auth,
  ids?: readonly string[],
): Promise<MissionDonnees[]> {
  const r = await db.query(
    `SELECT ${COLONNES_MISSION}
     FROM missions m JOIN clients cl ON cl.id = m.client_id
     LEFT JOIN types_mission t ON t.id = m.type_mission_id
     LEFT JOIN utilisateurs d ON d.id = m.directeur_id
     WHERE m.statut = ANY ($1::text[]) AND ${filtreVisibilite(2, 3)}
       AND ($4::uuid[] IS NULL OR m.id = ANY ($4::uuid[]))
     ORDER BY lower(m.intitule), m.id`,
    [STATUTS_SIGNES, voitToutesLesMissions(auth), auth.utilisateurId, ids ?? null],
  );
  return r.rows as MissionDonnees[];
}

/* ----- Temps validés ----- */

export interface TempsValideLigne {
  mission_id: string;
  date: string;
  jours: number;
  collaborateur_id: string;
  grade_code: string | null;
  collaborateur_type: string;
}

/** Temps validés (lignes et corrections) des missions, bornes de dates incluses. */
export async function tempsValides(
  db: Db,
  missionIds: readonly string[],
  du: string | null,
  au: string | null,
): Promise<TempsValideLigne[]> {
  if (missionIds.length === 0) return [];
  const r = await db.query(
    `SELECT l.mission_id, l.date::text AS date, l.centiemes, f.collaborateur_id, g.code AS grade_code,
       c.type AS collaborateur_type
     FROM lignes_temps l JOIN feuilles_temps f ON f.id = l.feuille_id
     JOIN collaborateurs c ON c.id = f.collaborateur_id LEFT JOIN grades g ON g.id = c.grade_id
     WHERE l.mission_id = ANY ($1::uuid[]) AND f.statut IN ('validee', 'verrouillee')
       AND ($2::date IS NULL OR l.date >= $2) AND ($3::date IS NULL OR l.date <= $3)
     UNION ALL
     SELECT x.mission_id, x.date::text, x.nouvelle_centiemes - x.ancienne_centiemes, x.collaborateur_id,
       g.code, c.type
     FROM corrections_temps x JOIN collaborateurs c ON c.id = x.collaborateur_id
     LEFT JOIN grades g ON g.id = c.grade_id
     WHERE x.mission_id = ANY ($1::uuid[]) AND x.statut = 'validee'
       AND ($2::date IS NULL OR x.date >= $2) AND ($3::date IS NULL OR x.date <= $3)`,
    [missionIds, du, au],
  );
  return r.rows.map((l) => ({
    mission_id: l.mission_id as string,
    date: l.date as string,
    jours: jours(l.centiemes),
    collaborateur_id: l.collaborateur_id as string,
    grade_code: (l.grade_code as string | null) ?? null,
    collaborateur_type: l.collaborateur_type as string,
  }));
}

/* ----- Coûts des collaborateurs (historique daté) ----- */

interface LigneCout {
  depuis: string;
  cout: number | null;
  achat: number | null;
  devise: Devise;
}

export type ResolveurCout = (
  collaborateurId: string,
  date: string,
  externe: boolean,
) => Montant | null;

/**
 * Coût en vigueur à une date : dernière ligne datée au plus tard ce jour qui
 * renseigne ce coût (coût journalier chargé, ou coût d'achat d'un externe).
 */
export async function chargerCouts(db: Db): Promise<ResolveurCout> {
  const r = await db.query(
    `SELECT collaborateur_id, depuis_le::text AS depuis, cout_journalier, cout_achat, devise
     FROM collaborateur_couts ORDER BY collaborateur_id, depuis_le DESC`,
  );
  const parCollaborateur = new Map<string, LigneCout[]>();
  for (const l of r.rows) {
    const id = l.collaborateur_id as string;
    parCollaborateur.set(id, [
      ...(parCollaborateur.get(id) ?? []),
      {
        depuis: l.depuis as string,
        cout: l.cout_journalier === null ? null : nombre(l.cout_journalier),
        achat: l.cout_achat === null ? null : nombre(l.cout_achat),
        devise: l.devise as Devise,
      },
    ]);
  }
  return (collaborateurId, date, externe) => {
    for (const l of parCollaborateur.get(collaborateurId) ?? []) {
      if (l.depuis > date) continue;
      const v = externe ? l.achat : l.cout;
      if (v !== null) return montantMoteur(v, l.devise);
    }
    return null;
  };
}

/* ----- Taux de vente d'une mission ----- */

export interface Tarification {
  /** Taux de vente résolu (comme la régie), ou null si aucun taux n'existe. */
  vente(t: Pick<TempsValideLigne, "collaborateur_id" | "grade_code" | "date">): Montant | null;
  /** Taux de vente standard du grade dans la devise de la mission, ou null. */
  standard(gradeCode: string | null): Montant | null;
  reference: VersionDb | undefined;
}

export async function chargerTarification(db: Db, mission: MissionDonnees): Promise<Tarification> {
  return tarificationDe(
    mission,
    await chargerVersions(db, mission.id),
    await chargerGrilleVente(db, mission),
  );
}

/**
 * Tarifications de plusieurs missions EN LOT (nombre de requêtes constant,
 * quel que soit le nombre de missions) : mêmes règles que `chargerVersions`
 * et `chargerGrilleVente` (missions/budget.ts), lues par `mission_id = ANY`.
 * Les deux chemins sont comparés par test (finance-volume.test.ts).
 */
export async function chargerTarifications(
  db: Db,
  missions: readonly MissionDonnees[],
): Promise<Map<string, Tarification>> {
  const parMission = new Map<string, Tarification>();
  if (missions.length === 0) return parMission;
  const ids = missions.map((m) => m.id);
  const v = await db.query(
    `SELECT id, mission_id, numero, type, devise, figee, date_figeage::text AS date_figeage, motif,
       role_approbateur, cree_par, cree_le, validee_par, validee_le
     FROM budget_versions WHERE mission_id = ANY ($1::uuid[]) ORDER BY mission_id, numero`,
    [ids],
  );
  const l = await db.query(
    `SELECT id, version_id, cle, libelle, nature, grade_code, jours::float8 AS jours,
       prix_journalier, montant_forfait, refacturable, ordre
     FROM budget_lignes WHERE mission_id = ANY ($1::uuid[]) ORDER BY ordre, cle`,
    [ids],
  );
  const lignesParVersion = new Map<string, VersionDb["lignes"]>();
  for (const { version_id: versionId, ...ligne } of l.rows) {
    const liste = lignesParVersion.get(versionId as string) ?? [];
    liste.push({
      ...ligne,
      prix_journalier: ligne.prix_journalier === null ? null : nombre(ligne.prix_journalier),
      montant_forfait: ligne.montant_forfait === null ? null : nombre(ligne.montant_forfait),
    } as VersionDb["lignes"][number]);
    lignesParVersion.set(versionId as string, liste);
  }
  const versionsParMission = new Map<string, VersionDb[]>();
  for (const { mission_id: missionId, ...version } of v.rows) {
    const liste = versionsParMission.get(missionId as string) ?? [];
    liste.push({
      ...version,
      lignes: lignesParVersion.get(version.id as string) ?? [],
    } as VersionDb);
    versionsParMission.set(missionId as string, liste);
  }
  const grades = await db.query("SELECT id, code, taux_vente_standard, devise FROM grades");
  const propositions = [
    ...new Set(missions.flatMap((m) => (m.proposition_id ? [m.proposition_id] : []))),
  ];
  const tauxPropositions = new Map<string, Map<string, number | null>>();
  if (propositions.length > 0) {
    const p = await db.query(
      `SELECT proposition_id, grade_id, taux_journalier FROM proposition_taux
       WHERE proposition_id = ANY ($1::uuid[])`,
      [propositions],
    );
    for (const t of p.rows) {
      const parGrade = tauxPropositions.get(t.proposition_id as string) ?? new Map();
      parGrade.set(
        t.grade_id as string,
        t.taux_journalier === null ? null : nombre(t.taux_journalier),
      );
      tauxPropositions.set(t.proposition_id as string, parGrade);
    }
  }
  const clients = [...new Set(missions.map((m) => m.client_id))];
  const n = await db.query(
    `SELECT t.client_id, t.devise, g.code, t.taux, t.valide_du::text AS valide_du,
       t.valide_au::text AS valide_au
     FROM taux_clients t JOIN grades g ON g.id = t.grade_id WHERE t.client_id = ANY ($1::uuid[])`,
    [clients],
  );
  for (const mission of missions) {
    const devise = mission.devise;
    const propositionTaux = mission.proposition_id
      ? tauxPropositions.get(mission.proposition_id)
      : undefined;
    const fixes: Record<string, Montant> = {};
    const standard: Record<string, Montant> = {};
    for (const g of grades.rows) {
      const fixe = propositionTaux?.get(g.id as string);
      if (fixe !== undefined && fixe !== null) fixes[g.code] = montantMoteur(fixe, devise);
      if (g.devise === devise && g.taux_vente_standard !== null) {
        standard[g.code] = montantMoteur(nombre(g.taux_vente_standard), devise);
      }
    }
    const negocies: TauxNegocie[] = n.rows
      .filter((t) => t.client_id === mission.client_id && t.devise === devise)
      .map((t) => ({
        clientId: mission.client_id,
        grade: t.code as string,
        taux: montantMoteur(nombre(t.taux), devise),
        ...(t.valide_du ? { valideDu: t.valide_du as string } : {}),
        ...(t.valide_au ? { valideAu: t.valide_au as string } : {}),
      }));
    parMission.set(
      mission.id,
      tarificationDe(mission, versionsParMission.get(mission.id) ?? [], {
        fixes,
        grille: { standard, negocies },
        clientId: mission.client_id,
      }),
    );
  }
  return parMission;
}

function tarificationDe(
  mission: MissionDonnees,
  versions: VersionDb[],
  grille: GrilleVente,
): Tarification {
  const reference = versionDeReference(versions);
  const prixBudget = new Map(
    (reference?.lignes ?? [])
      .filter((l) => l.nature === "honoraires" && l.prix_journalier !== null)
      .map((l) => [l.cle, l.prix_journalier as number]),
  );
  const devise = mission.devise;
  return {
    reference,
    vente: (t) => {
      const budget =
        prixBudget.get(`honoraires:collaborateur:${t.collaborateur_id}`) ??
        prixBudget.get(`honoraires:grade:${t.grade_code ?? ""}`);
      if (budget !== undefined) return montantMoteur(budget, devise);
      try {
        return resoudreTauxVente(grille, t.grade_code ?? "", t.date);
      } catch (error) {
        if (error instanceof ErreurFinance && error.code === "TAUX_INCONNU") return null;
        throw error;
      }
    },
    standard: (gradeCode) =>
      gradeCode !== null && Object.hasOwn(grille.grille.standard, gradeCode)
        ? (grille.grille.standard[gradeCode] as Montant)
        : null,
  };
}

/**
 * Valeur de temps (moteur `valeurTemps`) : jours regroupés par taux et sommés
 * au centième, puis multipliés une fois par taux.
 */
export function valoriser(
  lignes: readonly { jours: number; taux: Montant }[],
  devise: Devise,
): Montant {
  const parTaux = new Map<number, { taux: Montant; jours: number[] }>();
  for (const l of lignes) {
    const g = parTaux.get(l.taux.valeur) ?? { taux: l.taux, jours: [] };
    g.jours.push(l.jours);
    parTaux.set(l.taux.valeur, g);
  }
  return valeurTemps(
    [...parTaux.values()].map((g) => ({ jours: sommerJours(g.jours), tauxJournalier: g.taux })),
    devise,
  );
}

/* ----- Factures et débours ----- */

/** HT des lignes d'échéances des factures et avoirs émis, par mission (moteur). */
export async function honorairesFactures(
  db: Db,
  missionIds: readonly string[],
  du: string | null,
  au: string | null,
): Promise<Map<string, Montant[]>> {
  const parMission = new Map<string, Montant[]>();
  if (missionIds.length === 0) return parMission;
  const r = await db.query(
    `SELECT f.mission_id, f.devise, l.montant_ht FROM facture_lignes l JOIN factures f ON f.id = l.facture_id
     WHERE f.mission_id = ANY ($1::uuid[]) AND f.numero IS NOT NULL AND l.origine = 'echeance'
       AND ($2::date IS NULL OR f.date_emission >= $2) AND ($3::date IS NULL OR f.date_emission <= $3)`,
    [missionIds, du, au],
  );
  for (const l of r.rows) {
    const id = l.mission_id as string;
    parMission.set(id, [
      ...(parMission.get(id) ?? []),
      montantMoteur(nombre(l.montant_ht), l.devise as Devise),
    ]);
  }
  return parMission;
}

/** Débours validés non refacturables, par mission. */
export async function deboursNonRefactures(
  db: Db,
  missionIds: readonly string[],
  du: string | null,
  au: string | null,
): Promise<Map<string, Montant[]>> {
  const parMission = new Map<string, Montant[]>();
  if (missionIds.length === 0) return parMission;
  const r = await db.query(
    `SELECT mission_id, montant, devise FROM debours
     WHERE mission_id = ANY ($1::uuid[]) AND statut = 'valide' AND NOT refacturable
       AND ($2::date IS NULL OR date >= $2) AND ($3::date IS NULL OR date <= $3)`,
    [missionIds, du, au],
  );
  for (const l of r.rows) {
    const id = l.mission_id as string;
    parMission.set(id, [
      ...(parMission.get(id) ?? []),
      montantMoteur(nombre(l.montant), l.devise as Devise),
    ]);
  }
  return parMission;
}

/* ----- Analyse d'une mission sur une période ----- */

export interface AnalyseMission {
  mission: MissionDonnees;
  tarification: Tarification;
  jours_valides: number;
  jours_facturables: number;
  jours_non_valorises: number;
  jours_sans_standard: number;
  jours_sans_cout: number;
  valeur_produite: Montant;
  valeur_standard: Montant;
  honoraires_factures: Montant;
  couts_internes: Montant;
  sous_traitance: Montant;
  debours_non_refactures: Montant;
  /** Débours dans une autre devise que la mission : écartés. */
  debours_autre_devise: number;
}

/** Somme moteur des montants de la devise attendue ; les autres sont comptés à part. */
function sommeDevise(
  montants: readonly Montant[],
  devise: Devise,
): { total: Montant; ecartes: number } {
  const bons = montants.filter((m) => m.devise === devise);
  return { total: sommer(bons, devise), ecartes: montants.length - bons.length };
}

/**
 * Analyse financière des missions sur [du, au] (bornes facultatives) :
 * valeur produite, valeur au taux standard, honoraires facturés, coûts,
 * débours non refacturés, en devise de chaque mission (moteur).
 */
export async function analyserMissions(
  db: Db,
  missions: readonly MissionDonnees[],
  du: string | null,
  au: string | null,
): Promise<AnalyseMission[]> {
  const ids = missions.map((m) => m.id);
  const temps = await tempsValides(db, ids, du, au);
  const couts = await chargerCouts(db);
  const factures = await honorairesFactures(db, ids, du, au);
  const debours = await deboursNonRefactures(db, ids, du, au);
  const tarifications = await chargerTarifications(db, missions);
  const tempsParMission = new Map<string, TempsValideLigne[]>();
  for (const t of temps) {
    const liste = tempsParMission.get(t.mission_id) ?? [];
    liste.push(t);
    tempsParMission.set(t.mission_id, liste);
  }
  const analyses: AnalyseMission[] = [];
  for (const mission of missions) {
    const devise = mission.devise;
    const tarification = tarifications.get(mission.id) as Tarification;
    const lignes = tempsParMission.get(mission.id) ?? [];
    const vente: { jours: number; taux: Montant }[] = [];
    const standard: { jours: number; taux: Montant }[] = [];
    const internes: { jours: number; taux: Montant }[] = [];
    const externes: { jours: number; taux: Montant }[] = [];
    const sansTaux: number[] = [];
    const sansStandard: number[] = [];
    const sansCout: number[] = [];
    for (const t of lignes) {
      const taux = tarification.vente(t);
      if (taux && taux.devise === devise) vente.push({ jours: t.jours, taux });
      else sansTaux.push(t.jours);
      const std = tarification.standard(t.grade_code);
      if (std) standard.push({ jours: t.jours, taux: std });
      else sansStandard.push(t.jours);
      const externe = t.collaborateur_type !== "interne";
      const cout = couts(t.collaborateur_id, t.date, externe);
      if (cout && cout.devise === devise)
        (externe ? externes : internes).push({ jours: t.jours, taux: cout });
      else sansCout.push(t.jours);
    }
    const d = sommeDevise(debours.get(mission.id) ?? [], devise);
    analyses.push({
      mission,
      tarification,
      jours_valides: sommerJours(lignes.map((t) => t.jours)),
      jours_facturables: sommerJours(lignes.map((t) => t.jours)),
      jours_non_valorises: sommerJours(sansTaux),
      jours_sans_standard: sommerJours(sansStandard),
      jours_sans_cout: sommerJours(sansCout),
      valeur_produite: valoriser(vente, devise),
      valeur_standard: valoriser(standard, devise),
      honoraires_factures: sommeDevise(factures.get(mission.id) ?? [], devise).total,
      couts_internes: valoriser(internes, devise),
      sous_traitance: valoriser(externes, devise),
      debours_non_refactures: d.total,
      debours_autre_devise: d.ecartes,
    });
  }
  return analyses;
}

/* ----- Conversion vers la devise du cabinet ----- */

/** Montant dans la devise du cabinet au taux figé de la mission (moteur), ou null. */
export function versDeviseCabinet(
  m: Montant,
  mission: Pick<MissionDonnees, "devise" | "taux_change" | "devise_reference" | "date_signature">,
  deviseCabinet: Devise,
): Montant | null {
  if (m.devise === deviseCabinet) return m;
  if (
    !mission.taux_change ||
    !mission.date_signature ||
    mission.devise_reference !== deviseCabinet
  ) {
    return null;
  }
  return convertir(
    m,
    figerTauxChange(m.devise, deviseCabinet, nombre(mission.taux_change), mission.date_signature),
  );
}

export async function deviseDuCabinet(db: Db, cabinetId: string): Promise<Devise> {
  const r = await db.query("SELECT devise_base FROM cabinets WHERE id = $1", [cabinetId]);
  return ((r.rows[0]?.devise_base as Devise | undefined) ?? "XOF") as Devise;
}

/* ----- Budget de référence et atterrissage (FIN-03) ----- */

export function syntheseReference(t: Tarification): SyntheseBudget | null {
  return t.reference ? calculerBudget(versVersionMoteur(t.reference)) : null;
}

/**
 * Version budgétaire « atterrissage » (FIN-03) calculée depuis la version de
 * référence : les lignes au temps de coûts internes et de sous-traitance (et
 * d'honoraires pour une mission en régie) prennent les jours d'atterrissage
 * (réalisé + reste à faire, temps/suivi.ts) de leur grade ou de leur
 * collaborateur ; les forfaits, débours et lignes libres sont repris tels
 * quels. Synthèse par le moteur (calculerBudget).
 */
export function versionAtterrissage(
  reference: VersionDb,
  suivi: SuiviMission,
  modeFacturation: string,
): { lignes: LigneBudgetDb[]; synthese: SyntheseBudget } {
  const parGrade = new Map(
    suivi.parGrade.map((g) => [g.grade_code as string | null, g.atterrissage as number]),
  );
  const parPersonne = new Map(
    suivi.parPersonne.map((p) => [p.collaborateur_id as string, p.atterrissage as number]),
  );
  const joursAtterrissage = (cle: string): number | undefined => {
    const [, axe, valeur] = cle.split(":");
    if (axe === "grade") return parGrade.get(valeur ?? "");
    if (axe === "collaborateur") return parPersonne.get(valeur ?? "");
    return undefined;
  };
  const lignes = reference.lignes.map((l): LigneBudgetDb => {
    const aRecaler =
      l.jours !== null &&
      (l.nature === "cout_interne" ||
        l.nature === "sous_traitance" ||
        (l.nature === "honoraires" && modeFacturation === "regie"));
    const j = aRecaler ? joursAtterrissage(l.cle) : undefined;
    return {
      cle: l.cle,
      libelle: l.libelle,
      nature: l.nature,
      grade_code: l.grade_code,
      jours: j ?? l.jours,
      prix_journalier: l.prix_journalier,
      montant_forfait: l.montant_forfait,
      refacturable: l.refacturable,
    };
  });
  const synthese = calculerBudget(
    versVersionMoteur({
      id: `${reference.id}:atterrissage`,
      numero: reference.numero,
      type: "atterrissage",
      devise: reference.devise,
      figee: false,
      motif: "Atterrissage calculé",
      lignes,
    }),
  );
  return { lignes, synthese };
}

/** Coûts de production (internes + sous-traitance) d'une synthèse, par le moteur. */
export const coutsProduction = (s: SyntheseBudget): Montant =>
  sommer([s.coutsInternes, s.sousTraitance], s.devise);

/** Suivi en jours d'une mission (temps/suivi.ts, sans donnée financière). */
export const suiviMission = (db: Db, cabinetId: string, missionId: string) =>
  calculerSuiviMission(db, cabinetId, missionId);
