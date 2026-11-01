import {
  appliquerPlanFeuilleDemo,
  depuisCentiemes,
  estPasValide,
  PARAMETRES_ACTIVITE_DEMO,
  planifierFeuilleDemo,
  type DateISO,
  type EntreeFeuilleDemo,
  type LigneFeuilleDemo,
  type PlanFeuilleDemo,
  type TacheCapaciteDemo,
} from "@missionpilot/engines";
import type { LigneTempsSaisie } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import { AppError, conflit, requeteInvalide } from "../errors.js";
import { exigerMissionVisible } from "../missions/acces.js";
import { collaborateurAffectable } from "../planification/outils.js";
import {
  appliquerControleCapacite,
  depassementsCapacite,
  insererLignes,
  lignesPourControle,
  lireFeuille,
  partiesDe,
  peutDeciderPartie,
  preparerLignes,
  reverifierTaches,
} from "../temps/feuilles.js";
import {
  exigerDatesModifiables,
  moisClotures,
  semaineDe,
  type ParametresTemps,
} from "../temps/outils.js";
import { collaborateurAuthDemo, valideurPartieDemo } from "./acteurs.js";
import {
  ACTIONS_ACTIVITE_DEMO,
  dansPointDeSauvegarde,
  poserMarqueur,
  type ContexteActiviteDemo,
} from "./commun.js";
import {
  feuilleExisteDemo,
  type CollaborateurDemo,
  type LecturesSemaineDemo,
  type SuiviTacheDemo,
} from "./lecture.js";

/*
 * Feuilles de temps de la tâche « activite_demo » (DECISIONS « Activité de démonstration
 * automatique », §2.4, D4, D5, DT3, DT5, DT7).
 *
 * Pour chaque collaborateur interne actif de la semaine (au plus `collaborateursMax`, par nom
 * puis identifiant), le moteur `planifierFeuilleDemo` propose une feuille complète du lundi au
 * vendredi ouvrés : la part mission respecte la règle de capacité des tâches (DT5), le reste du
 * jour va sur une activité interne (DT7). La feuille est ensuite écrite par les fonctions
 * EXPORTÉES de temps/feuilles.ts (mêmes contrôles que la saisie), soumise puis validée par des
 * blocs SQL miroirs des routes (commentés « miroir de <route>:<lignes> »).
 *
 * - Rien n'est écrit si une feuille existe déjà pour la semaine (D4, `UNIQUE (cabinet_id,
 *   collaborateur_id, semaine)` de 0030) : une feuille d'un visiteur, même en brouillon, est
 *   laissée intacte ; lignes et validations ne s'écrivent que sur une feuille créée ici.
 * - Un point de sauvegarde `ad_feuille` par collaborateur : un échec isolable (contrôle refusé,
 *   période clôturée, aucun valideur) est consigné sans contenu et n'arrête pas les autres.
 * - Horodatages : `ctx.maintenant` (DT3) ; auteur = l'utilisateur du collaborateur ; jamais
 *   l'auteur comme valideur ; aucune notification (les alertes sont évaluées par l'appelant,
 *   sans notification, DT9).
 * - Les chiffres (jours, capacités, redéclarations) sortent du moteur ; ce module ne calcule
 *   aucun jour, il cumule seulement les centièmes consommés par mission (choix du jalon).
 */

/** Résultat de l'écriture d'une feuille dans son point de sauvegarde. */
interface FeuilleEcrite {
  lignes: number;
  redeclarations: number;
  /** Missions des parties validées (alertes à réévaluer). */
  missions: string[];
}

/** Capacité de départ d'une tâche (§2.3) : rien n'est encore planifié cette semaine. */
function versTacheCapacite(s: SuiviTacheDemo, missionEnDerive: boolean): TacheCapaciteDemo {
  return {
    tacheId: s.tacheId,
    missionId: s.missionId,
    budgetCentiemes: s.budgetCentiemes,
    realiseCentiemes: s.realiseCentiemes,
    attenteCentiemes: s.attenteCentiemes,
    declarations: s.declarations,
    planifieCentiemes: 0,
    planifieParCollaborateur: {},
    missionEnDerive,
  };
}

/**
 * État de capacité des tâches de la semaine (une entrée par tâche des missions lues), à passer à
 * `genererFeuillesSemaineDemo` ; la mission en dérive reçoit la capacité « libre » (DT5).
 */
export function tachesCapaciteDemo(
  l: LecturesSemaineDemo,
  missionDerive: string | null,
): Map<string, TacheCapaciteDemo> {
  const taches = new Map<string, TacheCapaciteDemo>();
  for (const suivis of l.suivis.values()) {
    for (const s of suivis) {
      taches.set(s.tacheId, versTacheCapacite(s, s.missionId === missionDerive));
    }
  }
  return taches;
}

/** Ordre de parcours (§2.4) : nom sans casse, puis identifiant. */
const parNom = (a: CollaborateurDemo, b: CollaborateurDemo): number =>
  a.nom.toLowerCase().localeCompare(b.nom.toLowerCase(), "fr") || a.id.localeCompare(b.id);

/**
 * Écrit, soumet et valide la feuille de la semaine `lundi` de chaque collaborateur qui n'en a
 * pas. `taches` est mis à jour en place (capacité consommée par les feuilles écrites, moteur
 * `appliquerPlanFeuilleDemo`) ; renvoie les centièmes consommés par mission (choix du jalon) et
 * les missions des parties validées (alertes à réévaluer).
 */
export async function genererFeuillesSemaineDemo(
  c: ContexteActiviteDemo,
  lundi: DateISO,
  l: LecturesSemaineDemo,
  taches: Map<string, TacheCapaciteDemo>,
): Promise<{ tempsParMission: Map<string, number>; missionsTouchees: Set<string> }> {
  const tempsParMission = new Map<string, number>();
  const missionsTouchees = new Set<string>();
  let etat: ReadonlyMap<string, TacheCapaciteDemo> = taches;
  const ordre = [...l.collaborateurs].sort(parNom);
  for (const col of ordre.slice(0, PARAMETRES_ACTIVITE_DEMO.collaborateursMax)) {
    const fait = await feuilleDuCollaborateur(c, lundi, l, etat, col);
    if (!fait) continue;
    etat = appliquerPlanFeuilleDemo(etat, col.id, fait.plan);
    for (const x of fait.plan.consommations) {
      tempsParMission.set(x.missionId, (tempsParMission.get(x.missionId) ?? 0) + x.centiemes);
    }
    for (const m of fait.ecrite.missions) missionsTouchees.add(m);
    c.bilan.feuilles += 1;
    c.bilan.lignes += fait.ecrite.lignes;
    c.bilan.redeclarations += fait.ecrite.redeclarations;
  }
  for (const [id, t] of etat) taches.set(id, t);
  return { tempsParMission, missionsTouchees };
}

/** Entrée du moteur pour un collaborateur : seules les affectations des tâches connues comptent. */
function entreeFeuille(
  lundi: DateISO,
  l: LecturesSemaineDemo,
  taches: ReadonlyMap<string, TacheCapaciteDemo>,
  col: CollaborateurDemo,
): EntreeFeuilleDemo {
  return {
    lundi,
    collaborateurId: col.id,
    capacitePct: col.capacitePct,
    calendrier: l.calendrier,
    moisClotures: l.moisClotures,
    absences: l.absences.get(col.id) ?? [],
    affectations: (l.affectations.get(col.id) ?? []).filter((a) => taches.has(a.tacheId)),
    taches,
    activiteInterneId: l.activiteInterneId,
  };
}

/**
 * Une feuille (§2.4, étapes 1 à 4) : plan du moteur, puis écriture ; null sans écriture. Le plan
 * est calculé DANS le point de sauvegarde : une donnée refusée par le moteur (`RangeError`)
 * n'écarte que ce collaborateur, consignée comme un échec de feuille.
 */
async function feuilleDuCollaborateur(
  c: ContexteActiviteDemo,
  lundi: DateISO,
  l: LecturesSemaineDemo,
  taches: ReadonlyMap<string, TacheCapaciteDemo>,
  col: CollaborateurDemo,
): Promise<{ plan: PlanFeuilleDemo; ecrite: FeuilleEcrite } | null> {
  const auteur = collaborateurAuthDemo(c.acteurs, col.utilisateurId);
  if (!auteur) return null;
  if (await feuilleExisteDemo(c.db, col.id, lundi)) return null;
  const reperes = { semaine: lundi, collaborateur_id: col.id };
  return dansPointDeSauvegarde(c, "ad_feuille", "feuille", reperes, async () => {
    const plan = planifierFeuilleDemo(entreeFeuille(lundi, l, taches, col));
    if (plan.lignes.length === 0) return null;
    const ecrite = await ecrireFeuilleDemo(c, lundi, l.parametres, col.id, auteur, plan, taches);
    return ecrite ? { plan, ecrite } : null;
  });
}

/** Création, saisie, soumission, validation, redéclarations et marqueur (point de sauvegarde). */
async function ecrireFeuilleDemo(
  c: ContexteActiviteDemo,
  lundi: DateISO,
  p: ParametresTemps,
  collaborateurId: string,
  auteur: Auth,
  plan: PlanFeuilleDemo,
  taches: ReadonlyMap<string, TacheCapaciteDemo>,
): Promise<FeuilleEcrite | null> {
  const id = await creerFeuilleDemo(c, collaborateurId, auteur, lundi);
  if (!id) return null;
  const lignes = await saisirEtSoumettreDemo(c, id, p, plan);
  const missions = await validerFeuilleDemo(c, id, auteur);
  const redeclarations = await redeclarerDemo(c, lundi, p, collaborateurId, auteur, plan, taches);
  await poserMarqueur(c, ACTIONS_ACTIVITE_DEMO.feuille, "feuille_temps", id, {
    semaine: lundi,
    lignes,
    pour: auteur.utilisateurId,
  });
  return { lignes, redeclarations, missions };
}

/**
 * Feuille en brouillon, miroir de routes/feuilles-temps.ts:212-222 (verrou du collaborateur puis
 * création). `ON CONFLICT DO NOTHING` : une feuille posée entre-temps (visiteur) n'est jamais
 * touchée, la fonction renvoie null.
 */
async function creerFeuilleDemo(
  c: ContexteActiviteDemo,
  collaborateurId: string,
  auteur: Auth,
  lundi: DateISO,
): Promise<string | null> {
  await c.db.query("SELECT 1 FROM collaborateurs WHERE id = $1 FOR UPDATE", [collaborateurId]);
  const r = await c.db.query(
    `INSERT INTO feuilles_temps (cabinet_id, collaborateur_id, auteur_id, semaine)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (cabinet_id, collaborateur_id, semaine) DO NOTHING RETURNING id`,
    [c.cabinetId, collaborateurId, auteur.utilisateurId, lundi],
  );
  return (r.rows[0]?.id as string | undefined) ?? null;
}

/** Ligne du moteur au format d'une saisie (jours au pas du cabinet, moteur `depuisCentiemes`). */
const versSaisie = (l: LigneFeuilleDemo): LigneTempsSaisie[] => {
  const jours = depuisCentiemes(l.centiemes);
  if (l.tacheId) return [{ date: l.date, tache_id: l.tacheId, jours }];
  return l.activiteId ? [{ date: l.date, activite_id: l.activiteId, jours }] : [];
};

/**
 * Saisie puis soumission ; renvoie le nombre de lignes écrites. La saisie passe par
 * `preparerLignes` (affectation, mission ouverte, mois clos, pas, 3 jours par case) et le
 * contrôle de capacité du cabinet ; la soumission est le miroir de
 * routes/feuilles-temps.ts:295-320 (la capacité, contrôlée juste avant sur ces mêmes lignes,
 * n'est pas recalculée).
 */
async function saisirEtSoumettreDemo(
  c: ContexteActiviteDemo,
  id: string,
  p: ParametresTemps,
  plan: PlanFeuilleDemo,
): Promise<number> {
  const f = await lireFeuille(c.db, id, true);
  const lignes = await preparerLignes(c.db, f, plan.lignes.flatMap(versSaisie), p);
  const depassements = await depassementsCapacite(
    c.db,
    c.cabinetId,
    f.collaborateur_id,
    semaineDe(f.semaine),
    lignes,
    p,
  );
  appliquerControleCapacite(depassements, p);
  await insererLignes(c.db, c.cabinetId, id, lignes);
  const stockees = await lignesPourControle(c.db, id);
  if (stockees.length === 0) throw requeteInvalide("Une feuille de temps vide ne se soumet pas.");
  await reverifierTaches(c.db, f, stockees);
  exigerDatesModifiables(
    stockees.map((x) => x.date),
    await moisClotures(c.db),
  );
  const r = await c.db.query(
    `UPDATE feuilles_temps SET statut = 'soumise', cycle = cycle + 1,
       soumise_le = $2::timestamptz,
       premiere_soumission_le = coalesce(premiere_soumission_le, $2::timestamptz),
       modifie_le = $2::timestamptz
     WHERE id = $1 AND statut = 'brouillon'`,
    [id, c.maintenant],
  );
  if (!r.rowCount) throw conflit("Feuille de temps déjà soumise : saisie abandonnée.");
  return lignes.length;
}

/**
 * Validation de toutes les parties, miroir de routes/feuilles-temps.ts:357-379 : chaque partie
 * par un valideur distinct de l'auteur (`valideurPartieDemo`, revérifié par `peutDeciderPartie`),
 * sur le cycle courant, puis feuille validée (0030 : `validee_le` obligatoire, MPT03 contrôlé par
 * le déclencheur). Aucun valideur possible : 409, la feuille entière est annulée par le point de
 * sauvegarde. Renvoie les missions des parties.
 */
async function validerFeuilleDemo(
  c: ContexteActiviteDemo,
  id: string,
  auteur: Auth,
): Promise<string[]> {
  const f = await lireFeuille(c.db, id, true);
  const parties = await partiesDe(c.db, id);
  for (const partie of parties) {
    const v = valideurPartieDemo(c.acteurs, partie, auteur.utilisateurId);
    if (!v || v.utilisateurId === auteur.utilisateurId || !peutDeciderPartie(v, f, partie)) {
      throw conflit("Aucun valideur pour une partie de la feuille.");
    }
    await c.db.query(
      `INSERT INTO feuille_validations
         (cabinet_id, feuille_id, cycle, mission_id, decision, decide_par, decide_le)
       VALUES ($1, $2, $3, $4, 'validee', $5, $6)`,
      [c.cabinetId, id, f.cycle, partie.mission_id, v.utilisateurId, c.maintenant],
    );
  }
  const r = await c.db.query(
    `UPDATE feuilles_temps SET statut = 'validee', validee_le = $2::timestamptz,
       modifie_le = $2::timestamptz
     WHERE id = $1 AND statut = 'soumise'`,
    [id, c.maintenant],
  );
  if (!r.rowCount) throw conflit("Feuille de temps non soumise : validation abandonnée.");
  return parties.flatMap((x) => (x.mission_id ? [x.mission_id] : []));
}

/** Affectation nominative du collaborateur à la tâche, miroir de routes/suivi-temps.ts:53-56. */
async function estAffecte(
  c: ContexteActiviteDemo,
  tacheId: string,
  collaborateurId: string,
): Promise<boolean> {
  const r = await c.db.query(
    "SELECT 1 FROM affectations WHERE tache_id = $1 AND collaborateur_id = $2 LIMIT 1",
    [tacheId, collaborateurId],
  );
  return Boolean(r.rowCount);
}

/**
 * Miroir de routes/suivi-temps.ts:36-37 : mission visible de l'auteur, verrouillée, et non
 * clôturée ; sinon la redéclaration est sautée et la feuille reste. Mémorisé par mission.
 */
async function missionRedeclarable(
  c: ContexteActiviteDemo,
  auteur: Auth,
  missionId: string,
  vues: Map<string, boolean>,
): Promise<boolean> {
  const connue = vues.get(missionId);
  if (connue !== undefined) return connue;
  let ok: boolean;
  try {
    ok = (await exigerMissionVisible(c.db, auteur, missionId, true)).statut !== "cloturee";
  } catch (e) {
    if (!(e instanceof AppError) || e.statut !== 404) throw e;
    ok = false;
  }
  vues.set(missionId, ok);
  return ok;
}

/**
 * Redéclarations « pour soi » du moteur (DT5 : `d − consommé` sur une tâche hors dérive où le
 * collaborateur a déclaré), miroir de routes/suivi-temps.ts:36-82 : mission visible et non
 * clôturée, collaborateur affectable, tâche affectée, pas du cabinet. Une valeur égale à la déclaration en vigueur n'est pas
 * réécrite ; une tâche désaffectée depuis sa déclaration est sautée (la feuille reste).
 * Renvoie le nombre de déclarations écrites.
 */
async function redeclarerDemo(
  c: ContexteActiviteDemo,
  lundi: DateISO,
  p: ParametresTemps,
  collaborateurId: string,
  auteur: Auth,
  plan: PlanFeuilleDemo,
  taches: ReadonlyMap<string, TacheCapaciteDemo>,
): Promise<number> {
  const utiles = plan.redeclarations.filter(
    (r) => taches.get(r.tacheId)?.declarations[collaborateurId] !== r.centiemes,
  );
  if (utiles.length === 0) return 0;
  await collaborateurAffectable(c.db, collaborateurId);
  const missions = new Map<string, boolean>();
  let ecrites = 0;
  for (const r of utiles) {
    if (!(await missionRedeclarable(c, auteur, r.missionId, missions))) continue;
    if (!(await estAffecte(c, r.tacheId, collaborateurId))) continue;
    if (!estPasValide(depuisCentiemes(r.centiemes), p.granularite, p.heuresParJour)) {
      throw requeteInvalide("Reste à faire hors du pas de saisie du cabinet.");
    }
    await c.db.query(
      `INSERT INTO reste_a_faire (cabinet_id, mission_id, tache_id, collaborateur_id, semaine,
         centiemes, declare_par, declare_le)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        c.cabinetId,
        r.missionId,
        r.tacheId,
        collaborateurId,
        lundi,
        r.centiemes,
        auteur.utilisateurId,
        c.maintenant,
      ],
    );
    ecrites += 1;
  }
  return ecrites;
}
