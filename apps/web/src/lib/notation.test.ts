import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  annonceCalcul,
  blocageCalcul,
  CLASSES,
  cheminActionNotation,
  cheminEnvoisMission,
  cheminRapportNotation,
  cheminVersionNotation,
  contributionsUtilisateur,
  dimensionsNonNotables,
  droitsVersion,
  envoisNotables,
  estExpertPublieur,
  etatNotationChange,
  formaterCouverture,
  formaterEcart,
  formaterEcartClasses,
  formaterScore,
  hrefNotation,
  libelleActionRevue,
  libelleClasse,
  libelleDimension,
  libelleEvolution,
  libelleFamille,
  libelleSecteur,
  libelleStatutVersion,
  libelleStrategie,
  lignesDimensions,
  lireEcart,
  lireNumeroVersion,
  LISTE_CLASSES,
  MESSAGE_INTROUVABLE_NOTATION,
  MESSAGE_PUBLICATION_EXPERT,
  messageNotation,
  messageSansAjustement,
  nomRepondant,
  optionsEnvois,
  optionsGrillesCalcul,
  optionsSecteurs,
  peutLireNotation,
  pluriel,
  tonaliteClasse,
  tonaliteStatutVersion,
  validerAjustement,
  validerCalcul,
  validerMotifRenvoi,
  versionAffichee,
  type ContexteNotation,
  type EnvoiQuestionnaire,
  type VueVersionNotation,
} from "./notation";

const MOI = "00000000-0000-4000-8000-000000000001";
const AUTRE = "00000000-0000-4000-8000-000000000002";

type VuePartielle = Pick<
  VueVersionNotation,
  "statut" | "score" | "calcule_par" | "ajustements" | "revue" | "resultat"
>;

function vue(partiel: Partial<VuePartielle> = {}): VuePartielle {
  return {
    statut: "brouillon",
    calcule_par: { id: AUTRE, nom: "Awa" },
    ajustements: [],
    revue: [],
    score: {
      notable: true,
      score_calcule: 62.5,
      score: 64,
      classe: "C",
      dimensions: [
        {
          dimension: "strategie",
          libelle: "Stratégie déployée",
          famille: "excellence",
          scoreCalcule: 70,
          score: 73.5,
          classe: "B",
          deltaCumule: 3.5,
        },
        {
          dimension: "qualite",
          libelle: "Qualité",
          famille: "competitivite",
          scoreCalcule: null,
          score: null,
          classe: null,
          deltaCumule: 0,
        },
      ],
    },
    resultat: {
      grille: "notation_generique",
      version: 1,
      secteur: null,
      strategie: "ignorer",
      notable: true,
      score: 62.5,
      scoreExact: "125/2",
      classe: "C",
      couverture: 0.55,
      dimensions: [
        {
          dimension: "strategie",
          libelle: "Stratégie déployée",
          famille: "excellence",
          notable: true,
          score: 70,
          scoreExact: "70",
          classe: "B",
          couverture: 1,
          indicateurs: [],
          poids: 55,
          poidsExact: "55",
        },
        {
          dimension: "qualite",
          libelle: "Qualité",
          famille: "competitivite",
          notable: false,
          score: null,
          scoreExact: null,
          classe: null,
          couverture: 0.25,
          indicateurs: [],
          poids: 45,
          poidsExact: "45",
        },
      ],
    },
    ...partiel,
  };
}

const ctx = (roles: ContexteNotation["roles"], cloturee = false): ContexteNotation => ({
  roles,
  utilisateurId: MOI,
  missionCloturee: cloturee,
});

describe("permissions de lecture (miroir des routes de l'API)", () => {
  it("consultant, chef, directeur, expert métier et associé lisent ; gestionnaire et ressources non", () => {
    for (const r of [
      "consultant",
      "chef_mission",
      "directeur_mission",
      "expert_metier",
      "associe",
    ] as const) {
      expect(peutLireNotation([r])).toBe(true);
    }
    expect(peutLireNotation(["gestionnaire"])).toBe(false);
    expect(peutLireNotation(["ressources"])).toBe(false);
    expect(peutLireNotation(["expert_externe"])).toBe(false);
  });

  it("seul l'expert métier est « publieur » : l'associé, qui n'a pas notation.publier, ne l'est pas", () => {
    expect(estExpertPublieur(["expert_metier"])).toBe(true);
    expect(estExpertPublieur(["associe"])).toBe(false);
    expect(estExpertPublieur(["consultant"])).toBe(false);
  });
});

describe("libellés : la classe a toujours une lettre et un texte", () => {
  it("cinq classes A à E avec libellé, plage et tonalité", () => {
    expect(LISTE_CLASSES).toEqual(["A", "B", "C", "D", "E"]);
    for (const c of LISTE_CLASSES) {
      expect(CLASSES[c].libelle.length).toBeGreaterThan(0);
      expect(CLASSES[c].plage.length).toBeGreaterThan(0);
    }
    expect(CLASSES.A.plage).toBe("80 et plus");
    expect(CLASSES.E.plage).toBe("moins de 35");
    expect(libelleClasse("B")).toBe("Classe B — Avancé");
    expect(libelleClasse(null)).toBe("Non notable");
    expect(tonaliteClasse("A")).toBe("succes");
    expect(tonaliteClasse("D")).toBe("attention");
    expect(tonaliteClasse("E")).toBe("danger");
    expect(tonaliteClasse(null)).toBe("neutre");
  });

  it("statuts, stratégies, familles, évolutions, revue : repli neutre si inconnu", () => {
    expect(libelleStatutVersion("en_revue")).toBe("En revue (expert)");
    expect(libelleStatutVersion("bizarre")).toBe("Statut inconnu");
    expect(tonaliteStatutVersion("publiee")).toBe("succes");
    expect(tonaliteStatutVersion("bizarre")).toBe("neutre");
    expect(libelleStrategie("penaliser")).toBe("Pénaliser les réponses manquantes");
    expect(libelleFamille("excellence")).toBe("Excellence opérationnelle");
    expect(libelleFamille("competitivite")).toBe("Compétitivité");
    expect(libelleFamille("rse")).toBe("rse");
    expect(libelleFamille("")).toBe("Sans famille");
    expect(libelleEvolution("hausse")).toBe("En hausse");
    expect(libelleEvolution("x")).toBe("Non comparable");
    expect(libelleActionRevue("renvoi")).toBe("Renvoyée en brouillon");
  });

  it("secteur : libellé fourni, sinon celui de la grille générique, sinon le code", () => {
    expect(libelleSecteur(null)).toBe("Pondérations par défaut");
    expect(libelleSecteur("industrie")).toBe("Industrie");
    expect(libelleSecteur("btp", [{ secteur: "btp", libelle: "Bâtiment" }])).toBe("Bâtiment");
    expect(libelleSecteur("spatial")).toBe("spatial");
  });
});

describe("mise en forme : aucune valeur recalculée", () => {
  it("score à une décimale, écarts signés, couverture en pourcentage", () => {
    expect(formaterScore(72.4)).toBe("72,4");
    expect(formaterScore(80)).toBe("80,0");
    expect(formaterScore(null)).toBe("—");
    expect(formaterEcart(4.5)).toBe("+4,5");
    expect(formaterEcart(-4.5)).toBe("−4,5");
    expect(formaterEcart(0)).toBe("0,0");
    expect(formaterEcart(null)).toBe("—");
    expect(formaterCouverture(0.625).replace(/\s/g, " ")).toBe("62,5 %");
    expect(formaterCouverture(undefined)).toBe("—");
    expect(formaterEcartClasses(1)).toBe("+1 classe");
    expect(formaterEcartClasses(-2)).toBe("−2 classes");
    expect(formaterEcartClasses(0)).toBe("Même classe");
    expect(pluriel(1, "réponse")).toBe("1 réponse");
    expect(pluriel(3, "réponse")).toBe("3 réponses");
  });

  it("lignes par dimension : jointure par identifiant, valeurs de l'API intactes", () => {
    const lignes = lignesDimensions(vue());
    expect(lignes).toEqual([
      {
        dimension: "strategie",
        libelle: "Stratégie déployée",
        famille: "excellence",
        notable: true,
        poids: 55,
        couverture: 1,
        scoreCalcule: 70,
        deltaCumule: 3.5,
        score: 73.5,
        classe: "B",
      },
      {
        dimension: "qualite",
        libelle: "Qualité",
        famille: "competitivite",
        notable: false,
        poids: 45,
        couverture: 0.25,
        scoreCalcule: null,
        deltaCumule: 0,
        score: null,
        classe: null,
      },
    ]);
    expect(dimensionsNonNotables(vue()).map((d) => d.dimension)).toEqual(["qualite"]);
    expect(libelleDimension(vue(), "qualite")).toBe("Qualité");
    expect(libelleDimension(vue(), "inconnue")).toBe("inconnue");
  });

  it("répondants : nom et fonction, libellé neutre sans nom", () => {
    expect(nomRepondant({ id: "r", nom: "Kouadio", fonction: "DAF" })).toBe("Kouadio (DAF)");
    expect(nomRepondant({ id: "r", nom: "Kouadio", fonction: null })).toBe("Kouadio");
    expect(nomRepondant({ id: "r" })).toBe("Répondant");
  });
});

describe("droits d'affichage d'une version", () => {
  it("consultant : ajuste et soumet la dernière version en brouillon ; jamais publier", () => {
    const d = droitsVersion(ctx(["consultant"]), vue(), true);
    expect(d).toMatchObject({ ajuster: true, soumettre: true, renvoyer: false, publier: false });
    expect(d.blocageSoumission).toBeNull();
  });

  it("une version qui n'est pas la dernière est en lecture seule", () => {
    const d = droitsVersion(ctx(["consultant"]), vue(), false);
    expect(d).toMatchObject({ ajuster: false, soumettre: false, renvoyer: false, publier: false });
  });

  it("mission clôturée : plus d'ajustement", () => {
    expect(droitsVersion(ctx(["consultant"], true), vue(), true).ajuster).toBe(false);
  });

  it("score global non notable : soumission bloquée, avec une explication", () => {
    const v = vue({ score: { ...vue().score, notable: false, score: null, classe: null } });
    const d = droitsVersion(ctx(["consultant"]), v, true);
    expect(d.soumettre).toBe(false);
    expect(d.blocageSoumission).toMatch(/pas notable/);
  });

  it("expert métier non auteur : renvoie et publie une version en revue", () => {
    const d = droitsVersion(ctx(["expert_metier"]), vue({ statut: "en_revue" }), true);
    expect(d).toMatchObject({ renvoyer: true, publier: true, explicationPublication: null });
    expect(d.ajuster).toBe(false);
  });

  it("séparation des tâches : l'expert auteur d'un ajustement ne publie pas, avec la raison", () => {
    const v = vue({
      statut: "en_revue",
      ajustements: [
        {
          rang: 1,
          dimension: "strategie",
          delta: 3.5,
          motif: "Entretien",
          date: "2026-10-06",
          score_avant: 70,
          score_apres: 73.5,
          plafonne: false,
          auteur: { id: MOI, nom: "Moi" },
          cree_le: "2026-10-06T10:00:00Z",
        },
      ],
    });
    const d = droitsVersion(ctx(["expert_metier"]), v, true);
    expect(d.publier).toBe(false);
    expect(d.renvoyer).toBe(true);
    expect(d.explicationPublication).toMatch(/vous avez ajusté une dimension/);
    expect(d.explicationPublication).toMatch(/séparation des tâches/);
  });

  it("auteur du calcul et de la soumission : les deux raisons sont citées", () => {
    const v = vue({
      statut: "en_revue",
      calcule_par: { id: MOI, nom: "Moi" },
      revue: [
        { rang: 1, action: "soumission", motif: null, par: { id: MOI, nom: "Moi" }, le: "x" },
      ],
    });
    expect(contributionsUtilisateur(v, MOI)).toEqual([
      "vous avez lancé ce calcul",
      "vous avez soumis cette version en revue",
    ]);
    expect(droitsVersion(ctx(["expert_metier"]), v, true).explicationPublication).toMatch(
      /lancé ce calcul et vous avez soumis/,
    );
  });

  it("associé (sans notation.publier ni le rôle expert) : pas de bouton, explication NOT-07", () => {
    const d = droitsVersion(ctx(["associe"]), vue({ statut: "en_revue" }), true);
    expect(d.publier).toBe(false);
    expect(d.renvoyer).toBe(false);
    expect(d.explicationPublication).toBe(MESSAGE_PUBLICATION_EXPERT);
  });

  it("version publiée : plus aucune action", () => {
    const d = droitsVersion(ctx(["associe", "expert_metier"]), vue({ statut: "publiee" }), true);
    expect(d).toMatchObject({ ajuster: false, soumettre: false, renvoyer: false, publier: false });
    expect(d.explicationPublication).toBeNull();
  });
});

describe("message quand l'ajustement n'est pas proposé", () => {
  it("version antérieure, hors brouillon, rôle, mission clôturée, aucune dimension notable", () => {
    expect(messageSansAjustement(ctx(["consultant"]), "brouillon", false)).toMatch(/antérieure/);
    expect(messageSansAjustement(ctx(["consultant"]), "en_revue", true)).toMatch(/brouillon/);
    expect(messageSansAjustement(ctx(["expert_metier"]), "brouillon", true)).toMatch(/consultant/);
    expect(messageSansAjustement(ctx(["consultant"], true), "brouillon", true)).toMatch(/clôturée/);
    expect(messageSansAjustement(ctx(["consultant"]), "brouillon", true)).toMatch(/notable/);
  });
});

describe("blocage d'un nouveau calcul", () => {
  it("raison claire : rôle, mission clôturée, version en revue ; sinon null", () => {
    expect(blocageCalcul(ctx(["expert_metier"]), null)).toMatch(/consultant/);
    expect(blocageCalcul(ctx(["consultant"], true), "brouillon")).toMatch(/clôturée/);
    expect(blocageCalcul(ctx(["consultant"]), "en_revue")).toMatch(/en revue/);
    expect(blocageCalcul(ctx(["consultant"]), "publiee")).toBeNull();
    expect(blocageCalcul(ctx(["consultant"]), null)).toBeNull();
  });
});

describe("saisies", () => {
  const envois = [
    { id: "e1", reponses_soumises: 2 },
    { id: "e2", reponses_soumises: 0 },
  ];

  it("calcul : questionnaire avec réponses soumises obligatoire ; valeurs vides → défauts de l'API", () => {
    expect(
      validerCalcul(
        { envoiId: "", grilleVersionId: "", secteur: "", strategie: "ignorer" },
        envois,
      ),
    ).toEqual({
      ok: false,
      erreurs: { envoiId: "Choisissez le questionnaire dont les réponses seront notées." },
    });
    const sans = validerCalcul(
      { envoiId: "e2", grilleVersionId: "", secteur: "", strategie: "ignorer" },
      envois,
    );
    expect(sans.ok).toBe(false);
    expect(
      validerCalcul(
        { envoiId: "e1", grilleVersionId: "", secteur: "", strategie: "ignorer" },
        envois,
      ),
    ).toEqual({
      ok: true,
      charge: { envoi_id: "e1", grille_version_id: null, secteur: null, strategie: "ignorer" },
    });
    expect(
      validerCalcul(
        { envoiId: "e1", grilleVersionId: "g1", secteur: "industrie", strategie: "penaliser" },
        envois,
      ),
    ).toEqual({
      ok: true,
      charge: {
        envoi_id: "e1",
        grille_version_id: "g1",
        secteur: "industrie",
        strategie: "penaliser",
      },
    });
    expect(
      validerCalcul({ envoiId: "e1", grilleVersionId: "", secteur: "", strategie: "x" }, envois).ok,
    ).toBe(false);
  });

  it("écart d'ajustement : une décimale au plus, signes acceptés", () => {
    expect(lireEcart("-4,5")).toBe(-4.5);
    expect(lireEcart("+3")).toBe(3);
    expect(lireEcart("−2")).toBe(-2);
    expect(lireEcart(" 12.5 ")).toBe(12.5);
    expect(lireEcart("2,25")).toBeNull();
    expect(lireEcart("abc")).toBeNull();
    expect(lireEcart("")).toBeNull();
  });

  it("ajustement : motif obligatoire, écart non nul dans [−100, 100], dimension notable", () => {
    const notables = ["strategie"];
    const ok = validerAjustement(
      { dimension: "strategie", delta: "-4,5", motif: " Entretien " },
      notables,
    );
    expect(ok).toEqual({
      ok: true,
      charge: { dimension: "strategie", delta: -4.5, motif: "Entretien" },
    });
    const r = validerAjustement({ dimension: "qualite", delta: "0", motif: "" }, notables);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.erreurs).sort()).toEqual(["delta", "dimension", "motif"]);
      expect(r.erreurs.motif).toMatch(/obligatoire/);
    }
    const trop = validerAjustement({ dimension: "strategie", delta: "150", motif: "x" }, notables);
    expect(trop.ok).toBe(false);
    const precision = validerAjustement(
      { dimension: "strategie", delta: "1,25", motif: "x" },
      notables,
    );
    expect(precision.ok).toBe(false);
    const long = validerAjustement(
      { dimension: "strategie", delta: "1", motif: "a".repeat(2001) },
      notables,
    );
    expect(long.ok).toBe(false);
  });

  it("renvoi : motif obligatoire", () => {
    expect(validerMotifRenvoi("  ").ok).toBe(false);
    expect(validerMotifRenvoi(" Justifier l'écart ")).toEqual({
      ok: true,
      charge: { motif: "Justifier l'écart" },
    });
    expect(validerMotifRenvoi("a".repeat(2001)).ok).toBe(false);
  });
});

describe("erreurs de l'API", () => {
  const erreur = (statut: number, code: string, message = "Message de l'API.") =>
    new ErreurApi(code, message, statut);

  it("séparation des tâches et rôle expert : message de l'API repris tel quel", () => {
    expect(
      messageNotation(erreur(403, "SEPARATION_DES_TACHES", "Un autre expert doit relire.")),
    ).toBe("Un autre expert doit relire.");
    expect(
      messageNotation(erreur(403, "EXPERT_METIER_REQUIS", "Seul un expert métier publie.")),
    ).toBe("Seul un expert métier publie.");
  });

  it("403 générique, 404, 409, 400 du moteur", () => {
    expect(messageNotation(erreur(403, "INTERDIT"))).toBe(
      "Votre rôle ne vous permet pas d'effectuer cette action.",
    );
    expect(messageNotation(erreur(404, "INTROUVABLE"))).toBe(MESSAGE_INTROUVABLE_NOTATION);
    expect(messageNotation(erreur(409, "CONFLIT", "La version en revue doit être publiée."))).toBe(
      "La version en revue doit être publiée.",
    );
    expect(messageNotation(erreur(400, "AJUSTEMENT_INVALIDE", "Une décimale au plus."))).toBe(
      "Une décimale au plus.",
    );
    expect(messageNotation(erreur(400, "REQUETE_INVALIDE", "Données invalides."))).toMatch(
      /Certaines valeurs/,
    );
    expect(messageNotation(new Error("x"))).toMatch(/inattendue/);
  });

  it("404 et 409 : l'état affiché est périmé", () => {
    expect(etatNotationChange(erreur(409, "CONFLIT"))).toBe(true);
    expect(etatNotationChange(erreur(404, "INTROUVABLE"))).toBe(true);
    expect(etatNotationChange(erreur(400, "REQUETE_INVALIDE"))).toBe(false);
    expect(etatNotationChange(new Error("x"))).toBe(false);
  });
});

describe("versions et chemins", () => {
  it("numéro de version lu dans l'URL", () => {
    expect(lireNumeroVersion("3")).toBe(3);
    expect(lireNumeroVersion(["2", "5"])).toBe(2);
    expect(lireNumeroVersion("0")).toBeNull();
    expect(lireNumeroVersion("-1")).toBeNull();
    expect(lireNumeroVersion("1e3")).toBeNull();
    expect(lireNumeroVersion("200000")).toBeNull();
    expect(lireNumeroVersion(undefined)).toBeNull();
  });

  it("version affichée : la demandée si elle existe, sinon la plus récente", () => {
    const versions = [{ numero: 3 }, { numero: 2 }, { numero: 1 }];
    expect(versionAffichee(versions, null)).toEqual({
      numero: 3,
      introuvable: false,
      derniere: true,
    });
    expect(versionAffichee(versions, 2)).toEqual({
      numero: 2,
      introuvable: false,
      derniere: false,
    });
    expect(versionAffichee(versions, 9)).toEqual({ numero: 3, introuvable: true, derniere: true });
    expect(versionAffichee([], null)).toEqual({ numero: null, introuvable: false, derniere: true });
  });

  it("chemins encodés", () => {
    expect(hrefNotation("m1")).toBe("/missions/m1/notation");
    expect(hrefNotation("m1", 2)).toBe("/missions/m1/notation?version=2");
    expect(cheminVersionNotation("n/1", 2)).toBe("/api/notations/n%2F1/version?version=2");
    expect(cheminRapportNotation("n1", 4)).toBe("/api/notations/n1/rapport?version=4");
    expect(cheminActionNotation("n1", "publier")).toBe("/api/notations/n1/publier");
    expect(cheminEnvoisMission("m1")).toBe("/api/missions/m1/questionnaires?limite=100");
  });
});

describe("choix proposés au calcul", () => {
  const envoi = (p: Partial<EnvoiQuestionnaire>): EnvoiQuestionnaire => ({
    id: "e1",
    titre: "Notation",
    mode: "individuel",
    statut: "envoye",
    repondants: 3,
    reponses_soumises: 2,
    envoye_le: null,
    clos_le: null,
    ...p,
  });

  it("questionnaires : nombre de réponses soumises ; sans réponse, désactivé", () => {
    const options = optionsEnvois([
      envoi({}),
      envoi({ id: "e2", titre: "Collectif", mode: "collectif", reponses_soumises: 1 }),
      envoi({ id: "e3", reponses_soumises: 0 }),
    ]);
    expect(options).toEqual([
      { valeur: "e1", libelle: "Notation — individuel, 2 réponses soumises", desactivee: false },
      { valeur: "e2", libelle: "Collectif — collectif, 1 réponse soumise", desactivee: false },
      { valeur: "e3", libelle: "Notation — individuel, aucune réponse soumise", desactivee: true },
    ]);
    expect(envoisNotables([envoi({}), envoi({ id: "e3", reponses_soumises: 0 })])).toHaveLength(1);
  });

  it("grilles : générique d'abord, puis seulement les grilles validées", () => {
    expect(
      optionsGrillesCalcul([
        { titre: "Grille BTP", code: "btp", version_validee_id: "v1" },
        { titre: "Brouillon", code: "b", version_validee_id: null },
      ]),
    ).toEqual([
      { valeur: "", libelle: "Grille générique MissionPilot (par défaut)" },
      { valeur: "v1", libelle: "Grille BTP (btp)" },
    ]);
  });

  it("secteurs : pondérations par défaut d'abord", () => {
    expect(optionsSecteurs([{ secteur: "btp", libelle: "BTP" }, { secteur: "x" }])).toEqual([
      { valeur: "", libelle: "Pondérations par défaut de la grille" },
      { valeur: "btp", libelle: "BTP" },
      { valeur: "x", libelle: "x" },
    ]);
  });

  it("annonce du calcul : chiffres de l'API, ou « non notable »", () => {
    expect(annonceCalcul({ numero: 2, score: vue().score })).toBe(
      "Calcul terminé : version 2 en brouillon, score global 64,0 sur 100, Classe C — Intermédiaire.",
    );
    expect(
      annonceCalcul({
        numero: 1,
        score: { ...vue().score, notable: false, score: null, classe: null },
      }),
    ).toMatch(/non notable/);
  });
});
