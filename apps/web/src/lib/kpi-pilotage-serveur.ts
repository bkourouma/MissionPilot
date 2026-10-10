import type { Role } from "@missionpilot/shared";
import { chargerServeur } from "./api-serveur";
import {
  candidatsProprietaire,
  cheminKpiMission,
  type DefinitionKpi,
  type OptionPersonne,
} from "./kpi";
import {
  cheminRevue,
  cheminRevues,
  optionsDecisions,
  type DetailRevue,
  type OptionDecision,
  type PageRevues,
} from "./kpi-pilotage";
import type { MissionDetaillee } from "./missions";
import { chargerPersonnes } from "./referentiels-serveur";

/**
 * Listes de choix communes aux écrans du pilotage augmenté (arbres, actions, revues), chargées
 * côté serveur : KPI de la mission et personnes proposées comme responsable ou animateur
 * (directeur, chef et équipe ; l'API revérifie qu'elles sont actives et lisent les KPI).
 * À n'importer que côté serveur (dépend de `next/headers`).
 */
export interface OptionKpiPilotage {
  valeur: string;
  libelle: string;
  /** Unité du KPI (« jours », « % »…) : une somme ne s'applique qu'à des unités identiques. */
  unite: string;
}

export interface OptionsPilotage {
  kpis: OptionKpiPilotage[];
  /** KPI actifs seulement (une mesure, donc un levier ou une action, exige un KPI actif). */
  kpisActifs: OptionKpiPilotage[];
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
        unite: d.unite,
        actif: d.actif,
      }))
    : [];
  return {
    kpis: kpis.map(({ valeur, libelle, unite }) => ({ valeur, libelle, unite })),
    kpisActifs: kpis
      .filter((k) => k.actif)
      .map(({ valeur, libelle, unite }) => ({ valeur, libelle, unite })),
    personnes: candidatsProprietaire(mission, noms),
    erreurKpis: definitions.ok ? null : definitions.message,
  };
}

/** Nombre de revues tenues dont les décisions sont proposées (les plus récentes) : au plus ce nombre d'appels. */
const REVUES_TENUES_PROPOSEES = 10;

/**
 * Décisions que l'on peut rattacher à une action corrective : celles des revues TENUES de la
 * mission (les plus récentes), plus celles de `revueSupplementaire` (revue d'où l'on vient), même si
 * elle n'est plus tenue : l'API répond alors par son refus en français, au lieu que la décision
 * disparaisse silencieusement. Une revue illisible est ignorée ; `erreur` le dit.
 */
export async function chargerDecisionsPourAction(
  missionId: string,
  revueSupplementaire?: string,
): Promise<{ decisions: OptionDecision[]; erreur: string | null }> {
  const liste = await chargerServeur<PageRevues>(
    cheminRevues(missionId, `statut=tenue&limite=${REVUES_TENUES_PROPOSEES}`),
  );
  const ids = new Set<string>(liste.ok ? liste.donnees.elements.map((r) => r.id) : []);
  if (revueSupplementaire) ids.add(revueSupplementaire);
  const details = await Promise.all(
    [...ids].map((id) => chargerServeur<DetailRevue>(cheminRevue(id))),
  );
  const lisibles = details.flatMap((d) =>
    d.ok && d.donnees.mission_id === missionId ? [d.donnees] : [],
  );
  lisibles.sort((a, b) => b.numero - a.numero);
  const incomplet = !liste.ok || details.some((d) => !d.ok);
  return {
    decisions: optionsDecisions(lisibles),
    erreur: incomplet ? "Certaines décisions de revue n'ont pas pu être chargées." : null,
  };
}
