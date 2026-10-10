/**
 * Bibliothèque d'initiatives types (PLA-13) : types de la réponse de l'API, libellés, contrôle
 * des saisies (initiative type, observation, création d'une initiative du plan) et chemins.
 * Logique pure, testée dans `plan-bibliotheque.test.ts`.
 *
 * L'efficacité observée est synthétisée par le moteur côté API (`syntheseEfficacite`) ;
 * l'échéance d'une initiative créée depuis la bibliothèque aussi (début + durée type).
 */
import {
  NIVEAU_RISQUE_INITIATIVE_LIBELLES,
  NIVEAUX_RISQUE_INITIATIVE,
  TAILLES_CLIENT,
} from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";
import type { Devise } from "./format";
import { cheminPlan, hrefPlan } from "./plan-strategique";
import { decouperListe, lireMontant, lireNombre, montantVersSaisie } from "./saisie";

export type OrigineInitiativeType = "standard" | "variante" | "cabinet";
export type NiveauRisque = (typeof NIVEAUX_RISQUE_INITIATIVE)[number];

export interface SyntheseContexte {
  niveau: "secteur_taille_pays" | "secteur_taille" | "secteur" | "global";
  observations: number;
  moyenne: number | null;
  mediane: number | null;
  minimum: number | null;
  maximum: number | null;
}

export interface EfficaciteObservee {
  niveaux: SyntheseContexte[];
  retenue: SyntheseContexte | null;
  seuil: number;
}

export interface InitiativeType {
  id: string;
  code: string;
  origine: OrigineInitiativeType;
  standard_id: string | null;
  version: number;
  titre: string;
  description: string | null;
  perspective: string | null;
  prerequis: string[];
  risques: { libelle: string; niveau: NiveauRisque }[];
  cout_min: number;
  cout_type: number;
  cout_max: number;
  devise: Devise;
  duree_type_jours: number;
  charge_type_jours: number | null;
  retire: boolean;
  efficacite: EfficaciteObservee;
}

export interface PageBibliotheque {
  contexte: { secteur: string | null; taille: string | null; pays: string | null };
  elements: InitiativeType[];
  curseur_suivant: string | null;
}

const ORIGINES: Record<OrigineInitiativeType, string> = {
  standard: "Standard",
  variante: "Variante du cabinet",
  cabinet: "Propre au cabinet",
};
export const libelleOrigine = (o: string) =>
  ORIGINES[o as OrigineInitiativeType] ?? "Origine inconnue";

const NIVEAUX: Record<SyntheseContexte["niveau"], string> = {
  secteur_taille_pays: "même secteur, même taille et même pays",
  secteur_taille: "même secteur et même taille",
  secteur: "même secteur",
  global: "tous contextes",
};

/** « 70/100 (3 observations, même secteur et même taille) » ou l'échantillon insuffisant. */
export function libelleEfficacite(e: EfficaciteObservee): string {
  const r = e.retenue;
  if (!r) {
    const total = e.niveaux[e.niveaux.length - 1]?.observations ?? 0;
    return `Échantillon insuffisant (${total} observation${total > 1 ? "s" : ""}, ${e.seuil} requises)`;
  }
  return `${r.moyenne}/100 en moyenne (${r.observations} observations, ${NIVEAUX[r.niveau]})`;
}

export const libelleRisque = (r: { libelle: string; niveau: NiveauRisque }) =>
  `${r.libelle} (${NIVEAU_RISQUE_INITIATIVE_LIBELLES[r.niveau] ?? r.niveau})`;

/** Durée affichée : « 90 jours ». */
export const libelleDuree = (jours: number) => `${jours} jour${jours > 1 ? "s" : ""}`;

/* ----- Création d'une initiative du plan depuis la bibliothèque ----- */

export interface SaisieDepuisBibliotheque {
  parent_id: string;
  debut: string;
  echeance: string;
  budget: string;
  titre: string;
  responsable_id: string;
}

export const SAISIE_DEPUIS_BIBLIOTHEQUE_VIDE: SaisieDepuisBibliotheque = {
  parent_id: "",
  debut: "",
  echeance: "",
  budget: "",
  titre: "",
  responsable_id: "",
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Corps de POST /plans/:id/initiatives/depuis-bibliotheque. Budget et échéance facultatifs :
 * l'API reprend le coût type (même devise que le plan) et calcule l'échéance par le moteur.
 */
export function validerDepuisBibliotheque(
  t: Pick<InitiativeType, "id" | "devise">,
  s: SaisieDepuisBibliotheque,
  devisePlan: Devise,
) {
  const erreurs: Partial<Record<keyof SaisieDepuisBibliotheque, string>> = {};
  if (!s.parent_id) erreurs.parent_id = "Choisissez l'axe ou l'objectif de rattachement.";
  if (!DATE.test(s.debut)) erreurs.debut = "La date de début est obligatoire.";
  if (s.echeance && !DATE.test(s.echeance)) erreurs.echeance = "Date invalide.";
  if (s.echeance && DATE.test(s.debut) && s.echeance < s.debut) {
    erreurs.echeance = "L'échéance doit suivre le début.";
  }
  const budget = lireMontant(s.budget, devisePlan);
  if (Number.isNaN(budget)) erreurs.budget = "Montant invalide.";
  if (budget === null && t.devise !== devisePlan) {
    erreurs.budget = `Coût type en ${t.devise}, plan en ${devisePlan} : saisissez le budget.`;
  }
  if (s.titre.trim().length > 200) erreurs.titre = "200 caractères au plus.";
  if (Object.keys(erreurs).length) return { erreurs, corps: null };
  return {
    erreurs,
    corps: {
      initiative_type_id: t.id,
      parent_id: s.parent_id,
      debut: s.debut,
      ...(s.echeance ? { echeance: s.echeance } : {}),
      ...(budget !== null ? { budget } : {}),
      ...(s.titre.trim() ? { titre: s.titre.trim() } : {}),
      ...(s.responsable_id ? { responsable_id: s.responsable_id } : {}),
    },
  };
}

/* ----- Initiative type du cabinet ----- */

export interface SaisieInitiativeType {
  code: string;
  titre: string;
  description: string;
  prerequis: string;
  /** Une ligne par risque : « libellé ; niveau » (faible, moyen, eleve). */
  risques: string;
  cout_min: string;
  cout_type: string;
  cout_max: string;
  devise: Devise;
  duree_type_jours: string;
  charge_type_jours: string;
}

export const SAISIE_INITIATIVE_TYPE_VIDE: SaisieInitiativeType = {
  code: "",
  titre: "",
  description: "",
  prerequis: "",
  risques: "",
  cout_min: "",
  cout_type: "",
  cout_max: "",
  devise: "XOF",
  duree_type_jours: "",
  charge_type_jours: "",
};

/** Saisie préremplie depuis une initiative existante (nouvelle version ou variante). */
export function saisieDepuisInitiative(t: InitiativeType): SaisieInitiativeType {
  const usuel = (v: number) => montantVersSaisie(v, t.devise);
  return {
    code: t.code,
    titre: t.titre,
    description: t.description ?? "",
    prerequis: t.prerequis.join("\n"),
    risques: t.risques.map((r) => `${r.libelle} ; ${r.niveau}`).join("\n"),
    cout_min: usuel(t.cout_min),
    cout_type: usuel(t.cout_type),
    cout_max: usuel(t.cout_max),
    devise: t.devise,
    duree_type_jours: String(t.duree_type_jours),
    charge_type_jours: t.charge_type_jours === null ? "" : String(t.charge_type_jours),
  };
}

const CODE = /^[a-z0-9_]{1,40}$/;

function lireRisques(texte: string): { libelle: string; niveau: NiveauRisque }[] | null {
  const lignes = texte
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const risques: { libelle: string; niveau: NiveauRisque }[] = [];
  for (const l of lignes) {
    const [libelle, niveauBrut] = l.split(";").map((x) => x.trim());
    const niveau = (niveauBrut || "moyen")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "") as NiveauRisque;
    if (!libelle || !NIVEAUX_RISQUE_INITIATIVE.includes(niveau)) return null;
    risques.push({ libelle, niveau });
  }
  return risques;
}

function entierPositif(v: string, max: number): number | null | typeof Number.NaN {
  const n = lireNombre(v);
  if (n === null) return null;
  return Number.isInteger(n) && n >= 0 && n <= max ? n : Number.NaN;
}

/** Contrôle et `donnees` de l'API ; `avecCode` : création d'une initiative propre (code requis). */
export function validerInitiativeType(s: SaisieInitiativeType, avecCode: boolean) {
  const erreurs: Partial<Record<keyof SaisieInitiativeType, string>> = {};
  if (avecCode && !CODE.test(s.code.trim())) {
    erreurs.code = "Code : minuscules, chiffres et tiret bas, 40 caractères au plus.";
  }
  if (!s.titre.trim()) erreurs.titre = "Le titre est obligatoire.";
  const couts = (["cout_min", "cout_type", "cout_max"] as const).map((c) => {
    const v = lireMontant(s[c], s.devise);
    if (v === null || Number.isNaN(v)) erreurs[c] = "Montant obligatoire, positif.";
    return v;
  });
  const [min, type, max] = couts as [number, number, number];
  if (
    !erreurs.cout_min &&
    !erreurs.cout_type &&
    !erreurs.cout_max &&
    !(min <= type && type <= max)
  ) {
    erreurs.cout_type = "Coûts ordonnés : minimum ≤ type ≤ maximum.";
  }
  const duree = entierPositif(s.duree_type_jours, 3650);
  if (duree === null || Number.isNaN(duree) || duree < 1) {
    erreurs.duree_type_jours = "Durée type de 1 à 3 650 jours.";
  }
  const charge = entierPositif(s.charge_type_jours, 100_000);
  if (Number.isNaN(charge)) erreurs.charge_type_jours = "Nombre entier de jours-homme.";
  const risques = lireRisques(s.risques);
  if (!risques) erreurs.risques = "Une ligne par risque : « libellé ; faible, moyen ou eleve ».";
  const prerequis = decouperListe(s.prerequis.replace(/;/g, ","));
  if (prerequis.length > 20) erreurs.prerequis = "20 prérequis au plus.";
  if (Object.keys(erreurs).length) return { erreurs, donnees: null };
  return {
    erreurs,
    donnees: {
      titre: s.titre.trim(),
      description: s.description.trim() || null,
      prerequis,
      risques: risques ?? [],
      cout_min: min,
      cout_type: type,
      cout_max: max,
      devise: s.devise,
      duree_type_jours: duree,
      charge_type_jours: charge,
    },
  };
}

/* ----- Observation d'efficacité ----- */

export interface SaisieObservation {
  efficacite: string;
  secteur: string;
  taille: string;
  pays: string;
  commentaire: string;
}

export const SAISIE_OBSERVATION_VIDE: SaisieObservation = {
  efficacite: "",
  secteur: "",
  taille: "",
  pays: "",
  commentaire: "",
};

export const OPTIONS_TAILLE = TAILLES_CLIENT.map((t) => ({
  valeur: t,
  libelle: { tpe: "TPE", pme: "PME", eti: "ETI", grande_entreprise: "Grande entreprise" }[t],
}));

export function validerObservation(s: SaisieObservation) {
  const erreurs: Partial<Record<keyof SaisieObservation, string>> = {};
  const efficacite = entierPositif(s.efficacite, 100);
  if (efficacite === null || Number.isNaN(efficacite)) {
    erreurs.efficacite = "Efficacité : entier de 0 à 100.";
  }
  const pays = s.pays.trim().toUpperCase();
  if (pays && !/^[A-Z]{2}$/.test(pays)) erreurs.pays = "Code pays à deux lettres (ex. CI).";
  if (s.secteur.trim().length > 80) erreurs.secteur = "80 caractères au plus.";
  if (Object.keys(erreurs).length) return { erreurs, corps: null };
  return {
    erreurs,
    corps: {
      efficacite,
      secteur: s.secteur.trim() || null,
      taille: s.taille || null,
      pays: pays || null,
      commentaire: s.commentaire.trim() || null,
    },
  };
}

/** Message français d'un refus. */
export function messageBibliotheque(e: unknown): string {
  if (e instanceof ErreurApi) {
    if (e.statut === 403) {
      return "Gérer la bibliothèque du cabinet est réservé aux experts métier et aux associés.";
    }
    if (e.statut === 404)
      return "Cette initiative ou ce plan est introuvable ou ne vous est plus accessible.";
    if (e.statut === 409 || e.code === "DEVISE_DIFFERENTE") return e.message;
  }
  return messageErreur(e);
}

const seg = (id: string) => encodeURIComponent(id);

export const HREF_BIBLIOTHEQUE = "/bibliotheque-initiatives";
export const hrefBibliothequePlan = (missionId: string, planId: string) =>
  `${hrefPlan(missionId, planId)}/bibliotheque`;
export const CHEMIN_BIBLIOTHEQUE = "/api/bibliotheque-initiatives";

/** Page de la bibliothèque du cabinet (curseur facultatif). */
export function cheminPageBibliotheque(curseur?: string | null, limite = 30): string {
  const q = new URLSearchParams({ limite: String(limite) });
  if (curseur) q.set("curseur", curseur);
  return `${CHEMIN_BIBLIOTHEQUE}?${q.toString()}`;
}
export const cheminInitiativeType = (id: string) => `${CHEMIN_BIBLIOTHEQUE}/${seg(id)}`;
export const cheminVersionsInitiativeType = (id: string) => `${cheminInitiativeType(id)}/versions`;
export const cheminObservations = (id: string) => `${cheminInitiativeType(id)}/observations`;
export function cheminBibliothequePlan(planId: string, curseur?: string | null): string {
  const q = new URLSearchParams({ limite: "100" });
  if (curseur) q.set("curseur", curseur);
  return `${cheminPlan(planId)}/bibliotheque?${q.toString()}`;
}
export const cheminDepuisBibliotheque = (planId: string) =>
  `${cheminPlan(planId)}/initiatives/depuis-bibliotheque`;
