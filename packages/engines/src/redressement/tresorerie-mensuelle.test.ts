import { describe, expect, it } from "vitest";
import { ErreurRedressement } from "./erreurs";
import { agregerTresorerieMensuelle } from "./tresorerie-mensuelle";
import { type EntreeTresorerie, type LigneTresorerie, projeterTresorerie } from "./tresorerie";

const M = 1_000_000;

const entree = (surcharges: Partial<EntreeTresorerie> = {}): EntreeTresorerie => ({
  dateDebut: "2026-10-12",
  soldeInitial: 50 * M,
  seuilTension: 10 * M,
  lignes: [
    { semaine: 1, sens: "encaissement", categorie: "clients", montant: 30 * M },
    { semaine: 1, sens: "decaissement", categorie: "fournisseurs", montant: 40 * M },
    { semaine: 1, sens: "decaissement", categorie: "salaires", montant: 25 * M },
    { semaine: 2, sens: "encaissement", categorie: "clients", montant: 20 * M },
    { semaine: 2, sens: "decaissement", categorie: "fournisseurs", montant: 30 * M },
    { semaine: 3, sens: "encaissement", categorie: "clients", montant: 15 * M },
    { semaine: 3, sens: "decaissement", categorie: "fournisseurs", montant: 35 * M },
    { semaine: 4, sens: "encaissement", categorie: "clients", montant: 90 * M },
    { semaine: 13, sens: "decaissement", categorie: "salaires", montant: 5 * M },
  ],
  realises: [],
  ...surcharges,
});

describe("agregerTresorerieMensuelle", () => {
  const projection = projeterTresorerie(entree());
  const mensuel = agregerTresorerieMensuelle(projection);

  it("une semaine appartient au mois de son lundi (12 oct. 2026 → 4 janv. 2027)", () => {
    expect(mensuel.mois.map((m) => m.mois)).toEqual(["2026-10", "2026-11", "2026-12", "2027-01"]);
    const semaines = mensuel.mois.map((m) => m.semaines);
    expect(semaines).toEqual([[1, 2, 3], [4, 5, 6, 7, 8], [9, 10, 11, 12], [13]]);
    expect(semaines.flat()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it("flux et soldes de fin de mois exacts, égaux à ceux de la projection hebdomadaire", () => {
    const [oct, nov, , jan] = mensuel.mois;
    expect(oct?.encaissements).toBe(65 * M);
    expect(oct?.decaissements).toBe(130 * M);
    expect(oct?.fluxNet).toBe(-65 * M);
    expect(oct?.soldeOuverture).toBe(50 * M);
    expect(oct?.soldeFin).toBe(-15 * M);
    expect(oct?.soldeFin).toBe(projection.semaines[2]?.soldeClotureRetenu);
    expect(oct?.debut).toBe("2026-10-12");
    expect(oct?.fin).toBe("2026-11-01");
    expect(nov?.encaissements).toBe(90 * M);
    expect(nov?.decaissements).toBe(0);
    expect(nov?.soldeOuverture).toBe(-15 * M);
    expect(nov?.soldeFin).toBe(75 * M);
    expect(jan?.decaissements).toBe(5 * M);
    expect(jan?.soldeFin).toBe(70 * M);
  });

  it("mois de tension, solde minimum et totaux", () => {
    expect(mensuel.moisTension).toEqual(["2026-10"]);
    expect(mensuel.premierMoisTension).toBe("2026-10");
    expect(mensuel.mois[0]?.semainesTension).toEqual([2, 3]);
    expect(mensuel.mois[0]?.soldeMinimum).toEqual({ semaine: 3, montant: -15 * M });
    expect(mensuel.mois[1]?.tension).toBe(false);
    expect(mensuel.soldeMinimum).toEqual({ mois: "2026-10", semaine: 3, montant: -15 * M });
    expect(mensuel.soldeMinimum.montant).toBe(projection.soldeMinimum.montant);
    const net = mensuel.mois.reduce((t, m) => t + m.fluxNet, 0);
    expect(mensuel.totaux.fluxNet).toBe(net);
    expect(mensuel.totaux.fluxNet).toBe(projection.totaux.fluxNetPrevu);
    expect(mensuel.totaux.encaissements).toBe(projection.totaux.encaissementsPrevus);
    expect(mensuel.totaux.decaissements).toBe(projection.totaux.decaissementsPrevus);
  });

  it("mois partiels : premier si son premier lundi est après le 7, dernier si la semaine suivante reste dans le mois", () => {
    expect(mensuel.mois.map((m) => m.partiel)).toEqual([true, false, false, true]);
    const complet = agregerTresorerieMensuelle(
      projeterTresorerie(entree({ dateDebut: "2026-10-05" })),
    );
    expect(complet.mois[0]?.partiel).toBe(false);
  });

  it("les flux retenus utilisent le réalisé quand il existe et comptent les semaines réalisées", () => {
    const p = projeterTresorerie(
      entree({
        realises: [
          {
            semaine: 1,
            flux: {
              encaissement: { clients: 28 * M },
              decaissement: { fournisseurs: 41 * M, salaires: 25 * M },
            },
            soldeConstate: null,
          },
        ],
      }),
    );
    const m = agregerTresorerieMensuelle(p);
    expect(m.mois[0]?.semainesRealisees).toBe(1);
    expect(m.mois[0]?.encaissements).toBe((28 + 20 + 15) * M);
    expect(m.mois[0]?.decaissements).toBe((66 + 30 + 35) * M);
    expect(m.mois[0]?.soldeFin).toBe(p.semaines[2]?.soldeClotureRetenu);
  });

  it("sans ligne et sous le seuil : aucun mois en tension", () => {
    const m = agregerTresorerieMensuelle(
      projeterTresorerie(entree({ lignes: [] as LigneTresorerie[], seuilTension: 0 })),
    );
    expect(m.moisTension).toEqual([]);
    expect(m.premierMoisTension).toBeNull();
    expect(m.mois.every((x) => x.soldeFin === 50 * M)).toBe(true);
  });

  it("rejette une projection vide", () => {
    expect(() => agregerTresorerieMensuelle({ ...projection, semaines: [] })).toThrowError(
      ErreurRedressement,
    );
  });
});
