import {
  ajouterJours,
  besoinMembreDemo,
  choisirAvenantsDemo,
  creerRevision,
  decoupageCoherentDemo,
  depuisCentiemes,
  fenetreDuMoisDemo,
  figerVersion,
  joursOuvresDemo,
  LIBELLE_PHASE_PROLONGATION_DEMO,
  libelleMoisDemo,
  libelleSemaineDemo,
  libelleTacheProlongationDemo,
  lundiDeLaSemaine,
  motifAvenantDemo,
  PARAMETRES_ACTIVITE_DEMO,
  repartirEcheancesDemo,
  semainesCouvrant,
  sommerJours,
  soustraire,
  versCentiemes,
  type AvenantDemo,
  type BesoinMembreDemo,
  type CandidatSocleDemo,
  type DateISO,
  type EntreeBesoinDemo,
  type MembreAvenantDemo,
  type Montant,
  type ParametresCalendrier,
  type Periode,
  type RoleApprobateur,
} from "@missionpilot/engines";
import { aPermission, type Permission } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import { journaliserIncident } from "../automatisation/diagnostic.js";
import type { Db } from "../db/pool.js";
import { conflit, interdit } from "../errors.js";
import {
  chargerEcheances,
  echeancesMoteur,
  exigerDansLeBudget,
  honorairesSignes,
  insererEcheance,
} from "../facturation/echeancier.js";
import { peutGererEcheancier } from "../facturation/outils.js";
import {
  estAssocie,
  exigerMissionModifiable,
  peutModifierMission,
  type MissionAcces,
} from "../missions/acces.js";
import {
  calculerDepuisDecoupage,
  chargerVersions,
  insererLignes,
  roleApprobateurRevision,
  satisfaitRole,
  versionDeReference,
  versVersionMoteur,
  type VersionDb,
} from "../missions/budget.js";
import { chargerDecoupage } from "../missions/decoupage.js";
import { chargerCalendrier, gradesParCode } from "../missions/outils.js";
import {
  exigerDansBudgetFige,
  joursAllouesParGrade,
  joursFigesParGrade,
} from "../planification/affectations.js";
import { absencesValidees } from "../planification/charge.js";
import {
  collaborateurAffectable,
  dateFinMission,
  exigerDansMission,
  exigerMissionAffectable,
  exigerMissionDatee,
  exigerPasDuCabinet,
  exigerPlaceSurTache,
  fenetreTache,
  type MissionPlanifiee,
} from "../planification/outils.js";
import { moisClotures } from "../temps/outils.js";
import { auteurAvenantDemo, valideurRevisionDemo } from "./acteurs.js";
import {
  ACTIONS_ACTIVITE_DEMO,
  dansPointDeSauvegarde,
  marqueurExiste,
  poserMarqueur,
  type ContexteActiviteDemo,
} from "./commun.js";
import {
  joursDecoupageParCleDemo,
  lireAffectationsDemo,
  type CollaborateurDemo,
  type MissionDemo,
} from "./lecture.js";

/*
 * Avenant mensuel de prolongation de la tâche « activite_demo » (DECISIONS « Activité de
 * démonstration automatique », §5, DT1, DT11, DT12 ; tâche MENSUELLE seulement).
 *
 * Sans avenant, le budget figé d'une mission semée s'épuise en quelques semaines : une
 * affectation au-delà du budget figé par grade (409 BUDGET_FIGE_DEPASSE) ou hors des dates de la
 * mission est refusée, et les feuilles n'ont plus de tâche où aller. Chaque mois, pour chaque
 * mission « socle » choisie par le moteur (`choisirAvenantsDemo`, besoin semaine par semaine NET
 * des affectations existantes), le job écrit sous l'identité du chef, sinon du directeur : la
 * phase « Prolongations (démonstration) », réutilisée ; la tâche « Prolongation — <mois> » et son
 * budget en jours ; une NOUVELLE version révisée depuis le découpage, validée et figée par le
 * directeur (ou un associé si FIN-15 l'exige) : la version de référence n'est jamais modifiée
 * (FIN-03, 0013:62-99) ; la date de fin repoussée ; les affectations et, hors régie, les échéances
 * du supplément d'honoraires.
 *
 * Les transitions privées aux routes sont des blocs « miroir de <route>:<lignes> », à relire
 * quand la route évolue. Aucun chiffre n'est calculé ici : besoins, choix, cohérence et
 * répartition sortent de @missionpilot/engines, le budget de `missions/budget.ts`. Une mission qui
 * porte une révision en cours ou dont le découpage ne correspond plus au budget figé (saisie d'un
 * visiteur) n'est pas prolongée (DT12). Le journal ne porte que le marqueur
 * `activite_demo.prolongation` (utilisateur nul, aucun montant ni nom).
 */

const P = PARAMETRES_ACTIVITE_DEMO.prolongation;
const INCIDENT = "activite_demo_prolongation";
const PREFIXE_HONORAIRES = "honoraires:";
const CLE_GRADE = "grade:";
const CLE_COLLABORATEUR = "collaborateur:";
/** Durée d'une tâche en jours ouvrés (0012:55). */
const DUREE_TACHE_MAX = 1000;
/** Couples (mission, collaborateur) affectés lus au plus : toutes les paires possibles. */
const AFFECTES_LUS_MAX =
  PARAMETRES_ACTIVITE_DEMO.missionsMax * PARAMETRES_ACTIVITE_DEMO.collaborateursMax;
/** Révisions posées par ce job (motif de `motifAvenantDemo`), comptées pour la garde des 36. */
const MOTIF_AVENANT_JOB = /^Avenant de prolongation .+ \(démonstration\)$/u;
/**
 * Droits des routes reprises : budget.ts:156, decoupage.ts:232 et :272, affectations.ts:165,
 * missions.ts:598 (l'auteur est choisi par acteurs.ts ; revérifiés ici).
 */
const DROITS_AVENANT: readonly Permission[] = [
  "budget.ecrire",
  "mission.planifier",
  "affectation.gerer",
  "mission.creer",
];

interface LigneJours {
  cle: string;
  jours: number;
}

/** Ce que l'écriture des avenants reprend des lectures du mois. */
interface ContexteMois {
  calendrier: ParametresCalendrier;
  /** Code de grade de chaque collaborateur lu. */
  grades: Readonly<Record<string, string | null>>;
  besoins: BesoinMembreDemo[];
}

interface MissionEligible {
  mission: MissionDemo;
  auteur: Auth;
  candidat: CandidatSocleDemo;
}

interface EvaluationMissions {
  candidats: CandidatSocleDemo[];
  eligibles: Map<string, MissionEligible>;
  /** Missions déjà prolongées ce mois (marqueur) : elles comptent dans le plafond mensuel. */
  dejaFaits: number;
}

const plusTard = (a: DateISO, b: DateISO): DateISO => (a >= b ? a : b);
const plusTot = (a: DateISO, b: DateISO): DateISO => (a <= b ? a : b);

/** Reste de la clé après le préfixe, ou null si elle ne le porte pas. */
const sansPrefixe = (cle: string, prefixe: string): string | null =>
  cle.startsWith(prefixe) ? cle.slice(prefixe.length) : null;

const estAvenantDuJob = (v: VersionDb): boolean =>
  v.type === "revise" && MOTIF_AVENANT_JOB.test(v.motif ?? "");

/** Ordre qui suit le dernier lu (0 pour le premier élément), comme une saisie en fin de liste. */
function suivant(dernier: { ordre?: unknown } | undefined): number {
  return dernier ? Number(dernier.ordre) + 1 : 0;
}

/** « Prolongation novembre 2026 — semaine du 2 novembre 2026 » : libellé d'échéance sans montant. */
function libelleEcheance(mois: string, lundi: DateISO): string {
  return `Prolongation ${libelleMoisDemo(mois)} — ${libelleSemaineDemo(lundi)}`;
}

/**
 * Avenants du mois pour les missions en vol (§5) ; chaque avenant s'écrit dans son point de
 * sauvegarde `ad_prolongation` (un échec isolable n'arrête pas les autres). Rend les identifiants
 * des missions prolongées.
 */
export async function prolongerMoisDemo(
  c: ContexteActiviteDemo,
  missions: readonly MissionDemo[],
  collaborateurs: readonly CollaborateurDemo[],
): Promise<string[]> {
  const evaluation = await evaluerMissions(c, missions, collaborateurs);
  const calendrier = await chargerCalendrier(c.db, c.cabinetId);
  const m: ContexteMois = {
    calendrier,
    grades: Object.fromEntries(collaborateurs.map((k) => [k.id, k.gradeCode])),
    besoins: await besoinsDuMois(c, calendrier, collaborateurs, evaluation),
  };
  const faits: string[] = [];
  for (const a of choisirAvenants(c, m, evaluation)) {
    const e = evaluation.eligibles.get(a.missionId);
    if (!e) continue;
    const id = await dansPointDeSauvegarde(
      c,
      "ad_prolongation",
      "prolongation",
      { mission_id: a.missionId, mois: c.mois },
      () => ecrireAvenant(c, m, e, a),
    );
    if (id !== null) faits.push(id);
  }
  return faits;
}

/** Choix du moteur, borné au reste du plafond mensuel du cabinet (10, marqueurs compris). */
function choisirAvenants(
  c: ContexteActiviteDemo,
  m: ContexteMois,
  e: EvaluationMissions,
): AvenantDemo[] {
  const reste = P.avenantsMaxParMois - e.dejaFaits;
  if (reste <= 0 || m.besoins.length === 0) return [];
  const avenants = choisirAvenantsDemo(m.besoins, m.grades, e.candidats).slice(0, reste);
  if (avenants.length === 0 && e.dejaFaits === 0) {
    // Le temps ira en activité interne ; l'exploitant relance le semis (DEPLOIEMENT (d) et (e)).
    journaliserIncident(INCIDENT, "plus_aucune_mission_alimentable", {
      cabinet_id: c.cabinetId,
      mois: c.mois,
    });
  }
  return avenants;
}

/* ----- Étape 2 : éligibilité des missions ----- */

async function evaluerMissions(
  c: ContexteActiviteDemo,
  missions: readonly MissionDemo[],
  collaborateurs: readonly CollaborateurDemo[],
): Promise<EvaluationMissions> {
  const parUtilisateur = new Map(collaborateurs.map((k) => [k.utilisateurId, k.id]));
  const affectes = await affectesParMission(c.db, missions, collaborateurs);
  const depuis = ajouterJours(fenetreDuMoisDemo(c.mois).debut, -1);
  const e: EvaluationMissions = { candidats: [], eligibles: new Map(), dejaFaits: 0 };
  for (const m of missions) {
    const cle = { mois: c.mois, entiteId: m.id };
    const deja = await marqueurExiste(c.db, ACTIONS_ACTIVITE_DEMO.prolongation, cle, depuis);
    if (deja) e.dejaFaits += 1;
    const detail = deja ? null : await eligibilite(c, m);
    const candidat: CandidatSocleDemo = {
      missionId: m.id,
      dateDebut: m.dateDebut,
      dateFin: m.dateFin,
      budgetCentiemes: detail ? versCentiemes(sommerJours(detail.lignes.map((l) => l.jours))) : 0,
      affectes: affectes.get(m.id) ?? [],
      encadrants: [m.chefId, m.directeurId]
        .map((u) => (u === null ? undefined : parUtilisateur.get(u)))
        .filter((k): k is string => k !== undefined),
      clesBudget: detail ? detail.lignes.map((l) => l.cle) : [],
      eligible: detail !== null,
    };
    e.candidats.push(candidat);
    if (detail) e.eligibles.set(m.id, { mission: m, auteur: detail.auteur, candidat });
  }
  return e;
}

/**
 * Mission alimentable (§5, étape 2) : client actif, mission datée, auteur et valideur possibles,
 * référence figée sans révision en cours (routes/budget.ts:162-166), moins de 36 avenants du job,
 * découpage cohérent avec la référence (DT12). Rend l'auteur et les lignes à jours de la référence.
 */
async function eligibilite(
  c: ContexteActiviteDemo,
  m: MissionDemo,
): Promise<{ auteur: Auth; lignes: LigneJours[] } | null> {
  const auteur = auteurAvenantDemo(c.acteurs, { chef_id: m.chefId, directeur_id: m.directeurId });
  if (!m.clientActif || m.dateDebut === null || !auteur) return null;
  const directeur = { directeur_id: m.directeurId };
  if (!valideurRevisionDemo(c.acteurs, directeur, auteur.utilisateurId, "directeur_mission")) {
    return null;
  }
  const versions = await chargerVersions(c.db, m.id);
  const reference = versionDeReference(versions);
  if (!reference || versions.some((v) => !v.figee)) return null;
  if (versions.filter(estAvenantDuJob).length >= P.avenantsMaxParMission) return null;
  const lignes = joursReference(reference);
  const decoupage = await joursDecoupageParCleDemo(c.db, m.id);
  return decoupageCoherentDemo(decoupage, enCentiemes(lignes)) ? { auteur, lignes } : null;
}

/**
 * Lignes d'honoraires à jours de la référence, clé sans le préfixe « honoraires: » (DT12) : une
 * ligne saisie hors découpage garde sa clé et rend la mission incohérente.
 */
function joursReference(reference: VersionDb): LigneJours[] {
  return reference.lignes
    .filter((l) => l.nature === "honoraires" && l.jours !== null)
    .map((l) => ({
      cle: sansPrefixe(l.cle, PREFIXE_HONORAIRES) ?? l.cle,
      jours: l.jours as number,
    }));
}

const enCentiemes = (lignes: readonly LigneJours[]) =>
  lignes.map((l) => ({ cle: l.cle, centiemes: versCentiemes(l.jours) }));

/** Collaborateurs déjà affectés (une fois au moins) à chaque mission : socle d'abord (§5). */
async function affectesParMission(
  db: Db,
  missions: readonly MissionDemo[],
  collaborateurs: readonly CollaborateurDemo[],
): Promise<Map<string, string[]>> {
  const parMission = new Map<string, string[]>();
  if (missions.length === 0 || collaborateurs.length === 0) return parMission;
  const r = await db.query(
    `SELECT DISTINCT mission_id, collaborateur_id FROM affectations
     WHERE mission_id = ANY ($1::uuid[]) AND collaborateur_id = ANY ($2::uuid[])
     ORDER BY mission_id, collaborateur_id LIMIT $3`,
    [missions.map((m) => m.id), collaborateurs.map((k) => k.id), AFFECTES_LUS_MAX],
  );
  for (const l of r.rows) {
    const id = l.mission_id as string;
    parMission.set(id, [...(parMission.get(id) ?? []), l.collaborateur_id as string]);
  }
  return parMission;
}

/* ----- Étape 3 : besoins des collaborateurs ----- */

/**
 * Besoin de chaque collaborateur interne actif sur la fenêtre du mois (`fenetreDuMoisDemo`), net
 * de ses affectations, de ses absences validées et des mois clôturés (moteur) ; cible
 * d'encadrement pour qui n'est que chef ou directeur, sans affectation.
 */
async function besoinsDuMois(
  c: ContexteActiviteDemo,
  calendrier: ParametresCalendrier,
  collaborateurs: readonly CollaborateurDemo[],
  e: EvaluationMissions,
): Promise<BesoinMembreDemo[]> {
  const fenetre = fenetreDuMoisDemo(c.mois);
  const clotures = await moisClotures(c.db);
  const ids = collaborateurs.map((k) => k.id);
  const affectations = await lireAffectationsDemo(c.db, ids, fenetre);
  const absences = await absencesValidees(c.db, ids, fenetre);
  const affectes = new Set(e.candidats.flatMap((m) => m.affectes));
  const encadrants = new Set(e.candidats.flatMap((m) => m.encadrants));
  const entree = (k: CollaborateurDemo): EntreeBesoinDemo => ({
    collaborateurId: k.id,
    capacitePct: k.capacitePct,
    absences: absences.get(k.id) ?? [],
    affectations: affectations.get(k.id) ?? [],
    encadrant: encadrants.has(k.id) && !affectes.has(k.id),
  });
  return collaborateurs
    .map((k) => besoinMembreDemo(entree(k), fenetre, calendrier, clotures))
    .filter((b): b is BesoinMembreDemo => b !== null);
}

/* ----- Étape 4 : écriture d'un avenant ----- */

async function ecrireAvenant(
  c: ContexteActiviteDemo,
  m: ContexteMois,
  e: MissionEligible,
  propose: AvenantDemo,
): Promise<string | null> {
  const mission = await exigerMissionModifiable(c.db, e.auteur, e.mission.id);
  exigerDroitsAvenant(e.auteur, mission);
  const avenant = await reverifier(c, m, e, mission, propose);
  if (!avenant) return null;
  const honorairesAvant = await honorairesSignes(c.db, mission);
  const dates = await repousserDateFin(c, mission.id, avenant.fin);
  const tacheId = await creerTacheAvenant(c, m, mission, avenant);
  const versionId = await creerRevisionAvenant(c, mission, e.auteur);
  await validerRevisionAvenant(c, mission, e.auteur.utilisateurId, versionId);
  const affectations = await affecterMembres(c, m, e.auteur, mission.id, tacheId, avenant);
  const echeances =
    e.mission.modeFacturation === "regie"
      ? 0
      : await echeancesAvenant(c, mission, e.auteur, avenant, honorairesAvant);
  await poserMarqueur(c, ACTIONS_ACTIVITE_DEMO.prolongation, "mission", mission.id, {
    mois: c.mois,
    version_id: versionId,
    tache_id: tacheId,
    jours_centiemes: avenant.totalCentiemes,
    affectations,
    echeances,
    date_fin_avant: dates.avant,
    date_fin_apres: dates.apres,
  });
  return mission.id;
}

function exigerDroitsAvenant(auteur: Auth, mission: MissionAcces): void {
  if (!DROITS_AVENANT.every((p) => aPermission(auteur.roles, p))) throw interdit();
  if (mission.statut !== "signee" && mission.statut !== "en_cours") {
    throw conflit("La mission n'est plus en vol : pas de prolongation.");
  }
}

/**
 * Étape 4a, mission verrouillée : révision en cours ou découpage modifié depuis la lecture →
 * refus ; membres d'un grade déjà sur-alloué (alloué > figé) retirés, avec un incident, et lignes
 * recalculées par le moteur sur les seuls membres gardés.
 */
async function reverifier(
  c: ContexteActiviteDemo,
  m: ContexteMois,
  e: MissionEligible,
  mission: MissionAcces,
  propose: AvenantDemo,
): Promise<AvenantDemo | null> {
  const versions = await chargerVersions(c.db, mission.id);
  const reference = versionDeReference(versions);
  if (!reference || versions.some((v) => !v.figee)) {
    throw conflit("Une révision du budget est en cours : mission non prolongée.");
  }
  const decoupage = await joursDecoupageParCleDemo(c.db, mission.id);
  if (!decoupageCoherentDemo(decoupage, enCentiemes(joursReference(reference)))) {
    throw conflit("Le découpage ne correspond plus au budget figé : mission non prolongée.");
  }
  const fige = await joursFigesParGrade(c.db, mission.id);
  const alloue = await joursAllouesParGrade(c.db, mission.id);
  const surAlloue = (mb: MembreAvenantDemo) => {
    const code = m.grades[mb.collaborateurId] ?? "";
    return fige !== null && (alloue.get(code) ?? 0) > (fige.get(code) ?? 0);
  };
  const exclus = propose.membres.filter(surAlloue);
  if (exclus.length === 0) return propose;
  for (const mb of exclus) {
    journaliserIncident(INCIDENT, "grade_sur_alloue", {
      mission_id: mission.id,
      collaborateur_id: mb.collaborateurId,
    });
  }
  const gardes = propose.membres.filter((mb) => !surAlloue(mb)).map((mb) => mb.collaborateurId);
  const besoins = m.besoins.filter((b) => gardes.includes(b.collaborateurId));
  const recalcules = choisirAvenantsDemo(besoins, m.grades, [e.candidat]);
  return recalcules.find((a) => a.missionId === mission.id) ?? null;
}

/**
 * Étape 4b, miroir de routes/missions.ts:597-638 (PATCH /missions/:id, champ `date_fin`) :
 * mission modifiable et verrouillée par l'appelant, droit `mission.creer` ; la date ne fait que
 * reculer. Aucun déclencheur ne vise `date_fin` (0011:82, 0302:66, 0303:57).
 */
async function repousserDateFin(
  c: ContexteActiviteDemo,
  missionId: string,
  fin: DateISO,
): Promise<{ avant: string | null; apres: string | null }> {
  const avant = await dateFinMission(c.db, missionId);
  const r = await c.db.query(
    `UPDATE missions SET date_fin = $2, modifie_le = $3
     WHERE id = $1 AND statut IN ('signee', 'en_cours') AND date_fin < $2`,
    [missionId, fin, c.maintenant],
  );
  return { avant, apres: r.rowCount ? fin : avant };
}

/**
 * Étapes 4d et 4e, miroir de routes/decoupage.ts:271-299 (POST /missions/:id/taches) : mission
 * modifiable (verrou de l'appelant), parent = phase de la mission, durée de 1 à 1000 jours ouvrés
 * (0012:55), jamais avant le début de la mission ; une tâche de même libellé dans la mission
 * refuse l'avenant (idempotence).
 */
async function creerTacheAvenant(
  c: ContexteActiviteDemo,
  m: ContexteMois,
  mission: MissionAcces,
  a: AvenantDemo,
): Promise<string> {
  const libelle = libelleTacheProlongationDemo(c.mois);
  const debut = plusTard(a.debut, mission.date_debut ?? a.debut);
  const duree = debut > a.fin ? 0 : joursOuvresDemo({ debut, fin: a.fin }, m.calendrier);
  if (duree < 1 || duree > DUREE_TACHE_MAX) {
    throw conflit("Fenêtre de prolongation sans jour ouvré.");
  }
  const doublon = await c.db.query(
    "SELECT 1 FROM mission_taches WHERE mission_id = $1 AND libelle = $2",
    [mission.id, libelle],
  );
  if (doublon.rowCount) throw conflit("La tâche de prolongation de ce mois existe déjà.");
  const phaseId = await phaseProlongation(c, mission.id);
  const dernier = await c.db.query(
    `SELECT ordre FROM mission_taches WHERE mission_id = $1 AND phase_id = $2
     ORDER BY ordre DESC LIMIT 1`,
    [mission.id, phaseId],
  );
  const t = await c.db.query(
    `INSERT INTO mission_taches (cabinet_id, mission_id, phase_id, lot_id, libelle, ordre,
       est_livrable, date_debut, duree_jours_ouvres)
     VALUES ($1, $2, $3, NULL, $4, $5, false, $6, $7) RETURNING id`,
    [c.cabinetId, mission.id, phaseId, libelle, suivant(dernier.rows[0]), debut, duree],
  );
  const tacheId = t.rows[0].id as string;
  await budgetTache(c, mission.id, tacheId, a.lignes);
  return tacheId;
}

/**
 * Étape 4c : phase des prolongations réutilisée, sinon créée, miroir de
 * routes/decoupage.ts:231-247 (POST /missions/:id/phases, mission modifiable verrouillée par
 * l'appelant), ordre = dernier + 1.
 */
async function phaseProlongation(c: ContexteActiviteDemo, missionId: string): Promise<string> {
  const p = await c.db.query(
    `SELECT id FROM mission_phases WHERE mission_id = $1 AND libelle = $2
     ORDER BY ordre, id LIMIT 1`,
    [missionId, LIBELLE_PHASE_PROLONGATION_DEMO],
  );
  if (p.rows[0]) return p.rows[0].id as string;
  const dernier = await c.db.query(
    "SELECT ordre FROM mission_phases WHERE mission_id = $1 ORDER BY ordre DESC LIMIT 1",
    [missionId],
  );
  const r = await c.db.query(
    `INSERT INTO mission_phases (cabinet_id, mission_id, libelle, ordre) VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [c.cabinetId, missionId, LIBELLE_PHASE_PROLONGATION_DEMO, suivant(dernier.rows[0])],
  );
  return r.rows[0].id as string;
}

/**
 * Étape 4e, miroir de routes/decoupage.ts:329-358 (PUT …/taches/:id/budget) : une ligne par clé,
 * `grade:CODE` → grade du cabinet (`gradesParCode`, 400 si inconnu), `collaborateur:ID` →
 * collaborateur (clé étrangère composite du cabinet).
 */
async function budgetTache(
  c: ContexteActiviteDemo,
  missionId: string,
  tacheId: string,
  lignes: AvenantDemo["lignes"],
): Promise<void> {
  const grades = await gradesParCode(
    c.db,
    lignes.flatMap((l) => sansPrefixe(l.cle, CLE_GRADE) ?? []),
  );
  for (const l of lignes) {
    const code = sansPrefixe(l.cle, CLE_GRADE);
    const gradeId = code === null ? null : (grades.get(code) ?? null);
    const collaborateurId = sansPrefixe(l.cle, CLE_COLLABORATEUR);
    if (gradeId === null && collaborateurId === null) throw conflit("Clé de budget inconnue.");
    await c.db.query(
      `INSERT INTO tache_budget_lignes (cabinet_id, mission_id, tache_id, grade_id,
         collaborateur_id, jours)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [c.cabinetId, missionId, tacheId, gradeId, collaborateurId, depuisCentiemes(l.centiemes)],
    );
  }
}

/**
 * Étape 4f, miroir de routes/budget.ts:159-195 (POST …/budget/revisions, `depuis_decoupage`) :
 * aucune révision en cours, référence figée, prix d'honoraires repris de la référence, lignes
 * forfaitaires conservées ; le moteur crée la révision sans toucher à la source figée.
 */
async function creerRevisionAvenant(
  c: ContexteActiviteDemo,
  mission: MissionAcces,
  auteur: Auth,
): Promise<string> {
  const versions = await chargerVersions(c.db, mission.id);
  if (versions.some((v) => !v.figee)) throw conflit("Une révision est déjà en cours.");
  const reference = versionDeReference(versions);
  if (!reference) throw conflit("La mission n'a pas de budget initial.");
  const source = reference.lignes.map(({ id: _id, ordre: _o, ...l }) => l);
  const prixReference = new Map(
    source
      .filter((l) => l.nature === "honoraires" && l.prix_journalier !== null)
      .map((l) => [l.cle, l.prix_journalier as number]),
  );
  const calcul = await calculerDepuisDecoupage(c.db, mission, { date: c.jour, prixReference });
  const lignes = [...calcul.lignes, ...source.filter((l) => l.montant_forfait !== null)];
  const motif = motifAvenantDemo(c.mois);
  const revision = creerRevision(versVersionMoteur(reference), {
    id: "nouvelle",
    type: "revise",
    motif,
    lignes: versVersionMoteur({ ...reference, figee: false, lignes }).lignes,
  });
  const r = await c.db.query(
    `INSERT INTO budget_versions (cabinet_id, mission_id, numero, type, devise, motif, cree_par)
     VALUES ($1, $2, $3, 'revise', $4, $5, $6) RETURNING id`,
    [c.cabinetId, mission.id, revision.numero, revision.devise, motif, auteur.utilisateurId],
  );
  const versionId = r.rows[0].id as string;
  await insererLignes(c.db, c.cabinetId, mission.id, versionId, lignes);
  return versionId;
}

/**
 * Étape 4g, miroir de routes/budget.ts:257-290 (POST …/versions/:id/valider) : figeage par le
 * moteur, rôle exigé par FIN-15 (écarts cumulés depuis le budget initial), valideur directeur de
 * la mission ou associé, jamais l'auteur, avec `budget.reviser`.
 */
async function validerRevisionAvenant(
  c: ContexteActiviteDemo,
  mission: MissionAcces,
  auteurId: string,
  versionId: string,
): Promise<void> {
  const versions = await chargerVersions(c.db, mission.id);
  const version = versions.find((v) => v.id === versionId);
  if (!version) throw conflit("Révision de prolongation introuvable.");
  const figee = figerVersion(versVersionMoteur(version), c.jour);
  const requis = roleApprobateurRevision(versions, version, mission);
  const valideur = valideurRevisionDemo(c.acteurs, mission, auteurId, requis);
  exigerValideur(valideur, mission, auteurId, requis);
  const r = await c.db.query(
    `UPDATE budget_versions SET figee = true, date_figeage = $2, validee_par = $3, validee_le = $4,
       role_approbateur = $5
     WHERE id = $1 AND NOT figee`,
    [versionId, figee.dateFigeage, valideur.utilisateurId, c.maintenant, requis],
  );
  if (!r.rowCount) throw conflit("Révision de prolongation déjà validée.");
}

/** Contrôles de routes/budget.ts:263-285, revérifiés sur l'acteur choisi par acteurs.ts. */
function exigerValideur(
  v: Auth | null,
  mission: MissionAcces,
  auteurId: string,
  requis: RoleApprobateur,
): asserts v is Auth {
  const permis =
    v !== null &&
    v.utilisateurId !== auteurId &&
    aPermission(v.roles, "budget.reviser") &&
    (estAssocie(v) || mission.directeur_id === v.utilisateurId) &&
    satisfaitRole(v.roles, requis);
  if (!permis) throw conflit("Aucun valideur possible pour la révision de prolongation.");
}

/**
 * Étape 4h : une affectation par membre sur `[max(début, fenêtre), min(fin, fenêtre, date_fin)]`
 * (`fenetreTache` finit au dernier jour ouvré) ; une période vide est consignée et sautée, un
 * avenant sans aucune affectation est abandonné.
 */
async function affecterMembres(
  c: ContexteActiviteDemo,
  m: ContexteMois,
  auteur: Auth,
  missionId: string,
  tacheId: string,
  a: AvenantDemo,
): Promise<number> {
  const mp = await exigerMissionAffectable(c.db, auteur, missionId);
  exigerMissionDatee(mp);
  const decoupage = await chargerDecoupage(c.db, missionId);
  const fenetre = fenetreTache(mp, decoupage, tacheId, m.calendrier);
  if (!fenetre) throw conflit("Fenêtre de la tâche de prolongation introuvable.");
  let n = 0;
  for (const mb of a.membres) {
    const fin = plusTot(plusTot(mb.fin, fenetre.fin), mp.date_fin ?? fenetre.fin);
    const periode = { debut: plusTard(mb.debut, fenetre.debut), fin };
    if (periode.fin < periode.debut) {
      journaliserIncident(INCIDENT, "periode_affectation_vide", {
        mission_id: missionId,
        collaborateur_id: mb.collaborateurId,
      });
      continue;
    }
    await affecterMembre(c, auteur, mp, tacheId, mb, periode);
    n += 1;
  }
  if (n === 0) throw conflit("Aucune affectation possible : avenant abandonné.");
  return n;
}

/**
 * Miroir de routes/affectations.ts:169-212 (POST /missions/:id/affectations, nominative) et de
 * `ajouterAEquipe` (:99-126) : pas du cabinet, période dans la mission (la fenêtre de la tâche est
 * garantie par l'appelant), place sur la tâche, collaborateur affectable, pas d'auto-affectation
 * hors responsable, budget figé par grade (409 BUDGET_FIGE_DEPASSE), entrée dans l'équipe.
 */
async function affecterMembre(
  c: ContexteActiviteDemo,
  auteur: Auth,
  mp: MissionPlanifiee,
  tacheId: string,
  mb: MembreAvenantDemo,
  periode: Periode,
): Promise<void> {
  const jours = depuisCentiemes(mb.centiemes);
  await exigerPasDuCabinet(c.db, c.cabinetId, jours);
  exigerDansMission(mp, periode);
  await exigerPlaceSurTache(c.db, tacheId);
  const k = await collaborateurAffectable(c.db, mb.collaborateurId);
  const responsable = peutModifierMission(auteur, mp);
  if (k.utilisateur_id === auteur.utilisateurId && !responsable) throw interdit();
  const fige = await joursFigesParGrade(c.db, mp.id);
  const avant = await joursAllouesParGrade(c.db, mp.id);
  await c.db.query(
    `INSERT INTO affectations (cabinet_id, mission_id, tache_id, collaborateur_id, grade_id,
       competence, jours_alloues, date_debut, date_fin, cree_par)
     VALUES ($1, $2, $3, $4, NULL, NULL, $5, $6, $7, $8)`,
    [c.cabinetId, mp.id, tacheId, k.id, jours, periode.debut, periode.fin, auteur.utilisateurId],
  );
  exigerDansBudgetFige(fige, avant, await joursAllouesParGrade(c.db, mp.id));
  if (!k.utilisateur_id || !responsable) return;
  await c.db.query(
    `INSERT INTO mission_equipe (cabinet_id, mission_id, utilisateur_id, ajoute_par, source)
     VALUES ($1, $2, $3, $4, 'affectation') ON CONFLICT (mission_id, utilisateur_id) DO NOTHING`,
    [c.cabinetId, mp.id, k.utilisateur_id, auteur.utilisateurId],
  );
}

/**
 * Étape 4i (hors régie), miroir de routes/echeancier.ts:281-320 (POST /missions/:id/echeances) :
 * gestion de l'échéancier, total borné par le budget signé APRÈS l'avenant (moteur). Le supplément
 * d'honoraires (moteur) est réparti par le moteur sur les lundis de l'avenant à partir de la
 * semaine du jour : chaque lundi suivant porte une échéance due.
 */
async function echeancesAvenant(
  c: ContexteActiviteDemo,
  mission: MissionAcces,
  auteur: Auth,
  a: AvenantDemo,
  avant: Montant,
): Promise<number> {
  if (!peutGererEcheancier(auteur, mission)) throw interdit();
  const apres = await honorairesSignes(c.db, mission);
  const depuis = lundiDeLaSemaine(c.jour);
  const lundis = semainesCouvrant({ debut: a.debut, fin: a.fin })
    .map((s) => s.debut)
    .filter((l) => l >= depuis);
  const supplement = soustraire(apres, avant);
  const parts = repartirEcheancesDemo(supplement, lundis).filter((p) => p.montant.valeur > 0);
  if (parts.length === 0) return 0;
  const libelle = (lundi: DateISO) => libelleEcheance(c.mois, lundi);
  const existantes = await chargerEcheances(c.db, mission.id);
  exigerDansLeBudget(
    [
      ...echeancesMoteur(existantes),
      ...parts.map((p) => ({ libelle: libelle(p.date), date: p.date, montant: p.montant })),
    ],
    apres,
  );
  for (const [i, p] of parts.entries()) {
    await insererEcheance(
      c.db,
      c.cabinetId,
      mission,
      {
        type: "avancement",
        libelle: libelle(p.date),
        montant: p.montant.valeur,
        pourcentage: null,
        date_prevue: p.date,
        jalon_id: null,
        statut: "prevue",
      },
      existantes.length + i + 1,
      auteur.utilisateurId,
    );
  }
  return parts.length;
}
