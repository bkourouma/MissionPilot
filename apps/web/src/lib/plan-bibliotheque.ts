/**
 * Bibliothèque d'initiatives types (PLA-13) : types de la réponse de l'API, libellés, contrôle
 * des saisies (initiative type, observation, création d'une initiative du plan) et chemins.
 * Logique pure, testée dans `plan-bibliotheque.test.ts`.
 *
 * L'efficacité observée est synthétisée par le moteur côté API (`syntheseEfficacite`) ;
 * l'échéance d'une initiative créée depuis la bibliothèque aussi (début + durée type).
 */
import {
  creerTraduire,
  NIVEAU_RISQUE_INITIATIVE_LIBELLES,
  NIVEAUX_RISQUE_INITIATIVE,
  TAILLES_CLIENT,
  type Langue,
} from "@missionpilot/shared";
import { ErreurApi, messageErreur } from "./api";
import { libelleDevise, type Devise } from "./format";
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
const ORIGINES_EN: Record<OrigineInitiativeType, string> = {
  standard: "Standard",
  variante: "Firm variant",
  cabinet: "Firm-specific",
};
export const libelleOrigine = (o: string, langue: Langue = "fr") =>
  (langue === "en" ? ORIGINES_EN : ORIGINES)[o as OrigineInitiativeType] ??
  (langue === "en" ? "Unknown origin" : "Origine inconnue");

const NIVEAUX_EN: Record<SyntheseContexte["niveau"], string> = {
  secteur_taille_pays: "same sector, size and country",
  secteur_taille: "same sector and size",
  secteur: "same sector",
  global: "all contexts",
};

const NIVEAUX: Record<SyntheseContexte["niveau"], string> = {
  secteur_taille_pays: "même secteur, même taille et même pays",
  secteur_taille: "même secteur et même taille",
  secteur: "même secteur",
  global: "tous contextes",
};

/** « 70/100 (3 observations, même secteur et même taille) » ou l'échantillon insuffisant. */
export function libelleEfficacite(e: EfficaciteObservee, langue: Langue = "fr"): string {
  const r = e.retenue;
  if (!r) {
    const total = e.niveaux[e.niveaux.length - 1]?.observations ?? 0;
    if (langue === "en") {
      return `Insufficient sample (${total} observation${total > 1 ? "s" : ""}, ${e.seuil} required)`;
    }
    return `Échantillon insuffisant (${total} observation${total > 1 ? "s" : ""}, ${e.seuil} requises)`;
  }
  if (langue === "en") {
    return `${r.moyenne}/100 on average (${r.observations} observations, ${NIVEAUX_EN[r.niveau]})`;
  }
  return `${r.moyenne}/100 en moyenne (${r.observations} observations, ${NIVEAUX[r.niveau]})`;
}

const NIVEAU_RISQUE_EN: Record<NiveauRisque, string> = {
  faible: "Low",
  moyen: "Medium",
  eleve: "High",
};

export const libelleRisque = (
  r: { libelle: string; niveau: NiveauRisque },
  langue: Langue = "fr",
) =>
  `${r.libelle} (${(langue === "en" ? NIVEAU_RISQUE_EN : NIVEAU_RISQUE_INITIATIVE_LIBELLES)[r.niveau] ?? r.niveau})`;

/** Durée affichée : « 90 jours ». */
export const libelleDuree = (jours: number, langue: Langue = "fr") =>
  langue === "en" ? `${jours} day${jours > 1 ? "s" : ""}` : `${jours} jour${jours > 1 ? "s" : ""}`;

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
  langue: Langue = "fr",
) {
  const tr = creerTraduire(langue);
  const erreurs: Partial<Record<keyof SaisieDepuisBibliotheque, string>> = {};
  if (!s.parent_id)
    erreurs.parent_id = tr(
      "Choisissez l'axe ou l'objectif de rattachement.",
      "Choose the axis or objective to attach it to.",
    );
  if (!DATE.test(s.debut))
    erreurs.debut = tr("La date de début est obligatoire.", "The start date is required.");
  if (s.echeance && !DATE.test(s.echeance))
    erreurs.echeance = tr("Date invalide.", "Invalid date.");
  if (s.echeance && DATE.test(s.debut) && s.echeance < s.debut) {
    erreurs.echeance = tr(
      "L'échéance doit suivre le début.",
      "The due date must follow the start.",
    );
  }
  const budget = lireMontant(s.budget, devisePlan);
  if (Number.isNaN(budget)) erreurs.budget = tr("Montant invalide.", "Invalid amount.");
  if (budget === null && t.devise !== devisePlan) {
    erreurs.budget = tr(
      `Coût type en ${libelleDevise(t.devise)}, plan en ${libelleDevise(devisePlan)} : saisissez le budget.`,
      `Standard cost in ${libelleDevise(t.devise)}, plan in ${libelleDevise(devisePlan)}: enter the budget.`,
    );
  }
  if (s.titre.trim().length > 200)
    erreurs.titre = tr("200 caractères au plus.", "200 characters at most.");
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
export function validerInitiativeType(
  s: SaisieInitiativeType,
  avecCode: boolean,
  langue: Langue = "fr",
) {
  const tr = creerTraduire(langue);
  const erreurs: Partial<Record<keyof SaisieInitiativeType, string>> = {};
  if (avecCode && !CODE.test(s.code.trim())) {
    erreurs.code = tr(
      "Code : minuscules, chiffres et tiret bas, 40 caractères au plus.",
      "Code: lowercase letters, digits and underscores, 40 characters at most.",
    );
  }
  if (!s.titre.trim()) erreurs.titre = tr("Le titre est obligatoire.", "The title is required.");
  const couts = (["cout_min", "cout_type", "cout_max"] as const).map((c) => {
    const v = lireMontant(s[c], s.devise);
    if (v === null || Number.isNaN(v))
      erreurs[c] = tr("Montant obligatoire, positif.", "A positive amount is required.");
    return v;
  });
  const [min, type, max] = couts as [number, number, number];
  if (
    !erreurs.cout_min &&
    !erreurs.cout_type &&
    !erreurs.cout_max &&
    !(min <= type && type <= max)
  ) {
    erreurs.cout_type = tr(
      "Coûts ordonnés : minimum ≤ type ≤ maximum.",
      "Costs must be ordered: minimum ≤ standard ≤ maximum.",
    );
  }
  const duree = entierPositif(s.duree_type_jours, 3650);
  if (duree === null || Number.isNaN(duree) || duree < 1) {
    erreurs.duree_type_jours = tr(
      "Durée type de 1 à 3 650 jours.",
      "Standard duration of 1 to 3,650 days.",
    );
  }
  const charge = entierPositif(s.charge_type_jours, 100_000);
  if (Number.isNaN(charge))
    erreurs.charge_type_jours = tr("Nombre entier de jours-homme.", "Whole number of person-days.");
  const risques = lireRisques(s.risques);
  if (!risques) {
    erreurs.risques = tr(
      "Une ligne par risque : « libellé ; faible, moyen ou eleve ».",
      "One line per risk: \u201clabel ; faible, moyen or eleve\u201d (low, medium or high).",
    );
  }
  const prerequis = decouperListe(s.prerequis.replace(/;/g, ","));
  if (prerequis.length > 20)
    erreurs.prerequis = tr("20 prérequis au plus.", "20 prerequisites at most.");
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

export const optionsTaille = (langue: Langue = "fr") =>
  TAILLES_CLIENT.map((t) => ({
    valeur: t,
    libelle: {
      tpe: "TPE",
      pme: "PME",
      eti: "ETI",
      grande_entreprise: langue === "en" ? "Large enterprise" : "Grande entreprise",
    }[t],
  }));

export const OPTIONS_TAILLE = optionsTaille();

export function validerObservation(s: SaisieObservation, langue: Langue = "fr") {
  const tr = creerTraduire(langue);
  const erreurs: Partial<Record<keyof SaisieObservation, string>> = {};
  const efficacite = entierPositif(s.efficacite, 100);
  if (efficacite === null || Number.isNaN(efficacite)) {
    erreurs.efficacite = tr(
      "Efficacité : entier de 0 à 100.",
      "Effectiveness: whole number from 0 to 100.",
    );
  }
  const pays = s.pays.trim().toUpperCase();
  if (pays && !/^[A-Z]{2}$/.test(pays))
    erreurs.pays = tr("Code pays à deux lettres (ex. CI).", "Two-letter country code (e.g. CI).");
  if (s.secteur.trim().length > 80)
    erreurs.secteur = tr("80 caractères au plus.", "80 characters at most.");
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
export function messageBibliotheque(e: unknown, langue: Langue = "fr"): string {
  const tr = creerTraduire(langue);
  if (e instanceof ErreurApi) {
    if (e.statut === 403) {
      return tr(
        "Gérer la bibliothèque du cabinet est réservé aux experts métier et aux associés.",
        "Managing the firm's library is restricted to subject-matter experts and partners.",
      );
    }
    if (e.statut === 404)
      return tr(
        "Cette initiative ou ce plan est introuvable ou ne vous est plus accessible.",
        "This initiative or plan cannot be found or is no longer accessible to you.",
      );
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
