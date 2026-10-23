/** Sous-module de `canaux.ts` : droits d'affichage et comptes de canal. */
import {
  aPermission,
  type CanalMessagerie,
  type CompteCanalApi,
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

export function libelleEtatCompte(c: Pick<CompteCanalApi, "actif">): string {
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
): Resultat<ChargeCompte, ChampCompte> {
  const changes: Partial<EtatCompteEditable> = {};
  for (const champ of ["actif", ...CHAMPS_OPTIONS_COMPTE] as const) {
    if (avant[champ] !== apres[champ]) changes[champ] = apres[champ];
  }
  if (Object.keys(changes).length === 0) {
    return { ok: false, erreurs: { aucun: "Aucune modification à enregistrer." } };
  }
  const desactivationSeule = Object.keys(changes).length === 1 && changes.actif === false;
  if (!droits.configurer) {
    if (!(droits.gerer && desactivationSeule)) {
      return {
        ok: false,
        erreurs: {
          aucun:
            "Seul un associé peut activer un canal ou changer ses options ; vous pouvez seulement le désactiver.",
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
