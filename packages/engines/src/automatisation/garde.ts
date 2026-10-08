import { estNiveauAutonomie, rangNiveauAutonomie } from "../autonomie/niveaux";
import { estClasseRisque } from "../qualite/classes";
import { ErreurAutomatisation } from "./erreurs";
import {
  REFUS_GARDE_AUTOMATISATION,
  type ContexteGarde,
  type DecisionGarde,
  type MetaAction,
  type RefusGardeAutomatisation,
} from "./types";

/*
 * GARDE D'UNE ACTION D'AUTOMATISATION (AUT-05, DECISIONS.md du 2026-10-08) — fonction pure.
 *
 * Une action ne part que si TOUT est vrai :
 * - aucun coupe-circuit : celui du cabinet (toutes les automatisations), celui de
 *   l'automatisation (AUT-06) ;
 * - vers le client : classe R0 SEULEMENT (N4 limité à R0) ; un contenu R2 ou R3 n'est
 *   JAMAIS envoyé au client par une automatisation (il exige une validation humaine) ; le
 *   coupe-circuit N4 du cabinet (agents IA) bloque aussi tout envoi automatique au client ;
 * - appel d'un agent : le niveau d'autonomie EFFECTIF de sa brique atteint le niveau requis ;
 * - l'exécutant (compte d'automatisation ou déclencheur) détient la permission de l'action et
 *   voit la mission de l'événement.
 * Les refus sont tous listés (ordre stable), pas seulement le premier.
 */

function verifier(meta: MetaAction): void {
  if (!estClasseRisque(meta.classeRisque)) {
    throw new ErreurAutomatisation("ENTREE_INVALIDE", "Classe de risque inconnue (R0 à R3).");
  }
  const requis = meta.niveauAgentRequis;
  if (requis !== undefined && requis !== null && !estNiveauAutonomie(requis)) {
    throw new ErreurAutomatisation("ENTREE_INVALIDE", "Niveau d'autonomie requis inconnu.");
  }
}

export function garderActionAutomatisation(
  meta: MetaAction,
  contexte: ContexteGarde,
): DecisionGarde {
  verifier(meta);
  const refus = new Set<RefusGardeAutomatisation>();
  if (contexte.coupeCircuitCabinet) refus.add("COUPE_CIRCUIT_CABINET");
  if (contexte.coupeCircuitAutomatisation) refus.add("COUPE_CIRCUIT_AUTOMATISATION");
  if (meta.versClient) {
    if (contexte.coupeCircuitN4) refus.add("COUPE_CIRCUIT_N4");
    if (meta.classeRisque === "R2" || meta.classeRisque === "R3") {
      refus.add("CONTENU_R2_R3_VERS_CLIENT");
    }
    if (meta.classeRisque !== "R0") refus.add("N4_RESERVE_R0");
  }
  const requis = meta.niveauAgentRequis ?? null;
  if (requis !== null) {
    const effectif = contexte.niveauAgentEffectif ?? null;
    if (
      effectif === null ||
      !estNiveauAutonomie(effectif) ||
      rangNiveauAutonomie(effectif) < rangNiveauAutonomie(requis)
    ) {
      refus.add("NIVEAU_AGENT_INSUFFISANT");
    }
  }
  if (!contexte.droitsSuffisants) refus.add("DROITS_INSUFFISANTS");
  if (!contexte.missionVisible) refus.add("MISSION_INVISIBLE");
  const liste = REFUS_GARDE_AUTOMATISATION.filter((r) => refus.has(r));
  return { autorisee: liste.length === 0, refus: liste };
}
