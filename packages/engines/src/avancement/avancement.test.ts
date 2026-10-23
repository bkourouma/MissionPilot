import { describe, expect, it } from "vitest";
import {
  composerAvancementHebdo,
  ErreurAvancement,
  PLAFOND_JALONS_PAR_LISTE,
  PLAFOND_KPI_RAPPORT,
  PLAFOND_LIVRABLES_RAPPORT,
  type FaitsAvancementHebdo,
} from "./index";

const LUNDI = "2026-10-19";

function faits(sur: Partial<FaitsAvancementHebdo> = {}): FaitsAvancementHebdo {
  return {
    semaine: LUNDI,
    dateReference: "2026-10-21",
    mission: { intitule: "Audit organisationnel", statut: "en_cours" },
    avancement: 0.456,
    elementsAvancement: 5,
    jalons: [
      { libelle: "Cadrage", datePrevue: "2026-09-01", atteint: true },
      { libelle: "Diagnostic", datePrevue: "2026-10-10", atteint: false },
      { libelle: "Restitution", datePrevue: "2026-11-30", atteint: false },
      { libelle: "Suivi", datePrevue: null, atteint: false },
    ],
    kpis: [
      {
        libelle: "Délai",
        unite: "jours",
        valeur: 12,
        cible: 10,
        statut: "vert",
        periode: "2026-09",
      },
      {
        libelle: "Qualité",
        unite: "%",
        valeur: 70,
        cible: 90,
        statut: "rouge",
        periode: "2026-09",
      },
      {
        libelle: "Coût",
        unite: "u",
        valeur: null,
        cible: null,
        statut: "sans_cible",
        periode: null,
      },
      { libelle: "Autre", unite: "u", valeur: null, cible: 3, statut: "non_mesure", periode: null },
      { libelle: "Moyen", unite: "u", valeur: 8, cible: 10, statut: "orange", periode: "2026-09" },
    ],
    livrables: [
      { nom: "Rapport final", type: "rapport", version: 2, partage: true },
      { nom: "Note interne", type: "note", version: 1, partage: false },
      { nom: "Annexes", type: "rapport", version: 1, partage: true },
    ],
    ...sur,
  };
}

describe("composerAvancementHebdo", () => {
  it("compose les chiffres depuis les faits", () => {
    const c = composerAvancementHebdo(faits());
    expect(c.version).toBe(1);
    expect(c.semaine).toBe(LUNDI);
    expect(c.semaine_fin).toBe("2026-10-25");
    expect(c.avancement).toEqual({ pourcentage: 46, elements: 5 });
    expect(c.jalons.total).toBe(4);
    expect(c.jalons.atteints.nombre).toBe(1);
    expect(c.jalons.en_retard.elements).toEqual([
      { libelle: "Diagnostic", date_prevue: "2026-10-10" },
    ]);
    expect(c.jalons.a_venir.nombre).toBe(1);
    expect(c.jalons.sans_date).toBe(1);
    expect(c.kpis).toMatchObject({ total: 5, vert: 1, orange: 1, rouge: 1, non_evalue: 2 });
    expect(c.kpis.elements.map((k) => k.statut)).toEqual([
      "rouge",
      "orange",
      "vert",
      "non_evalue",
      "non_evalue",
    ]);
    expect(c.livrables).toMatchObject({ total: 3, partages: 2, non_partages: 1 });
    // Un livrable non partagé n'est jamais nommé.
    expect(JSON.stringify(c)).not.toContain("Note interne");
    expect(c.livrables.elements.map((l) => l.nom)).toEqual(["Annexes", "Rapport final"]);
  });

  it("est déterministe et indépendant de l'ordre des faits", () => {
    const a = composerAvancementHebdo(faits());
    const f = faits();
    const b = composerAvancementHebdo({
      ...f,
      jalons: [...f.jalons].reverse(),
      kpis: [...f.kpis].reverse(),
      livrables: [...f.livrables].reverse(),
    });
    expect(b).toEqual(a);
    expect(composerAvancementHebdo(faits())).toEqual(a);
  });

  it("dit en phrases ce que les chiffres disent (singulier et pluriel)", () => {
    const c = composerAvancementHebdo(faits());
    expect(c.faits_saillants.map((f) => f.code)).toEqual([
      "avancement",
      "jalons_atteints",
      "jalons_en_retard",
      "jalons_a_venir",
      "kpis",
      "livrables",
    ]);
    expect(c.faits_saillants.map((f) => f.texte)).toEqual([
      "Avancement physique : 46 % (5 éléments suivis).",
      "1 jalon atteint sur 4.",
      "1 jalon en retard.",
      "1 jalon à venir.",
      "Indicateurs : 1 au vert, 1 à l'orange, 1 au rouge, 2 non évalués.",
      "2 livrables partagés.",
    ]);
    const un = composerAvancementHebdo(
      faits({
        avancement: 1,
        elementsAvancement: 1,
        jalons: [
          { libelle: "A", datePrevue: null, atteint: true },
          { libelle: "B", datePrevue: null, atteint: true },
        ],
        kpis: [
          {
            libelle: "K",
            unite: "u",
            valeur: null,
            cible: null,
            statut: "sans_cible",
            periode: null,
          },
        ],
        livrables: [{ nom: "L", type: "t", version: 1, partage: true }],
      }),
    );
    expect(un.faits_saillants.map((f) => f.texte)).toEqual([
      "Avancement physique : 100 % (1 élément suivi).",
      "2 jalons atteints sur 2.",
      "Indicateurs : 0 au vert, 0 à l'orange, 0 au rouge, 1 non évalué.",
      "1 livrable partagé.",
    ]);
  });

  it("avancement non mesurable et mission vide", () => {
    const c = composerAvancementHebdo(
      faits({ avancement: null, elementsAvancement: 0, jalons: [], kpis: [], livrables: [] }),
    );
    expect(c.avancement.pourcentage).toBeNull();
    expect(c.faits_saillants.map((f) => f.texte)).toEqual([
      "Avancement physique non mesurable : aucun jalon ni livrable suivi.",
    ]);
    expect(c.kpis.total).toBe(0);
  });

  it("plafonne les listes sans fausser les comptes", () => {
    const jalons = Array.from({ length: PLAFOND_JALONS_PAR_LISTE + 5 }, (_, i) => ({
      libelle: `J${String(i).padStart(3, "0")}`,
      datePrevue: "2026-01-01",
      atteint: true,
    }));
    const kpis = Array.from({ length: PLAFOND_KPI_RAPPORT + 3 }, (_, i) => ({
      libelle: `K${i}`,
      unite: "u",
      valeur: 1,
      cible: 1,
      statut: "vert" as const,
      periode: null,
    }));
    const livrables = Array.from({ length: PLAFOND_LIVRABLES_RAPPORT + 2 }, (_, i) => ({
      nom: `L${i}`,
      type: "t",
      version: 1,
      partage: true,
    }));
    const c = composerAvancementHebdo(faits({ jalons, kpis, livrables }));
    expect(c.jalons.atteints.nombre).toBe(PLAFOND_JALONS_PAR_LISTE + 5);
    expect(c.jalons.atteints.elements).toHaveLength(PLAFOND_JALONS_PAR_LISTE);
    expect(c.kpis.total).toBe(PLAFOND_KPI_RAPPORT + 3);
    expect(c.kpis.elements).toHaveLength(PLAFOND_KPI_RAPPORT);
    expect(c.livrables.partages).toBe(PLAFOND_LIVRABLES_RAPPORT + 2);
    expect(c.livrables.elements).toHaveLength(PLAFOND_LIVRABLES_RAPPORT);
  });

  it("nettoie les libellés (chevrons, contrôles, longueur)", () => {
    const c = composerAvancementHebdo(
      faits({
        mission: { intitule: "  <b>Mission</b>\u0000  X ", statut: "en_cours" },
        jalons: [{ libelle: "a".repeat(500), datePrevue: null, atteint: true }],
      }),
    );
    expect(c.mission.intitule).toBe("b Mission /b X");
    expect(c.jalons.atteints.elements[0]?.libelle).toHaveLength(200);
  });

  it("classe les jalons par date puis libellé, les atteints du plus récent au plus ancien", () => {
    const c = composerAvancementHebdo(
      faits({
        jalons: [
          { libelle: "B", datePrevue: "2026-01-01", atteint: true },
          { libelle: "A", datePrevue: "2026-01-01", atteint: true },
          { libelle: "C", datePrevue: "2026-02-01", atteint: true },
        ],
      }),
    );
    expect(c.jalons.atteints.elements.map((j) => j.libelle)).toEqual(["C", "A", "B"]);
  });

  it("refuse des faits invalides", () => {
    const code = (f: FaitsAvancementHebdo) => {
      try {
        composerAvancementHebdo(f);
      } catch (e) {
        expect(e).toBeInstanceOf(ErreurAvancement);
        return (e as ErreurAvancement).code;
      }
      return null;
    };
    expect(code(faits({ semaine: "2026-10-20" }))).toBe("SEMAINE_INVALIDE");
    expect(code(faits({ semaine: "2026-13-01" }))).toBe("SEMAINE_INVALIDE");
    expect(code(faits({ dateReference: "x" }))).toBe("DATE_INVALIDE");
    expect(
      code(faits({ jalons: [{ libelle: "J", datePrevue: "2026-02-30", atteint: false }] })),
    ).toBe("DATE_INVALIDE");
    expect(code(faits({ avancement: 1.2 }))).toBe("AVANCEMENT_INVALIDE");
    expect(code(faits({ avancement: Number.NaN }))).toBe("AVANCEMENT_INVALIDE");
    expect(code(faits({ elementsAvancement: -1 }))).toBe("FAIT_INVALIDE");
    expect(code(faits({ elementsAvancement: 1.5 }))).toBe("FAIT_INVALIDE");
    expect(
      code(
        faits({
          kpis: [
            { libelle: "K", unite: "u", valeur: Infinity, cible: 1, statut: "vert", periode: null },
          ],
        }),
      ),
    ).toBe("FAIT_INVALIDE");
    expect(
      code(
        faits({
          kpis: [
            {
              libelle: "K",
              unite: "u",
              valeur: 1,
              cible: Number.NaN,
              statut: "vert",
              periode: null,
            },
          ],
        }),
      ),
    ).toBe("FAIT_INVALIDE");
  });

  it("ne porte aucune clé financière interne", () => {
    const json = JSON.stringify(composerAvancementHebdo(faits()));
    for (const interdit of [
      "cout",
      "taux",
      "marge",
      "budget",
      "grade",
      "consommation",
      "honoraire",
    ]) {
      expect(json.toLowerCase()).not.toContain(`"${interdit}`);
    }
  });
});
