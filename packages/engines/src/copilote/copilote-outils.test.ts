import { describe, expect, it } from "vitest";
import {
  composerAide,
  composerMissionsEnRetard,
  composerRetardFeuilles,
  DEFINITIONS_OUTILS_COPILOTE,
  extraireCommentaire,
  extraireFactureRelance,
  MESSAGE_ACTION_INDISPONIBLE,
  QUESTION_FACTURE_RELANCE,
  QUESTION_TEXTE_COMMENTAIRE,
  resumerAjouterCommentaire,
  resumerPlanifierRelance,
  routerMessageCopilote,
} from "./index";

const router = (m: string) => routerMessageCopilote(m, { aujourdhui: "2026-10-12" });
const outil = (m: string) => {
  const r = router(m);
  return r.type === "outil" ? r.choix.outil : r.type;
};

describe("routage : mes missions en retard", () => {
  it.each([
    "Quelles sont mes missions en retard ?",
    "mes missions en retard",
    "Quelles missions sont en retard",
    "Quelles missions ont des jalons en retard ?",
    "missions en retard svp",
    "Y a-t-il du retard sur mes missions ?",
  ])("« %s » → missions_en_retard", (m) => {
    expect(outil(m)).toBe("missions_en_retard");
  });

  it("ne détourne pas les autres lectures", () => {
    expect(outil("Où en est la mission Alpha ?")).toBe("resume_mission");
    expect(outil("Quelles sont mes tâches en retard ?")).toBe("mes_taches");
    expect(outil("Quelles factures sont en retard de paiement ?")).toBe("factures_echues");
  });
});

describe("routage : retards sur les feuilles de temps", () => {
  it.each([
    "Qui est en retard sur les feuilles de temps ?",
    "qui est en retard sur les feuilles de temps",
    "Quels collaborateurs sont en retard sur leur saisie des temps ?",
    "Qui n'a pas soumis sa feuille de temps ?",
    "Qui n a pas encore saisi ses heures",
    "les retardataires pour les feuilles de temps",
    "Quelles feuilles de temps de l'équipe sont manquantes ?",
  ])("« %s » → retard_feuilles_temps", (m) => {
    expect(outil(m)).toBe("retard_feuilles_temps");
  });

  it("mes propres feuilles restent mes_feuilles_temps", () => {
    expect(outil("Quelles feuilles de temps dois-je soumettre ?")).toBe("mes_feuilles_temps");
    expect(outil("mes feuilles de temps en retard")).toBe("mes_feuilles_temps");
  });
});

describe("routage : ajouter un commentaire", () => {
  it("extrait la mission et le texte (accents, casse et ponctuation conservés)", () => {
    expect(
      router("Ajoute un commentaire sur la mission Plan Stratégique : le client valide, merci !"),
    ).toEqual({
      type: "outil",
      choix: {
        outil: "ajouter_commentaire",
        parametres: { texte: "le client valide, merci !", mission: "Plan Stratégique" },
      },
    });
  });

  it.each([
    ["Peux-tu ajouter un commentaire à la mission Alpha : RAS ?", "Alpha", "RAS ?"],
    ["Commente la mission Delta : atelier reporté au 12/11", "Delta", "atelier reporté au 12/11"],
    [
      "Ajoute un commentaire sur la mission de l'agence Nord disant que le comité est fixé",
      "agence Nord",
      "le comité est fixé",
    ],
    ["Laisse un commentaire sur la mission Beta « Revue faite »", "Beta", "Revue faite"],
    ["ajoute un commentaire sur la mission Alpha - à relire", "Alpha", "à relire"],
  ])("« %s »", (message, mission, texte) => {
    expect(router(message)).toEqual({
      type: "outil",
      choix: { outil: "ajouter_commentaire", parametres: { texte, mission } },
    });
  });

  it("sans nom de mission : la mission de l'écran (paramètre absent)", () => {
    expect(router("Ajoute un commentaire : le client a validé")).toEqual({
      type: "outil",
      choix: { outil: "ajouter_commentaire", parametres: { texte: "le client a validé" } },
    });
  });

  it("sans texte : on le demande", () => {
    for (const m of ["Ajoute un commentaire sur la mission Alpha", "ajoute un commentaire"]) {
      expect(router(m)).toEqual({
        type: "precision",
        outil: "ajouter_commentaire",
        question: QUESTION_TEXTE_COMMENTAIRE,
      });
    }
  });

  it("ne se déclenche que sur un ordre au début du message", () => {
    expect(outil("Crée une tâche : ajouter un commentaire sur la mission Alpha")).toBe(
      "creer_tache",
    );
    expect(outil("Y a-t-il un commentaire sur la mission Alpha ?")).not.toBe("ajouter_commentaire");
    expect(outil("Quels sont les commentaires de la mission Alpha")).not.toBe(
      "ajouter_commentaire",
    );
  });

  it("extraireCommentaire : message sans commentaire, séparateur le plus proche", () => {
    expect(extraireCommentaire("bonjour")).toEqual({});
    expect(extraireCommentaire("commente la mission Alpha: a: b")).toEqual({
      mission: "Alpha",
      texte: "a: b",
    });
  });
});

describe("routage : relancer une facture", () => {
  it.each([
    ["Relance la facture F-2026-0012", "F-2026-0012"],
    ["relance la facture FA-0007 stp", "FA-0007"],
    ["Peux-tu relancer la facture n° 2026/45 ?", "2026/45"],
    ["Planifie une relance pour la facture F-12", "F-12"],
    ["Relance la facture de Dupont et Fils", "Dupont et Fils"],
    ["Relance la facture du client Société Générale", "Société Générale"],
  ])("« %s » → %s", (message, facture) => {
    expect(router(message)).toEqual({
      type: "outil",
      choix: { outil: "planifier_relance", parametres: { facture } },
    });
  });

  it("sans facture précise : on la demande", () => {
    for (const m of [
      "Relance les factures échues",
      "relance la facture",
      "relance la facture échue",
    ]) {
      expect(router(m)).toEqual({
        type: "precision",
        outil: "planifier_relance",
        question: QUESTION_FACTURE_RELANCE,
      });
    }
  });

  it("les questions et les tâches ne sont jamais des relances", () => {
    expect(outil("Quelles factures dois-je relancer ?")).toBe("factures_echues");
    expect(outil("Quelles factures sont échues ?")).toBe("factures_echues");
    expect(outil("Crée une tâche : relancer la facture F-12")).toBe("creer_tache");
    expect(outil("Rappelle-moi de relancer la facture F-12 demain")).toBe("creer_tache");
  });

  it("extraireFactureRelance : numéro d'abord, client à défaut, jamais un mot ordinaire", () => {
    expect(extraireFactureRelance("la facture F-9 de Dupont")).toBe("F-9");
    expect(extraireFactureRelance("la facture échue")).toBeUndefined();
    expect(extraireFactureRelance("la facture de moi")).toBeUndefined();
    expect(extraireFactureRelance("rien")).toBeUndefined();
  });
});

describe("gabarits des nouveaux outils", () => {
  it("missions en retard : vide, singulier, pluriel, tronqué, bornés à 10", () => {
    expect(composerMissionsEnRetard({ total: 0, tronque: false, missions: [] })).toEqual({
      texte: "Aucune de vos missions n'est en retard : tout est à jour.",
      elements: [],
    });
    const un = composerMissionsEnRetard({
      total: 1,
      tronque: false,
      missions: [
        {
          intitule: "Alpha",
          jalons_en_retard: 2,
          jalon_plus_ancien: "2026-10-01",
          fin_depassee: "2026-09-30",
          lien: "/missions/a",
        },
      ],
    });
    expect(un.texte).toBe("1 mission en retard parmi celles dont vous êtes responsable ou membre.");
    expect(un.elements[0]?.detail).toBe(
      "2 jalons en retard (le plus ancien prévu le 01/10/2026) · date de fin prévue dépassée (30/09/2026)",
    );
    const seul = composerMissionsEnRetard({
      total: 1,
      tronque: false,
      missions: [
        {
          intitule: "B",
          jalons_en_retard: 1,
          jalon_plus_ancien: null,
          fin_depassee: null,
          lien: "/m",
        },
      ],
    });
    expect(seul.elements[0]?.detail).toBe("1 jalon en retard");
    const beaucoup = composerMissionsEnRetard({
      total: 31,
      tronque: true,
      missions: Array.from({ length: 31 }, (_, i) => ({
        intitule: `M${i}`,
        jalons_en_retard: 0,
        jalon_plus_ancien: null,
        fin_depassee: "2026-01-01",
        lien: "/m",
      })),
    });
    expect(beaucoup.elements).toHaveLength(10);
    expect(beaucoup.texte).toBe(
      "au moins 31 missions en retard parmi celles dont vous êtes responsable ou membre. Les 10 premiers sont affichés sur 31.",
    );
  });

  it("retards de feuilles : vide, singulier, pluriel, noms et semaines seulement", () => {
    expect(
      composerRetardFeuilles({
        total: 0,
        tronque: false,
        semaines_examinees: 4,
        collaborateurs: [],
      }).texte,
    ).toBe(
      "Aucun collaborateur de votre périmètre n'est en retard sur ses feuilles de temps (sur les 4 dernières semaines écoulées).",
    );
    const r = composerRetardFeuilles({
      total: 2,
      tronque: false,
      semaines_examinees: 4,
      collaborateurs: [
        { nom: "Awa Koné", semaines: 1, plus_ancienne: "2026-10-05", lien: "/temps/validation" },
        { nom: "Basile Yao", semaines: 3, plus_ancienne: "2026-09-21", lien: "/temps/validation" },
      ],
    });
    expect(r.texte).toBe(
      "2 collaborateurs en retard sur leurs feuilles de temps (sur les 4 dernières semaines écoulées).",
    );
    expect(
      composerRetardFeuilles({
        total: 1,
        tronque: false,
        semaines_examinees: 4,
        collaborateurs: [{ nom: "Awa Koné", semaines: 1, plus_ancienne: "2026-10-05", lien: "/t" }],
      }).texte,
    ).toBe(
      "1 collaborateur en retard sur ses feuilles de temps (sur les 4 dernières semaines écoulées).",
    );
    expect(r.elements.map((e) => e.detail)).toEqual([
      "1 semaine non soumise · la plus ancienne : semaine du 05/10/2026",
      "3 semaines non soumises · la plus ancienne : semaine du 21/09/2026",
    ]);
    expect(JSON.stringify(r)).not.toMatch(/€|FCFA|taux|coût/i);
  });

  it("résumés des actions : texte exact, sans montant", () => {
    expect(resumerAjouterCommentaire({ texte: "RAS", mission_intitule: "Alpha" })).toBe(
      "Ajouter à la mission « Alpha » le commentaire : « RAS ». Il sera visible de toutes les personnes qui voient cette mission ; aucune personne n'est mentionnée.",
    );
    const resume = resumerPlanifierRelance({
      numero: "F-1",
      client: "Dupont",
      echeance: "2026-09-01",
      jours_retard: 1,
      niveau: 2,
    });
    expect(resume).toBe(
      "Enregistrer une relance de niveau 2 pour la facture F-1 du client « Dupont » (échue le 01/09/2026, 1 jour de retard). Aucun e-mail n'est envoyé au client ; l'équipe de gestion est prévenue.",
    );
    expect(
      resumerPlanifierRelance({
        numero: null,
        client: "X",
        echeance: "2026-09-01",
        jours_retard: 40,
        niveau: 1,
      }),
    ).toContain("facture sans numéro");
  });

  it("l'aide n'expose que les outils reçus : sans action, aucun exemple d'action", () => {
    const lecture = composerAide(["mes_taches", "missions_en_retard", "retard_feuilles_temps"]);
    expect(lecture.texte).toContain("Quelles sont mes missions en retard ?");
    expect(lecture.texte).toContain("Qui est en retard sur les feuilles de temps ?");
    expect(lecture.texte).not.toMatch(/Crée une tâche|Ajoute un commentaire|Relance la facture/);
    const tout = composerAide(["creer_tache", "ajouter_commentaire", "planifier_relance"]);
    expect(tout.texte).toContain("Ajoute un commentaire sur la mission");
    expect(tout.texte).toContain("Relance la facture F-2026-0012");
  });

  it("catalogue : les nouvelles définitions sont complètes et les actions modifiantes", () => {
    for (const o of ["ajouter_commentaire", "planifier_relance"] as const) {
      expect(DEFINITIONS_OUTILS_COPILOTE[o].modifiant).toBe(true);
    }
    for (const o of ["missions_en_retard", "retard_feuilles_temps"] as const) {
      expect(DEFINITIONS_OUTILS_COPILOTE[o].modifiant).toBe(false);
      expect(DEFINITIONS_OUTILS_COPILOTE[o].format_parametres).toBe("{}");
    }
    expect(MESSAGE_ACTION_INDISPONIBLE).toContain("limité à la lecture");
  });
});
