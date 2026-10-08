import { describe, expect, it } from "vitest";
import {
  etatMois,
  libelleMois,
  libelleMoisCourt,
  notesPrevision,
  type ReponsePrevisions,
} from "./previsions";

function reponse(surcharge: Partial<ReponsePrevisions> = {}): ReponsePrevisions {
  return {
    devise: "XOF",
    date_reference: "2026-10-15",
    mois: [],
    totaux: {
      ca_carnet: 0,
      ca_pipeline: 0,
      ca_total: 0,
      capacite_jours: 0,
      charge_carnet_jours: 0,
      charge_a_pourvoir_jours: 0,
      charge_pipeline_jours: 0,
      charge_totale_jours: 0,
    },
    au_dela: { ca_carnet: 0, ca_pipeline: 0 },
    en_retard: { nombre: 0, montant: 0 },
    par_etape: [],
    nombre_echeances: 0,
    nombre_opportunites: 0,
    opportunites_sans_date: 0,
    opportunites_sans_charge: 0,
    opportunites_en_retard: 0,
    exclusions: { echeances_sans_taux_change: 0, opportunites_autre_devise: 0 },
    hypotheses: {
      probabilite_defaut_par_etape: {
        prospection: 10,
        qualification: 25,
        proposition: 50,
        negociation: 75,
      },
      delai_signature_mois: 1,
      duree_mois: 3,
      delai_sans_date_mois: 3,
    },
    ...surcharge,
  };
}

const f = (v: number) => `${v} F`;

describe("libellés de mois", () => {
  it("écrit le mois en français", () => {
    expect(libelleMois("2026-10")).toBe("octobre 2026");
    expect(libelleMois("2027-01")).toBe("janvier 2027");
    expect(libelleMois("2026-12")).toBe("décembre 2026");
  });

  it("abrège les mois longs et garde les mois courts", () => {
    expect(libelleMoisCourt("2026-10")).toBe("oct. 2026");
    expect(libelleMoisCourt("2026-06")).toBe("juin 2026");
    expect(libelleMoisCourt("2026-08")).toBe("août 2026");
  });

  it("rend une valeur inattendue telle quelle", () => {
    expect(libelleMois("n'importe quoi")).toBe("n'importe quoi");
    expect(libelleMoisCourt("2026-13")).toBe("2026-13");
  });
});

describe("état de charge d'un mois", () => {
  it("réutilise les libellés du plan de charge", () => {
    expect(etatMois({ etat: "surcharge" }).libelle).toBe("Surcharge");
    expect(etatMois({ etat: "sous_occupation" }).tonalite).toBe("attention");
  });
});

describe("notes de prévision", () => {
  it("n'en écrit aucune quand tout est normal", () => {
    expect(notesPrevision(reponse(), f)).toEqual([]);
  });

  it("signale tout ce qui est écarté, supposé ou hors horizon", () => {
    const notes = notesPrevision(
      reponse({
        en_retard: { nombre: 2, montant: 500 },
        au_dela: { ca_carnet: 10, ca_pipeline: 20 },
        opportunites_sans_date: 1,
        opportunites_en_retard: 3,
        opportunites_sans_charge: 4,
        exclusions: { echeances_sans_taux_change: 5, opportunites_autre_devise: 6 },
      }),
      f,
    );
    expect(notes).toHaveLength(7);
    expect(notes[0]).toContain("2 échéance(s) en retard (500 F)");
    expect(notes[1]).toContain("10 F de carnet signé et 20 F de pipeline");
    expect(notes[2]).toContain("démarrage supposé à 3 mois");
    expect(notes.join(" ")).toContain("devise différente");
  });
});
