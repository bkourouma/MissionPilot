/**
 * Tâches assignées (SOC-08) : filtres de « Mes tâches », droits d'action, saisie, liens vers
 * l'élément lié et pastille de navigation. Logique pure, testée dans
 * `taches-collaboration.test.ts`. Distinctes des tâches du découpage de mission. Les règles
 * reproduisent `routes/taches-collaboration.ts` ; l'API reste seule juge.
 */
import {
  aPermission,
  ECHEANCE_MAX,
  ECHEANCE_MIN,
  STATUTS_TACHE_COLLABORATION,
  TYPES_ENTITE_COLLABORATION,
  type Role,
  type StatutTacheCollaboration,
  type TypeEntiteCollaboration,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import type { NomIcone } from "../components/ui/Icone";
import type { Resultat } from "./saisie";

export interface TacheCollaboration {
  id: string;
  titre: string;
  description: string;
  assignee_id: string;
  assignee_nom: string;
  cree_par: string;
  cree_par_nom: string;
  echeance: string | null;
  statut: StatutTacheCollaboration;
  fait_le: string | null;
  entite_type: TypeEntiteCollaboration | null;
  entite_id: string | null;
  mission_id: string | null;
  cree_le: string;
  modifie_le: string;
}

export interface PageTaches {
  elements: TacheCollaboration[];
  curseur_suivant: string | null;
}

export const STATUT_TACHE: Record<
  StatutTacheCollaboration,
  { libelle: string; tonalite: TonaliteStatut }
> = {
  a_faire: { libelle: "À faire", tonalite: "neutre" },
  en_cours: { libelle: "En cours", tonalite: "attention" },
  fait: { libelle: "Fait", tonalite: "succes" },
};

export const OPTIONS_STATUTS_TACHE = STATUTS_TACHE_COLLABORATION.map((s) => ({
  valeur: s,
  libelle: STATUT_TACHE[s].libelle,
}));

export const ENTITE_LIBELLES: Record<TypeEntiteCollaboration, string> = {
  mission: "Mission",
  mission_tache: "Tâche de mission",
  facture: "Facture",
  debours: "Débours",
  opportunite: "Opportunité",
  proposition: "Proposition",
};

export const ENTITE_ICONES: Record<TypeEntiteCollaboration, NomIcone> = {
  mission: "dossier",
  mission_tache: "livre",
  facture: "facture",
  debours: "monnaie",
  opportunite: "entonnoir",
  proposition: "signature",
};

// --- Filtres (dans l'URL) ----------------------------------------------------------------

export type VueTaches = "assignees" | "creees";

export interface FiltresTaches {
  vue: VueTaches;
  statut: StatutTacheCollaboration | "";
  curseur: string;
}

const CURSEUR = /^[A-Za-z0-9_=-]{1,500}$/;
const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function lireFiltresTaches(p: Record<string, string | string[] | undefined>): FiltresTaches {
  const statut = un(p.statut) ?? "";
  const curseur = un(p.curseur) ?? "";
  return {
    vue: un(p.vue) === "creees" ? "creees" : "assignees",
    statut: (STATUTS_TACHE_COLLABORATION as readonly string[]).includes(statut)
      ? (statut as StatutTacheCollaboration)
      : "",
    curseur: CURSEUR.test(curseur) ? curseur : "",
  };
}

export function hrefTaches(f: Partial<FiltresTaches>): string {
  const q = new URLSearchParams();
  if (f.vue === "creees") q.set("vue", "creees");
  if (f.statut) q.set("statut", f.statut);
  if (f.curseur) q.set("curseur", f.curseur);
  const s = q.toString();
  return s ? `/mes-taches?${s}` : "/mes-taches";
}

/** Paramètres de GET /api/taches-collaboration. */
export function requeteTaches(f: FiltresTaches, limite = 30): string {
  const q = new URLSearchParams({ vue: f.vue, limite: String(limite) });
  if (f.statut) q.set("statut", f.statut);
  if (f.curseur) q.set("curseur", f.curseur);
  return `/api/taches-collaboration?${q.toString()}`;
}

// --- Droits ----------------------------------------------------------------------------------

export interface ActionsTache {
  /** Changer le statut : l'assigné ou le créateur. */
  changerStatut: boolean;
  /** Modifier titre, description, assigné, échéance : le créateur qui garde « tache.assigner ». */
  modifier: boolean;
}

export function actionsTache(
  t: Pick<TacheCollaboration, "assignee_id" | "cree_par">,
  utilisateurId: string,
  roles: readonly Role[],
): ActionsTache {
  const createur = t.cree_par === utilisateurId;
  return {
    changerStatut: createur || t.assignee_id === utilisateurId,
    modifier: createur && aPermission(roles, "tache.assigner"),
  };
}

/** Changements de statut proposés depuis le statut courant, action principale d'abord. */
export function transitionsStatut(
  s: StatutTacheCollaboration,
): { cible: StatutTacheCollaboration; libelle: string }[] {
  switch (s) {
    case "a_faire":
      return [
        { cible: "en_cours", libelle: "Commencer" },
        { cible: "fait", libelle: "Marquer comme faite" },
      ];
    case "en_cours":
      return [
        { cible: "fait", libelle: "Marquer comme faite" },
        { cible: "a_faire", libelle: "Remettre à faire" },
      ];
    case "fait":
      return [{ cible: "a_faire", libelle: "Rouvrir" }];
  }
}

/** Échéance passée d'une tâche non faite (dates AAAA-MM-JJ comparées comme du texte). */
export function enRetard(
  t: Pick<TacheCollaboration, "echeance" | "statut">,
  aujourdhui: string,
): boolean {
  return t.statut !== "fait" && t.echeance !== null && t.echeance < aujourdhui;
}

// --- Élément lié ----------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Écran de l'élément lié (mêmes liens que les notifications de l'API), ou null. */
export function lienEntite(
  t: Pick<TacheCollaboration, "entite_type" | "entite_id" | "mission_id">,
): string | null {
  const id = t.entite_id;
  if (!t.entite_type || !id || !UUID.test(id)) return null;
  const mission = t.mission_id && UUID.test(t.mission_id) ? t.mission_id : null;
  switch (t.entite_type) {
    case "mission":
      return `/missions/${id}`;
    case "mission_tache":
      return mission ? `/missions/${mission}/decoupage` : null;
    case "debours":
      return mission ? `/missions/${mission}/debours` : null;
    case "facture":
      return `/facturation/${id}`;
    case "opportunite":
      return `/pipeline/${id}`;
    case "proposition":
      return `/pipeline/propositions/${id}`;
  }
}

/** Élément lié passé dans l'URL de création (`?entite_type=…&entite_id=…`), validé. */
export function lireEntiteLiee(
  p: Record<string, string | string[] | undefined>,
): { type: TypeEntiteCollaboration; id: string } | null {
  const type = un(p.entite_type) ?? "";
  const id = un(p.entite_id) ?? "";
  if (!(TYPES_ENTITE_COLLABORATION as readonly string[]).includes(type) || !UUID.test(id))
    return null;
  return { type: type as TypeEntiteCollaboration, id };
}

/** Lien de création d'une tâche liée à un élément. */
export function hrefNouvelleTache(type: TypeEntiteCollaboration, id: string): string {
  const q = new URLSearchParams({ entite_type: type, entite_id: id });
  return `/mes-taches/nouvelle?${q.toString()}`;
}

// --- Saisie ---------------------------------------------------------------------------------

export interface SaisieTache {
  titre: string;
  description: string;
  assignee_id: string;
  echeance: string;
  /** Élément lié choisi (« type:identifiant ») ou "". */
  entite: string;
}

export type ChampTache = keyof SaisieTache;

export const SAISIE_TACHE_VIDE: SaisieTache = {
  titre: "",
  description: "",
  assignee_id: "",
  echeance: "",
  entite: "",
};

export interface ChargeTache {
  titre: string;
  description: string;
  assignee_id: string;
  echeance: string | null;
  entite_type?: TypeEntiteCollaboration;
  entite_id?: string;
}

// eslint-disable-next-line no-control-regex
const CONTROLES = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const valeurEntite = (type: TypeEntiteCollaboration, id: string) => `${type}:${id}`;

function lireValeurEntite(v: string): { type: TypeEntiteCollaboration; id: string } | null {
  const [type, id] = v.split(":");
  if (!type || !id) return null;
  return lireEntiteLiee({ entite_type: type, entite_id: id });
}

export function validerTache(s: SaisieTache): Resultat<ChargeTache, ChampTache> {
  const erreurs: Partial<Record<ChampTache, string>> = {};
  const titre = s.titre.trim();
  if (titre === "") erreurs.titre = "Donnez un titre à la tâche.";
  else if (titre.length > 200) erreurs.titre = "200 caractères au plus.";
  else if (CONTROLES.test(titre)) erreurs.titre = "Caractère non autorisé.";
  const description = s.description.trim();
  if (description.length > 5000) erreurs.description = "5 000 caractères au plus.";
  else if (CONTROLES.test(description)) erreurs.description = "Caractère non autorisé.";
  if (!UUID.test(s.assignee_id)) erreurs.assignee_id = "Choisissez la personne assignée.";
  if (s.echeance !== "") {
    if (!DATE.test(s.echeance)) erreurs.echeance = "Date invalide.";
    else if (s.echeance < ECHEANCE_MIN || s.echeance > ECHEANCE_MAX)
      erreurs.echeance = "Échéance entre les années 2000 et 2100.";
  }
  const entite = s.entite === "" ? null : lireValeurEntite(s.entite);
  if (s.entite !== "" && !entite) erreurs.entite = "Élément lié invalide.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      titre,
      description,
      assignee_id: s.assignee_id,
      echeance: s.echeance === "" ? null : s.echeance,
      ...(entite ? { entite_type: entite.type, entite_id: entite.id } : {}),
    },
  };
}

/** Modification par le créateur : seuls les champs changés (titre, description, assigné, échéance). */
export function changementsTache(
  t: Pick<TacheCollaboration, "titre" | "description" | "assignee_id" | "echeance">,
  c: ChargeTache,
): Partial<Pick<ChargeTache, "titre" | "description" | "assignee_id" | "echeance">> {
  const r: Partial<Pick<ChargeTache, "titre" | "description" | "assignee_id" | "echeance">> = {};
  if (c.titre !== t.titre) r.titre = c.titre;
  if (c.description !== (t.description ?? "")) r.description = c.description;
  if (c.assignee_id !== t.assignee_id) r.assignee_id = c.assignee_id;
  if (c.echeance !== t.echeance) r.echeance = c.echeance;
  return r;
}

// --- Pastille de navigation -------------------------------------------------------------------

/** Nombre de tâches ouvertes (non faites) dans une page triée « ouvertes d'abord ». */
export const tachesOuvertes = (elements: readonly Pick<TacheCollaboration, "statut">[]) =>
  elements.filter((t) => t.statut !== "fait").length;

/**
 * Pastille : « 9+ » au-delà de 9 (la page lue est bornée à 10 éléments), rien sans tâche
 * ouverte.
 */
export function pastilleTaches(ouvertes: number | null): string | null {
  if (ouvertes === null || ouvertes <= 0) return null;
  return ouvertes > 9 ? "9+" : String(ouvertes);
}

export function libellePastilleTaches(ouvertes: number | null): string {
  if (ouvertes === null || ouvertes <= 0) return "";
  if (ouvertes > 9) return "plus de 9 tâches ouvertes";
  return ouvertes === 1 ? "1 tâche ouverte" : `${ouvertes} tâches ouvertes`;
}
