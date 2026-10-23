/**
 * Agrégats d'un atelier stratégique (PLA-15) : vote par points, priorisation
 * par classement (Borda) et matrice à deux axes. Fonctions pures et
 * déterministes, sans base, sans horloge, sans IA ni flottant dans les
 * résultats : tout est entier (points, centièmes, centièmes de pourcent).
 *
 * Arrondi : toute division est arrondie au plus proche, DEMI VERS LE HAUT
 * (valeurs positives uniquement dans ce module).
 *
 * Confidentialité : le moteur ne connaît ni nom ni identité. Les participants
 * sont des identifiants opaques, servant seulement à détecter les doublons et
 * à compter ; il ne rend JAMAIS une contribution individuelle (l'API décide
 * de ce qui est montré). `synthetiserAtelier` fournit en plus une liste de
 * faits chiffrés structurés, liste blanche des chiffres d'un commentaire IA :
 * aucun texte libre n'est généré ici.
 */
import { ErreurPlan } from "./erreurs";

export const OPTIONS_ATELIER_MAX = 50;
export const PARTICIPANTS_ATELIER_MAX = 100;
export const BUDGET_POINTS_MAX = 100;
export const BUDGET_POINTS_DEFAUT = 10;
export const NOTE_MATRICE = { min: 1, max: 5 } as const;
/** Seuil des moyennes (centièmes) : 300 = 3,00, inclus du côté « haut ». */
export const SEUIL_MATRICE_CENTIEMES = 300;
/** Dispersion maximale (en notes) sur chaque axe pour parler de consensus. */
export const DISPERSION_CONSENSUS_MAX = 1;
export const MOTEUR_ATELIER = "engines/plan-strategique/atelier@1";

export interface OptionAtelier {
  readonly id: string;
  readonly libelle: string;
}

/** Points d'un participant sur une option. */
export interface PointsSurOption {
  readonly optionId: string;
  readonly points: number;
}

export interface ContributionVote {
  readonly participant: string;
  readonly points: readonly PointsSurOption[];
}

export interface ParametresVote {
  /** Points dispersables par participant, entier 1..100 (défaut 10). */
  readonly budgetPoints?: number;
  /** Plafond de points sur une même option (1..budgetPoints) ; absent : aucun. */
  readonly plafondParOption?: number;
  /** Participants invités (≥ ayant contribué) ; absent : ceux qui ont contribué. */
  readonly invites?: number;
}

export interface Participation {
  /** Participants ayant contribué (vote : au moins un point donné). */
  readonly participants: number;
  readonly invites: number;
  /** participants / invités en centièmes de pourcent (10000 = 100,00 %) ; null si aucun invité. */
  readonly tauxCentiemesPourcent: number | null;
}

export interface LigneVote {
  readonly optionId: string;
  readonly points: number;
  readonly votants: number;
  /** Part du total des points, en centièmes de pourcent (2500 = 25,00 %). */
  readonly partCentiemesPourcent: number;
  /** 1 = premier ; égalité : plus de votants, puis ordre de saisie. */
  readonly rang: number;
}

export interface ResultatVote {
  readonly budgetPoints: number;
  readonly totalPoints: number;
  readonly options: readonly LigneVote[];
  readonly participation: Participation;
}

export interface ClassementParticipant {
  readonly participant: string;
  /** Identifiants d'options du meilleur au moins bon (sous-ensemble, sans doublon). */
  readonly classement: readonly string[];
}

export interface LignePriorisation {
  readonly optionId: string;
  readonly pointsBorda: number;
  /** Rang moyen en centièmes (150 = 1,50) sur les classements qui la citent ; null sinon. */
  readonly rangMoyenCentiemes: number | null;
  readonly nombreClassements: number;
  readonly foisPremiere: number;
  readonly rang: number;
}

export interface ResultatPriorisation {
  readonly options: readonly LignePriorisation[];
  readonly participation: Participation;
}

export interface PositionMatrice {
  readonly participant: string;
  readonly optionId: string;
  /** Note de l'axe des abscisses, entier 1..5. */
  readonly x: number;
  /** Note de l'axe des ordonnées, entier 1..5. */
  readonly y: number;
}

export interface AxeMatrice {
  readonly libelle: string;
  /** Vrai si une note basse est favorable (ex. effort). */
  readonly inverse?: boolean;
}

export interface AxesMatrice {
  readonly x: AxeMatrice;
  readonly y: AxeMatrice;
}

/** Valeur / impact en abscisse (haut = bon) ; effort en ordonnée (bas = bon). */
export const AXES_MATRICE_DEFAUT: AxesMatrice = {
  x: { libelle: "Valeur / impact" },
  y: { libelle: "Effort", inverse: true },
};

export const QUADRANTS_MATRICE = [
  "gains_rapides",
  "projets_majeurs",
  "complements",
  "a_ecarter",
] as const;
export type QuadrantMatrice = (typeof QUADRANTS_MATRICE)[number];

export interface ParametresMatrice {
  readonly axes?: AxesMatrice;
  readonly invites?: number;
}

export interface LigneMatriceAtelier {
  readonly optionId: string;
  /** Moyennes en centièmes (100 = 1,00) ; null si aucune position. */
  readonly moyenneXCentiemes: number | null;
  readonly moyenneYCentiemes: number | null;
  /** Écart max − min des notes, par axe (0 si aucune position). */
  readonly dispersionX: number;
  readonly dispersionY: number;
  readonly contributeurs: number;
  readonly quadrant: QuadrantMatrice | null;
  /** Vrai si la dispersion de chaque axe est ≤ 1 note (et au moins une position). */
  readonly consensus: boolean;
  /** Rang indicatif ; les options sans position viennent après les autres. */
  readonly rang: number;
}

export interface ResultatMatrice {
  readonly axes: AxesMatrice;
  readonly options: readonly LigneMatriceAtelier[];
  readonly participation: Participation;
}

function invalide(message: string, chemin = ""): never {
  throw new ErreurPlan("ATELIER_INVALIDE", message, chemin);
}

function entier(valeur: unknown, min: number, max: number, nom: string, chemin: string): number {
  if (typeof valeur !== "number" || !Number.isInteger(valeur) || valeur < min || valeur > max) {
    invalide(`${nom} : entier de ${min} à ${max} attendu.`, chemin);
  }
  return valeur;
}

function identifiant(valeur: unknown, nom: string, chemin: string): string {
  if (typeof valeur !== "string" || valeur.trim() === "") {
    invalide(`${nom} : identifiant non vide attendu.`, chemin);
  }
  return valeur;
}

/** Valide les options et rend l'index (id → position de saisie). */
function indexerOptions(options: readonly OptionAtelier[]): Map<string, number> {
  if (!Array.isArray(options) || options.length < 1 || options.length > OPTIONS_ATELIER_MAX) {
    invalide(`Un atelier porte de 1 à ${OPTIONS_ATELIER_MAX} options.`, "options");
  }
  const index = new Map<string, number>();
  options.forEach((o, i) => {
    const chemin = `options[${i}]`;
    const id = identifiant(o?.id, "Option", `${chemin}.id`);
    if (typeof o.libelle !== "string" || o.libelle.trim() === "") {
      invalide("Option : libellé non vide attendu.", `${chemin}.libelle`);
    }
    if (index.has(id)) invalide(`Option en double : « ${id} ».`, `${chemin}.id`);
    index.set(id, i);
  });
  return index;
}

function verifierEffectif(effectif: number, chemin: string): void {
  if (effectif > PARTICIPANTS_ATELIER_MAX) {
    invalide(`Au plus ${PARTICIPANTS_ATELIER_MAX} participants par atelier.`, chemin);
  }
}

/** Division entière positive arrondie au plus proche, demi vers le haut. */
function diviserHaut(num: number, den: number): number {
  const double = 2 * num + den;
  const reste = double % (2 * den);
  return (double - reste) / (2 * den);
}

function participation(
  participants: number,
  invites: number | undefined,
  chemin: string,
): Participation {
  const total =
    invites === undefined
      ? participants
      : entier(invites, 0, PARTICIPANTS_ATELIER_MAX, "Invités", `${chemin}.invites`);
  if (total < participants) {
    invalide(
      `Invités (${total}) inférieurs aux participants ayant contribué (${participants}).`,
      `${chemin}.invites`,
    );
  }
  return {
    participants,
    invites: total,
    tauxCentiemesPourcent: total === 0 ? null : diviserHaut(participants * 10000, total),
  };
}

/** Rangs 1.. d'après un ordre de tri déjà établi (indices dans `ordre`). */
function attribuerRangs(ordre: readonly number[], taille: number): number[] {
  const rangs = new Array<number>(taille).fill(0);
  ordre.forEach((i, r) => {
    rangs[i] = r + 1;
  });
  return rangs;
}

/**
 * Vote par points dispersés. Un participant « a voté » s'il a donné au moins
 * un point. Rang : points décroissants, puis votants décroissants, puis ordre
 * de saisie des options.
 */
export function agregerVote(
  options: readonly OptionAtelier[],
  contributions: readonly ContributionVote[],
  parametres: ParametresVote = {},
): ResultatVote {
  const index = indexerOptions(options);
  const budget = entier(
    parametres.budgetPoints ?? BUDGET_POINTS_DEFAUT,
    1,
    BUDGET_POINTS_MAX,
    "Budget de points",
    "budgetPoints",
  );
  const plafond =
    parametres.plafondParOption === undefined
      ? null
      : entier(parametres.plafondParOption, 1, budget, "Plafond par option", "plafondParOption");
  verifierEffectif(contributions.length, "contributions");
  const vus = new Set<string>();
  const points = new Array<number>(options.length).fill(0);
  const votants = new Array<number>(options.length).fill(0);
  let participants = 0;
  contributions.forEach((c, i) => {
    const chemin = `contributions[${i}]`;
    const participant = identifiant(c?.participant, "Participant", `${chemin}.participant`);
    if (vus.has(participant)) invalide(`Participant en double : « ${participant} ».`, chemin);
    vus.add(participant);
    const optionsVues = new Set<string>();
    let somme = 0;
    c.points.forEach((p, j) => {
      const cp = `${chemin}.points[${j}]`;
      const pos = index.get(p?.optionId);
      if (pos === undefined) invalide(`Option inconnue : « ${String(p?.optionId)} ».`, cp);
      if (optionsVues.has(p.optionId)) invalide(`Option répétée : « ${p.optionId} ».`, cp);
      optionsVues.add(p.optionId);
      const n = entier(p.points, 0, budget, "Points", `${cp}.points`);
      if (plafond !== null && n > plafond) {
        invalide(`Plus de ${plafond} points sur une même option.`, `${cp}.points`);
      }
      somme += n;
      if (n > 0) {
        points[pos] = (points[pos] as number) + n;
        votants[pos] = (votants[pos] as number) + 1;
      }
    });
    if (somme > budget) invalide(`Plus de ${budget} points répartis (${somme}).`, chemin);
    if (somme > 0) participants += 1;
  });
  const total = points.reduce((s, n) => s + n, 0);
  const ordre = options
    .map((_, i) => i)
    .sort(
      (a, b) =>
        (points[b] as number) - (points[a] as number) ||
        (votants[b] as number) - (votants[a] as number) ||
        a - b,
    );
  const rangs = attribuerRangs(ordre, options.length);
  return {
    budgetPoints: budget,
    totalPoints: total,
    options: options.map((o, i) => ({
      optionId: o.id,
      points: points[i] as number,
      votants: votants[i] as number,
      partCentiemesPourcent: total === 0 ? 0 : diviserHaut((points[i] as number) * 10000, total),
      rang: rangs[i] as number,
    })),
    participation: participation(participants, parametres.invites, "parametres"),
  };
}

/**
 * Priorisation par classements ordonnés (Borda). Une option classée au rang r
 * parmi les n options classées par ce participant reçoit n − r + 1 points ;
 * une option non classée, 0. Rang final : points de Borda décroissants, puis
 * nombre de fois première, puis ordre de saisie.
 */
export function agregerPriorisation(
  options: readonly OptionAtelier[],
  classements: readonly ClassementParticipant[],
  parametres: { readonly invites?: number } = {},
): ResultatPriorisation {
  const index = indexerOptions(options);
  verifierEffectif(classements.length, "classements");
  const vus = new Set<string>();
  const borda = new Array<number>(options.length).fill(0);
  const sommeRangs = new Array<number>(options.length).fill(0);
  const citations = new Array<number>(options.length).fill(0);
  const premieres = new Array<number>(options.length).fill(0);
  classements.forEach((c, i) => {
    const chemin = `classements[${i}]`;
    const participant = identifiant(c?.participant, "Participant", `${chemin}.participant`);
    if (vus.has(participant)) invalide(`Participant en double : « ${participant} ».`, chemin);
    vus.add(participant);
    if (!Array.isArray(c.classement) || c.classement.length === 0) {
      invalide("Classement vide : au moins une option attendue.", `${chemin}.classement`);
    }
    const n = c.classement.length;
    const dejaVues = new Set<string>();
    c.classement.forEach((id, r) => {
      const cp = `${chemin}.classement[${r}]`;
      const pos = index.get(id);
      if (pos === undefined) invalide(`Option inconnue : « ${String(id)} ».`, cp);
      if (dejaVues.has(id)) invalide(`Option classée deux fois : « ${id} ».`, cp);
      dejaVues.add(id);
      borda[pos] = (borda[pos] as number) + (n - r);
      sommeRangs[pos] = (sommeRangs[pos] as number) + r + 1;
      citations[pos] = (citations[pos] as number) + 1;
      if (r === 0) premieres[pos] = (premieres[pos] as number) + 1;
    });
  });
  const ordre = options
    .map((_, i) => i)
    .sort(
      (a, b) =>
        (borda[b] as number) - (borda[a] as number) ||
        (premieres[b] as number) - (premieres[a] as number) ||
        a - b,
    );
  const rangs = attribuerRangs(ordre, options.length);
  return {
    options: options.map((o, i) => ({
      optionId: o.id,
      pointsBorda: borda[i] as number,
      rangMoyenCentiemes:
        (citations[i] as number) === 0
          ? null
          : diviserHaut((sommeRangs[i] as number) * 100, citations[i] as number),
      nombreClassements: citations[i] as number,
      foisPremiere: premieres[i] as number,
      rang: rangs[i] as number,
    })),
    participation: participation(vus.size, parametres.invites, "parametres"),
  };
}

function verifierAxes(axes: AxesMatrice): void {
  for (const nom of ["x", "y"] as const) {
    const a = axes?.[nom];
    if (!a || typeof a.libelle !== "string" || a.libelle.trim() === "") {
      invalide(`Axe ${nom} : libellé non vide attendu.`, `axes.${nom}.libelle`);
    }
    if (a.inverse !== undefined && typeof a.inverse !== "boolean") {
      invalide(`Axe ${nom} : « inverse » doit être un booléen.`, `axes.${nom}.inverse`);
    }
  }
}

const ORDRE_QUADRANT: Readonly<Record<QuadrantMatrice, number>> = {
  gains_rapides: 0,
  projets_majeurs: 1,
  complements: 2,
  a_ecarter: 3,
};

/**
 * Matrice à deux axes. Un axe est « bon » du côté haut (moyenne ≥ 3,00) sauf
 * s'il est inversé (bon du côté bas, moyenne < 3,00). Quadrant : x bon et y
 * bon = gains rapides ; x bon, y mauvais = projets majeurs ; x mauvais, y bon
 * = compléments ; sinon à écarter. Avec les axes par défaut : valeur haute et
 * effort bas = gains rapides, etc. Rang indicatif : quadrant, puis qualité de
 * l'axe x décroissante (valeur moyenne), puis qualité de l'axe y décroissante
 * (effort croissant par défaut), puis ordre de saisie.
 */
export function agregerMatrice(
  options: readonly OptionAtelier[],
  positions: readonly PositionMatrice[],
  parametres: ParametresMatrice = {},
): ResultatMatrice {
  const index = indexerOptions(options);
  const axes = parametres.axes ?? AXES_MATRICE_DEFAUT;
  verifierAxes(axes);
  const xs: number[][] = options.map(() => []);
  const ys: number[][] = options.map(() => []);
  const vus = new Set<string>();
  const participants = new Set<string>();
  positions.forEach((p, i) => {
    const chemin = `positions[${i}]`;
    const participant = identifiant(p?.participant, "Participant", `${chemin}.participant`);
    const pos = index.get(p.optionId);
    if (pos === undefined) invalide(`Option inconnue : « ${String(p.optionId)} ».`, chemin);
    const cle = `${participant}\u0000${p.optionId}`;
    if (vus.has(cle)) {
      invalide(
        `Participant « ${participant} » : option « ${p.optionId} » placée deux fois.`,
        chemin,
      );
    }
    vus.add(cle);
    participants.add(participant);
    verifierEffectif(participants.size, "positions");
    const x = entier(p.x, NOTE_MATRICE.min, NOTE_MATRICE.max, "Note x", `${chemin}.x`);
    const y = entier(p.y, NOTE_MATRICE.min, NOTE_MATRICE.max, "Note y", `${chemin}.y`);
    (xs[pos] as number[]).push(x);
    (ys[pos] as number[]).push(y);
  });
  const inverseX = axes.x.inverse === true;
  const inverseY = axes.y.inverse === true;
  const moyenne = (v: readonly number[]): number | null =>
    v.length === 0 ? null : diviserHaut(v.reduce((s, a) => s + a, 0) * 100, v.length);
  const ecart = (v: readonly number[]): number =>
    v.length === 0 ? 0 : Math.max(...v) - Math.min(...v);
  const lignes = options.map((o, i) => {
    const mx = moyenne(xs[i] as number[]);
    const my = moyenne(ys[i] as number[]);
    const dx = ecart(xs[i] as number[]);
    const dy = ecart(ys[i] as number[]);
    let quadrant: QuadrantMatrice | null = null;
    if (mx !== null && my !== null) {
      const bonX = inverseX ? mx < SEUIL_MATRICE_CENTIEMES : mx >= SEUIL_MATRICE_CENTIEMES;
      const bonY = inverseY ? my < SEUIL_MATRICE_CENTIEMES : my >= SEUIL_MATRICE_CENTIEMES;
      if (bonX) quadrant = bonY ? "gains_rapides" : "projets_majeurs";
      else quadrant = bonY ? "complements" : "a_ecarter";
    }
    return {
      optionId: o.id,
      moyenneXCentiemes: mx,
      moyenneYCentiemes: my,
      dispersionX: dx,
      dispersionY: dy,
      contributeurs: (xs[i] as number[]).length,
      quadrant,
      consensus:
        quadrant !== null && dx <= DISPERSION_CONSENSUS_MAX && dy <= DISPERSION_CONSENSUS_MAX,
    };
  });
  // Qualité d'un axe, en centièmes : plus haut = meilleur.
  const qualite = (m: number | null, inverse: boolean): number =>
    inverse ? 600 - (m as number) : (m as number);
  const ordre = lignes
    .map((_, i) => i)
    .sort((a, b) => {
      const la = lignes[a] as (typeof lignes)[number];
      const lb = lignes[b] as (typeof lignes)[number];
      if (la.quadrant === null || lb.quadrant === null) {
        return (la.quadrant === null ? 1 : 0) - (lb.quadrant === null ? 1 : 0) || a - b;
      }
      return (
        ORDRE_QUADRANT[la.quadrant] - ORDRE_QUADRANT[lb.quadrant] ||
        qualite(lb.moyenneXCentiemes, inverseX) - qualite(la.moyenneXCentiemes, inverseX) ||
        qualite(lb.moyenneYCentiemes, inverseY) - qualite(la.moyenneYCentiemes, inverseY) ||
        a - b
      );
    });
  const rangs = attribuerRangs(ordre, options.length);
  return {
    axes,
    options: lignes.map((l, i) => ({ ...l, rang: rangs[i] as number })),
    participation: participation(participants.size, parametres.invites, "parametres"),
  };
}

/** Fait chiffré structuré : liste blanche des chiffres d'un commentaire IA. */
export interface FaitAtelier {
  readonly code: string;
  /** Option concernée ; null pour un fait d'ensemble. */
  readonly option: string | null;
  readonly valeur: number | null;
}

export interface SyntheseAtelierEntree {
  readonly options: readonly OptionAtelier[];
  readonly vote?: ParametresVote & { readonly contributions: readonly ContributionVote[] };
  readonly priorisation?: {
    readonly classements: readonly ClassementParticipant[];
    readonly invites?: number;
  };
  readonly matrice?: ParametresMatrice & { readonly positions: readonly PositionMatrice[] };
}

export interface SyntheseAtelier {
  readonly moteur: typeof MOTEUR_ATELIER;
  readonly vote?: { readonly resultat: ResultatVote; readonly faits: readonly FaitAtelier[] };
  readonly priorisation?: {
    readonly resultat: ResultatPriorisation;
    readonly faits: readonly FaitAtelier[];
  };
  readonly matrice?: { readonly resultat: ResultatMatrice; readonly faits: readonly FaitAtelier[] };
}

function faitsParticipation(prefixe: string, p: Participation): FaitAtelier[] {
  return [
    { code: `${prefixe}_PARTICIPANTS`, option: null, valeur: p.participants },
    { code: `${prefixe}_INVITES`, option: null, valeur: p.invites },
    { code: `${prefixe}_TAUX_CENTIEMES_POURCENT`, option: null, valeur: p.tauxCentiemesPourcent },
  ];
}

/** Agrège les méthodes fournies et dresse, pour chacune, ses faits chiffrés. */
export function synthetiserAtelier(entree: SyntheseAtelierEntree): SyntheseAtelier {
  const { options } = entree;
  let vote: SyntheseAtelier["vote"];
  let priorisation: SyntheseAtelier["priorisation"];
  let matrice: SyntheseAtelier["matrice"];
  if (entree.vote) {
    const resultat = agregerVote(options, entree.vote.contributions, entree.vote);
    const faits: FaitAtelier[] = [
      { code: "VOTE_TOTAL_POINTS", option: null, valeur: resultat.totalPoints },
      ...faitsParticipation("VOTE", resultat.participation),
    ];
    for (const l of resultat.options) {
      faits.push(
        { code: "VOTE_POINTS", option: l.optionId, valeur: l.points },
        { code: "VOTE_VOTANTS", option: l.optionId, valeur: l.votants },
        {
          code: "VOTE_PART_CENTIEMES_POURCENT",
          option: l.optionId,
          valeur: l.partCentiemesPourcent,
        },
        { code: "VOTE_RANG", option: l.optionId, valeur: l.rang },
      );
    }
    vote = { resultat, faits };
  }
  if (entree.priorisation) {
    const resultat = agregerPriorisation(
      options,
      entree.priorisation.classements,
      entree.priorisation,
    );
    const faits = faitsParticipation("PRIORISATION", resultat.participation);
    for (const l of resultat.options) {
      faits.push(
        { code: "PRIORISATION_POINTS_BORDA", option: l.optionId, valeur: l.pointsBorda },
        {
          code: "PRIORISATION_RANG_MOYEN_CENTIEMES",
          option: l.optionId,
          valeur: l.rangMoyenCentiemes,
        },
        { code: "PRIORISATION_FOIS_PREMIERE", option: l.optionId, valeur: l.foisPremiere },
        { code: "PRIORISATION_RANG", option: l.optionId, valeur: l.rang },
      );
    }
    priorisation = { resultat, faits };
  }
  if (entree.matrice) {
    const resultat = agregerMatrice(options, entree.matrice.positions, entree.matrice);
    const faits = faitsParticipation("MATRICE", resultat.participation);
    for (const l of resultat.options) {
      faits.push(
        { code: "MATRICE_MOYENNE_X_CENTIEMES", option: l.optionId, valeur: l.moyenneXCentiemes },
        { code: "MATRICE_MOYENNE_Y_CENTIEMES", option: l.optionId, valeur: l.moyenneYCentiemes },
        { code: "MATRICE_DISPERSION_X", option: l.optionId, valeur: l.dispersionX },
        { code: "MATRICE_DISPERSION_Y", option: l.optionId, valeur: l.dispersionY },
        { code: "MATRICE_CONTRIBUTEURS", option: l.optionId, valeur: l.contributeurs },
        { code: "MATRICE_CONSENSUS", option: l.optionId, valeur: l.consensus ? 1 : 0 },
        { code: "MATRICE_RANG", option: l.optionId, valeur: l.rang },
      );
      if (l.quadrant !== null) {
        // Le code porte le quadrant ; la valeur vaut 1.
        faits.push({
          code: `MATRICE_QUADRANT_${l.quadrant.toUpperCase()}`,
          option: l.optionId,
          valeur: 1,
        });
      }
    }
    matrice = { resultat, faits };
  }
  return {
    moteur: MOTEUR_ATELIER,
    ...(vote ? { vote } : {}),
    ...(priorisation ? { priorisation } : {}),
    ...(matrice ? { matrice } : {}),
  };
}
