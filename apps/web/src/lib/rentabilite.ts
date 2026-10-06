/**
 * Rentabilité (FIN-12) et encours de production (FIN-11) : contrats de l'API et filtres,
 * testés dans `rentabilite.test.ts`. Marges, taux et encours viennent de l'API (moteur) ;
 * les champs monétaires sont ABSENTS sans « finance.lire ».
 */
import { INDICATEURS_MAX_JOURS, NIVEAUX_RENTABILITE } from "@missionpilot/shared";
import type { StatutMission } from "@missionpilot/shared";
import type { Devise } from "./format";
import { aujourdhui, debutDAnnee, lirePeriode, type Periode } from "./periode";

export type NiveauRentabilite = (typeof NIVEAUX_RENTABILITE)[number];

export interface LigneRentabilite {
  cle: string;
  libelle: string;
  nombre_missions: number;
  honoraires: number;
  couts_internes: number;
  debours_non_refactures: number;
  sous_traitance: number;
  marge: number;
  taux_marge: number | null;
  valeur_produite: number;
  budget: { honoraires: number; marge: number; jours: number };
  realise: { jours: number };
  atterrissage: { jours: number };
}

export interface ReponseRentabilite {
  niveau: NiveauRentabilite;
  du: string;
  au: string;
  devise: Devise;
  elements: LigneRentabilite[];
  total: Omit<
    LigneRentabilite,
    "cle" | "libelle" | "valeur_produite" | "budget" | "realise" | "atterrissage"
  >;
  missions_exclues: { mission_id: string; raison: string }[];
}

export const NIVEAU_RENTABILITE_LIBELLES: Record<NiveauRentabilite, string> = {
  mission: "Mission",
  client: "Client",
  type: "Type de mission",
  associe: "Associé ou directeur",
};

export const OPTIONS_NIVEAUX_RENTABILITE = NIVEAUX_RENTABILITE.map((n) => ({
  valeur: n,
  libelle: NIVEAU_RENTABILITE_LIBELLES[n],
}));

export interface FiltresRentabilite extends Periode {
  niveau: NiveauRentabilite;
  corrigee: boolean;
}

const un = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Période par défaut : depuis le début de l'année. */
export function lireFiltresRentabilite(
  p: Record<string, string | string[] | undefined>,
  jour: string = aujourdhui(),
): FiltresRentabilite {
  const n = un(p.niveau);
  return {
    ...lirePeriode(p, { du: debutDAnnee(jour), au: jour }, INDICATEURS_MAX_JOURS),
    niveau: (NIVEAUX_RENTABILITE as readonly string[]).includes(n)
      ? (n as NiveauRentabilite)
      : "mission",
  };
}

export function requeteRentabilite(f: Periode & { niveau: NiveauRentabilite }): string {
  return new URLSearchParams({ niveau: f.niveau, du: f.du, au: f.au }).toString();
}

export const RAISON_EXCLUSION: Record<string, string> = {
  TAUX_CHANGE_ABSENT:
    "taux de change non figé : montants non convertibles dans la devise du cabinet",
};

// --- Encours de production -----------------------------------------------------------------

export interface EncoursMission {
  mission_id: string;
  intitule: string;
  client_id: string;
  statut: StatutMission;
  jours_valides: number;
  /** Champs suivants : avec « finance.lire » seulement. */
  devise?: Devise;
  jours_non_valorises?: number;
  valeur_produite?: number;
  honoraires_factures?: number;
  encours_production?: number;
  facture_d_avance?: number;
}

export interface ReponseEncours {
  date: string;
  missions: EncoursMission[];
  cabinet?: { devise: Devise; encours_production: number; facture_d_avance: number };
  missions_exclues?: { mission_id: string; raison: string }[];
}

/** `GET /api/missions/:id/encours` : `signee: false` tant que la mission n'est pas signée. */
export type ReponseEncoursMission =
  | { date: string; mission_id: string; signee: false }
  | ({ date: string; signee: true } & EncoursMission);

/** La valorisation est-elle servie ? (champ présent, jamais déduit d'un zéro). */
export const encoursValorise = (e: Pick<EncoursMission, "encours_production">) =>
  typeof e.encours_production === "number";
