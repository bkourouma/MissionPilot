import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  actionsEnvoi,
  aideAucunRepondant,
  anomaliesDepuisErreur,
  cheminEnvoisMission,
  cheminModeles,
  cheminRepondantsEligibles,
  dateDuJour,
  datesEnvoi,
  erreurDateLimite,
  estRefusRepondant,
  garderRepondants,
  hrefAvecCurseur,
  hrefEnvoi,
  libelleMode,
  libelleStatut,
  lireCurseur,
  MESSAGE_REPONDANT_REFUSE,
  messageCreationEnvoi,
  messageQuestionnaire,
  messageRelance,
  messageRepondantsEligibles,
  modelesEnvoyables,
  origineModele,
  PAGES_MAX_REPONDANTS,
  relanceRecente,
  repondantEnAttente,
  resumeEnvoi,
  rolesRepondant,
  SAISIE_ENVOI_VIDE,
  STATUT_ENVOI,
  STATUT_REPONSE,
  texteProgression,
  texteRelances,
  TITRE_AUCUN_REPONDANT,
  toutesLesPages,
  validerEnvoi,
  validerModele,
  validerReglages,
  type ModeleResume,
  type PageQuestionnaires,
  type PageRepondantsEligibles,
  type RepondantEligible,
  type SaisieEnvoi,
} from "./questionnaires";

const AUJOURDHUI = "2026-10-06";
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const V = "33333333-3333-4333-8333-333333333333";

const saisie = (s: Partial<SaisieEnvoi>): SaisieEnvoi => ({
  ...SAISIE_ENVOI_VIDE,
  version_id: V,
  ...s,
});

describe("droits et actions sur un envoi", () => {
  const chef = { roles: ["chef_mission"] as const, missionCloturee: false };

  it("propose l'envoi d'un brouillon, la relance et la clôture d'un envoi en cours", () => {
    expect(actionsEnvoi({ statut: "brouillon" }, chef)).toEqual({
      envoyer: true,
      relancer: false,
      clore: false,
      modifierReglages: true,
      raisonLectureSeule: null,
    });
    expect(actionsEnvoi({ statut: "envoye" }, chef)).toMatchObject({
      envoyer: false,
      relancer: true,
      clore: true,
    });
  });

  it("passe en lecture seule : mission clôturée, rôle de lecture, envoi clos", () => {
    const cloturee = actionsEnvoi({ statut: "envoye" }, { ...chef, missionCloturee: true });
    expect(cloturee).toMatchObject({
      envoyer: false,
      relancer: false,
      clore: false,
      modifierReglages: false,
    });
    expect(cloturee.raisonLectureSeule).toMatch(/Mission clôturée/);
    const expert = actionsEnvoi(
      { statut: "envoye" },
      { roles: ["expert_metier"], missionCloturee: false },
    );
    expect(expert.relancer).toBe(false);
    expect(expert.raisonLectureSeule).toMatch(/consulter/);
    const clos = actionsEnvoi({ statut: "clos" }, chef);
    expect(clos).toMatchObject({ modifierReglages: false, relancer: false });
    expect(clos.raisonLectureSeule).toMatch(/clos/);
  });

  it("un répondant n'attend plus une fois sa réponse (ou la réponse partagée) soumise", () => {
    expect(
      repondantEnAttente({ mode: "individuel", reponse_collective: null }, { statut: "brouillon" }),
    ).toBe(true);
    expect(
      repondantEnAttente({ mode: "par_fonction", reponse_collective: null }, { statut: "soumise" }),
    ).toBe(false);
    const commune = (statut: "brouillon" | "soumise") => ({
      statut,
      soumise_le: null,
      soumise_par_nom: null,
      derniere_saisie: null,
      progression: {
        pourcentage: 0,
        complet: false,
        questions_visibles: 1,
        questions_repondues: 0,
        obligatoires_visibles: 1,
        obligatoires_repondues: 0,
      },
    });
    expect(
      repondantEnAttente({ mode: "collectif", reponse_collective: commune("brouillon") }, {}),
    ).toBe(true);
    expect(
      repondantEnAttente({ mode: "collectif", reponse_collective: commune("soumise") }, {}),
    ).toBe(false);
  });

  it("repère une relance de moins de 24 h", () => {
    const maintenant = new Date("2026-10-06T12:00:00Z");
    expect(relanceRecente(null, maintenant)).toBe(false);
    expect(relanceRecente("2026-10-05T12:30:00Z", maintenant)).toBe(true);
    expect(relanceRecente("2026-10-05T11:59:00Z", maintenant)).toBe(false);
    expect(relanceRecente("pas une date", maintenant)).toBe(false);
    expect(relanceRecente("2026-10-07T00:00:00Z", maintenant)).toBe(false);
  });
});

describe("libellés", () => {
  it("donne un libellé à chaque statut et un repli pour un statut inconnu", () => {
    expect(libelleStatut(STATUT_ENVOI, "envoye").libelle).toBe("Envoyé");
    expect(libelleStatut(STATUT_REPONSE, "non_commence").libelle).toBe("Non commencé");
    expect(libelleStatut(STATUT_ENVOI, "toString")).toEqual({
      libelle: "Statut inconnu",
      tonalite: "neutre",
    });
    expect(origineModele("gabarit")).toMatch(/gabarit/);
    expect(origineModele("autre")).toBe("Origine inconnue");
    expect(libelleMode("par_fonction")).toBe("Par fonction");
    expect(libelleMode("inconnu")).toBe("inconnu");
  });

  it("décrit la progression et les relances", () => {
    const p = {
      pourcentage: 50,
      complet: false,
      questions_visibles: 6,
      questions_repondues: 3,
      obligatoires_visibles: 4,
      obligatoires_repondues: 2,
    };
    expect(texteProgression(p)).toBe("2 / 4 questions obligatoires renseignées");
    expect(texteProgression({ ...p, obligatoires_visibles: 0, questions_repondues: 1 })).toMatch(
      /^1 réponse,/,
    );
    expect(texteRelances(0)).toBe("Aucune relance");
    expect(texteRelances(1)).toBe("1 relance");
    expect(texteRelances(3)).toBe("3 relances");
  });
});

describe("liste des envois d'une mission", () => {
  const e = {
    statut: "envoye" as const,
    mode: "individuel" as const,
    repondants: 3,
    reponses_soumises: 1,
    cree_le: "2026-10-01T09:00:00Z",
    envoye_le: "2026-10-02T09:00:00Z",
    clos_le: null,
    date_limite: "2026-10-20",
    relances_auto: true,
  };

  it("résume le suivi selon le statut et le mode", () => {
    expect(resumeEnvoi(e)).toBe("1 réponse soumise sur 3");
    expect(resumeEnvoi({ ...e, reponses_soumises: 2 })).toBe("2 réponses soumises sur 3");
    expect(resumeEnvoi({ ...e, reponses_soumises: 0 })).toBe("0 réponse soumise sur 3");
    expect(resumeEnvoi({ ...e, statut: "brouillon", repondants: 1 })).toBe(
      "1 répondant désigné, non envoyé",
    );
    expect(resumeEnvoi({ ...e, mode: "collectif", reponses_soumises: 0 })).toBe(
      "Réponse partagée non soumise · 3 répondants",
    );
    expect(resumeEnvoi({ ...e, mode: "collectif", repondants: 1 })).toBe(
      "Réponse partagée soumise · 1 répondant",
    );
  });

  it("donne les dates et l'état des relances automatiques", () => {
    expect(datesEnvoi(e)).toBe(
      "envoyé le 2 oct. 2026 à 09:00 · date limite : 20 oct. 2026 · relances automatiques actives",
    );
    expect(datesEnvoi({ ...e, statut: "brouillon", envoye_le: null, date_limite: null })).toBe(
      "créé le 1 oct. 2026 à 09:00",
    );
    expect(
      datesEnvoi({ ...e, statut: "clos", clos_le: "2026-10-25T10:00:00Z", relances_auto: false }),
    ).toMatch(/clos le 25 oct\. 2026 à 10:00$/);
    expect(datesEnvoi({ ...e, relances_auto: false })).toMatch(
      /relances automatiques désactivées$/,
    );
  });
});

describe("répondants désignables", () => {
  const r = (id: string, nom: string, roles: RepondantEligible["roles"]): RepondantEligible => ({
    id,
    nom,
    email: `${nom.toLowerCase()}@exemple.ci`,
    roles,
  });

  it("charge la route dédiée de la mission page par page, jusqu'à épuisement", async () => {
    expect(cheminRepondantsEligibles("m 1", null)).toBe(
      "/api/missions/m%201/questionnaires/repondants-eligibles?limite=100",
    );
    expect(cheminRepondantsEligibles("m1", "c=1")).toBe(
      "/api/missions/m1/questionnaires/repondants-eligibles?limite=100&curseur=c%3D1",
    );
    const pages: Record<string, PageRepondantsEligibles> = {
      [cheminRepondantsEligibles("m1", null)]: {
        elements: [r(U1, "Ama", ["client_dirigeant"])],
        curseur_suivant: "c1",
      },
      [cheminRepondantsEligibles("m1", "c1")]: {
        elements: [r(U2, "Zoé", ["client_contributeur"])],
        curseur_suivant: null,
      },
    };
    const appels: string[] = [];
    const liste = await toutesLesPages(
      (chemin) => {
        appels.push(chemin);
        return Promise.resolve(pages[chemin] as PageRepondantsEligibles);
      },
      (curseur) => cheminRepondantsEligibles("m1", curseur),
      PAGES_MAX_REPONDANTS,
    );
    expect(liste.tronquee).toBe(false);
    expect(liste.elements.map((e) => e.nom)).toEqual(["Ama", "Zoé"]);
    expect(appels).toHaveLength(2);
    // Plafond : 10 pages de 100, liste alors marquée partielle.
    let n = 0;
    const plafond = await toutesLesPages(
      () => Promise.resolve({ elements: [r(U1, "Ama", [])], curseur_suivant: `c${++n}` }),
      (curseur) => cheminRepondantsEligibles("m1", curseur),
      PAGES_MAX_REPONDANTS,
    );
    expect(plafond).toMatchObject({ tronquee: true });
    expect(n).toBe(10);
  });

  it("décrit les rôles d'un répondant", () => {
    expect(rolesRepondant({ roles: ["client_dirigeant", "client_contributeur"] })).toBe(
      "Dirigeant, Contributeur",
    );
    expect(rolesRepondant({ roles: ["client_contributeur"] })).toBe("Contributeur");
  });

  it("explique un échec du chargement : mission clôturée, introuvable, rôle, réseau", () => {
    expect(messageRepondantsEligibles(new ErreurApi("CONFLIT", "x", 409))).toMatch(
      /^Mission clôturée/,
    );
    expect(messageRepondantsEligibles(new ErreurApi("INTROUVABLE", "x", 404))).toMatch(
      /^Mission introuvable/,
    );
    expect(messageRepondantsEligibles(new ErreurApi("INTERDIT", "x", 403))).toMatch(
      /Votre rôle ne permet pas/,
    );
    expect(
      messageRepondantsEligibles(new ErreurApi("RESEAU_INDISPONIBLE", "Connexion impossible.", 0)),
    ).toBe("Connexion impossible.");
    expect(messageRepondantsEligibles(new Error("x"))).toMatch(/n'a pas pu être chargée/);
  });

  it("explique l'absence de répondant, avec ou sans droit d'inviter au portail", () => {
    expect(TITRE_AUCUN_REPONDANT).toBe(
      "Aucun répondant éligible : invitez d'abord des utilisateurs du portail du client.",
    );
    expect(aideAucunRepondant(true)).toMatch(/onglet « Portail client » de la fiche du client/);
    expect(aideAucunRepondant(false)).toMatch(/demandez-leur d'inviter les répondants/);
    expect(aideAucunRepondant(false)).not.toMatch(/onglet/);
    for (const v of [true, false]) expect(aideAucunRepondant(v)).toMatch(/client non archivé/);
  });

  it("retire de la saisie les répondants qui ne sont plus proposés", () => {
    const saisis = {
      [U1]: { choisi: true, fonction: "DAF" },
      [U2]: { choisi: true, fonction: "" },
    };
    expect(garderRepondants(saisis, [{ id: U1 }])).toEqual({
      [U1]: { choisi: true, fonction: "DAF" },
    });
    expect(garderRepondants(saisis, [])).toEqual({});
  });

  it("reconnaît le refus d'un répondant à la création (compte désactivé, client archivé)", () => {
    const archive = new ErreurApi(
      "REQUETE_INVALIDE",
      "Chaque répondant doit être un dirigeant ou un contributeur actif du portail du client de la mission.",
      400,
    );
    expect(estRefusRepondant(archive)).toBe(true);
    expect(messageCreationEnvoi(archive)).toBe(MESSAGE_REPONDANT_REFUSE);
    expect(MESSAGE_REPONDANT_REFUSE).toMatch(/client a été archivé/);
    expect(estRefusRepondant(new ErreurApi("REPONDANT_INVALIDE", "Répondant invalide.", 400))).toBe(
      true,
    );
    // Validation de forme (détails par champ) : pas un refus de répondant.
    const forme = new ErreurApi("REQUETE_INVALIDE", "Données invalides.", 400, {
      fieldErrors: {
        repondants: ["En mode « par fonction », chaque répondant indique sa fonction."],
      },
    });
    expect(estRefusRepondant(forme)).toBe(false);
    expect(messageCreationEnvoi(forme)).toBeNull();
    expect(estRefusRepondant(new ErreurApi("CONFLIT", "La mission est clôturée.", 409))).toBe(
      false,
    );
    expect(messageCreationEnvoi(new ErreurApi("CONFLIT", "La mission est clôturée.", 409))).toBe(
      "La mission est clôturée.",
    );
    expect(estRefusRepondant(new Error("x"))).toBe(false);
  });
});

describe("saisie d'un envoi", () => {
  it("exige un questionnaire et au moins un répondant", () => {
    const r = validerEnvoi(saisie({ version_id: "" }), AUJOURDHUI);
    expect(r).toEqual({
      ok: false,
      erreurs: {
        version_id: "Choisissez le questionnaire à envoyer.",
        repondants: "Choisissez au moins un répondant.",
      },
    });
  });

  it("exige la fonction de chaque répondant en mode « par fonction »", () => {
    const r = validerEnvoi(
      saisie({
        mode: "par_fonction",
        repondants: {
          [U1]: { choisi: true, fonction: "Directeur général" },
          [U2]: { choisi: true, fonction: " " },
        },
      }),
      AUJOURDHUI,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs[`fonction.${U2}`]).toMatch(/obligatoire en mode « par fonction »/);
  });

  it("produit la charge de l'API : répondants cochés, fonction nettoyée, date limite", () => {
    const r = validerEnvoi(
      saisie({
        mode: "par_fonction",
        relances_auto: false,
        date_limite: "2026-10-20",
        repondants: {
          [U1]: { choisi: true, fonction: "  DAF " },
          [U2]: { choisi: false, fonction: "" },
        },
      }),
      AUJOURDHUI,
    );
    expect(r).toEqual({
      ok: true,
      charge: {
        version_id: V,
        mode: "par_fonction",
        repondants: [{ utilisateur_id: U1, fonction: "DAF" }],
        relances_auto: false,
        date_limite: "2026-10-20",
      },
    });
    const collectif = validerEnvoi(
      saisie({ mode: "collectif", repondants: { [U1]: { choisi: true, fonction: "" } } }),
      AUJOURDHUI,
    );
    expect(collectif).toMatchObject({
      ok: true,
      charge: { repondants: [{ utilisateur_id: U1 }], date_limite: null, relances_auto: true },
    });
  });

  it("refuse une date limite passée ou invalide et une fonction trop longue", () => {
    expect(erreurDateLimite("", AUJOURDHUI)).toBeNull();
    expect(erreurDateLimite(AUJOURDHUI, AUJOURDHUI)).toBeNull();
    expect(erreurDateLimite("2026-10-05", AUJOURDHUI)).toMatch(/passée/);
    expect(erreurDateLimite("2026-02-30", AUJOURDHUI)).toMatch(/invalide/);
    const r = validerEnvoi(
      saisie({ repondants: { [U1]: { choisi: true, fonction: "x".repeat(121) } } }),
      AUJOURDHUI,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs[`fonction.${U1}`]).toBe("120 caractères au plus.");
  });
});

describe("réglages d'un envoi", () => {
  const envoi = { relances_auto: true, date_limite: "2026-10-01" };

  it("n'envoie que les champs modifiés", () => {
    expect(
      validerReglages({ relances_auto: false, date_limite: "2026-10-01" }, envoi, AUJOURDHUI),
    ).toEqual({
      ok: true,
      charge: { relances_auto: false },
    });
    expect(validerReglages({ relances_auto: true, date_limite: "" }, envoi, AUJOURDHUI)).toEqual({
      ok: true,
      charge: { date_limite: null },
    });
    expect(
      validerReglages({ relances_auto: true, date_limite: "2026-10-30" }, envoi, AUJOURDHUI),
    ).toEqual({
      ok: true,
      charge: { date_limite: "2026-10-30" },
    });
  });

  it("refuse une absence de modification et une nouvelle date passée", () => {
    expect(
      validerReglages({ relances_auto: true, date_limite: "2026-10-01" }, envoi, AUJOURDHUI).ok,
    ).toBe(false);
    const r = validerReglages(
      { relances_auto: true, date_limite: "2026-10-02" },
      envoi,
      AUJOURDHUI,
    );
    expect(r).toEqual({
      ok: false,
      erreurs: { date_limite: "La date limite ne peut pas être déjà passée." },
    });
  });
});

describe("saisie d'un nouveau modèle", () => {
  const vide = { source: "vierge" as const, gabarit: "", modele_id: "", code: "", titre: "" };

  it("exige un code au bon format et un titre pour un modèle vierge", () => {
    expect(validerModele(vide)).toEqual({
      ok: false,
      erreurs: { code: "Le code est obligatoire.", titre: "Le titre est obligatoire." },
    });
    const r = validerModele({ ...vide, code: "Diag Express", titre: "Diagnostic" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs.code).toMatch(/Code invalide/);
  });

  it("produit la source attendue par l'API", () => {
    const vierge = validerModele({ ...vide, code: "express", titre: " Diagnostic express " });
    expect(vierge).toMatchObject({
      ok: true,
      charge: {
        code: "express",
        titre: "Diagnostic express",
        source: { type: "definition", definition: { id: "express", titre: "Diagnostic express" } },
      },
    });
    expect(
      validerModele({
        ...vide,
        source: "gabarit",
        gabarit: "preliminaire_dirigeants",
        code: "prelim",
      }),
    ).toEqual({
      ok: true,
      charge: { code: "prelim", source: { type: "gabarit", gabarit: "preliminaire_dirigeants" } },
    });
    expect(
      validerModele({ ...vide, source: "gabarit", gabarit: "inconnu", code: "x" }),
    ).toMatchObject({
      ok: false,
      erreurs: { gabarit: "Choisissez un gabarit." },
    });
    expect(
      validerModele({ ...vide, source: "copie", modele_id: V, code: "copie", titre: "Copie" }),
    ).toEqual({
      ok: true,
      charge: { code: "copie", titre: "Copie", source: { type: "copie", modele_id: V } },
    });
    expect(validerModele({ ...vide, source: "copie", code: "copie" })).toMatchObject({
      ok: false,
      erreurs: { modele_id: expect.any(String) },
    });
  });
});

describe("erreurs de l'API", () => {
  const detaillee = new ErreurApi("REQUETE_INVALIDE", "Données invalides.", 400, {
    formErrors: ["DEFINITION_INVALIDE : Définition de questionnaire invalide (2 anomalie(s))."],
    fieldErrors: {
      "sections[0].questions[1].condition": [
        "REFERENCE_INCONNUE : La condition cite une question inconnue : « inconnue ».",
      ],
      "sections[1]": ["CYCLE : Cycle de conditions : a → b → a."],
    },
  });

  it("extrait les anomalies du moteur (code, chemin, message)", () => {
    expect(anomaliesDepuisErreur(detaillee)).toEqual([
      {
        code: "REFERENCE_INCONNUE",
        chemin: "sections[0].questions[1].condition",
        message: "La condition cite une question inconnue : « inconnue ».",
      },
      { code: "CYCLE", chemin: "sections[1]", message: "Cycle de conditions : a → b → a." },
    ]);
    expect(messageQuestionnaire(detaillee)).toBe(
      "La définition comporte 2 anomalies : corrigez-les puis enregistrez de nouveau.",
    );
  });

  it("remplace une erreur de forme brute (anglais) par une anomalie en français", () => {
    const forme = new ErreurApi("REQUETE_INVALIDE", "Données invalides.", 400, {
      formErrors: [],
      fieldErrors: { definition: ["String must contain at least 1 character(s)"] },
    });
    expect(anomaliesDepuisErreur(forme)).toEqual([
      expect.objectContaining({ code: "FORME_INVALIDE", chemin: "" }),
    ]);
    expect(anomaliesDepuisErreur(new ErreurApi("CONFLIT", "x", 409))).toBeNull();
    const envoi = new ErreurApi("REQUETE_INVALIDE", "Données invalides.", 400, {
      fieldErrors: {
        repondants: ["En mode « par fonction », chaque répondant indique sa fonction."],
      },
    });
    expect(anomaliesDepuisErreur(envoi)).toBeNull();
    expect(messageQuestionnaire(envoi)).toBeNull();
    expect(
      anomaliesDepuisErreur(
        new ErreurApi("REQUETE_INVALIDE", "x", 400, {
          fieldErrors: { source: ["Invalid enum value"], mode: ["Invalid enum value"] },
        }),
      ),
    ).toEqual([expect.objectContaining({ code: "FORME_INVALIDE" })]);
    expect(anomaliesDepuisErreur(new Error("x"))).toBeNull();
  });

  it("garde le message français de l'API pour un 409 et un 400 métier", () => {
    expect(
      messageQuestionnaire(
        new ErreurApi("CONFLIT", "Un modèle de questionnaire porte déjà ce code.", 409),
      ),
    ).toBe("Un modèle de questionnaire porte déjà ce code.");
    expect(
      messageQuestionnaire(new ErreurApi("REPONDANT_INVALIDE", "Répondant invalide.", 400)),
    ).toBe("Répondant invalide.");
    expect(messageQuestionnaire(new ErreurApi("INTROUVABLE", "x", 404))).toMatch(/introuvable/);
    expect(messageQuestionnaire(new ErreurApi("INTERDIT", "x", 403))).toBeNull();
    expect(messageQuestionnaire("x")).toBeNull();
  });

  it("explique un refus de relance (409), sans répéter la règle des 24 h", () => {
    expect(
      messageRelance(new ErreurApi("CONFLIT", "Aucun répondant en attente à relancer.", 409)),
    ).toMatch(
      /^Relance refusée : Aucun répondant en attente à relancer\. Un répondant ne se relance qu'une fois par période de 24 heures/,
    );
    expect(
      messageRelance(new ErreurApi("RELANCE_RECENTE", "Relancé il y a moins de 24 h.", 409)),
    ).toBe("Relance refusée : Relancé il y a moins de 24 h.");
    expect(messageRelance(new ErreurApi("INTROUVABLE", "x", 404))).toMatch(/introuvable/);
  });
});

describe("pages et chemins", () => {
  it("lit un curseur borné et construit les chemins", () => {
    expect(lireCurseur("abc-_=")).toBe("abc-_=");
    expect(lireCurseur(["a", "b"])).toBe("a");
    expect(lireCurseur("a b")).toBeNull();
    expect(lireCurseur("x".repeat(501))).toBeNull();
    expect(lireCurseur(undefined)).toBeNull();
    expect(cheminModeles(null)).toBe("/api/questionnaires/modeles?limite=30");
    expect(cheminModeles("c1", 100)).toBe("/api/questionnaires/modeles?limite=100&curseur=c1");
    expect(cheminEnvoisMission("m1", "c")).toBe(
      "/api/missions/m1/questionnaires?limite=30&curseur=c",
    );
    expect(hrefAvecCurseur("/questionnaires", "a=b")).toBe("/questionnaires?curseur=a%3Db");
    expect(hrefAvecCurseur("/questionnaires", null)).toBe("/questionnaires");
    expect(hrefEnvoi("m", "e")).toBe("/missions/m/questionnaires/e");
  });

  it("charge toutes les pages et s'arrête sur un curseur répété", async () => {
    const pages: Record<string, PageQuestionnaires<number>> = {
      debut: { elements: [1, 2], curseur_suivant: "c1" },
      c1: { elements: [3], curseur_suivant: null },
    };
    const r = await toutesLesPages(
      (c) => Promise.resolve(pages[c] as PageQuestionnaires<number>),
      (c) => c ?? "debut",
    );
    expect(r).toEqual({ elements: [1, 2, 3], tronquee: false });
    const boucle = await toutesLesPages(
      () => Promise.resolve({ elements: [1], curseur_suivant: "x" }),
      (c) => c ?? "d",
    );
    expect(boucle).toEqual({ elements: [1, 1], tronquee: false });
    const longue = await toutesLesPages(
      (c) => Promise.resolve({ elements: [0], curseur_suivant: `${c}+` }),
      (c) => c ?? "",
      3,
    );
    expect(longue).toEqual({ elements: [0, 0, 0], tronquee: true });
  });

  it("ne propose à l'envoi que les modèles ayant une version validée", () => {
    const m = (id: string, titre: string, v: string | null): ModeleResume => ({
      id,
      code: id,
      titre,
      origine: "cabinet",
      cree_le: "",
      modifie_le: "",
      version_validee_id: v,
      brouillon: false,
    });
    expect(
      modelesEnvoyables([
        m("b", "Énergie", "v2"),
        m("a", "Achats", "v1"),
        m("c", "Brouillon", null),
      ]),
    ).toEqual([
      { valeur: "v1", libelle: "Achats (a)" },
      { valeur: "v2", libelle: "Énergie (b)" },
    ]);
  });

  it("donne la date du jour du fuseau du cabinet", () => {
    expect(dateDuJour(new Date("2026-10-06T23:30:00Z"))).toBe("2026-10-06");
    expect(dateDuJour(new Date("2026-10-06T23:30:00Z"), "Africa/Lagos")).toBe("2026-10-07");
  });
});
