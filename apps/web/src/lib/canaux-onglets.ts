/** Sous-module de `canaux.ts` : navigation de la rubrique. */
import { estObjet } from "./canaux-utilitaires";
import {
  CHEMIN_PARAMETRES_CANAUX,
  CHEMIN_CANAUX_DESTINATAIRES,
  CHEMIN_CANAUX_JOURNAL,
  CHEMIN_CANAUX_SAISIES,
  CHEMIN_CANAUX_SIMULATEUR,
} from "./canaux-chemins";
import {
  type DroitsCanaux,
  type ChampOptionCompte,
  type EtatCompteEditable,
} from "./canaux-comptes";

// --- Navigation de la rubrique ---------------------------------------------------------------

export interface OngletCanaux {
  id: string;
  libelle: string;
  href: string;
}

/** Onglets de `/parametres/canaux` selon les droits et le mode (simulateur : associé, mode simulé). */
export function ongletsCanaux(droits: DroitsCanaux, options: { simule: boolean }): OngletCanaux[] {
  const onglets: OngletCanaux[] = [];
  if (droits.lire) {
    onglets.push(
      { id: "comptes", libelle: "Comptes", href: CHEMIN_PARAMETRES_CANAUX },
      {
        id: "destinataires",
        libelle: "Destinataires et consentements",
        href: CHEMIN_CANAUX_DESTINATAIRES,
      },
      { id: "journal", libelle: "Journal des envois", href: CHEMIN_CANAUX_JOURNAL },
    );
  }
  if (droits.lire && droits.saisirKpi) {
    onglets.push({ id: "saisies", libelle: "Saisies reçues", href: CHEMIN_CANAUX_SAISIES });
  }
  if (droits.configurer && options.simule) {
    onglets.push({
      id: "simulateur",
      libelle: "Simulateur (développement)",
      href: CHEMIN_CANAUX_SIMULATEUR,
    });
  }
  return onglets;
}

/**
 * État d'une carte de compte après un enregistrement : la réponse de l'API quand elle décrit le
 * compte, sinon les valeurs envoyées (l'enregistrement a réussi).
 */
export function etatApresEnregistrement(
  reponse: unknown,
  repli: EtatCompteEditable,
): EtatCompteEditable {
  if (estObjet(reponse) && typeof reponse.actif === "boolean") {
    const lit = (cle: ChampOptionCompte) =>
      typeof reponse[cle] === "boolean" ? (reponse[cle] as boolean) : repli[cle];
    return {
      actif: reponse.actif,
      repli_sms: lit("repli_sms"),
      relance_questionnaire_j10: lit("relance_questionnaire_j10"),
      synthese_hebdo: lit("synthese_hebdo"),
      saisie_kpi: lit("saisie_kpi"),
      alerte_kpi: lit("alerte_kpi"),
    };
  }
  return repli;
}
