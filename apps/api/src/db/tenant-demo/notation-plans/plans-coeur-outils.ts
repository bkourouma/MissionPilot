import type { StatutInitiative } from "@missionpilot/shared";
import type { CleCompte } from "../cles.js";
import type { Auteur, Etape, Ids, SpecElement, Valideur } from "./plans-coeur-types.js";

/*
 * Constructeurs de spécifications d'éléments de plan : ils fixent le parcours de versions
 * (création, enrichissement, validation, puis évolution du statut revalidée) pour que les
 * fichiers de données restent courts. Les utilisateurs se désignent par `u:<clé de compte>` dans
 * la table d'identifiants du moteur.
 */

export const utilisateur = (ids: Ids, cle: CleCompte): string => ids.get(`u:${cle}`) as string;

const validation = (par: Valideur = "directeur"): Etape => ({ valider: par });

export function vision(
  vision: string,
  mission: string,
  valeurs: string[],
  o: { porteur?: CleCompte; auteur?: Auteur } = {},
): SpecElement {
  return {
    cle: "vision",
    type: "vision_mission",
    creation: { vision, mission, valeurs },
    etapes: [validation()],
    ...o,
  };
}

export function axe(
  cle: string,
  titre: string,
  description: string,
  porteur: CleCompte,
  valide = true,
): SpecElement {
  return {
    cle,
    type: "axe",
    titre,
    creation: { titre, description },
    etapes: valide ? [validation()] : [],
    porteur,
  };
}

export interface OptionsObjectif {
  perspective: "finances" | "clients" | "processus" | "apprentissage";
  indicateur: string;
  cible: string;
  echeance: string;
  description: string;
  porteur: CleCompte;
  kpi?: string[];
  /** Cible révisée après un premier cadrage (version supplémentaire). */
  cibleRevisee?: string;
  valide?: boolean;
}

export function objectif(
  cle: string,
  parent: string,
  titre: string,
  o: OptionsObjectif,
): SpecElement {
  const etapes: Etape[] = [];
  if (o.cibleRevisee) etapes.push({ maj: { cible: o.cibleRevisee } });
  if (o.valide !== false) etapes.push(validation());
  return {
    cle,
    type: "objectif",
    titre,
    parent,
    creation: {
      titre,
      description: o.description,
      perspective: o.perspective,
      indicateur: o.indicateur,
      cible: o.cible,
      echeance: o.echeance,
    },
    etapes,
    porteur: o.porteur,
    ...(o.kpi ? { kpiExistants: o.kpi } : {}),
  };
}

export interface OptionsInitiative {
  parent: string;
  description: string;
  debut: string;
  echeance: string;
  budget: number;
  /** Gains nets annuels (exactement l'horizon du plan). */
  gains: number[];
  /** Statut atteint à la date du jeu de données (a_lancer : aucune évolution). */
  statut: StatutInitiative;
  responsable: CleCompte;
  dependances?: string[];
  /** Création par la bibliothèque d'initiatives types. */
  bibliotheque?: { code: string; budget?: number; echeance?: string };
  /** Contenu précisé après la validation (nouvelle version « modifiée » à revalider). */
  precisionApresValidation?: string;
  /** Laisse l'initiative en brouillon (plan en cours de rédaction). */
  brouillon?: boolean;
  /** Valideur (défaut : directeur de la mission). */
  valideur?: Valideur;
}

export function initiative(cle: string, titre: string, o: OptionsInitiative): SpecElement {
  const resp = (ids: Ids) => utilisateur(ids, o.responsable);
  const deps = (ids: Ids) => (o.dependances ?? []).map((d) => ids.get(d) as string);
  const enrichissement = (ids: Ids) => ({
    responsable_id: resp(ids),
    gains_annuels: o.gains,
    ...(o.dependances?.length ? { dependances: deps(ids) } : {}),
  });
  const etapes: Etape[] = [{ maj: enrichissement }];
  if (!o.brouillon) {
    etapes.push(validation(o.valideur));
    if (o.statut !== "a_lancer") {
      etapes.push({ maj: { statut: o.statut } }, validation(o.valideur));
    }
    if (o.precisionApresValidation) {
      etapes.push(
        { maj: { description: `${o.description} ${o.precisionApresValidation}` } },
        validation(o.valideur),
      );
    }
  }
  const base = {
    cle,
    type: "initiative" as const,
    titre,
    parent: o.parent,
    etapes,
  };
  if (o.bibliotheque) {
    return {
      ...base,
      creation: {},
      bibliotheque: {
        code: o.bibliotheque.code,
        debut: o.debut,
        ...(o.bibliotheque.echeance ? { echeance: o.bibliotheque.echeance } : {}),
        ...(o.bibliotheque.budget !== undefined ? { budget: o.bibliotheque.budget } : {}),
      },
    };
  }
  return {
    ...base,
    creation: {
      titre,
      description: o.description,
      debut: o.debut,
      echeance: o.echeance,
      budget: o.budget,
      statut: "a_lancer",
    },
  };
}
