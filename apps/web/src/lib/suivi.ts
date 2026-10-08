/**
 * Suivi budget / réalisé / reste à faire / atterrissage (TPS-06 à TPS-08) : types de
 * `GET /api/missions/:id/suivi` et mise en forme. Tous les chiffres sont calculés par l'API
 * (moteurs) ; ce module ne fait que les présenter. Testé dans `suivi.test.ts`.
 */
import type { TonaliteStatut } from "../components/ui/BadgeStatut";
import { COULEUR_BADGE, type Couleur } from "./decoupage";
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
export const badgeCouleur = (c: Couleur): { tonalite: TonaliteStatut; libelle: string } =>
  COULEUR_BADGE[c] ?? { tonalite: "neutre", libelle: "Sans état" };

/** Signe typographique d'un écart : « + », « \u2212 » (U+2212) ou rien. */
export const signe = (n: number) => (n > 0 ? "+" : n < 0 ? "\u2212" : "");

/** Écart en jours signé, avec le pourcentage s'il est connu : « +2,5 j (+5 %) ». */
export function formaterEcart(ecart: number, relatif: number | null): string {
  const s = signe(ecart);
  const jours = `${s}${formaterJours(Math.abs(ecart))}`;
  return relatif === null ? jours : `${jours} (${s}${formaterPourcentage(Math.abs(relatif))})`;
}

/** Libellé d'une alerte de suivi. */
export function libelleAlerte(a: Pick<AlerteSuivi, "type">): string {
  if (a.type === "consommation_seuil") return "Consommation au-delà du seuil";
  if (a.type === "atterrissage_superieur_budget") return "Atterrissage supérieur au budget";
  return "Alerte de suivi";
}

/**
 * Lecture de l'indice de performance (avancement physique / consommation) : au-dessus de 1,
 * la mission avance plus vite qu'elle ne consomme.
 */
export function lectureIndice(indice: number | null): {
  libelle: string;
  tonalite: TonaliteStatut;
} {
  if (indice === null) return { libelle: "Pas encore mesurable", tonalite: "neutre" };
  if (indice >= 1) return { libelle: "Avance au moins au rythme consommé", tonalite: "succes" };
  return { libelle: "Avance moins vite que la consommation", tonalite: "attention" };
}

/** Nom d'une phase ou d'un nœud cité par une alerte. */
export function libelleNoeud(racine: NoeudSuivi, id: string): string {
  if (racine.id === id) return "Mission";
  const trouve = aplatirArbre(racine).find((l) => l.noeud.id === id);
  return trouve?.noeud.libelle ?? "Élément du découpage";
}
