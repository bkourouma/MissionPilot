import type { Alea } from "../horloge.js";
import type { DeriveSerie, ParamSerie, SpecKpi } from "./kpi-types.js";

/*
 * Séries mensuelles des KPI du seed. Les valeurs « de base » sont tirées d'un flux à graine
 * fixe (reproductible) ; les KPI de décomposition (marge, résultat, chiffre d'affaires
 * produit d'un trafic par un panier, ratio sinistres/primes) sont CALCULÉS à partir de leurs
 * leviers, pour que les arbres d'indicateurs n'aient aucun résidu. Les mois couverts dépendent de la
 * mission (voir kpi-fenetre.ts). Aucune valeur n'est écrite à la main.
 */

/** Mois `AAAA-MM` de `debut` à `fin` inclus. */
export function moisEntre(debut: string, fin: string): string[] {
  const mois: string[] = [];
  let [a, m] = debut.split("-").map(Number) as [number, number];
  const [af, mf] = fin.split("-").map(Number) as [number, number];
  while (a < af || (a === af && m <= mf)) {
    mois.push(`${a}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      a += 1;
    }
  }
  return mois;
}

/** Dernier jour du mois `AAAA-MM`. */
export function finDeMois(mois: string): string {
  const [a, m] = mois.split("-").map(Number) as [number, number];
  const jour = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${mois}-${String(jour).padStart(2, "0")}`;
}

const arrondir = (v: number, decimales: number): number => {
  const f = 10 ** decimales;
  return Math.round(v * f) / f;
};

function serieBase(alea: Alea, mois: readonly string[], p: ParamSerie): number[] {
  return mois.map((m, t) => {
    const u = alea.suivant();
    const imposee = p.incidents?.[m];
    if (imposee !== undefined) return imposee;
    const saison = (p.saison ?? 0) * Math.sin((2 * Math.PI * t) / 12);
    const v = p.base + p.pente * t + saison + p.bruit * (2 * u - 1);
    return arrondir(Math.max(v, 0), p.decimales);
  });
}

function serieDerivee(d: DeriveSerie, mois: readonly string[], parCle: Map<string, number[]>) {
  const lire = (cle: string): number[] => {
    const s = parCle.get(cle);
    if (!s) throw new Error(`Série « ${cle} » introuvable pour un KPI calculé.`);
    return s;
  };
  return mois.map((_, t) => {
    if (d.type === "somme") {
      const v = d.termes.reduce((acc, x) => acc + x.coef * (lire(x.cle)[t] as number), 0);
      return arrondir(v, d.decimales);
    }
    if (d.type === "produit") {
      return arrondir(
        d.facteurs.reduce((acc, cle) => acc * (lire(cle)[t] as number), 1),
        d.decimales,
      );
    }
    const den = lire(d.denominateur)[t] as number;
    return arrondir((d.facteur * (lire(d.numerateur)[t] as number)) / den, d.decimales);
  });
}

/** Séries de tous les KPI (les KPI calculés après leurs leviers), indexées par clé. */
export function genererSeries(
  alea: Alea,
  mois: readonly string[],
  kpis: readonly SpecKpi[],
): Map<string, number[]> {
  const parCle = new Map<string, number[]>();
  for (const k of kpis) {
    if (!("type" in k.serie)) {
      parCle.set(k.cle, serieBase(alea.deriver(`kpi:${k.cle}`), mois, k.serie));
    }
  }
  for (const k of kpis) {
    if ("type" in k.serie) parCle.set(k.cle, serieDerivee(k.serie, mois, parCle));
  }
  return parCle;
}

/** Décimales de l'écriture d'un KPI (pour arrondir une valeur fausse planifiée). */
export function decimalesDe(k: SpecKpi): number {
  return k.serie.decimales;
}

export { arrondir };
