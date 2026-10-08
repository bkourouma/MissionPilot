/**
 * Propositions techniques et financières (MIS-05) : logique pure, testée dans
 * `propositions.test.ts`. Le chiffrage (jours × taux, totaux) vient du moteur de l'API ; ce
 * module choisit ce qui s'affiche selon les droits et prépare les charges utiles.
 */
import {
  aPermission,
  type Permission,
  type Role,
  type StatutProposition,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import type { MembreEquipe } from "./catalogue";
import type { Devise } from "./format";
import { lireMontant, lireNombre, type Resultat } from "./saisie";

export interface ElementProposition {
  id: string;
  parent_id: string | null;
  niveau: number;
  libelle: string;
  ordre: number;
  est_livrable: boolean;
  est_jalon: boolean;
  jours_par_grade: Record<string, number>;
}

/** Ligne du chiffrage. Taux et montant par grade sont des données financières : facultatifs. */
export interface ChiffrageGrade {
  grade_code: string;
  jours: number;
  taux_journalier?: number | null;
  montant?: number | null;
}

export interface Chiffrage {
  devise: Devise;
  jours_total: number;
  honoraires_total?: number;
  par_grade: ChiffrageGrade[];
  taux_manquants: string[];
}

export interface Proposition {
  id: string;
  opportunite_id: string;
  type_mission_id: string;
  numero: number;
  intitule: string;
  devise: Devise;
  date_reference: string;
  equipe: MembreEquipe[];
  statut: StatutProposition;
  validee_le: string | null;
  envoyee_le: string | null;
  repondue_le: string | null;
  cree_le: string;
  modifie_le: string;
}

export interface PropositionDetaillee extends Proposition {
  elements: ElementProposition[];
  /** Taux de vente par grade : absent sans « finance.lire ». */
  taux?: Record<string, number | null>;
  chiffrage: Chiffrage;
}

export const STATUT_PROPOSITION: Record<
  StatutProposition,
  { libelle: string; tonalite: TonaliteStatut }
> = {
  brouillon: { libelle: "Brouillon", tonalite: "neutre" },
  a_valider: { libelle: "À valider", tonalite: "attention" },
  validee: { libelle: "Validée", tonalite: "succes" },
  envoyee: { libelle: "Envoyée au client", tonalite: "neutre" },
  acceptee: { libelle: "Acceptée", tonalite: "succes" },
  refusee: { libelle: "Refusée", tonalite: "danger" },
};

/** Transitions autorisées par l'API et permission exigée (miroir de `routes/propositions.ts`). */
export const TRANSITIONS_PROPOSITION: Record<
  StatutProposition,
  Partial<Record<StatutProposition, Permission>>
> = {
  brouillon: { a_valider: "pipeline.gerer" },
  a_valider: { validee: "proposition.valider", brouillon: "proposition.valider" },
  validee: { envoyee: "pipeline.gerer" },
  envoyee: { acceptee: "pipeline.gerer", refusee: "pipeline.gerer" },
  acceptee: {},
  refusee: {},
};

const LIBELLES_ACTION: Partial<Record<StatutProposition, string>> = {
  a_valider: "Soumettre à la validation",
  validee: "Valider la proposition",
  brouillon: "Renvoyer en brouillon",
  envoyee: "Marquer comme envoyée",
  acceptee: "Acceptée par le client",
  refusee: "Refusée par le client",
};

export interface ActionStatut {
  cible: StatutProposition;
  libelle: string;
  /** Action irréversible ou sensible : confirmation en deux temps. */
  confirmer: boolean;
}

/** Changements de statut proposés à cet utilisateur pour ce statut. */
export function actionsStatutProposition(
  statut: StatutProposition,
  roles: readonly Role[],
): ActionStatut[] {
  return Object.entries(TRANSITIONS_PROPOSITION[statut])
    .filter(([, permission]) => aPermission(roles, permission as Permission))
    .map(([cible]) => ({
      cible: cible as StatutProposition,
      libelle: LIBELLES_ACTION[cible as StatutProposition] ?? cible,
      confirmer: cible === "validee" || cible === "acceptee" || cible === "refusee",
    }));
}

/** Seul un brouillon se modifie ; ensuite, on crée une nouvelle version. */
export const propositionModifiable = (statut: StatutProposition) => statut === "brouillon";

/** Une mission naît d'une proposition acceptée, pour qui a « mission.creer ». */
export const peutCreerMission = (statut: StatutProposition, roles: readonly Role[]) =>
  statut === "acceptee" && aPermission(roles, "mission.creer");

export interface NoeudProposition extends ElementProposition {
  enfants: NoeudProposition[];
}

/** Arbre phases > lots > tâches depuis la liste à plat (déjà dans l'ordre de lecture). */
export function arbreProposition(elements: readonly ElementProposition[]): NoeudProposition[] {
  const noeuds = new Map<string, NoeudProposition>();
  for (const e of elements) noeuds.set(e.id, { ...e, enfants: [] });
  const racines: NoeudProposition[] = [];
  for (const e of elements) {
    const n = noeuds.get(e.id) as NoeudProposition;
    const parent = e.parent_id ? noeuds.get(e.parent_id) : undefined;
    if (parent) parent.enfants.push(n);
    else racines.push(n);
  }
  return racines;
}

// --- Masquage financier ---------------------------------------------------------------

export interface DroitsMontants {
  /** Totaux d'honoraires (budget.lire_montants ou finance.lire). */
  totaux: boolean;
  /** Taux et montants unitaires par grade (finance.lire). */
  unitaires: boolean;
}

export function droitsMontants(roles: readonly Role[]): DroitsMontants {
  const finance = aPermission(roles, "finance.lire");
  return { totaux: finance || aPermission(roles, "budget.lire_montants"), unitaires: finance };
}

/**
 * Proposition réduite à ce que l'utilisateur peut voir, avant tout envoi à un composant
 * client : sans « finance.lire », ni taux ni montant par grade, même si l'API les renvoie.
 */
export function propositionVisible(
  p: PropositionDetaillee,
  droits: DroitsMontants,
): PropositionDetaillee {
  const { taux, chiffrage, ...reste } = p;
  const { honoraires_total, par_grade, ...base } = chiffrage;
  return {
    ...reste,
    ...(droits.unitaires && taux ? { taux } : {}),
    chiffrage: {
      ...base,
      ...(droits.totaux && honoraires_total !== undefined ? { honoraires_total } : {}),
      par_grade: par_grade.map(({ taux_journalier, montant, ...g }) =>
        droits.unitaires ? { ...g, taux_journalier, montant } : g,
      ),
    },
  };
}

// --- Saisies ---------------------------------------------------------------------------

/** Jours par grade d'un élément (texte saisi) → charge `jours_par_grade`, au centième. */
export function validerJoursParGrade(
  saisie: Record<string, string>,
): Resultat<{ jours_par_grade: Record<string, number> }, string> {
  const erreurs: Record<string, string> = {};
  const jours: Record<string, number> = {};
  for (const [grade, texte] of Object.entries(saisie)) {
    const n = lireNombre(texte);
    if (n === null) continue;
    if (Number.isNaN(n) || n < 0 || n > 1000 || Math.abs(n * 100 - Math.round(n * 100)) > 1e-9)
      erreurs[grade] = "Entre 0 et 1000 jours, au centième au plus (ex. 2,25).";
    else if (n > 0) jours[grade] = n;
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { jours_par_grade: jours } };
}

/** Équipe proposée : nombre de personnes par grade (1 à 50), vide = grade absent. */
export function validerEquipe(
  saisie: Record<string, string>,
): Resultat<{ equipe: MembreEquipe[] }, string> {
  const erreurs: Record<string, string> = {};
  const equipe: MembreEquipe[] = [];
  for (const [grade, texte] of Object.entries(saisie)) {
    const n = lireNombre(texte);
    if (n === null || n === 0) continue;
    if (Number.isNaN(n) || !Number.isInteger(n) || n < 0 || n > 50)
      erreurs[grade] = "Nombre entier entre 0 et 50.";
    else equipe.push({ grade_code: grade, nombre: n });
  }
  if (equipe.length > 20) erreurs._ = "20 grades au plus.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { equipe } };
}

/** Taux journaliers de vente (finance.lire) : vide retire le taux (null). */
export function validerTaux(
  saisie: Record<string, string>,
  devise: Devise,
): Resultat<{ taux: Record<string, number | null> }, string> {
  const erreurs: Record<string, string> = {};
  const taux: Record<string, number | null> = {};
  for (const [grade, texte] of Object.entries(saisie)) {
    const m = lireMontant(texte, devise);
    if (m !== null && Number.isNaN(m))
      erreurs[grade] =
        devise === "XOF" || devise === "XAF"
          ? "Montant entier positif (ex. 350 000)."
          : "Montant positif, deux décimales au plus.";
    else taux[grade] = m;
  }
  if (Object.keys(taux).length === 0 && Object.keys(erreurs).length === 0)
    erreurs._ = "Aucun taux à enregistrer.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { taux } };
}

export interface SaisieGeneration {
  type_mission_id: string;
  intitule: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Génération d'une proposition depuis un type du catalogue (type requis, intitulé facultatif). */
export function validerGeneration(
  s: SaisieGeneration,
): Resultat<{ type_mission_id: string; intitule?: string }, keyof SaisieGeneration> {
  const erreurs: Partial<Record<keyof SaisieGeneration, string>> = {};
  if (!UUID.test(s.type_mission_id))
    erreurs.type_mission_id = "Choisissez le type de mission du catalogue.";
  const intitule = s.intitule.trim();
  if (intitule.length > 200) erreurs.intitule = "200 caractères au plus.";
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: { type_mission_id: s.type_mission_id, ...(intitule ? { intitule } : {}) },
  };
}
