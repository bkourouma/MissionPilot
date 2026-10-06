/**
 * Versions de budget d'une mission (FIN-03), comparaison et révisions : logique pure, testée
 * dans `budget.test.ts`. Tous les montants viennent du moteur finance de l'API ; ce module
 * filtre ce que l'utilisateur a le droit de voir (FIN-02) et prépare les charges utiles.
 */
import {
  aPermission,
  NATURES_FINANCE,
  type NatureLigneBudget,
  type Role,
  type StatutMission,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import type { Devise } from "./format";
import { estSignee } from "./missions";
import type { Resultat } from "./saisie";

export type TypeVersion = "initial" | "revise" | "atterrissage";

export interface SyntheseVersion {
  devise: Devise;
  jours_vendus: number;
  honoraires?: number;
  debours_refacturables?: number;
  debours_non_refacturables?: number;
  /** Données finance (FIN-02) : absentes sans « finance.lire ». */
  couts_internes?: number;
  sous_traitance?: number;
  marge?: number;
  taux_marge?: number | null;
  jours_production?: number;
}

export interface LigneVersion {
  id: string;
  cle: string;
  libelle: string;
  nature: NatureLigneBudget;
  grade_code: string | null;
  jours: number | null;
  refacturable: boolean;
  prix_journalier?: number | null;
  montant_forfait?: number | null;
  montant?: number;
}

export interface VersionBudget {
  id: string;
  numero: number;
  type: TypeVersion;
  devise: Devise;
  figee: boolean;
  date_figeage: string | null;
  motif: string | null;
  role_approbateur: string | null;
  cree_par?: string | null;
  cree_le: string;
  validee_le: string | null;
  synthese: SyntheseVersion;
  lignes: LigneVersion[];
}

export interface BudgetMission {
  devise: Devise;
  devise_reference: string | null;
  taux_change: number | null;
  reference_id: string | null;
  en_cours_id: string | null;
  versions: VersionBudget[];
}

export type StatutEcart = "ajoutee" | "supprimee" | "modifiee" | "inchangee";

export interface LigneComparaison {
  cle: string;
  libelle: string;
  nature: NatureLigneBudget;
  statut: StatutEcart;
  jours_avant: number | null;
  jours_apres: number | null;
  ecart_jours: number | null;
  montant_avant?: number;
  montant_apres?: number;
  ecart_montant?: number;
}

export interface Comparaison {
  avant: { id: string; numero: number; type: TypeVersion };
  apres: { id: string; numero: number; type: TypeVersion };
  ecart_jours_vendus: number;
  ecart_honoraires?: number;
  ecart_couts_internes?: number;
  ecart_marge?: number;
  lignes: LigneComparaison[];
}

export const TYPE_VERSION_LIBELLES: Record<TypeVersion, string> = {
  initial: "Budget initial (signé)",
  revise: "Révision",
  atterrissage: "Atterrissage",
};

export const NATURE_LIBELLES: Record<NatureLigneBudget, string> = {
  honoraires: "Honoraires",
  cout_interne: "Coût interne",
  debours: "Débours",
  sous_traitance: "Sous-traitance",
};

export const STATUT_ECART: Record<StatutEcart, { libelle: string; tonalite: TonaliteStatut }> = {
  ajoutee: { libelle: "Ajoutée", tonalite: "attention" },
  supprimee: { libelle: "Supprimée", tonalite: "danger" },
  modifiee: { libelle: "Modifiée", tonalite: "attention" },
  inchangee: { libelle: "Inchangée", tonalite: "neutre" },
};

/** Libellé court d'une version : « V1 — Budget initial (signé) ». */
export const libelleVersion = (v: Pick<VersionBudget, "numero" | "type">) =>
  `V${v.numero} — ${TYPE_VERSION_LIBELLES[v.type]}`;

export function etatVersion(
  v: Pick<VersionBudget, "figee" | "type">,
  referenceId: string | null,
  id: string,
): { libelle: string; tonalite: TonaliteStatut } {
  if (!v.figee) return { libelle: "En cours de révision", tonalite: "attention" };
  if (id === referenceId) return { libelle: "Figée — référence", tonalite: "succes" };
  return { libelle: "Figée — historique", tonalite: "neutre" };
}

// --- Masquage financier (FIN-02) -----------------------------------------------------------

export interface DroitsBudget {
  /** Honoraires, débours, prix journaliers d'honoraires (budget.lire_montants ou finance.lire). */
  montants: boolean;
  /** Coûts internes, sous-traitance, marge (finance.lire). */
  finance: boolean;
}

export function droitsBudget(roles: readonly Role[]): DroitsBudget {
  const finance = aPermission(roles, "finance.lire");
  return { montants: finance || aPermission(roles, "budget.lire_montants"), finance };
}

const estNatureFinance = (n: NatureLigneBudget) => NATURES_FINANCE.includes(n);
/** Liste blanche des champs d'une ligne sans aucun montant. */
const sansMontantsLigne = (l: LigneVersion): LigneVersion => ({
  id: l.id,
  cle: l.cle,
  libelle: l.libelle,
  nature: l.nature,
  grade_code: l.grade_code,
  jours: l.jours,
  refacturable: l.refacturable,
});

/**
 * Version réduite à ce que l'utilisateur peut voir, appliquée côté serveur web avant tout
 * envoi à un composant client, même si l'API a déjà filtré (défense en profondeur).
 */
export function versionVisible(v: VersionBudget, d: DroitsBudget): VersionBudget {
  const s = v.synthese;
  const synthese: SyntheseVersion = { devise: s.devise, jours_vendus: s.jours_vendus };
  if (d.montants) {
    if (s.honoraires !== undefined) synthese.honoraires = s.honoraires;
    if (s.debours_refacturables !== undefined)
      synthese.debours_refacturables = s.debours_refacturables;
    if (s.debours_non_refacturables !== undefined)
      synthese.debours_non_refacturables = s.debours_non_refacturables;
  }
  if (d.finance) {
    for (const cle of [
      "couts_internes",
      "sous_traitance",
      "marge",
      "taux_marge",
      "jours_production",
    ] as const) {
      if (s[cle] !== undefined) (synthese as unknown as Record<string, unknown>)[cle] = s[cle];
    }
  }
  const lignes = v.lignes
    .filter((l) => d.finance || !estNatureFinance(l.nature))
    .map((l) => (d.montants ? l : sansMontantsLigne(l)));
  return { ...v, synthese, lignes };
}

export function budgetVisible(b: BudgetMission, d: DroitsBudget): BudgetMission {
  return { ...b, versions: b.versions.map((v) => versionVisible(v, d)) };
}

export function comparaisonVisible(c: Comparaison, d: DroitsBudget): Comparaison {
  const { ecart_honoraires, ecart_couts_internes, ecart_marge, lignes, ...base } = c;
  return {
    ...base,
    ...(d.montants && ecart_honoraires !== undefined ? { ecart_honoraires } : {}),
    ...(d.finance && ecart_couts_internes !== undefined ? { ecart_couts_internes } : {}),
    ...(d.finance && ecart_marge !== undefined ? { ecart_marge } : {}),
    lignes: lignes
      .filter((l) => d.finance || !estNatureFinance(l.nature))
      .map((l): LigneComparaison =>
        d.montants
          ? l
          : {
              cle: l.cle,
              libelle: l.libelle,
              nature: l.nature,
              statut: l.statut,
              jours_avant: l.jours_avant,
              jours_apres: l.jours_apres,
              ecart_jours: l.ecart_jours,
            },
      ),
  };
}

// --- Actions --------------------------------------------------------------------------------

export interface ActionsBudget {
  /** Créer une révision : budget.ecrire, mission signée et modifiable, aucune révision en cours. */
  reviser: boolean;
  /**
   * Valider la révision en cours : « budget.reviser », directeur de CETTE mission ou associé, et
   * jamais l'auteur de la révision (sauf associé). Le seuil d'approbation selon le montant des
   * écarts reste vérifié par l'API.
   */
  valider: boolean;
  /** Abandonner la révision en cours : budget.ecrire. */
  abandonner: boolean;
  /** Raison affichée quand la révision est impossible. */
  raison: string | null;
  /** Raison affichée quand une révision attend une validation que l'utilisateur ne peut pas donner. */
  raisonValidation: string | null;
}

export interface ContexteBudget {
  utilisateurId: string;
  /** Directeur désigné de la mission. */
  directeurId: string | null;
  /** Auteur de la révision en cours, s'il est connu. */
  auteurEnCours: string | null;
}

export function actionsBudget(
  roles: readonly Role[],
  mission: { statut: StatutMission; modifiable: boolean },
  budget: Pick<BudgetMission, "en_cours_id" | "reference_id">,
  ctx: ContexteBudget,
): ActionsBudget {
  const ecrire = aPermission(roles, "budget.ecrire") && mission.modifiable;
  const signee = estSignee(mission.statut) && mission.statut !== "cloturee";
  const enCours = budget.en_cours_id !== null;
  const associe = roles.includes("associe");
  const directeur = ctx.directeurId !== null && ctx.directeurId === ctx.utilisateurId;
  const auteur = ctx.auteurEnCours !== null && ctx.auteurEnCours === ctx.utilisateurId;
  let raison: string | null = null;
  if (!ecrire) raison = null;
  else if (!estSignee(mission.statut))
    raison = "Le budget se révise après la signature de la lettre de mission.";
  else if (mission.statut === "cloturee") raison = "La mission est clôturée.";
  else if (enCours) raison = "Une révision est déjà en cours : la valider ou l'abandonner.";
  else if (!budget.reference_id) raison = "La mission n'a pas encore de budget initial.";
  const peutValider =
    aPermission(roles, "budget.reviser") && (associe || directeur) && (associe || !auteur);
  let raisonValidation: string | null = null;
  if (enCours && signee && !peutValider)
    raisonValidation =
      auteur && !associe
        ? "Vous êtes l'auteur de cette révision : elle doit être validée par un associé."
        : "Cette révision attend la validation du directeur de la mission ou d'un associé (selon le montant des écarts).";
  return {
    reviser: ecrire && signee && !enCours && budget.reference_id !== null,
    valider: peutValider && mission.modifiable && signee && enCours,
    abandonner: ecrire && signee && enCours,
    raison,
    raisonValidation,
  };
}

export interface SaisieRevision {
  motif: string;
  depuis_decoupage: boolean;
}

/** Révision : motif obligatoire (2000 caractères au plus). */
export function validerRevision(
  s: SaisieRevision,
): Resultat<{ motif: string; depuis_decoupage: boolean }, "motif"> {
  const motif = s.motif.trim();
  if (motif === "")
    return { ok: false, erreurs: { motif: "Indiquez le motif de la révision (obligatoire)." } };
  if (motif.length > 2000) return { ok: false, erreurs: { motif: "2000 caractères au plus." } };
  return { ok: true, charge: { motif, depuis_decoupage: s.depuis_decoupage } };
}

/** Paramètres de comparaison lus dans l'URL : deux versions distinctes de la mission. */
export function lireComparaison(
  p: Record<string, string | string[] | undefined>,
  versions: readonly Pick<VersionBudget, "id">[],
): { avant: string; apres: string } | null {
  const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const avant = un(p.avant);
  const apres = un(p.apres);
  const ids = new Set(versions.map((v) => v.id));
  if (!avant || !apres || avant === apres || !ids.has(avant) || !ids.has(apres)) return null;
  return { avant, apres };
}
