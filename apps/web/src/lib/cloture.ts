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
  creerTraduire,
  CONTROLE_CLOTURE_LIBELLES,
  type Langue,
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

const LIBELLES_ETAT_ITEM_EN: Record<EtatItemCloture, string> = {
  inactif: "Disabled",
  conforme: "Compliant",
  avertissement: "To address (non-blocking)",
  deroge: "Waiver granted",
  bloque: "Blocking",
};

/** Libellé de l'état d'un item dans la langue demandée. */
export const libelleEtatItemCloture = (etat: EtatItemCloture, langue: Langue = "fr"): string =>
  langue === "en" ? LIBELLES_ETAT_ITEM_EN[etat] : ETAT_ITEM_CLOTURE[etat].libelle;

/** Libellé court des écarts d'un item, ou `null` s'il n'y a rien à dire. */
export function libelleEcarts(
  item: Pick<ItemCloture, "etat" | "nombre_ecarts" | "controle">,
  langue: Langue = "fr",
) {
  const t = creerTraduire(langue);
  if (item.etat === "inactif" || item.nombre_ecarts === 0) return null;
  // Champ absent : donnée financière non servie à ce rôle (jamais « undefined écarts »).
  if (item.nombre_ecarts === undefined) {
    return item.etat === "conforme"
      ? null
      : t(
          "Nombre d'écarts réservé aux droits de facturation",
          "Number of discrepancies restricted to billing permissions",
        );
  }
  if (item.nombre_ecarts === null) {
    return item.controle === "capitalisation_faite"
      ? t("Non attestée", "Not attested")
      : t("Non vérifié", "Not verified");
  }
  return item.nombre_ecarts === 1
    ? t("1 écart", "1 discrepancy")
    : t(`${item.nombre_ecarts} écarts`, `${item.nombre_ecarts} discrepancies`);
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

const CONTROLE_CLOTURE_LIBELLES_EN: Record<ControleCloture, string> = {
  temps_valides: "Time entries approved",
  debours_traites: "Expenses processed",
  factures_emises: "Invoices issued",
  livrables_signes: "Deliverables signed",
  encaissements_soldes: "Payments received in full",
  satisfaction_demandee: "Satisfaction requested",
  capitalisation_faite: "Capitalization done",
};

export const libelleControle = (controle: ControleCloture, langue: Langue = "fr"): string =>
  langue === "en" ? CONTROLE_CLOTURE_LIBELLES_EN[controle] : CONTROLE_CLOTURE_LIBELLES[controle];

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
  langue: Langue = "fr",
): string | null {
  const t = creerTraduire(langue);
  if (evaluation.statut_mission === "cloturee") {
    return t("La mission est déjà clôturée.", "The engagement is already closed.");
  }
  if (evaluation.statut_mission !== "a_cloturer") {
    return t(
      "La mission doit d'abord passer au statut « À clôturer ».",
      'The engagement must first be set to the "To close" status.',
    );
  }
  if (!evaluation.autorisee) {
    const liste = evaluation.bloquants.map((c) => libelleControle(c, langue)).join(", ");
    return t(
      `Items bloquants à traiter ou à déroger : ${liste}.`,
      `Blocking items to resolve or waive: ${liste}.`,
    );
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

export function validerMotifDerogation(
  motif: string,
  langue: Langue = "fr",
): Resultat<{ motif: string }, "motif"> {
  const t = creerTraduire(langue);
  const m = motif.trim();
  if (m === "") {
    return {
      ok: false,
      erreurs: {
        motif: t("Indiquez le motif de la dérogation.", "Enter the reason for the waiver."),
      },
    };
  }
  if (m.length < MOTIF_MIN) {
    return {
      ok: false,
      erreurs: {
        motif: t(
          `Le motif doit comporter au moins ${MOTIF_MIN} caractères.`,
          `The reason must be at least ${MOTIF_MIN} characters long.`,
        ),
      },
    };
  }
  if (m.length > MOTIF_MAX) {
    return {
      ok: false,
      erreurs: { motif: t(`${MOTIF_MAX} caractères au plus.`, `${MOTIF_MAX} characters at most.`) },
    };
  }
  return { ok: true, charge: { motif: m } };
}

export function validerAttestation(
  note: string,
  langue: Langue = "fr",
): Resultat<{ controle: "capitalisation_faite"; attestee: true; note?: string }, "note"> {
  const n = note.trim();
  if (n.length > MOTIF_MAX) {
    return {
      ok: false,
      erreurs: {
        note: creerTraduire(langue)(
          `${MOTIF_MAX} caractères au plus.`,
          `${MOTIF_MAX} characters at most.`,
        ),
      },
    };
  }
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
