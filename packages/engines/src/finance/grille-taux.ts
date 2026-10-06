/**
 * Grilles de taux (FIN-02) : taux de vente standard par grade et taux
 * négociés par client. Un taux négocié valide à la date demandée l'emporte
 * toujours sur le taux standard.
 */
import { joursDepuisEpoque, type DateIso } from "./dates";
import { ErreurFinance } from "./erreurs";
import type { Montant } from "./monnaie";

export interface TauxNegocie {
  readonly clientId: string;
  readonly grade: string;
  readonly taux: Montant;
  /** Début de validité inclus (facultatif : sans borne). */
  readonly valideDu?: DateIso;
  /** Fin de validité incluse (facultatif : sans borne). */
  readonly valideAu?: DateIso;
}

export interface GrilleTaux {
  /** Taux de vente journalier standard, par grade. */
  readonly standard: Readonly<Record<string, Montant>>;
  readonly negocies?: readonly TauxNegocie[];
}

export interface DemandeTaux {
  readonly grade: string;
  readonly clientId?: string;
  /** Date de référence (date de la proposition ou de la prestation). */
  readonly date: DateIso;
}

export interface TauxResolu {
  readonly taux: Montant;
  readonly source: "negocie" | "standard";
}

function estValide(t: TauxNegocie, jour: number): boolean {
  const apresDebut = t.valideDu === undefined || joursDepuisEpoque(t.valideDu) <= jour;
  const avantFin = t.valideAu === undefined || jour <= joursDepuisEpoque(t.valideAu);
  return apresDebut && avantFin;
}

/** Ordre des débuts de validité ; une absence de début est la plus ancienne. */
function comparerDebut(a: TauxNegocie, b: TauxNegocie): number {
  const debutA = a.valideDu === undefined ? -Infinity : joursDepuisEpoque(a.valideDu);
  const debutB = b.valideDu === undefined ? -Infinity : joursDepuisEpoque(b.valideDu);
  return debutA === debutB ? 0 : debutA < debutB ? -1 : 1;
}

/**
 * Résout le taux journalier de vente d'un grade pour un client à une date.
 * Si plusieurs taux négociés sont valides, le plus récent (`valideDu` le plus
 * tardif) l'emporte. Lève `TAUX_INCONNU` si aucun taux n'existe.
 */
export function resoudreTauxGrade(grille: GrilleTaux, demande: DemandeTaux): TauxResolu {
  const jour = joursDepuisEpoque(demande.date);
  const candidats = (grille.negocies ?? [])
    .filter((t) => t.clientId === demande.clientId && t.grade === demande.grade)
    .filter((t) => estValide(t, jour))
    .sort((a, b) => comparerDebut(b, a));
  const negocie = candidats[0];
  if (negocie !== undefined) return { taux: negocie.taux, source: "negocie" };
  const standard = grille.standard[demande.grade];
  if (standard === undefined) {
    throw new ErreurFinance(
      "TAUX_INCONNU",
      `Aucun taux de vente pour le grade « ${demande.grade} ».`,
    );
  }
  return { taux: standard, source: "standard" };
}
