/**
 * Vue des comptes d'un cabinet de démonstration : répartition équipe / portail, groupes par rôle
 * et filtre. Logique pure (aucun appel, aucun stockage), testée dans `demo-connexion-comptes.test.ts`.
 * Le tri vient de l'API (cabinet, puis rang du rôle, puis nom) : il est conservé tel quel.
 */
import { ROLE_LIBELLES, ROLES, ROLES_CLIENT } from "@missionpilot/shared";
import {
  libelleNombreComptes,
  TITRE_GROUPE_EQUIPE,
  TITRE_GROUPE_PORTAIL,
  type DemoCompte,
  type EspaceDemo,
} from "./demo-connexion";

/** Ordre d'affichage des rôles : équipe du cabinet, puis espace client. */
const ORDRE_ROLES: readonly string[] = [...ROLES, ...ROLES_CLIENT];

/** Clé du groupe des comptes dont aucun rôle n'est connu de cette version. */
export const CLE_ROLE_AUTRE = "autre";
export const LIBELLE_ROLE_AUTRE = "Autres comptes";

const estRoleConnu = (r: string): boolean => Object.hasOwn(ROLE_LIBELLES, r);

/** Rôle sous lequel le compte est rangé : le premier dans l'ordre d'affichage, sinon « autre ». */
export function rolePrincipal(compte: Pick<DemoCompte, "roles">): string {
  let meilleur = -1;
  for (const r of compte.roles) {
    const rang = ORDRE_ROLES.indexOf(r);
    if (rang >= 0 && (meilleur < 0 || rang < meilleur)) meilleur = rang;
  }
  return meilleur < 0 ? CLE_ROLE_AUTRE : ORDRE_ROLES[meilleur]!;
}

export function libelleRole(cle: string): string {
  return estRoleConnu(cle) ? ROLE_LIBELLES[cle as keyof typeof ROLE_LIBELLES] : LIBELLE_ROLE_AUTRE;
}

export interface RepartitionComptes {
  total: number;
  equipe: number;
  portail: number;
}

export function repartitionComptes(comptes: readonly DemoCompte[]): RepartitionComptes {
  const portail = comptes.filter((c) => c.portail).length;
  return { total: comptes.length, equipe: comptes.length - portail, portail };
}

/**
 * Détail d'une carte de cabinet : « 43 comptes (19 équipe, 24 client) » ; un seul espace : le
 * nombre seul (« 12 comptes »), puisque la répartition n'apprend rien.
 */
export function libelleDetailCabinet(comptes: readonly DemoCompte[]): string {
  const { total, equipe, portail } = repartitionComptes(comptes);
  const base = libelleNombreComptes(total);
  return equipe > 0 && portail > 0 ? `${base} (${equipe} équipe, ${portail} client)` : base;
}

export interface EspaceDisponible {
  espace: EspaceDemo;
  titre: string;
  nombre: number;
}

/** Espaces ayant au moins un compte, équipe d'abord. */
export function espacesDisponibles(comptes: readonly DemoCompte[]): EspaceDisponible[] {
  const { equipe, portail } = repartitionComptes(comptes);
  const espaces: EspaceDisponible[] = [
    { espace: "equipe", titre: TITRE_GROUPE_EQUIPE, nombre: equipe },
    { espace: "portail", titre: TITRE_GROUPE_PORTAIL, nombre: portail },
  ];
  return espaces.filter((e) => e.nombre > 0);
}

export interface FiltreComptesDemo {
  espace: EspaceDemo;
  /** Rôle retenu dans l'espace, `null` pour tous. */
  role: string | null;
}

export type EvenementFiltreDemo =
  { type: "espace"; espace: EspaceDemo } | { type: "role"; role: string };

/** Premier espace non vide (équipe d'abord) ; équipe si le cabinet n'a aucun compte. */
export function filtreInitial(comptes: readonly DemoCompte[]): FiltreComptesDemo {
  return { espace: espacesDisponibles(comptes)[0]?.espace ?? "equipe", role: null };
}

/** Changer d'espace efface le rôle ; un second clic sur le rôle retenu le retire. */
export function transitionFiltre(
  filtre: FiltreComptesDemo,
  ev: EvenementFiltreDemo,
): FiltreComptesDemo {
  if (ev.type === "espace")
    return ev.espace === filtre.espace ? filtre : { espace: ev.espace, role: null };
  return { espace: filtre.espace, role: filtre.role === ev.role ? null : ev.role };
}

export interface GroupeRoleDemo {
  /** Rôle principal (ou `CLE_ROLE_AUTRE`). */
  cle: string;
  libelle: string;
  comptes: DemoCompte[];
}

function grouperParRole(comptes: readonly DemoCompte[]): GroupeRoleDemo[] {
  const parRole = new Map<string, DemoCompte[]>();
  for (const c of comptes) {
    const cle = rolePrincipal(c);
    parRole.set(cle, [...(parRole.get(cle) ?? []), c]);
  }
  const cles = [...parRole.keys()].sort((a, b) => {
    const ra = ORDRE_ROLES.indexOf(a);
    const rb = ORDRE_ROLES.indexOf(b);
    return (ra < 0 ? ORDRE_ROLES.length : ra) - (rb < 0 ? ORDRE_ROLES.length : rb);
  });
  return cles.map((cle) => ({ cle, libelle: libelleRole(cle), comptes: parRole.get(cle)! }));
}

/** Rôles de l'espace avec leur nombre de comptes (puces du filtre), dans l'ordre d'affichage. */
export function optionsRoles(
  comptes: readonly DemoCompte[],
  espace: EspaceDemo,
): { cle: string; libelle: string; nombre: number }[] {
  return grouperParRole(comptes.filter((c) => c.portail === (espace === "portail"))).map((g) => ({
    cle: g.cle,
    libelle: g.libelle,
    nombre: g.comptes.length,
  }));
}

/** Comptes visibles : ceux de l'espace retenu, groupés par rôle (rôle inconnu du filtre : tous). */
export function vueComptes(
  comptes: readonly DemoCompte[],
  filtre: FiltreComptesDemo,
): GroupeRoleDemo[] {
  const groupes = grouperParRole(
    comptes.filter((c) => c.portail === (filtre.espace === "portail")),
  );
  const retenu = groupes.filter((g) => g.cle === filtre.role);
  return retenu.length > 0 ? retenu : groupes;
}

/** Rôles du compte autres que son rôle de rangement (compte à plusieurs rôles), en clair. */
export function libelleAutresRoles(compte: DemoCompte): string {
  const principal = rolePrincipal(compte);
  return compte.roles
    .filter((r) => r !== principal && estRoleConnu(r))
    .map(libelleRole)
    .join(", ");
}
