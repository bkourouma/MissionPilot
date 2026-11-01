import { randomUUID } from "node:crypto";
import { ajouterJours, lundiDeLaSemaine } from "@missionpilot/engines";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BilanActiviteDemo } from "../src/activite-demo/commun.js";
import { executerActiviteDemo } from "../src/activite-demo/job.js";
import { TYPE_JOB_ACTIVITE_DEMO } from "../src/activite-demo/planification.js";
import { brancherDiagnostic } from "../src/automatisation/diagnostic.js";
import {
  preparerCabinetDemo,
  retirerMarquesDemo,
  type CabinetDemoTest,
} from "./activite-demo-outils.js";
import { attendre } from "./facturation-outils.js";
import { demarrer, proprietaire, type Contexte } from "./helpers.js";

/*
 * Durabilité du job « activite_demo » (§7 T4 de la spécification, DT1) : 14 mois PASSÉS simulés,
 * de 2025-09 à 2026-10, sur un cabinet de démonstration préparé au 2025-09-01. Chaque mois, la
 * tâche mensuelle (le 1er à 4 h UTC) puis ses suites (chaque lundi à 5 h UTC), dans l'ordre et à
 * leur heure, par un contexte direct (aucun worker). Après chaque exécution, le tableau de bord de
 * la semaine traitée est relu en associé. Vérifié semaine après semaine :
 * - les 11 cartes sont renseignées ;
 * - la mission en dérive reste entre 50 et 160 ‰ ;
 * - la consommation des autres missions reste sous 100 % ;
 * et sur la période : au plus un avenant par mission et par mois, une `date_fin` repoussée, aucun
 * incident `ECHEANCIER_DEPASSE_BUDGET` ni `BUDGET_FIGE_DEPASSE`, aucune facture du job payée à plus
 * de 28 jours. Les écarts sont collectés puis comparés à une liste vide : un échec les montre tous.
 */

const PREMIER_MOIS = "2025-09";
const DERNIER_MOIS = "2026-10";
const DERIVE_MIN = 0.05;
// Bande du moteur ]80 ; 160] ‰ sur l'écart TRONQUÉ au pour mille ; l'indicateur l'arrondit à 4
// décimales : 0,1605 reste dans la bande du moteur.
const DERIVE_MAX = 0.161;
const PAIEMENT_MAX_JOURS = 28;
const JOUR_MS = 86_400_000;

let ctx: Contexte;
let d: CabinetDemoTest;
const incidents: Record<string, unknown>[] = [];
let debrancher: () => void = () => undefined;

const lignes = (sql: string, params: unknown[] = []) =>
  proprietaire(async (c) => (await c.query(sql, params)).rows);

const executer = (charge: Record<string, unknown>, maintenant: Date): Promise<BilanActiviteDemo> =>
  ctx.db.withTenant(d.cabinetId, (db) =>
    executerActiviteDemo(
      { db, cabinetId: d.cabinetId, jobId: randomUUID(), charge, maintenant },
      { actif: () => true },
    ),
  );

/** Mois simulés, du premier au dernier inclus (« AAAA-MM »). */
function moisSimules(): string[] {
  const liste: string[] = [];
  let [annee, numero] = PREMIER_MOIS.split("-").map(Number) as [number, number];
  for (let m = PREMIER_MOIS; m <= DERNIER_MOIS;) {
    liste.push(m);
    numero = numero === 12 ? 1 : numero + 1;
    if (numero === 1) annee += 1;
    m = `${annee}-${String(numero).padStart(2, "0")}`;
  }
  return liste;
}

interface VueMission {
  mission_id?: string;
  taux_occupation?: number | null;
  taux_facturabilite?: number | null;
  consommation_budgetaire?: number | null;
  ecart_terminaison?: { relatif_jours: number | null };
  marge?: { taux_marge: number | null };
  taux_realisation?: number | null;
  encours?: Record<string, number>;
  delai_moyen_encaissement?: number | null;
  factures_soldees?: number;
  carnet_commandes?: number;
  respect_jalons?: { attendus: number };
  discipline_saisie?: { attendus: number };
}

/** Les 11 cartes du tableau de bord (§7 T4-2) : noms de celles qui restent vides. */
function cartesVides(v: VueMission): string[] {
  const cartes: Record<string, unknown> = {
    taux_occupation: v.taux_occupation,
    taux_facturabilite: v.taux_facturabilite,
    consommation_budgetaire: v.consommation_budgetaire,
    ecart_terminaison: v.ecart_terminaison?.relatif_jours,
    marge: v.marge?.taux_marge,
    taux_realisation: v.taux_realisation,
    encours: v.encours,
    delai_moyen_encaissement: (v.factures_soldees ?? 0) >= 1 ? v.delai_moyen_encaissement : null,
    carnet_commandes: v.carnet_commandes,
    respect_jalons: (v.respect_jalons?.attendus ?? 0) >= 1 ? v.respect_jalons : null,
    discipline_saisie: (v.discipline_saisie?.attendus ?? 0) >= 1 ? v.discipline_saisie : null,
  };
  return Object.entries(cartes)
    .filter(([, valeur]) => valeur === null || valeur === undefined)
    .map(([nom]) => nom);
}

/** Écarts d'une exécution : cartes vides, dérive hors bande, consommation dépassée. */
async function ecartsDeLaSemaine(bilan: BilanActiviteDemo, maintenant: Date): Promise<string[]> {
  const jour = maintenant.toISOString().slice(0, 10);
  const lundi = lundiDeLaSemaine(jour);
  if (!bilan.semaines.includes(lundi)) return [];
  const r = await d.associe.get(
    `/api/indicateurs/cabinet?du=${lundi}&au=${ajouterJours(lundi, 6)}&niveau=mission&date_reference=${jour}`,
  );
  attendre(200, r, `indicateurs de la semaine du ${lundi}`);
  const vue = r.json() as { cabinet: VueMission; elements: VueMission[] };
  const ecarts = cartesVides(vue.cabinet).map((c) => `${lundi} : carte « ${c} » vide`);
  const derive = vue.elements.find((e) => e.mission_id === bilan.derive);
  const relatif = derive?.ecart_terminaison?.relatif_jours ?? null;
  if (relatif === null || relatif < DERIVE_MIN || relatif > DERIVE_MAX) {
    ecarts.push(`${lundi} : dérive hors de la bande (${String(relatif)})`);
  }
  for (const e of vue.elements) {
    const conso = e.consommation_budgetaire ?? null;
    if (e.mission_id !== bilan.derive && conso !== null && conso > 1) {
      ecarts.push(`${lundi} : consommation ${conso} de la mission ${String(e.mission_id)}`);
    }
  }
  return ecarts;
}

/** Fins de mission du cabinet (signées ou en cours), par identifiant. */
async function datesFin(): Promise<Record<string, string>> {
  const r = await lignes(
    `SELECT id, date_fin::text AS date_fin FROM missions
     WHERE cabinet_id = $1 AND statut IN ('signee', 'en_cours') AND date_fin IS NOT NULL`,
    [d.cabinetId],
  );
  return Object.fromEntries(r.map((m) => [m.id as string, m.date_fin as string]));
}

beforeAll(async () => {
  ctx = await demarrer();
  d = await preparerCabinetDemo(ctx, "Activité démo durabilité", {
    dateReference: `${PREMIER_MOIS}-01`,
  });
  debrancher = brancherDiagnostic((entree) => incidents.push(entree));
}, 300_000);

afterAll(async () => {
  debrancher();
  // Démarquage obligatoire (fixture) : plafond de 30 cabinets démo (0582), listes « un clic ».
  await retirerMarquesDemo();
  await ctx.fermer();
});

describe("durabilité sur 14 mois", () => {
  it("chaque semaine : 11 cartes, dérive dans la bande, budgets tenus ; un avenant par mois au plus", async () => {
    const finsAvant = await datesFin();
    const ecarts: string[] = [];
    let semaines = 0;
    for (const mois of moisSimules()) {
      const premier = new Date(`${mois}-01T04:00:00Z`);
      const mensuel = await executer({ mois }, premier);
      expect(mensuel.statut, mois).toBe("fait");
      ecarts.push(...(await ecartsDeLaSemaine(mensuel, premier)));
      const suites = await lignes(
        `SELECT id, charge, execute_a FROM jobs
         WHERE cabinet_id = $1 AND type = $2 AND cle LIKE $3 AND statut = 'en_attente'
         ORDER BY execute_a, cle`,
        [d.cabinetId, TYPE_JOB_ACTIVITE_DEMO, `${TYPE_JOB_ACTIVITE_DEMO}:${mois}:%`],
      );
      for (const s of suites) {
        const quand = s.execute_a as Date;
        const bilan = await executer(s.charge as Record<string, unknown>, quand);
        // Passée à « termine » comme le ferait le worker : aucun autre fichier ne la reprend.
        await lignes("UPDATE jobs SET statut = 'termine' WHERE id = $1", [s.id]);
        semaines += bilan.semaines.length;
        ecarts.push(...(await ecartsDeLaSemaine(bilan, quand)));
      }
    }
    expect(ecarts).toEqual([]);
    // 14 mois de lundis (environ 61), moins les lundis du 1er traités par la tâche mensuelle.
    expect(semaines).toBeGreaterThanOrEqual(50);

    // Au plus un avenant par mission et par mois, et au moins un sur la période.
    const avenants = await lignes(
      `SELECT mission_id, motif, count(*)::int AS n FROM budget_versions
       WHERE cabinet_id = $1 AND type = 'revise' AND motif LIKE 'Avenant de prolongation % (démonstration)'
       GROUP BY mission_id, motif`,
      [d.cabinetId],
    );
    expect(avenants.length).toBeGreaterThanOrEqual(1);
    expect(avenants.filter((v) => (v.n as number) > 1)).toEqual([]);
    // Une date de fin au moins repoussée par un avenant (FIN-03 : la référence reste figée).
    const finsApres = await datesFin();
    const repoussees = Object.entries(finsAvant).filter(
      ([id, fin]) => (finsApres[id] ?? fin) > fin,
    );
    expect(repoussees.length).toBeGreaterThanOrEqual(1);

    // Aucun dépassement du budget figé ni de l'échéancier, même isolé.
    const journal = JSON.stringify(incidents);
    expect(journal).not.toContain("ECHEANCIER_DEPASSE_BUDGET");
    expect(journal).not.toContain("BUDGET_FIGE_DEPASSE");

    // Aucune facture du job payée à plus de 28 jours de son émission (échéance de 30 jours).
    const payees = await lignes(
      `SELECT f.id, f.date_emission::text AS emission, max(i.date_imputation)::text AS payee
       FROM factures f JOIN imputations i ON i.facture_id = f.id AND i.montant > 0
       WHERE f.cabinet_id = $1 AND f.id::text IN (
         SELECT entite_id FROM journal_audit WHERE cabinet_id = $1 AND action = 'activite_demo.facture')
       GROUP BY f.id, f.date_emission`,
      [d.cabinetId],
    );
    expect(payees.length).toBeGreaterThanOrEqual(1);
    const tardives = payees.filter(
      (f) =>
        (Date.parse(f.payee as string) - Date.parse(f.emission as string)) / JOUR_MS >
        PAIEMENT_MAX_JOURS,
    );
    expect(tardives).toEqual([]);
  }, 300_000);
});
