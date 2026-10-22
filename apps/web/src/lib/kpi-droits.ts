/**
 * Droits d'affichage (l'API décide) et choix des personnes d'un KPI. Voir `kpi.ts`, point
 * d'entrée du module.
 */
import { aPermission, ROLE_LIBELLES, type Role } from "@missionpilot/shared";
import type { ContributeurKpi, DefinitionKpi } from "./kpi-types";
import type { MissionDetaillee } from "./missions";

// --- Droits (confort d'affichage : l'API décide) -----------------------------------------------

export interface DroitsKpi {
  /** Créer, modifier, cibles, contributeurs, désactiver ; annuler une mesure du portail. */
  gerer: boolean;
  /** Saisir, corriger, annuler une mesure côté cabinet. */
  saisir: boolean;
  /** Modifier les réglages du cabinet (rappels, délai de grâce, dégradation). */
  parametres: boolean;
}

type MissionDroits = Pick<MissionDetaillee, "statut" | "directeur_id" | "chef_id" | "equipe">;

/**
 * Miroir de `apps/api/src/kpi/acces.ts` : gérer exige `kpi.gerer` et une mission modifiable
 * (directeur, chef ou « modifier toutes les missions ») non clôturée ; saisir exige
 * `kpi.saisir`, une mission non clôturée, un KPI actif, et d'être responsable, membre de
 * l'équipe ou propriétaire du KPI (lire toutes les missions ne suffit pas).
 */
export function droitsKpi(
  roles: readonly Role[],
  utilisateurId: string,
  mission: MissionDroits,
  def?: Pick<DefinitionKpi, "proprietaire_id" | "actif">,
): DroitsKpi {
  const a = (p: Parameters<typeof aPermission>[1]) => aPermission(roles, p);
  const ouverte = mission.statut !== "cloturee";
  const responsable =
    a("mission.modifier_toutes") ||
    (mission.directeur_id !== null && mission.directeur_id === utilisateurId) ||
    (mission.chef_id !== null && mission.chef_id === utilisateurId);
  const equipe = mission.equipe.some((e) => e.utilisateur_id === utilisateurId);
  const proprietaire = def?.proprietaire_id != null && def.proprietaire_id === utilisateurId;
  return {
    gerer: a("kpi.gerer") && responsable && ouverte,
    saisir:
      a("kpi.saisir") && ouverte && (def?.actif ?? true) && (responsable || equipe || proprietaire),
    parametres: a("cabinet.gerer"),
  };
}

/** Raison affichée quand la saisie n'est pas proposée. */
export function raisonSansSaisie(
  mission: Pick<MissionDetaillee, "statut">,
  def: Pick<DefinitionKpi, "actif">,
  roles: readonly Role[],
): string {
  if (mission.statut === "cloturee") return "La mission est clôturée : les mesures sont figées.";
  if (!def.actif) return "Ce KPI est désactivé : réactivez-le pour saisir de nouvelles mesures.";
  if (!aPermission(roles, "kpi.saisir")) {
    return "Votre rôle permet de consulter les KPI, pas d'en saisir les mesures.";
  }
  return "La saisie est réservée au directeur, au chef de mission, aux membres de l'équipe et au propriétaire du KPI.";
}

// --- Personnes : propriétaire et contributeurs ------------------------------------------------

export interface OptionPersonne {
  valeur: string;
  libelle: string;
}

/**
 * Propriétaires proposés : directeur, chef et membres de l'équipe de la mission (règle 5 de
 * l'API, qui vérifie en plus que la personne est active et lit les KPI). `noms` complète les
 * noms connus (référentiel des collaborateurs).
 */
export function candidatsProprietaire(
  mission: Pick<MissionDetaillee, "directeur_id" | "chef_id" | "equipe">,
  noms: ReadonlyMap<string, string>,
): OptionPersonne[] {
  const options: OptionPersonne[] = [];
  const vus = new Set<string>();
  const ajouter = (id: string | null, nom: string | undefined, role: string) => {
    if (!id || vus.has(id)) return;
    vus.add(id);
    options.push({ valeur: id, libelle: `${nom ?? noms.get(id) ?? "Collaborateur"} (${role})` });
  };
  ajouter(mission.directeur_id, undefined, "directeur de mission");
  ajouter(mission.chef_id, undefined, "chef de mission");
  for (const e of [...mission.equipe].sort((x, y) => x.nom.localeCompare(y.nom, "fr"))) {
    ajouter(e.utilisateur_id, e.nom, "équipe");
  }
  return options;
}

/** Nom du propriétaire d'un KPI, ou « Aucun propriétaire ». */
export function nomProprietaire(
  id: string | null,
  options: readonly OptionPersonne[],
  noms: ReadonlyMap<string, string>,
): string {
  if (!id) return "Aucun propriétaire désigné";
  return (
    options.find((o) => o.valeur === id)?.libelle ??
    noms.get(id) ??
    "Collaborateur hors de l'équipe actuelle"
  );
}

/** Compte du portail d'un client (`GET /api/portail/utilisateurs?client_id=`). */
export interface ComptePortailKpi {
  id: string;
  nom: string;
  email: string;
  roles: string[];
  statut: string;
}

export interface CandidatContributeur {
  id: string;
  nom: string;
  email: string;
  role: string;
  desactive: boolean;
}

const ROLES_CONTRIBUTEURS = ["client_dirigeant", "client_contributeur"] as const;

/**
 * Contributeurs possibles : dirigeants et contributeurs du portail du client de la mission
 * (jamais l'investisseur), plus les contributeurs déjà désignés (pour pouvoir les retirer).
 */
export function candidatsContributeurs(
  comptes: readonly ComptePortailKpi[],
  actuels: readonly ContributeurKpi[],
): CandidatContributeur[] {
  const liste = new Map<string, CandidatContributeur>();
  for (const c of comptes) {
    const role = ROLES_CONTRIBUTEURS.find((r) => c.roles.includes(r));
    if (!role) continue;
    liste.set(c.id, {
      id: c.id,
      nom: c.nom,
      email: c.email,
      role: ROLE_LIBELLES[role],
      desactive: c.statut !== "actif",
    });
  }
  for (const a of actuels) {
    if (!liste.has(a.id)) {
      liste.set(a.id, {
        id: a.id,
        nom: a.nom,
        email: a.email,
        role: "Contributeur",
        desactive: false,
      });
    }
  }
  return [...liste.values()].sort((x, y) => x.nom.localeCompare(y.nom, "fr"));
}
