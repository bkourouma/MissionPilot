import { describe, expect, it } from "vitest";
import { ErreurApi, MESSAGE_TFA_A_CONFIGURER } from "./api";
import {
  cheminGenerationRapport,
  cheminListeRapports,
  contenuRapport,
  estFormatRapport,
  estNiveauRapport,
  etatMissionChange,
  FORMATS_RAPPORT,
  formaterDuree,
  hrefRapports,
  libelleFormat,
  libelleModele,
  libelleStatutRapport,
  lireCurseur,
  MESSAGE_LIMITE_RAPPORTS,
  messageAttente,
  messageRapport,
  niveauGenere,
  NIVEAUX,
  NIVEAUX_RAPPORT,
  nomAuteur,
  personnesConnues,
  peutEtreCree,
  peutLireNiveau,
  RAPPORTS_PAR_PAGE,
  reessayable,
} from "./rapports";

const erreur = (statut: number, code: string, message = "Message de l'API.") =>
  new ErreurApi(code, message, statut);

describe("niveau du rapport selon les droits (miroir de l'API)", () => {
  it("associé et gestionnaire : « finance » ; chef, directeur, consultant : « jours »", () => {
    expect(niveauGenere(["associe"])).toBe("finance");
    expect(niveauGenere(["gestionnaire"])).toBe("finance");
    expect(niveauGenere(["chef_mission"])).toBe("jours");
    expect(niveauGenere(["directeur_mission"])).toBe("jours");
    expect(niveauGenere(["consultant"])).toBe("jours");
  });

  it("expert métier (sans budget.lire_jours) : « base »", () => {
    expect(niveauGenere(["expert_metier"])).toBe("base");
    expect(peutLireNiveau(["expert_metier"], "base")).toBe(true);
    expect(peutLireNiveau(["expert_metier"], "jours")).toBe(false);
  });

  it("niveaux cumulatifs : « finance » exige aussi budget.lire_jours", () => {
    expect(peutLireNiveau(["associe"], "jours")).toBe(true);
    expect(peutLireNiveau(["chef_mission"], "finance")).toBe(false);
    // Rôles cumulés : le plus élevé l'emporte.
    expect(niveauGenere(["expert_metier", "gestionnaire"])).toBe("finance");
  });

  it("chaque niveau a un libellé texte et une icône propres (pas seulement une couleur)", () => {
    expect(NIVEAUX.base.libelle).toBe("Avancement");
    expect(NIVEAUX.jours.libelle).toBe("Avancement et jours");
    expect(NIVEAUX.finance.libelle).toBe("Confidentiel : avec finances");
    const icones = NIVEAUX_RAPPORT.map((n) => NIVEAUX[n].icone);
    expect(new Set(icones).size).toBe(3);
  });
});

describe("contenu annoncé du rapport", () => {
  it("base : avancement et jalons, jours et finances exclus", () => {
    const c = contenuRapport("base");
    expect(c.inclus.join(" ")).toMatch(/avancement physique/);
    expect(c.inclus.join(" ")).toMatch(/Jalons/);
    expect(c.inclus.join(" ")).not.toMatch(/jours|financ|marge/i);
    expect(c.exclus).toHaveLength(2);
    expect(c.exclus.join(" ")).toMatch(/Jours/);
    expect(c.exclus.join(" ")).toMatch(/financières/);
  });

  it("jours : ajoute les sections en jours, finances exclues", () => {
    const c = contenuRapport("jours");
    expect(c.inclus.length).toBeGreaterThan(contenuRapport("base").inclus.length);
    expect(c.inclus.join(" ")).toMatch(/Temps consommé/);
    expect(c.inclus.join(" ")).not.toMatch(/marge|coûts/i);
    expect(c.exclus).toEqual(["Données financières : coûts, taux, marges"]);
  });

  it("finance : tout inclus, rien d'exclu", () => {
    const c = contenuRapport("finance");
    expect(c.inclus.join(" ")).toMatch(/coûts internes/);
    expect(c.inclus.join(" ")).toMatch(/Budget en jours par phase/);
    expect(c.exclus).toEqual([]);
  });

  it("aucun chiffre dans les descriptions ni les explications", () => {
    for (const n of NIVEAUX_RAPPORT) {
      const textes = [
        ...contenuRapport(n).inclus,
        ...contenuRapport(n).exclus,
        NIVEAUX[n].explication,
      ];
      for (const t of textes) expect(t).not.toMatch(/\d/);
    }
  });
});

describe("libellés", () => {
  it("formats, modèle et statut", () => {
    expect(FORMATS_RAPPORT.map(libelleFormat)).toEqual(["PDF", "Word", "PowerPoint"]);
    expect(libelleFormat("html")).toBe("Fichier");
    expect(estFormatRapport("pptx")).toBe(true);
    expect(estFormatRapport("xlsx")).toBe(false);
    expect(estNiveauRapport("finance")).toBe(true);
    expect(estNiveauRapport("public")).toBe(false);
    expect(libelleModele("etat_avancement")).toBe("État d'avancement");
    expect(libelleModele("autre")).toBe("Rapport");
    expect(libelleModele("notation")).toBe("Rapport de notation");
    expect(libelleModele("plan_strategique")).toBe("Plan stratégique");
    expect(libelleStatutRapport("brouillon")).toBe("Brouillon");
    expect(libelleStatutRapport("valide")).toBe("Validé");
    expect(estNiveauRapport("notation")).toBe(true);
    expect(estNiveauRapport("plan")).toBe(true);
    expect(NIVEAUX.notation.libelle).toBe("Notation");
    expect(NIVEAUX.plan.libelle).toBe("Plan stratégique");
    expect(peutLireNiveau(["associe"], "notation")).toBe(true);
    expect(peutLireNiveau([], "plan")).toBe(false);
    expect(libelleStatutRapport("xyz")).toBe("Statut non reconnu");
  });

  it("auteur : « Vous », nom du référentiel ou de l'équipe, sinon libellé neutre", () => {
    const personnes = personnesConnues(
      [{ utilisateur_id: "u1", nom: "Awa Koné", grade_libelle: "Senior" }],
      [
        { utilisateur_id: "u1", nom: "Doublon ignoré" },
        { utilisateur_id: "u2", nom: "Moussa Diallo" },
      ],
    );
    expect(personnes.map((p) => p.nom)).toEqual(["Awa Koné", "Moussa Diallo"]);
    expect(nomAuteur("moi", "moi", personnes)).toBe("Vous");
    expect(nomAuteur("u2", "moi", personnes)).toBe("Moussa Diallo");
    expect(nomAuteur("inconnu", "moi", personnes)).toBe("Utilisateur du cabinet");
  });
});

describe("chemins et pagination", () => {
  it("liste : limite fixe, curseur encodé seulement s'il est fourni", () => {
    expect(cheminListeRapports("m-1")).toBe(
      `/api/missions/m-1/rapports?limite=${RAPPORTS_PAR_PAGE}`,
    );
    expect(cheminListeRapports("m-1", "abc_DEF-1")).toBe(
      `/api/missions/m-1/rapports?limite=${RAPPORTS_PAR_PAGE}&curseur=abc_DEF-1`,
    );
  });

  it("génération et page de l'onglet", () => {
    expect(cheminGenerationRapport("m/1", "pdf")).toBe("/api/missions/m%2F1/rapports?format=pdf");
    expect(hrefRapports("m-1")).toBe("/missions/m-1/rapports");
    expect(hrefRapports("m-1", null)).toBe("/missions/m-1/rapports");
    expect(hrefRapports("m-1", "eyJh")).toBe("/missions/m-1/rapports?curseur=eyJh");
  });

  it("curseur : base64url seulement, sinon ignoré", () => {
    expect(lireCurseur("eyJhIjoxfQ")).toBe("eyJhIjoxfQ");
    expect(lireCurseur(["eyJh", "autre"])).toBe("eyJh");
    expect(lireCurseur(undefined)).toBe("");
    expect(lireCurseur("")).toBe("");
    expect(lireCurseur("a b")).toBe("");
    expect(lireCurseur("a&limite=100")).toBe("");
    expect(lireCurseur("x".repeat(501))).toBe("");
  });
});

describe("attente de la génération", () => {
  it("annonce par paliers (pas à chaque seconde), PDF signalé comme plus long", () => {
    expect(messageAttente("pdf", 0)).toMatch(/30 secondes/);
    expect(messageAttente("docx", 0)).toMatch(/Word/);
    expect(messageAttente("pptx", 3)).toBe(messageAttente("pptx", 9));
    expect(messageAttente("pdf", 12)).toBe(messageAttente("pdf", 24));
    expect(messageAttente("pdf", 12)).not.toBe(messageAttente("pdf", 5));
    expect(messageAttente("pdf", 40)).toMatch(/plus de temps/);
  });

  it("durée écoulée lisible", () => {
    expect(formaterDuree(0)).toBe("0 s");
    expect(formaterDuree(8.7)).toBe("8 s");
    expect(formaterDuree(65)).toBe("1 min 05 s");
    expect(formaterDuree(-3)).toBe("0 s");
    expect(formaterDuree(Number.NaN)).toBe("0 s");
  });
});

describe("messages d'erreur de la génération", () => {
  it("429 : limite de 10 rapports par 10 minutes", () => {
    expect(messageRapport(erreur(429, "TROP_DE_RAPPORTS"))).toBe(MESSAGE_LIMITE_RAPPORTS);
    expect(MESSAGE_LIMITE_RAPPORTS).toMatch(
      /^Vous avez atteint la limite de 10 rapports par 10 minutes/,
    );
    expect(messageRapport(erreur(429, "AUTRE"))).toBe(MESSAGE_LIMITE_RAPPORTS);
  });

  it("503 : rendu occupé (réessayer) ou PDF indisponible (autre format)", () => {
    const occupe = erreur(503, "RENDU_OCCUPE");
    expect(messageRapport(occupe)).toMatch(/Réessayez/);
    expect(reessayable(occupe)).toBe(true);
    const pdf = erreur(503, "RENDU_PDF_INDISPONIBLE");
    expect(messageRapport(pdf)).toMatch(/Word ou PowerPoint/);
    expect(reessayable(pdf)).toBe(false);
    expect(messageRapport(erreur(503, "AUTRE"))).toMatch(/Réessayez/);
  });

  it("504 : délai dépassé", () => {
    const e = erreur(504, "RENDU_TROP_LONG");
    expect(messageRapport(e)).toMatch(/^Délai dépassé/);
    expect(reessayable(e)).toBe(true);
    expect(messageRapport(erreur(504, "AUTRE"))).toMatch(/^Délai dépassé/);
  });

  it("413 : rapport trop volumineux ; 409 quota distinct de la mission clôturée", () => {
    expect(messageRapport(erreur(413, "RAPPORT_TROP_VOLUMINEUX"))).toMatch(/taille/);
    expect(messageRapport(erreur(413, "FICHIER_TROP_VOLUMINEUX"))).toMatch(/taille/);
    expect(messageRapport(erreur(413, "AUTRE"))).toMatch(/taille/);
    expect(messageRapport(erreur(409, "QUOTA_STOCKAGE_ATTEINT"))).toMatch(/stockage/);
    expect(etatMissionChange(erreur(409, "QUOTA_STOCKAGE_ATTEINT"))).toBe(false);
    const cloturee = erreur(409, "CONFLIT", "La mission est clôturée.");
    expect(messageRapport(cloturee)).toMatch(/clôturée/);
    expect(etatMissionChange(cloturee)).toBe(true);
  });

  it("400, 401, 403, 404 : messages français propres", () => {
    expect(messageRapport(erreur(400, "REQUETE_INVALIDE", "Invalid enum value"))).toMatch(
      /Demande refusée/,
    );
    expect(messageRapport(erreur(401, "NON_AUTHENTIFIE"))).toMatch(/session a expiré/);
    expect(messageRapport(erreur(403, "INTERDIT"))).toMatch(/rôle ne vous permet pas/);
    expect(messageRapport(erreur(403, "TFA_A_CONFIGURER"))).toBe(MESSAGE_TFA_A_CONFIGURER);
    const absente = erreur(404, "INTROUVABLE");
    expect(messageRapport(absente)).toMatch(/introuvable/);
    expect(etatMissionChange(absente)).toBe(true);
  });

  it("réponse perdue (délai du navigateur, réseau, relais) : proposer d'actualiser la liste", () => {
    for (const e of [
      erreur(0, "DELAI_DEPASSE"),
      erreur(0, "RESEAU_INDISPONIBLE"),
      erreur(502, "SERVICE_INDISPONIBLE"),
      erreur(504, "SERVICE_INDISPONIBLE"),
    ]) {
      expect(peutEtreCree(e)).toBe(true);
      expect(reessayable(e)).toBe(false);
      expect(messageRapport(e)).toMatch(/actualisez la liste/);
    }
    expect(peutEtreCree(erreur(429, "TROP_DE_RAPPORTS"))).toBe(false);
    expect(peutEtreCree(new Error("x"))).toBe(false);
  });

  it("erreur interne : message de l'API (déjà en français) ; erreur inconnue : message générique", () => {
    expect(messageRapport(erreur(500, "ERREUR_INTERNE", "Erreur interne."))).toBe(
      "Erreur interne.",
    );
    expect(messageRapport(new Error("boom"))).toMatch(/erreur inattendue/);
    expect(messageRapport(erreur(0, "ANNULE"))).toMatch(/interrompue/);
  });
});
