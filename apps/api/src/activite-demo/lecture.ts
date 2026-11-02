import {
  ajouterJours,
  jourSemaine,
  sommerJours,
  versCentiemes,
  type Absence,
  type Affectation,
  type DateISO,
  type Montant,
  type NoeudAgrege,
  type ParametresCalendrier,
  type Periode,
} from "@missionpilot/engines";
import { ROLES_CLIENT } from "@missionpilot/shared";
import { journaliserIncident } from "../automatisation/diagnostic.js";
import type { Db } from "../db/pool.js";
import {
  COLONNES_FACTURE_PAIEMENT,
  imputationsParFacture,
  situationPaiement,
  versFacturePaiement,
  type FacturePaiement,
} from "../finance/paiements.js";
import { chargerCalendrier, nombre } from "../missions/outils.js";
import { absencesValidees } from "../planification/charge.js";
import { lireParametresTemps, moisClotures, type ParametresTemps } from "../temps/outils.js";
import { calculerSuivisMissions, type SuiviMission } from "../temps/suivi.js";

/*
 * Lectures de l'activité de démonstration (job « activite_demo ») : tout ce dont les étapes ont
 * besoin, lu dans la transaction du cabinet (RLS posée par le worker). Lectures SEULEMENT : aucune
 * écriture, aucun agrégat SQL (les sommes passent par le moteur : `sommerJours`, suivi des
 * temps, situation de paiement), aucun gabarit interpolé hors constantes, et toute liste a un
 * `LIMIT $n` paramétré. Une liste qui atteint son plafond est tronquée et consignée (incident
 * `activite_demo_plafond`, sans contenu) plutôt que lue sans borne.
 *
 * Quantités en centièmes de jour entiers (unité du moteur), dates `AAAA-MM-JJ`.
 */

/** Lignes lues au plus par lecture d'appui (déclarations, affectés, affectations, découpage). */
export const LIGNES_LUES_MAX = 5000;
/** Pages de factures émises parcourues au plus pour trouver des factures ouvertes. */
const PAGES_FACTURES_MAX = 4;

/** Consigne un plafond de lecture atteint ; vrai si `lues` dépasse `max`. */
function signalerPlafond(lecture: string, lues: number, max: number): boolean {
  if (lues <= max) return false;
  journaliserIncident("activite_demo_plafond", "Plafond de lecture atteint.", {
    lecture,
    plafond: max,
  });
  return true;
}

/** Lignes d'une lecture d'appui lue avec `LIMIT LIGNES_LUES_MAX + 1`, tronquées au plafond. */
function borner<T>(lignes: T[], lecture: string): T[] {
  signalerPlafond(lecture, lignes.length, LIGNES_LUES_MAX);
  return lignes.slice(0, LIGNES_LUES_MAX);
}

/* ----- Cabinet ----- */

export interface CabinetDemo {
  estDemo: boolean;
  actif: boolean;
  granularite: "demi_journee" | "heure";
  devise: string;
}

/** État du cabinet du contexte (RLS : son propre cabinet seulement), ou null. */
export async function lireCabinetDemo(db: Db, cabinetId: string): Promise<CabinetDemo | null> {
  const r = await db.query(
    "SELECT est_demo, actif, unite_saisie_temps, devise_base FROM cabinets WHERE id = $1",
    [cabinetId],
  );
  const l = r.rows[0];
  if (!l) return null;
  return {
    estDemo: l.est_demo === true,
    actif: l.actif === true,
    granularite: l.unite_saisie_temps as CabinetDemo["granularite"],
    devise: l.devise_base as string,
  };
}

/* ----- Semaine ----- */

export interface CollaborateurDemo {
  id: string;
  nom: string;
  utilisateurId: string;
  capacitePct: number;
  gradeId: string | null;
  gradeCode: string | null;
}

export interface MissionDemo {
  id: string;
  intitule: string;
  statut: "signee" | "en_cours";
  chefId: string | null;
  directeurId: string | null;
  clientId: string;
  clientActif: boolean;
  devise: string;
  modeFacturation: string;
  dateDebut: DateISO | null;
  dateFin: DateISO | null;
}

export interface SuiviTacheDemo {
  tacheId: string;
  missionId: string;
  phaseId: string;
  budgetCentiemes: number;
  realiseCentiemes: number;
  attenteCentiemes: number;
  /** Dernière déclaration de reste à faire par collaborateur (0 compris). */
  declarations: Record<string, number>;
  /** Collaborateurs internes actifs affectés à la tâche, par identifiant. */
  affectes: string[];
}

export type AffectationDemo = Affectation & { missionId: string };

export interface LecturesSemaineDemo {
  periode: Periode;
  parametres: ParametresTemps;
  calendrier: ParametresCalendrier;
  moisClotures: string[];
  activiteInterneId: string | null;
  collaborateurs: CollaborateurDemo[];
  missions: MissionDemo[];
  suivis: Map<string, SuiviTacheDemo[]>;
  affectations: Map<string, AffectationDemo[]>;
  absences: Map<string, Absence[]>;
  plafondAtteint: boolean;
}

/**
 * Données d'une semaine (du lundi au dimanche) : paramètres de temps, calendrier, mois clôturés,
 * activité interne de complément, collaborateurs et missions en vol (plafonnés, incident au-delà),
 * suivi par tâche, affectations et absences validées de la semaine.
 */
export async function lireSemaineDemo(
  db: Db,
  cabinetId: string,
  lundi: DateISO,
  plafonds: { collaborateursMax: number; missionsMax: number },
): Promise<LecturesSemaineDemo> {
  if (jourSemaine(lundi) !== 1) {
    throw new RangeError(`Semaine de démonstration : ${lundi} n'est pas un lundi.`);
  }
  const periode: Periode = { debut: lundi, fin: ajouterJours(lundi, 6) };
  const lusC = await lireCollaborateursDemo(db, cabinetId, plafonds.collaborateursMax + 1);
  const lusM = await lireMissionsDemo(db, periode, plafonds.missionsMax + 1);
  const plafondC = signalerPlafond("collaborateurs", lusC.length, plafonds.collaborateursMax);
  const plafondM = signalerPlafond("missions", lusM.length, plafonds.missionsMax);
  const collaborateurs = lusC.slice(0, plafonds.collaborateursMax);
  const missions = lusM.slice(0, plafonds.missionsMax);
  const ids = collaborateurs.map((c) => c.id);
  const absences = await absencesValidees(db, ids, periode);
  return {
    periode,
    parametres: await lireParametresTemps(db, cabinetId),
    calendrier: await chargerCalendrier(db, cabinetId),
    moisClotures: await moisClotures(db),
    activiteInterneId: await activiteInterneDemo(db),
    collaborateurs,
    missions,
    suivis: await lireSuivisTachesDemo(
      db,
      cabinetId,
      missions.map((m) => m.id),
    ),
    affectations: await lireAffectationsDemo(db, ids, periode),
    absences: new Map(ids.map((id) => [id, absences.get(id) ?? []])),
    plafondAtteint: plafondC || plafondM,
  };
}

/** Activité interne de complément : active, hors absence, la première par code. */
async function activiteInterneDemo(db: Db): Promise<string | null> {
  const r = await db.query(
    `SELECT id FROM activites_internes WHERE actif AND NOT est_absence
     ORDER BY code, id LIMIT 1`,
  );
  return (r.rows[0]?.id as string | undefined) ?? null;
}

/** Collaborateurs internes actifs rattachés à un utilisateur actif du cabinet (hors portail). */
async function lireCollaborateursDemo(
  db: Db,
  cabinetId: string,
  limite: number,
): Promise<CollaborateurDemo[]> {
  const r = await db.query(
    `SELECT c.id, c.nom, c.utilisateur_id, c.capacite_pct, c.grade_id, g.code AS grade_code
     FROM collaborateurs c
     JOIN utilisateurs u ON u.id = c.utilisateur_id AND u.cabinet_id = c.cabinet_id
     LEFT JOIN grades g ON g.id = c.grade_id
     WHERE c.cabinet_id = $1 AND c.actif AND c.type = 'interne' AND u.actif
       AND NOT (u.roles && $2::text[])
     ORDER BY lower(c.nom), c.id
     LIMIT $3`,
    [cabinetId, [...ROLES_CLIENT], limite],
  );
  return r.rows.map((l) => ({
    id: l.id as string,
    nom: l.nom as string,
    utilisateurId: l.utilisateur_id as string,
    capacitePct: Number(l.capacite_pct),
    gradeId: (l.grade_id as string | null) ?? null,
    gradeCode: (l.grade_code as string | null) ?? null,
  }));
}

/** Missions signées ou en cours ; celles qui ont une affectation dans la semaine d'abord. */
async function lireMissionsDemo(db: Db, periode: Periode, limite: number): Promise<MissionDemo[]> {
  const r = await db.query(
    `SELECT m.id, m.intitule, m.statut, m.chef_id, m.directeur_id, m.client_id,
       k.actif AS client_actif, m.devise, m.mode_facturation,
       m.date_debut::text AS date_debut, m.date_fin::text AS date_fin
     FROM missions m JOIN clients k ON k.id = m.client_id
     WHERE m.statut IN ('signee', 'en_cours')
     ORDER BY EXISTS (SELECT 1 FROM affectations a
                      WHERE a.mission_id = m.id AND a.date_debut <= $2 AND a.date_fin >= $1) DESC,
       m.id
     LIMIT $3`,
    [periode.debut, periode.fin, limite],
  );
  return r.rows.map((l) => ({
    id: l.id as string,
    intitule: l.intitule as string,
    statut: l.statut as MissionDemo["statut"],
    chefId: (l.chef_id as string | null) ?? null,
    directeurId: (l.directeur_id as string | null) ?? null,
    clientId: l.client_id as string,
    clientActif: l.client_actif === true,
    devise: l.devise as string,
    modeFacturation: l.mode_facturation as string,
    dateDebut: (l.date_debut as string | null) ?? null,
    dateFin: (l.date_fin as string | null) ?? null,
  }));
}

/* ----- Suivi par tâche ----- */

/**
 * Suivi par tâche de plusieurs missions : budget, réalisé validé et temps en attente du suivi des
 * temps (`calculerSuivisMissions`, temps/suivi.ts), dernières déclarations par collaborateur
 * (`DISTINCT ON`, comme temps/suivi.ts `restesDeclares`) et affectés internes actifs.
 */
export async function lireSuivisTachesDemo(
  db: Db,
  cabinetId: string,
  missionIds: readonly string[],
): Promise<Map<string, SuiviTacheDemo[]>> {
  const ids = [...new Set(missionIds)];
  const parMission = new Map<string, SuiviTacheDemo[]>();
  if (ids.length === 0) return parMission;
  const suivis = await calculerSuivisMissions(db, cabinetId, ids);
  const declarations = await declarationsParTache(db, ids);
  const affectes = await affectesParTache(db, ids);
  for (const [missionId, s] of suivis) {
    parMission.set(missionId, tachesDuSuivi(missionId, s, declarations, affectes));
  }
  return parMission;
}

const noeudsTaches = (n: NoeudAgrege): NoeudAgrege[] =>
  n.niveau === "tache" ? [n] : n.enfants.flatMap(noeudsTaches);

/** Tâches d'un suivi, dans l'ordre de l'arborescence, converties en centièmes par le moteur. */
function tachesDuSuivi(
  missionId: string,
  s: SuiviMission,
  declarations: ReadonlyMap<string, Record<string, number>>,
  affectes: ReadonlyMap<string, string[]>,
): SuiviTacheDemo[] {
  const phases = new Map(s.decoupage.taches.map((t) => [t.id as string, t.phase_id as string]));
  return noeudsTaches(s.arbre).map((n) => ({
    tacheId: n.id,
    missionId,
    phaseId: phases.get(n.id) ?? "",
    budgetCentiemes: versCentiemes(n.suivi.budget),
    realiseCentiemes: versCentiemes(n.suivi.realise),
    attenteCentiemes: versCentiemes(s.attente.get(n.id) ?? 0),
    declarations: { ...(declarations.get(n.id) ?? {}) },
    affectes: [...(affectes.get(n.id) ?? [])],
  }));
}

/** Dernière déclaration de chaque collaborateur sur chaque tâche (centièmes stockés). */
async function declarationsParTache(
  db: Db,
  missionIds: readonly string[],
): Promise<Map<string, Record<string, number>>> {
  const r = await db.query(
    `SELECT DISTINCT ON (tache_id, collaborateur_id) tache_id, collaborateur_id, centiemes
     FROM reste_a_faire WHERE mission_id = ANY ($1::uuid[])
     ORDER BY tache_id, collaborateur_id, ordre DESC
     LIMIT $2`,
    [missionIds, LIGNES_LUES_MAX + 1],
  );
  const parTache = new Map<string, Record<string, number>>();
  for (const l of borner(r.rows, "declarations")) {
    const tache = parTache.get(l.tache_id as string) ?? {};
    tache[l.collaborateur_id as string] = Number(l.centiemes);
    parTache.set(l.tache_id as string, tache);
  }
  return parTache;
}

/** Collaborateurs internes actifs affectés nominativement à chaque tâche. */
async function affectesParTache(
  db: Db,
  missionIds: readonly string[],
): Promise<Map<string, string[]>> {
  const r = await db.query(
    `SELECT DISTINCT a.tache_id, a.collaborateur_id
     FROM affectations a JOIN collaborateurs c ON c.id = a.collaborateur_id
     WHERE a.mission_id = ANY ($1::uuid[]) AND c.actif AND c.type = 'interne'
     ORDER BY a.tache_id, a.collaborateur_id
     LIMIT $2`,
    [missionIds, LIGNES_LUES_MAX + 1],
  );
  const parTache = new Map<string, string[]>();
  for (const l of borner(r.rows, "affectes")) {
    const tache = l.tache_id as string;
    parTache.set(tache, [...(parTache.get(tache) ?? []), l.collaborateur_id as string]);
  }
  return parTache;
}

/* ----- Affectations, feuilles, découpage ----- */

/**
 * Affectations nominatives des collaborateurs qui chevauchent la période, sur les missions signées
 * ou en cours (format du moteur, plus la mission) ; chaque collaborateur demandé a une entrée.
 */
export async function lireAffectationsDemo(
  db: Db,
  collaborateurIds: readonly string[],
  periode: Periode,
): Promise<Map<string, AffectationDemo[]>> {
  const parCollaborateur = new Map<string, AffectationDemo[]>(
    collaborateurIds.map((id) => [id, []]),
  );
  if (collaborateurIds.length === 0) return parCollaborateur;
  const r = await db.query(
    `SELECT a.id, a.collaborateur_id, a.tache_id, a.mission_id, a.jours_alloues::text AS jours,
       a.date_debut::text AS debut, a.date_fin::text AS fin
     FROM affectations a JOIN missions m ON m.id = a.mission_id
     WHERE a.collaborateur_id = ANY ($1::uuid[]) AND a.date_debut <= $3 AND a.date_fin >= $2
       AND m.statut IN ('signee', 'en_cours')
     ORDER BY a.collaborateur_id, a.date_debut, a.id
     LIMIT $4`,
    [collaborateurIds, periode.debut, periode.fin, LIGNES_LUES_MAX + 1],
  );
  for (const a of borner(r.rows, "affectations")) {
    const id = a.collaborateur_id as string;
    const liste = parCollaborateur.get(id) ?? [];
    liste.push({
      id: a.id as string,
      personneId: id,
      tacheId: a.tache_id as string,
      missionId: a.mission_id as string,
      joursAlloues: nombre(a.jours),
      debut: a.debut as string,
      fin: a.fin as string,
    });
    parCollaborateur.set(id, liste);
  }
  return parCollaborateur;
}

/** Une feuille existe déjà pour ce collaborateur et cette semaine (quel que soit son statut). */
export async function feuilleExisteDemo(
  db: Db,
  collaborateurId: string,
  lundi: DateISO,
): Promise<boolean> {
  const r = await db.query(
    "SELECT 1 FROM feuilles_temps WHERE collaborateur_id = $1 AND semaine = $2 LIMIT 1",
    [collaborateurId, lundi],
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Jours du découpage par clé de budget, en centièmes : `collaborateur:<id>` pour une ligne
 * nominative, `grade:<code>` sinon (même regroupement que missions/budget.ts `groupesDeJours`,
 * lignes à jours positifs) ; sommes par le moteur.
 */
export async function joursDecoupageParCleDemo(
  db: Db,
  missionId: string,
): Promise<{ cle: string; centiemes: number }[]> {
  const r = await db.query(
    `SELECT l.jours::float8 AS jours, g.code AS grade_code, l.collaborateur_id
     FROM tache_budget_lignes l LEFT JOIN grades g ON g.id = l.grade_id
     WHERE l.mission_id = $1 AND l.jours > 0
     ORDER BY g.ordre NULLS LAST, g.code, l.collaborateur_id, l.id
     LIMIT $2`,
    [missionId, LIGNES_LUES_MAX + 1],
  );
  const parCle = new Map<string, number[]>();
  for (const l of borner(r.rows, "decoupage")) {
    const cle =
      l.collaborateur_id !== null
        ? `collaborateur:${l.collaborateur_id as string}`
        : `grade:${l.grade_code as string}`;
    parCle.set(cle, [...(parCle.get(cle) ?? []), nombre(l.jours)]);
  }
  const total = (jours: number[]) => versCentiemes(sommerJours(jours));
  return [...parCle].map(([cle, jours]) => ({ cle, centiemes: total(jours) }));
}

/* ----- Factures ----- */

/**
 * Factures émises avant `avant` dont le solde est positif (situation de paiement du moteur,
 * finance/paiements.ts), de la plus ancienne à la plus récente, au plus `limite`. Les factures
 * soldées sont écartées après lecture : la recherche parcourt au plus PAGES_FACTURES_MAX pages
 * de `limite` factures (curseur sur la date d'émission et l'identifiant).
 */
export async function lireFacturesOuvertesDemo(
  db: Db,
  avant: DateISO,
  limite: number,
): Promise<{ facture: FacturePaiement; solde: Montant }[]> {
  const ouvertes: { facture: FacturePaiement; solde: Montant }[] = [];
  let curseur: { date: string; id: string } | null = null;
  for (let page = 0; page < PAGES_FACTURES_MAX && ouvertes.length < limite; page += 1) {
    const factures = await pageFacturesEmises(db, avant, curseur, limite);
    ouvertes.push(...(await avecSolde(db, factures, avant)));
    const derniere = factures[factures.length - 1];
    if (!derniere || factures.length < limite) break;
    curseur = { date: derniere.date_emission as string, id: derniere.id };
  }
  return ouvertes.slice(0, limite);
}

async function pageFacturesEmises(
  db: Db,
  avant: DateISO,
  curseur: { date: string; id: string } | null,
  limite: number,
): Promise<FacturePaiement[]> {
  const r = await db.query(
    `SELECT ${COLONNES_FACTURE_PAIEMENT} FROM factures f
     WHERE f.nature = 'facture' AND f.statut = 'emise' AND f.date_emission < $1
       AND ($2::date IS NULL OR (f.date_emission, f.id) > ($2::date, $3::uuid))
     ORDER BY f.date_emission, f.id
     LIMIT $4`,
    [avant, curseur?.date ?? null, curseur?.id ?? null, limite],
  );
  return r.rows.map(versFacturePaiement);
}

/** Factures non soldées, avec leur solde (toutes imputations, contre-passations comprises). */
async function avecSolde(
  db: Db,
  factures: readonly FacturePaiement[],
  date: DateISO,
): Promise<{ facture: FacturePaiement; solde: Montant }[]> {
  const imputations = await imputationsParFacture(
    db,
    factures.map((f) => f.id),
  );
  return factures.flatMap((facture) => {
    const s = situationPaiement(facture, imputations.get(facture.id) ?? [], date);
    return s.statut_paiement === "soldee" || s.statut_paiement === "annulee"
      ? []
      : [{ facture, solde: s.solde }];
  });
}

/** Dernière date d'émission d'une facture de l'exercice (garde chronologique de la numérotation). */
export async function derniereEmissionExerciceDemo(
  db: Db,
  exercice: number,
): Promise<DateISO | null> {
  const r = await db.query(
    `SELECT date_emission::text AS date_emission FROM factures
     WHERE nature = 'facture' AND exercice = $1 AND date_emission IS NOT NULL
     ORDER BY date_emission DESC
     LIMIT 1`,
    [exercice],
  );
  return (r.rows[0]?.date_emission as string | undefined) ?? null;
}

/** Date de la dernière facture émise de chaque mission (missions jamais facturées : absentes). */
export async function dernieresFacturesParMissionDemo(
  db: Db,
  missionIds: readonly string[],
): Promise<Record<string, DateISO>> {
  const ids = [...new Set(missionIds)];
  if (ids.length === 0) return {};
  const r = await db.query(
    `SELECT DISTINCT ON (mission_id) mission_id, date_emission::text AS date_emission
     FROM factures
     WHERE mission_id = ANY ($1::uuid[]) AND nature = 'facture' AND date_emission IS NOT NULL
     ORDER BY mission_id, date_emission DESC
     LIMIT $2`,
    [ids, ids.length],
  );
  const dates = r.rows.map((l) => [l.mission_id as string, l.date_emission as string] as const);
  return Object.fromEntries(dates);
}
