/**
 * Saisies des écrans de la due diligence : lecture des textes saisis et contrôles AVANT l'appel,
 * avec des messages français. Logique pure, testée dans `due-diligence-saisie.test.ts`.
 *
 * Les règles reprennent les schémas partagés (`packages/shared/src/schemas/due-diligence.ts`) pour
 * éviter un aller-retour refusé ; l'API reste seule juge. Aucun verdict proposé, aucune solidité,
 * aucun montant calculé n'est saisi ni calculé ici : ils sortent des moteurs. Les seules
 * conversions sont des LECTURES de saisie (« 25,5 » % → 2 550 points de base ; « 1 500 » FCFA → unités
 * mineures), sans flottant dans le résultat.
 */
import {
  CATEGORIES_ANALYSE_DD,
  ETATS_CONSTAT_SIGNAL,
  FAMILLES_RISQUE_DD,
  METHODES_DIMENSIONNEMENT,
  NIVEAUX_ES,
  NIVEAUX_RISQUE_DD,
  PARAMETRES_DIMENSIONNEMENT,
  PLAFONDS_DD,
  RECOMMANDATIONS_NOTE,
  SENS_LIEN_DD,
  STATUTS_ACTION_100J,
  THEMES_ES,
  TYPES_OPERATION_DD,
  VERDICTS_DD,
  type AnalyseDd,
  type CodeParametreDimensionnement,
  type EtatConstatSignal,
  type FamilleRisqueDd,
  type MethodeDimensionnement,
  type NiveauEs,
  type NiveauRisqueDd,
  type RecommandationNote,
  type SensLienDd,
  type StatutAction100j,
  type ThemeEs,
  type TypeOperationDd,
  type VerdictDd,
} from "@missionpilot/shared";
import { estIdentifiant } from "./identifiant";
import { DEVISES, type Devise } from "./format";
import { dateValide } from "./periode";
import {
  decouperListe,
  lireMontant,
  lireNombre,
  montantVersSaisie,
  texteOuNull,
  type Resultat,
} from "./saisie";

// --- Bornes (miroir des schémas partagés) -----------------------------------------------------

export const TITRE_MAX = 200;
export const ENONCE_MAX = 2000;
export const MOTIF_MAX = 500;
export const MOTIF_LONG_MAX = 1000;
export const TEXTE_LONG_MAX = 4000;
export const CRITERE_MAX = 2000;
export const AVIS_MOTIF_MAX = 1000;
export const MOTIF_ECART_MAX = 1000;
export const MOTIF_VERDICT_MAX = 2000;
export const MOTIF_VERDICT_ECART_MIN = 20;
export const MOTIF_DECISION_MIN = 10;
export const MOTIF_AVIS_PARAMETRE_MIN = 10;
export const NOTE_SYNTHESE_MAX = 4000;
export const CONDITION_MAX = 300;
export const CONDITIONS_MAX = 20;
export const ACTEURS_MAX = 12;
export const ACTEUR_MAX = 120;
export const AJUSTEMENTS_MAX = 10;
export const FACTEUR_AJUSTEMENT_MAX_BP = 20_000;
export const PLEIN_BP = 10_000;
export const JOUR_MAX = 100;

const MARQUES_COMBINANTES = new RegExp(
  `[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`,
  "g",
);

const estDans = <T extends string>(liste: readonly T[], v: string): v is T =>
  (liste as readonly string[]).includes(v);

const trop = (max: number) => `${max} caractères au plus.`;

// --- Lectures de saisie -----------------------------------------------------------------------

/**
 * Pourcentage saisi à la française (« 25,5 », « 40 % ») → points de base entiers. `null` si vide,
 * `Number.NaN` si illisible, négatif ou plus précis que le centième de point.
 */
export function lirePourcentageBp(v: string): number | null {
  const nettoye = v.replace(/%/g, "");
  const n = lireNombre(nettoye);
  if (n === null) return null;
  if (Number.isNaN(n) || n < 0) return Number.NaN;
  const bp = Math.round(n * 100);
  if (Math.abs(n * 100 - bp) > 1e-6) return Number.NaN;
  return bp;
}

/** Entier saisi (« 1 500 »). `null` si vide, `Number.NaN` si décimal, négatif ou illisible. */
export function lireEntier(v: string): number | null {
  const n = lireNombre(v);
  if (n === null) return null;
  if (Number.isNaN(n) || n < 0 || !Number.isSafeInteger(n)) return Number.NaN;
  return n;
}

/** Points de base → texte de saisie (« 2550 » → « 25,5 »), pour préremplir un champ. */
export function bpVersSaisie(bp: number | null | undefined): string {
  if (typeof bp !== "number" || !Number.isFinite(bp)) return "";
  const entier = Math.trunc(bp / 100);
  const reste = bp % 100;
  if (reste === 0) return String(entier);
  const decimales = String(reste).padStart(2, "0").replace(/0+$/, "");
  return `${entier},${decimales}`;
}

/**
 * Code de référentiel (`[a-z0-9_.-]`, 120 au plus) tiré d'un libellé : l'utilisateur ne saisit
 * jamais un code à la main. `existants` garantit l'unicité (suffixe `_2`, `_3`…).
 */
export function codeDepuisLibelle(libelle: string, existants: readonly string[] = []): string {
  const base =
    libelle
      .normalize("NFD")
      .replace(MARQUES_COMBINANTES, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 100) || "element";
  if (!existants.includes(base)) return base;
  for (let i = 2; i < 10_000; i++) {
    const candidat = `${base}_${i}`;
    if (!existants.includes(candidat)) return candidat;
  }
  return base;
}

function texteBorne<K extends string>(
  erreurs: Partial<Record<K, string>>,
  champ: K,
  valeur: string,
  { requis, max, min }: { requis: boolean; max: number; min?: number },
  messageRequis = "Ce champ est obligatoire.",
): string {
  const t = valeur.trim();
  if (t === "") {
    if (requis) erreurs[champ] = messageRequis;
  } else if (t.length > max) erreurs[champ] = trop(max);
  else if (min !== undefined && t.length < min) erreurs[champ] = `${min} caractères au moins.`;
  return t;
}

// --- Affirmation (assertion du registre : point, risque, hypothèse) ---------------------------

export interface SaisieAffirmation {
  enonce: string;
  classe_risque: string;
  avis_expert: boolean;
  avis_expert_motif: string;
  signer_avis: boolean;
}

export type ChampAffirmation = keyof SaisieAffirmation;

export interface ChargeAffirmation {
  enonce: string;
  classe_risque: "R2" | "R3";
  avis_expert: boolean;
  avis_expert_motif: string | null;
  signer_avis: boolean;
}

export const CLASSES_AFFIRMATION = ["R2", "R3"] as const;

export const saisieAffirmationVide = (): SaisieAffirmation => ({
  enonce: "",
  classe_risque: "R2",
  avis_expert: false,
  avis_expert_motif: "",
  signer_avis: false,
});

/** Contrôle de l'affirmation ; renvoie la charge ou ajoute les erreurs au dictionnaire. */
export function validerAffirmation(
  s: SaisieAffirmation,
  erreurs: Partial<Record<ChampAffirmation, string>>,
): ChargeAffirmation | null {
  const enonce = texteBorne(
    erreurs,
    "enonce",
    s.enonce,
    { requis: true, max: ENONCE_MAX },
    "Rédigez l'affirmation.",
  );
  if (!estDans(CLASSES_AFFIRMATION, s.classe_risque)) {
    erreurs.classe_risque = "Choisissez la classe de risque (R2 ou R3).";
  }
  const motif = texteOuNull(s.avis_expert_motif);
  if (s.avis_expert && motif === null) {
    erreurs.avis_expert_motif = "Un avis d'expert se justifie.";
  } else if (motif !== null && motif.length > AVIS_MOTIF_MAX) {
    erreurs.avis_expert_motif = trop(AVIS_MOTIF_MAX);
  }
  if (erreurs.enonce || erreurs.classe_risque || erreurs.avis_expert_motif) return null;
  return {
    enonce,
    classe_risque: s.classe_risque as "R2" | "R3",
    avis_expert: s.avis_expert,
    avis_expert_motif: s.avis_expert ? motif : null,
    signer_avis: s.avis_expert && s.signer_avis,
  };
}

// --- Cadrage (DD-01) --------------------------------------------------------------------------

export interface SaisieCadrage {
  titre: string;
  secteur_code: string;
  filiere_code: string;
  pays_code: string;
  cible_nom: string;
  type_operation: string;
  devise: string;
  date_operation: string;
  question_investissement: string;
  perimetre: string;
  motif: string;
}

export type ChampCadrage = keyof SaisieCadrage;

export interface ChargeCadrage {
  titre: string;
  secteur_code: string;
  filiere_code: string | null;
  pays_code: string;
  cible_nom: string | null;
  type_operation: TypeOperationDd;
  devise: Devise;
  date_operation: string | null;
  question_investissement: string | null;
  perimetre: string | null;
  motif?: string;
}

export const saisieCadrageVide = (devise: string = "XOF"): SaisieCadrage => ({
  titre: "",
  secteur_code: "",
  filiere_code: "",
  pays_code: "",
  cible_nom: "",
  type_operation: "",
  devise,
  date_operation: "",
  question_investissement: "",
  perimetre: "",
  motif: "",
});

/** Création d'un dossier ou correction (`correction` : motif exigé, version 2 et suivantes). */
export function validerCadrage(
  s: SaisieCadrage,
  correction: boolean,
): Resultat<ChargeCadrage, ChampCadrage> {
  const e: Partial<Record<ChampCadrage, string>> = {};
  const titre = texteBorne(
    e,
    "titre",
    s.titre,
    { requis: true, max: TITRE_MAX },
    "Donnez un titre au dossier.",
  );
  if (s.secteur_code === "") e.secteur_code = "Choisissez le secteur.";
  if (s.pays_code === "") e.pays_code = "Choisissez le pays.";
  if (!estDans(TYPES_OPERATION_DD, s.type_operation))
    e.type_operation = "Choisissez le type d'opération.";
  if (!estDans(DEVISES, s.devise)) e.devise = "Choisissez la devise.";
  const cible = texteBorne(e, "cible_nom", s.cible_nom, { requis: false, max: TITRE_MAX });
  if (s.type_operation === "acquisition" && cible === "")
    e.cible_nom = "Une acquisition désigne sa cible.";
  let date: string | null = null;
  if (s.date_operation !== "") {
    date = dateValide(s.date_operation);
    if (date === null) e.date_operation = "Date invalide (entre 2000 et 2100).";
  }
  const question = texteBorne(e, "question_investissement", s.question_investissement, {
    requis: false,
    max: ENONCE_MAX,
  });
  const perimetre = texteBorne(e, "perimetre", s.perimetre, { requis: false, max: TEXTE_LONG_MAX });
  const motif = texteBorne(
    e,
    "motif",
    s.motif,
    { requis: correction, max: MOTIF_MAX },
    "Expliquez la correction.",
  );
  if (Object.keys(e).length > 0) return { ok: false, erreurs: e };
  return {
    ok: true,
    charge: {
      titre,
      secteur_code: s.secteur_code,
      filiere_code: s.filiere_code === "" ? null : s.filiere_code,
      pays_code: s.pays_code,
      cible_nom: cible === "" ? null : cible,
      type_operation: s.type_operation as TypeOperationDd,
      devise: s.devise as Devise,
      date_operation: date,
      question_investissement: question === "" ? null : question,
      perimetre: perimetre === "" ? null : perimetre,
      ...(correction ? { motif } : {}),
    },
  };
}

// --- Points d'analyse (DD-03, DD-05) ----------------------------------------------------------

export interface SaisiePoint extends SaisieAffirmation {
  libelle: string;
  niveau: string;
}
export type ChampPoint = keyof SaisiePoint;

export interface ChargePoint extends ChargeAffirmation {
  analyse: AnalyseDd;
  categorie: string;
  libelle: string | null;
  niveau: NiveauRisqueDd | null;
}

export const saisiePointVide = (): SaisiePoint => ({
  ...saisieAffirmationVide(),
  libelle: "",
  niveau: "",
});

export function validerPoint(
  s: SaisiePoint,
  analyse: AnalyseDd,
  categorie: string,
): Resultat<ChargePoint, ChampPoint> {
  const e: Partial<Record<ChampPoint, string>> = {};
  if (!(CATEGORIES_ANALYSE_DD[analyse] as readonly string[]).includes(categorie)) {
    e.enonce = "Catégorie inconnue pour cette analyse.";
  }
  const libelle = texteBorne(e, "libelle", s.libelle, { requis: false, max: TITRE_MAX });
  if (s.niveau !== "" && !estDans(NIVEAUX_RISQUE_DD, s.niveau)) e.niveau = "Importance inconnue.";
  const aff = validerAffirmation(s, e);
  if (!aff || Object.keys(e).length > 0) return { ok: false, erreurs: e };
  return {
    ok: true,
    charge: {
      ...aff,
      analyse,
      categorie,
      libelle: libelle === "" ? null : libelle,
      niveau: s.niveau === "" ? null : (s.niveau as NiveauRisqueDd),
    },
  };
}

export interface SaisieCorrectionPoint {
  libelle: string;
  niveau: string;
  enonce: string;
  motif: string;
}
export type ChampCorrectionPoint = keyof SaisieCorrectionPoint;

export interface ChargeCorrectionPoint {
  motif: string;
  libelle?: string | null;
  niveau?: NiveauRisqueDd | null;
  enonce?: string;
}

/** Correction d'un point : seuls les champs modifiés sont envoyés (au moins un). */
export function validerCorrectionPoint(
  s: SaisieCorrectionPoint,
  initial: { libelle: string | null; niveau: string | null; enonce: string },
): Resultat<ChargeCorrectionPoint, ChampCorrectionPoint> {
  const e: Partial<Record<ChampCorrectionPoint, string>> = {};
  const enonce = texteBorne(
    e,
    "enonce",
    s.enonce,
    { requis: true, max: ENONCE_MAX },
    "L'affirmation ne peut pas être vide.",
  );
  const libelle = texteBorne(e, "libelle", s.libelle, { requis: false, max: TITRE_MAX });
  if (s.niveau !== "" && !estDans(NIVEAUX_RISQUE_DD, s.niveau)) e.niveau = "Importance inconnue.";
  const motif = texteBorne(
    e,
    "motif",
    s.motif,
    { requis: true, max: MOTIF_MAX },
    "Expliquez la correction.",
  );
  const charge: ChargeCorrectionPoint = { motif };
  if (enonce !== initial.enonce) charge.enonce = enonce;
  if ((libelle === "" ? null : libelle) !== initial.libelle)
    charge.libelle = libelle === "" ? null : libelle;
  if ((s.niveau === "" ? null : s.niveau) !== initial.niveau) {
    charge.niveau = s.niveau === "" ? null : (s.niveau as NiveauRisqueDd);
  }
  if (Object.keys(e).length === 0 && Object.keys(charge).length === 1) {
    e.enonce = "Aucune modification à enregistrer.";
  }
  return Object.keys(e).length > 0 ? { ok: false, erreurs: e } : { ok: true, charge };
}

/** Retrait (ou rétablissement) d'un élément : un motif est exigé. */
export function validerRetrait(
  motifSaisi: string,
  retire: boolean,
): Resultat<{ motif: string; retire: boolean }, "motif"> {
  const e: Partial<Record<"motif", string>> = {};
  const motif = texteBorne(
    e,
    "motif",
    motifSaisi,
    { requis: true, max: MOTIF_MAX },
    "Expliquez pourquoi.",
  );
  return Object.keys(e).length > 0
    ? { ok: false, erreurs: e }
    : { ok: true, charge: { motif, retire } };
}

// --- Chaîne de valeur (DD-04) -----------------------------------------------------------------

export interface SaisieEtape {
  libelle: string;
  description: string;
  ordre: string;
  part_cout: string;
  part_marge: string;
  acteurs: string;
  contraintes: string;
  motif: string;
}
export type ChampEtape = keyof SaisieEtape;

export interface ChargeEtape {
  libelle: string;
  description: string | null;
  ordre: number;
  part_cout_bp: number | null;
  part_marge_bp: number | null;
  acteurs: string[];
  contraintes: string | null;
  motif?: string;
}

export const saisieEtapeVide = (ordre: number): SaisieEtape => ({
  libelle: "",
  description: "",
  ordre: String(ordre),
  part_cout: "",
  part_marge: "",
  acteurs: "",
  contraintes: "",
  motif: "",
});

export function validerEtape(
  s: SaisieEtape,
  correction: boolean,
): Resultat<ChargeEtape, ChampEtape> {
  const e: Partial<Record<ChampEtape, string>> = {};
  const libelle = texteBorne(
    e,
    "libelle",
    s.libelle,
    { requis: true, max: TITRE_MAX },
    "Nommez l'étape.",
  );
  const description = texteBorne(e, "description", s.description, {
    requis: false,
    max: TEXTE_LONG_MAX,
  });
  const contraintes = texteBorne(e, "contraintes", s.contraintes, {
    requis: false,
    max: MOTIF_VERDICT_MAX,
  });
  const ordre = lireEntier(s.ordre);
  if (ordre === null || Number.isNaN(ordre) || ordre < 1 || ordre > 200) {
    e.ordre = "Indiquez le rang de l'étape (de 1 à 200).";
  }
  const cout = lirePourcentageBp(s.part_cout);
  if (cout !== null && (Number.isNaN(cout) || cout > PLEIN_BP))
    e.part_cout = "Un pourcentage entre 0 et 100.";
  const marge = lirePourcentageBp(s.part_marge);
  if (marge !== null && (Number.isNaN(marge) || marge > PLEIN_BP))
    e.part_marge = "Un pourcentage entre 0 et 100.";
  const acteurs = decouperListe(s.acteurs);
  if (acteurs.length > ACTEURS_MAX) e.acteurs = `${ACTEURS_MAX} acteurs au plus.`;
  else if (acteurs.some((a) => a.length > ACTEUR_MAX))
    e.acteurs = `Chaque acteur : ${trop(ACTEUR_MAX)}`;
  const motif = texteBorne(
    e,
    "motif",
    s.motif,
    { requis: correction, max: MOTIF_MAX },
    "Expliquez la correction.",
  );
  if (Object.keys(e).length > 0) return { ok: false, erreurs: e };
  return {
    ok: true,
    charge: {
      libelle,
      description: description === "" ? null : description,
      ordre: ordre as number,
      part_cout_bp: cout,
      part_marge_bp: marge,
      acteurs,
      contraintes: contraintes === "" ? null : contraintes,
      ...(correction ? { motif } : {}),
    },
  };
}

// --- Risques (DD-06) --------------------------------------------------------------------------

export interface SaisieRisque extends SaisieAffirmation {
  famille: string;
  niveau: string;
  libelle: string;
  etape_id: string;
  signal_id: string;
  motif_ecart: string;
}
export type ChampRisque = keyof SaisieRisque;

export interface ChargeRisque extends ChargeAffirmation {
  famille: FamilleRisqueDd;
  niveau: NiveauRisqueDd;
  libelle: string;
  etape_id: string | null;
  signal_id: string | null;
  motif_ecart?: string;
}

export const saisieRisqueVide = (): SaisieRisque => ({
  ...saisieAffirmationVide(),
  famille: "",
  niveau: "",
  libelle: "",
  etape_id: "",
  signal_id: "",
  motif_ecart: "",
});

/** Le motif de l'écart devient obligatoire dès que le niveau diffère de la gravité du signal d'origine. */
export function ecartAvecSignal(
  niveau: string,
  graviteSignal: NiveauRisqueDd | null | undefined,
): boolean {
  return (
    graviteSignal !== null &&
    graviteSignal !== undefined &&
    niveau !== "" &&
    niveau !== graviteSignal
  );
}

export function validerRisque(
  s: SaisieRisque,
  graviteSignal: NiveauRisqueDd | null | undefined,
): Resultat<ChargeRisque, ChampRisque> {
  const e: Partial<Record<ChampRisque, string>> = {};
  if (!estDans(FAMILLES_RISQUE_DD, s.famille)) e.famille = "Choisissez la famille de risque.";
  if (!estDans(NIVEAUX_RISQUE_DD, s.niveau)) e.niveau = "Choisissez le niveau.";
  const libelle = texteBorne(
    e,
    "libelle",
    s.libelle,
    { requis: true, max: TITRE_MAX },
    "Nommez le risque.",
  );
  if (s.etape_id !== "" && !estIdentifiant(s.etape_id)) e.etape_id = "Étape invalide.";
  if (s.signal_id !== "" && !estIdentifiant(s.signal_id)) e.signal_id = "Signal invalide.";
  const ecart = ecartAvecSignal(s.niveau, graviteSignal);
  const motifEcart = texteBorne(
    e,
    "motif_ecart",
    s.motif_ecart,
    { requis: ecart, max: MOTIF_ECART_MAX },
    "Le niveau diffère de la gravité du signal : justifiez l'écart.",
  );
  const aff = validerAffirmation(s, e);
  if (!aff || Object.keys(e).length > 0) return { ok: false, erreurs: e };
  return {
    ok: true,
    charge: {
      ...aff,
      famille: s.famille as FamilleRisqueDd,
      niveau: s.niveau as NiveauRisqueDd,
      libelle,
      etape_id: s.etape_id === "" ? null : s.etape_id,
      signal_id: s.signal_id === "" ? null : s.signal_id,
      ...(motifEcart !== "" ? { motif_ecart: motifEcart } : {}),
    },
  };
}

export interface SaisieCorrectionRisque {
  niveau: string;
  libelle: string;
  enonce: string;
  etape_id: string;
  motif_ecart: string;
  motif: string;
}
export type ChampCorrectionRisque = keyof SaisieCorrectionRisque;

export interface ChargeCorrectionRisque {
  motif: string;
  niveau?: NiveauRisqueDd;
  libelle?: string;
  enonce?: string;
  etape_id?: string | null;
  motif_ecart?: string;
}

export function validerCorrectionRisque(
  s: SaisieCorrectionRisque,
  initial: { niveau: string; libelle: string; enonce: string; etape_id: string | null },
  graviteSignal: NiveauRisqueDd | null | undefined,
): Resultat<ChargeCorrectionRisque, ChampCorrectionRisque> {
  const e: Partial<Record<ChampCorrectionRisque, string>> = {};
  if (!estDans(NIVEAUX_RISQUE_DD, s.niveau)) e.niveau = "Choisissez le niveau.";
  const libelle = texteBorne(
    e,
    "libelle",
    s.libelle,
    { requis: true, max: TITRE_MAX },
    "Nommez le risque.",
  );
  const enonce = texteBorne(
    e,
    "enonce",
    s.enonce,
    { requis: true, max: ENONCE_MAX },
    "La justification ne peut pas être vide.",
  );
  if (s.etape_id !== "" && !estIdentifiant(s.etape_id)) e.etape_id = "Étape invalide.";
  const ecart = s.niveau !== initial.niveau && ecartAvecSignal(s.niveau, graviteSignal);
  const motifEcart = texteBorne(
    e,
    "motif_ecart",
    s.motif_ecart,
    { requis: ecart, max: MOTIF_ECART_MAX },
    "Le niveau diffère de la gravité du signal : justifiez l'écart.",
  );
  const motif = texteBorne(
    e,
    "motif",
    s.motif,
    { requis: true, max: MOTIF_MAX },
    "Expliquez la correction.",
  );
  const charge: ChargeCorrectionRisque = { motif };
  if (s.niveau !== initial.niveau) charge.niveau = s.niveau as NiveauRisqueDd;
  if (libelle !== initial.libelle) charge.libelle = libelle;
  if (enonce !== initial.enonce) charge.enonce = enonce;
  const etape = s.etape_id === "" ? null : s.etape_id;
  if (etape !== initial.etape_id) charge.etape_id = etape;
  if (motifEcart !== "") charge.motif_ecart = motifEcart;
  if (
    Object.keys(e).length === 0 &&
    Object.keys(charge).filter((c) => c !== "motif_ecart").length === 1
  ) {
    e.libelle = "Aucune modification à enregistrer.";
  }
  return Object.keys(e).length > 0 ? { ok: false, erreurs: e } : { ok: true, charge };
}

// --- Constat d'un signal (DD-11) --------------------------------------------------------------

export interface ChargeConstat {
  etat: EtatConstatSignal;
  commentaire: string | null;
  risque_id: string | null;
}

/** « Écarté » exige un commentaire ; l'état et le risque lié viennent du bouton cliqué. */
export function validerConstat(
  etat: string,
  commentaire: string,
  risqueId: string | null,
): Resultat<ChargeConstat, "etat" | "commentaire"> {
  const e: Partial<Record<"etat" | "commentaire", string>> = {};
  if (!estDans(ETATS_CONSTAT_SIGNAL, etat)) e.etat = "État inconnu.";
  const c = texteBorne(
    e,
    "commentaire",
    commentaire,
    { requis: etat === "ecarte", max: MOTIF_LONG_MAX },
    "Un signal écarté se justifie : ajoutez un commentaire.",
  );
  return Object.keys(e).length > 0
    ? { ok: false, erreurs: e }
    : {
        ok: true,
        charge: {
          etat: etat as EtatConstatSignal,
          commentaire: c === "" ? null : c,
          risque_id: risqueId,
        },
      };
}

// --- Hypothèses et verdicts (DD-09) -----------------------------------------------------------

export interface SaisieHypothese {
  libelle: string;
  description: string;
  critere: string;
  parent_id: string;
}
export type ChampHypothese = keyof SaisieHypothese;

export interface ChargeHypothese {
  libelle: string;
  description: string | null;
  critere: string | null;
  parent_id: string | null;
}

export const saisieHypotheseVide = (parentId = ""): SaisieHypothese => ({
  libelle: "",
  description: "",
  critere: "",
  parent_id: parentId,
});

export function validerHypothese(s: SaisieHypothese): Resultat<ChargeHypothese, ChampHypothese> {
  const e: Partial<Record<ChampHypothese, string>> = {};
  const libelle = texteBorne(
    e,
    "libelle",
    s.libelle,
    { requis: true, max: TITRE_MAX },
    "Formulez l'hypothèse.",
  );
  const description = texteBorne(e, "description", s.description, {
    requis: false,
    max: TEXTE_LONG_MAX,
  });
  const critere = texteBorne(e, "critere", s.critere, { requis: false, max: CRITERE_MAX });
  if (s.parent_id !== "" && !estIdentifiant(s.parent_id))
    e.parent_id = "Hypothèse parente invalide.";
  return Object.keys(e).length > 0
    ? { ok: false, erreurs: e }
    : {
        ok: true,
        charge: {
          libelle,
          description: description === "" ? null : description,
          critere: critere === "" ? null : critere,
          parent_id: s.parent_id === "" ? null : s.parent_id,
        },
      };
}

export interface SaisieCorrectionHypothese {
  libelle: string;
  description: string;
  critere: string;
  motif: string;
}
export type ChampCorrectionHypothese = keyof SaisieCorrectionHypothese;

export interface ChargeCorrectionHypothese {
  motif: string;
  libelle?: string;
  description?: string | null;
  critere?: string | null;
}

export function validerCorrectionHypothese(
  s: SaisieCorrectionHypothese,
  initial: { libelle: string; description: string | null; critere: string | null },
): Resultat<ChargeCorrectionHypothese, ChampCorrectionHypothese> {
  const e: Partial<Record<ChampCorrectionHypothese, string>> = {};
  const libelle = texteBorne(
    e,
    "libelle",
    s.libelle,
    { requis: true, max: TITRE_MAX },
    "Formulez l'hypothèse.",
  );
  const description = texteBorne(e, "description", s.description, {
    requis: false,
    max: TEXTE_LONG_MAX,
  });
  const critere = texteBorne(e, "critere", s.critere, { requis: false, max: CRITERE_MAX });
  const motif = texteBorne(
    e,
    "motif",
    s.motif,
    { requis: true, max: MOTIF_MAX },
    "Expliquez la correction.",
  );
  const charge: ChargeCorrectionHypothese = { motif };
  if (libelle !== initial.libelle) charge.libelle = libelle;
  if ((description === "" ? null : description) !== initial.description) {
    charge.description = description === "" ? null : description;
  }
  if ((critere === "" ? null : critere) !== initial.critere)
    charge.critere = critere === "" ? null : critere;
  if (Object.keys(e).length === 0 && Object.keys(charge).length === 1) {
    e.libelle = "Aucune modification à enregistrer.";
  }
  return Object.keys(e).length > 0 ? { ok: false, erreurs: e } : { ok: true, charge };
}

export interface ChargeLien {
  assertion_id: string;
  action: "lier" | "delier";
  sens: SensLienDd | null;
}

export function validerLien(
  assertionId: string,
  sens: string,
): Resultat<ChargeLien, "assertion_id" | "sens"> {
  const e: Partial<Record<"assertion_id" | "sens", string>> = {};
  if (!estIdentifiant(assertionId)) e.assertion_id = "Choisissez une assertion.";
  if (!estDans(SENS_LIEN_DD, sens)) e.sens = "Indiquez si elle soutient ou contredit l'hypothèse.";
  return Object.keys(e).length > 0
    ? { ok: false, erreurs: e }
    : { ok: true, charge: { assertion_id: assertionId, action: "lier", sens: sens as SensLienDd } };
}

export interface SaisieAssertionHypothese extends SaisieAffirmation {
  sens: string;
}
export type ChampAssertionHypothese = keyof SaisieAssertionHypothese;

export const saisieAssertionHypotheseVide = (): SaisieAssertionHypothese => ({
  ...saisieAffirmationVide(),
  sens: "",
});

export function validerAssertionHypothese(
  s: SaisieAssertionHypothese,
): Resultat<ChargeAffirmation & { sens: SensLienDd }, ChampAssertionHypothese> {
  const e: Partial<Record<ChampAssertionHypothese, string>> = {};
  if (!estDans(SENS_LIEN_DD, s.sens))
    e.sens = "Indiquez si elle soutient ou contredit l'hypothèse.";
  const aff = validerAffirmation(s, e);
  if (!aff || Object.keys(e).length > 0) return { ok: false, erreurs: e };
  return { ok: true, charge: { ...aff, sens: s.sens as SensLienDd } };
}

export interface SaisieVerdict {
  verdict: string;
  motif: string;
  assertions_citees: string[];
}
export type ChampVerdict = keyof SaisieVerdict;

export interface ChargeVerdict {
  hypothese_version: number;
  verdict: VerdictDd;
  motif: string;
  assertions_citees: string[];
}

/** Le verdict s'écarte-t-il de l'indication du moteur ? Alors le motif doit être détaillé (traçabilité). */
export const ecartIndication = (
  verdict: string,
  indication: VerdictDd | null | undefined,
): boolean =>
  verdict !== "" && indication !== null && indication !== undefined && verdict !== indication;

export function validerVerdict(
  s: SaisieVerdict,
  hypotheseVersion: number,
  indication: VerdictDd | null | undefined,
): Resultat<ChargeVerdict, ChampVerdict> {
  const e: Partial<Record<ChampVerdict, string>> = {};
  if (!estDans(VERDICTS_DD, s.verdict)) e.verdict = "Choisissez le verdict.";
  const ecart = ecartIndication(s.verdict, indication);
  const motif = texteBorne(
    e,
    "motif",
    s.motif,
    { requis: true, max: MOTIF_VERDICT_MAX, min: ecart ? MOTIF_VERDICT_ECART_MIN : undefined },
    "Motivez le verdict.",
  );
  if (s.verdict !== "" && s.verdict !== "non_concluante" && s.assertions_citees.length === 0) {
    e.assertions_citees = "Un verdict confirmé ou infirmé cite au moins une assertion.";
  } else if (s.assertions_citees.length > 50) {
    e.assertions_citees = "50 assertions au plus.";
  }
  return Object.keys(e).length > 0
    ? { ok: false, erreurs: e }
    : {
        ok: true,
        charge: {
          hypothese_version: hypotheseVersion,
          verdict: s.verdict as VerdictDd,
          motif,
          assertions_citees: s.assertions_citees,
        },
      };
}

export interface ChargeValidation {
  decision: "valide" | "rejete";
  motif?: string;
}

/** Validation ou rejet (verdict, note) : un rejet se motive. */
export function validerDecision(
  decision: "valide" | "rejete",
  motifSaisi: string,
): Resultat<ChargeValidation, "motif"> {
  const e: Partial<Record<"motif", string>> = {};
  const motif = texteBorne(
    e,
    "motif",
    motifSaisi,
    { requis: decision === "rejete", max: MOTIF_LONG_MAX },
    "Un rejet se motive.",
  );
  return Object.keys(e).length > 0
    ? { ok: false, erreurs: e }
    : { ok: true, charge: { decision, ...(motif !== "" ? { motif } : {}) } };
}

// --- Bibliothèque de signaux (DD-11) ----------------------------------------------------------

export interface SaisieSignal {
  libelle: string;
  description: string;
  famille: string;
  secteur_code: string;
  pays_code: string;
  gravite_indicative: string;
  question: string;
  reference_publique: string;
  actif: boolean;
  motif: string;
}
export type ChampSignal = keyof SaisieSignal;

export interface ChargeSignal {
  libelle: string;
  description: string | null;
  famille: FamilleRisqueDd;
  secteur_code: string | null;
  pays_code: string | null;
  gravite_indicative: NiveauRisqueDd;
  question: string | null;
  reference_publique: string | null;
  actif: boolean;
}

export const saisieSignalVide = (): SaisieSignal => ({
  libelle: "",
  description: "",
  famille: "",
  secteur_code: "",
  pays_code: "",
  gravite_indicative: "",
  question: "",
  reference_publique: "",
  actif: true,
  motif: "",
});

/** Création (code tiré du libellé) ou correction motivée d'un signal. */
export function validerSignal(
  s: SaisieSignal,
  correction: boolean,
  codesExistants: readonly string[] = [],
): Resultat<ChargeSignal & { code?: string; motif?: string }, ChampSignal> {
  const e: Partial<Record<ChampSignal, string>> = {};
  const libelle = texteBorne(
    e,
    "libelle",
    s.libelle,
    { requis: true, max: TITRE_MAX },
    "Nommez le signal.",
  );
  const description = texteBorne(e, "description", s.description, {
    requis: false,
    max: MOTIF_VERDICT_MAX,
  });
  if (!estDans(FAMILLES_RISQUE_DD, s.famille)) e.famille = "Choisissez la famille.";
  if (!estDans(NIVEAUX_RISQUE_DD, s.gravite_indicative))
    e.gravite_indicative = "Choisissez la gravité indicative.";
  const question = texteBorne(e, "question", s.question, { requis: false, max: MOTIF_LONG_MAX });
  const reference = texteBorne(e, "reference_publique", s.reference_publique, {
    requis: false,
    max: 500,
  });
  const motif = texteBorne(
    e,
    "motif",
    s.motif,
    { requis: correction, max: MOTIF_MAX },
    "Expliquez la correction.",
  );
  if (Object.keys(e).length > 0) return { ok: false, erreurs: e };
  return {
    ok: true,
    charge: {
      libelle,
      description: description === "" ? null : description,
      famille: s.famille as FamilleRisqueDd,
      secteur_code: s.secteur_code === "" ? null : s.secteur_code,
      pays_code: s.pays_code === "" ? null : s.pays_code,
      gravite_indicative: s.gravite_indicative as NiveauRisqueDd,
      question: question === "" ? null : question,
      reference_publique: reference === "" ? null : reference,
      actif: s.actif,
      ...(correction ? { motif } : { code: codeDepuisLibelle(libelle, codesExistants) }),
    },
  };
}

// --- Dimensionnement de marché (DD-12) --------------------------------------------------------

export type TypeSourceSaisie = "" | "preuve" | "avis_expert";

export interface SaisieParametre {
  code: CodeParametreDimensionnement;
  bas: string;
  base: string;
  haut: string;
  source_type: TypeSourceSaisie;
  preuve_id: string;
  avis_motif: string;
}

export interface SaisieAjustement {
  libelle: string;
  facteur: string;
  motif: string;
}

export interface SaisieDimensionnement {
  methode: string;
  libelle: string;
  parametres: SaisieParametre[];
  ajustements: SaisieAjustement[];
  motif: string;
}
export type ChampDimensionnement = "methode" | "libelle" | "parametres" | "ajustements" | "motif";

export interface ParametreCharge {
  code: CodeParametreDimensionnement;
  bas: number;
  base: number;
  haut: number;
  source: { type: "preuve"; preuve_id: string } | { type: "avis_expert"; motif: string } | null;
}

export interface ChargeDimensionnement {
  methode: MethodeDimensionnement;
  libelle: string;
  parametres: ParametreCharge[];
  ajustements: { libelle: string; facteur_bp: number; motif: string }[];
  motif?: string;
}

export const saisieParametresVides = (methode: MethodeDimensionnement): SaisieParametre[] =>
  PARAMETRES_DIMENSIONNEMENT[methode].map((p) => ({
    code: p.code,
    bas: "",
    base: "",
    haut: "",
    source_type: "",
    preuve_id: "",
    avis_motif: "",
  }));

/** Lit une valeur de paramètre selon son unité ; `undefined` si illisible, `null` si vide. */
export function lireValeurParametre(
  code: CodeParametreDimensionnement,
  saisie: string,
  devise: Devise,
): number | null | undefined {
  const unite = PARAMETRES_DIMENSIONNEMENT[
    PARAMETRES_DIMENSIONNEMENT.descendant.some((p) => p.code === code) ? "descendant" : "ascendant"
  ].find((p) => p.code === code)?.unite;
  const v =
    unite === "pourcentage_bp"
      ? lirePourcentageBp(saisie)
      : unite === "montant"
        ? lireMontant(saisie, devise)
        : lireEntier(saisie);
  if (v === null) return null;
  if (Number.isNaN(v)) return undefined;
  if (unite === "pourcentage_bp" && v > PLEIN_BP) return undefined;
  return v;
}

/**
 * Contrôle d'un dimensionnement. `exigerSources` : l'enregistrement exige une source par paramètre
 * (preuve de la mission ou avis d'expert motivé) ; le calcul à blanc (aperçu) l'admet.
 */
export function validerDimensionnement(
  s: SaisieDimensionnement,
  devise: Devise,
  mode: "apercu" | "creation" | "version",
): Resultat<ChargeDimensionnement, ChampDimensionnement> {
  const e: Partial<Record<ChampDimensionnement, string>> = {};
  if (!estDans(METHODES_DIMENSIONNEMENT, s.methode)) e.methode = "Choisissez la méthode.";
  const libelle = texteBorne(
    e,
    "libelle",
    s.libelle,
    { requis: mode !== "apercu", max: TITRE_MAX },
    "Nommez ce dimensionnement.",
  );
  const motif = texteBorne(
    e,
    "motif",
    s.motif,
    { requis: mode === "version", max: MOTIF_MAX },
    "Expliquez la correction.",
  );
  const parametres: ParametreCharge[] = [];
  let erreurParametres: string | null = null;
  for (const p of s.parametres) {
    const bas = lireValeurParametre(p.code, p.bas, devise);
    const base = lireValeurParametre(p.code, p.base, devise);
    const haut = lireValeurParametre(p.code, p.haut, devise);
    if (bas === undefined || base === undefined || haut === undefined) {
      erreurParametres ??= "Une valeur est illisible ou hors limites (pourcentage de 0 à 100).";
      continue;
    }
    if (bas === null || base === null || haut === null) {
      erreurParametres ??=
        "Renseignez les trois valeurs (basse, centrale, haute) de chaque paramètre.";
      continue;
    }
    if (bas > base || base > haut) {
      erreurParametres ??= "Les valeurs se suivent : basse ≤ centrale ≤ haute.";
      continue;
    }
    let source: ParametreCharge["source"] = null;
    if (p.source_type === "preuve") {
      if (estIdentifiant(p.preuve_id)) source = { type: "preuve", preuve_id: p.preuve_id };
      else if (mode !== "apercu")
        erreurParametres ??= "Choisissez la preuve qui source chaque paramètre.";
    } else if (p.source_type === "avis_expert") {
      const m = p.avis_motif.trim();
      if (m.length >= MOTIF_AVIS_PARAMETRE_MIN && m.length <= MOTIF_MAX) {
        source = { type: "avis_expert", motif: m };
      } else if (mode !== "apercu") {
        erreurParametres ??= `Un avis d'expert se motive (${MOTIF_AVIS_PARAMETRE_MIN} caractères au moins).`;
      }
    } else if (mode !== "apercu") {
      erreurParametres ??= "Chaque paramètre cite une preuve de la mission ou un avis d'expert.";
    }
    parametres.push({ code: p.code, bas, base, haut, source });
  }
  if (erreurParametres) e.parametres = erreurParametres;
  const ajustements: ChargeDimensionnement["ajustements"] = [];
  if (s.ajustements.length > AJUSTEMENTS_MAX)
    e.ajustements = `${AJUSTEMENTS_MAX} ajustements au plus.`;
  for (const a of s.ajustements) {
    const nom = a.libelle.trim();
    const facteur = lirePourcentageBp(a.facteur);
    const m = a.motif.trim();
    if (nom === "" || nom.length > 120) {
      e.ajustements ??= "Nommez chaque ajustement (120 caractères au plus).";
    } else if (
      facteur === null ||
      Number.isNaN(facteur) ||
      facteur < 1 ||
      facteur > FACTEUR_AJUSTEMENT_MAX_BP
    ) {
      e.ajustements ??= "Le facteur d'un ajustement va de 0,01 % à 200 %.";
    } else if (m.length < MOTIF_DECISION_MIN || m.length > MOTIF_LONG_MAX) {
      e.ajustements ??= `Un ajustement d'expert se motive (${MOTIF_DECISION_MIN} caractères au moins).`;
    } else {
      ajustements.push({ libelle: nom, facteur_bp: facteur, motif: m });
    }
  }
  return Object.keys(e).length > 0
    ? { ok: false, erreurs: e }
    : {
        ok: true,
        charge: {
          methode: s.methode as MethodeDimensionnement,
          libelle,
          parametres,
          ajustements,
          ...(mode === "version" ? { motif } : {}),
        },
      };
}

// --- Filtrage environnemental et social (DD-14) -----------------------------------------------

export interface SaisieTheme {
  code: ThemeEs;
  niveau: string;
  justification: string;
}

export interface SaisieFiltrage {
  liste_id: string;
  activites: string;
  secteur_codes: string[];
  pays_codes: string[];
  themes: SaisieTheme[];
}
export type ChampFiltrage = "liste_id" | "activites" | "secteur_codes" | "pays_codes" | "themes";

export interface ChargeFiltrage {
  liste_id: string;
  declarations: { activites: string[]; secteur_codes: string[]; pays_codes: string[] };
  themes: { code: ThemeEs; niveau: NiveauEs; justification: string | null; assertion_id: null }[];
}

export const saisieThemesVides = (): SaisieTheme[] =>
  THEMES_ES.map((code) => ({ code, niveau: "", justification: "" }));

/** Niveau qui exige une justification (modéré ou plus), comme le schéma partagé. */
export const niveauEsExigeJustification = (niveau: string): boolean =>
  niveau === "modere" || niveau === "eleve" || niveau === "critique";

export function validerFiltrage(s: SaisieFiltrage): Resultat<ChargeFiltrage, ChampFiltrage> {
  const e: Partial<Record<ChampFiltrage, string>> = {};
  if (!estIdentifiant(s.liste_id)) e.liste_id = "Choisissez la liste d'exclusion.";
  const activites = s.activites
    .split(/\n|;/)
    .map((a) => a.trim())
    .filter((a) => a !== "");
  if (activites.length > 30) e.activites = "30 activités au plus.";
  else if (activites.some((a) => a.length > 300)) e.activites = `Chaque activité : ${trop(300)}`;
  if (s.secteur_codes.length > 20) e.secteur_codes = "20 secteurs au plus.";
  if (s.pays_codes.length > 20) e.pays_codes = "20 pays au plus.";
  const themes: ChargeFiltrage["themes"] = [];
  for (const t of s.themes) {
    if (t.niveau === "") continue;
    if (!estDans(NIVEAUX_ES, t.niveau)) {
      e.themes = "Un niveau est inconnu.";
      continue;
    }
    const j = t.justification.trim();
    if (niveauEsExigeJustification(t.niveau) && j === "") {
      e.themes ??= "Un niveau modéré ou plus se justifie : renseignez la justification du thème.";
      continue;
    }
    if (j.length > MOTIF_LONG_MAX) {
      e.themes ??= `Une justification : ${trop(MOTIF_LONG_MAX)}`;
      continue;
    }
    themes.push({
      code: t.code,
      niveau: t.niveau as NiveauEs,
      justification: j === "" ? null : j,
      assertion_id: null,
    });
  }
  return Object.keys(e).length > 0
    ? { ok: false, erreurs: e }
    : {
        ok: true,
        charge: {
          liste_id: s.liste_id,
          declarations: { activites, secteur_codes: s.secteur_codes, pays_codes: s.pays_codes },
          themes,
        },
      };
}

export interface ChargeDecisionExclusion {
  regle_code: string;
  decision: "confirmee" | "ecartee";
  motif: string;
}

export function validerDecisionExclusion(
  regleCode: string,
  decision: "confirmee" | "ecartee",
  motifSaisi: string,
): Resultat<ChargeDecisionExclusion, "motif"> {
  const e: Partial<Record<"motif", string>> = {};
  const motif = texteBorne(
    e,
    "motif",
    motifSaisi,
    { requis: true, max: MOTIF_LONG_MAX, min: MOTIF_DECISION_MIN },
    "Motivez la décision.",
  );
  return Object.keys(e).length > 0
    ? { ok: false, erreurs: e }
    : { ok: true, charge: { regle_code: regleCode, decision, motif } };
}

// --- Listes d'exclusion (DD-14) ---------------------------------------------------------------

export interface SaisieRegle {
  libelle: string;
  mots_cles: string;
  secteur_codes: string[];
  pays_codes: string[];
  /** Code d'une règle existante (conservé à la correction) ; vide pour une règle nouvelle. */
  code: string;
}

export interface SaisieListe {
  nom: string;
  client_id: string;
  reference_cadre: string;
  regles: SaisieRegle[];
  motif: string;
}
export type ChampListe = "nom" | "client_id" | "reference_cadre" | "regles" | "motif";

export interface ChargeListe {
  nom?: string;
  client_id?: string | null;
  reference_cadre: string | null;
  regles: {
    code: string;
    libelle: string;
    mots_cles: string[];
    secteur_codes: string[];
    pays_codes: string[];
  }[];
  motif?: string;
}

export const saisieRegleVide = (): SaisieRegle => ({
  libelle: "",
  mots_cles: "",
  secteur_codes: [],
  pays_codes: [],
  code: "",
});

/** Plafonds de `regleExclusionSchema` (mots-clés par règle, caractères par mot-clé). */
export const MOTS_CLES_REGLE_MAX = 10;
export const MOT_CLE_LONGUEUR_MAX = 60;

export function validerListe(
  s: SaisieListe,
  correction: boolean,
): Resultat<ChargeListe, ChampListe> {
  const e: Partial<Record<ChampListe, string>> = {};
  const nom = texteBorne(
    e,
    "nom",
    s.nom,
    { requis: !correction, max: TITRE_MAX },
    "Nommez la liste.",
  );
  if (s.client_id !== "" && !estIdentifiant(s.client_id)) e.client_id = "Investisseur invalide.";
  const reference = texteBorne(e, "reference_cadre", s.reference_cadre, {
    requis: false,
    max: 300,
  });
  const motif = texteBorne(
    e,
    "motif",
    s.motif,
    { requis: correction, max: MOTIF_MAX },
    "Expliquez la correction.",
  );
  const regles: ChargeListe["regles"] = [];
  if (s.regles.length === 0) e.regles = "Ajoutez au moins une règle.";
  if (s.regles.length > PLAFONDS_DD.regles_par_liste)
    e.regles = `${PLAFONDS_DD.regles_par_liste} règles au plus.`;
  const codes: string[] = s.regles.filter((r) => r.code !== "").map((r) => r.code);
  for (const r of s.regles) {
    const libelle = r.libelle.trim();
    if (libelle === "" || libelle.length > TITRE_MAX) {
      e.regles ??= "Nommez chaque règle (200 caractères au plus).";
      continue;
    }
    const mots = decouperListe(r.mots_cles);
    if (mots.length + r.secteur_codes.length + r.pays_codes.length === 0) {
      e.regles ??= "Chaque règle porte au moins un critère : un mot-clé, un secteur ou un pays.";
      continue;
    }
    if (mots.length > MOTS_CLES_REGLE_MAX || mots.some((m) => m.length > MOT_CLE_LONGUEUR_MAX)) {
      e.regles ??= `Une règle : ${MOTS_CLES_REGLE_MAX} mots-clés au plus, de ${MOT_CLE_LONGUEUR_MAX} caractères au plus.`;
      continue;
    }
    if (r.secteur_codes.length > 20 || r.pays_codes.length > 20) {
      e.regles ??= "Une règle : 20 secteurs et 20 pays au plus.";
      continue;
    }
    const code = r.code !== "" ? r.code : codeDepuisLibelle(libelle, codes);
    if (r.code === "") codes.push(code);
    regles.push({
      code,
      libelle,
      mots_cles: mots,
      secteur_codes: r.secteur_codes,
      pays_codes: r.pays_codes,
    });
  }
  return Object.keys(e).length > 0
    ? { ok: false, erreurs: e }
    : {
        ok: true,
        charge: {
          ...(correction ? {} : { nom, client_id: s.client_id === "" ? null : s.client_id }),
          reference_cadre: reference === "" ? null : reference,
          regles,
          ...(correction ? { motif } : {}),
        },
      };
}

// --- Plan des 100 jours (DD-15) ---------------------------------------------------------------

export interface SaisieAction {
  libelle: string;
  description: string;
  jour_debut: string;
  jour_fin: string;
  statut_action: string;
  responsable_id: string;
  plan_element_id: string;
  kpi_id: string;
  motif: string;
}
export type ChampAction = keyof SaisieAction;

export interface ChargeAction {
  libelle: string;
  description: string | null;
  jour_debut: number;
  jour_fin: number;
  statut_action: StatutAction100j;
  responsable_id: string | null;
  plan_element_id: string | null;
  kpi_id: string | null;
  motif?: string;
}

export const saisieActionVide = (): SaisieAction => ({
  libelle: "",
  description: "",
  jour_debut: "0",
  jour_fin: "30",
  statut_action: "a_faire",
  responsable_id: "",
  plan_element_id: "",
  kpi_id: "",
  motif: "",
});

export function validerAction(
  s: SaisieAction,
  correction: boolean,
): Resultat<ChargeAction, ChampAction> {
  const e: Partial<Record<ChampAction, string>> = {};
  const libelle = texteBorne(
    e,
    "libelle",
    s.libelle,
    { requis: true, max: TITRE_MAX },
    "Nommez l'action.",
  );
  const description = texteBorne(e, "description", s.description, {
    requis: false,
    max: TEXTE_LONG_MAX,
  });
  const debut = lireEntier(s.jour_debut);
  const fin = lireEntier(s.jour_fin);
  if (debut === null || Number.isNaN(debut) || debut > JOUR_MAX)
    e.jour_debut = "Un jour de 0 à 100.";
  if (fin === null || Number.isNaN(fin) || fin > JOUR_MAX) e.jour_fin = "Un jour de 0 à 100.";
  if (!e.jour_debut && !e.jour_fin && (debut as number) > (fin as number)) {
    e.jour_fin = "Le jour de fin ne précède pas le jour de début.";
  }
  if (!estDans(STATUTS_ACTION_100J, s.statut_action)) e.statut_action = "Choisissez le statut.";
  for (const champ of ["responsable_id", "plan_element_id", "kpi_id"] as const) {
    if (s[champ] !== "" && !estIdentifiant(s[champ])) e[champ] = "Choix invalide.";
  }
  const motif = texteBorne(
    e,
    "motif",
    s.motif,
    { requis: correction, max: MOTIF_MAX },
    "Expliquez la correction.",
  );
  if (Object.keys(e).length > 0) return { ok: false, erreurs: e };
  return {
    ok: true,
    charge: {
      libelle,
      description: description === "" ? null : description,
      jour_debut: debut as number,
      jour_fin: fin as number,
      statut_action: s.statut_action as StatutAction100j,
      responsable_id: s.responsable_id === "" ? null : s.responsable_id,
      plan_element_id: s.plan_element_id === "" ? null : s.plan_element_id,
      kpi_id: s.kpi_id === "" ? null : s.kpi_id,
      ...(correction ? { motif } : {}),
    },
  };
}

// --- Note au comité (DD-13) -------------------------------------------------------------------

export interface SaisieNote {
  titre: string;
  recommandation: string;
  synthese: string;
  conditions: string;
  motif: string;
}
export type ChampNote = keyof SaisieNote;

export interface ChargeNote {
  titre?: string;
  recommandation: RecommandationNote;
  synthese: string;
  conditions: string[];
  motif?: string;
}

export const saisieNoteVide = (): SaisieNote => ({
  titre: "",
  recommandation: "",
  synthese: "",
  conditions: "",
  motif: "",
});

/** Une condition par ligne (jamais découpée sur la virgule : une condition est une phrase). */
export function lireConditions(v: string): string[] {
  return v
    .split("\n")
    .map((c) => c.trim())
    .filter((c) => c !== "");
}

export function validerNote(
  s: SaisieNote,
  mode: "creation" | "version",
): Resultat<ChargeNote, ChampNote> {
  const e: Partial<Record<ChampNote, string>> = {};
  const titre = texteBorne(
    e,
    "titre",
    s.titre,
    { requis: mode === "creation", max: TITRE_MAX },
    "Donnez un titre à la note.",
  );
  if (!estDans(RECOMMANDATIONS_NOTE, s.recommandation))
    e.recommandation = "Choisissez la recommandation.";
  const synthese = texteBorne(
    e,
    "synthese",
    s.synthese,
    { requis: true, max: NOTE_SYNTHESE_MAX },
    "Rédigez la synthèse.",
  );
  const conditions = lireConditions(s.conditions);
  if (conditions.length > CONDITIONS_MAX) e.conditions = `${CONDITIONS_MAX} conditions au plus.`;
  else if (conditions.some((c) => c.length > CONDITION_MAX))
    e.conditions = `Chaque condition : ${trop(CONDITION_MAX)}`;
  if (
    s.recommandation === "favorable_sous_conditions" &&
    conditions.length === 0 &&
    !e.conditions
  ) {
    e.conditions = "Une recommandation sous conditions énonce au moins une condition.";
  }
  const motif = texteBorne(
    e,
    "motif",
    s.motif,
    { requis: mode === "version", max: MOTIF_MAX },
    "Expliquez la modification.",
  );
  return Object.keys(e).length > 0
    ? { ok: false, erreurs: e }
    : {
        ok: true,
        charge: {
          ...(mode === "creation" ? { titre } : {}),
          recommandation: s.recommandation as RecommandationNote,
          synthese,
          conditions,
          ...(mode === "version" ? { motif } : {}),
        },
      };
}

/** Saisie préremplie depuis un dimensionnement enregistré (nouvelle version). */
export function saisieDepuisDimensionnement(
  d: {
    methode: MethodeDimensionnement;
    libelle: string;
    parametres: {
      code: CodeParametreDimensionnement;
      bas: number;
      base: number;
      haut: number;
      source: { type: "preuve" | "avis_expert"; preuve_id?: string; motif?: string } | null;
    }[];
    ajustements: { libelle: string; facteur_bp: number; motif: string }[];
  },
  devise: Devise,
): SaisieDimensionnement {
  const vers = (code: CodeParametreDimensionnement, v: number): string => {
    const unite = uniteDuParametre(code);
    if (unite === "pourcentage_bp") return bpVersSaisie(v);
    if (unite === "montant") return montantVersSaisie(v, devise);
    return String(v);
  };
  return {
    methode: d.methode,
    libelle: d.libelle,
    parametres: PARAMETRES_DIMENSIONNEMENT[d.methode].map((attendu) => {
      const p = d.parametres.find((x) => x.code === attendu.code);
      return {
        code: attendu.code,
        bas: p ? vers(attendu.code, p.bas) : "",
        base: p ? vers(attendu.code, p.base) : "",
        haut: p ? vers(attendu.code, p.haut) : "",
        source_type: p?.source?.type ?? "",
        preuve_id: p?.source?.type === "preuve" ? (p.source.preuve_id ?? "") : "",
        avis_motif: p?.source?.type === "avis_expert" ? (p.source.motif ?? "") : "",
      };
    }),
    ajustements: d.ajustements.map((a) => ({
      libelle: a.libelle,
      facteur: bpVersSaisie(a.facteur_bp),
      motif: a.motif,
    })),
    motif: "",
  };
}

/** Unité d'un paramètre de dimensionnement (nombre, pourcentage en points de base, montant). */
export function uniteDuParametre(
  code: CodeParametreDimensionnement,
): "nombre" | "pourcentage_bp" | "montant" {
  const tous = [...PARAMETRES_DIMENSIONNEMENT.descendant, ...PARAMETRES_DIMENSIONNEMENT.ascendant];
  return tous.find((p) => p.code === code)?.unite ?? "nombre";
}
