import { describe, expect, it } from "vitest";
import type { Facteur } from "./methodes";
import {
  briqueRelevee,
  construireCorpsApercu,
  explicationOrigine,
  libelleEtapeApercu,
  libelleTypeElement,
  lignesAjustements,
  MENTION_APERCU,
  phraseTemps,
  repartitionParClasse,
  texteClasseEffective,
  texteGardeApercu,
  texteTempsBrique,
  type ApercuMission,
} from "./methodes-apercu";

const FACTEURS: Facteur[] = [
  {
    id: "f1",
    code: "effectif",
    libelle: "Effectif",
    description: null,
    type: "nombre",
    valeurs: null,
    min: 0,
    max: null,
    porte_par: "mission",
    origine: "standard",
  },
];

describe("corps de l'aperçu", () => {
  it("met le contexte typé dans le corps et omet les facteurs vides", () => {
    expect(construireCorpsApercu({ effectif: "12" }, FACTEURS)).toEqual({
      ok: true,
      charge: { contexte: { effectif: 12 } },
    });
    expect(construireCorpsApercu({}, FACTEURS)).toEqual({ ok: true, charge: { contexte: {} } });
  });

  it("signale un contexte hors des bornes du facteur", () => {
    const r = construireCorpsApercu({ effectif: "-3" }, FACTEURS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs.effectif).toContain("bornes");
  });
});

describe("formulations de l'aperçu", () => {
  it("explique l'origine d'une brique", () => {
    expect(explicationOrigine({ active: true, origine: "modulation" })).toContain("Activée");
    expect(explicationOrigine({ active: false, origine: "modulation" })).toContain("Retirée");
    expect(explicationOrigine({ active: true, origine: "methode" })).toContain("Prévue");
    expect(explicationOrigine({ active: false, origine: "methode" })).toContain("Inactive");
    expect(explicationOrigine({ active: true, origine: "derogation" })).toContain("dérogation");
  });

  it("dit quand la classe est relevée", () => {
    expect(texteClasseEffective({ classe_risque: "R2", classe_risque_base: "R1" })).toBe(
      "R2, relevée depuis R1",
    );
    expect(texteClasseEffective({ classe_risque: "R1", classe_risque_base: "R1" })).toBe("R1");
    expect(briqueRelevee({ classe_risque: "R2", classe_risque_base: "R1" })).toBe(true);
    expect(briqueRelevee({ classe_risque: "R1", classe_risque_base: "R1" })).toBe(false);
  });

  it("décrit la garde requise", () => {
    expect(texteGardeApercu({ etapes: [], quatre_yeux: false, signature: false })).toBe(
      "Automatique, journalisée",
    );
    expect(
      texteGardeApercu({
        etapes: ["validation_consultant", "revue_second_expert", "signature_directeur_mission"],
        quatre_yeux: true,
        signature: true,
      }),
    ).toBe(
      "Validation du consultant → Revue d'un second expert → Signature du directeur de mission (quatre yeux, signature)",
    );
  });

  it("formate le temps d'une brique", () => {
    expect(texteTempsBrique(null)).toBe("non estimé");
    expect(texteTempsBrique(2.5)).toMatch(/^2,5\s?j$/);
  });

  it("donne un libellé de type d'élément, sinon le type", () => {
    expect(libelleTypeElement("livrable")).not.toBe("livrable");
    expect(libelleTypeElement("inconnu")).toBe("inconnu");
  });

  it("énonce la mention d'aperçu", () => {
    expect(MENTION_APERCU).toBe(
      "Aperçu : rien n'est enregistré. Les chiffres viennent du moteur de calcul, pas de l'IA.",
    );
  });
});

describe("synthèse", () => {
  const synthese: ApercuMission["synthese"] = {
    briques_actives: 3,
    briques_inactives: 1,
    briques_par_classe: { R0: 0, R1: 2, R2: 1, R3: 0 },
    classe_max: "R2",
    briques_quatre_yeux: 1,
    briques_signature: 0,
    temps_type_total_jours: 4.5,
    temps_par_etape: [{ etape_code: "cadrage", jours: 4.5 }],
    briques_sans_temps: ["atelier"],
    elements_actifs_par_type: { livrable: 2 },
  };

  it("répartit les briques actives de R0 à R3", () => {
    expect(repartitionParClasse(synthese)).toEqual([
      { classe: "R0", nombre: 0 },
      { classe: "R1", nombre: 2 },
      { classe: "R2", nombre: 1 },
      { classe: "R3", nombre: 0 },
    ]);
  });

  it("met la durée en phrase et signale les briques sans temps", () => {
    expect(phraseTemps(synthese)).toMatch(/^Durée type totale : 4,5\s?j\./);
    expect(phraseTemps(synthese)).toContain("1 brique(s) active(s) sans temps estimé");
    expect(phraseTemps({ ...synthese, briques_sans_temps: [] })).not.toContain("sans temps");
  });

  it("retrouve le libellé d'une étape, sinon son code", () => {
    const a = { methode: { etapes: [{ code: "cadrage", libelle: "Cadrage" }] } } as Pick<
      ApercuMission,
      "methode"
    >;
    expect(libelleEtapeApercu(a, "cadrage")).toBe("Cadrage");
    expect(libelleEtapeApercu(a, "autre")).toBe("autre");
  });

  it("liste les ajustements décidés par les règles", () => {
    expect(
      lignesAjustements({
        ponderations: { k: 0.5 },
        seuils: {},
        benchmarks: {},
        gabarits: { rapport: "court" },
        formulations: {},
        classes_risque_relevees: { atelier: "R2" },
      }),
    ).toEqual([
      "Pondération — k : 0,5",
      "Gabarit — rapport : court",
      "Classe de risque relevée — atelier : R2",
    ]);
  });
});
