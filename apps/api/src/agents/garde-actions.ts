import {
  OUTILS_AGENT_MODIFIANTS,
  type NiveauAutonomie,
  type OutilAgent,
} from "@missionpilot/shared";

/*
 * GARDE DES ACTIONS D'AGENT (AGT-07, AUT-05, ADR-005) — fonction pure.
 *
 * Principe : une SORTIE d'agent est une donnée proposée à un humain ; elle ne
 * déclenche JAMAIS une action par elle-même, quel que soit son contenu (un
 * document client peut avoir dicté ce contenu). Une action ne part que :
 * - d'un HUMAIN qui la confirme (dans ses droits, vérifiés par la route), ou
 * - d'un ÉVÉNEMENT métier (automatisation, vague 2) sur une brique dont le
 *   niveau effectif l'autorise : N3 pour une action interne, N4 (classe R0
 *   seulement, coupe-circuit levé : déjà pris en compte par le niveau effectif)
 *   pour une action vers le client.
 * Dans tous les cas, l'outil doit figurer dans la liste fermée de l'agent.
 */

export type DeclencheurAction =
  | { type: "humain"; confirme: boolean }
  | { type: "evenement" }
  /** Contenu produit par un agent (éventuellement inspiré d'un contenu client). */
  | { type: "sortie_agent" };

export type RefusAction =
  "OUTIL_NON_AUTORISE" | "ACTION_DEPUIS_SORTIE" | "CONFIRMATION_REQUISE" | "NIVEAU_INSUFFISANT";

export interface DecisionAction {
  autorisee: boolean;
  refus: RefusAction[];
}

const RANG: Record<NiveauAutonomie, number> = { N0: 0, N1: 1, N2: 2, N3: 3, N4: 4 };

/** Dit si un agent peut appeler `outil` dans ces conditions (aucun effet de bord). */
export function autoriserActionAgent(entree: {
  outilsAutorises: readonly string[];
  outil: OutilAgent;
  niveauEffectif: NiveauAutonomie;
  declencheur: DeclencheurAction;
}): DecisionAction {
  const refus: RefusAction[] = [];
  const { outil, declencheur, niveauEffectif } = entree;
  if (!entree.outilsAutorises.includes(outil)) refus.push("OUTIL_NON_AUTORISE");
  const modifiant = OUTILS_AGENT_MODIFIANTS.includes(outil);
  // Une sortie n'appelle AUCUN outil, pas même de lecture : elle ne pilote rien.
  if (declencheur.type === "sortie_agent") refus.push("ACTION_DEPUIS_SORTIE");
  if (declencheur.type === "humain" && modifiant && !declencheur.confirme) {
    refus.push("CONFIRMATION_REQUISE");
  }
  if (declencheur.type === "evenement" && modifiant && RANG[niveauEffectif] < RANG.N4) {
    refus.push("NIVEAU_INSUFFISANT");
  }
  if (declencheur.type === "evenement" && !modifiant && RANG[niveauEffectif] < RANG.N3) {
    refus.push("NIVEAU_INSUFFISANT");
  }
  return { autorisee: refus.length === 0, refus };
}
