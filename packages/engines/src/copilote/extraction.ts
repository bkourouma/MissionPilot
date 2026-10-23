import { analyserDateISO, dateISODepuisJourUTC } from "../commun/dates";
import { plierTexteCopilote } from "./normalisation";

/*
 * Extraction de paramètres simples dans un message en français (routage déterministe du
 * copilote). Les motifs s'appliquent au texte PLIÉ ; les valeurs rendues sont des tranches du
 * texte ORIGINAL (même position : voir normalisation.ts), donc avec leur casse et leurs accents.
 * Aucune valeur n'est interprétée : elle ne sert qu'à CHERCHER (mission, personne, mots) ou à
 * remplir une proposition que l'utilisateur relit avant de confirmer.
 */

const COUPURE = /(?:\s*(?:s'il\s+(?:te|vous)\s+pla[iî]t|svp|stp|merci)\b.*)$/;

/** Texte (original, plié) dont une tranche a été retirée. */
export interface Paire {
  original: string;
  plie: string;
}

export const depuisTexte = (texte: string): Paire => ({
  original: texte,
  plie: plierTexteCopilote(texte),
});

export function retirer(p: Paire, debut: number, fin: number): Paire {
  return {
    original: p.original.slice(0, debut) + " " + p.original.slice(fin),
    plie: p.plie.slice(0, debut) + " " + p.plie.slice(fin),
  };
}

/** Valeur nettoyée : guillemets, ponctuation de fin, formules de politesse retirés. */
export function nettoyerValeur(original: string, plie: string): string {
  const coupe = COUPURE.exec(plie);
  const fin = coupe ? coupe.index : original.length;
  return original
    .slice(0, fin)
    .replace(/^[\s:,;\-–"'«»]+/, "")
    .replace(/[\s.,;:!?"'«»]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const MOTS_VIDES_NOM = new Set([
  "ci",
  "ce",
  "cette",
  "celle",
  "ma",
  "mon",
  "la",
  "le",
  "les",
  "l",
  "en",
  "cours",
  "actuelle",
  "courante",
  "mission",
  "missions",
  "moi",
  "meme",
]);

/** Un nom exploitable : au moins deux caractères et pas seulement des pronoms ou déterminants. */
export function nomExploitable(valeur: string): boolean {
  const mots = plierTexteCopilote(valeur)
    .split(/[^a-z0-9]+/)
    .filter((m) => m !== "");
  return mots.join("").length >= 2 && !mots.every((m) => MOTS_VIDES_NOM.has(m));
}

export function extraireNomMission(texte: string): string | undefined {
  const { original, plie } = depuisTexte(texte);
  const motifs = [
    /\bou\s+en\s+est\s+(?:la\s+|le\s+|l')?(?:mission\s+)?(.+)$/d,
    /\bmission\s+(?:de\s+|du\s+|des\s+|d')?(.+)$/d,
    /\b(?:resume|resumer|point|situation|etat|avancement|bilan|synthese)\s+(?:sur|de|du|des|d')\s*(?:la\s+|le\s+|l')?(?:mission\s+)?(.+)$/d,
  ];
  for (const motif of motifs) {
    const m = motif.exec(plie);
    const g = m?.indices?.[1];
    if (!g) continue;
    const valeur = nettoyerValeur(original.slice(g[0], g[1]), plie.slice(g[0], g[1]));
    if (nomExploitable(valeur)) return valeur.slice(0, 200);
  }
  return undefined;
}

export function extraireTexteRecherche(texte: string): string | undefined {
  const { original, plie } = depuisTexte(texte);
  const m =
    /\b(?:cherches?|chercher|recherch(?:e|es|er)|trouv(?:e|es|er)|retrouv(?:e|es|er))\s+(?:moi\s+)?(?:(?:des|du|de|les|le|la|l'|un|une|d')\s*)*(?:(?:sur|a\s+propos\s+de|concernant|autour\s+de)\s+)?(.+)$/d.exec(
      plie,
    );
  const g = m?.indices?.[1];
  // Un verbe de recherche sans rien derrière : pas de mots à chercher.
  if (!g && /\b(?:cherch|recherch|trouv|retrouv)/.test(plie)) return undefined;
  const brut = g
    ? nettoyerValeur(original.slice(g[0], g[1]), plie.slice(g[0], g[1]))
    : nettoyerValeur(original, plie);
  return brut.length >= 2 ? brut.slice(0, 200) : undefined;
}

/* ----- Échéance ----- */

export type ResultatEcheance =
  | { type: "date"; date: string; debut: number; fin: number }
  | { type: "invalide"; debut: number; fin: number };

const PREPOSITION_DATE =
  /(?:\b(?:avant|pour|d'ici|d\s+ici|au\s+plus\s+tard|echeance|jusqu'au|jusqu\s+au|le|au)\s*:?\s*)+$/;

function deuxChiffres(n: number): string {
  return String(n).padStart(2, "0");
}

/** Date ISO dont l'année est dans la plage admise (2000 à 2100) et le jour existe, sinon null. */
function dateValide(annee: number, mois: number, jour: number): string | null {
  const iso = `${String(annee).padStart(4, "0")}-${deuxChiffres(mois)}-${deuxChiffres(jour)}`;
  if (!analyserDateISO(iso).valide) return null;
  return annee >= 2000 && annee <= 2100 ? iso : null;
}

function jourUtc(iso: string): number {
  const a = analyserDateISO(iso);
  return a.valide ? a.jourUTC : 0;
}

export function extraireEcheance(plie: string, aujourdhui: string): ResultatEcheance | null {
  const trouvee = (debutBrut: number, finBrut: number, date: string | null): ResultatEcheance => {
    // Étend la tranche à la préposition qui la précède (« avant le », « d'ici le »…).
    const prefixe = PREPOSITION_DATE.exec(plie.slice(0, debutBrut));
    const debut = prefixe ? prefixe.index : debutBrut;
    return date === null
      ? { type: "invalide", debut, fin: finBrut }
      : { type: "date", date, debut, fin: finBrut };
  };
  const base = jourUtc(aujourdhui);
  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(plie);
  if (m) {
    return trouvee(m.index, m.index + m[0].length, dateValide(+m[1]!, +m[2]!, +m[3]!));
  }
  // « 15/11 », « 15/11/2026 », « 15-11-26 » ; avec des points, l'année est exigée (« 3.5 » n'est
  // pas une date).
  m =
    /\b(\d{1,2})([/-])(\d{1,2})(?:\2(\d{4}|\d{2}))?\b/.exec(plie) ??
    /\b(\d{1,2})(\.)(\d{1,2})\.(\d{4}|\d{2})\b/.exec(plie);
  if (m) {
    const jour = +m[1]!;
    const mois = +m[3]!;
    const anneeBrute = m[4];
    const anneeCourante = Number(aujourdhui.slice(0, 4));
    let annee = anneeBrute === undefined ? anneeCourante : +anneeBrute;
    if (anneeBrute !== undefined && anneeBrute.length === 2) annee += 2000;
    let date = dateValide(annee, mois, jour);
    // Sans année : la prochaine occurrence (l'année suivante si la date est passée).
    if (anneeBrute === undefined && date !== null && jourUtc(date) < base) {
      date = dateValide(anneeCourante + 1, mois, jour);
    }
    return trouvee(m.index, m.index + m[0].length, date);
  }
  m = /\bapres\s*-?\s*demain\b/.exec(plie);
  if (m) return trouvee(m.index, m.index + m[0].length, dateISODepuisJourUTC(base + 2));
  m = /\bdemain\b/.exec(plie);
  if (m) return trouvee(m.index, m.index + m[0].length, dateISODepuisJourUTC(base + 1));
  m = /\baujourd'?\s*hui\b/.exec(plie);
  if (m) return trouvee(m.index, m.index + m[0].length, aujourdhui);
  m = /\bdans\s+(\d{1,3})\s+(jours?|semaines?)\b/.exec(plie);
  if (m) {
    const pas = m[2]!.startsWith("semaine") ? 7 : 1;
    return trouvee(m.index, m.index + m[0].length, dateISODepuisJourUTC(base + +m[1]! * pas));
  }
  return null;
}

/* ----- Tâche ----- */

export interface TacheExtraite {
  titre?: string;
  pour?: string;
  mission?: string;
  echeance?: string;
  /** Une date a été reconnue mais n'existe pas ou sort de la plage admise. */
  echeance_invalide?: boolean;
}

const EST_MOI = /^(?:moi|moi[ -]?meme|a moi|soi)$/;

function nomPersonne(original: string, plie: string): string | undefined {
  const valeur = nettoyerValeur(original, plie);
  if (valeur === "" || EST_MOI.test(plierTexteCopilote(valeur))) return undefined;
  return valeur.slice(0, 100);
}

/** Retire échéance puis mission de la fin du texte et rend ce qui reste comme titre. */
function titreEtComplements(p0: Paire, aujourdhui: string): TacheExtraite {
  const sortie: TacheExtraite = {};
  let p = p0;
  const echeance = extraireEcheance(p.plie, aujourdhui);
  if (echeance) {
    if (echeance.type === "date") sortie.echeance = echeance.date;
    else sortie.echeance_invalide = true;
    p = retirer(p, echeance.debut, echeance.fin);
  }
  const mission = /\b(?:sur|dans|pour)\s+la\s+mission\s+(.+)$/d.exec(p.plie);
  const g = mission?.indices?.[1];
  if (mission && g) {
    const nom = nettoyerValeur(p.original.slice(g[0], g[1]), p.plie.slice(g[0], g[1]));
    if (nomExploitable(nom)) sortie.mission = nom.slice(0, 200);
    p = { original: p.original.slice(0, mission.index), plie: p.plie.slice(0, mission.index) };
  }
  const titre = nettoyerValeur(p.original, p.plie);
  if (titre !== "") sortie.titre = titre.charAt(0).toUpperCase() + titre.slice(1, 200);
  return sortie;
}

export function extraireTache(texte: string, aujourdhui: string): TacheExtraite {
  const { original, plie } = depuisTexte(texte);
  // « Assigne à Awa Koné : préparer le comité ».
  const assigne =
    /\b(?:assign(?:e|er)|confi(?:e|er)|attribu(?:e|er))\s+(?:(?:une|la|cette)\s+)?(?:nouvelle\s+)?(?:taches?\s+)?a\s+([^:]{1,80}?)\s*:\s*(.+)$/d.exec(
      plie,
    );
  const ga = assigne?.indices;
  if (ga?.[1] && ga[2]) {
    const pour = nomPersonne(original.slice(ga[1][0], ga[1][1]), plie.slice(ga[1][0], ga[1][1]));
    const reste = titreEtComplements(
      { original: original.slice(ga[2][0], ga[2][1]), plie: plie.slice(ga[2][0], ga[2][1]) },
      aujourdhui,
    );
    return { ...reste, ...(pour ? { pour } : {}) };
  }
  // « Crée une tâche : relancer le client » ; sinon « Rappelle-moi de relancer le client demain ».
  const tache = /\btaches?\b\s*(.*)$/d.exec(plie);
  const gt = tache?.indices?.[1];
  const rappel = /\brappell?e(?:\s*-?\s*moi)?\s*(?:de\s+|d'|que\s+)?(.*)$/d.exec(plie);
  const gr = rappel?.indices?.[1];
  if (gt) {
    let debut = gt[0];
    let pour: string | undefined;
    // « tâche pour Awa Koné : … » : le nom se termine par deux-points.
    const avec = /^\s*(?:pour|a)\s+([^:]{1,80}?)\s*:\s*/d.exec(plie.slice(debut));
    const gp = avec?.indices?.[1];
    if (avec && gp) {
      pour = nomPersonne(
        original.slice(debut + gp[0], debut + gp[1]),
        plie.slice(debut + gp[0], debut + gp[1]),
      );
      debut += avec[0].length;
    }
    const lien = /^\s*(?:de\s+|d'|:\s*|-\s*)/.exec(plie.slice(debut));
    if (lien) debut += lien[0].length;
    const reste = titreEtComplements(
      { original: original.slice(debut), plie: plie.slice(debut) },
      aujourdhui,
    );
    return { ...reste, ...(pour ? { pour } : {}) };
  }
  if (gr) {
    return titreEtComplements(
      { original: original.slice(gr[0]), plie: plie.slice(gr[0]) },
      aujourdhui,
    );
  }
  return {};
}

/* ----- Commentaire ----- */

export interface CommentaireExtrait {
  /** Texte du commentaire, tel que saisi (casse, accents et ponctuation conservés). */
  texte?: string;
  /** Nom (ou fragment) de la mission visée. */
  mission?: string;
}

const SEPARATEURS_TEXTE: readonly RegExp[] = [
  /:/d,
  /\s-\s/d,
  /\b(?:en\s+)?disant(?:\s+que)?\b/d,
  /\bpour\s+dire(?:\s+que)?\b/d,
  /\bqui\s+dit(?:\s+que)?\b/d,
  /\bavec\s+(?:le\s+)?texte\b/d,
];

/** Texte d'un commentaire : seules les marques de citation de part et d'autre sont retirées. */
function nettoyerTexteCommentaire(brut: string): string {
  let t = brut.replace(/^[\s:,;\-–]+/, "").trim();
  const guillemets = /^["'«“]\s*([\s\S]*?)\s*["'»”]$/.exec(t);
  if (guillemets) t = (guillemets[1] ?? "").trim();
  return t.replace(/\s+/g, " ").trim();
}

function missionDeCommentaire(original: string, plie: string, verbe: boolean): string | undefined {
  const motifs = [
    /\b(?:sur|a|au|dans|de|pour)\s+(?:la\s+|le\s+|l')?mission\s+(?:de\s+|du\s+|des\s+|d')?(?:la\s+|le\s+|l')?(.+)$/d,
    /\b(?:sur|a|au|dans|pour)\s+(?:la\s+|le\s+|l')?(.+)$/d,
    ...(verbe ? [/^\s*(?:la\s+|le\s+|l')?(?:mission\s+(?:de\s+|du\s+|des\s+|d')?)?(.+)$/d] : []),
  ];
  for (const motif of motifs) {
    const g = motif.exec(plie)?.indices?.[1];
    if (!g) continue;
    const nom = nettoyerValeur(original.slice(g[0], g[1]), plie.slice(g[0], g[1]));
    if (nomExploitable(nom)) return nom.slice(0, 200);
  }
  return undefined;
}

/**
 * « Ajoute un commentaire sur la mission Alpha : le client a validé » ; « Commente la mission
 * Alpha : … » ; « Ajoute un commentaire : … » (mission de l'écran). Le texte est ce qui suit le
 * premier séparateur (deux-points, « disant que », citation) ; sans séparateur ni citation, le
 * texte est absent et le copilote le demande.
 */
export function extraireCommentaire(texte: string): CommentaireExtrait {
  const { original, plie } = depuisTexte(texte);
  const m = /\bcommentaires?\b|\bcommente(?:r|z)?\b/d.exec(plie);
  if (!m) return {};
  const verbe = !m[0].startsWith("commentaire");
  const debut = m.index + m[0].length;
  const reste = plie.slice(debut);
  let coupe: { index: number; fin: number } | null = null;
  for (const motif of SEPARATEURS_TEXTE) {
    const s = motif.exec(reste);
    if (s && (coupe === null || s.index < coupe.index)) {
      coupe = { index: s.index, fin: s.index + s[0].length };
    }
  }
  const citation = /"/.exec(reste);
  if (citation && (coupe === null || citation.index < coupe.index)) {
    coupe = { index: citation.index, fin: citation.index };
  }
  const avantFin = debut + (coupe ? coupe.index : reste.length);
  const sortie: CommentaireExtrait = {};
  if (coupe) {
    const t = nettoyerTexteCommentaire(original.slice(debut + coupe.fin));
    if (t !== "") sortie.texte = t;
  }
  const mission = missionDeCommentaire(
    original.slice(debut, avantFin),
    plie.slice(debut, avantFin),
    verbe,
  );
  if (mission) sortie.mission = mission;
  return sortie;
}

/* ----- Relance d'une facture ----- */

/**
 * Désignation de la facture à relancer : son numéro (un jeton qui contient un chiffre, « F-2026-
 * 0012 »), à défaut le nom du client (« la facture de Dupont »). Rien d'autre : « les factures
 * échues » ne désigne aucune facture précise.
 */
export function extraireFactureRelance(texte: string): string | undefined {
  const { original, plie } = depuisTexte(texte);
  const numero =
    /\bfactures?\s+(?:n\s*°\s*|n°\s*|no\.?\s+|numero\s+|num\s+)?([a-z0-9][a-z0-9\-_/.]*\d[a-z0-9\-_/.]*)/d.exec(
      plie,
    );
  const g = numero?.indices?.[1];
  if (g) {
    const jeton = original.slice(g[0], g[1]).replace(/[.,;:!?]+$/, "");
    if (jeton.length >= 2) return jeton.slice(0, 50);
  }
  const client =
    /\bfactures?\s+(?:du\s+client\s+|de\s+la\s+societe\s+|de\s+l'entreprise\s+|de\s+|du\s+|des\s+|d'|pour\s+|chez\s+)(.+)$/d.exec(
      plie,
    );
  const c = client?.indices?.[1];
  if (!c) return undefined;
  const nom = nettoyerValeur(original.slice(c[0], c[1]), plie.slice(c[0], c[1]));
  return nomExploitable(nom) ? nom.slice(0, 100) : undefined;
}
