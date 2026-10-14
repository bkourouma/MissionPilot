/**
 * Gabarits à données minimales (lot 3c, SPEC §9.4). Catalogue FERMÉ : aucun type de variable de
 * texte libre (seuls le nom du cabinet, un lien relatif du portail, des nombres et, pour les
 * réponses de service seulement, un libellé court de KPI). Aucun nom, titre, montant ni score
 * ne traverse un canal externe. Les textes sont PROVISOIRES (O-19), à faire valider par le
 * métier puis par Meta.
 */
import { ErreurCanaux } from "./erreurs";
import { type CategorieEnvoi } from "./autorisation";

export const TYPES_VARIABLE_CANAL = [
  "code_otp",
  "compte",
  "nom_cabinet",
  "lien_portail",
  "libelle_court",
  "valeur_kpi",
  "nombre_decimal",
] as const;
export type TypeVariableCanal = (typeof TYPES_VARIABLE_CANAL)[number];

export const CODES_GABARIT = [
  "verification_numero",
  "relance_questionnaire_j10",
  "synthese_hebdo",
  "signature_a_effectuer",
  "alerte_kpi",
  "reponse_stop",
  "reponse_saisie_a_confirmer",
  "reponse_saisie_a_verifier",
  "reponse_saisie_enregistree",
  "reponse_saisie_refusee",
  "reponse_non_comprise",
] as const;
export type CodeGabarit = (typeof CODES_GABARIT)[number];

export interface GabaritCanal {
  readonly code: CodeGabarit;
  readonly categorie: CategorieEnvoi;
  /** Texte français ; `{1}`, `{2}`… désignent les variables positionnelles (base 1). */
  readonly texte: string;
  readonly variables: readonly TypeVariableCanal[];
  /** Variante SMS (GSM-7 sans accent, 160 caractères au plus) : relance, synthèse, signature, alerte. */
  readonly varianteSms?: string;
}

/** Catalogue fermé des gabarits (SPEC §9.4). */
export const GABARITS_CANAL: Readonly<Record<CodeGabarit, GabaritCanal>> = {
  verification_numero: {
    code: "verification_numero",
    categorie: "verification",
    texte:
      "Votre code de vérification MissionPilot est {1}. Il expire dans 10 minutes. Ne le communiquez à personne.",
    variables: ["code_otp"],
  },
  relance_questionnaire_j10: {
    code: "relance_questionnaire_j10",
    categorie: "relance",
    texte:
      "{1} vous rappelle qu'un questionnaire attend votre réponse. Ouvrez votre espace : {2} Pour ne plus recevoir ces messages, répondez STOP.",
    variables: ["nom_cabinet", "lien_portail"],
    varianteSms: "MissionPilot : un questionnaire attend votre reponse : {2} STOP pour arreter",
  },
  synthese_hebdo: {
    code: "synthese_hebdo",
    categorie: "synthese",
    texte:
      "{1} : votre synthèse de la semaine est prête ({2} point(s) d'attention, {3} décision(s) attendue(s)). Consultez-la : {4} STOP pour vous désabonner.",
    variables: ["nom_cabinet", "compte", "compte", "lien_portail"],
    varianteSms:
      "MissionPilot : synthese de la semaine ({2} point(s) d'attention, {3} decision(s)) : {4} STOP pour arreter",
  },
  signature_a_effectuer: {
    code: "signature_a_effectuer",
    categorie: "signature",
    texte:
      "{1} : un document attend votre signature. Ouvrez votre espace : {2} STOP pour vous désabonner.",
    variables: ["nom_cabinet", "lien_portail"],
    varianteSms: "MissionPilot : un document attend votre signature : {2} STOP pour arreter",
  },
  alerte_kpi: {
    code: "alerte_kpi",
    categorie: "alerte",
    texte:
      "{1} : un indicateur de votre tableau de bord demande votre attention. Ouvrez votre espace : {2} STOP pour vous désabonner.",
    variables: ["nom_cabinet", "lien_portail"],
    varianteSms: "MissionPilot : un indicateur demande votre attention : {2} STOP pour arreter",
  },
  reponse_stop: {
    code: "reponse_stop",
    categorie: "reponse_service",
    texte:
      "Vous ne recevrez plus de messages WhatsApp de {1}. Vous pourrez les réactiver depuis votre espace.",
    variables: ["nom_cabinet"],
  },
  reponse_saisie_a_confirmer: {
    code: "reponse_saisie_a_confirmer",
    categorie: "reponse_service",
    texte: "Saisie reçue : « {1} » = {2}. Répondez OUI pour confirmer ou NON pour annuler.",
    variables: ["libelle_court", "valeur_kpi"],
  },
  reponse_saisie_a_verifier: {
    code: "reponse_saisie_a_verifier",
    categorie: "reponse_service",
    texte:
      "Valeur inhabituelle pour « {1} » : {2}. Pour confirmer, répondez OUI {2}. Sinon répondez NON.",
    variables: ["libelle_court", "valeur_kpi"],
  },
  reponse_saisie_enregistree: {
    code: "reponse_saisie_enregistree",
    categorie: "reponse_service",
    texte: "Merci : votre saisie est transmise à votre cabinet pour validation.",
    variables: [],
  },
  reponse_saisie_refusee: {
    code: "reponse_saisie_refusee",
    categorie: "reponse_service",
    texte:
      "Cette valeur ne peut pas être prise en compte par message. Saisissez-la depuis votre espace.",
    variables: [],
  },
  reponse_non_comprise: {
    code: "reponse_non_comprise",
    categorie: "reponse_service",
    texte:
      "Message non compris. Pour une saisie : « <indicateur> <valeur> ». STOP pour vous désabonner.",
    variables: [],
  },
};

/** Longueur maximale d'un texte de gabarit WhatsApp rendu (limite d'un corps de gabarit). */
export const GABARIT_LONGUEUR_MAX = 1024;
/** Longueur maximale d'un SMS (GSM-7, un seul segment). */
export const SMS_LONGUEUR_MAX = 160;
/** Plus grand nombre affiché dans un message (au-delà : 999). */
export const COMPTE_MESSAGE_MAX = 999;

/** Alphabet GSM-7 de base, SANS accents ni caractères étendus (hors espace et fins de ligne). */
const GSM7_BASE = /^[A-Za-z0-9 @$_!"#%&'()*+,\-./:;<=>?\r\n]*$/;

/** Vrai si le texte tient dans l'alphabet GSM-7 de base sans accent ni caractère étendu. */
export function estGsm7(texte: string): boolean {
  return GSM7_BASE.test(texte);
}

export interface VariablesGabarit {
  readonly [position: number]: string | number | undefined;
}

export interface GabaritRendu {
  readonly texte: string;
  readonly longueur: number;
  /** Variables validées, positionnelles (le port les envoie avec le code du gabarit). */
  readonly variables: readonly string[];
}

// eslint-disable-next-line no-control-regex
const CONTROLES = /[\u0000-\u001f\u007f]/;
const LIEN_PORTAIL = /^\/portail\/[A-Za-z0-9\-._~/?=&%#]*$/;
const DECIMAL = /^-?(0|[1-9]\d{0,14})(\.\d{1,6})?$/;
const NOMBRE_DECIMAL = /^(0|[1-9]\d{0,8})(\.\d{1,6})?$/;
const ORIGINE_WEB = /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/;

function texteCourt(valeur: string, max: number): string {
  const v = valeur.trim();
  if (v.length < 1 || v.length > max || CONTROLES.test(v))
    throw new ErreurCanaux("VARIABLE_INVALIDE");
  return v;
}

function valider(type: TypeVariableCanal, brut: string | number | undefined): string {
  if (brut === undefined || brut === null) throw new ErreurCanaux("VARIABLE_INVALIDE");
  const valeur = typeof brut === "number" ? String(brut) : brut;
  if (typeof valeur !== "string") throw new ErreurCanaux("VARIABLE_INVALIDE");
  switch (type) {
    case "code_otp":
      if (!/^\d{6}$/.test(valeur)) throw new ErreurCanaux("VARIABLE_INVALIDE");
      return valeur;
    case "compte": {
      if (!/^\d{1,15}$/.test(valeur)) throw new ErreurCanaux("VARIABLE_INVALIDE");
      return String(Math.min(Number(valeur), COMPTE_MESSAGE_MAX));
    }
    case "nom_cabinet":
      return texteCourt(valeur, 60);
    case "libelle_court":
      return texteCourt(valeur, 40);
    case "lien_portail":
      // Chemin relatif du portail : jamais un lien absolu ni une URL externe.
      if (
        valeur.length > 300 ||
        !LIEN_PORTAIL.test(valeur) ||
        valeur.includes("//") ||
        valeur.split(/[/?#]/).includes("..")
      ) {
        throw new ErreurCanaux("VARIABLE_INVALIDE");
      }
      return valeur;
    case "valeur_kpi":
      if (!DECIMAL.test(valeur) || valeur === "-0") throw new ErreurCanaux("VARIABLE_INVALIDE");
      return valeur;
    case "nombre_decimal":
      if (!NOMBRE_DECIMAL.test(valeur)) throw new ErreurCanaux("VARIABLE_INVALIDE");
      return valeur;
  }
}

function lire(variables: VariablesGabarit | readonly (string | number)[], position: number) {
  // Un tableau est positionnel à partir de zéro, un objet à partir de 1.
  return Array.isArray(variables)
    ? (variables as readonly (string | number | undefined)[])[position - 1]
    : (variables as VariablesGabarit)[position];
}

function origine(origineWeb: string): string {
  const o = origineWeb.replace(/\/+$/, "");
  if (!ORIGINE_WEB.test(o)) throw new ErreurCanaux("ORIGINE_INVALIDE");
  return o;
}

function rendre(
  gabarit: GabaritCanal,
  modele: string,
  variables: VariablesGabarit | readonly (string | number)[],
  origineWeb: string,
): GabaritRendu {
  const racine = origine(origineWeb);
  const nombre = gabarit.variables.length;
  const fournies = Array.isArray(variables)
    ? variables.length
    : Object.keys(variables).filter((k) => /^\d+$/.test(k)).length;
  if (fournies !== nombre) throw new ErreurCanaux("VARIABLE_INVALIDE");
  const valeurs: string[] = [];
  gabarit.variables.forEach((type, i) => {
    if (type === "libelle_court" && gabarit.categorie !== "reponse_service") {
      throw new ErreurCanaux("VARIABLE_INVALIDE");
    }
    valeurs.push(valider(type, lire(variables, i + 1)));
  });
  // Une seule passe : une valeur qui contient « {2} » n'est jamais re-substituée.
  const texte = modele.replace(/\{(\d+)\}/g, (_, n: string) => {
    const i = Number(n) - 1;
    const valeur = valeurs[i];
    if (valeur === undefined) throw new ErreurCanaux("VARIABLE_INVALIDE");
    return gabarit.variables[i] === "lien_portail" ? `${racine}${valeur}` : valeur;
  });
  return { texte, longueur: texte.length, variables: valeurs };
}

/**
 * Rend le texte WhatsApp d'un gabarit. `variables` : `{ 1: …, 2: … }` (base 1) ou tableau
 * positionnel ; le nombre de variables doit être exact. Le lien du portail est un chemin relatif
 * qui reçoit `origineWeb` (ex. `http://localhost:3100`). Lève `ErreurCanaux` (`VARIABLE_INVALIDE`,
 * `GABARIT_INCONNU`, `ORIGINE_INVALIDE`, `TEXTE_TROP_LONG`).
 */
export function rendreGabaritCanal(
  code: CodeGabarit,
  variables: VariablesGabarit | readonly (string | number)[],
  origineWeb: string,
): GabaritRendu {
  const gabarit = Object.hasOwn(GABARITS_CANAL, code) ? GABARITS_CANAL[code] : undefined;
  if (!gabarit) throw new ErreurCanaux("GABARIT_INCONNU");
  const rendu = rendre(gabarit, gabarit.texte, variables, origineWeb);
  if (rendu.longueur > GABARIT_LONGUEUR_MAX) throw new ErreurCanaux("TEXTE_TROP_LONG");
  return rendu;
}

/**
 * Rend la variante SMS (relance, synthèse, signature, alerte seulement) : GSM-7 sans accent,
 * 160 caractères au plus (`SMS_TROP_LONG` sinon). Mêmes variables, même numérotation que le
 * gabarit WhatsApp.
 */
export function rendreVarianteSms(
  code: CodeGabarit,
  variables: VariablesGabarit | readonly (string | number)[],
  origineWeb: string,
): GabaritRendu {
  const gabarit = Object.hasOwn(GABARITS_CANAL, code) ? GABARITS_CANAL[code] : undefined;
  if (!gabarit) throw new ErreurCanaux("GABARIT_INCONNU");
  if (gabarit.varianteSms === undefined) throw new ErreurCanaux("VARIANTE_SMS_ABSENTE");
  const rendu = rendre(gabarit, gabarit.varianteSms, variables, origineWeb);
  if (rendu.longueur > SMS_LONGUEUR_MAX || !estGsm7(rendu.texte)) {
    throw new ErreurCanaux("SMS_TROP_LONG");
  }
  return rendu;
}
