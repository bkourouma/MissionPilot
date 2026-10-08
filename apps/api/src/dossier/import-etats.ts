import { DECIMALES_DEVISE, ErreurDossier, lireMontantTexte } from "@missionpilot/engines";
import {
  LIGNES_ETAT_FINANCIER_MAX,
  ROLES_LIGNE_ETAT_DOSSIER,
  SECTIONS_ETAT_FINANCIER_DOSSIER,
  type Devise,
  type LigneEtatFinancierSaisie,
  type ReferenceValeur,
  type RoleLigneEtatDossier,
  type SectionEtatDossier,
} from "@missionpilot/shared";
import type { TableauImport } from "../temps/import.js";

/*
 * Lecture d'un état financier depuis un tableau (CSV, ou première feuille visible d'un
 * classeur .xlsx déjà contrôlé par le lecteur borné `temps/import-excel.ts`).
 *
 * Colonnes (en-tête sans accent ni casse imposés) : section, code, libelle, montant, et
 * facultatives parent, role. Sections : actif, passif, charges, produits, resultat. Rôles :
 * total, resultat_exercice (« résultat de l'exercice »), resultat_net (« résultat net »).
 * Montants lus EXACTEMENT par le moteur (`lireMontantTexte`) selon les décimales de la devise.
 * Chaque valeur garde sa référence : fichier, cellule Excel (ex. D12) ou ligne du CSV.
 * Toute ligne en erreur bloque l'ingestion (rapport ligne par ligne, rien n'est écrit).
 */

export interface ErreurLigneEtat {
  ligne: number;
  message: string;
}

export interface LectureEtat {
  lignes: LigneEtatFinancierSaisie[];
  erreurs: ErreurLigneEtat[];
}

export interface OrigineTableau {
  format: "csv" | "excel";
  fichier: string | null;
}

/** Minuscules sans accents, espaces et apostrophes → « _ ». */
export function normaliser(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[\s'\u2019-]+/g, "_");
}

const ALIAS_ROLES: Record<string, RoleLigneEtatDossier> = {
  total: "total",
  resultat_exercice: "resultat_exercice",
  resultat_de_l_exercice: "resultat_exercice",
  resultat_net: "resultat_net",
};

/** Lettres de colonne Excel (1 → A, 27 → AA). */
export function lettresColonne(index: number): string {
  let n = index;
  let lettres = "";
  while (n > 0) {
    const reste = (n - 1) % 26;
    lettres = String.fromCharCode(65 + reste) + lettres;
    n = (n - 1 - reste) / 26;
  }
  return lettres;
}

function colonnes(entete: string[]): { indices: Map<string, number>; manquantes: string[] } {
  const indices = new Map<string, number>();
  entete.forEach((c, i) => {
    const nom = normaliser(c);
    if (nom && !indices.has(nom)) indices.set(nom, i);
  });
  const manquantes = ["section", "code", "libelle", "montant"].filter((c) => !indices.has(c));
  return { indices, manquantes };
}

function reference(
  origine: OrigineTableau,
  numero: number,
  colonneMontant: number,
): ReferenceValeur {
  return origine.format === "excel"
    ? {
        fichier: origine.fichier,
        cellule: `${lettresColonne(colonneMontant + 1)}${numero}`,
        ligne: numero,
      }
    : { fichier: origine.fichier, ligne: numero };
}

/** Une ligne du tableau → ligne d'état, ou le message de sa première erreur. */
function lireLigne(
  valeurs: string[],
  indices: Map<string, number>,
  devise: Devise,
): LigneEtatFinancierSaisie | string {
  const v = (nom: string) => {
    const i = indices.get(nom);
    return i === undefined ? "" : (valeurs[i] ?? "").trim();
  };
  const section = normaliser(v("section")) as SectionEtatDossier;
  if (!(SECTIONS_ETAT_FINANCIER_DOSSIER as readonly string[]).includes(section)) {
    return "section inconnue (actif, passif, charges, produits ou resultat attendue)";
  }
  const code = v("code");
  if (!/^[A-Za-z0-9_.-]{1,40}$/.test(code)) return "code de poste invalide";
  const libelle = v("libelle");
  if (libelle.length === 0 || libelle.length > 200)
    return "libellé absent ou trop long (200 caractères au plus)";
  const parent = v("parent");
  if (parent && !/^[A-Za-z0-9_.-]{1,40}$/.test(parent)) return "code parent invalide";
  const roleBrut = normaliser(v("role"));
  const role = roleBrut ? ALIAS_ROLES[roleBrut] : null;
  if (
    role === undefined ||
    (role && !(ROLES_LIGNE_ETAT_DOSSIER as readonly string[]).includes(role))
  ) {
    return "rôle inconnu (total, resultat_exercice ou resultat_net attendu)";
  }
  let montant: number;
  try {
    montant = lireMontantTexte(v("montant"), DECIMALES_DEVISE[devise]);
  } catch (e) {
    if (e instanceof ErreurDossier) return e.message;
    throw e;
  }
  return { code, libelle, section, montant, parent: parent || null, role };
}

/** Lit les lignes d'un état depuis un tableau ; les erreurs sont rapportées par ligne. */
export function lireEtatDepuisTableau(
  tableau: TableauImport,
  devise: Devise,
  origine: OrigineTableau,
): LectureEtat {
  const { indices, manquantes } = colonnes(tableau.entete);
  if (manquantes.length > 0) {
    return {
      lignes: [],
      erreurs: [{ ligne: 1, message: `Colonnes manquantes : ${manquantes.join(", ")}.` }],
    };
  }
  if (tableau.lignes.length > LIGNES_ETAT_FINANCIER_MAX) {
    return {
      lignes: [],
      erreurs: [
        { ligne: 1, message: `${LIGNES_ETAT_FINANCIER_MAX} lignes au plus par état financier.` },
      ],
    };
  }
  if (tableau.lignes.length === 0) {
    return { lignes: [], erreurs: [{ ligne: 1, message: "Aucune ligne de données." }] };
  }
  const montantCol = indices.get("montant") as number;
  const lignes: LigneEtatFinancierSaisie[] = [];
  const erreurs: ErreurLigneEtat[] = [];
  for (const l of tableau.lignes) {
    const erreurCellule = l.erreurs?.find((e) => e !== undefined);
    if (erreurCellule) {
      erreurs.push({ ligne: l.numero, message: erreurCellule });
      continue;
    }
    const lue = lireLigne(l.valeurs, indices, devise);
    if (typeof lue === "string")
      erreurs.push({ ligne: l.numero, message: `Ligne ${l.numero} : ${lue}.` });
    else lignes.push({ ...lue, reference: reference(origine, l.numero, montantCol) });
  }
  return { lignes, erreurs };
}
