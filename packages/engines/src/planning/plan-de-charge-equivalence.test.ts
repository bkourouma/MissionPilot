import { describe, expect, it } from "vitest";
import { ratioArrondi } from "../commun/ratio";
import { estJourOuvre, listerJoursOuvres, type ParametresCalendrier } from "./calendrier";
import {
  type Absence,
  type Affectation,
  type SeuilsCharge,
  SEUILS_CHARGE_DEFAUT,
  capacite,
  etatCharge,
  joursAffectesPrepares,
  joursAffectesSurPeriode,
  preparerAffectation,
} from "./capacite";
import {
  type DateISO,
  type Periode,
  ajouterJours,
  dansPeriode,
  intersection,
  jourSemaine,
  versJourUTC,
  verifierPeriode,
} from "./dates";
import {
  type CollaborateurCharge,
  type EntreePlanDeCharge,
  planDeCharge,
  semainesCouvrant,
} from "./plan-de-charge";
import {
  arrondiEntier,
  CENTIEMES_PAR_JOUR,
  depuisCentiemes,
  sommerJours,
  versCentiemes,
} from "./unites";

/*
 * Équivalence avec l'algorithme d'origine (avant optimisation), recopié
 * ci-dessous comme référence : liste des jours ouvrés refaite à chaque
 * période, cumul par filtrage, capacité jour par jour sur dates texte.
 */

// ---------- Référence : algorithme d'origine ----------

function refListerJoursOuvres(periode: Periode, params: ParametresCalendrier): DateISO[] {
  const jours = new Set(params.joursTravailles ?? [1, 2, 3, 4, 5]);
  for (const j of jours) {
    if (!Number.isInteger(j) || j < 1 || j > 7)
      throw new RangeError(`Jour de semaine invalide : ${j} (attendu 1 à 7)`);
  }
  const feries = new Set((params.feries ?? []).map(versJourUTC));
  const resultat: DateISO[] = [];
  for (let d = periode.debut; versJourUTC(d) <= versJourUTC(periode.fin); d = ajouterJours(d, 1)) {
    if (jours.has(jourSemaine(d)) && !feries.has(versJourUTC(d))) resultat.push(d);
  }
  return resultat;
}

function refFraction(a: Absence): number {
  const f = a.fractionJour ?? 1;
  if (!Number.isFinite(f) || f <= 0 || f > 1) throw new RangeError(`Fraction : ${f}`);
  return versCentiemes(f);
}

function refCapacite(
  periode: Periode,
  calendrier: ParametresCalendrier,
  absences: readonly Absence[],
  tempsTravailPct: number,
): number {
  verifierPeriode(periode);
  for (const a of absences) verifierPeriode(a);
  let disponibles = 0;
  for (const jour of refListerJoursOuvres(periode, calendrier)) {
    let total = 0;
    for (const a of absences) if (dansPeriode(jour, a)) total += refFraction(a);
    disponibles += CENTIEMES_PAR_JOUR - Math.min(total, CENTIEMES_PAR_JOUR);
  }
  return depuisCentiemes(arrondiEntier((disponibles * tempsTravailPct) / 100));
}

function refCumul(aff: Affectation, ouvres: readonly DateISO[], date: DateISO): number {
  const total = versCentiemes(aff.joursAlloues);
  if (ouvres.length === 0) return versJourUTC(date) >= versJourUTC(aff.debut) ? total : 0;
  const limite = versJourUTC(date);
  const ecoules = ouvres.filter((j) => versJourUTC(j) <= limite).length;
  return arrondiEntier((total * ecoules) / ouvres.length);
}

function refJoursAffectes(
  aff: Affectation,
  periode: Periode,
  calendrier: ParametresCalendrier,
): number {
  verifierPeriode(aff);
  verifierPeriode(periode);
  if (!Number.isFinite(aff.joursAlloues) || aff.joursAlloues < 0) {
    throw new RangeError(`Jours alloués invalides : ${aff.joursAlloues}`);
  }
  if (intersection(aff, periode) === null) return 0;
  const ouvres = refListerJoursOuvres(aff, calendrier);
  const avant = refCumul(aff, ouvres, ajouterJours(periode.debut, -1));
  return depuisCentiemes(refCumul(aff, ouvres, periode.fin) - avant);
}

function refPlanDeCharge(entree: EntreePlanDeCharge) {
  const seuils: SeuilsCharge = entree.seuils ?? SEUILS_CHARGE_DEFAUT;
  return entree.collaborateurs.map((c) => {
    const calendrier = c.calendrier ?? entree.calendrier ?? {};
    const siennes = entree.affectations.filter((a) => a.personneId === c.id);
    return {
      collaborateurId: c.id,
      cellules: semainesCouvrant(entree.periode).map((semaine) => {
        const cap = refCapacite(semaine, calendrier, c.absences ?? [], c.tempsTravailPct ?? 100);
        const affectes = sommerJours(siennes.map((a) => refJoursAffectes(a, semaine, calendrier)));
        return {
          semaine,
          capacite: cap,
          joursAffectes: affectes,
          tauxOccupation: ratioArrondi(versCentiemes(affectes), versCentiemes(cap)),
          etat: etatCharge(affectes, cap, seuils),
        };
      }),
    };
  });
}

// ---------- Jeu aléatoire déterministe ----------

/** Générateur pseudo-aléatoire mulberry32, graine fixe. */
function generateur(graine: number): () => number {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ORIGINE = "2026-01-01";

function tirage(alea: () => number) {
  const entier = (n: number) => Math.floor(alea() * n);
  const date = (max: number) => ajouterJours(ORIGINE, entier(max));
  const periode = (max: number, duree: number): Periode => {
    const debut = date(max);
    return { debut, fin: ajouterJours(debut, entier(duree)) };
  };
  const calendrier = (): ParametresCalendrier => {
    const choix = entier(4);
    if (choix === 0) return {};
    const feries = Array.from({ length: entier(12) }, () => date(400));
    if (choix === 1) return { feries };
    const jours = [1, 2, 3, 4, 5, 6, 7].filter(() => alea() < 0.6);
    return choix === 2 ? { joursTravailles: jours, feries } : { joursTravailles: [6, 7] };
  };
  const joursAlloues = () => [0, 0.5, 1, 3.33, 7.25, 10, 42.5, 120][entier(8)] as number;
  return { entier, date, periode, calendrier, joursAlloues };
}

describe("équivalence avec l'algorithme d'origine", () => {
  it("joursAffectesSurPeriode et la version préparée : 1 000 cas aléatoires", () => {
    const t = tirage(generateur(20261006));
    for (let i = 0; i < 1000; i++) {
      const cal = t.calendrier();
      const p = t.periode(300, 200);
      const aff: Affectation = {
        id: `a${i}`,
        personneId: "p",
        tacheId: "t",
        joursAlloues: t.joursAlloues(),
        ...p,
      };
      const prep = preparerAffectation(aff, cal);
      for (let k = 0; k < 5; k++) {
        const periode = t.periode(400, 20);
        const attendu = refJoursAffectes(aff, periode, cal);
        expect(joursAffectesSurPeriode(aff, periode, cal), `${i}/${k}`).toBe(attendu);
        expect(joursAffectesPrepares(prep, periode), `${i}/${k}`).toBe(attendu);
      }
    }
  });

  it("conserve exactement le total sur des semaines contiguës", () => {
    const t = tirage(generateur(42));
    for (let i = 0; i < 300; i++) {
      const cal = t.calendrier();
      const aff: Affectation = {
        id: "a",
        personneId: "p",
        tacheId: "t",
        joursAlloues: t.joursAlloues(),
        ...t.periode(200, 150),
      };
      const semaines = semainesCouvrant(aff);
      const prep = preparerAffectation(aff, cal);
      expect(sommerJours(semaines.map((s) => joursAffectesPrepares(prep, s)))).toBe(
        aff.joursAlloues,
      );
    }
  });

  it("capacite : 2 000 cas aléatoires avec absences", () => {
    const t = tirage(generateur(7));
    for (let i = 0; i < 2000; i++) {
      const cal = t.calendrier();
      const periode = t.periode(300, 30);
      const absences: Absence[] = Array.from({ length: t.entier(4) }, () => ({
        ...t.periode(300, 15),
        ...(t.entier(3) === 0 ? { fractionJour: 0.5 } : {}),
      }));
      const pct = [0, 50, 80, 100][t.entier(4)] as number;
      expect(capacite(periode, cal, absences, pct), String(i)).toBe(
        refCapacite(periode, cal, absences, pct),
      );
    }
  });

  it("planDeCharge : grilles aléatoires identiques à la référence", () => {
    const t = tirage(generateur(123456));
    for (let n = 0; n < 15; n++) {
      const collaborateurs: CollaborateurCharge[] = Array.from({ length: 6 }, (_, i) => ({
        id: `c${i}`,
        ...(t.entier(3) === 0 ? { tempsTravailPct: 80 } : {}),
        ...(t.entier(3) === 0 ? { calendrier: t.calendrier() } : {}),
        absences: Array.from({ length: t.entier(3) }, () => t.periode(200, 10)),
      }));
      const affectations: Affectation[] = Array.from({ length: 20 }, (_, i) => ({
        id: `a${i}`,
        personneId: `c${t.entier(7)}`, // c6 n'existe pas : affectation ignorée
        tacheId: "t",
        joursAlloues: t.joursAlloues(),
        ...t.periode(200, 120),
      }));
      const entree: EntreePlanDeCharge = {
        collaborateurs,
        affectations,
        periode: t.periode(150, 120),
        calendrier: t.calendrier(),
      };
      expect(planDeCharge(entree)).toEqual(refPlanDeCharge(entree));
    }
  });

  it("lève les mêmes erreurs, dans le même ordre", () => {
    const ok: Affectation = {
      id: "a",
      personneId: "p",
      tacheId: "t",
      joursAlloues: 2,
      debut: "2026-01-05",
      fin: "2026-01-09",
    };
    const semaine = { debut: "2026-01-05", fin: "2026-01-11" };
    const cas: [Affectation, Periode, ParametresCalendrier][] = [
      [{ ...ok, fin: "2026-01-01" }, { debut: "x", fin: "y" }, {}],
      [{ ...ok, joursAlloues: -1 }, { debut: "2026-01-11", fin: "2026-01-05" }, {}],
      [{ ...ok, joursAlloues: Number.NaN }, semaine, {}],
      [ok, semaine, { joursTravailles: [0] }],
      [ok, semaine, { feries: ["2026-02-30"] }],
    ];
    for (const [aff, periode, cal] of cas) {
      expect(() => refJoursAffectes(aff, periode, cal)).toThrow(RangeError);
      let message = "";
      try {
        refJoursAffectes(aff, periode, cal);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).not.toBe("");
      expect(() => joursAffectesSurPeriode(aff, periode, cal)).toThrow(message);
    }
    expect(() => preparerAffectation({ ...ok, joursAlloues: -1 })).toThrow(/Jours alloués/);
    const entree: EntreePlanDeCharge = {
      collaborateurs: [{ id: "p" }],
      affectations: [{ ...ok, joursAlloues: Number.POSITIVE_INFINITY }],
      periode: semaine,
    };
    expect(() => refPlanDeCharge(entree)).toThrow(/Jours alloués/);
    expect(() => planDeCharge(entree)).toThrow(/Jours alloués/);
    // Calendrier invalide mais période disjointe : 0 sans lever, comme avant.
    const loin = { debut: "2027-01-04", fin: "2027-01-10" };
    expect(joursAffectesSurPeriode(ok, loin, { joursTravailles: [0] })).toBe(0);
    expect(refJoursAffectes(ok, loin, { joursTravailles: [0] })).toBe(0);
  });
});

describe("mémoïsation", () => {
  it("recalcule après modification en place des fériés ou de l'affectation", () => {
    const feries: DateISO[] = [];
    const cal = { feries };
    const semaine = { debut: "2026-01-05", fin: "2026-01-11" };
    const aff = {
      id: "a",
      personneId: "p",
      tacheId: "t",
      joursAlloues: 10,
      debut: "2026-01-05",
      fin: "2026-01-16",
    };
    expect(joursAffectesSurPeriode(aff, semaine, cal)).toBe(5);
    expect(joursAffectesSurPeriode(aff, semaine, cal)).toBe(5); // mémoire
    feries.push("2026-01-05");
    expect(estJourOuvre("2026-01-05", cal)).toBe(false);
    expect(joursAffectesSurPeriode(aff, semaine, cal)).toBe(4.44);
    feries[0] = "2026-01-06"; // même longueur, autre contenu
    expect(estJourOuvre("2026-01-05", cal)).toBe(true);
    expect(estJourOuvre("2026-01-06", cal)).toBe(false);
    feries[0] = "2026-01-05";
    aff.joursAlloues = 9;
    expect(joursAffectesSurPeriode(aff, semaine, cal)).toBe(4);
    aff.fin = "2026-01-09";
    expect(joursAffectesSurPeriode(aff, semaine, cal)).toBe(9);
    aff.debut = "2026-01-06";
    expect(joursAffectesSurPeriode(aff, semaine, cal)).toBe(9);
    // Même liste de fériés, autre semaine de travail : calendrier distinct.
    expect(listerJoursOuvres(semaine, { feries, joursTravailles: [6, 7] })).toEqual([
      "2026-01-10",
      "2026-01-11",
    ]);
    const jours = [1, 2, 3, 4, 5];
    expect(listerJoursOuvres(semaine, { feries, joursTravailles: jours })).toHaveLength(4);
    jours.push(6);
    expect(listerJoursOuvres(semaine, { feries, joursTravailles: jours })).toHaveLength(5);
  });
});
