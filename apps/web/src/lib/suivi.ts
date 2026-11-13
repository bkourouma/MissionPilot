/**
 * Suivi budget / réalisé / reste à faire / atterrissage (TPS-06 à TPS-08) : types de
 * `GET /api/missions/:id/suivi` et mise en forme. Tous les chiffres sont calculés par l'API
 * (moteurs) ; ce module ne fait que les présenter. Testé dans `suivi.test.ts`.
 */
import { creerTraduire, type Langue } from "@missionpilot/shared";
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { couleurBadge, type Couleur } from "./decoupage";
import { formaterJours, formaterPourcentage } from "./format";

export interface ValeursSuivi {
  budget: number;
  realise: number;
  reste_a_faire: number;
  atterrissage: number;
  ecart: number;
  ecart_relatif: number | null;
  consommation: number | null;
  couleur: Couleur;
}

export interface NoeudSuivi extends ValeursSuivi {
  id: string;
  niveau: "mission" | "phase" | "lot" | "tache";
  libelle: string | null;
  en_attente: number;
  reste_a_faire_estime?: boolean;
  enfants: NoeudSuivi[];
}

export interface AlerteSuivi {
  niveau: "mission" | "phase";
  noeud_id: string;
  type: "consommation_seuil" | "atterrissage_superieur_budget" | string;
  message: string;
  declenchee_le: string;
}

export interface SuiviMission {
  mission: { id: string; intitule: string | null; statut: string };
  seuils: {
    consommation_orange_pct: number;
    atterrissage_orange_pct: number;
    atterrissage_rouge_pct: number;
  };
  arbre: NoeudSuivi;
  par_personne: (ValeursSuivi & {
    collaborateur_id: string;
    nom: string | null;
    grade_code: string | null;
  })[];
  par_grade: (ValeursSuivi & {
    grade_id: string | null;
    grade_code: string | null;
    grade_libelle: string;
  })[];
  en_attente: number;
  performance: {
    avancement: number;
    consommation: number | null;
    indice: number | null;
    ecart_points: number | null;
    elements: number;
  } | null;
  alertes: AlerteSuivi[];
}

export const NIVEAU_LIBELLES: Record<NoeudSuivi["niveau"], string> = {
  mission: "Mission",
  phase: "Phase",
  lot: "Lot",
  tache: "Tâche",
};

export const NIVEAU_LIBELLES_EN: Record<NoeudSuivi["niveau"], string> = {
  mission: "Engagement",
  phase: "Phase",
  lot: "Work package",
  tache: "Task",
};

/** Libellé d'un niveau de l'arbre dans la langue demandée. */
export const libelleNiveau = (niveau: NoeudSuivi["niveau"], langue: Langue = "fr") =>
  langue === "en" ? NIVEAU_LIBELLES_EN[niveau] : NIVEAU_LIBELLES[niveau];

/** Ligne du tableau à plat : profondeur 0 (phase) à 2 (tâche d'un lot). */
export interface LigneArbre {
  noeud: NoeudSuivi;
  profondeur: number;
}

/** Arbre → lignes (phases, lots, tâches) dans l'ordre du découpage, sans la racine. */
export function aplatirArbre(racine: NoeudSuivi): LigneArbre[] {
  const lignes: LigneArbre[] = [];
  const visiter = (n: NoeudSuivi, profondeur: number) => {
    lignes.push({ noeud: n, profondeur });
    for (const e of n.enfants) visiter(e, profondeur + 1);
  };
  for (const p of racine.enfants) visiter(p, 0);
  return lignes;
}

/** Badge de couleur avec son libellé (jamais la couleur seule). */
export const badgeCouleur = (
  c: Couleur,
  langue: Langue = "fr",
): { tonalite: TonaliteStatut; libelle: string } =>
  couleurBadge(c, langue) ?? {
    tonalite: "neutre",
    libelle: creerTraduire(langue)("Sans état", "No status"),
  };

/** Signe typographique d'un écart : « + », « \u2212 » (U+2212) ou rien. */
export const signe = (n: number) => (n > 0 ? "+" : n < 0 ? "\u2212" : "");

/** Écart en jours signé, avec le pourcentage s'il est connu : « +2,5 j (+5 %) ». */
export function formaterEcart(
  ecart: number,
  relatif: number | null,
  langue: Langue = "fr",
): string {
  const s = signe(ecart);
  const jours = `${s}${formaterJours(Math.abs(ecart), langue)}`;
  return relatif === null
    ? jours
    : `${jours} (${s}${formaterPourcentage(Math.abs(relatif), 1, langue)})`;
}

/** Libellé d'une alerte de suivi. */
export function libelleAlerte(a: Pick<AlerteSuivi, "type">, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  if (a.type === "consommation_seuil")
    return t("Consommation au-delà du seuil", "Consumption above the threshold");
  if (a.type === "atterrissage_superieur_budget")
    return t("Atterrissage supérieur au budget", "Landing above budget");
  return t("Alerte de suivi", "Tracking alert");
}

/**
 * Lecture de l'indice de performance (avancement physique / consommation) : au-dessus de 1,
 * la mission avance plus vite qu'elle ne consomme.
 */
export function lectureIndice(
  indice: number | null,
  langue: Langue = "fr",
): {
  libelle: string;
  tonalite: TonaliteStatut;
} {
  const t = creerTraduire(langue);
  if (indice === null)
    return { libelle: t("Pas encore mesurable", "Not yet measurable"), tonalite: "neutre" };
  if (indice >= 1)
    return {
      libelle: t("Avance au moins au rythme consommé", "Progressing at least at the pace consumed"),
      tonalite: "succes",
    };
  return {
    libelle: t("Avance moins vite que la consommation", "Progressing slower than consumption"),
    tonalite: "attention",
  };
}

/** Nom d'une phase ou d'un nœud cité par une alerte. */
export function libelleNoeud(racine: NoeudSuivi, id: string, langue: Langue = "fr"): string {
  const t = creerTraduire(langue);
  if (racine.id === id) return t("Mission", "Engagement");
  const trouve = aplatirArbre(racine).find((l) => l.noeud.id === id);
  return trouve?.noeud.libelle ?? t("Élément du découpage", "Work breakdown item");
}
