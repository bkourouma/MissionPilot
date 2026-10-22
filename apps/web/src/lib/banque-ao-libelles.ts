import {
  aPermission,
  LIBELLES_NIVEAU_DIPLOME,
  LIBELLES_NIVEAU_LANGUE,
  LIBELLES_ROLE_REFERENCE,
  LIBELLES_SECTION_OFFRE,
  LIBELLES_TYPE_ATTESTATION,
  SECTIONS_OFFRE_TECHNIQUE,
  type NiveauDiplomeAo,
  type NiveauLangueAo,
  type Permission,
  type Role,
  type SectionOffreTechnique,
} from "@missionpilot/shared";
import { formaterNombre } from "./format";
import {
  RACINE_BANQUES,
  type CritereControle,
  type StatutOffreTechnique,
  type VersionOffreTechnique,
} from "./banque-ao-types";

/* ----- Navigation et droits ----- */

export interface SousPageBanques {
  id: string;
  libelle: string;
  href: string;
  /** Toutes exigées. */
  permissions: readonly Permission[];
}

export const SOUS_PAGES_BANQUES: readonly SousPageBanques[] = [
  { id: "cv", libelle: "Banque de CV", href: `${RACINE_BANQUES}/cv`, permissions: ["ao.lire"] },
  {
    id: "references",
    libelle: "Références",
    href: `${RACINE_BANQUES}/references`,
    permissions: ["ao.lire"],
  },
  {
    id: "offres-techniques",
    libelle: "Offres techniques",
    href: `${RACINE_BANQUES}/offres-techniques`,
    permissions: ["ao.lire"],
  },
  {
    id: "offres-financieres",
    libelle: "Offres financières",
    href: `${RACINE_BANQUES}/offres-financieres`,
    permissions: ["ao.lire", "finance.lire"],
  },
];

export function sousPagesBanques(roles: readonly Role[]): SousPageBanques[] {
  return SOUS_PAGES_BANQUES.filter((p) => p.permissions.every((x) => aPermission(roles, x)));
}

/** Droits d'affichage (confort : l'API refuse de toute façon). */
export function droitsBanqueAo(roles: readonly Role[]) {
  const finance = aPermission(roles, "ao.lire") && aPermission(roles, "finance.lire");
  return {
    lire: aPermission(roles, "ao.lire"),
    gerer: aPermission(roles, "ao.gerer"),
    /** Offre financière (FIN-02). */
    lireFinance: finance,
    ecrireFinance: finance && aPermission(roles, "taux.gerer"),
    redigerIa: aPermission(roles, "ao.gerer") && aPermission(roles, "ia.utiliser"),
    lierMethode: aPermission(roles, "standard.lire"),
    /** Anonymisation irréversible d'un CV (reconfirmation d'identité côté API). */
    anonymiser: aPermission(roles, "cabinet.gerer"),
  };
}

/* ----- Libellés ----- */

export const LIBELLES_STATUT_OFFRE: Record<StatutOffreTechnique, string> = {
  brouillon_ia: "Brouillon IA",
  modifiee: "Modifiée",
  validee: "Validée",
};

export function tonaliteStatutOffre(s: StatutOffreTechnique): "succes" | "attention" | "neutre" {
  if (s === "validee") return "succes";
  return s === "brouillon_ia" ? "attention" : "neutre";
}

export const LIBELLES_ORIGINE: Record<VersionOffreTechnique["origine"], string> = {
  ia: "Rédigée par l'IA",
  gabarit: "Gabarit déterministe",
  manuel: "Modification humaine",
};

export const libelleNiveauDiplome = (n: NiveauDiplomeAo) => LIBELLES_NIVEAU_DIPLOME[n];

/**
 * Libellés COURTS des niveaux de diplôme (affichage dans une phrase, saisie d'une ligne de
 * diplôme) : le code technique (« bac_5 ») n'apparaît jamais à l'écran. Chaque libellé en minuscules
 * est relu par `lireNiveauDiplome` (« bac+5 »).
 */
export const LIBELLES_COURTS_DIPLOME: Record<NiveauDiplomeAo, string> = {
  bac: "Bac",
  bac_2: "Bac+2",
  bac_3: "Bac+3",
  bac_4: "Bac+4",
  bac_5: "Bac+5",
  doctorat: "Doctorat",
};

/** Niveau de diplôme pour une ligne de saisie : « bac+5 » (relu par `lireNiveauDiplome`). */
export const saisieNiveauDiplome = (n: NiveauDiplomeAo) =>
  (LIBELLES_COURTS_DIPLOME[n] ?? n).toLowerCase();
export const libelleNiveauLangue = (n: NiveauLangueAo) => LIBELLES_NIVEAU_LANGUE[n];
export const libelleRoleReference = (r: keyof typeof LIBELLES_ROLE_REFERENCE) =>
  LIBELLES_ROLE_REFERENCE[r];
export const libelleTypeAttestation = (t: keyof typeof LIBELLES_TYPE_ATTESTATION) =>
  LIBELLES_TYPE_ATTESTATION[t];
export const libelleSection = (s: SectionOffreTechnique) => LIBELLES_SECTION_OFFRE[s];
export { SECTIONS_OFFRE_TECHNIQUE };

const LIBELLES_CRITERE: Record<string, string> = {
  annees_experience: "Années d'expérience",
  annees_secteur: "Années dans le secteur",
  diplome: "Diplôme",
  langue: "Langue",
  experiences_bailleur: "Expériences auprès du bailleur",
};
export const libelleCritere = (c: CritereControle) =>
  c.objet
    ? `${LIBELLES_CRITERE[c.code] ?? c.code} : ${c.objet}`
    : (LIBELLES_CRITERE[c.code] ?? c.code);

/** Remplace un code de niveau (diplôme ou langue) par son libellé français, au début de la valeur. */
function habillerNiveau(code: string, valeur: string): string {
  if (code === "diplome") {
    return valeur.replace(/^(bac_[2-5]|bac|doctorat)(?=$| )/, (n) =>
      n in LIBELLES_COURTS_DIPLOME ? LIBELLES_COURTS_DIPLOME[n as NiveauDiplomeAo] : n,
    );
  }
  if (code === "langue") {
    return valeur in LIBELLES_NIVEAU_LANGUE
      ? LIBELLES_NIVEAU_LANGUE[valeur as NiveauLangueAo]
      : valeur;
  }
  return valeur;
}

/** Valeur exigée ou constatée d'un critère, en français (jamais « bac_5 » ni un code de niveau). */
export const valeurCritere = (c: CritereControle, quoi: "exige" | "constate") =>
  habillerNiveau(c.code, c[quoi]);

/** Mois « AAAA-MM » → « MM/AAAA » ; null → « en cours ». */
export function moisAffiche(mois: string | null): string {
  if (mois === null) return "en cours";
  return /^\d{4}-\d{2}$/.test(mois) ? `${mois.slice(5, 7)}/${mois.slice(0, 4)}` : mois;
}

/** Jours en centièmes (API) → « 12,5 j ». Affichage seulement. */
export const joursAffiches = (centiemes: number) => `${formaterNombre(centiemes / 100, 2)} j`;
