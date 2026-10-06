import { describe, expect, it } from "vitest";
import type { Absence, Affectation } from "./capacite";
import { ajouterJours } from "./dates";
import { type CollaborateurCharge, planDeCharge } from "./plan-de-charge";

/*
 * Performance légère du plan de charge (PLN-06) : 100 collaborateurs ×
 * 26 semaines × 3 affectations longues, jeu généré de façon déterministe.
 * Le seuil est volontairement large (machine de CI lente) : il détecte un
 * retour à un coût quadratique, pas une variation de quelques millisecondes.
 */

const COLLABORATEURS = 100;
const AFFECTATIONS_PAR_COLLABORATEUR = 3;
const SEUIL_MS = 1500; // ~50 ms mesurés, ~3 100 ms avant optimisation
const PERIODE = { debut: "2026-11-02", fin: "2027-05-02" }; // 26 semaines ISO
const FERIES = [
  "2026-11-01",
  "2026-12-25",
  "2027-01-01",
  "2027-03-29",
  "2027-04-04",
  "2027-05-01",
  "2027-05-06",
  "2027-05-17",
  "2027-08-07",
  "2027-08-15",
];

function jeu(): { collaborateurs: CollaborateurCharge[]; affectations: Affectation[] } {
  const collaborateurs: CollaborateurCharge[] = [];
  const affectations: Affectation[] = [];
  for (let i = 0; i < COLLABORATEURS; i++) {
    const id = `c${i}`;
    const absences: Absence[] = [{ debut: "2026-12-21", fin: "2027-01-01" }];
    if (i % 3 === 0) absences.push({ debut: "2027-02-10", fin: "2027-02-12", fractionJour: 0.5 });
    collaborateurs.push({ id, tempsTravailPct: i % 4 === 0 ? 80 : 100, absences });
    for (let k = 0; k < AFFECTATIONS_PAR_COLLABORATEUR; k++) {
      const debut = ajouterJours("2026-09-01", k * 45 + (i % 7));
      affectations.push({
        id: `${id}-a${k}`,
        personneId: id,
        tacheId: `t${k}`,
        joursAlloues: 20 + k * 7.5,
        debut,
        fin: ajouterJours(debut, 180),
      });
    }
  }
  return { collaborateurs, affectations };
}

describe("plan de charge : performance", () => {
  it(`${COLLABORATEURS} collaborateurs × 26 semaines en moins de ${SEUIL_MS} ms`, () => {
    const entree = { ...jeu(), periode: PERIODE, calendrier: { feries: FERIES } };
    planDeCharge(entree); // chauffe (compilation JIT)
    const debut = performance.now();
    const grille = planDeCharge(entree);
    const duree = performance.now() - debut;
    expect(grille).toHaveLength(COLLABORATEURS);
    expect(grille.every((l) => l.cellules.length === 26)).toBe(true);
    console.info(`plan de charge moteur 100 × 26 : ${duree.toFixed(1)} ms`);
    expect(duree, `${duree.toFixed(1)} ms`).toBeLessThan(SEUIL_MS);
  });
});
