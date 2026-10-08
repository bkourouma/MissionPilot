import { formaterMontant, montant, type Devise } from "@missionpilot/engines";
import type { Db } from "../db/pool.js";
import { tronquer } from "./etat-avancement.js";
import { PLAFONDS_MODELE, type Bloc, type Section } from "./modele.js";

/*
 * Outils communs aux rapports de service (notation, plan stratégique) :
 * MISE EN FORME seulement, jamais de calcul. Les nombres viennent des
 * moteurs (@missionpilot/engines) ou de la base ; ils sont formatés par le
 * moteur (`formaterMontant`) ou par Intl (scores, pourcentages, ratios), sans
 * arrondi ni opération dans l'API.
 */

export const NON_DISPONIBLE = "—";

const SCORE = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const SCORE_SIGNE = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});
const POURCENT = new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 1 });
const DECIMAL = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const ENTIER = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

const estNombre = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Score sur 100 à une décimale (« 62,5 ») ; « — » sans score. */
export const score = (v: number | null | undefined) =>
  estNombre(v) ? SCORE.format(v) : NON_DISPONIBLE;

/** Écart de score signé (« +3,0 », « −1,5 », « 0,0 »). */
export const ecartScore = (v: number | null | undefined) =>
  estNombre(v) ? SCORE_SIGNE.format(v) : NON_DISPONIBLE;

/** Fraction affichée en pourcentage (0,1307 → « 13,1 % »). */
export const pourcentage = (v: number | null | undefined) =>
  estNombre(v) ? POURCENT.format(v) : NON_DISPONIBLE;

/** Taux exprimé en points (12 → « 12 % »). */
export const points = (v: number | null | undefined) =>
  estNombre(v) ? `${DECIMAL.format(v)} %` : NON_DISPONIBLE;

/** Multiple (« 1,25 x »). */
export const multiple = (v: number | null | undefined) =>
  estNombre(v) ? `${DECIMAL.format(v)} x` : NON_DISPONIBLE;

/** Durée en années (« 2,5 ans »). */
export const annees = (v: number | null | undefined) =>
  estNombre(v) ? `${DECIMAL.format(v)} an(s)` : NON_DISPONIBLE;

/** Nombre de jours (« 245 j »). */
export const jours = (v: number | null | undefined) =>
  estNombre(v) ? `${ENTIER.format(v)} j` : NON_DISPONIBLE;

/** Montant en unités mineures de la devise, formaté par le moteur ; « — » s'il n'en est pas un. */
export function montantAffiche(v: unknown, devise: Devise): string {
  return typeof v === "number" && Number.isSafeInteger(v)
    ? formaterMontant(montant(v, devise))
    : NON_DISPONIBLE;
}

/** Texte saisi placé dans une cellule de tableau. */
export const cellule = (texte: string) => tronquer(texte, PLAFONDS_MODELE.longueurCellule);

/** Texte saisi placé dans un paragraphe. */
export const paragraphe = (texte: string): Bloc => ({
  type: "paragraphe",
  texte: tronquer(texte, PLAFONDS_MODELE.longueurTexte),
});

/** Lignes d'un tableau bornées au plafond du modèle, avec la mention des lignes omises. */
export function borner(lignes: string[][]): { lignes: string[][]; note: Bloc[] } {
  const max = PLAFONDS_MODELE.lignesParTableau;
  if (lignes.length <= max) return { lignes, note: [] };
  return {
    lignes: lignes.slice(0, max),
    note: [
      {
        type: "paragraphe",
        texte: `${lignes.length - max} ligne(s) supplémentaire(s) non reproduite(s) : voir l'application.`,
      },
    ],
  };
}

/** Éléments d'une liste bornés au plafond du modèle. */
export function liste(elements: string[]): Bloc {
  return {
    type: "liste",
    elements: elements.slice(0, PLAFONDS_MODELE.elementsParListe).map(cellule),
  };
}

/** Blocs bornés au plafond par section (le dernier bloc signale la coupe). */
export function section(titre: string, blocs: Bloc[]): Section {
  const max = PLAFONDS_MODELE.blocsParSection;
  if (blocs.length <= max) return { titre, blocs };
  return {
    titre,
    blocs: [
      ...blocs.slice(0, max - 1),
      { type: "paragraphe", texte: "Suite non reproduite : voir l'application." },
    ],
  };
}

export interface EnteteMission {
  intitule: string;
  client: string;
  cabinet: string;
}

/** Intitulé, client et cabinet d'une mission déjà contrôlée visible. */
export async function lireEnteteMission(db: Db, missionId: string): Promise<EnteteMission> {
  const r = await db.query(
    `SELECT m.intitule, cl.raison_sociale AS client, cab.nom AS cabinet
     FROM missions m JOIN clients cl ON cl.id = m.client_id
     JOIN cabinets cab ON cab.id = m.cabinet_id
     WHERE m.id = $1`,
    [missionId],
  );
  return r.rows[0] as EnteteMission;
}
