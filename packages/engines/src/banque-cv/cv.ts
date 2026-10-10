/**
 * Banque de CV des appels d'offres (AO-04, PRD complémentaire §9) : années d'expérience et
 * contrôle DÉTERMINISTE des exigences d'un dossier d'appel d'offres (années, années par
 * secteur, diplôme, langues, expériences auprès d'un bailleur).
 *
 * - Les périodes d'expérience sont des mois « AAAA-MM » inclusifs ; une expérience en cours
 *   (fin nulle) court jusqu'au mois de référence, toujours passé en paramètre (aucune horloge).
 * - Les années d'expérience comptent les mois DISTINCTS couverts par au moins une expérience
 *   (deux postes simultanés ne comptent pas double), puis les années COMPLÈTES : 59 mois font
 *   4 ans. Arithmétique entière, aucun flottant.
 * - Comparaison des libellés (secteur, domaine, bailleur, langue) sans casse ni accents.
 */

export type NiveauDiplome = "bac" | "bac_2" | "bac_3" | "bac_4" | "bac_5" | "doctorat";
/** Niveaux du plus bas au plus haut (l'ordre fait la comparaison). */
export const NIVEAUX_DIPLOME: readonly NiveauDiplome[] = [
  "bac",
  "bac_2",
  "bac_3",
  "bac_4",
  "bac_5",
  "doctorat",
];

export type NiveauLangue = "notions" | "courant" | "bilingue" | "maternelle";
export const NIVEAUX_LANGUE: readonly NiveauLangue[] = [
  "notions",
  "courant",
  "bilingue",
  "maternelle",
];

export interface ExperienceCv {
  /** Premier mois « AAAA-MM ». */
  readonly debut: string;
  /** Dernier mois « AAAA-MM » inclus ; null : en cours. */
  readonly fin: string | null;
  readonly secteurs: readonly string[];
  readonly bailleur?: string | null;
}

export interface DiplomeCv {
  readonly niveau: NiveauDiplome;
  readonly domaine: string;
}

export interface LangueCv {
  readonly langue: string;
  readonly niveau: NiveauLangue;
}

export interface ContenuCvControle {
  readonly experiences: readonly ExperienceCv[];
  readonly diplomes: readonly DiplomeCv[];
  readonly langues: readonly LangueCv[];
}

export interface ExigencesCv {
  readonly anneesMin?: number;
  readonly anneesParSecteur?: readonly { readonly secteur: string; readonly annees: number }[];
  readonly niveauDiplomeMin?: NiveauDiplome;
  /** Domaines admis pour le diplôme exigé (l'un suffit) ; vide ou absent : tout domaine. */
  readonly domainesDiplome?: readonly string[];
  readonly langues?: readonly { readonly langue: string; readonly niveauMin: NiveauLangue }[];
  readonly experiencesBailleur?: readonly {
    readonly bailleur: string;
    readonly nombreMin: number;
  }[];
}

export type CodeCritere =
  "annees_experience" | "annees_secteur" | "diplome" | "langue" | "experiences_bailleur";

export interface CritereControle {
  readonly code: CodeCritere;
  /** Secteur, langue ou bailleur visé ; null pour un critère global. */
  readonly objet: string | null;
  readonly exige: string;
  readonly constate: string;
  readonly conforme: boolean;
}

export interface ResultatControleCv {
  readonly conforme: boolean;
  readonly anneesExperience: number;
  readonly criteres: readonly CritereControle[];
}

export type CodeErreurCv = "MOIS_INVALIDE" | "PERIODE_INVALIDE" | "EXIGENCE_INVALIDE";

export class ErreurCv extends Error {
  readonly code: CodeErreurCv;

  constructor(code: CodeErreurCv, message: string) {
    super(message);
    this.name = "ErreurCv";
    this.code = code;
  }
}

const MOIS = /^(\d{4})-(\d{2})$/;

/** Rang d'un mois « AAAA-MM » (années 1950 à 2100). */
export function rangMois(mois: string): number {
  const m = MOIS.exec(mois);
  const annee = Number(m?.[1]);
  const numero = Number(m?.[2]);
  if (!m || annee < 1950 || annee > 2100 || numero < 1 || numero > 12) {
    throw new ErreurCv("MOIS_INVALIDE", `Mois invalide (AAAA-MM attendu) : ${mois}.`);
  }
  return annee * 12 + numero - 1;
}

/** Libellé comparable : sans casse, sans accents, espaces réduits. */
export function normaliserLibelle(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Intervalles [début, fin] de rangs, bornés au mois de référence ; les futurs sont écartés. */
function intervalles(experiences: readonly ExperienceCv[], reference: number): [number, number][] {
  const liste: [number, number][] = [];
  for (const e of experiences) {
    const debut = rangMois(e.debut);
    const fin = e.fin === null ? reference : rangMois(e.fin);
    if (fin < debut) {
      throw new ErreurCv("PERIODE_INVALIDE", `Expérience terminée avant son début (${e.debut}).`);
    }
    if (debut <= reference) liste.push([debut, Math.min(fin, reference)]);
  }
  return liste;
}

/** Mois distincts couverts par au moins une expérience, jusqu'au mois de référence inclus. */
export function moisExperience(experiences: readonly ExperienceCv[], reference: string): number {
  const fusion = intervalles(experiences, rangMois(reference)).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let courant: [number, number] | null = null;
  for (const [debut, fin] of fusion) {
    if (courant && debut <= courant[1] + 1) {
      courant[1] = Math.max(courant[1], fin);
    } else {
      if (courant) total += courant[1] - courant[0] + 1;
      courant = [debut, fin];
    }
  }
  if (courant) total += courant[1] - courant[0] + 1;
  return total;
}

/** Années complètes d'expérience (mois distincts ÷ 12, partie entière). */
export function anneesExperience(experiences: readonly ExperienceCv[], reference: string): number {
  return Math.floor(moisExperience(experiences, reference) / 12);
}

/** Années complètes d'expérience dans un secteur (libellé comparé sans casse ni accents). */
export function anneesDansSecteur(
  experiences: readonly ExperienceCv[],
  secteur: string,
  reference: string,
): number {
  const cle = normaliserLibelle(secteur);
  return anneesExperience(
    experiences.filter((e) => e.secteurs.some((s) => normaliserLibelle(s) === cle)),
    reference,
  );
}

function entierPositif(n: number, quoi: string): number {
  if (!Number.isInteger(n) || n < 0 || n > 60) {
    throw new ErreurCv("EXIGENCE_INVALIDE", `${quoi} : entier de 0 à 60 attendu (reçu ${n}).`);
  }
  return n;
}

function libelleNiveau(niveau: NiveauDiplome | null): string {
  return niveau === null ? "aucun diplôme" : niveau;
}

function critereDiplome(cv: ContenuCvControle, exigences: ExigencesCv): CritereControle {
  const min = exigences.niveauDiplomeMin as NiveauDiplome;
  const domaines = (exigences.domainesDiplome ?? []).map(normaliserLibelle);
  const rangMin = NIVEAUX_DIPLOME.indexOf(min);
  if (rangMin < 0) {
    throw new ErreurCv("EXIGENCE_INVALIDE", `Niveau de diplôme exigé inconnu : ${String(min)}.`);
  }
  const admis = cv.diplomes.filter(
    (d) =>
      NIVEAUX_DIPLOME.indexOf(d.niveau) >= rangMin &&
      (domaines.length === 0 || domaines.includes(normaliserLibelle(d.domaine))),
  );
  const plusHaut = cv.diplomes.reduce<NiveauDiplome | null>(
    (haut, d) =>
      haut === null || NIVEAUX_DIPLOME.indexOf(d.niveau) > NIVEAUX_DIPLOME.indexOf(haut)
        ? d.niveau
        : haut,
    null,
  );
  return {
    code: "diplome",
    objet: domaines.length === 0 ? null : (exigences.domainesDiplome ?? []).join(", "),
    exige: min,
    constate: admis[0] ? `${admis[0].niveau} (${admis[0].domaine})` : libelleNiveau(plusHaut),
    conforme: admis.length > 0,
  };
}

function criteresLangues(cv: ContenuCvControle, exigences: ExigencesCv): CritereControle[] {
  return (exigences.langues ?? []).map((l) => {
    const trouvee = cv.langues.find(
      (x) => normaliserLibelle(x.langue) === normaliserLibelle(l.langue),
    );
    return {
      code: "langue",
      objet: l.langue,
      exige: l.niveauMin,
      constate: trouvee?.niveau ?? "non déclarée",
      conforme:
        trouvee !== undefined &&
        NIVEAUX_LANGUE.indexOf(trouvee.niveau) >= NIVEAUX_LANGUE.indexOf(l.niveauMin),
    };
  });
}

function criteresBailleurs(cv: ContenuCvControle, exigences: ExigencesCv): CritereControle[] {
  return (exigences.experiencesBailleur ?? []).map((b) => {
    const min = entierPositif(b.nombreMin, "Nombre d'expériences");
    const cle = normaliserLibelle(b.bailleur);
    const n = cv.experiences.filter(
      (e) => e.bailleur && normaliserLibelle(e.bailleur) === cle,
    ).length;
    return {
      code: "experiences_bailleur",
      objet: b.bailleur,
      exige: String(min),
      constate: String(n),
      conforme: n >= min,
    };
  });
}

/**
 * Contrôle un CV contre les exigences d'un appel d'offres, au mois de référence (en général le
 * mois de dépôt). Chaque exigence donne un critère ; le CV est conforme si tous le sont.
 */
export function controlerCv(
  cv: ContenuCvControle,
  exigences: ExigencesCv,
  reference: string,
): ResultatControleCv {
  const annees = anneesExperience(cv.experiences, reference);
  const criteres: CritereControle[] = [];
  if (exigences.anneesMin !== undefined) {
    const min = entierPositif(exigences.anneesMin, "Années d'expérience");
    criteres.push({
      code: "annees_experience",
      objet: null,
      exige: String(min),
      constate: String(annees),
      conforme: annees >= min,
    });
  }
  for (const s of exigences.anneesParSecteur ?? []) {
    const min = entierPositif(s.annees, "Années dans le secteur");
    const n = anneesDansSecteur(cv.experiences, s.secteur, reference);
    criteres.push({
      code: "annees_secteur",
      objet: s.secteur,
      exige: String(min),
      constate: String(n),
      conforme: n >= min,
    });
  }
  if (exigences.niveauDiplomeMin !== undefined) criteres.push(critereDiplome(cv, exigences));
  criteres.push(...criteresLangues(cv, exigences), ...criteresBailleurs(cv, exigences));
  return { conforme: criteres.every((c) => c.conforme), anneesExperience: annees, criteres };
}
