/**
 * Envoi d'une saisie en attente et rejoueur partagé de l'onglet (feuille de temps et panneau
 * « Saisies en attente » passent par le même : jamais deux rejeux en parallèle).
 */
import { api } from "../api";
import type { Avertissement } from "../temps";
import { creerRejoueur, type SaisieEnAttente } from "./file-temps";

export interface ReponseLignes {
  avertissements?: Avertissement[];
}

/**
 * `PUT` complet des lignes : rejouer la même entrée redonne le même état. L'API ne lit pas
 * d'en-tête `Idempotency-Key` (voir `file-temps.ts`) : la clé de l'entrée n'est pas transmise.
 */
export function envoyerSaisie(e: SaisieEnAttente): Promise<ReponseLignes> {
  if (!e.charge) return Promise.reject(new Error("Saisie à corriger : rien à envoyer."));
  return api.put<ReponseLignes>(
    `/api/feuilles-temps/${encodeURIComponent(e.feuilleId)}/lignes`,
    e.charge,
    { delaiMs: 20_000 },
  );
}

export const rejouer = creerRejoueur();
