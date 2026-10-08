import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import { formaterDate } from "./format";
import {
  cheminValidationJalon,
  COMMENTAIRE_VALIDATION_MAX,
  designationFacturePortail,
  entreeActive,
  entreesPortail,
  estIdentifiant,
  etatJalon,
  etatPaiement,
  hrefDocumentFacture,
  hrefLivrable,
  hrefPage,
  issueErreurPortail,
  libelleTypeLivrable,
  lireCurseur,
  messageErreurInvitationPortail,
  messageErreurPortail,
  messageValidationJalon,
  montantPortail,
  periodeMission,
  peut,
  peutValiderJalon,
  reglesMotDePasse,
  requetePage,
  resumePartages,
  rubriquesMission,
  statutMission,
  TAILLE_PAGE_PORTAIL,
  validerCommentaireValidation,
  type FacturePortail,
} from "./portail";

const ID = "3f2b8c1e-5d4a-4b6f-9e7d-1a2b3c4d5e6f";
const DIRIGEANT = ["client_dirigeant"];
const CONTRIBUTEUR = ["client_contributeur"];
const INVESTISSEUR = ["client_investisseur"];

describe("droits et navigation du portail", () => {
  it("le dirigeant voit toutes les rubriques ; le contributeur pas les factures ; l'investisseur son accueil", () => {
    expect(entreesPortail(DIRIGEANT).map((e) => e.id)).toEqual([
      "accueil",
      "missions",
      "questionnaires",
      "factures",
      "securite",
    ]);
    expect(entreesPortail(CONTRIBUTEUR).map((e) => e.id)).toEqual([
      "accueil",
      "missions",
      "questionnaires",
      "securite",
    ]);
    expect(entreesPortail(INVESTISSEUR).map((e) => e.id)).toEqual(["accueil", "securite"]);
  });

  it("seul le dirigeant valide un jalon ; aucun rôle du cabinet ni rôle inconnu n'a de droit portail", () => {
    expect(peut(DIRIGEANT, "portail.jalons.valider")).toBe(true);
    expect(peut(CONTRIBUTEUR, "portail.jalons.valider")).toBe(false);
    expect(peut(["associe"], "portail.missions.lire")).toBe(false);
    expect(peut(["role_inconnu"], "portail.acceder")).toBe(false);
    expect(peut(["role_inconnu", "client_contributeur"], "portail.missions.lire")).toBe(true);
  });

  it("entrée active : l'accueil sur son chemin exact, les rubriques sur leur préfixe", () => {
    const [accueil, missions] = entreesPortail(DIRIGEANT);
    expect(entreeActive("/portail", accueil!)).toBe(true);
    expect(entreeActive("/portail/missions", accueil!)).toBe(false);
    expect(entreeActive("/portail/missions", missions!)).toBe(true);
    expect(entreeActive(`/portail/missions/${ID}`, missions!)).toBe(true);
    expect(entreeActive("/portail/missionsx", missions!)).toBe(false);
  });
});

describe("missions", () => {
  it("statuts en termes simples ; statut inconnu sans planter", () => {
    expect(statutMission("en_cours")).toEqual({ libelle: "En cours", tonalite: "succes" });
    expect(statutMission("a_cloturer").libelle).toBe("En cours de finalisation");
    expect(statutMission("cloturee").libelle).toBe("Terminée");
    expect(statutMission("autre").libelle).toBe("—");
  });

  it("période selon les dates connues", () => {
    expect(periodeMission("2027-01-12", "2027-06-30")).toBe(
      `Du ${formaterDate("2027-01-12")} au ${formaterDate("2027-06-30")}`,
    );
    expect(periodeMission("2027-01-12", null)).toBe(`Depuis le ${formaterDate("2027-01-12")}`);
    expect(periodeMission(null, "2027-06-30")).toBe(`Jusqu'au ${formaterDate("2027-06-30")}`);
    expect(periodeMission(null, null)).toBe("Dates à préciser");
  });

  it("rubriques consultables selon les partages", () => {
    expect(rubriquesMission({ jalons: true, factures: true })).toBe(
      "À consulter : jalons, documents et factures.",
    );
    expect(rubriquesMission({ jalons: false, factures: true })).toBe(
      "À consulter : documents et factures.",
    );
    expect(rubriquesMission({ jalons: false, factures: false })).toBe("À consulter : documents.");
  });

  it("types de documents partageables", () => {
    expect(libelleTypeLivrable("livrable")).toBe("Livrable");
    expect(libelleTypeLivrable("lettre_de_mission")).toBe("Lettre de mission");
    expect(libelleTypeLivrable("autre")).toBe("Document");
  });
});

describe("jalons", () => {
  const VALIDATION = {
    valide_le: "2027-03-12T10:00:00.000Z",
    commentaire: null,
    valide_par_moi: true,
  };

  it("à venir, atteint en attente, validé par moi ou par mon entreprise", () => {
    expect(etatJalon({ atteint: false, date_prevue: "2027-03-01", validation: null })).toEqual({
      libelle: "À venir",
      tonalite: "neutre",
      detail: `Prévu le ${formaterDate("2027-03-01")}`,
    });
    expect(etatJalon({ atteint: false, date_prevue: null, validation: null }).detail).toBe(
      "Date à préciser",
    );
    expect(etatJalon({ atteint: true, date_prevue: null, validation: null })).toMatchObject({
      libelle: "Atteint, en attente de validation",
      tonalite: "attention",
    });
    const moi = etatJalon({ atteint: true, date_prevue: null, validation: VALIDATION });
    expect(moi).toMatchObject({ libelle: "Validé", tonalite: "succes" });
    expect(moi.detail).toMatch(/^Validé par vous le /);
    expect(
      etatJalon({
        atteint: true,
        date_prevue: null,
        validation: { ...VALIDATION, valide_par_moi: false },
      }).detail,
    ).toMatch(/^Validé par votre entreprise le /);
  });

  it("bouton de validation : dirigeant, jalon atteint, pas encore validé", () => {
    expect(peutValiderJalon({ atteint: true, validation: null }, DIRIGEANT)).toBe(true);
    expect(peutValiderJalon({ atteint: false, validation: null }, DIRIGEANT)).toBe(false);
    expect(peutValiderJalon({ atteint: true, validation: VALIDATION }, DIRIGEANT)).toBe(false);
    expect(peutValiderJalon({ atteint: true, validation: null }, CONTRIBUTEUR)).toBe(false);
  });

  it("commentaire facultatif, borné, sans champ quand il est vide", () => {
    expect(validerCommentaireValidation("   ")).toEqual({ ok: true, charge: {} });
    expect(validerCommentaireValidation("  Conforme.  ")).toEqual({
      ok: true,
      charge: { commentaire: "Conforme." },
    });
    const long = validerCommentaireValidation("x".repeat(COMMENTAIRE_VALIDATION_MAX + 1));
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.erreurs.commentaire).toMatch(/1000 caractères \(actuellement 1001\)/);
  });

  it("chemin de validation encodé", () => {
    expect(cheminValidationJalon(ID, "a/b")).toBe(
      `/api/portail/missions/${ID}/jalons/a%2Fb/valider`,
    );
  });

  it("messages de refus de la validation", () => {
    expect(messageValidationJalon(new ErreurApi("JALON_DEJA_VALIDE", "x", 409))).toMatch(
      /déjà été validé/,
    );
    expect(messageValidationJalon(new ErreurApi("CONFLIT", "x", 409))).toMatch(
      /pas encore atteint/,
    );
    expect(messageValidationJalon(new ErreurApi("INTERDIT", "x", 403))).toMatch(
      /Seul le dirigeant/,
    );
    expect(messageValidationJalon(new ErreurApi("TFA_A_CONFIGURER", "x", 403))).toMatch(
      /double authentification/,
    );
    expect(messageValidationJalon(new ErreurApi("INTROUVABLE", "x", 404))).toMatch(/plus partagé/);
  });
});

describe("factures", () => {
  const facture: FacturePortail = {
    id: ID,
    nature: "facture",
    numero: "FA-2027-0012",
    facture_origine_id: null,
    date_emission: "2027-02-01",
    date_echeance: "2027-03-03",
    devise: "XOF",
    statut: "emise",
    objet: null,
    mission: { id: ID, intitule: "Plan stratégique" },
    total_ht: 1_000_000,
    total_tva: 180_000,
    total_ttc: 1_180_000,
    total_retenues: 0,
    net_a_payer: 1_180_000,
    paiement: { statut_paiement: "en_retard", encaisse: 0, solde: 1_180_000, jours_retard: 12 },
  };

  it("désignation par nature et numéro", () => {
    expect(designationFacturePortail(facture)).toBe("Facture FA-2027-0012");
    expect(designationFacturePortail({ nature: "avoir", numero: "AV-1" })).toBe("Avoir AV-1");
    expect(designationFacturePortail({ nature: "facture", numero: null })).toBe("Facture");
  });

  it("paiement : retard en jours, avoir et facture annulée sans objet", () => {
    expect(etatPaiement(facture)).toEqual({
      libelle: "Échéance dépassée de 12 jours",
      tonalite: "danger",
    });
    expect(
      etatPaiement({ ...facture, paiement: { ...facture.paiement!, jours_retard: 1 } }).libelle,
    ).toBe("Échéance dépassée de 1 jour");
    expect(
      etatPaiement({ ...facture, paiement: { ...facture.paiement!, statut_paiement: "soldee" } }),
    ).toEqual({ libelle: "Réglée", tonalite: "succes" });
    expect(etatPaiement({ ...facture, nature: "avoir", paiement: null }).libelle).toBe(
      "Sans objet",
    );
    expect(etatPaiement({ ...facture, statut: "annulee" }).libelle).toBe("Annulée par un avoir");
  });

  it("montants en unités mineures, sans calcul ; devise inconnue lisible", () => {
    expect(montantPortail(1_180_000, "XOF")).toBe("1\u202f180\u202f000\u00a0FCFA");
    expect(montantPortail(123_450, "EUR")).toBe("1\u202f234,50\u00a0€");
    expect(montantPortail(1500, "GNF")).toBe("1\u202f500\u00a0GNF");
  });

  it("liens de même origine : document de facture et livrables", () => {
    expect(hrefDocumentFacture(ID)).toBe(`/api/portail/factures/${ID}/document`);
    expect(hrefLivrable(ID)).toBe(`/api/portail/livrables/${ID}/fichier?affichage=attachment`);
    expect(hrefLivrable(ID, "inline")).toBe(
      `/api/portail/livrables/${ID}/fichier?affichage=inline`,
    );
  });
});

describe("listes et paramètres d'URL", () => {
  it("identifiant UUID seulement", () => {
    expect(estIdentifiant(ID)).toBe(true);
    expect(estIdentifiant("../factures")).toBe(false);
  });

  it("curseur base64url borné, sinon ignoré", () => {
    expect(lireCurseur("eyJhIjoxfQ")).toBe("eyJhIjoxfQ");
    expect(lireCurseur(["eyJh", "x"])).toBe("eyJh");
    expect(lireCurseur(undefined)).toBeNull();
    expect(lireCurseur("a b")).toBeNull();
    expect(lireCurseur("a".repeat(501))).toBeNull();
  });

  it("requête d'API et lien de page", () => {
    expect(requetePage("/api/portail/missions", null)).toBe(
      `/api/portail/missions?limite=${TAILLE_PAGE_PORTAIL}`,
    );
    expect(requetePage("/api/portail/factures", "abc")).toBe(
      `/api/portail/factures?limite=${TAILLE_PAGE_PORTAIL}&curseur=abc`,
    );
    expect(hrefPage("/portail/factures", null)).toBe("/portail/factures");
    expect(hrefPage("/portail/factures", "abc")).toBe("/portail/factures?curseur=abc");
  });
});

describe("accueil : résumé des partages", () => {
  it("rien de partagé : liste vide (état vide explicite)", () => {
    expect(resumePartages({ missions: 0, documents: 0, factures: false }, DIRIGEANT)).toEqual([]);
  });

  it("partages avec liens selon les droits", () => {
    const partages = { missions: 2, documents: 1, factures: true };
    expect(resumePartages(partages, DIRIGEANT)).toEqual([
      { id: "missions", texte: "2 missions partagées", href: "/portail/missions" },
      { id: "documents", texte: "1 document mis à disposition", href: "/portail/missions" },
      { id: "factures", texte: "Factures émises consultables", href: "/portail/factures" },
    ]);
    const contributeur = resumePartages(partages, CONTRIBUTEUR);
    expect(contributeur.find((e) => e.id === "factures")?.href).toBeNull();
    expect(resumePartages(partages, INVESTISSEUR).every((e) => e.href === null)).toBe(true);
  });

  it("clés absentes (réponse limitée au rôle) : rien de partagé, sans planter", () => {
    // L'investisseur reçoit `partages: {}` ; le contributeur, ni `factures`.
    expect(resumePartages({}, INVESTISSEUR)).toEqual([]);
    expect(resumePartages({}, DIRIGEANT)).toEqual([]);
    expect(resumePartages({ missions: 1, documents: 0 }, CONTRIBUTEUR)).toEqual([
      { id: "missions", texte: "1 mission partagée", href: "/portail/missions" },
    ]);
  });
});

describe("erreurs", () => {
  it("401 → connexion, 403 TFA → sécurité, le reste s'affiche sur place", () => {
    expect(issueErreurPortail(401, "NON_AUTHENTIFIE")).toBe("connexion");
    expect(issueErreurPortail(403, "TFA_A_CONFIGURER")).toBe("securite");
    expect(issueErreurPortail(403, "INTERDIT")).toBe("afficher");
    expect(issueErreurPortail(404, "INTROUVABLE")).toBe("afficher");
    expect(issueErreurPortail(0, "RESEAU_INDISPONIBLE")).toBe("afficher");
  });

  it("messages sobres, en français, sans code technique", () => {
    expect(messageErreurPortail(new ErreurApi("INTERDIT", "Forbidden", 403))).toMatch(
      /interlocuteur au cabinet/,
    );
    expect(messageErreurPortail(new ErreurApi("INTROUVABLE", "x", 404))).toBe(
      "Cet élément n'existe pas ou n'est plus partagé avec vous.",
    );
    expect(messageErreurPortail(new ErreurApi("RESEAU_INDISPONIBLE", "Réseau coupé.", 0))).toBe(
      "Réseau coupé.",
    );
    expect(messageErreurPortail(new Error("boom"))).toMatch(/erreur inattendue/);
  });

  it("invitation : lien expiré, compte existant, trop de tentatives", () => {
    expect(messageErreurInvitationPortail(new ErreurApi("INVITATION_INVALIDE", "x", 400))).toMatch(
      /expiré ou a déjà été utilisé/,
    );
    expect(messageErreurInvitationPortail(new ErreurApi("CONFLIT", "x", 409))).toMatch(
      /compte existe déjà/,
    );
    expect(messageErreurInvitationPortail(new ErreurApi("TROP_DE_TENTATIVES", "x", 429))).toMatch(
      /Patientez/,
    );
  });
});

describe("règles du mot de passe", () => {
  it("longueur minimale et confirmation, mises à jour à la saisie", () => {
    expect(reglesMotDePasse("", "")).toEqual([
      { id: "longueur", texte: "Au moins 12 caractères (0 saisi)", respectee: false },
      { id: "confirmation", texte: "Les deux mots de passe sont identiques", respectee: false },
    ]);
    const ok = reglesMotDePasse("une phrase longue", "une phrase longue");
    expect(ok.every((r) => r.respectee)).toBe(true);
    expect(ok[0]!.texte).toBe("Au moins 12 caractères (17 saisis)");
    expect(reglesMotDePasse("une phrase longue", "autre")[1]!.respectee).toBe(false);
  });
});
