import {
  agregerArborescence,
  avancementPhysique,
  calculerSuivi,
  performanceMission,
  sommerJours,
  statutCouleur,
  type ElementAvancement,
  type LigneSuivi,
  type NoeudPlanning,
  type SuiviCalcule,
} from "@missionpilot/engines";
import type { Db } from "../src/db/pool.js";
import { chargerDecoupage } from "../src/missions/decoupage.js";
import { nombre } from "../src/missions/outils.js";
import { jours, lireParametresTemps, seuilsSuivi } from "../src/temps/outils.js";
import type { SuiviMission } from "../src/temps/suivi.js";

/*
 * RÉFÉRENCE DE TEST : copie conforme de `calculerSuiviMission`
 * (apps/api/src/temps/suivi.ts) telle qu'elle était AVANT le passage en lot
 * (commit fbb24b0) : une mission à la fois, ~11 requêtes. Elle ne sert qu'à
 * prouver que `calculerSuivisMissions` rend des résultats identiques
 * (suivi-lot.test.ts). Ne pas la « corriger » : elle doit rester l'ancien
 * comportement.
 */

interface Montant {
  tache_id: string;
  collaborateur_id: string;
  jours: number;
}

async function realiseValide(db: Db, missionId: string): Promise<Montant[]> {
  const r = await db.query(
    `SELECT l.tache_id, f.collaborateur_id, l.centiemes
     FROM lignes_temps l JOIN feuilles_temps f ON f.id = l.feuille_id
     WHERE l.mission_id = $1 AND f.statut IN ('validee', 'verrouillee')
     UNION ALL
     SELECT c.tache_id, c.collaborateur_id, c.nouvelle_centiemes - c.ancienne_centiemes
     FROM corrections_temps c WHERE c.mission_id = $1 AND c.statut = 'validee'`,
    [missionId],
  );
  return r.rows.map((l) => ({
    tache_id: l.tache_id as string,
    collaborateur_id: l.collaborateur_id as string,
    jours: jours(l.centiemes),
  }));
}

async function enAttente(db: Db, missionId: string): Promise<Map<string, number>> {
  const r = await db.query(
    `SELECT l.tache_id, l.centiemes FROM lignes_temps l JOIN feuilles_temps f ON f.id = l.feuille_id
     WHERE l.mission_id = $1 AND f.statut = 'soumise'`,
    [missionId],
  );
  return grouper(r.rows.map((l) => [l.tache_id as string, jours(l.centiemes)]));
}

async function resteDeclare(db: Db, missionId: string): Promise<Montant[]> {
  const r = await db.query(
    `SELECT DISTINCT ON (tache_id, collaborateur_id) tache_id, collaborateur_id, centiemes
     FROM reste_a_faire WHERE mission_id = $1
     ORDER BY tache_id, collaborateur_id, ordre DESC`,
    [missionId],
  );
  return r.rows.map((l) => ({
    tache_id: l.tache_id as string,
    collaborateur_id: l.collaborateur_id as string,
    jours: jours(l.centiemes),
  }));
}

function grouper(couples: readonly [string, number][]): Map<string, number> {
  const brut = new Map<string, number[]>();
  for (const [cle, v] of couples) brut.set(cle, [...(brut.get(cle) ?? []), v]);
  return new Map([...brut].map(([cle, v]) => [cle, sommerJours(v)]));
}

function resteEstime(budget: number, realise: number): number {
  const ecart = calculerSuivi({ budget, realise, resteAFaire: 0 }).ecart;
  return ecart < 0 ? sommerJours([0, -ecart]) : 0;
}

interface Personne {
  id: string;
  nom: string;
  grade_id: string | null;
  grade_code: string | null;
  grade_libelle: string | null;
}

async function personnes(db: Db, ids: string[]): Promise<Map<string, Personne>> {
  if (ids.length === 0) return new Map();
  const r = await db.query(
    `SELECT c.id, c.nom, c.grade_id, g.code AS grade_code, g.libelle AS grade_libelle
     FROM collaborateurs c LEFT JOIN grades g ON g.id = c.grade_id WHERE c.id = ANY ($1::uuid[])`,
    [ids],
  );
  return new Map(r.rows.map((p) => [p.id as string, p as Personne]));
}

function vueSuivi(s: SuiviCalcule): Record<string, unknown> {
  return {
    budget: s.budget,
    realise: s.realise,
    reste_a_faire: s.resteAFaire,
    atterrissage: s.atterrissage,
    ecart: s.ecart,
    ecart_relatif: s.ecartRelatif,
    consommation: s.consommation,
  };
}

export async function suiviMissionReference(
  db: Db,
  cabinetId: string,
  missionId: string,
): Promise<SuiviMission> {
  const parametres = await lireParametresTemps(db, cabinetId);
  const seuils = seuilsSuivi(parametres);
  const d = await chargerDecoupage(db, missionId);
  const realises = await realiseValide(db, missionId);
  const restes = await resteDeclare(db, missionId);
  const attente = await enAttente(db, missionId);

  const budgetTache = grouper(d.lignes.map((l) => [l.tache_id as string, nombre(l.jours)]));
  const realiseTache = grouper(realises.map((m) => [m.tache_id, m.jours]));
  const declareTache = grouper(restes.map((m) => [m.tache_id, m.jours]));
  const estimees = new Set<string>();
  const resteTache = new Map<string, number>();
  for (const t of d.taches) {
    const id = t.id as string;
    const declare = declareTache.get(id);
    if (declare !== undefined) {
      resteTache.set(id, declare);
    } else {
      estimees.add(id);
      resteTache.set(id, resteEstime(budgetTache.get(id) ?? 0, realiseTache.get(id) ?? 0));
    }
  }

  const feuille = (t: Record<string, unknown>): NoeudPlanning => ({
    id: t.id as string,
    niveau: "tache",
    libelle: t.libelle as string,
    budget: budgetTache.get(t.id as string) ?? 0,
    realise: realiseTache.get(t.id as string) ?? 0,
    resteAFaire: resteTache.get(t.id as string) ?? 0,
  });
  const arbre = agregerArborescence(
    {
      id: missionId,
      niveau: "mission",
      enfants: d.phases.map((p) => ({
        id: p.id as string,
        niveau: "phase",
        libelle: p.libelle as string,
        enfants: [
          ...d.lots
            .filter((l) => l.phase_id === p.id)
            .map((l): NoeudPlanning => ({
              id: l.id as string,
              niveau: "lot",
              libelle: l.libelle as string,
              enfants: d.taches.filter((t) => t.lot_id === l.id).map(feuille),
            })),
          ...d.taches.filter((t) => t.phase_id === p.id && t.lot_id === null).map(feuille),
        ],
      })),
    },
    seuils,
  );

  const ids = [
    ...new Set([
      ...realises.map((m) => m.collaborateur_id),
      ...restes.map((m) => m.collaborateur_id),
      ...d.lignes.flatMap((l) => (l.collaborateur_id ? [l.collaborateur_id as string] : [])),
    ]),
  ];
  const gens = await personnes(db, ids);
  const budgetPersonne = grouper(
    d.lignes.flatMap((l) =>
      l.collaborateur_id
        ? [[l.collaborateur_id as string, nombre(l.jours)] as [string, number]]
        : [],
    ),
  );
  const realisePersonne = grouper(realises.map((m) => [m.collaborateur_id, m.jours]));
  const restePersonne = grouper(restes.map((m) => [m.collaborateur_id, m.jours]));
  const vueLigne = (ligne: LigneSuivi) => ({
    ...vueSuivi(calculerSuivi(ligne)),
    couleur: statutCouleur(ligne, seuils),
  });
  const parPersonne = ids
    .map((id) => {
      const p = gens.get(id);
      return {
        collaborateur_id: id,
        nom: p?.nom ?? null,
        grade_code: p?.grade_code ?? null,
        ...vueLigne({
          budget: budgetPersonne.get(id) ?? 0,
          realise: realisePersonne.get(id) ?? 0,
          resteAFaire: restePersonne.get(id) ?? 0,
        }),
      };
    })
    .sort((a, b) => String(a.nom).localeCompare(String(b.nom), "fr"));

  const gradeLigne = (l: Record<string, unknown>): string =>
    (l.grade_id as string | null) ?? gens.get(l.collaborateur_id as string)?.grade_id ?? "";
  const gradeDe = (collaborateurId: string): string => gens.get(collaborateurId)?.grade_id ?? "";
  const cleTG = (t: string, g: string) => `${t}|${g}`;
  const budgetTG = grouper(
    d.lignes.map((l) => [cleTG(l.tache_id as string, gradeLigne(l)), nombre(l.jours)]),
  );
  const realiseTG = grouper(
    realises.map((m) => [cleTG(m.tache_id, gradeDe(m.collaborateur_id)), m.jours]),
  );
  const resteTG = grouper(
    restes.map((m) => [cleTG(m.tache_id, gradeDe(m.collaborateur_id)), m.jours]),
  );
  const grades = new Set<string>();
  for (const cle of [...budgetTG.keys(), ...realiseTG.keys(), ...resteTG.keys()]) {
    grades.add(cle.split("|")[1] as string);
  }
  const libellesGrades = await db.query(
    "SELECT id, code, libelle, ordre FROM grades WHERE id = ANY ($1::uuid[])",
    [[...grades].filter((g) => g !== "")],
  );
  const infoGrade = new Map(libellesGrades.rows.map((g) => [g.id as string, g]));
  const parGrade = [...grades]
    .map((g) => {
      const budgets: number[] = [];
      const realisesG: number[] = [];
      const restesG: number[] = [];
      for (const t of d.taches) {
        const cle = cleTG(t.id as string, g);
        const b = budgetTG.get(cle) ?? 0;
        const r = realiseTG.get(cle) ?? 0;
        budgets.push(b);
        realisesG.push(r);
        restesG.push(estimees.has(t.id as string) ? resteEstime(b, r) : (resteTG.get(cle) ?? 0));
      }
      const info = infoGrade.get(g);
      return {
        grade_id: g === "" ? null : g,
        grade_code: (info?.code as string | undefined) ?? null,
        grade_libelle: (info?.libelle as string | undefined) ?? "Sans grade",
        ordre: (info?.ordre as number | undefined) ?? Number.MAX_SAFE_INTEGER,
        ...vueLigne({
          budget: sommerJours(budgets),
          realise: sommerJours(realisesG),
          resteAFaire: sommerJours(restesG),
        }),
      };
    })
    .sort((a, b) => a.ordre - b.ordre || String(a.grade_code).localeCompare(String(b.grade_code)))
    .map(({ ordre: _ordre, ...reste }) => reste);

  const elements: ElementAvancement[] = [
    ...d.jalons.map((j) => ({ atteint: j.atteint === true })),
    ...d.taches
      .filter((t) => t.est_livrable === true)
      .map((t) => {
        const id = t.id as string;
        return {
          atteint:
            !estimees.has(id) && (resteTache.get(id) ?? 0) === 0 && (realiseTache.get(id) ?? 0) > 0,
        };
      }),
  ];
  const avancement = avancementPhysique(elements);
  const perf =
    avancement === null
      ? null
      : performanceMission(avancement, {
          budget: arbre.suivi.budget,
          realise: arbre.suivi.realise,
        });

  return {
    arbre,
    decoupage: d,
    seuils,
    seuilConsommationPct: parametres.seuilConsommationPct,
    estimees,
    attente,
    parPersonne,
    parGrade,
    performance:
      perf === null
        ? null
        : {
            avancement: perf.avancement,
            consommation: perf.consommation,
            indice: perf.indice,
            ecart_points: perf.ecartPoints,
            elements: elements.length,
          },
  };
}
