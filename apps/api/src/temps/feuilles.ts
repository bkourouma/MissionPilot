import {
  ajouterJours,
  arrondirAuPas,
  capacite,
  formaterJours,
  joursAffectesSurPeriode,
  joursVersMinutes,
  sommerHeuresEnJours,
  sommerJours,
  versCentiemes,
  type Periode,
} from "@missionpilot/engines";
import { aPermission, type LigneTempsSaisie } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, conflit, introuvable, requeteInvalide } from "../errors.js";
import { estAssocie } from "../missions/acces.js";
import { chargerCalendrier } from "../missions/outils.js";
import { absencesValidees, affectationsDe } from "../planification/charge.js";
import {
  exigerDatesModifiables,
  exigerUniteDuCabinet,
  jours,
  joursDeSaisies,
  minutesDe,
  moisClotures,
  valideInterne,
  voitToutesLesFeuilles,
  type ParametresTemps,
} from "./outils.js";

/*
 * Feuilles de temps (TPS-01 à TPS-03).
 *
 * RÈGLES (testées dans test/feuilles-temps.test.ts)
 * - Une feuille par collaborateur et par semaine (lundi), saisie par
 *   l'utilisateur rattaché au collaborateur (son auteur).
 * - Une ligne porte sur une tâche AFFECTÉE nominativement au collaborateur
 *   (sinon 400 TACHE_NON_AFFECTEE) ou sur une activité interne active.
 * - Le total d'un jour (hors activités d'absence) au-delà de la capacité du
 *   jour (calendrier du cabinet, absences validées) est signalé ou refusé
 *   selon le paramètre du cabinet.
 * - Une feuille soumise se décide par parties : chaque mission par son chef
 *   ou son directeur (ou un associé), les activités internes par un associé
 *   ou un directeur de mission. Jamais par l'auteur, sauf associé. Un rejet
 *   (motif obligatoire) rejette la feuille, qui peut être corrigée puis
 *   resoumise ; la feuille est validée quand toutes ses parties le sont.
 * - Un tiers ne voit que les parties qu'il peut décider : un chef ne lit pas
 *   les activités internes (congés…) ni les autres missions d'un consultant.
 */

export interface FeuilleDb {
  id: string;
  collaborateur_id: string;
  collaborateur_nom: string;
  auteur_id: string | null;
  semaine: string;
  statut: string;
  origine: string;
  cycle: number;
  premiere_soumission_le: Date | null;
  soumise_le: Date | null;
  validee_le: Date | null;
  rejetee_le: Date | null;
  rejetee_par: string | null;
  motif_rejet: string | null;
  verrouillee_le: Date | null;
  cree_le: Date;
  modifie_le: Date;
}

const COLONNES_FEUILLE = `f.id, f.collaborateur_id, c.nom AS collaborateur_nom, f.auteur_id,
  f.semaine::text AS semaine, f.statut, f.origine, f.cycle, f.premiere_soumission_le, f.soumise_le,
  f.validee_le, f.rejetee_le, f.rejetee_par, f.motif_rejet, f.verrouillee_le, f.cree_le, f.modifie_le`;

export async function lireFeuille(db: Db, id: string, verrouiller = false): Promise<FeuilleDb> {
  const r = await db.query(
    `SELECT ${COLONNES_FEUILLE} FROM feuilles_temps f JOIN collaborateurs c ON c.id = f.collaborateur_id
     WHERE f.id = $1 ${verrouiller ? "FOR UPDATE OF f" : ""}`,
    [id],
  );
  if (!r.rows[0]) throw introuvable("Feuille de temps");
  return r.rows[0] as FeuilleDb;
}

export interface LigneDb {
  id: string;
  date: string;
  mission_id: string | null;
  mission_intitule: string | null;
  tache_id: string | null;
  tache_libelle: string | null;
  activite_id: string | null;
  activite_code: string | null;
  activite_libelle: string | null;
  est_absence: boolean | null;
  centiemes: number;
  minutes: number | null;
  commentaire: string | null;
}

export async function lignesDe(db: Db, feuilleId: string): Promise<LigneDb[]> {
  const r = await db.query(
    `SELECT l.id, l.date::text AS date, l.mission_id, m.intitule AS mission_intitule, l.tache_id,
       t.libelle AS tache_libelle, l.activite_id, a.code AS activite_code, a.libelle AS activite_libelle,
       a.est_absence, l.centiemes, l.minutes, l.commentaire
     FROM lignes_temps l
     LEFT JOIN missions m ON m.id = l.mission_id
     LEFT JOIN mission_taches t ON t.id = l.tache_id
     LEFT JOIN activites_internes a ON a.id = l.activite_id
     WHERE l.feuille_id = $1
     ORDER BY l.date, m.intitule NULLS LAST, t.libelle, a.libelle, l.id`,
    [feuilleId],
  );
  return r.rows as LigneDb[];
}

/** Partie d'une feuille : une mission (chef et directeur), ou les activités internes (null). */
export interface Partie {
  mission_id: string | null;
  intitule: string;
  chef_id: string | null;
  directeur_id: string | null;
}

export async function partiesDe(db: Db, feuilleId: string): Promise<Partie[]> {
  const r = await db.query(
    `SELECT DISTINCT l.mission_id, coalesce(m.intitule, 'Activités internes') AS intitule,
       m.chef_id, m.directeur_id
     FROM lignes_temps l LEFT JOIN missions m ON m.id = l.mission_id
     WHERE l.feuille_id = $1
     ORDER BY intitule, l.mission_id NULLS FIRST`,
    [feuilleId],
  );
  return r.rows as Partie[];
}

const estAuteur = (auth: Auth, f: Pick<FeuilleDb, "auteur_id">) =>
  f.auteur_id === auth.utilisateurId;

/** Lit une partie : l'auteur, qui voit tout le cabinet, ou le chef / directeur de la mission. */
export function partieVisible(auth: Auth, f: FeuilleDb, p: Partie): boolean {
  if (estAuteur(auth, f) || voitToutesLesFeuilles(auth)) return true;
  if (p.mission_id === null) return false;
  return p.chef_id === auth.utilisateurId || p.directeur_id === auth.utilisateurId;
}

/** Décide une partie : droit temps.valider, jamais l'auteur (sauf associé). */
export function peutDeciderPartie(auth: Auth, f: FeuilleDb, p: Partie): boolean {
  if (!aPermission(auth.roles, "temps.valider")) return false;
  if (estAuteur(auth, f) && !estAssocie(auth)) return false;
  if (p.mission_id === null) return valideInterne(auth);
  return (
    estAssocie(auth) || p.chef_id === auth.utilisateurId || p.directeur_id === auth.utilisateurId
  );
}

/** Feuille lisible par l'utilisateur (au moins une partie visible), sinon 404. */
export async function exigerFeuilleVisible(
  db: Db,
  auth: Auth,
  id: string,
  verrouiller = false,
): Promise<{ feuille: FeuilleDb; parties: Partie[] }> {
  const feuille = await lireFeuille(db, id, verrouiller);
  const parties = await partiesDe(db, id);
  if (!estAuteur(auth, feuille) && !voitToutesLesFeuilles(auth)) {
    if (!parties.some((p) => partieVisible(auth, feuille, p)))
      throw introuvable("Feuille de temps");
  }
  return { feuille, parties };
}

/** Feuille de l'utilisateur connecté, modifiable (brouillon ou rejetée). */
export async function exigerFeuilleModifiable(db: Db, auth: Auth, id: string): Promise<FeuilleDb> {
  const { feuille } = await exigerFeuilleVisible(db, auth, id, true);
  if (!estAuteur(auth, feuille)) {
    throw new AppError(403, "INTERDIT", "Seul l'auteur d'une feuille de temps la modifie.");
  }
  if (feuille.statut !== "brouillon" && feuille.statut !== "rejetee") {
    throw conflit("Feuille de temps soumise ou validée : elle ne se modifie plus.");
  }
  return feuille;
}

export interface DecisionDb {
  mission_id: string | null;
  decision: string;
  motif: string | null;
  decide_par: string;
  decide_le: Date;
}

export async function decisionsDuCycle(db: Db, f: FeuilleDb): Promise<DecisionDb[]> {
  const r = await db.query(
    `SELECT mission_id, decision, motif, decide_par, decide_le FROM feuille_validations
     WHERE feuille_id = $1 AND cycle = $2`,
    [f.id, f.cycle],
  );
  return r.rows as DecisionDb[];
}

/** Statut d'une partie dans le cycle courant. */
function statutPartie(f: FeuilleDb, p: Partie, decisions: DecisionDb[]): string | null {
  const d = decisions.find((x) => x.mission_id === p.mission_id);
  if (d) return d.decision;
  if (f.statut === "validee" || f.statut === "verrouillee") return "validee";
  if (f.statut === "soumise") return "en_attente";
  return null;
}

export interface Avertissement {
  code: string;
  message: string;
}

/** Vue d'une feuille, réduite aux parties visibles de l'utilisateur. */
export async function vueFeuille(
  db: Db,
  auth: Auth,
  f: FeuilleDb,
  avertissements: Avertissement[] = [],
): Promise<Record<string, unknown>> {
  const parties = await partiesDe(db, f.id);
  const visibles = parties.filter((p) => partieVisible(auth, f, p));
  const ids = new Set(visibles.map((p) => p.mission_id));
  const lignes = (await lignesDe(db, f.id)).filter((l) => ids.has(l.mission_id));
  const decisions = await decisionsDuCycle(db, f);
  const parJour = new Map<string, number[]>();
  for (const l of lignes) parJour.set(l.date, [...(parJour.get(l.date) ?? []), jours(l.centiemes)]);
  const complete = visibles.length === parties.length;
  return {
    ...f,
    // Le motif d'un rejet est rendu à l'auteur et à qui voit toute la feuille.
    motif_rejet: complete ? f.motif_rejet : null,
    lignes: lignes.map((l) => ({
      id: l.id,
      date: l.date,
      mission_id: l.mission_id,
      mission_intitule: l.mission_intitule,
      tache_id: l.tache_id,
      tache_libelle: l.tache_libelle,
      activite_id: l.activite_id,
      activite_code: l.activite_code,
      activite_libelle: l.activite_libelle,
      jours: jours(l.centiemes),
      heures: l.minutes === null ? null : l.minutes / 60,
      commentaire: l.commentaire,
    })),
    parties: visibles.map((p) => {
      const d = decisions.find((x) => x.mission_id === p.mission_id);
      return {
        mission_id: p.mission_id,
        intitule: p.intitule,
        statut: statutPartie(f, p, decisions),
        decide_par: d?.decide_par ?? null,
        decide_le: d?.decide_le ?? null,
        motif: d?.motif ?? null,
        peut_decider: f.statut === "soumise" && !d ? peutDeciderPartie(auth, f, p) : false,
      };
    }),
    vue_partielle: !complete,
    totaux: {
      par_jour: [...parJour]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, valeurs]) => ({ date, jours: sommerJours(valeurs) })),
      semaine: sommerJours(lignes.map((l) => jours(l.centiemes))),
    },
    avertissements,
  };
}

/* ----- Préparation et contrôle des lignes ----- */

export interface LignePreparee {
  date: string;
  mission_id: string | null;
  tache_id: string | null;
  activite_id: string | null;
  centiemes: number;
  minutes: number | null;
  commentaire: string | null;
  est_absence: boolean;
}

interface TacheSaisie {
  id: string;
  mission_id: string;
  libelle: string;
  mission_statut: string;
  affectee: boolean;
}

/** Tâches citées, avec leur mission et l'existence d'une affectation nominative. */
async function tachesSaisies(
  db: Db,
  collaborateurId: string,
  ids: string[],
): Promise<Map<string, TacheSaisie>> {
  if (ids.length === 0) return new Map();
  const r = await db.query(
    `SELECT t.id, t.mission_id, t.libelle, m.statut AS mission_statut,
       EXISTS (SELECT 1 FROM affectations a WHERE a.tache_id = t.id AND a.collaborateur_id = $2)
         AS affectee
     FROM mission_taches t JOIN missions m ON m.id = t.mission_id
     WHERE t.id = ANY ($1::uuid[])`,
    [ids, collaborateurId],
  );
  return new Map(r.rows.map((t) => [t.id as string, t as TacheSaisie]));
}

/** Refuse une tâche inconnue, non affectée, ou d'une mission clôturée. */
export function exigerTacheSaisissable(t: TacheSaisie | undefined): TacheSaisie {
  if (!t) throw requeteInvalide("Tâche inconnue dans ce cabinet.");
  if (!t.affectee) {
    throw new AppError(
      400,
      "TACHE_NON_AFFECTEE",
      `La tâche « ${t.libelle} » ne vous est pas affectée : saisie refusée. Demandez une affectation au chef de mission.`,
    );
  }
  if (t.mission_statut === "cloturee")
    throw conflit(`La mission de la tâche « ${t.libelle} » est clôturée.`);
  return t;
}

async function activitesSaisies(
  db: Db,
  ids: string[],
): Promise<Map<string, { id: string; libelle: string; est_absence: boolean; actif: boolean }>> {
  if (ids.length === 0) return new Map();
  const r = await db.query(
    "SELECT id, libelle, est_absence, actif FROM activites_internes WHERE id = ANY ($1::uuid[])",
    [ids],
  );
  return new Map(r.rows.map((a) => [a.id as string, a]));
}

/**
 * Valide et regroupe les lignes saisies : une case par (jour, tâche ou
 * activité) ; les saisies d'une même case sont additionnées (en heures, la
 * somme est convertie une seule fois par le moteur). Contrôles : semaine,
 * unité et pas du cabinet, période ouverte, tâche affectée, activité active.
 */
export async function preparerLignes(
  db: Db,
  f: FeuilleDb,
  saisies: readonly LigneTempsSaisie[],
  p: ParametresTemps,
): Promise<LignePreparee[]> {
  const fin = ajouterJours(f.semaine, 6);
  saisies.forEach((s, i) => {
    if (s.date < f.semaine || s.date > fin) {
      throw requeteInvalide(
        `Ligne ${i + 1} : la date ${s.date} est hors de la semaine de la feuille.`,
      );
    }
    exigerUniteDuCabinet(s, p, `Ligne ${i + 1}`);
  });
  exigerDatesModifiables(
    saisies.map((s) => s.date),
    await moisClotures(db),
  );
  const taches = await tachesSaisies(db, f.collaborateur_id, [
    ...new Set(saisies.flatMap((s) => (s.tache_id ? [s.tache_id] : []))),
  ]);
  const activites = await activitesSaisies(db, [
    ...new Set(saisies.flatMap((s) => (s.activite_id ? [s.activite_id] : []))),
  ]);
  const cases = new Map<string, LigneTempsSaisie[]>();
  for (const s of saisies) {
    const cle = `${s.date}|${s.tache_id ?? ""}|${s.activite_id ?? ""}`;
    cases.set(cle, [...(cases.get(cle) ?? []), s]);
  }
  const lignes: LignePreparee[] = [];
  for (const groupe of cases.values()) {
    const s = groupe[0] as LigneTempsSaisie;
    let missionId: string | null = null;
    let estAbsence = false;
    if (s.tache_id) {
      missionId = exigerTacheSaisissable(taches.get(s.tache_id)).mission_id;
    } else {
      const a = activites.get(s.activite_id as string);
      if (!a || !a.actif) throw requeteInvalide("Activité interne inconnue ou désactivée.");
      estAbsence = a.est_absence;
    }
    const valeur = joursDeSaisies(groupe, p);
    const centiemes = versCentiemes(valeur);
    if (centiemes <= 0) continue;
    const minutes =
      p.granularite === "heure" ? groupe.reduce((t, g) => t + minutesDe(g.heures ?? 0), 0) : null;
    if ((minutes !== null && minutes > 24 * 60) || valeur > 3) {
      throw requeteInvalide(`Le ${s.date} : une même case dépasse 24 heures ou 3 jours.`);
    }
    const commentaires = groupe.flatMap((g) => (g.commentaire ? [g.commentaire] : []));
    lignes.push({
      date: s.date,
      mission_id: missionId,
      tache_id: s.tache_id ?? null,
      activite_id: s.activite_id ?? null,
      centiemes,
      minutes,
      commentaire: commentaires.length ? commentaires.join(" ; ").slice(0, 500) : null,
      est_absence: estAbsence,
    });
  }
  return lignes;
}

/**
 * Jours au-delà de la capacité du jour (moteur : calendrier du cabinet et
 * absences validées), activités d'absence exclues. En heures, le total du
 * jour est la somme des minutes convertie une seule fois.
 */
export async function depassementsCapacite(
  db: Db,
  cabinetId: string,
  collaborateurId: string,
  semaine: Periode,
  lignes: readonly Pick<LignePreparee, "date" | "centiemes" | "minutes" | "est_absence">[],
  p: ParametresTemps,
): Promise<string[]> {
  const calendrier = await chargerCalendrier(db, cabinetId);
  const absences =
    (await absencesValidees(db, [collaborateurId], semaine)).get(collaborateurId) ?? [];
  const parJour = new Map<string, typeof lignes>();
  for (const l of lignes) {
    if (l.est_absence) continue;
    parJour.set(l.date, [...(parJour.get(l.date) ?? []), l]);
  }
  const depassements: string[] = [];
  for (const [date, du] of [...parJour].sort(([a], [b]) => a.localeCompare(b))) {
    const total =
      p.granularite === "heure" && du.every((l) => l.minutes !== null)
        ? sommerHeuresEnJours(
            du.map((l) => (l.minutes as number) / 60),
            p.heuresParJour,
          )
        : sommerJours(du.map((l) => jours(l.centiemes)));
    const cap = capacite({ debut: date, fin: date }, calendrier, absences, 100);
    if (versCentiemes(total) > versCentiemes(cap)) {
      depassements.push(
        `${date} : ${formaterJours(total)} j saisis pour une capacité de ${formaterJours(cap)} j`,
      );
    }
  }
  return depassements;
}

/** Applique le paramètre du cabinet : refus (400) ou avertissement. */
export function appliquerControleCapacite(
  depassements: string[],
  p: ParametresTemps,
): Avertissement[] {
  if (depassements.length === 0) return [];
  const message = `Capacité journalière dépassée : ${depassements.join(" ; ")}.`;
  if (p.controleCapacite === "refuser") {
    throw new AppError(400, "CAPACITE_DEPASSEE", message);
  }
  return [{ code: "CAPACITE_DEPASSEE", message }];
}

/** Lignes stockées au format de contrôle (soumission). */
export async function lignesPourControle(db: Db, feuilleId: string): Promise<LignePreparee[]> {
  return (await lignesDe(db, feuilleId)).map((l) => ({
    date: l.date,
    mission_id: l.mission_id,
    tache_id: l.tache_id,
    activite_id: l.activite_id,
    centiemes: l.centiemes,
    minutes: l.minutes,
    commentaire: l.commentaire,
    est_absence: l.est_absence === true,
  }));
}

/** À la soumission : chaque tâche est encore affectée et sa mission ouverte. */
export async function reverifierTaches(
  db: Db,
  f: FeuilleDb,
  lignes: LignePreparee[],
): Promise<void> {
  const ids = [...new Set(lignes.flatMap((l) => (l.tache_id ? [l.tache_id] : [])))];
  const taches = await tachesSaisies(db, f.collaborateur_id, ids);
  for (const id of ids) exigerTacheSaisissable(taches.get(id));
  const inactives = await db.query(
    `SELECT 1 FROM lignes_temps l JOIN activites_internes a ON a.id = l.activite_id
     WHERE l.feuille_id = $1 AND NOT a.actif LIMIT 1`,
    [f.id],
  );
  if (inactives.rowCount)
    throw requeteInvalide("Une activité interne de la feuille est désactivée.");
}

/* ----- Pré-remplissage (TPS-01) ----- */

export interface LignePreRemplie {
  date: string;
  mission_id: string;
  tache_id: string;
  jours: number;
}

/**
 * Lignes proposées depuis les affectations nominatives de la semaine
 * (missions non clôturées) : pour chaque jour, cumul alloué du moteur arrondi
 * au pas du cabinet, puis différence des cumuls arrondis ; la semaine totalise
 * ainsi exactement les jours alloués arrondis au pas.
 */
export async function lignesPreRemplies(
  db: Db,
  cabinetId: string,
  collaborateurId: string,
  semaine: Periode,
  p: ParametresTemps,
): Promise<LignePreRemplie[]> {
  const calendrier = await chargerCalendrier(db, cabinetId);
  const affectations = await affectationsDe(db, [collaborateurId], semaine);
  if (affectations.length === 0) return [];
  const ouvertes = await db.query(
    `SELECT a.id, a.mission_id FROM affectations a JOIN missions m ON m.id = a.mission_id
     WHERE a.id = ANY ($1::uuid[]) AND m.statut <> 'cloturee'`,
    [affectations.map((a) => a.id)],
  );
  const missionDe = new Map(ouvertes.rows.map((r) => [r.id as string, r.mission_id as string]));
  const cases = new Map<string, LignePreRemplie>();
  for (const a of affectations) {
    const missionId = missionDe.get(a.id);
    if (!missionId) continue;
    let precedent = 0;
    for (let i = 0; i < 7; i++) {
      const date = ajouterJours(semaine.debut, i);
      const cumul = arrondirAuPas(
        joursAffectesSurPeriode(a, { debut: semaine.debut, fin: date }, calendrier),
        p.granularite,
        p.heuresParJour,
      );
      const duJour = sommerJours([cumul, -precedent]);
      precedent = cumul;
      if (duJour <= 0) continue;
      const cle = `${date}|${a.tacheId}`;
      const existante = cases.get(cle);
      cases.set(cle, {
        date,
        mission_id: missionId,
        tache_id: a.tacheId,
        jours: existante ? sommerJours([existante.jours, duJour]) : duJour,
      });
    }
  }
  return [...cases.values()].sort(
    (x, y) => x.date.localeCompare(y.date) || x.tache_id.localeCompare(y.tache_id),
  );
}

/** Insère des lignes préparées (la feuille doit être en brouillon ou rejetée). */
export async function insererLignes(
  db: Db,
  cabinetId: string,
  feuilleId: string,
  lignes: readonly LignePreparee[],
): Promise<void> {
  for (const l of lignes) {
    await db.query(
      `INSERT INTO lignes_temps (cabinet_id, feuille_id, date, mission_id, tache_id, activite_id,
         centiemes, minutes, commentaire)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        cabinetId,
        feuilleId,
        l.date,
        l.mission_id,
        l.tache_id,
        l.activite_id,
        l.centiemes,
        l.minutes,
        l.commentaire,
      ],
    );
  }
}

/** Pré-remplissage au format des lignes préparées (minutes en saisie horaire). */
export function versLignesPreparees(
  lignes: readonly LignePreRemplie[],
  p: ParametresTemps,
): LignePreparee[] {
  return lignes.map((l) => ({
    date: l.date,
    mission_id: l.mission_id,
    tache_id: l.tache_id,
    activite_id: null,
    centiemes: versCentiemes(l.jours),
    minutes: p.granularite === "heure" ? joursVersMinutes(l.jours, p.heuresParJour) : null,
    commentaire: null,
    est_absence: false,
  }));
}
