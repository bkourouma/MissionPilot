import { ErreurAppelsOffres, libellesProches, normaliserTerme } from "./commun";
import {
  PROFIL_COMPETENCES_MAX,
  PROFIL_REFERENCES_MAX,
  rapprocherAppelOffres,
  type ComposanteRapprochement,
  type ProfilCabinet,
  type Rapprochement,
  type ReferenceCabinet,
} from "./rapprochement";

/**
 * Veille multi-sources des appels d'offres (AO-01, PRD complémentaire §9) : analyse d'un import
 * CSV ou JSON, clé de dédoublonnage et rapprochement EXPLIQUÉ avec le profil étendu du cabinet.
 *
 * Fonctions pures et déterministes : aucune horloge, aucun réseau, aucune exécution du contenu
 * importé (le texte n'est jamais interprété autrement que comme des données). Les chiffres
 * (scores) sortent de `rapprocherAppelOffres` ; ce module n'y ajoute que des raisons en français.
 */

/** Plafonds d'import (déni de service). */
export const VEILLE_IMPORT_OCTETS_MAX = 1_048_576;
export const VEILLE_IMPORT_AVIS_MAX = 200;

export const VEILLE_DEVISES = ["XOF", "XAF", "EUR", "USD"] as const;

/** Avis brut d'une source ou d'un import, avant dédoublonnage. */
export interface VeilleAvisBrut {
  reference: string | null;
  titre: string;
  objet: string | null;
  bailleur: string | null;
  pays: string | null;
  secteur: string | null;
  montant_estime: number | null;
  devise: string | null;
  date_publication: string | null;
  date_limite: string | null;
  url: string | null;
  mots_cles: string[];
}

export interface VeilleErreurLigne {
  /** Numéro de ligne (CSV : en-tête = 1) ou de rang (JSON : premier élément = 1). */
  ligne: number;
  message: string;
}

export type VeilleFormat = "csv" | "json";

export interface VeilleAnalyse {
  format: VeilleFormat;
  avis: VeilleAvisBrut[];
  erreurs: VeilleErreurLigne[];
}

/** Colonne d'import, avec ses intitulés admis (français ou techniques), normalisés. */
const COLONNES: Record<keyof VeilleAvisBrut, readonly string[]> = {
  reference: ["reference", "ref", "reference externe", "numero"],
  titre: ["titre", "intitule", "libelle", "title"],
  objet: ["objet", "description", "resume"],
  bailleur: ["bailleur", "financeur", "bailleur de fonds", "donor"],
  pays: ["pays", "country"],
  secteur: ["secteur", "sector", "domaine"],
  montant_estime: ["montant estime", "montant", "budget", "amount"],
  devise: ["devise", "currency"],
  date_publication: ["date publication", "date de publication", "publication", "published"],
  date_limite: ["date limite", "date limite de depot", "echeance", "deadline"],
  url: ["url", "lien", "adresse"],
  mots_cles: ["mots cles", "motscles", "keywords", "tags"],
};

const CHAMP_PAR_ENTETE = new Map<string, keyof VeilleAvisBrut>(
  (Object.keys(COLONNES) as (keyof VeilleAvisBrut)[]).flatMap((champ) =>
    COLONNES[champ].map((e) => [e, champ] as const),
  ),
);

/** Champ de l'avis désigné par un en-tête (français ou technique), sinon null. */
function champDeEntete(entete: string): keyof VeilleAvisBrut | null {
  return CHAMP_PAR_ENTETE.get(normaliserTerme(entete)) ?? null;
}

// eslint-disable-next-line no-control-regex
const CONTROLES = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

const nettoyer = (valeur: string): string => valeur.replace(CONTROLES, "").trim();

/** Découpe un texte CSV en enregistrements (guillemets, guillemets doublés, retours internes). */
function decouperCsv(texte: string, sep: string): string[][] | null {
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let champ = "";
  let entre = false;
  let i = 0;
  while (i < texte.length) {
    const c = texte[i] as string;
    if (entre) {
      if (c === '"' && texte[i + 1] === '"') {
        champ += '"';
        i += 1;
      } else if (c === '"') entre = false;
      else champ += c;
    } else if (c === '"' && champ === "") entre = true;
    else if (c === sep) {
      ligne.push(champ);
      champ = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texte[i + 1] === "\n") i += 1;
      ligne.push(champ);
      lignes.push(ligne);
      ligne = [];
      champ = "";
    } else champ += c;
    i += 1;
  }
  if (entre) return null;
  if (champ !== "" || ligne.length > 0) {
    ligne.push(champ);
    lignes.push(ligne);
  }
  return lignes;
}

/** Séparateur : point-virgule s'il domine la virgule dans la première ligne (hors guillemets). */
function detecterSeparateur(texte: string): string {
  let virgules = 0;
  let pointsVirgules = 0;
  let entre = false;
  for (const c of texte) {
    if (c === '"') entre = !entre;
    else if (!entre && (c === "\n" || c === "\r")) break;
    else if (!entre && c === ",") virgules += 1;
    else if (!entre && c === ";") pointsVirgules += 1;
  }
  return pointsVirgules > virgules ? ";" : ",";
}

function dateIso(brut: string): string | null {
  let iso: string;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(brut);
  if (m) iso = `${m[3]}-${(m[2] as string).padStart(2, "0")}-${(m[1] as string).padStart(2, "0")}`;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(brut)) iso = brut;
  else return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return null;
  return iso >= "2000-01-01" && iso <= "2100-12-31" ? iso : null;
}

type Brut = Partial<Record<keyof VeilleAvisBrut, unknown>>;

class Refus extends Error {}

function lireTexte(brut: Brut, champ: keyof VeilleAvisBrut, max: number): string | null {
  const v = brut[champ];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" && typeof v !== "number") {
    throw new Refus(`« ${champ} » doit être un texte.`);
  }
  const s = nettoyer(String(v));
  if (s.length > max) throw new Refus(`« ${champ} » dépasse ${max} caractères.`);
  return s === "" ? null : s;
}

function lireMontant(brut: Brut): number | null {
  const m = brut.montant_estime;
  if (m === undefined || m === null || String(m).trim() === "") return null;
  const chiffres = String(m).replace(/[\s\u00a0\u202f]/g, "");
  if (!/^\d{1,15}$/.test(chiffres)) throw new Refus("Montant : entier positif attendu.");
  return Number(chiffres);
}

function lireMots(brut: Brut): string[] {
  const v = brut.mots_cles;
  let mots: string[] = [];
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) mots = v as string[];
  else if (typeof v === "string") mots = v.split(/[|;,]/);
  else if (v !== undefined && v !== null)
    throw new Refus("« mots_cles » : liste de textes attendue.");
  mots = [...new Set(mots.map(nettoyer).filter((x) => x !== ""))];
  if (mots.length > 30 || mots.some((x) => x.length > 80)) {
    throw new Refus("Mots-clés : 30 au plus, 80 caractères chacun.");
  }
  return mots;
}

/** Valide un enregistrement brut (valeurs scalaires) ; retourne l'avis ou le message d'erreur. */
function validerAvis(brut: Brut): VeilleAvisBrut | string {
  try {
    const titre = lireTexte(brut, "titre", 300);
    if (!titre) return "Titre obligatoire.";
    const pays = lireTexte(brut, "pays", 2)?.toUpperCase() ?? null;
    if (pays !== null && !/^[A-Z]{2}$/.test(pays)) return "Pays : code ISO à deux lettres attendu.";
    const devise = lireTexte(brut, "devise", 3)?.toUpperCase() ?? null;
    if (devise !== null && !(VEILLE_DEVISES as readonly string[]).includes(devise)) {
      return "Devise : XOF, XAF, EUR ou USD attendue.";
    }
    const dates: Record<"date_publication" | "date_limite", string | null> = {
      date_publication: null,
      date_limite: null,
    };
    for (const champ of ["date_publication", "date_limite"] as const) {
      const d = lireTexte(brut, champ, 20);
      if (d === null) continue;
      dates[champ] = dateIso(d);
      if (dates[champ] === null) {
        return `« ${champ} » : date AAAA-MM-JJ ou JJ/MM/AAAA entre 2000 et 2100 attendue.`;
      }
    }
    const url = lireTexte(brut, "url", 500);
    if (url !== null && !/^https?:\/\/[^\s<>"]+$/i.test(url)) {
      return "Adresse http ou https attendue.";
    }
    return {
      reference: lireTexte(brut, "reference", 80),
      titre,
      objet: lireTexte(brut, "objet", 4000),
      bailleur: lireTexte(brut, "bailleur", 150),
      pays,
      secteur: lireTexte(brut, "secteur", 120),
      montant_estime: lireMontant(brut),
      devise,
      date_publication: dates.date_publication,
      date_limite: dates.date_limite,
      url,
      mots_cles: lireMots(brut),
    };
  } catch (e) {
    if (e instanceof Refus) return e.message;
    /* c8 ignore next */
    throw e;
  }
}

function enregistrementJson(element: unknown): Brut | string {
  if (typeof element !== "object" || element === null || Array.isArray(element)) {
    return "Un avis est un objet clé-valeur.";
  }
  const brut: Brut = {};
  for (const [cle, valeur] of Object.entries(element)) {
    const champ = champDeEntete(cle);
    if (champ !== null) brut[champ] = valeur;
  }
  return brut;
}

const tropDAvis = () =>
  new ErreurAppelsOffres(
    "ENTREE_INVALIDE",
    `Trop d'avis : ${VEILLE_IMPORT_AVIS_MAX} au plus par import.`,
  );

function analyserJson(corps: string): VeilleAnalyse {
  const avis: VeilleAvisBrut[] = [];
  const erreurs: VeilleErreurLigne[] = [];
  let donnees: unknown;
  try {
    donnees = JSON.parse(corps);
  } catch {
    return { format: "json", avis, erreurs: [{ ligne: 1, message: "JSON invalide." }] };
  }
  const liste =
    typeof donnees === "object" && donnees !== null && !Array.isArray(donnees)
      ? (donnees as Record<string, unknown>).avis
      : donnees;
  if (!Array.isArray(liste)) {
    const message = 'Une liste d\'avis (ou { "avis": [...] }) est attendue.';
    return { format: "json", avis, erreurs: [{ ligne: 1, message }] };
  }
  if (liste.length > VEILLE_IMPORT_AVIS_MAX) throw tropDAvis();
  liste.forEach((element, i) => {
    const brut = enregistrementJson(element);
    const r = typeof brut === "string" ? brut : validerAvis(brut);
    if (typeof r === "string") erreurs.push({ ligne: i + 1, message: r });
    else avis.push(r);
  });
  return { format: "json", avis, erreurs };
}

function analyserCsv(corps: string): VeilleAnalyse {
  const avis: VeilleAvisBrut[] = [];
  const erreurs: VeilleErreurLigne[] = [];
  const lignes = decouperCsv(corps, detecterSeparateur(corps));
  if (lignes === null) {
    return { format: "csv", avis, erreurs: [{ ligne: 1, message: "Guillemet non refermé." }] };
  }
  const champs = (lignes[0] ?? []).map((e) => champDeEntete(e));
  if (!champs.includes("titre")) {
    const message = "Colonne « titre » introuvable dans l'en-tête.";
    return { format: "csv", avis, erreurs: [{ ligne: 1, message }] };
  }
  const vide = (cellules: string[]) => !cellules.some((c) => c.trim() !== "");
  if (lignes.slice(1).filter((l) => !vide(l)).length > VEILLE_IMPORT_AVIS_MAX) throw tropDAvis();
  lignes.slice(1).forEach((cellules, i) => {
    if (vide(cellules)) return;
    const brut: Brut = {};
    champs.forEach((champ, k) => {
      if (champ !== null && brut[champ] === undefined) brut[champ] = cellules[k];
    });
    const r = validerAvis(brut);
    if (typeof r === "string") erreurs.push({ ligne: i + 2, message: r });
    else avis.push(r);
  });
  return { format: "csv", avis, erreurs };
}

/**
 * Analyse un import (CSV ou JSON, détecté d'après le premier caractère utile) : renvoie les
 * avis valides et les erreurs PAR LIGNE. Hors plafonds (1 Mo, 200 avis) : `ErreurAppelsOffres`.
 * BOM, séparateur virgule ou point-virgule, guillemets, en-têtes français ou techniques.
 */
export function veilleAnalyserImport(texte: string, format?: VeilleFormat): VeilleAnalyse {
  if (new TextEncoder().encode(texte).length > VEILLE_IMPORT_OCTETS_MAX) {
    throw new ErreurAppelsOffres("ENTREE_INVALIDE", "Fichier trop volumineux (1 Mo au plus).");
  }
  const corps = texte.replace(/^\uFEFF/, "");
  const premier = corps.trimStart()[0];
  const fmt = format ?? (premier === "[" || premier === "{" ? "json" : "csv");
  return fmt === "json" ? analyserJson(corps) : analyserCsv(corps);
}

/**
 * Clé de dédoublonnage : référence externe normalisée (casse, accents, ponctuation et espaces
 * neutralisés), sinon titre + bailleur + date limite normalisés.
 */
export function veilleCleDedoublonnage(avis: {
  reference?: string | null;
  titre: string;
  bailleur?: string | null;
  date_limite?: string | null;
}): string {
  const ref = normaliserTerme(avis.reference ?? "").replace(/ /g, "");
  if (ref !== "") return `ref:${ref}`;
  const bailleur = normaliserTerme(avis.bailleur ?? "");
  return `titre:${normaliserTerme(avis.titre)}|${bailleur}|${(avis.date_limite ?? "").trim()}`;
}

export type VeilleEtatDedoublonnage = "nouveau" | "connu" | "repete";

export interface VeilleEntree {
  rang: number;
  cle: string;
  avis: VeilleAvisBrut;
  /** nouveau : première vue ; connu : clé déjà en base ; repete : répétée dans le même lot. */
  etat: VeilleEtatDedoublonnage;
}

/** Dédoublonne un lot d'avis contre les clés déjà connues (résultats, fiches) et dans le lot. */
export function veilleDedoublonner(
  avis: readonly VeilleAvisBrut[],
  connues: ReadonlySet<string>,
): VeilleEntree[] {
  const vues = new Set<string>();
  return avis.map((a, rang) => {
    const cle = veilleCleDedoublonnage(a);
    let etat: VeilleEtatDedoublonnage = "nouveau";
    if (vues.has(cle)) etat = "repete";
    else if (connues.has(cle)) etat = "connu";
    vues.add(cle);
    return { rang, cle, avis: a, etat };
  });
}

/** Profil étendu du cabinet pour la veille. */
export interface VeilleProfil {
  /** Profil existant : compétences des collaborateurs, secteurs, missions et fiches gagnées. */
  base: ProfilCabinet;
  /** Compétences du référentiel ayant au moins un niveau VALIDÉ (matrice de compétences). */
  competencesMatrice: readonly string[];
  /** Références de la banque (une entrée par secteur déclaré). */
  referencesBanque: readonly ReferenceCabinet[];
}

export interface VeilleRapprochement {
  score: number;
  composantes: Record<ComposanteRapprochement, number>;
  /** Raisons du score, en français : secteur, pays, compétences, références, bailleur. */
  raisons: string[];
  competencesTrouvees: string[];
  competencesMatriceTrouvees: string[];
  referencesBanque: { secteur: number; pays: number; bailleur: number };
  rapprochement: Rapprochement;
}

/** Profil unique (compétences fusionnées, références de la banque ajoutées) pour le moteur. */
export function veilleProfilCabinet(profil: VeilleProfil): ProfilCabinet {
  return {
    competences: [...profil.base.competences, ...profil.competencesMatrice].slice(
      0,
      PROFIL_COMPETENCES_MAX,
    ),
    secteurs: profil.base.secteurs,
    references: [...profil.base.references, ...profil.referencesBanque].slice(
      0,
      PROFIL_REFERENCES_MAX,
    ),
  };
}

const memeTexte = (a: string | null, b: string | null) =>
  a !== null &&
  b !== null &&
  normaliserTerme(a) !== "" &&
  normaliserTerme(a) === normaliserTerme(b);

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/** Rapprochement d'un avis avec le profil étendu : `rapprocherAppelOffres` + raisons expliquées. */
export function rapprocherVeille(avis: VeilleAvisBrut, profil: VeilleProfil): VeilleRapprochement {
  const r = rapprocherAppelOffres(
    {
      titre: avis.titre,
      objet: avis.objet,
      secteur: avis.secteur,
      pays: avis.pays,
      bailleur: avis.bailleur,
      motsCles: avis.mots_cles,
    },
    veilleProfilCabinet(profil),
  );
  const matrice = new Set(profil.competencesMatrice.map((c) => c.trim()));
  const matriceTrouvee = r.competencesTrouvees.filter((c) => matrice.has(c));
  const banque = profil.referencesBanque.slice(0, PROFIL_REFERENCES_MAX);
  const bSecteur = banque.filter((x) => libellesProches(x.secteur, avis.secteur)).length;
  const bPays = banque.filter((x) => memeTexte(x.pays, avis.pays)).length;
  const bBailleur = banque.filter((x) => memeTexte(x.bailleur, avis.bailleur)).length;

  const raisons: string[] = [];
  if (r.composantes.secteur > 0) {
    raisons.push(`Secteur « ${avis.secteur} » déjà couvert par le cabinet.`);
  } else if (avis.secteur) {
    raisons.push(`Secteur « ${avis.secteur} » absent des secteurs et références du cabinet.`);
  } else raisons.push("Secteur non renseigné dans l'avis.");
  if (r.referencesPays > 0) {
    const n = pluriel(r.referencesPays, "référence", "références");
    raisons.push(`${n} dans le même pays (${avis.pays}).`);
  } else if (avis.pays) raisons.push(`Aucune référence dans le pays (${avis.pays}).`);
  if (r.competencesTrouvees.length > 0) {
    const n = pluriel(
      r.competencesTrouvees.length,
      "compétence retrouvée",
      "compétences retrouvées",
    );
    raisons.push(`${n} : ${r.competencesTrouvees.join(", ")}.`);
    if (matriceTrouvee.length > 0) {
      raisons.push(`Dont validées dans la matrice de compétences : ${matriceTrouvee.join(", ")}.`);
    }
  } else raisons.push("Aucune compétence du cabinet retrouvée dans l'avis.");
  const morceaux = [
    bSecteur > 0 ? `${bSecteur} dans le même secteur` : "",
    bPays > 0 ? `${bPays} dans le même pays` : "",
    bBailleur > 0 ? `${bBailleur} avec le même bailleur` : "",
  ].filter((x) => x !== "");
  if (morceaux.length > 0) raisons.push(`Références de la banque : ${morceaux.join(", ")}.`);
  if (r.referencesBailleur > 0) {
    raisons.push(`Bailleur « ${avis.bailleur} » déjà rencontré dans les références.`);
  }
  return {
    score: r.score,
    composantes: r.composantes,
    raisons,
    competencesTrouvees: r.competencesTrouvees,
    competencesMatriceTrouvees: matriceTrouvee,
    referencesBanque: { secteur: bSecteur, pays: bPays, bailleur: bBailleur },
    rapprochement: r,
  };
}
