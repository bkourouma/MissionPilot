import { describe, expect, it } from "vitest";
import {
  cleActionAutomatisation,
  ErreurAutomatisation,
  evaluerConditionAutomatisation,
  garderActionAutomatisation,
  joursEcoules,
  normaliserPayloadEvenement,
  palierAtteint,
  PALIERS_SANS_REPONSE_JOURS,
  planifierExecutionAutomatisation,
  rendreGabarit,
  serieRougeFinale,
  simulerAutomatisation,
  validerConditionAutomatisation,
  validerPayloadEvenement,
  valeurAdmise,
  variablesGabarit,
  variablesInconnues,
  type ChampsEvenement,
  type ConditionAutomatisation,
  type ContexteGarde,
  type EvenementSimule,
  type MetaAction,
} from "../index";

const CHAMPS: ChampsEvenement = {
  mission_id: { type: "identifiant", requis: true },
  jours: { type: "nombre", requis: true },
  libelle: { type: "texte", requis: false },
  jour: { type: "date", requis: false },
  urgent: { type: "booleen", requis: false },
};

const ID = "0b0e8f8a-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const PAYLOAD = {
  mission_id: ID,
  jours: 10,
  libelle: "Jalon Final",
  jour: "2026-10-08",
  urgent: true,
};

const cmp = (
  champ: string,
  operateur: Extract<ConditionAutomatisation, { type: "comparaison" }>["operateur"],
  valeur: Extract<ConditionAutomatisation, { type: "comparaison" }>["valeur"],
): ConditionAutomatisation => ({ type: "comparaison", champ, operateur, valeur });

const OK: ContexteGarde = {
  coupeCircuitCabinet: false,
  coupeCircuitAutomatisation: false,
  coupeCircuitN4: false,
  droitsSuffisants: true,
  missionVisible: true,
};

describe("conditions typées", () => {
  it("valide une condition bien formée", () => {
    const c: ConditionAutomatisation = {
      type: "tous",
      conditions: [
        cmp("jours", "superieur_ou_egal", 7),
        { type: "non", condition: cmp("libelle", "contient", "test") },
        {
          type: "au_moins_un",
          conditions: [cmp("urgent", "egal", true), { type: "renseigne", champ: "jour" }],
        },
        cmp("mission_id", "dans", [ID]),
        cmp("jour", "inferieur", "2027-01-01"),
      ],
    };
    expect(validerConditionAutomatisation(c, CHAMPS)).toEqual([]);
    expect(validerConditionAutomatisation(null, CHAMPS)).toEqual([]);
  });

  it("refuse un champ inconnu, un opérateur incompatible, une valeur mal formée", () => {
    const erreurs = validerConditionAutomatisation(
      {
        type: "tous",
        conditions: [
          cmp("inconnu", "egal", 1),
          { type: "renseigne", champ: "absent" },
          cmp("urgent", "superieur", 1),
          cmp("jours", "egal", "dix"),
          cmp("jours", "dans", []),
          cmp("jour", "egal", "08/10/2026"),
          cmp("libelle", "egal", ["a"]),
          cmp("mission_id", "contient", "x"),
          cmp("libelle", "egal", ""),
          cmp("jours", "egal", Number.NaN),
        ],
      },
      CHAMPS,
    );
    expect(erreurs.map((e) => e.code)).toEqual([
      "CHAMP_INCONNU",
      "CHAMP_INCONNU",
      "OPERATEUR_INCOMPATIBLE",
      "VALEUR_INCOMPATIBLE",
      "VALEUR_INCOMPATIBLE",
      "VALEUR_INCOMPATIBLE",
      "VALEUR_INCOMPATIBLE",
      "OPERATEUR_INCOMPATIBLE",
      "VALEUR_INCOMPATIBLE",
      "VALEUR_INCOMPATIBLE",
    ]);
    expect(erreurs[0]?.chemin).toBe("conditions.0.champ");
  });

  it("n'admet comme date qu'une date civile existante (AAAA-MM-JJ)", () => {
    expect(valeurAdmise("date", "egal", "2026-10-08")).toBe(true);
    expect(valeurAdmise("date", "dans", ["2026-10-08", "2028-02-29"])).toBe(true);
    for (const v of ["2026-13-45", "2026-02-30", "2027-02-29", "2026-1-1", "demain"]) {
      expect(valeurAdmise("date", "egal", v)).toBe(false);
    }
    expect(valeurAdmise("date", "dans", ["2026-10-08", "2026-13-45"])).toBe(false);
  });

  it("borne la profondeur et le nombre de nœuds", () => {
    let c: ConditionAutomatisation = cmp("jours", "egal", 1);
    for (let i = 0; i < 5; i++) c = { type: "non", condition: c };
    expect(validerConditionAutomatisation(c, CHAMPS).map((e) => e.code)).toEqual(["TROP_COMPLEXE"]);
    const large: ConditionAutomatisation = {
      type: "tous",
      conditions: Array.from({ length: 40 }, () => cmp("jours", "egal", 1)),
    };
    expect(validerConditionAutomatisation(large, CHAMPS)).toHaveLength(1);
    expect(
      valeurAdmise(
        "nombre",
        "dans",
        Array.from({ length: 51 }, () => 1),
      ),
    ).toBe(false);
  });

  it("évalue chaque opérateur ; un champ absent ou nul ne satisfait aucune comparaison", () => {
    const e = (c: ConditionAutomatisation | null, p: Record<string, unknown> = PAYLOAD) =>
      evaluerConditionAutomatisation(c, p as never);
    expect(e(null)).toBe(true);
    expect(e(cmp("jours", "egal", 10))).toBe(true);
    expect(e(cmp("jours", "different", 10))).toBe(false);
    expect(e(cmp("jours", "inferieur", 11))).toBe(true);
    expect(e(cmp("jours", "inferieur_ou_egal", 10))).toBe(true);
    expect(e(cmp("jours", "superieur", 10))).toBe(false);
    expect(e(cmp("jours", "superieur_ou_egal", 10))).toBe(true);
    expect(e(cmp("jour", "superieur", "2026-01-01"))).toBe(true);
    expect(e(cmp("jours", "dans", [3, 10]))).toBe(true);
    expect(e(cmp("libelle", "contient", "final"))).toBe(true);
    expect(e(cmp("jours", "contient", "1"))).toBe(false);
    expect(e(cmp("jours", "superieur", "9"))).toBe(false);
    expect(e(cmp("urgent", "superieur", true))).toBe(false);
    expect(e(cmp("libelle", "egal", "x"), { libelle: null })).toBe(false);
    expect(e(cmp("libelle", "different", "x"), {})).toBe(false);
    expect(e({ type: "renseigne", champ: "libelle" })).toBe(true);
    expect(e({ type: "renseigne", champ: "libelle" }, { libelle: "" })).toBe(false);
    expect(e({ type: "renseigne", champ: "libelle" }, { libelle: null })).toBe(false);
    expect(e({ type: "renseigne", champ: "toString" }, {})).toBe(false);
    expect(
      e({ type: "au_moins_un", conditions: [cmp("jours", "egal", 1), cmp("jours", "egal", 10)] }),
    ).toBe(true);
    expect(
      e({ type: "tous", conditions: [cmp("jours", "egal", 1), cmp("jours", "egal", 10)] }),
    ).toBe(false);
    expect(e({ type: "non", condition: cmp("jours", "egal", 1) })).toBe(true);
  });

  it("refuse à l'évaluation une condition trop imbriquée ou inconnue", () => {
    let c: ConditionAutomatisation = cmp("jours", "egal", 1);
    for (let i = 0; i < 6; i++) c = { type: "non", condition: c };
    expect(() => evaluerConditionAutomatisation(c, PAYLOAD)).toThrow(ErreurAutomatisation);
    expect(() => evaluerConditionAutomatisation({ type: "autre" } as never, PAYLOAD)).toThrow(
      /inconnu/,
    );
  });
});

describe("contenu des événements", () => {
  it("accepte un contenu conforme et le normalise", () => {
    expect(validerPayloadEvenement(PAYLOAD, CHAMPS)).toEqual([]);
    expect(normaliserPayloadEvenement({ mission_id: ID, jours: 3 }, CHAMPS)).toEqual({
      jour: null,
      jours: 3,
      libelle: null,
      mission_id: ID,
      urgent: null,
    });
  });

  it("signale champ inconnu, requis absent et type faux", () => {
    expect(validerPayloadEvenement([], CHAMPS)).toEqual([
      { champ: null, code: "PAYLOAD_NON_OBJET" },
    ]);
    expect(validerPayloadEvenement(null, CHAMPS)[0]?.code).toBe("PAYLOAD_NON_OBJET");
    expect(
      validerPayloadEvenement(
        {
          autre: 1,
          jours: "10",
          mission_id: "pas-un-uuid",
          libelle: "x".repeat(501),
          jour: "2026-1-1",
          urgent: "oui",
        },
        CHAMPS,
      ),
    ).toEqual([
      { champ: "autre", code: "CHAMP_INCONNU" },
      { champ: "jour", code: "TYPE" },
      { champ: "jours", code: "TYPE" },
      { champ: "libelle", code: "TYPE" },
      { champ: "mission_id", code: "TYPE" },
      { champ: "urgent", code: "TYPE" },
    ]);
    expect(validerPayloadEvenement({ jours: 1 }, CHAMPS)).toEqual([
      { champ: "mission_id", code: "CHAMP_REQUIS" },
    ]);
  });

  it("refuse une date du contenu qui n'existe pas au calendrier", () => {
    const base = { mission_id: ID, jours: 1 };
    expect(validerPayloadEvenement({ ...base, jour: "2028-02-29" }, CHAMPS)).toEqual([]);
    for (const jour of ["2026-13-45", "2026-02-30", "2027-02-29", "2026-00-10"]) {
      expect(validerPayloadEvenement({ ...base, jour }, CHAMPS)).toEqual([
        { champ: "jour", code: "TYPE" },
      ]);
    }
  });
});

describe("gabarits", () => {
  it("rend les champs cités, vides si absents, sans expression", () => {
    const g = "Jalon {{ libelle }} ({{jours}} j) {{absent}} {{jours}} {{Pas}}";
    expect(variablesGabarit(g)).toEqual(["libelle", "jours", "absent"]);
    expect(variablesInconnues(g, CHAMPS)).toEqual(["absent"]);
    expect(rendreGabarit(g, { libelle: "Final", jours: 3, absent: null })).toBe(
      "Jalon Final (3 j)  3 {{Pas}}",
    );
    expect(rendreGabarit("{{libelle}}", {})).toBe("");
  });
});

describe("planification idempotente", () => {
  const def = {
    condition: cmp("jours", "superieur_ou_egal", 7),
    actions: [{ type: "a" }, { type: "b" }],
  };

  it("planifie les actions avec une clé stable", () => {
    const plan = planifierExecutionAutomatisation("aut1", def, { id: "evt1", payload: PAYLOAD });
    expect(plan.declenchee).toBe(true);
    expect(plan.actions.map((a) => a.cle)).toEqual(["aut:aut1:evt:evt1:0", "aut:aut1:evt:evt1:1"]);
    expect(planifierExecutionAutomatisation("aut1", def, { id: "evt1", payload: PAYLOAD })).toEqual(
      plan,
    );
  });

  it("ne planifie rien si la condition échoue", () => {
    expect(
      planifierExecutionAutomatisation("aut1", def, { id: "evt1", payload: { jours: 1 } }),
    ).toEqual({ declenchee: false, actions: [] });
  });

  it("refuse une définition vide ou trop longue, des identifiants invalides", () => {
    expect(() =>
      planifierExecutionAutomatisation(
        "a",
        { condition: null, actions: [] },
        { id: "e", payload: {} },
      ),
    ).toThrow(ErreurAutomatisation);
    expect(() =>
      planifierExecutionAutomatisation(
        "a",
        { condition: null, actions: Array.from({ length: 11 }, () => ({})) },
        { id: "e", payload: {} },
      ),
    ).toThrow(/1 à 10/);
    expect(() => cleActionAutomatisation("a:b", "e", 0)).toThrow(ErreurAutomatisation);
    expect(() => cleActionAutomatisation("a", "e", 10)).toThrow(/Rang/);
    expect(() => cleActionAutomatisation("a", "e", 1.5)).toThrow(/Rang/);
  });
});

describe("garde d'action", () => {
  const interne: MetaAction = { classeRisque: "R1", versClient: false };
  const relance: MetaAction = { classeRisque: "R0", versClient: true };

  it("autorise une action interne ou une relance R0 sans coupe-circuit", () => {
    expect(garderActionAutomatisation(interne, OK)).toEqual({ autorisee: true, refus: [] });
    expect(garderActionAutomatisation(relance, OK)).toEqual({ autorisee: true, refus: [] });
  });

  it("refuse R2 et R3 vers le client, et N4 hors R0", () => {
    expect(garderActionAutomatisation({ classeRisque: "R2", versClient: true }, OK).refus).toEqual([
      "CONTENU_R2_R3_VERS_CLIENT",
      "N4_RESERVE_R0",
    ]);
    expect(garderActionAutomatisation({ classeRisque: "R3", versClient: true }, OK).autorisee).toBe(
      false,
    );
    expect(garderActionAutomatisation({ classeRisque: "R1", versClient: true }, OK).refus).toEqual([
      "N4_RESERVE_R0",
    ]);
    expect(
      garderActionAutomatisation({ classeRisque: "R3", versClient: false }, OK).autorisee,
    ).toBe(true);
  });

  it("applique les coupe-circuits, les droits et la visibilité, en listant tout", () => {
    const tout: ContexteGarde = {
      coupeCircuitCabinet: true,
      coupeCircuitAutomatisation: true,
      coupeCircuitN4: true,
      droitsSuffisants: false,
      missionVisible: false,
    };
    expect(garderActionAutomatisation(relance, tout).refus).toEqual([
      "COUPE_CIRCUIT_CABINET",
      "COUPE_CIRCUIT_AUTOMATISATION",
      "COUPE_CIRCUIT_N4",
      "DROITS_INSUFFISANTS",
      "MISSION_INVISIBLE",
    ]);
    // Le coupe-circuit N4 n'arrête que ce qui va vers le client.
    expect(garderActionAutomatisation(interne, { ...OK, coupeCircuitN4: true }).autorisee).toBe(
      true,
    );
  });

  it("exige le niveau d'autonomie effectif de la brique d'un agent", () => {
    const agent: MetaAction = { classeRisque: "R1", versClient: false, niveauAgentRequis: "N2" };
    expect(garderActionAutomatisation(agent, { ...OK, niveauAgentEffectif: "N3" }).autorisee).toBe(
      true,
    );
    expect(garderActionAutomatisation(agent, { ...OK, niveauAgentEffectif: "N1" }).refus).toEqual([
      "NIVEAU_AGENT_INSUFFISANT",
    ]);
    expect(garderActionAutomatisation(agent, OK).refus).toEqual(["NIVEAU_AGENT_INSUFFISANT"]);
    expect(
      garderActionAutomatisation(agent, { ...OK, niveauAgentEffectif: "N9" as never }).autorisee,
    ).toBe(false);
  });

  it("refuse une entrée mal formée", () => {
    expect(() =>
      garderActionAutomatisation({ classeRisque: "R9" as never, versClient: false }, OK),
    ).toThrow(ErreurAutomatisation);
    expect(() =>
      garderActionAutomatisation(
        { classeRisque: "R0", versClient: false, niveauAgentRequis: "N7" as never },
        OK,
      ),
    ).toThrow(/requis/);
  });
});

describe("simulation sur des événements passés", () => {
  it("compte déclenchements, actions autorisées et refus, sans effet", () => {
    const def = {
      condition: cmp("jours", "egal", 10),
      actions: [{ type: "notifier" }, { type: "relance_questionnaire" }],
    };
    const evenements: EvenementSimule[] = [
      { id: "e1", cree_le: "2026-10-01T00:00:00Z", payload: { jours: 10 } },
      { id: "e2", cree_le: "2026-10-02T00:00:00Z", payload: { jours: 3 } },
      { id: "e3", cree_le: "2026-10-03T00:00:00Z", payload: { jours: 10, mission_id: "x" } },
    ];
    const r = simulerAutomatisation(def, evenements, {
      metaDe: (a) =>
        a.type === "relance_questionnaire"
          ? { classeRisque: "R0", versClient: true }
          : { classeRisque: "R0", versClient: false },
      contexteDe: (e, a) => ({
        ...OK,
        coupeCircuitN4: true,
        missionVisible: e.id !== "e3" || a.type !== "notifier",
      }),
    });
    expect(r).toMatchObject({
      evenements: 3,
      declenchements: 2,
      actions_prevues: 4,
      actions_autorisees: 1,
      actions_refusees: 3,
    });
    expect(r.refus.COUPE_CIRCUIT_N4).toBe(2);
    expect(r.refus.MISSION_INVISIBLE).toBe(1);
    expect(r.details[1]).toEqual({
      evenement_id: "e2",
      cree_le: "2026-10-02T00:00:00Z",
      declenchee: false,
      actions: [],
    });
    expect(r.details[0]?.actions[0]).toEqual({
      indice: 0,
      type: "notifier",
      autorisee: true,
      refus: [],
    });
  });
});

describe("détection des événements nés du temps", () => {
  it("compte les jours entiers écoulés", () => {
    expect(joursEcoules("2026-10-01T10:00:00Z", "2026-10-11T09:59:59Z")).toBe(9);
    expect(joursEcoules("2026-10-01T10:00:00Z", "2026-10-11T10:00:00Z")).toBe(10);
    expect(joursEcoules("2026-10-11T10:00:00Z", "2026-10-01T10:00:00Z")).toBe(0);
    expect(() => joursEcoules("hier", "2026-10-01")).toThrow(ErreurAutomatisation);
  });

  it("n'accepte qu'un instant ISO 8601 avec fuseau (Z ou décalage)", () => {
    // Décalage : 10:00+02:00 = 08:00Z ; 10 jours pleins plus tard à la même heure locale.
    expect(joursEcoules("2026-10-01T10:00:00+02:00", "2026-10-11T08:00:00Z")).toBe(10);
    expect(joursEcoules("2026-10-01T10:00:00.123Z", "2026-10-11T10:00:00-00:00")).toBe(9);
    expect(joursEcoules("2026-10-01T10:00Z", "2026-10-02T10:00Z")).toBe(1);
    const refuses = [
      "2026-10-01T10:00:00", // sans fuseau : dépendrait de la machine
      "2026-10-01 10:00:00Z", // séparateur non ISO
      "2026-10-01", // date seule
      "01/10/2026 10:00:00Z",
      "Oct 1 2026 10:00:00 GMT",
      "2026-13-45T10:00:00Z", // date inexistante
      "2026-02-30T10:00:00Z",
      "2026-10-01T24:00:00Z", // heure hors plage
      "2026-10-01T10:61:00Z",
      "2026-10-01T10:00:00+25:00", // décalage hors plage
      "",
    ];
    for (const r of refuses) {
      expect(() => joursEcoules(r, "2026-10-11T10:00:00Z"), r).toThrow(ErreurAutomatisation);
      expect(() => joursEcoules("2026-10-01T10:00:00Z", r), r).toThrow(ErreurAutomatisation);
    }
  });

  it("donne le plus haut palier atteint", () => {
    expect(palierAtteint(2, PALIERS_SANS_REPONSE_JOURS)).toBeNull();
    expect(palierAtteint(3, PALIERS_SANS_REPONSE_JOURS)).toBe(3);
    expect(palierAtteint(12, PALIERS_SANS_REPONSE_JOURS)).toBe(10);
    expect(palierAtteint(40, PALIERS_SANS_REPONSE_JOURS)).toBe(14);
    expect(() => palierAtteint(Number.NaN, [1])).toThrow(ErreurAutomatisation);
  });

  it("repère une série rouge finale en écartant les périodes non mesurées de la fin", () => {
    const p = (cle: string, statut: string) => ({ cle, statut });
    expect(serieRougeFinale([p("1", "vert"), p("2", "rouge"), p("3", "rouge")])).toEqual({
      periodes: 2,
      periode: "3",
    });
    expect(
      serieRougeFinale([p("1", "rouge"), p("2", "rouge"), p("3", "rouge"), p("4", "non_mesure")]),
    ).toEqual({ periodes: 3, periode: "3" });
    expect(serieRougeFinale([p("1", "rouge"), p("2", "orange")])).toBeNull();
    expect(serieRougeFinale([p("1", "vert"), p("2", "rouge")])).toBeNull();
    expect(serieRougeFinale([])).toBeNull();
    expect(serieRougeFinale([p("1", "non_mesure")])).toBeNull();
    expect(serieRougeFinale([p("1", "rouge")], 1)).toEqual({ periodes: 1, periode: "1" });
    expect(() => serieRougeFinale([], 0)).toThrow(ErreurAutomatisation);
  });
});
