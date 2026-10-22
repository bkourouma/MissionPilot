import { appelOffresCreationSchema, type AppelOffresCreation } from "@missionpilot/shared";
import type { Devise } from "./format";
import { ou } from "./appels-offres-saisie-base";
import { decouperListe, lireMontant, type Resultat } from "./saisie";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAYS = /^[A-Za-z]{2}$/;

export interface SaisieFiche {
  reference: string;
  titre: string;
  objet: string;
  bailleur: string;
  pays: string;
  secteur: string;
  montant: string;
  devise: Devise;
  date_limite: string;
  url: string;
  mots_cles: string;
}

export const SAISIE_FICHE_VIDE: SaisieFiche = {
  reference: "",
  titre: "",
  objet: "",
  bailleur: "",
  pays: "",
  secteur: "",
  montant: "",
  devise: "XOF",
  date_limite: "",
  url: "",
  mots_cles: "",
};

/** Saisie du formulaire → corps de création, ou erreurs par champ. */
export function validerFiche(s: SaisieFiche): Resultat<AppelOffresCreation, keyof SaisieFiche> {
  const erreurs: Partial<Record<keyof SaisieFiche, string>> = {};
  const titre = s.titre.trim();
  if (titre === "") erreurs.titre = "Donnez l'intitulé de l'appel d'offres.";
  else if (titre.length > 300) erreurs.titre = "300 caractères au plus.";
  if (s.pays.trim() !== "" && !PAYS.test(s.pays.trim())) {
    erreurs.pays = "Code pays à deux lettres (ex. CI, SN).";
  }
  const montant = lireMontant(s.montant, s.devise);
  if (montant !== null && Number.isNaN(montant)) erreurs.montant = "Montant illisible.";
  if (s.date_limite.trim() !== "" && !DATE.test(s.date_limite.trim())) {
    erreurs.date_limite = "Date au format AAAA-MM-JJ.";
  }
  if (s.url.trim() !== "" && !/^https?:\/\/[^\s<>"]+$/i.test(s.url.trim())) {
    erreurs.url = "Adresse http ou https.";
  }
  if (Object.keys(erreurs).length > 0) return { ok: false, erreurs };
  return {
    ok: true,
    charge: {
      reference: ou(s.reference),
      titre,
      objet: ou(s.objet),
      bailleur: ou(s.bailleur),
      pays: ou(s.pays)?.toUpperCase() ?? null,
      secteur: ou(s.secteur),
      montant_estime: montant,
      devise: s.devise,
      date_limite: ou(s.date_limite),
      url: ou(s.url),
      mots_cles: decouperListe(s.mots_cles.replace(/\|/g, ",")),
    },
  };
}

/** Colonnes attendues de l'import CSV (en-tête obligatoire, ordre libre). */
export const COLONNES_IMPORT = [
  "reference",
  "titre",
  "bailleur",
  "pays",
  "secteur",
  "montant",
  "devise",
  "date_limite",
  "url",
  "mots_cles",
] as const;

/** Une ligne CSV (guillemets doubles, séparateur `;` ou `,`) → cellules. */
export function cellulesCsv(ligne: string, separateur: string): string[] {
  const cellules: string[] = [];
  let courante = "";
  let entreGuillemets = false;
  for (let i = 0; i < ligne.length; i += 1) {
    const c = ligne[i] as string;
    if (entreGuillemets) {
      if (c === '"' && ligne[i + 1] === '"') {
        courante += '"';
        i += 1;
      } else if (c === '"') entreGuillemets = false;
      else courante += c;
    } else if (c === '"') entreGuillemets = true;
    else if (c === separateur) {
      cellules.push(courante.trim());
      courante = "";
    } else courante += c;
  }
  cellules.push(courante.trim());
  return cellules;
}

const sansAccents = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z_]/g, "_");

/**
 * Import manuel (AO-01) : texte CSV collé ou lu d'un fichier → fiches validées par le schéma
 * partagé, et erreurs par ligne (numéro de ligne du fichier, en-tête = 1). 200 fiches au plus.
 */
export function analyserImportCsv(texte: string): {
  fiches: AppelOffresCreation[];
  erreurs: { ligne: number; message: string }[];
} {
  const lignes = texte
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const entete = lignes[0] ?? "";
  const separateur =
    (entete.match(/;/g) ?? []).length >= (entete.match(/,/g) ?? []).length ? ";" : ",";
  const colonnes = cellulesCsv(entete, separateur).map(sansAccents);
  if (!colonnes.includes("titre")) {
    return { fiches: [], erreurs: [{ ligne: 1, message: "En-tête sans colonne « titre »." }] };
  }
  const fiches: AppelOffresCreation[] = [];
  const erreurs: { ligne: number; message: string }[] = [];
  for (const [i, brute] of lignes.slice(1).entries()) {
    if (brute.trim() === "") continue;
    const numero = i + 2;
    if (fiches.length >= 200) {
      erreurs.push({ ligne: numero, message: "200 fiches au plus par import." });
      break;
    }
    const valeurs = cellulesCsv(brute, separateur);
    const v = (nom: string) => valeurs[colonnes.indexOf(nom)] ?? "";
    const devise = (v("devise").toUpperCase() || "XOF") as Devise;
    const r = validerFiche({
      ...SAISIE_FICHE_VIDE,
      reference: v("reference"),
      titre: v("titre"),
      bailleur: v("bailleur"),
      pays: v("pays"),
      secteur: v("secteur"),
      montant: v("montant"),
      devise,
      date_limite: v("date_limite"),
      url: v("url"),
      mots_cles: v("mots_cles"),
    });
    if (!r.ok) {
      erreurs.push({ ligne: numero, message: Object.values(r.erreurs).join(" ") });
      continue;
    }
    const controle = appelOffresCreationSchema.safeParse(r.charge);
    if (!controle.success) {
      erreurs.push({ ligne: numero, message: "Valeurs refusées (devise, date ou longueur)." });
      continue;
    }
    fiches.push(controle.data);
  }
  return { fiches, erreurs };
}
