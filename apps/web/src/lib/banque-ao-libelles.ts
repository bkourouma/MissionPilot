import {
  aPermission,
  LIBELLES_NIVEAU_DIPLOME,
  LIBELLES_NIVEAU_LANGUE,
  LIBELLES_ROLE_REFERENCE,
  LIBELLES_SECTION_OFFRE,
  LIBELLES_TYPE_ATTESTATION,
  SECTIONS_OFFRE_TECHNIQUE,
  type Langue,
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
  libelleEn: string;
  /** Toutes exigées. */
  permissions: readonly Permission[];
}

export const SOUS_PAGES_BANQUES: readonly SousPageBanques[] = [
  {
    id: "cv",
    libelle: "Banque de CV",
    libelleEn: "CV bank",
    href: `${RACINE_BANQUES}/cv`,
    permissions: ["ao.lire"],
  },
  {
    id: "references",
    libelle: "Références",
    libelleEn: "References",
    href: `${RACINE_BANQUES}/references`,
    permissions: ["ao.lire"],
  },
  {
    id: "offres-techniques",
    libelle: "Offres techniques",
    libelleEn: "Technical bids",
    href: `${RACINE_BANQUES}/offres-techniques`,
    permissions: ["ao.lire"],
  },
  {
    id: "offres-financieres",
    libelle: "Offres financières",
    libelleEn: "Financial bids",
    href: `${RACINE_BANQUES}/offres-financieres`,
    permissions: ["ao.lire", "finance.lire"],
  },
];

export const libelleSousPageBanques = (p: SousPageBanques, langue: Langue = "fr") =>
  langue === "en" ? p.libelleEn : p.libelle;

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

export const LIBELLES_STATUT_OFFRE_EN: Record<StatutOffreTechnique, string> = {
  brouillon_ia: "AI draft",
  modifiee: "Edited",
  validee: "Approved",
};

export const libelleStatutOffre = (s: StatutOffreTechnique, langue: Langue = "fr") =>
  (langue === "en" ? LIBELLES_STATUT_OFFRE_EN : LIBELLES_STATUT_OFFRE)[s];

export function tonaliteStatutOffre(s: StatutOffreTechnique): "succes" | "attention" | "neutre" {
  if (s === "validee") return "succes";
  return s === "brouillon_ia" ? "attention" : "neutre";
}

export const LIBELLES_ORIGINE: Record<VersionOffreTechnique["origine"], string> = {
  ia: "Rédigée par l'IA",
  gabarit: "Gabarit déterministe",
  manuel: "Modification humaine",
};

export const LIBELLES_ORIGINE_EN: Record<VersionOffreTechnique["origine"], string> = {
  ia: "Written by AI",
  gabarit: "Deterministic template",
  manuel: "Human edit",
};

export const libelleOrigine = (o: VersionOffreTechnique["origine"], langue: Langue = "fr") =>
  (langue === "en" ? LIBELLES_ORIGINE_EN : LIBELLES_ORIGINE)[o];

export const LIBELLES_NIVEAU_DIPLOME_EN: Record<NiveauDiplomeAo, string> = {
  bac: "High school diploma",
  bac_2: "Bac + 2",
  bac_3: "Bac + 3 (bachelor's)",
  bac_4: "Bac + 4",
  bac_5: "Bac + 5 (master's)",
  doctorat: "Doctorate",
};

export const libelleNiveauDiplome = (n: NiveauDiplomeAo, langue: Langue = "fr") =>
  (langue === "en" ? LIBELLES_NIVEAU_DIPLOME_EN : LIBELLES_NIVEAU_DIPLOME)[n];

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
export const LIBELLES_NIVEAU_LANGUE_EN: Record<NiveauLangueAo, string> = {
  notions: "Basic",
  courant: "Fluent",
  bilingue: "Bilingual",
  maternelle: "Native",
};
export const libelleNiveauLangue = (n: NiveauLangueAo, langue: Langue = "fr") =>
  (langue === "en" ? LIBELLES_NIVEAU_LANGUE_EN : LIBELLES_NIVEAU_LANGUE)[n];

export const LIBELLES_ROLE_REFERENCE_EN: Record<keyof typeof LIBELLES_ROLE_REFERENCE, string> = {
  seul: "Sole firm",
  chef_de_file: "Lead of a consortium",
  membre: "Consortium member",
  sous_traitant: "Subcontractor",
};
export const libelleRoleReference = (
  r: keyof typeof LIBELLES_ROLE_REFERENCE,
  langue: Langue = "fr",
) => (langue === "en" ? LIBELLES_ROLE_REFERENCE_EN : LIBELLES_ROLE_REFERENCE)[r];

export const LIBELLES_TYPE_ATTESTATION_EN: Record<keyof typeof LIBELLES_TYPE_ATTESTATION, string> =
  {
    attestation_bonne_execution: "Certificate of satisfactory performance",
    proces_verbal_reception: "Acceptance report",
    contrat: "Contract",
    autre: "Other document",
  };
export const libelleTypeAttestation = (
  t: keyof typeof LIBELLES_TYPE_ATTESTATION,
  langue: Langue = "fr",
) => (langue === "en" ? LIBELLES_TYPE_ATTESTATION_EN : LIBELLES_TYPE_ATTESTATION)[t];

export const LIBELLES_SECTION_OFFRE_EN: Record<SectionOffreTechnique, string> = {
  comprehension: "Understanding of the terms of reference",
  methodologie: "Methodology",
  planning: "Schedule",
  organisation: "Organization and team",
};
export const libelleSection = (s: SectionOffreTechnique, langue: Langue = "fr") =>
  (langue === "en" ? LIBELLES_SECTION_OFFRE_EN : LIBELLES_SECTION_OFFRE)[s];
export { SECTIONS_OFFRE_TECHNIQUE };

const LIBELLES_CRITERE: Record<string, string> = {
  annees_experience: "Années d'expérience",
  annees_secteur: "Années dans le secteur",
  diplome: "Diplôme",
  langue: "Langue",
  experiences_bailleur: "Expériences auprès du bailleur",
};
const LIBELLES_CRITERE_EN: Record<string, string> = {
  annees_experience: "Years of experience",
  annees_secteur: "Years in the sector",
  diplome: "Degree",
  langue: "Language",
  experiences_bailleur: "Experience with the donor",
};
export const libelleCritere = (c: CritereControle, langue: Langue = "fr") => {
  const en = langue === "en";
  const base = (en ? LIBELLES_CRITERE_EN : LIBELLES_CRITERE)[c.code] ?? c.code;
  return c.objet ? `${base}${en ? ":" : " :"} ${c.objet}` : base;
};

/** Remplace un code de niveau (diplôme ou langue) par son libellé français, au début de la valeur. */
function habillerNiveau(code: string, valeur: string, langue: Langue): string {
  if (code === "diplome") {
    return valeur.replace(/^(bac_[2-5]|bac|doctorat)(?=$| )/, (n) =>
      n in LIBELLES_COURTS_DIPLOME
        ? n === "doctorat" && langue === "en"
          ? "Doctorate"
          : LIBELLES_COURTS_DIPLOME[n as NiveauDiplomeAo]
        : n,
    );
  }
  if (code === "langue") {
    return valeur in LIBELLES_NIVEAU_LANGUE
      ? libelleNiveauLangue(valeur as NiveauLangueAo, langue)
      : valeur;
  }
  return valeur;
}

/** Valeur exigée ou constatée d'un critère, en français (jamais « bac_5 » ni un code de niveau). */
export const valeurCritere = (
  c: CritereControle,
  quoi: "exige" | "constate",
  langue: Langue = "fr",
) => habillerNiveau(c.code, c[quoi], langue);

/** Mois « AAAA-MM » → « MM/AAAA » ; null → « en cours ». */
export function moisAffiche(mois: string | null, langue: Langue = "fr"): string {
  if (mois === null) return langue === "en" ? "ongoing" : "en cours";
  return /^\d{4}-\d{2}$/.test(mois) ? `${mois.slice(5, 7)}/${mois.slice(0, 4)}` : mois;
}

/** Jours en centièmes (API) → « 12,5 j ». Affichage seulement. */
export const joursAffiches = (centiemes: number, langue: Langue = "fr") =>
  `${formaterNombre(centiemes / 100, 2, langue)} ${langue === "en" ? "d" : "j"}`;
