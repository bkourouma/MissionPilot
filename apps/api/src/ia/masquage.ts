import type { TermeSensible } from "@missionpilot/shared";

/*
 * Masquage des données identifiantes avant envoi au modèle (PRD,
 * « Confidentialité IA » : « données identifiantes masquées quand c'est
 * possible »). Chaque valeur repérée est remplacée par un jeton stable
 * (« [PERSONNE_1] », « [EMAIL_2] ») ; la réponse est démasquée LOCALEMENT.
 * La table de correspondance ne quitte jamais la mémoire du processus.
 *
 * Préparation du texte : forme NFKC (chiffres et lettres « pleine chasse »,
 * espaces insécables… ramenés à leur forme usuelle) ; un jeton DÉJÀ présent
 * dans l'entrée (« [PERSONNE_1] » écrit par l'utilisateur) est neutralisé
 * (crochet ouvrant remplacé par « ［ », pleine chasse) : il ne peut ni être
 * démasqué en une autre valeur ni exempter un nombre de la garde-chiffres.
 *
 * Repéré, dans cet ordre (une valeur déjà masquée n'est plus relue) :
 * 1. adresses e-mail, EN ENTIER (avant les termes : un nom contenu dans
 *    l'adresse ne la coupe pas en morceaux lisibles) ;
 * 2. les « termes sensibles » fournis explicitement (noms de personnes,
 *    raisons sociales, lieux…), mots entiers, les plus longs d'abord, SANS
 *    tenir compte de la casse ni des accents (« AWA KONE » pour « Awa Koné »),
 *    séparateurs souples (espaces multiples, retour à la ligne, tiret,
 *    apostrophe) et sigles pointés (« S.O.T.R.A. » pour « SOTRA ») ;
 * 3. IBAN (casse quelconque, groupes séparés par espace ou tiret) ; numéros
 *    RCCM (format OHADA) ; numéros de contribuable introduits par « CC »,
 *    « NCC », « IFU », « NINEA », « NIF », « contribuable », « compte
 *    contribuable », « n° contribuable » ; téléphones internationaux
 *    (+… ou 00…), avec indicatif sans + ni 00 (2XX, 33 : « 225 07 07 12 34
 *    56 »), nationaux à 10 chiffres (0X XX XX XX XX) ou 9 chiffres
 *    (7X XXX XX XX).
 *
 * LIMITES (documentées, non garanties) :
 * - un nom propre ABSENT de la liste des termes sensibles n'est pas masqué :
 *   aucun repérage automatique des noms libres n'est fiable ;
 * - un identifiant hors des formats ci-dessus (écriture inhabituelle, faute
 *   de frappe, lettres espacées « S O T R A ») passe en clair ;
 * - le modèle peut altérer un jeton (casse, crochets) : seuls les jetons
 *   restitués à l'identique sont démasqués.
 */

export type CategorieJeton =
  | "PERSONNE"
  | "ORGANISATION"
  | "LIEU"
  | "TERME"
  | "EMAIL"
  | "TELEPHONE"
  | "IBAN"
  | "RCCM"
  | "CONTRIBUABLE";

const CATEGORIE_TERME: Record<string, CategorieJeton> = {
  personne: "PERSONNE",
  organisation: "ORGANISATION",
  lieu: "LIEU",
  autre: "TERME",
};

const CATEGORIES = "PERSONNE|ORGANISATION|LIEU|TERME|EMAIL|TELEPHONE|IBAN|RCCM|CONTRIBUABLE";

/** Jeton produit par le masque (forme exacte). */
const JETON = new RegExp(`\\[(?:${CATEGORIES})_\\d{1,5}\\]`, "g");
/** Jeton (même mal formé : casse, espaces) écrit dans une ENTRÉE : neutralisé. */
const JETON_ENTREE = new RegExp(`\\[(?=\\s*(?:${CATEGORIES})\\s*_\\s*\\d)`, "giu");
/** Crochet ouvrant pleine chasse : un jeton neutralisé n'est plus reconnu. */
export const CROCHET_NEUTRE = "［";

const BORD_AVANT = "(?<![\\p{L}\\p{N}_])";
const BORD_APRES = "(?![\\p{L}\\p{N}_])";

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;

/** Motifs d'identifiants appliqués après les termes (le plus spécifique d'abord). */
const MOTIFS: readonly {
  categorie: CategorieJeton;
  motif: RegExp;
  groupe?: number;
  /** Rend au texte une fin de correspondance qui n'appartient pas à l'identifiant. */
  queue?: RegExp;
}[] = [
  {
    categorie: "IBAN",
    motif:
      /(?<![\p{L}\p{N}])[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]{4}){3,7}(?:[ -]?[A-Z0-9]{1,4})?(?![\p{L}\p{N}])/giu,
    // Casse quelconque : un mot en minuscules qui suit (« … 0589 ou ») n'est pas un groupe.
    queue: /(?:[ -]\p{Ll}+)+$/u,
  },
  {
    categorie: "RCCM",
    motif:
      /(?<![\p{L}\p{N}])[A-Z]{2}[-. ][A-Z]{3}[-. ](?:\d{2}[-. ])?\d{4}[-. ][A-Z]\d{0,2}[-. ]\d{1,6}(?![\p{L}\p{N}])/giu,
  },
  {
    categorie: "CONTRIBUABLE",
    motif:
      /(?<![\p{L}\p{N}])(?:N?CC|IFU|NINEA|NIF|(?:(?:n[°o]\.?|num[eé]ro|compte)\s+(?:de\s+)?)?contribuable)\s*(?:n[°o]\.?\s*)?:?\s*(\d{5,13}(?:\s?[A-Z])?)(?![\p{L}\p{N}])/giu,
    groupe: 1,
  },
  // Téléphones : jamais au milieu d'un nombre groupé par milliers (« 1 500 000 000 »).
  {
    categorie: "TELEPHONE",
    motif: /(?<![\p{L}\p{N}+])(?<!\p{N}[ .,])(?:\+|00)\d{1,3}(?:[ .-]?\d){7,12}(?![\p{N}])/gu,
  },
  // Indicatif sans « + » ni « 00 » : Afrique (2XX, groupes de 2 ou 3 chiffres, jamais un
  // montant groupé par milliers comme « 225 000 000 ») et France (33).
  {
    categorie: "TELEPHONE",
    motif:
      /(?<![\p{L}\p{N}+])(?<!\p{N}[ .,])(?:(?!2\d{2}(?:[ .]\d{3})+(?!\d))2\d{2}(?:[ .-]?\d{2,3}){3,5}|33[ .-]?\d(?:[ .-]?\d{2}){4})(?![\p{N}])/gu,
  },
  {
    categorie: "TELEPHONE",
    motif: /(?<![\p{L}\p{N}])(?<!\p{N}[ .,])0\d(?:[ .-]?\d{2}){4}(?![\p{N}])/gu,
  },
  {
    categorie: "TELEPHONE",
    motif: /(?<![\p{L}\p{N}])(?<!\p{N}[ .,])7\d[ .]\d{3}[ .]\d{2}[ .]\d{2}(?![\p{N}])/gu,
  },
];

function echapperRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Forme de comparaison : NFKC, sans diacritiques, en minuscules. */
export function formeComparaison(s: string): string {
  return s.normalize("NFKC").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Texte « à plat » (sans accents, minuscules) et position d'origine de chaque unité. */
function aPlat(texte: string): { plat: string; debut: number[]; fin: number[] } {
  let plat = "";
  const debut: number[] = [];
  const fin: number[] = [];
  let i = 0;
  for (const ch of texte) {
    const p = ch.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    for (let k = 0; k < p.length; k++) {
      debut.push(i);
      fin.push(i + ch.length);
    }
    plat += p;
    i += ch.length;
  }
  return { plat, debut, fin };
}

const SEPARATEURS_TERME = /[\s.\-'’]+/u;

/** Mots d'un terme sous forme de comparaison ; les lettres isolées consécutives forment un sigle. */
function motsDuTerme(valeur: string): string[] {
  const morceaux = formeComparaison(valeur).trim().split(SEPARATEURS_TERME).filter(Boolean);
  const mots: string[] = [];
  let sigle = "";
  for (const m of morceaux) {
    if ([...m].length === 1) {
      sigle += m;
      continue;
    }
    if (sigle) mots.push(sigle);
    sigle = "";
    mots.push(m);
  }
  if (sigle) mots.push(sigle);
  return mots;
}

/** Expression d'un terme sur le texte à plat : point facultatif entre lettres, séparateurs souples. */
function motifTerme(mots: readonly string[]): RegExp {
  const mot = (m: string) => [...m].map(echapperRegex).join("\\.?");
  return new RegExp(`${BORD_AVANT}${mots.map(mot).join("[\\s.\\-'’]+")}${BORD_APRES}`, "gu");
}

/** Remplace `motif` dans les seuls morceaux du texte situés hors des jetons déjà posés. */
function remplacerHorsJetons(
  texte: string,
  motif: RegExp,
  remplacer: (trouve: string, groupes: unknown[]) => string,
): string {
  const morceaux = texte.split(new RegExp(`(\\[(?:${CATEGORIES})_\\d{1,5}\\])`, "g"));
  return morceaux
    .map((m, i) =>
      i % 2 === 1 ? m : m.replace(motif, (trouve: string, ...g: unknown[]) => remplacer(trouve, g)),
    )
    .join("");
}

/** Neutralise les jetons écrits dans une entrée (crochet ouvrant pleine chasse). */
export function neutraliserJetons(texte: string): string {
  return texte.replace(JETON_ENTREE, CROCHET_NEUTRE);
}

export interface Masque {
  /** Remplace les données identifiantes par des jetons (même valeur → même jeton). */
  masquer(texte: string): string;
  /** Rétablit les valeurs d'origine des jetons restitués à l'identique. */
  demasquer(texte: string): string;
  /** Démasque récursivement les chaînes d'une valeur JSON. */
  demasquerValeur<T>(valeur: T): T;
  /** Ce jeton a-t-il été produit par ce masque ? */
  connait(jeton: string): boolean;
  /** Nombre de jetons par catégorie (journal : jamais les valeurs). */
  compte(): Partial<Record<CategorieJeton, number>>;
}

export function creerMasque(termesSensibles: readonly TermeSensible[] = []): Masque {
  const parCle = new Map<string, string>();
  const parJeton = new Map<string, string>();
  const compteurs = new Map<CategorieJeton, number>();

  const jetonDe = (categorie: CategorieJeton, valeur: string, cle: string): string => {
    const id = `${categorie}:${cle}`;
    const existant = parCle.get(id);
    if (existant) return existant;
    const n = (compteurs.get(categorie) ?? 0) + 1;
    compteurs.set(categorie, n);
    const jeton = `[${categorie}_${n}]`;
    parCle.set(id, jeton);
    parJeton.set(jeton, valeur);
    return jeton;
  };

  const termes = termesSensibles
    .map((t) =>
      typeof t === "string"
        ? { mots: motsDuTerme(t), categorie: "PERSONNE" as CategorieJeton }
        : { mots: motsDuTerme(t.valeur), categorie: CATEGORIE_TERME[t.categorie] ?? "TERME" },
    )
    .filter((t) => t.mots.join("").length >= 2)
    .sort((a, b) => b.mots.join(" ").length - a.mots.join(" ").length)
    .map((t) => ({ ...t, cle: t.mots.join(" "), motif: motifTerme(t.mots) }));

  /** Termes sensibles : repérés sur le texte à plat, remplacés sur le texte d'origine. */
  const masquerTermes = (texte: string): string => {
    if (termes.length === 0) return texte;
    const { plat, debut, fin } = aPlat(texte);
    const couvert: [number, number][] = [];
    // Jetons déjà posés (e-mails) : jamais repris par un terme.
    for (const m of texte.matchAll(JETON)) couvert.push([m.index, m.index + m[0].length]);
    const chevauche = (a: number, b: number) => couvert.some(([x, y]) => a < y && x < b);
    const trouves: { a: number; b: number; jeton: string }[] = [];
    for (const t of termes) {
      for (const m of plat.matchAll(t.motif)) {
        if (m[0].length === 0) continue;
        const a = debut[m.index] as number;
        const b = fin[m.index + m[0].length - 1] as number;
        if (chevauche(a, b)) continue;
        couvert.push([a, b]);
        trouves.push({ a, b, jeton: jetonDe(t.categorie, texte.slice(a, b), t.cle) });
      }
    }
    trouves.sort((x, y) => x.a - y.a);
    let resultat = "";
    let curseur = 0;
    for (const { a, b, jeton } of trouves) {
      resultat += texte.slice(curseur, a) + jeton;
      curseur = b;
    }
    return resultat + texte.slice(curseur);
  };

  /** Même identifiant, quelle que soit sa mise en forme (casse, espaces, tirets, points) → même jeton. */
  const cleIdentifiant = (v: string) => formeComparaison(v).replace(/[\s.-]/g, "");

  const masquer = (texte: string): string => {
    let resultat = neutraliserJetons(texte.normalize("NFKC"));
    resultat = remplacerHorsJetons(resultat, EMAIL, (trouve) =>
      jetonDe("EMAIL", trouve, formeComparaison(trouve)),
    );
    resultat = masquerTermes(resultat);
    for (const { categorie, motif, groupe, queue } of MOTIFS) {
      resultat = remplacerHorsJetons(resultat, motif, (trouve, groupes) => {
        if (queue) {
          const reste = queue.exec(trouve)?.[0] ?? "";
          const valeur = trouve.slice(0, trouve.length - reste.length);
          // Sans sa queue, trop court pour un IBAN (14 caractères au moins) : ce n'en est pas un.
          if (cleIdentifiant(valeur).length < 14) return trouve;
          return jetonDe(categorie, valeur, cleIdentifiant(valeur)) + reste;
        }
        if (groupe === undefined) return jetonDe(categorie, trouve, cleIdentifiant(trouve));
        const valeur = groupes[groupe - 1];
        if (typeof valeur !== "string") return trouve;
        return trouve.replace(valeur, jetonDe(categorie, valeur, cleIdentifiant(valeur)));
      });
    }
    return resultat;
  };

  const demasquer = (texte: string): string =>
    texte.replace(JETON, (jeton: string) => parJeton.get(jeton) ?? jeton);

  const demasquerValeur = <T>(valeur: T): T => {
    if (typeof valeur === "string") return demasquer(valeur) as T;
    if (Array.isArray(valeur)) return valeur.map((v) => demasquerValeur(v)) as T;
    if (valeur !== null && typeof valeur === "object") {
      return Object.fromEntries(
        Object.entries(valeur as Record<string, unknown>).map(([k, v]) => [k, demasquerValeur(v)]),
      ) as T;
    }
    return valeur;
  };

  return {
    masquer,
    demasquer,
    demasquerValeur,
    connait: (jeton) => parJeton.has(jeton),
    compte: () => Object.fromEntries(compteurs) as Partial<Record<CategorieJeton, number>>,
  };
}

/** Jetons (forme exacte) présents dans un texte, dans l'ordre. */
export function jetonsDans(texte: string): string[] {
  return [...texte.matchAll(JETON)].map((m) => m[0]);
}

/**
 * Retire d'un texte les jetons CONNUS du masque (la garde-chiffres ne doit pas
 * lire leurs numéros). Un jeton inconnu (forgé par l'entrée ou par le modèle)
 * reste en place : la garde-chiffres le signale.
 */
export function sansJetons(texte: string, masque?: Pick<Masque, "connait">): string {
  return texte.replace(JETON, (jeton) => (masque?.connait(jeton) ? " " : jeton));
}
