import { describe, expect, it } from "vitest";
import {
  actionsFeuille,
  chargesResteAFaire,
  cleCase,
  construireCharge,
  lireCase,
  peutDeciderPartie,
  rangeesDepuisCles,
  rangeesInitiales,
  sommeAffichage,
  validerMotif,
  valeursInitiales,
  type ActiviteInterne,
  type LigneFeuille,
} from "./temps";

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const A1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const M1 = "99999999-9999-4999-8999-999999999999";

const ligne = (p: Partial<LigneFeuille>): LigneFeuille => ({
  id: "l",
  date: "2026-10-05",
  mission_id: M1,
  mission_intitule: "Audit",
  tache_id: T1,
  tache_libelle: "Entretiens",
  activite_id: null,
  activite_code: null,
  activite_libelle: null,
  jours: 1,
  heures: null,
  commentaire: null,
  ...p,
});

const activites: ActiviteInterne[] = [
  { id: A1, code: "formation", libelle: "Formation", est_absence: false },
];

describe("lireCase", () => {
  it("lit des jours au pas de 0,5, à la française", () => {
    expect(lireCase("1,5", "demi_journee")).toEqual({ ok: true, valeur: 1.5 });
    expect(lireCase(" 0.5 ", "demi_journee")).toEqual({ ok: true, valeur: 0.5 });
    expect(lireCase("", "demi_journee")).toEqual({ ok: true, valeur: null });
    expect(lireCase("0", "demi_journee")).toEqual({ ok: true, valeur: null });
  });

  it("refuse un pas, un maximum ou un texte invalide", () => {
    expect(lireCase("0,3", "demi_journee").ok).toBe(false);
    expect(lireCase("3,5", "demi_journee").ok).toBe(false);
    expect(lireCase("-1", "demi_journee").ok).toBe(false);
    expect(lireCase("abc", "demi_journee").ok).toBe(false);
  });

  it("lit des heures en minutes entières, 24 au plus", () => {
    expect(lireCase("7,25", "heure")).toEqual({ ok: true, valeur: 7.25 });
    expect(lireCase("7,333", "heure").ok).toBe(false);
    expect(lireCase("25", "heure").ok).toBe(false);
  });
});

describe("grille", () => {
  it("construit les rangées : lignes saisies puis tâches affectées, sans doublon", () => {
    const r = rangeesInitiales(
      [
        ligne({}),
        ligne({
          id: "l2",
          tache_id: null,
          tache_libelle: null,
          mission_id: null,
          activite_id: A1,
          activite_libelle: "Formation",
        }),
      ],
      [
        { tache_id: T1, tache_libelle: "Entretiens", mission_id: M1, mission_intitule: "Audit" },
        { tache_id: T2, tache_libelle: "Analyse", mission_id: M1, mission_intitule: "Audit" },
      ],
      activites,
    );
    expect(r.map((x) => x.cle)).toEqual([`t:${T2}`, `t:${T1}`, `a:${A1}`]);
    expect(r[2]?.groupe).toBe("Activités internes");
  });

  it("reprend les activités ajoutées gardées dans la file locale", () => {
    const r = rangeesInitiales([], [], activites, [`a:${A1}`, "a:inconnue"]);
    expect(r.map((x) => x.cle)).toEqual([`a:${A1}`]);
  });

  it("affiche les valeurs dans l'unité du cabinet", () => {
    const l = [ligne({ jours: 0.94, heures: 7.5 })];
    expect(valeursInitiales(l, "heure")).toEqual({ [cleCase(`t:${T1}`, "2026-10-05")]: "7,5" });
    expect(valeursInitiales(l, "demi_journee")).toEqual({
      [cleCase(`t:${T1}`, "2026-10-05")]: "0,94",
    });
  });

  it("reconstruit les rangées depuis leurs clés et ignore une clé invalide", () => {
    expect(rangeesDepuisCles([`t:${T1}`, `a:${A1}`, "x:1"])).toEqual([
      { cle: `t:${T1}`, type: "tache", id: T1 },
      { cle: `a:${A1}`, type: "activite", id: A1 },
    ]);
  });
});

describe("construireCharge", () => {
  const rangees = rangeesDepuisCles([`t:${T1}`, `a:${A1}`]);
  const jours = ["2026-10-05", "2026-10-06"];

  it("envoie une ligne par case non vide, en jours", () => {
    const r = construireCharge(
      rangees,
      { [`t:${T1}|2026-10-05`]: "1", [`a:${A1}|2026-10-06`]: "0,5", [`t:${T1}|2026-10-06`]: "" },
      jours,
      "demi_journee",
    );
    expect(r).toEqual({
      ok: true,
      charge: {
        lignes: [
          { date: "2026-10-05", tache_id: T1, jours: 1 },
          { date: "2026-10-06", activite_id: A1, jours: 0.5 },
        ],
      },
    });
  });

  it("envoie des heures pour un cabinet à l'heure", () => {
    const r = construireCharge(rangees, { [`t:${T1}|2026-10-05`]: "7,5" }, jours, "heure");
    expect(r.ok && r.charge.lignes).toEqual([{ date: "2026-10-05", tache_id: T1, heures: 7.5 }]);
  });

  it("ignore les jours non fournis (période clôturée) et signale les cases invalides", () => {
    const r = construireCharge(
      rangees,
      { [`t:${T1}|2026-10-05`]: "0,2", [`t:${T1}|2026-10-07`]: "1" },
      jours,
      "demi_journee",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erreurs)).toEqual([`t:${T1}|2026-10-05`]);
  });
});

describe("sommeAffichage", () => {
  it("additionne sans erreur d'arrondi et ignore les cases illisibles", () => {
    expect(sommeAffichage(["0,1", "0,2"], "heure")).toBe(0.3);
    expect(sommeAffichage(["0,5", "0,5", "0,3"], "demi_journee")).toBe(1);
    expect(sommeAffichage(["1,5", "x", "", "0,5"], "demi_journee")).toBe(2);
    expect(sommeAffichage(["7,25", "0,75"], "heure")).toBe(8);
  });
});

describe("règles d'actions", () => {
  const moi = "u-moi";

  it("l'auteur modifie et soumet un brouillon ou une feuille rejetée", () => {
    expect(actionsFeuille({ statut: "brouillon", auteur_id: moi }, moi)).toMatchObject({
      modifier: true,
      soumettre: true,
      libelleSoumettre: "Soumettre la feuille",
    });
    expect(actionsFeuille({ statut: "rejetee", auteur_id: moi }, moi).libelleSoumettre).toBe(
      "Resoumettre la feuille",
    );
  });

  it("rien n'est modifiable une fois soumise, validée ou verrouillée, ni par un tiers", () => {
    for (const statut of ["soumise", "validee", "verrouillee"] as const) {
      expect(actionsFeuille({ statut, auteur_id: moi }, moi).modifier).toBe(false);
    }
    expect(actionsFeuille({ statut: "brouillon", auteur_id: "autre" }, moi).modifier).toBe(false);
    expect(actionsFeuille(null, moi).soumettre).toBe(false);
  });

  it("jamais de décision sur sa propre feuille, même si l'API l'autorise", () => {
    const f = { statut: "soumise" as const, auteur_id: moi };
    expect(peutDeciderPartie(f, { peut_decider: true }, moi)).toBe(false);
    expect(peutDeciderPartie(f, { peut_decider: true }, "chef")).toBe(true);
    expect(peutDeciderPartie(f, { peut_decider: false }, "chef")).toBe(false);
    expect(peutDeciderPartie({ ...f, statut: "validee" }, { peut_decider: true }, "chef")).toBe(
      false,
    );
  });

  it("exige un motif de rejet", () => {
    expect(validerMotif("  ")).toEqual({ ok: false, erreurs: { motif: "Indiquez le motif." } });
    expect(validerMotif("x".repeat(501)).ok).toBe(false);
    expect(validerMotif(" Jours du 6 à revoir ")).toEqual({
      ok: true,
      charge: { motif: "Jours du 6 à revoir" },
    });
  });
});

describe("chargesResteAFaire", () => {
  const s = (tache_id: string, mission_id: string, texte: string, initial = "") => ({
    tache_id,
    mission_id,
    texte,
    initial,
  });

  it("groupe les valeurs modifiées par mission", () => {
    const r = chargesResteAFaire(
      [s(T1, M1, "2"), s(T2, M1, "1,5", "1,5"), s("t3", "m2", "0", "1")],
      "2026-10-05",
    );
    expect(r).toEqual({
      ok: true,
      charge: [
        { mission_id: M1, corps: { semaine: "2026-10-05", lignes: [{ tache_id: T1, jours: 2 }] } },
        {
          mission_id: "m2",
          corps: { semaine: "2026-10-05", lignes: [{ tache_id: "t3", jours: 0 }] },
        },
      ],
    });
  });

  it("refuse un nombre négatif ou hors du pas de 0,5", () => {
    expect(chargesResteAFaire([s(T1, M1, "-1")], "2026-10-05").ok).toBe(false);
    expect(chargesResteAFaire([s(T1, M1, "1,25")], "2026-10-05").ok).toBe(false);
    expect(chargesResteAFaire([s(T1, M1, "1,25")], "2026-10-05", "heure").ok).toBe(true);
  });
});
