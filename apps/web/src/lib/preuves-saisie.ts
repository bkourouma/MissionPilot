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
  type DecisionArbitrage,
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
): Resultat<ChargePreuve, ChampPreuve> {
  const erreurs: Partial<Record<ChampPreuve, string>> = {};
  if (!estDans(TYPES_SOURCE_PREUVE, s.type_source))
    erreurs.type_source = "Choisissez le type de source.";
  const source = s.source_precise.trim();
  if (source === "") erreurs.source_precise = "Précisez la source (qui, quoi, où).";
  else if (source.length > SOURCE_MAX) erreurs.source_precise = `${SOURCE_MAX} caractères au plus.`;
  if (s.date_preuve === "") erreurs.date_preuve = "La date est obligatoire.";
  else if (!dateValide(s.date_preuve)) erreurs.date_preuve = "Date invalide.";
  if (!estDans(FIABILITES_PREUVE, s.fiabilite))
    erreurs.fiabilite = "Choisissez la fiabilité (A à D).";
  const extrait = s.extrait.trim();
  if (extrait.length > EXTRAIT_MAX) erreurs.extrait = `${EXTRAIT_MAX} caractères au plus.`;
  if (s.auteur_id !== "" && !estIdentifiant(s.auteur_id)) erreurs.auteur_id = "Auteur invalide.";
  if (s.lien_type !== "aucun") {
    const id = s.lien_id.trim();
    if (id === "")
      erreurs.lien_id = "Indiquez l'identifiant de l'élément lié, ou choisissez « Aucun ».";
    else if (!estIdentifiant(id)) erreurs.lien_id = "Identifiant invalide.";
  }
  if (s.dimensions.length > DIMENSIONS_PAR_PREUVE_MAX) {
    erreurs.dimensions = `${DIMENSIONS_PAR_PREUVE_MAX} dimensions au plus.`;
  }
  if (s.accord_nominatif && !s.nominatif) {
    erreurs.accord_nominatif = "L'accord ne s'applique qu'à un extrait nominatif.";
  }
  const motif = s.motif.trim();
  if (correction && motif === "") erreurs.motif = "Expliquez pourquoi vous corrigez cette preuve.";
  else if (motif.length > MOTIF_PREUVE_MAX)
    erreurs.motif = `${MOTIF_PREUVE_MAX} caractères au plus.`;
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
): Resultat<ChargeAssertion, ChampAssertion> {
  const erreurs: Partial<Record<ChampAssertion, string>> = {};
  const enonce = s.enonce.trim();
  if (enonce === "")
    erreurs.enonce = "Formulez l'assertion (la conclusion à écrire dans le livrable).";
  else if (enonce.length > ENONCE_MAX) erreurs.enonce = `${ENONCE_MAX} caractères au plus.`;
  const code = s.rattachement_code.trim();
  if (s.rattachement_type !== "" && !estDans(RATTACHEMENTS_ASSERTION, s.rattachement_type)) {
    erreurs.rattachement_type = "Rattachement inconnu.";
  } else if (s.rattachement_type !== "" && code === "") {
    erreurs.rattachement_code = "Indiquez la dimension, l'hypothèse ou le risque concerné.";
  } else if (s.rattachement_type === "" && code !== "") {
    erreurs.rattachement_type = "Choisissez le type de rattachement.";
  } else if (code.length > RATTACHEMENT_CODE_MAX) {
    erreurs.rattachement_code = `${RATTACHEMENT_CODE_MAX} caractères au plus.`;
  }
  const livrable = s.livrable.trim();
  if (livrable.length > LIVRABLE_MAX) erreurs.livrable = `${LIVRABLE_MAX} caractères au plus.`;
  if (!estDans(CLASSES_RISQUE, s.classe_risque)) {
    erreurs.classe_risque = "Choisissez la classe de risque du livrable cible.";
  }
  if (!estDans(STATUTS_ASSERTION, s.statut)) erreurs.statut = "Statut inconnu.";
  const avis = s.avis_expert_motif.trim();
  if (s.avis_expert && avis === "") erreurs.avis_expert_motif = "Un avis d'expert se justifie.";
  else if (avis.length > AVIS_MOTIF_MAX)
    erreurs.avis_expert_motif = `${AVIS_MOTIF_MAX} caractères au plus.`;
  const motif = s.motif.trim();
  if (correction && motif === "")
    erreurs.motif = "Expliquez pourquoi vous corrigez cette assertion.";
  else if (motif.length > MOTIF_PREUVE_MAX)
    erreurs.motif = `${MOTIF_PREUVE_MAX} caractères au plus.`;
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
): Resultat<{ preuve_id: string; sens: SensApi }, ChampLien> {
  const erreurs: Partial<Record<ChampLien, string>> = {};
  if (!estIdentifiant(s.preuve_id)) erreurs.preuve_id = "Choisissez la preuve à lier.";
  if (!estDans(SENS_PREUVE, s.sens))
    erreurs.sens = "Indiquez si la preuve va dans le sens de l'assertion ou contre.";
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
): Resultat<{ preuve_id: string; decision: DecisionArbitrage; motif: string }, ChampArbitrage> {
  const erreurs: Partial<Record<ChampArbitrage, string>> = {};
  if (!estDans(DECISIONS_ARBITRAGE, s.decision)) erreurs.decision = "Choisissez votre décision.";
  const motif = s.motif.trim();
  if (motif === "") erreurs.motif = "Motivez votre décision : elle est conservée avec votre nom.";
  else if (motif.length > ARBITRAGE_MOTIF_MAX)
    erreurs.motif = `${ARBITRAGE_MOTIF_MAX} caractères au plus.`;
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
): Resultat<{ code: string; libelle: string }, ChampDimension> {
  const erreurs: Partial<Record<ChampDimension, string>> = {};
  const libelle = s.libelle.trim();
  if (libelle === "") erreurs.libelle = "Nommez la dimension (axe d'analyse).";
  else if (libelle.length > LIBELLE_DIMENSION_MAX)
    erreurs.libelle = `${LIBELLE_DIMENSION_MAX} caractères au plus.`;
  const code = s.code.trim() === "" ? codeDepuisLibelle(libelle) : s.code.trim();
  if (libelle !== "" && !CODE_DIMENSION.test(code)) {
    erreurs.code = "Code : minuscules, chiffres, « _ », « . » et « - », 120 caractères au plus.";
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return { ok: true, charge: { code, libelle } };
}
