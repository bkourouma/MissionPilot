import { describe, expect, it } from "vitest";
import type { RedCovenantVue } from "@missionpilot/shared";
import { MOTS_INTERDITS } from "./redressement";
import {
  cheminCovenants,
  cheminFinancement,
  cheminPropositionFinancement,
  cheminTresorerieMensuelle,
  cheminVersionsCovenants,
  cheminVersionsFinancement,
  formaterCouverture,
  formaterMargeCovenant,
  formaterValeurCovenant,
  libelleExigenceCovenant,
  libelleMois,
  libelleNatureFinancement,
  libelleNombreSemaines,
  libelleRaisonCovenant,
  libelleSemainesTension,
  libelleStatutCovenant,
  libellesFinancement,
  MENTION_COVENANT,
  tonaliteStatutCovenant,
  tonaliteStatutFinancement,
} from "./redressement-financement";

const ID = "11111111-1111-4111-8111-111111111111";
/** Intl insère des espaces insécables : on les normalise pour comparer. */
const norm = (t: string) => t.replace(/[\u00a0\u202f]/g, " ");

describe("chemins d'API du financement", () => {
  it("construit les chemins", () => {
    expect(cheminTresorerieMensuelle(ID)).toBe(
      `/api/redressement/dossiers/${ID}/tresorerie/mensuelle`,
    );
    expect(cheminCovenants(ID)).toBe(`/api/redressement/dossiers/${ID}/covenants`);
    expect(cheminVersionsCovenants(ID)).toBe(`/api/redressement/dossiers/${ID}/covenants/versions`);
    expect(cheminFinancement(ID)).toBe(`/api/redressement/dossiers/${ID}/financement`);
    expect(cheminVersionsFinancement(ID)).toBe(
      `/api/redressement/dossiers/${ID}/financement/versions`,
    );
  });

  it("n'ajoute que les paramètres fournis à la proposition", () => {
    expect(cheminPropositionFinancement(ID)).toBe(
      `/api/redressement/dossiers/${ID}/financement/proposition`,
    );
    expect(
      cheminPropositionFinancement(ID, {
        date_debut: "2027-01-01",
        type_periode: "semestre",
        nombre_periodes: 4,
      }),
    ).toBe(
      `/api/redressement/dossiers/${ID}/financement/proposition?date_debut=2027-01-01&type_periode=semestre&nombre_periodes=4`,
    );
  });
});

describe("libellés du financement", () => {
  it("écrit les mois en français", () => {
    expect(libelleMois("2026-03")).toBe("mars 2026");
    expect(libelleMois("2026-12")).toBe("décembre 2026");
    expect(libelleMois("2026-02")).toBe("février 2026");
    expect(libelleMois("n'importe quoi")).toBe("n'importe quoi");
    expect(libelleMois("2026-13")).toBe("2026-13");
  });

  it("accorde les semaines", () => {
    expect(libelleNombreSemaines(1)).toBe("1 semaine");
    expect(libelleNombreSemaines(4)).toBe("4 semaines");
    expect(libelleSemainesTension([])).toBe("—");
    expect(libelleSemainesTension([3])).toBe("semaine 3");
    expect(libelleSemainesTension([3, 4])).toBe("semaines 3, 4");
  });

  it("nomme la nature d'une ligne", () => {
    expect(libelleNatureFinancement("investissements")).toBe("Investissements");
    expect(libelleNatureFinancement("inconnue")).toBe("inconnue");
  });

  it("dit un seuil non atteint comme un constat arithmétique", () => {
    expect(libelleStatutCovenant("en_defaut")).toBe("Seuil non atteint (constat arithmétique)");
    expect(libelleStatutCovenant("respecte")).toBe("Seuil respecté");
    expect(libelleStatutCovenant("non_calculable")).toBe("Non calculable");
    expect(tonaliteStatutCovenant("respecte")).toBe("succes");
    expect(tonaliteStatutCovenant("en_defaut")).toBe("attention");
    expect(tonaliteStatutCovenant("non_calculable")).toBe("neutre");
  });

  it("ne traite pas un excédent comme une insuffisance", () => {
    expect(tonaliteStatutFinancement("equilibre")).toBe("succes");
    expect(tonaliteStatutFinancement("insuffisance")).toBe("attention");
  });
});

describe("valeurs, seuils et marges de covenant", () => {
  it("met en forme un rapport et un pourcentage", () => {
    expect(formaterValeurCovenant("liquidite_generale", 12000)).toBe("1,20");
    expect(norm(formaterValeurCovenant("autonomie_financiere", 2500))).toBe("25,00 %");
    expect(formaterValeurCovenant("endettement", null)).toBe("—");
  });

  it("écrit la marge d'un pourcentage en points, celle d'un rapport en nombre signé", () => {
    expect(norm(formaterMargeCovenant("autonomie_financiere", 250))).toBe("+2,5 points");
    expect(norm(formaterMargeCovenant("autonomie_financiere", -100))).toBe("-1 point");
    expect(formaterMargeCovenant("liquidite_generale", 2000)).toBe("+0,20");
    expect(formaterMargeCovenant("liquidite_generale", -500)).toBe("-0,05");
    expect(formaterMargeCovenant("liquidite_generale", 0)).toBe("0,00");
    expect(formaterMargeCovenant("liquidite_generale", null)).toBe("—");
  });

  it("énonce l'exigence", () => {
    expect(
      libelleExigenceCovenant({ ratio: "liquidite_generale", operateur: "min", seuil_pb: 12000 }),
    ).toBe("Au moins 1,20");
    expect(
      libelleExigenceCovenant({ ratio: "endettement", operateur: "max", seuil_pb: 20000 }),
    ).toBe("Au plus 2,00");
  });

  const covenant = (evaluation: Partial<RedCovenantVue["evaluation"]>): RedCovenantVue => ({
    id: ID,
    rang: 1,
    ratio: "liquidite_generale",
    operateur: "min",
    seuil_pb: 12000,
    preteur: null,
    frequence: "annuelle",
    evaluation: {
      statut: "non_calculable",
      valeur_pb: null,
      marge_pb: null,
      raison: null,
      manquants: [],
      ...evaluation,
    },
  });

  it("explique un covenant non calculable", () => {
    expect(libelleRaisonCovenant(covenant({}))).toBe("");
    expect(libelleRaisonCovenant(covenant({ raison: "aucun_etat_accepte" }))).toBe(
      "Aucun état financier accepté pour ce client.",
    );
    expect(
      libelleRaisonCovenant(
        covenant({ raison: "ratio_non_calculable", manquants: ["stocks", "creances_clients"] }),
      ),
    ).toContain("Stocks");
    expect(libelleRaisonCovenant(covenant({ raison: "ratio_non_calculable" }))).toBe(
      "Le ratio n'est pas calculable : des postes sont à renseigner.",
    );
  });

  it("met en forme la couverture", () => {
    expect(norm(formaterCouverture(12500))).toBe("125 %");
    expect(norm(formaterCouverture(8333))).toBe("83,3 %");
    expect(formaterCouverture(null)).toBe("—");
  });
});

describe("textes de l'onglet", () => {
  it("garde la mention fixe de l'API", () => {
    expect(MENTION_COVENANT).toContain("Constat arithmétique");
  });

  it("n'emploie aucun mot interdit", () => {
    for (const t of libellesFinancement()) {
      for (const mot of MOTS_INTERDITS) expect(t.toLowerCase()).not.toContain(mot);
    }
  });
});
