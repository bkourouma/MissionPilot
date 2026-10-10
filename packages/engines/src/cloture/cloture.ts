/**
 * Décision de clôture d'une mission (AUT-08, PRD complémentaire §8) : à partir des items actifs
 * de la check-list du cabinet, du nombre d'écarts relevé par chaque contrôle déterministe et des
 * dérogations en vigueur, dit si la clôture est autorisée.
 *
 * Règles :
 * - un item inactif n'est pas évalué et ne bloque jamais ;
 * - un item est « conforme » quand son contrôle ne relève aucun écart (`nombre_ecarts` = 0) ;
 * - un item non conforme et NON bloquant est un avertissement : la clôture reste possible ;
 * - un item non conforme et bloquant interdit la clôture, sauf dérogation motivée en vigueur ;
 * - un contrôle qui n'a pas pu conclure (`nombre_ecarts` = null, ex. attestation manquante)
 *   est non conforme.
 *
 * Fonction pure et déterministe : les contrôles eux-mêmes (requêtes en base, montants par les
 * moteurs de finance) sont dans l'API ; ce moteur ne porte que la décision.
 */

export type CodeErreurCloture = "ENTREE_INVALIDE";

export class ErreurCloture extends Error {
  readonly code: CodeErreurCloture;

  constructor(code: CodeErreurCloture, message: string) {
    super(message);
    this.name = "ErreurCloture";
    this.code = code;
  }
}

export interface EntreeCloture {
  controle: string;
  actif: boolean;
  bloquant: boolean;
  /** Écarts relevés par le contrôle ; null : le contrôle n'a pas conclu (non conforme). */
  nombre_ecarts: number | null;
  /** Une dérogation motivée est en vigueur pour cet item sur la mission. */
  derogation: boolean;
}

export type EtatItemCloture = "inactif" | "conforme" | "avertissement" | "deroge" | "bloque";

export interface LigneCloture {
  controle: string;
  actif: boolean;
  bloquant: boolean;
  etat: EtatItemCloture;
  nombre_ecarts: number | null;
  /** Vrai si cet item interdit la clôture. */
  bloque: boolean;
}

export interface DecisionCloture {
  lignes: LigneCloture[];
  autorisee: boolean;
  /** Codes des contrôles bloquants non conformes et sans dérogation, dans l'ordre d'entrée. */
  bloquants: string[];
}

export function decisionCloture(entrees: readonly EntreeCloture[]): DecisionCloture {
  const vus = new Set<string>();
  const lignes: LigneCloture[] = [];
  for (const e of entrees) {
    if (!e.controle || vus.has(e.controle)) {
      throw new ErreurCloture("ENTREE_INVALIDE", "Contrôle de clôture vide ou en double.");
    }
    vus.add(e.controle);
    if (e.nombre_ecarts !== null && (!Number.isInteger(e.nombre_ecarts) || e.nombre_ecarts < 0)) {
      throw new ErreurCloture("ENTREE_INVALIDE", "Nombre d'écarts : entier positif ou nul.");
    }
    let etat: EtatItemCloture;
    if (!e.actif) etat = "inactif";
    else if (e.nombre_ecarts === 0) etat = "conforme";
    else if (!e.bloquant) etat = "avertissement";
    else if (e.derogation) etat = "deroge";
    else etat = "bloque";
    lignes.push({
      controle: e.controle,
      actif: e.actif,
      bloquant: e.bloquant,
      etat,
      nombre_ecarts: e.nombre_ecarts,
      bloque: etat === "bloque",
    });
  }
  const bloquants = lignes.filter((l) => l.bloque).map((l) => l.controle);
  return { lignes, autorisee: bloquants.length === 0, bloquants };
}
