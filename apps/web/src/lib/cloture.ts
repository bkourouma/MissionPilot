/**
 * Check-list de clôture d'une mission (AUT-08) : types des réponses de l'API, libellés, liens vers
 * les écrans qui traitent chaque item, validations de saisie et droits d'affichage. Logique pure,
 * testée dans `cloture.test.ts`.
 *
 * RÈGLE : la décision de clôture (items bloquants, dérogations) est prise par l'API (moteur
 * `decisionCloture`) ; ce module n'en recalcule rien, il met en forme ce que l'API renvoie. Les
 * droits ci-dessous sont un confort d'affichage ; l'API reste seule juge.
 */
import {
  aPermission,
  CONTROLE_CLOTURE_LIBELLES,
  type ControleCloture,
  type EtatItemCloture,
  type Role,
  type StatutMission,
} from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { ErreurApi } from "./api";
import { hrefQualiteMission, hrefSatisfaction } from "./qualite";
import type { Resultat } from "./saisie";

// --- Types des réponses de l'API -------------------------------------------------------------

export interface DerogationCloture {
  motif: string;
  par: string;
  par_nom: string | null;
  le: string;
}

export interface AttestationCloture {
  attestee: boolean;
  note: string | null;
  par: string;
  par_nom: string | null;
  le: string;
}

export interface ItemModeleCloture {
  controle: ControleCloture;
  libelle: string;
  description: string;
  actif: boolean;
  bloquant: boolean;
  par_attestation: boolean;
  par_defaut: boolean;
}

export interface ItemCloture extends ItemModeleCloture {
  etat: EtatItemCloture;
  /** Absent (pas `null`) pour un contrôle financier sans `facture.lire` : jamais déduit. */
  nombre_ecarts?: number | null;
  derogation: DerogationCloture | null;
  attestation: AttestationCloture | null;
  verifie_le: string | null;
}

export interface EvaluationClotureVue {
  mission_id: string;
  statut_mission: StatutMission;
  autorisee: boolean;
  bloquants: ControleCloture[];
  items: ItemCloture[];
}

// --- Présentation ----------------------------------------------------------------------------

export const ETAT_ITEM_CLOTURE: Record<
  EtatItemCloture,
  { libelle: string; tonalite: TonaliteStatut }
> = {
  inactif: { libelle: "Désactivé", tonalite: "neutre" },
  conforme: { libelle: "Conforme", tonalite: "succes" },
  avertissement: { libelle: "À traiter (non bloquant)", tonalite: "attention" },
  deroge: { libelle: "Dérogation accordée", tonalite: "attention" },
  bloque: { libelle: "Bloquant", tonalite: "danger" },
};

/** Libellé court des écarts d'un item, ou `null` s'il n'y a rien à dire. */
export function libelleEcarts(item: Pick<ItemCloture, "etat" | "nombre_ecarts" | "controle">) {
  if (item.etat === "inactif" || item.nombre_ecarts === 0) return null;
  // Champ absent : donnée financière non servie à ce rôle (jamais « undefined écarts »).
  if (item.nombre_ecarts === undefined) {
    return item.etat === "conforme" ? null : "Nombre d'écarts réservé aux droits de facturation";
  }
  if (item.nombre_ecarts === null) {
    return item.controle === "capitalisation_faite" ? "Non attestée" : "Non vérifié";
  }
  return item.nombre_ecarts === 1 ? "1 écart" : `${item.nombre_ecarts} écarts`;
}

/** Écran qui permet de traiter l'item (lien de la check-list) ; `null` : traité sur place. */
export function hrefControleCloture(controle: ControleCloture, missionId: string): string | null {
  const base = `/missions/${encodeURIComponent(missionId)}`;
  switch (controle) {
    case "temps_valides":
      return "/temps/validation";
    case "debours_traites":
      return `${base}/debours`;
    case "factures_emises":
    case "encaissements_soldes":
      return `${base}/facturation`;
    case "livrables_signes":
      return hrefQualiteMission(missionId);
    case "satisfaction_demandee":
      return hrefSatisfaction(missionId);
    case "capitalisation_faite":
      return null;
  }
}

export const HREF_PARAMETRAGE_CLOTURE = "/parametres/cloture-mission";

export const libelleControle = (controle: ControleCloture): string =>
  CONTROLE_CLOTURE_LIBELLES[controle];

// --- Droits d'affichage ----------------------------------------------------------------------

export interface DroitsCloture {
  /** Accorder ou retirer une dérogation (directeur de mission, associé). */
  deroger: boolean;
  /** Évaluer avec enregistrement et attester (`mission.planifier`). */
  evaluer: boolean;
  /** Lancer la clôture. */
  cloturer: boolean;
  /** Paramétrer le modèle du cabinet. */
  parametrer: boolean;
}

export function droitsCloture(roles: readonly Role[], statut: StatutMission): DroitsCloture {
  const ouverte = statut === "a_cloturer";
  return {
    deroger: aPermission(roles, "mission.cloturer") && statut !== "cloturee",
    evaluer: aPermission(roles, "mission.planifier") && statut !== "cloturee",
    cloturer: aPermission(roles, "mission.cloturer") && ouverte,
    parametrer: aPermission(roles, "cabinet.gerer"),
  };
}

/**
 * Le bouton de clôture n'est actif que si la mission est « à clôturer » et que l'API a déclaré la
 * clôture autorisée (aucun item bloquant sans dérogation). L'API refuse de toute façon en 409.
 */
export function clotureActivable(
  evaluation: Pick<EvaluationClotureVue, "autorisee" | "statut_mission">,
  droits: Pick<DroitsCloture, "cloturer">,
): boolean {
  return droits.cloturer && evaluation.statut_mission === "a_cloturer" && evaluation.autorisee;
}

/** Phrase qui explique pourquoi la clôture n'est pas (encore) possible ; `null` si elle l'est. */
export function raisonClotureImpossible(
  evaluation: Pick<EvaluationClotureVue, "autorisee" | "statut_mission" | "bloquants">,
): string | null {
  if (evaluation.statut_mission === "cloturee") return "La mission est déjà clôturée.";
  if (evaluation.statut_mission !== "a_cloturer") {
    return "La mission doit d'abord passer au statut « À clôturer ».";
  }
  if (!evaluation.autorisee) {
    const liste = evaluation.bloquants.map((c) => libelleControle(c)).join(", ");
    return `Items bloquants à traiter ou à déroger : ${liste}.`;
  }
  return null;
}

/** Nombre d'items à traiter (bloquants et avertissements). */
export function compterAnomalies(items: readonly Pick<ItemCloture, "etat">[]): {
  bloquants: number;
  avertissements: number;
  deroges: number;
} {
  return {
    bloquants: items.filter((i) => i.etat === "bloque").length,
    avertissements: items.filter((i) => i.etat === "avertissement").length,
    deroges: items.filter((i) => i.etat === "deroge").length,
  };
}

/** Un item peut recevoir une dérogation s'il est bloquant et non conforme, sans dérogation. */
export function derogationPossible(item: Pick<ItemCloture, "etat">): boolean {
  return item.etat === "bloque";
}

// --- Validations de saisie -------------------------------------------------------------------

export const MOTIF_MIN = 10;
export const MOTIF_MAX = 500;

export function validerMotifDerogation(motif: string): Resultat<{ motif: string }, "motif"> {
  const m = motif.trim();
  if (m === "") return { ok: false, erreurs: { motif: "Indiquez le motif de la dérogation." } };
  if (m.length < MOTIF_MIN) {
    return {
      ok: false,
      erreurs: { motif: `Le motif doit comporter au moins ${MOTIF_MIN} caractères.` },
    };
  }
  if (m.length > MOTIF_MAX) {
    return { ok: false, erreurs: { motif: `${MOTIF_MAX} caractères au plus.` } };
  }
  return { ok: true, charge: { motif: m } };
}

export function validerAttestation(
  note: string,
): Resultat<{ controle: "capitalisation_faite"; attestee: true; note?: string }, "note"> {
  const n = note.trim();
  if (n.length > MOTIF_MAX)
    return { ok: false, erreurs: { note: `${MOTIF_MAX} caractères au plus.` } };
  return {
    ok: true,
    charge: { controle: "capitalisation_faite", attestee: true, ...(n === "" ? {} : { note: n }) },
  };
}

/** Réglage d'un item dans l'écran de paramétrage. */
export interface ReglageItem {
  controle: ControleCloture;
  actif: boolean;
  bloquant: boolean;
}

/** Réglages envoyés à l'API : un item désactivé ne bloque jamais. */
export function chargeModele(reglages: readonly ReglageItem[]): { items: ReglageItem[] } {
  return {
    items: reglages.map((r) => ({
      controle: r.controle,
      actif: r.actif,
      bloquant: r.actif && r.bloquant,
    })),
  };
}

/** Le modèle a-t-il changé par rapport à l'état serveur ? (active le bouton d'enregistrement) */
export function modeleModifie(
  initial: readonly ItemModeleCloture[],
  reglages: readonly ReglageItem[],
): boolean {
  return reglages.some((r) => {
    const i = initial.find((x) => x.controle === r.controle);
    return !i || i.actif !== r.actif || i.bloquant !== (r.actif && r.bloquant);
  });
}

/** Message affiché pour une clôture refusée par l'API (409 `CLOTURE_BLOQUEE`), sinon `null`. */
export function messageClotureBloquee(e: unknown): string | null {
  if (e instanceof ErreurApi && e.code === "CLOTURE_BLOQUEE") return e.message;
  return null;
}
