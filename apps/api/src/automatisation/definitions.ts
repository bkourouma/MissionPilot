import {
  validerConditionAutomatisation,
  variablesInconnues,
  type ChampsEvenement,
  type ConditionAutomatisation,
  type MetaAction,
} from "@missionpilot/engines";
import {
  CATALOGUE_EVENEMENTS,
  REGISTRE_ACTIONS_AUTOMATISATION,
  type ActionAutomatisationApi,
  type ClasseRisque,
  type CodeEvenementAutomatisation,
  type DefinitionAutomatisationApi,
} from "@missionpilot/shared";

/*
 * Contrôles croisés d'une définition (AUT-02), au-delà du schéma partagé : condition typée sur
 * les champs DÉCLARÉS de l'événement (moteur), gabarits qui ne citent que ces champs, champs
 * exigés par chaque action, identité d'exécution compatible avec l'origine de l'événement.
 * Les agents et briques cités se vérifient en base (`regles.ts`).
 */

export interface ErreurDefinition {
  chemin: string;
  code: string;
  message: string;
}

/** Champs typés de l'événement, sous la forme du moteur. */
export function champsMoteur(code: CodeEvenementAutomatisation): ChampsEvenement {
  const champs = CATALOGUE_EVENEMENTS[code].champs as Record<
    string,
    { type: ChampsEvenement[string]["type"]; requis: boolean }
  >;
  return Object.fromEntries(
    Object.entries(champs).map(([nom, c]) => [nom, { type: c.type, requis: c.requis }]),
  );
}

/** Textes à gabarit d'une action (chemin relatif → texte). */
function gabaritsDe(action: ActionAutomatisationApi): [string, string][] {
  switch (action.type) {
    case "creer_tache":
      return [
        ["titre", action.titre],
        ["description", action.description],
      ];
    case "notifier":
      return [
        ["titre", action.titre],
        ["corps", action.corps],
      ];
    case "brouillon":
      return [
        ["titre", action.titre],
        ["corps", action.corps],
      ];
    case "appeler_agent":
      return Object.entries(action.variables).map(([nom, v]) => [`variables.${nom}`, v]);
    default:
      return [];
  }
}

export function validerDefinition(d: DefinitionAutomatisationApi): ErreurDefinition[] {
  const evenement = CATALOGUE_EVENEMENTS[d.evenement_code];
  const champs = champsMoteur(d.evenement_code);
  const erreurs: ErreurDefinition[] = validerConditionAutomatisation(
    d.condition as ConditionAutomatisation | null,
    champs,
  ).map((e) => ({
    chemin: e.chemin === "" ? "condition" : `condition.${e.chemin}`,
    code: e.code,
    message: e.message,
  }));
  if (d.mode_execution === "declencheur" && evenement.source !== "module") {
    erreurs.push({
      chemin: "mode_execution",
      code: "DECLENCHEUR_ABSENT",
      message:
        "Cet événement n'a pas de personne à son origine : exécutez-le avec le compte d'automatisation.",
    });
  }
  d.actions.forEach((action, i) => {
    for (const champ of REGISTRE_ACTIONS_AUTOMATISATION[action.type].champs_requis) {
      if (!Object.prototype.hasOwnProperty.call(champs, champ)) {
        erreurs.push({
          chemin: `actions.${i}.type`,
          code: "ACTION_INCOMPATIBLE",
          message: `L'action exige le champ « ${champ} », absent de cet événement.`,
        });
      }
    }
    for (const [chemin, texte] of gabaritsDe(action)) {
      for (const v of variablesInconnues(texte, champs)) {
        erreurs.push({
          chemin: `actions.${i}.${chemin}`,
          code: "VARIABLE_INCONNUE",
          message: `Le gabarit cite « {{${v}}} », champ inconnu de cet événement.`,
        });
      }
    }
  });
  return erreurs;
}

/** Classe de risque effective d'une action (brique de l'agent, sinon R1 pour un agent). */
export function classeAction(
  action: Pick<ActionAutomatisationApi, "type">,
  classeBrique: ClasseRisque | null = null,
): ClasseRisque {
  return REGISTRE_ACTIONS_AUTOMATISATION[action.type].classe_risque ?? classeBrique ?? "R1";
}

/** Ce que la garde du moteur sait de l'action. */
export function metaAction(
  action: Pick<ActionAutomatisationApi, "type">,
  classeBrique: ClasseRisque | null = null,
): MetaAction {
  const m = REGISTRE_ACTIONS_AUTOMATISATION[action.type];
  return {
    classeRisque: classeAction(action, classeBrique),
    versClient: m.vers_client,
    niveauAgentRequis: m.niveau_agent_requis,
  };
}
