import { ajouterJours } from "@missionpilot/engines";
import type { PalierRelanceSalle, StatutPieceSalle } from "@missionpilot/shared";

/*
 * Règles pures de la salle de mission (CLI-01) : synthèse d'une demande, pièces en attente,
 * paliers de relance. Aucun accès à la base ; testées dans test/salle-mission-regles.test.ts.
 *
 * Paliers automatiques (valeurs posées, à valider par le métier : DECISIONS.md) : rappel trois
 * jours AVANT l'échéance, relance le lendemain de l'échéance, relance ferme sept jours après
 * (avec alerte au chef et au directeur de la mission). Heure d'exécution : 8 h UTC, début de
 * journée dans la zone UEMOA (comme les relances du lundi des feuilles de temps).
 */

export type PalierAutomatique = Exclude<PalierRelanceSalle, "manuelle">;

export const PALIERS_AUTOMATIQUES: readonly { palier: PalierAutomatique; jours: number }[] = [
  { palier: "rappel_j_moins_3", jours: -3 },
  { palier: "relance_j_plus_1", jours: 1 },
  { palier: "relance_j_plus_7", jours: 7 },
];

export const HEURE_RELANCE_SALLE_UTC = "08:00:00";

/** Délai minimal entre deux relances d'un même destinataire (relance manuelle). */
export const DELAI_MIN_RELANCE_SALLE_HEURES = 24;

/** Palier hors de la liste fermée `PALIERS_AUTOMATIQUES` (erreur de programmation, jamais d'entrée). */
export class ErreurPalierSalle extends Error {
  constructor(readonly palier: string) {
    super(`Palier de relance inconnu : ${palier}.`);
    this.name = "ErreurPalierSalle";
  }
}

/** Instant d'exécution d'un palier pour une échéance (AAAA-MM-JJ). */
export function instantPalier(echeance: string, palier: PalierAutomatique): Date {
  const p = PALIERS_AUTOMATIQUES.find((x) => x.palier === palier);
  if (!p) throw new ErreurPalierSalle(palier);
  return new Date(`${ajouterJours(echeance, p.jours)}T${HEURE_RELANCE_SALLE_UTC}Z`);
}

/** Paliers encore à venir à `maintenant` (un palier passé n'est pas rattrapé). */
export function paliersAVenir(
  echeance: string,
  maintenant: Date,
): { palier: PalierAutomatique; executeA: Date }[] {
  return PALIERS_AUTOMATIQUES.map((p) => ({
    palier: p.palier,
    executeA: instantPalier(echeance, p.palier),
  })).filter((p) => p.executeA.getTime() > maintenant.getTime());
}

export interface SynthesePieces {
  total: number;
  demandee: number;
  recue: number;
  acceptee: number;
  rejetee: number;
  /** Pièces obligatoires pas encore acceptées. */
  obligatoires_restantes: number;
}

/** Décompte des pièces d'une demande par statut. */
export function synthesePieces(
  pieces: readonly { statut: StatutPieceSalle; obligatoire: boolean }[],
): SynthesePieces {
  const s: SynthesePieces = {
    total: pieces.length,
    demandee: 0,
    recue: 0,
    acceptee: 0,
    rejetee: 0,
    obligatoires_restantes: 0,
  };
  for (const p of pieces) {
    s[p.statut] += 1;
    if (p.obligatoire && p.statut !== "acceptee") s.obligatoires_restantes += 1;
  }
  return s;
}

/** Une pièce attend un (nouveau) dépôt du client : demandée, ou rejetée. */
export const attendDepot = (statut: StatutPieceSalle): boolean =>
  statut === "demandee" || statut === "rejetee";

/** Le client peut-il (encore) déposer sur cette pièce ? (demande envoyée, pièce non acceptée) */
export const depotOuvert = (statutDemande: string, statutPiece: StatutPieceSalle): boolean =>
  statutDemande === "envoyee" && statutPiece !== "acceptee";

/** Date JJ/MM/AAAA d'une date AAAA-MM-JJ (textes de notification). */
export function dateFr(iso: string): string {
  const [a, m, j] = iso.slice(0, 10).split("-");
  return `${j}/${m}/${a}`;
}

/** « JJ/MM/AAAA à HH:MM (UTC) » d'un instant (accusé de réception). */
export function horodatageFr(instant: Date): string {
  const iso = instant.toISOString();
  return `${dateFr(iso)} à ${iso.slice(11, 16)} (UTC)`;
}
