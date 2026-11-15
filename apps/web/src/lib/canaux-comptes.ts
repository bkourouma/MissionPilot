/** Sous-module de `canaux.ts` : droits d'affichage et comptes de canal. */
import {
  aPermission,
  creerTraduire,
  type CanalMessagerie,
  type CompteCanalApi,
  type Langue,
  type Role,
} from "@missionpilot/shared";
import { avecReconfirmation, type SaisieConfirmation } from "./double-authentification";
import type { Resultat } from "./saisie";

// --- Droits (confort d'affichage) ------------------------------------------------------------

export interface DroitsCanaux {
  /** Voir les comptes, destinataires et le journal (`canaux.lire`). */
  lire: boolean;
  /** Numéros, consentements recueillis, retraits, désactivation d'un canal (`canaux.gerer`). */
  gerer: boolean;
  /** Activer un compte, options, simulateur : associé seul (`canaux.configurer`). */
  configurer: boolean;
  /** Reprendre ou rejeter une saisie de KPI reçue (`kpi.saisir`). */
  saisirKpi: boolean;
}

export function droitsCanaux(roles: readonly Role[]): DroitsCanaux {
  return {
    lire: aPermission(roles, "canaux.lire"),
    gerer: aPermission(roles, "canaux.gerer"),
    configurer: aPermission(roles, "canaux.configurer"),
    saisirKpi: aPermission(roles, "kpi.saisir"),
  };
}

// --- Comptes ---------------------------------------------------------------------------------

export const CHAMPS_OPTIONS_COMPTE = [
  "repli_sms",
  "relance_questionnaire_j10",
  "synthese_hebdo",
  "saisie_kpi",
  "alerte_kpi",
] as const;
export type ChampOptionCompte = (typeof CHAMPS_OPTIONS_COMPTE)[number];

export const LIBELLES_OPTIONS_COMPTE: Record<ChampOptionCompte, { libelle: string; aide: string }> =
  {
    repli_sms: {
      libelle: "Repli par SMS",
      aide: "Si WhatsApp refuse un message, un SMS simulé est tenté (sous réserve du consentement SMS séparé de la personne).",
    },
    relance_questionnaire_j10: {
      libelle: "Relance J+10 des questionnaires",
      aide: "Dix jours après l'envoi d'un questionnaire sans réponse, un message renvoie vers le portail.",
    },
    synthese_hebdo: {
      libelle: "Synthèse hebdomadaire du dirigeant",
      aide: "Chaque lundi, deux compteurs et un lien vers le portail ; rien n'est envoyé s'il n'y a rien à signaler.",
    },
    saisie_kpi: {
      libelle: "Saisie des KPI par message",
      aide: "Une proposition de saisie n'entre dans un indicateur qu'après reprise par un utilisateur du cabinet.",
    },
    alerte_kpi: {
      libelle: "Alertes de KPI aux responsables du cabinet",
      aide: "Un message sans valeur chiffrée prévient les responsables d'un indicateur (alerte ou mesure en retard), s'ils ont un numéro vérifié et un consentement.",
    },
  };

export const LIBELLES_OPTIONS_COMPTE_EN: Record<
  ChampOptionCompte,
  { libelle: string; aide: string }
> = {
  repli_sms: {
    libelle: "SMS fallback",
    aide: "If WhatsApp rejects a message, a simulated SMS is attempted (subject to the person's separate SMS consent).",
  },
  relance_questionnaire_j10: {
    libelle: "D+10 questionnaire reminder",
    aide: "Ten days after a questionnaire is sent with no reply, a message points back to the portal.",
  },
  synthese_hebdo: {
    libelle: "Weekly executive summary",
    aide: "Every Monday, two counters and a link to the portal; nothing is sent if there is nothing to report.",
  },
  saisie_kpi: {
    libelle: "KPI entry by message",
    aide: "A proposed entry only goes into a KPI once a firm user has taken it up.",
  },
  alerte_kpi: {
    libelle: "KPI alerts to firm managers",
    aide: "A message with no figure notifies managers about a KPI (alert or late measure), provided they have a verified number and consent.",
  },
};

/** Libellé et aide d'une option de compte dans la langue demandée. */
export function libelleOptionCompte(
  champ: ChampOptionCompte,
  langue: Langue = "fr",
): { libelle: string; aide: string } {
  return (langue === "en" ? LIBELLES_OPTIONS_COMPTE_EN : LIBELLES_OPTIONS_COMPTE)[champ];
}

/** Valeurs modifiables d'un compte (état du formulaire d'une carte). */
export interface EtatCompteEditable {
  actif: boolean;
  repli_sms: boolean;
  relance_questionnaire_j10: boolean;
  synthese_hebdo: boolean;
  saisie_kpi: boolean;
  alerte_kpi: boolean;
}

export function etatEditableDepuisCompte(c: CompteCanalApi): EtatCompteEditable {
  return {
    actif: c.actif,
    repli_sms: c.repli_sms,
    relance_questionnaire_j10: c.relance_questionnaire_j10,
    synthese_hebdo: c.synthese_hebdo,
    saisie_kpi: c.saisie_kpi,
    alerte_kpi: c.alerte_kpi,
  };
}

/** Les options ne concernent que le compte WhatsApp (SMS : seulement « Activé »). */
export const canalAvecOptions = (canal: CanalMessagerie) => canal === "whatsapp";

export function libelleEtatCompte(c: Pick<CompteCanalApi, "actif">, langue: Langue = "fr"): string {
  if (langue === "en") return c.actif ? "Enabled" : "Disabled";
  return c.actif ? "Activé" : "Désactivé";
}

/** Corps de `PUT /api/canaux/comptes/:canal` (champs modifiés seulement, reconfirmation éventuelle). */
export type ChargeCompte = Partial<EtatCompteEditable> & {
  mot_de_passe?: string;
  code?: string;
  code_secours?: string;
};

/** L'activation d'un compte exige la reconfirmation d'identité (`canal_activation`). */
export const exigeReconfirmationCompte = (
  avant: Pick<EtatCompteEditable, "actif">,
  apres: Pick<EtatCompteEditable, "actif">,
) => !avant.actif && apres.actif;

export type ChampCompte = "aucun" | "mot_de_passe" | "code";

/**
 * Charge d'enregistrement d'une carte de compte : ne contient que les champs modifiés. Un titulaire
 * de `canaux.gerer` seul (pas de `canaux.configurer`) ne peut que DÉSACTIVER (`{ actif: false }`
 * seul, coupe-circuit sans reconfirmation) ; activer ou changer une option exige l'associé.
 */
export function chargeModificationCompte(
  avant: EtatCompteEditable,
  apres: EtatCompteEditable,
  droits: Pick<DroitsCanaux, "gerer" | "configurer">,
  confirmation: SaisieConfirmation | null,
  langue: Langue = "fr",
): Resultat<ChargeCompte, ChampCompte> {
  const t = creerTraduire(langue);
  const changes: Partial<EtatCompteEditable> = {};
  for (const champ of ["actif", ...CHAMPS_OPTIONS_COMPTE] as const) {
    if (avant[champ] !== apres[champ]) changes[champ] = apres[champ];
  }
  if (Object.keys(changes).length === 0) {
    return {
      ok: false,
      erreurs: { aucun: t("Aucune modification à enregistrer.", "No changes to save.") },
    };
  }
  const desactivationSeule = Object.keys(changes).length === 1 && changes.actif === false;
  if (!droits.configurer) {
    if (!(droits.gerer && desactivationSeule)) {
      return {
        ok: false,
        erreurs: {
          aucun: t(
            "Seul un associé peut activer un canal ou changer ses options ; vous pouvez seulement le désactiver.",
            "Only a partner can enable a channel or change its options; you can only disable it.",
          ),
        },
      };
    }
    return { ok: true, charge: { actif: false } };
  }
  if (desactivationSeule) return { ok: true, charge: { actif: false } };
  if (!exigeReconfirmationCompte(avant, apres)) return { ok: true, charge: changes };
  const v = avecReconfirmation<ChargeCompte, ChampCompte>(
    { ok: true, charge: changes },
    confirmation ?? { motDePasse: "", code: "", facteur: "totp" },
  );
  return v;
}
