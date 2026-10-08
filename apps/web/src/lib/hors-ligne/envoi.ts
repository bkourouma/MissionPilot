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
 * `PUT` complet des lignes, avec la clé d'idempotence de l'entrée (en-tête `Idempotency-Key`) :
 * l'API n'applique jamais deux fois la même clé, un rejeu tardif n'écrase donc pas une saisie
 * plus récente (la réponse est alors l'état courant de la feuille, en-tête `Idempotency-Replayed`).
 */
export function envoyerSaisie(e: SaisieEnAttente): Promise<ReponseLignes> {
  if (!e.charge) return Promise.reject(new Error("Saisie à corriger : rien à envoyer."));
  return api.put<ReponseLignes>(
    `/api/feuilles-temps/${encodeURIComponent(e.feuilleId)}/lignes`,
    e.charge,
    { delaiMs: 20_000, entetes: { "Idempotency-Key": e.cle } },
  );
}

export const rejouer = creerRejoueur();
