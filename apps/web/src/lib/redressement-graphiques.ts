/**
 * Géométrie du graphique des soldes de la trésorerie à 13 semaines (solde prévu, solde retenu,
 * droite du seuil de tension). Logique pure, testée dans `redressement-graphiques.test.ts`.
 *
 * Il s'agit de PLACER à l'écran des soldes déjà calculés par l'API (moteur de trésorerie) :
 * échelle linéaire, bornes, marge, coordonnées SVG. Aucun solde n'est calculé ici ; le tableau
 * équivalent (`lignesTableauSoldes`) porte toutes les valeurs, pour l'accessibilité.
 */

export interface SemaineSolde {
  semaine: number;
  debut: string;
  fin: string;
  /** Solde de clôture prévu (unités mineures). */
  solde_cloture_prevu: number;
  /** Solde de clôture retenu : le constaté quand il existe, sinon le prévu. */
  solde_cloture_retenu: number;
  tension: boolean;
}

export interface PointSolde {
  semaine: number;
  x: number;
  yPrevu: number;
  yRetenu: number;
  tension: boolean;
}

export interface GeometrieSoldes {
  largeur: number;
  hauteur: number;
  zone: { gauche: number; droite: number; haut: number; bas: number };
  /** Graduations de l'axe des soldes, du bas vers le haut. */
  graduations: { valeur: number; y: number; libelle: string }[];
  /** Une abscisse par semaine (« S1 » …). */
  abscisses: { semaine: number; x: number; libelle: string }[];
  /** Attribut `points` d'une polyline. */
  traitPrevu: string;
  traitRetenu: string;
  /** Ordonnée de la droite du seuil de tension, `null` quand il n'y a rien à tracer. */
  ySeuil: number | null;
  points: PointSolde[];
  /** Aucune semaine à tracer. */
  vide: boolean;
}

export interface OptionsGeometrieSoldes {
  largeur?: number;
  hauteur?: number;
  graduations?: number;
}

const COMPACT = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });

/** Graduation en notation compacte (« 1,2 M », « -500 k ») : l'axe n'a pas besoin du détail. */
export function libelleGraduation(valeur: number): string {
  return COMPACT.format(valeur);
}

const arrondi = (n: number) => Math.round(n * 100) / 100;

/**
 * Place les soldes dans un cadre `largeur` × `hauteur`. L'échelle va du plus petit au plus
 * grand des soldes ET du seuil (la droite du seuil est toujours visible), élargie de 5 % ; une
 * série constante reçoit une plage minimale pour que la ligne ne soit pas écrasée.
 */
export function geometrieSoldes(
  semaines: readonly SemaineSolde[],
  seuil: number | null,
  options: OptionsGeometrieSoldes = {},
): GeometrieSoldes {
  const largeur = options.largeur ?? 640;
  const hauteur = options.hauteur ?? 280;
  const zone = { gauche: 64, droite: largeur - 16, haut: 16, bas: hauteur - 36 };
  const vide: GeometrieSoldes = {
    largeur,
    hauteur,
    zone,
    graduations: [],
    abscisses: [],
    traitPrevu: "",
    traitRetenu: "",
    ySeuil: null,
    points: [],
    vide: true,
  };
  if (semaines.length === 0) return vide;

  const valeurs = semaines.flatMap((s) => [s.solde_cloture_prevu, s.solde_cloture_retenu]);
  if (seuil !== null && Number.isFinite(seuil)) valeurs.push(seuil);
  let min = Math.min(...valeurs);
  let max = Math.max(...valeurs);
  if (min === max) {
    const demi = Math.max(1, Math.abs(min) * 0.1);
    min -= demi;
    max += demi;
  }
  const marge = (max - min) * 0.05;
  min -= marge;
  max += marge;

  const hauteurUtile = zone.bas - zone.haut;
  const y = (v: number) => arrondi(zone.bas - ((v - min) / (max - min)) * hauteurUtile);
  const n = semaines.length;
  const x = (i: number) =>
    n === 1
      ? arrondi((zone.gauche + zone.droite) / 2)
      : arrondi(zone.gauche + ((zone.droite - zone.gauche) * i) / (n - 1));

  const nombre = Math.max(2, options.graduations ?? 4);
  const graduations = Array.from({ length: nombre + 1 }, (_, i) => {
    const valeur = Math.round(min + ((max - min) * i) / nombre);
    return { valeur, y: y(valeur), libelle: libelleGraduation(valeur) };
  });

  const points = semaines.map((s, i) => ({
    semaine: s.semaine,
    x: x(i),
    yPrevu: y(s.solde_cloture_prevu),
    yRetenu: y(s.solde_cloture_retenu),
    tension: s.tension,
  }));
  return {
    largeur,
    hauteur,
    zone,
    graduations,
    abscisses: points.map((p) => ({ semaine: p.semaine, x: p.x, libelle: `S${p.semaine}` })),
    traitPrevu: points.map((p) => `${p.x},${p.yPrevu}`).join(" "),
    traitRetenu: points.map((p) => `${p.x},${p.yRetenu}`).join(" "),
    ySeuil: seuil !== null && Number.isFinite(seuil) ? y(seuil) : null,
    points,
    vide: false,
  };
}

export interface LigneTableauSoldes {
  semaine: number;
  debut: string;
  fin: string;
  solde_prevu: number;
  solde_retenu: number;
  tension: boolean;
}

/** Lignes du tableau équivalent au graphique (mêmes valeurs, dans le même ordre). */
export function lignesTableauSoldes(semaines: readonly SemaineSolde[]): LigneTableauSoldes[] {
  return semaines.map((s) => ({
    semaine: s.semaine,
    debut: s.debut,
    fin: s.fin,
    solde_prevu: s.solde_cloture_prevu,
    solde_retenu: s.solde_cloture_retenu,
    tension: s.tension,
  }));
}
