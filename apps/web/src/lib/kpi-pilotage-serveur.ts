import type { Role } from "@missionpilot/shared";
import { chargerServeur } from "./api-serveur";
import {
  candidatsProprietaire,
  cheminKpiMission,
  type DefinitionKpi,
  type OptionPersonne,
} from "./kpi";
import type { MissionDetaillee } from "./missions";
import { chargerPersonnes } from "./referentiels-serveur";

/**
 * Listes de choix communes aux écrans du pilotage augmenté (arbres, actions, revues), chargées
 * côté serveur : KPI de la mission et personnes proposées comme responsable ou animateur
 * (directeur, chef et équipe ; l'API revérifie qu'elles sont actives et lisent les KPI).
 * À n'importer que côté serveur (dépend de `next/headers`).
 */
export interface OptionsPilotage {
  kpis: { valeur: string; libelle: string }[];
  /** KPI actifs seulement (une mesure, donc un levier ou une action, exige un KPI actif). */
  kpisActifs: { valeur: string; libelle: string }[];
  personnes: OptionPersonne[];
  erreurKpis: string | null;
}

export async function chargerOptionsPilotage(
  roles: readonly Role[],
  mission: Pick<MissionDetaillee, "directeur_id" | "chef_id" | "equipe">,
  missionId: string,
): Promise<OptionsPilotage> {
  const [definitions, personnes] = await Promise.all([
    chargerServeur<{ elements: DefinitionKpi[] }>(cheminKpiMission(missionId)),
    chargerPersonnes(roles),
  ]);
  const noms = new Map(personnes.map((p) => [p.utilisateur_id, p.nom]));
  for (const e of mission.equipe) noms.set(e.utilisateur_id, e.nom);
  const kpis = definitions.ok
    ? definitions.donnees.elements.map((d) => ({
        valeur: d.id,
        libelle: d.libelle,
        actif: d.actif,
      }))
    : [];
  return {
    kpis: kpis.map(({ valeur, libelle }) => ({ valeur, libelle })),
    kpisActifs: kpis.filter((k) => k.actif).map(({ valeur, libelle }) => ({ valeur, libelle })),
    personnes: candidatsProprietaire(mission, noms),
    erreurKpis: definitions.ok ? null : definitions.message,
  };
}
