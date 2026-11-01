import {
  ajouterJours,
  ajusterDeriveDemo,
  choisirPorteuseDemo,
  depuisCentiemes,
  estPasValide,
  type DateISO,
  type MissionDeriveDemo,
} from "@missionpilot/engines";
import type { Auth } from "../auth/contexte.js";
import { AppError, conflit, interdit, requeteInvalide } from "../errors.js";
import { exigerMissionVisible, peutModifierMission } from "../missions/acces.js";
import { collaborateurAffectable } from "../planification/outils.js";
import { lireParametresTemps } from "../temps/outils.js";
import { declarantMissionDemo, type ActeursDemo } from "./acteurs.js";
import {
  ACTIONS_ACTIVITE_DEMO,
  dernierMarqueur,
  poserMarqueur,
  type ContexteActiviteDemo,
} from "./commun.js";
import {
  lireSuivisTachesDemo,
  type LecturesSemaineDemo,
  type MissionDemo,
  type SuiviTacheDemo,
} from "./lecture.js";

/*
 * Mission en dérive de la tâche « activite_demo » (DECISIONS « Activité de démonstration
 * automatique », §3, D5, DT6).
 *
 * Une seule mission du cabinet est tenue en dérive, dans la bande ]80 ; 160] ‰ de son budget en
 * jours (cible 120 ‰) : le choix de la mission (`choisirMissionDeriveDemo`, appelé par la tâche
 * avant les feuilles), de la paire porteuse (tâche, collaborateur) et la déclaration à poser
 * (`ajusterDeriveDemo`) sortent du moteur. Ce module ne fait que lire les données, écrire une
 * déclaration de reste à faire (miroir de la route) et poser le marqueur `activite_demo.derive`
 * qui mémorise la mission et la paire : seule cette paire est ensuite ajustée, à la hausse comme
 * à la baisse. Dans la bande, rien n'est écrit (état cible, idempotent).
 *
 * L'appelant ouvre le point de sauvegarde `ad_derive` (§2.3) ; un contrôle refusé est isolable.
 * Aucun montant : des centièmes de jour et des pour mille.
 */

/** Profondeur de lecture du dernier marqueur de dérive, en jours (comme le choix de la mission). */
const MEMOIRE_DERIVE_JOURS = 400;

type AjustementDerive = NonNullable<ReturnType<typeof ajusterDeriveDemo>>;

/** Mission au format du moteur de dérive ; déclarable s'il existe un déclarant (§2.7). */
function missionDeriveDe(
  m: MissionDemo,
  suivis: readonly SuiviTacheDemo[],
  a: ActeursDemo,
): MissionDeriveDemo {
  const declarant = declarantMissionDemo(a, { chef_id: m.chefId, directeur_id: m.directeurId });
  return {
    missionId: m.id,
    taches: suivis.map((s) => ({
      tacheId: s.tacheId,
      budgetCentiemes: s.budgetCentiemes,
      realiseCentiemes: s.realiseCentiemes,
      declarations: s.declarations,
      affectes: s.affectes,
    })),
    declarable: declarant !== null,
  };
}

/** Missions de la semaine au format du moteur (éligibilité décidée par le moteur, §3). */
export function missionsPourDeriveDemo(
  l: LecturesSemaineDemo,
  a: ActeursDemo,
): MissionDeriveDemo[] {
  return l.missions.map((m) => missionDeriveDe(m, l.suivis.get(m.id) ?? [], a));
}

/** Paire (tâche, collaborateur) du dernier marqueur de dérive, s'il porte sur cette mission. */
async function paireMarquee(
  c: ContexteActiviteDemo,
  missionId: string,
): Promise<{ tacheId: string; collaborateurId: string } | null> {
  const marque = await dernierMarqueur(
    c.db,
    ACTIONS_ACTIVITE_DEMO.derive,
    ajouterJours(c.jour, -MEMOIRE_DERIVE_JOURS),
  );
  if (!marque || marque.entiteId !== missionId) return null;
  const { tache_id: tacheId, collaborateur_id: collaborateurId } = marque.details;
  if (typeof tacheId !== "string" || typeof collaborateurId !== "string") return null;
  return { tacheId, collaborateurId };
}

/**
 * Maintient la mission dans la bande de dérive pour la semaine `lundi` (§3) : suivi relu APRÈS
 * les feuilles de la semaine, paire porteuse (marqueur, sinon moteur), déclaration ajustée par le
 * moteur ; rien n'est écrit dans la bande ou sans déclarant.
 */
export async function maintenirDeriveDemo(
  c: ContexteActiviteDemo,
  mission: MissionDemo,
  lundi: DateISO,
): Promise<void> {
  c.bilan.derive = mission.id;
  const declarant = declarantMissionDemo(c.acteurs, {
    chef_id: mission.chefId,
    directeur_id: mission.directeurId,
  });
  if (!declarant) return;
  const suivis = await lireSuivisTachesDemo(c.db, c.cabinetId, [mission.id]);
  const m = missionDeriveDe(mission, suivis.get(mission.id) ?? [], c.acteurs);
  const porteuse = choisirPorteuseDemo(m, await paireMarquee(c, mission.id));
  const ajustement = porteuse ? ajusterDeriveDemo(m, porteuse) : null;
  if (!ajustement) return;
  await declarerDerive(c, mission.id, lundi, declarant, ajustement);
  await poserMarqueur(c, ACTIONS_ACTIVITE_DEMO.derive, "mission", mission.id, {
    semaine: lundi,
    tache_id: ajustement.tacheId,
    collaborateur_id: ajustement.collaborateurId,
    avant_pour_mille: ajustement.avantPourMille,
    apres_pour_mille: ajustement.apresPourMille,
    declaration: ajustement.centiemes,
  });
}

/**
 * Déclaration de reste à faire pour le collaborateur porteur, par le déclarant (chef, directeur
 * ou associé qui modifie la mission), miroir de routes/suivi-temps.ts:36-82 : mission visible et
 * verrouillée, non clôturée, droit de déclarer pour autrui, tâche de la mission, collaborateur
 * affectable et affecté, pas du cabinet ; ajout seul (0030), la plus récente fait foi.
 */
async function declarerDerive(
  c: ContexteActiviteDemo,
  missionId: string,
  lundi: DateISO,
  declarant: Auth,
  a: AjustementDerive,
): Promise<void> {
  const mission = await exigerMissionVisible(c.db, declarant, missionId, true);
  if (mission.statut === "cloturee") throw conflit("La mission est clôturée.");
  if (!peutModifierMission(declarant, mission)) throw interdit();
  const p = await lireParametresTemps(c.db, c.cabinetId);
  const t = await c.db.query("SELECT 1 FROM mission_taches WHERE id = $1 AND mission_id = $2", [
    a.tacheId,
    missionId,
  ]);
  if (!t.rowCount) throw requeteInvalide("Tâche porteuse inconnue dans cette mission.");
  await collaborateurAffectable(c.db, a.collaborateurId);
  const affectee = await c.db.query(
    "SELECT 1 FROM affectations WHERE tache_id = $1 AND collaborateur_id = $2 LIMIT 1",
    [a.tacheId, a.collaborateurId],
  );
  if (!affectee.rowCount) {
    throw new AppError(
      400,
      "TACHE_NON_AFFECTEE",
      "La tâche porteuse de la dérive n'est pas affectée à ce collaborateur.",
    );
  }
  if (!estPasValide(depuisCentiemes(a.centiemes), p.granularite, p.heuresParJour)) {
    throw requeteInvalide("Reste à faire hors du pas de saisie du cabinet.");
  }
  await c.db.query(
    `INSERT INTO reste_a_faire (cabinet_id, mission_id, tache_id, collaborateur_id, semaine,
       centiemes, declare_par, declare_le)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      c.cabinetId,
      missionId,
      a.tacheId,
      a.collaborateurId,
      lundi,
      a.centiemes,
      declarant.utilisateurId,
      c.maintenant,
    ],
  );
}
