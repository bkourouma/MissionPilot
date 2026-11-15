/**
 * Saisies des écrans du registre des preuves (preuve, correction, assertion, lien, arbitrage,
 * dimension) : lecture des textes saisis et contrôles AVANT l'appel, avec des messages français.
 * Logique pure, testée dans `preuves-saisie.test.ts`.
 *
 * Les règles reprennent le schéma partagé (`packages/shared/src/schemas/preuves.ts`) et les
 * contraintes de la base (migrations 0240 à 0242) pour éviter un aller-retour refusé ; l'API
 * reste seule juge. Aucun indice n'est saisi ni calculé ici.
 */
import {
  DECISIONS_ARBITRAGE,
  DIMENSIONS_PAR_PREUVE_MAX,
  FIABILITES_PREUVE,
  RATTACHEMENTS_ASSERTION,
  SENS_PREUVE,
  STATUTS_ASSERTION,
  TYPES_SOURCE_PREUVE,
  CLASSES_RISQUE,
  creerTraduire,
  type DecisionArbitrage,
  type Langue,
  type RattachementAssertion,
  type StatutAssertion,
  type TypeSourcePreuve,
} from "@missionpilot/shared";
import { estIdentifiant } from "./identifiant";
import { dateValide } from "./periode";
import type { ClasseRisqueApi, FiabiliteApi, SensApi } from "./preuves";
import type { Resultat } from "./saisie";

export const SOURCE_MAX = 300;
export const EXTRAIT_MAX = 4000;
export const MOTIF_PREUVE_MAX = 500;
export const ENONCE_MAX = 2000;
export const LIVRABLE_MAX = 200;
export const RATTACHEMENT_CODE_MAX = 120;
export const AVIS_MOTIF_MAX = 1000;
export const ARBITRAGE_MOTIF_MAX = 1000;
export const LIBELLE_DIMENSION_MAX = 200;
export const CODE_DIMENSION_MAX = 120;

const CODE_DIMENSION = /^[a-z0-9_.-]{1,120}$/;

export type TypeLienPreuve = "aucun" | "fichier" | "reponse" | "document";

// --- Preuve ---------------------------------------------------------------------------------

export interface SaisiePreuve {
  type_source: string;
  source_precise: string;
  date_preuve: string;
  auteur_id: string;
  fiabilite: string;
  extrait: string;
  lien_type: TypeLienPreuve;
  lien_id: string;
  dimensions: string[];
  nominatif: boolean;
  accord_nominatif: boolean;
  /** Correction seulement : pourquoi cette nouvelle version. */
  motif: string;
}

export type ChampPreuve = keyof SaisiePreuve;

export interface ChargePreuve {
  type_source: TypeSourcePreuve;
  source_precise: string;
  date_preuve: string;
  auteur_id?: string;
  fiabilite: FiabiliteApi;
  extrait: string | null;
  fichier_id: string | null;
  reponse_id: string | null;
  document_id: string | null;
  dimensions: string[];
  nominatif: boolean;
  accord_nominatif: boolean;
  motif?: string;
}

export function saisiePreuveVide(aujourdhui: string, auteurId = ""): SaisiePreuve {
  return {
    type_source: "",
    source_precise: "",
    date_preuve: aujourdhui,
    auteur_id: auteurId,
    fiabilite: "",
    extrait: "",
    lien_type: "aucun",
    lien_id: "",
    dimensions: [],
    nominatif: false,
    accord_nominatif: false,
    motif: "",
  };
}

const estDans = <T extends string>(liste: readonly T[], v: string): v is T =>
  (liste as readonly string[]).includes(v);

/** Validation d'une preuve (création) ou de sa nouvelle version (`correction` : motif exigé). */
export function validerPreuve(
  s: SaisiePreuve,
  correction: boolean,
  langue: Langue = "fr",
): Resultat<ChargePreuve, ChampPreuve> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampPreuve, string>> = {};
  if (!estDans(TYPES_SOURCE_PREUVE, s.type_source))
    erreurs.type_source = t("Choisissez le type de source.", "Choose the source type.");
  const source = s.source_precise.trim();
  if (source === "")
    erreurs.source_precise = t(
      "Précisez la source (qui, quoi, où).",
      "Specify the source (who, what, where).",
    );
  else if (source.length > SOURCE_MAX)
    erreurs.source_precise = t(
      `${SOURCE_MAX} caractères au plus.`,
      `${SOURCE_MAX} characters at most.`,
    );
  if (s.date_preuve === "")
    erreurs.date_preuve = t("La date est obligatoire.", "The date is required.");
  else if (!dateValide(s.date_preuve)) erreurs.date_preuve = t("Date invalide.", "Invalid date.");
  if (!estDans(FIABILITES_PREUVE, s.fiabilite))
    erreurs.fiabilite = t("Choisissez la fiabilité (A à D).", "Choose the reliability (A to D).");
  const extrait = s.extrait.trim();
  if (extrait.length > EXTRAIT_MAX)
    erreurs.extrait = t(`${EXTRAIT_MAX} caractères au plus.`, `${EXTRAIT_MAX} characters at most.`);
  if (s.auteur_id !== "" && !estIdentifiant(s.auteur_id))
    erreurs.auteur_id = t("Auteur invalide.", "Invalid author.");
  if (s.lien_type !== "aucun") {
    const id = s.lien_id.trim();
    if (id === "")
      erreurs.lien_id = t(
        "Indiquez l'identifiant de l'élément lié, ou choisissez « Aucun ».",
        'Enter the ID of the linked item, or choose "None".',
      );
    else if (!estIdentifiant(id)) erreurs.lien_id = t("Identifiant invalide.", "Invalid ID.");
  }
  if (s.dimensions.length > DIMENSIONS_PAR_PREUVE_MAX) {
    erreurs.dimensions = t(
      `${DIMENSIONS_PAR_PREUVE_MAX} dimensions au plus.`,
      `${DIMENSIONS_PAR_PREUVE_MAX} dimensions at most.`,
    );
  }
  if (s.accord_nominatif && !s.nominatif) {
    erreurs.accord_nominatif = t(
      "L'accord ne s'applique qu'à un extrait nominatif.",
      "Consent only applies to a named excerpt.",
    );
  }
  const motif = s.motif.trim();
  if (correction && motif === "")
    erreurs.motif = t(
      "Expliquez pourquoi vous corrigez cette preuve.",
      "Explain why you are correcting this evidence.",
    );
  else if (motif.length > MOTIF_PREUVE_MAX)
    erreurs.motif = t(
      `${MOTIF_PREUVE_MAX} caractères au plus.`,
      `${MOTIF_PREUVE_MAX} characters at most.`,
    );
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  const lien = s.lien_id.trim();
  return {
    ok: true,
    charge: {
      type_source: s.type_source as TypeSourcePreuve,
      source_precise: source,
      date_preuve: s.date_preuve,
      ...(s.auteur_id !== "" ? { auteur_id: s.auteur_id } : {}),
      fiabilite: s.fiabilite as FiabiliteApi,
      extrait: extrait === "" ? null : extrait,
      fichier_id: s.lien_type === "fichier" ? lien : null,
      reponse_id: s.lien_type === "reponse" ? lien : null,
      document_id: s.lien_type === "document" ? lien : null,
      dimensions: [...new Set(s.dimensions)],
      nominatif: s.nominatif,
      accord_nominatif: s.nominatif && s.accord_nominatif,
      ...(correction ? { motif } : {}),
    },
  };
}

// --- Assertion ------------------------------------------------------------------------------

export interface SaisieAssertion {
  enonce: string;
  rattachement_type: string;
  rattachement_code: string;
  livrable: string;
  classe_risque: string;
  statut: string;
  avis_expert: boolean;
  avis_expert_motif: string;
  signer_avis: boolean;
  /** Correction seulement. */
  motif: string;
}

export type ChampAssertion = keyof SaisieAssertion;

export interface ChargeAssertion {
  enonce: string;
  rattachement_type: RattachementAssertion | null;
  rattachement_code: string | null;
  livrable: string | null;
  classe_risque: ClasseRisqueApi;
  statut: StatutAssertion;
  avis_expert: boolean;
  avis_expert_motif: string | null;
  signer_avis: boolean;
  motif?: string;
}

export function saisieAssertionVide(): SaisieAssertion {
  return {
    enonce: "",
    rattachement_type: "",
    rattachement_code: "",
    livrable: "",
    classe_risque: "",
    statut: "brouillon",
    avis_expert: false,
    avis_expert_motif: "",
    signer_avis: false,
    motif: "",
  };
}

export function validerAssertion(
  s: SaisieAssertion,
  correction: boolean,
  langue: Langue = "fr",
): Resultat<ChargeAssertion, ChampAssertion> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampAssertion, string>> = {};
  const enonce = s.enonce.trim();
  if (enonce === "")
    erreurs.enonce = t(
      "Formulez l'assertion (la conclusion à écrire dans le livrable).",
      "Write the assertion (the conclusion to put in the deliverable).",
    );
  else if (enonce.length > ENONCE_MAX)
    erreurs.enonce = t(`${ENONCE_MAX} caractères au plus.`, `${ENONCE_MAX} characters at most.`);
  const code = s.rattachement_code.trim();
  if (s.rattachement_type !== "" && !estDans(RATTACHEMENTS_ASSERTION, s.rattachement_type)) {
    erreurs.rattachement_type = t("Rattachement inconnu.", "Unknown link target.");
  } else if (s.rattachement_type !== "" && code === "") {
    erreurs.rattachement_code = t(
      "Indiquez la dimension, l'hypothèse ou le risque concerné.",
      "Enter the dimension, hypothesis or risk concerned.",
    );
  } else if (s.rattachement_type === "" && code !== "") {
    erreurs.rattachement_type = t(
      "Choisissez le type de rattachement.",
      "Choose the link target type.",
    );
  } else if (code.length > RATTACHEMENT_CODE_MAX) {
    erreurs.rattachement_code = t(
      `${RATTACHEMENT_CODE_MAX} caractères au plus.`,
      `${RATTACHEMENT_CODE_MAX} characters at most.`,
    );
  }
  const livrable = s.livrable.trim();
  if (livrable.length > LIVRABLE_MAX)
    erreurs.livrable = t(
      `${LIVRABLE_MAX} caractères au plus.`,
      `${LIVRABLE_MAX} characters at most.`,
    );
  if (!estDans(CLASSES_RISQUE, s.classe_risque)) {
    erreurs.classe_risque = t(
      "Choisissez la classe de risque du livrable cible.",
      "Choose the risk class of the target deliverable.",
    );
  }
  if (!estDans(STATUTS_ASSERTION, s.statut))
    erreurs.statut = t("Statut inconnu.", "Unknown status.");
  const avis = s.avis_expert_motif.trim();
  if (s.avis_expert && avis === "")
    erreurs.avis_expert_motif = t(
      "Un avis d'expert se justifie.",
      "An expert opinion must be justified.",
    );
  else if (avis.length > AVIS_MOTIF_MAX)
    erreurs.avis_expert_motif = t(
      `${AVIS_MOTIF_MAX} caractères au plus.`,
      `${AVIS_MOTIF_MAX} characters at most.`,
    );
  const motif = s.motif.trim();
  if (correction && motif === "")
    erreurs.motif = t(
      "Expliquez pourquoi vous corrigez cette assertion.",
      "Explain why you are correcting this assertion.",
    );
  else if (motif.length > MOTIF_PREUVE_MAX)
    erreurs.motif = t(
      `${MOTIF_PREUVE_MAX} caractères au plus.`,
      `${MOTIF_PREUVE_MAX} characters at most.`,
    );
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      enonce,
      rattachement_type:
        s.rattachement_type === "" ? null : (s.rattachement_type as RattachementAssertion),
      rattachement_code: s.rattachement_type === "" ? null : code,
      livrable: livrable === "" ? null : livrable,
      classe_risque: s.classe_risque as ClasseRisqueApi,
      statut: s.statut as StatutAssertion,
      avis_expert: s.avis_expert,
      avis_expert_motif: s.avis_expert ? avis : null,
      signer_avis: s.avis_expert && s.signer_avis,
      ...(correction ? { motif } : {}),
    },
  };
}

// --- Lien et arbitrage ----------------------------------------------------------------------

export interface SaisieLien {
  preuve_id: string;
  sens: string;
}
export type ChampLien = keyof SaisieLien;

export function validerLien(
  s: SaisieLien,
  langue: Langue = "fr",
): Resultat<{ preuve_id: string; sens: SensApi }, ChampLien> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampLien, string>> = {};
  if (!estIdentifiant(s.preuve_id))
    erreurs.preuve_id = t("Choisissez la preuve à lier.", "Choose the evidence to link.");
  if (!estDans(SENS_PREUVE, s.sens))
    erreurs.sens = t(
      "Indiquez si la preuve va dans le sens de l'assertion ou contre.",
      "Indicate whether the evidence supports the assertion or goes against it.",
    );
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { preuve_id: s.preuve_id, sens: s.sens as SensApi } };
}

export interface SaisieArbitrage {
  decision: string;
  motif: string;
}
export type ChampArbitrage = keyof SaisieArbitrage;

export function validerArbitrage(
  s: SaisieArbitrage,
  preuveId: string,
  langue: Langue = "fr",
): Resultat<{ preuve_id: string; decision: DecisionArbitrage; motif: string }, ChampArbitrage> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampArbitrage, string>> = {};
  if (!estDans(DECISIONS_ARBITRAGE, s.decision))
    erreurs.decision = t("Choisissez votre décision.", "Choose your decision.");
  const motif = s.motif.trim();
  if (motif === "")
    erreurs.motif = t(
      "Motivez votre décision : elle est conservée avec votre nom.",
      "Justify your decision: it is kept with your name.",
    );
  else if (motif.length > ARBITRAGE_MOTIF_MAX)
    erreurs.motif = t(
      `${ARBITRAGE_MOTIF_MAX} caractères au plus.`,
      `${ARBITRAGE_MOTIF_MAX} characters at most.`,
    );
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: { preuve_id: preuveId, decision: s.decision as DecisionArbitrage, motif },
  };
}

// --- Dimension ------------------------------------------------------------------------------

/** « Ressources humaines » → « ressources_humaines » (accents retirés, 120 caractères au plus). */
export function codeDepuisLibelle(libelle: string): string {
  return libelle
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, CODE_DIMENSION_MAX);
}

export interface SaisieDimension {
  libelle: string;
  code: string;
}
export type ChampDimension = keyof SaisieDimension;

export function validerDimension(
  s: SaisieDimension,
  langue: Langue = "fr",
): Resultat<{ code: string; libelle: string }, ChampDimension> {
  const t = creerTraduire(langue);
  const erreurs: Partial<Record<ChampDimension, string>> = {};
  const libelle = s.libelle.trim();
  if (libelle === "")
    erreurs.libelle = t(
      "Nommez la dimension (axe d'analyse).",
      "Name the dimension (analysis axis).",
    );
  else if (libelle.length > LIBELLE_DIMENSION_MAX)
    erreurs.libelle = t(
      `${LIBELLE_DIMENSION_MAX} caractères au plus.`,
      `${LIBELLE_DIMENSION_MAX} characters at most.`,
    );
  const code = s.code.trim() === "" ? codeDepuisLibelle(libelle) : s.code.trim();
  if (libelle !== "" && !CODE_DIMENSION.test(code)) {
    erreurs.code = t(
      "Code : minuscules, chiffres, « _ », « . » et « - », 120 caractères au plus.",
      'Code: lowercase letters, digits, "_", "." and "-", 120 characters at most.',
    );
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { code, libelle } };
}
