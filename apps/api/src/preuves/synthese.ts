import {
  carteTriangulation,
  detecterAssertionsSansPreuve,
  type AssertionLivrable,
  type ClasseRisque,
  type FiabilitePreuve,
  type TypeSourcePreuve,
} from "@missionpilot/engines";
import { ASSERTIONS_MISSION_MAX, PREUVES_MISSION_MAX } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import type { MissionAcces } from "../missions/acces.js";
import { peutVoirNominatif } from "./acces.js";
import {
  arbitragesCourants,
  assertionsDeMission,
  dimensionsDeMission,
  historiqueArbitrages,
  liensCourants,
  preuvesDeMission,
  preuvesParIds,
  versionsDAssertion,
  type ArbitrageLigne,
  type AssertionCourante,
  type LienCourant,
  type PreuveCourante,
} from "./donnees.js";
import {
  cleCouple,
  contradictionsArbitrees,
  contradictionsOuvertes,
  estArbitree,
  evaluerAssertions,
  liensPourMoteur,
  type EvaluationAssertion,
} from "./evaluation.js";
import { vueArbitrage, vueAssertion, vuePreuve } from "./vues.js";

/*
 * Synthèses du registre des preuves : détail d'une assertion, assertions fragiles, contradictions
 * à arbitrer (PRV-04), carte de triangulation (PRV-05), contrôle des livrables R2 et R3 (PRV-03).
 * Tout indice, toute lecture et tout contrôle vient du moteur ; cette couche charge, traduit et
 * assemble.
 */

export interface EtatRegistre {
  assertions: AssertionCourante[];
  preuves: Map<string, PreuveCourante>;
  liens: LienCourant[];
  arbitrages: Map<string, ArbitrageLigne>;
  evaluations: Map<string, EvaluationAssertion>;
  moteur: ReturnType<typeof liensPourMoteur>;
}

/** Charge liens, preuves, arbitrages et évaluations des assertions données (ou de toute la mission). */
export async function chargerEtat(
  db: Db,
  missionId: string,
  assertions: AssertionCourante[] | null,
): Promise<EtatRegistre> {
  const lues = assertions ?? (await assertionsDeMission(db, missionId, ASSERTIONS_MISSION_MAX));
  const ids = lues.map((a) => a.id);
  const parcimonie = assertions === null ? null : ids;
  const liens = await liensCourants(db, missionId, parcimonie);
  const preuves = new Map(
    (await preuvesParIds(db, [...new Set(liens.map((l) => l.preuve_id))])).map((p) => [p.id, p]),
  );
  const arbitrages = new Map(
    (await arbitragesCourants(db, missionId, parcimonie)).map((a) => [
      cleCouple(a.assertion_id, a.preuve_id),
      a,
    ]),
  );
  const moteur = liensPourMoteur(liens, preuves, arbitrages);
  return {
    assertions: lues,
    preuves,
    liens,
    arbitrages,
    moteur,
    evaluations: evaluerAssertions(ids, moteur),
  };
}

function preuveLiee(
  auth: Auth,
  mission: MissionAcces,
  etat: EtatRegistre,
  lien: LienCourant,
  preuve: PreuveCourante,
) {
  const arbitrage = etat.arbitrages.get(cleCouple(lien.assertion_id, lien.preuve_id));
  const arbitree = lien.sens === "contre" && estArbitree(lien, preuve, arbitrage);
  return {
    ...vuePreuve(preuve, peutVoirNominatif(auth, mission, preuve)),
    sens: lien.sens,
    a_arbitrer: lien.sens === "contre" && !arbitree,
    arbitrage: arbitree && arbitrage ? vueArbitrage(arbitrage) : null,
  };
}

/** Assertion avec son indice de solidité (moteur) et ses preuves pour et contre. */
export async function detailAssertion(
  db: Db,
  auth: Auth,
  mission: MissionAcces,
  assertion: AssertionCourante,
) {
  const etat = await chargerEtat(db, mission.id, [assertion]);
  const liees = etat.liens.flatMap((lien) => {
    const preuve = etat.preuves.get(lien.preuve_id);
    return preuve ? [preuveLiee(auth, mission, etat, lien, preuve)] : [];
  });
  return {
    ...vueAssertion(assertion),
    solidite: etat.evaluations.get(assertion.id)!.solidite,
    preuves_pour: liees.filter((p) => p.sens === "pour"),
    preuves_contre: liees.filter((p) => p.sens === "contre"),
    historique: (await versionsDAssertion(db, assertion.id)).map((v) => ({
      version: v.version,
      enonce: v.enonce,
      classe_risque: v.classe_risque,
      statut: v.statut,
      avis_expert: v.avis_expert,
      signe_par: v.signe_par ? { id: v.signe_par, nom: v.signe_par_nom } : null,
      signe_le: v.signe_le,
      motif: v.motif,
      auteur: { id: v.cree_par, nom: v.cree_par_nom },
      cree_le: v.cree_le,
    })),
    arbitrages: (await historiqueArbitrages(db, assertion.id)).map(vueArbitrage),
  };
}

/** Assertion de liste : vue courte et solidité. */
export function elementAssertion(
  a: Omit<AssertionCourante, "cle_tri">,
  e: EvaluationAssertion | undefined,
) {
  return { ...vueAssertion(a), solidite: e?.solidite, a_arbitrer: e?.a_arbitrer.length ?? 0 };
}

const RANG_CLASSE: Record<string, number> = { R0: 0, R1: 1, R2: 2, R3: 3 };

export interface AssertionFragile {
  id: string;
  enonce: string;
  classe_risque: string;
  livrable: string | null;
  statut: string;
  avis_expert: boolean;
  avis_expert_signe: boolean;
  indice: number;
  lecture: "solide" | "etayee" | "fragile";
  contradiction_non_resolue: boolean;
  preuves_pour: number;
  preuves_contre: number;
}

/**
 * API publique pour la revue guidée (QUA-03) : assertions fragiles d'une mission (hors
 * abandonnées), les classes les plus risquées d'abord, puis l'indice le plus faible. À appeler
 * dans la transaction de l'appelant, mission déjà vérifiée visible. L'indice vient du moteur.
 */
export async function assertionsFragilesDeMission(
  db: Db,
  missionId: string,
  options: { livrable?: string } = {},
): Promise<AssertionFragile[]> {
  const toutes = (await assertionsDeMission(db, missionId, ASSERTIONS_MISSION_MAX)).filter(
    (a) =>
      a.statut !== "abandonnee" &&
      (options.livrable === undefined || a.livrable === options.livrable),
  );
  const etat = await chargerEtat(db, missionId, toutes);
  return etat.assertions
    .flatMap((a) => {
      const s = etat.evaluations.get(a.id)!.solidite;
      return s.lecture === "fragile"
        ? [
            {
              id: a.id,
              enonce: a.enonce,
              classe_risque: a.classe_risque,
              livrable: a.livrable,
              statut: a.statut,
              avis_expert: a.avis_expert,
              avis_expert_signe: a.avis_expert && a.signe_par !== null,
              indice: s.indice,
              lecture: s.lecture,
              contradiction_non_resolue: s.contradiction_non_resolue,
              preuves_pour: s.preuves_pour,
              preuves_contre: s.preuves_contre,
            },
          ]
        : [];
    })
    .sort(
      (x, y) =>
        (RANG_CLASSE[y.classe_risque] ?? 0) - (RANG_CLASSE[x.classe_risque] ?? 0) ||
        x.indice - y.indice,
    );
}

/** Contradictions de la mission : à arbitrer (défaut) ou déjà arbitrées. */
export async function contradictionsDeMission(
  db: Db,
  auth: Auth,
  mission: MissionAcces,
  resolues: boolean,
) {
  const toutes = (await assertionsDeMission(db, mission.id, ASSERTIONS_MISSION_MAX)).filter(
    (a) => a.statut !== "abandonnee",
  );
  const etat = await chargerEtat(db, mission.id, toutes);
  const groupes = resolues
    ? contradictionsArbitrees(etat.moteur)
    : contradictionsOuvertes(etat.moteur);
  const parId = new Map(etat.assertions.map((a) => [a.id, a]));
  const elements = groupes
    .flatMap((g) => {
      const a = parId.get(g.assertion);
      if (!a) return [];
      const liees = etat.liens
        .filter((l) => l.assertion_id === a.id)
        .flatMap((lien) => {
          const preuve = etat.preuves.get(lien.preuve_id);
          return preuve ? [preuveLiee(auth, mission, etat, lien, preuve)] : [];
        });
      return [
        {
          assertion: vueAssertion(a),
          solidite: etat.evaluations.get(a.id)!.solidite,
          preuves_pour: liees.filter((p) => p.sens === "pour"),
          preuves_contre: liees.filter((p) => p.sens === "contre"),
          a_arbitrer: g.aArbitrer,
        },
      ];
    })
    .sort(
      (x, y) => Number(x.assertion.id > y.assertion.id) - Number(x.assertion.id < y.assertion.id),
    );
  return { elements };
}

export interface OptionsCarte {
  typesAttendus?: TypeSourcePreuve[];
  typesMinimum?: number;
  fiabiliteMinimale?: FiabilitePreuve;
}

/** Carte de triangulation sources × dimensions de la mission (PRV-05), par le moteur. */
export async function carteDeMission(db: Db, missionId: string, options: OptionsCarte) {
  const dimensions = await dimensionsDeMission(db, missionId, true);
  const preuves = await preuvesDeMission(db, missionId, PREUVES_MISSION_MAX);
  const carte = carteTriangulation(
    dimensions.map((d) => d.code),
    preuves.map((p) => ({
      id: p.id,
      typeSource: p.type_source as TypeSourcePreuve,
      fiabilite: p.fiabilite as FiabilitePreuve,
      dimensions: p.dimensions,
    })),
    options,
  );
  const libelles = new Map(dimensions.map((d) => [d.code, d.libelle]));
  return {
    dimensions: carte.dimensions.map((d) => ({
      code: d.dimension,
      libelle: libelles.get(d.dimension) ?? d.dimension,
      types_couverts: d.typesCouverts,
      types_manquants: d.typesManquants,
      preuves: d.preuves,
      couverte: d.couverte,
      triangulee: d.triangulee,
    })),
    cellules: carte.cellules.map((c) => ({
      dimension: c.dimension,
      type_source: c.typeSource,
      preuves: c.preuves,
      meilleure_fiabilite: c.meilleureFiabilite,
    })),
    zones_non_couvertes: carte.zonesNonCouvertes.map((z) => ({
      dimension: z.dimension,
      type_source: z.typeSource,
    })),
    dimensions_non_couvertes: carte.dimensionsNonCouvertes,
    dimensions_sous_triangulees: carte.dimensionsSousTriangulees,
    rattachements_inconnus: carte.rattachementsInconnus,
    preuves_ecartees: carte.preuvesEcartees,
    options: {
      types_attendus: options.typesAttendus ?? null,
      types_minimum: options.typesMinimum ?? null,
      fiabilite_minimale: options.fiabiliteMinimale ?? null,
    },
  };
}

/** Contrôle PRV-03 : assertions R2 et R3 sans preuve ni avis d'expert signé (moteur). */
export async function controleDeMission(db: Db, missionId: string, livrable: string | undefined) {
  const toutes = (await assertionsDeMission(db, missionId, ASSERTIONS_MISSION_MAX)).filter(
    (a) => a.statut !== "abandonnee" && (livrable === undefined || a.livrable === livrable),
  );
  const etat = await chargerEtat(db, missionId, toutes);
  const sens = new Map<string, { id: string; sens: "pour" | "contre" }[]>();
  for (const l of etat.liens) {
    const liste = sens.get(l.assertion_id) ?? [];
    liste.push({ id: l.preuve_id, sens: l.sens });
    sens.set(l.assertion_id, liste);
  }
  const entrees: AssertionLivrable[] = toutes.map((a) => ({
    id: a.id,
    classeRisque: a.classe_risque as ClasseRisque,
    preuves: sens.get(a.id) ?? [],
    avisExpert: a.avis_expert,
    signee: a.signe_par !== null,
  }));
  const controle = detecterAssertionsSansPreuve(entrees);
  const parId = new Map(toutes.map((a) => [a.id, a]));
  return {
    conforme: controle.conforme,
    controlees: controle.controlees,
    ignorees: controle.ignorees,
    anomalies: controle.anomalies.map((x) => ({
      assertion_id: x.assertion,
      classe_risque: x.classeRisque,
      code: x.code,
      enonce: parId.get(x.assertion)?.enonce ?? "",
      livrable: parId.get(x.assertion)?.livrable ?? null,
    })),
    livrable: livrable ?? null,
  };
}
