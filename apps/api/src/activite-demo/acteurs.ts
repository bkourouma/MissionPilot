import type { RoleApprobateur } from "@missionpilot/engines";
import { aPermission, ROLES_CLIENT, type Permission } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { estAssocie } from "../missions/acces.js";
import { satisfaitRole } from "../missions/budget.js";
import { valideInterne } from "../temps/outils.js";

/*
 * Acteurs de l'activité de démonstration (job « activite_demo ») : au nom de QUI chaque
 * écriture est faite. Le job n'agit jamais sous l'identité d'un humain connecté ; il choisit,
 * parmi les utilisateurs ACTIFS du cabinet (jamais un compte du portail client), celui que la
 * route correspondante accepterait, avec les MÊMES règles de droits et de séparation des tâches
 * (miroir des routes citées ; `aPermission`, `satisfaitRole`, `valideInterne`).
 *
 * - Feuille, lignes, soumission, redéclaration : l'utilisateur du collaborateur (`temps.saisir`).
 * - Partie mission d'une feuille : chef ≠ auteur, sinon directeur ≠ auteur, sinon associé ≠ auteur
 *   (`temps.valider`, temps/feuilles.ts `peutDeciderPartie`) ; partie interne : associé ≠ auteur,
 *   sinon un validateur qui voit tout le cabinet (temps/outils.ts `valideInterne`).
 * - Déclaration de dérive : chef, sinon directeur, sinon associé (`mission.modifier_toutes`).
 * - Jalon : chef, sinon directeur (`mission.planifier`).
 * - Facture, régie, encaissement : gestionnaire, sinon associé ; approbation : directeur de la
 *   mission qui satisfait le rôle exigé, sinon associé, jamais créateur, soumetteur ni
 *   modificateur (routes/factures.ts, plus strict que la route : l'associé n'est pas dispensé).
 * - Avenant : chef, sinon directeur ; validation de la révision : directeur ≠ auteur qui satisfait
 *   le rôle exigé, sinon associé ≠ auteur (routes/budget.ts).
 *
 * Toutes les fonctions sont pures, sauf la lecture. L'ordre de `tous` (nom puis identifiant) rend
 * le choix déterministe ; aucune fonction ne renvoie l'auteur de ce qu'il faut valider.
 */

/** Utilisateurs lus au plus (cabinets de démonstration : quelques dizaines de comptes). */
export const ACTEURS_LUS_MAX = 200;

export interface ActeursDemo {
  tous: readonly Auth[];
  parId: ReadonlyMap<string, Auth>;
}

/** Utilisateurs actifs du cabinet, hors portail client, par nom puis identifiant. */
export async function lireActeursDemo(db: Db, cabinetId: string): Promise<ActeursDemo> {
  const r = await db.query(
    `SELECT id, email, nom, roles FROM utilisateurs
     WHERE cabinet_id = $1 AND actif AND NOT (roles && $2::text[])
     ORDER BY lower(nom), id
     LIMIT $3`,
    [cabinetId, [...ROLES_CLIENT], ACTEURS_LUS_MAX],
  );
  const tous: Auth[] = r.rows.map((u) => ({
    utilisateurId: u.id as string,
    cabinetId,
    email: u.email as string,
    nom: u.nom as string,
    roles: u.roles as Auth["roles"],
  }));
  return { tous, parId: new Map(tous.map((u) => [u.utilisateurId, u])) };
}

const aTout = (u: Auth, permissions: readonly Permission[]) =>
  permissions.every((p) => aPermission(u.roles, p));

/** Utilisateur actif désigné (chef, directeur…) qui détient toutes ces permissions, ou null. */
function designe(
  a: ActeursDemo,
  id: string | null,
  permissions: readonly Permission[],
): Auth | null {
  if (!id) return null;
  const u = a.parId.get(id);
  return u && aTout(u, permissions) ? u : null;
}

/** Premier utilisateur (ordre de `tous`) qui satisfait la condition, ou null. */
const premier = (a: ActeursDemo, accepte: (u: Auth) => boolean): Auth | null =>
  a.tous.find(accepte) ?? null;

/** L'utilisateur désigné s'il n'est pas `auteurId`. */
const sauf = (u: Auth | null, auteurId: string): Auth | null =>
  u && u.utilisateurId !== auteurId ? u : null;

const associeAvec = (u: Auth, permissions: readonly Permission[]) =>
  estAssocie(u) && aTout(u, permissions);

/** Décide les activités internes (temps/feuilles.ts `peutDeciderPartie`, partie interne). */
const valideurInterne = (u: Auth) => aPermission(u.roles, "temps.valider") && valideInterne(u);

/** Auteur d'une feuille : l'utilisateur actif rattaché au collaborateur (`temps.saisir`). */
export function collaborateurAuthDemo(a: ActeursDemo, utilisateurId: string | null): Auth | null {
  return designe(a, utilisateurId, ["temps.saisir"]);
}

/** Valideur d'une partie de feuille (mission ou activités internes), jamais l'auteur. */
export function valideurPartieDemo(
  a: ActeursDemo,
  p: { mission_id: string | null; chef_id: string | null; directeur_id: string | null },
  auteurId: string,
): Auth | null {
  const associe = () =>
    premier(a, (u) => u.utilisateurId !== auteurId && associeAvec(u, ["temps.valider"]));
  if (p.mission_id === null) {
    // Activités internes : associé, sinon validateur qui voit tout le cabinet (valideInterne).
    return associe() ?? premier(a, (u) => u.utilisateurId !== auteurId && valideurInterne(u));
  }
  return (
    sauf(designe(a, p.chef_id, ["temps.valider"]), auteurId) ??
    sauf(designe(a, p.directeur_id, ["temps.valider"]), auteurId) ??
    associe()
  );
}

/** Déclarant du reste à faire pour un autre collaborateur (miroir de routes/suivi-temps.ts:36-66). */
export function declarantMissionDemo(
  a: ActeursDemo,
  m: { chef_id: string | null; directeur_id: string | null },
): Auth | null {
  return (
    designe(a, m.chef_id, ["temps.saisir"]) ??
    designe(a, m.directeur_id, ["temps.saisir"]) ??
    premier(a, (u) => associeAvec(u, ["temps.saisir", "mission.modifier_toutes"]))
  );
}

/** Auteur du jalon de la semaine : chef, sinon directeur (`mission.planifier`). */
export function auteurJalonDemo(
  a: ActeursDemo,
  m: { chef_id: string | null; directeur_id: string | null },
): Auth | null {
  return (
    designe(a, m.chef_id, ["mission.planifier"]) ??
    designe(a, m.directeur_id, ["mission.planifier"])
  );
}

/** Droits de l'auteur d'un avenant : phase, tâche, budget en jours, révision, date de fin, affectations. */
const DROITS_AVENANT: readonly Permission[] = [
  "budget.ecrire",
  "mission.planifier",
  "affectation.gerer",
  "mission.creer",
];

/** Auteur de l'avenant mensuel : chef, sinon directeur, avec tous les droits de l'avenant. */
export function auteurAvenantDemo(
  a: ActeursDemo,
  m: { chef_id: string | null; directeur_id: string | null },
): Auth | null {
  return designe(a, m.chef_id, DROITS_AVENANT) ?? designe(a, m.directeur_id, DROITS_AVENANT);
}

/** Valideur de la révision (miroir de routes/budget.ts:254-290) : jamais son auteur. */
export function valideurRevisionDemo(
  a: ActeursDemo,
  m: { directeur_id: string | null },
  auteurId: string,
  requis: RoleApprobateur,
): Auth | null {
  const directeur = sauf(designe(a, m.directeur_id, ["budget.reviser"]), auteurId);
  if (directeur && satisfaitRole(directeur.roles, requis)) return directeur;
  return premier(a, (u) => associeValideurRevision(u, auteurId, requis));
}

function associeValideurRevision(u: Auth, auteurId: string, requis: RoleApprobateur): boolean {
  if (u.utilisateurId === auteurId || !associeAvec(u, ["budget.reviser"])) return false;
  return satisfaitRole(u.roles, requis);
}

/** Droits de l'émetteur : création, soumission, émission, régie, encaissement, toutes missions. */
const DROITS_EMISSION: readonly Permission[] = [
  "facture.emettre",
  "encaissement.gerer",
  "mission.lire_toutes",
];

/** Émetteur des factures et des encaissements : gestionnaire, sinon associé. */
export function emetteurFactureDemo(a: ActeursDemo): Auth | null {
  return (
    premier(a, (u) => !estAssocie(u) && aTout(u, DROITS_EMISSION)) ??
    premier(a, (u) => associeAvec(u, DROITS_EMISSION))
  );
}

/**
 * Approbateur d'une facture (miroir de routes/factures.ts:326-353) : directeur de la mission
 * qui satisfait le rôle exigé, sinon associé ; jamais une personne de `exclus` (créateur,
 * soumetteur, modificateurs), associé compris.
 */
export function approbateurFactureDemo(
  a: ActeursDemo,
  m: { directeur_id: string | null },
  exclus: readonly string[],
  requis: RoleApprobateur,
): Auth | null {
  const libre = (u: Auth) => !exclus.includes(u.utilisateurId);
  const directeur = designe(a, m.directeur_id, ["facture.valider"]);
  if (directeur && libre(directeur) && satisfaitRole(directeur.roles, requis)) return directeur;
  return premier(a, (u) => libre(u) && associeAvec(u, ["facture.valider"]));
}
