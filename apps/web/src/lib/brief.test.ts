import { describe, expect, it } from "vitest";
import {
  FAMILLES_AFFICHEES,
  libelleAnciennete,
  libelleGravite,
  libelleMontant,
  libelleNombre,
  dateSaisieBrief,
  hrefBrief,
  libelleRejeuBrief,
  lienInterne,
  lireDateBrief,
  MESSAGE_BRIEF_VIDE,
  messageBriefIndisponible,
  noteTroncature,
  PRESENTATION_FAMILLE,
  requeteBrief,
  resumeBrief,
  titreErreurBrief,
  TONALITE_GRAVITE,
  type BriefApi,
  type ElementBriefApi,
  type FamilleComposeeBriefApi,
} from "./brief";

const element: ElementBriefApi = {
  type: "facture_echue",
  famille: "deriver",
  libelle: "Facture échue : FAC-2026-0001 (20 jours de retard)",
  entite_id: "5c4d0f4e-2f6e-4f0d-9a3c-0a0f9f6d1a11",
  mission_id: null,
  mission_libelle: null,
  lien: "/facturation/5c4d0f4e-2f6e-4f0d-9a3c-0a0f9f6d1a11",
  gravite: "moyenne",
  anciennete_jours: 20,
};

const famille = (
  total: number,
  nombre = total,
  tronque = total > nombre,
): FamilleComposeeBriefApi => ({
  total,
  tronque,
  elements: Array.from({ length: nombre }, (_, i) => ({ ...element, entite_id: `e${i}` })),
});

const brief = (decider: number, deriver: number, envoyer: number): BriefApi => ({
  date_reference: "2026-10-12",
  familles: { decider: famille(decider), deriver: famille(deriver), envoyer: famille(envoyer) },
  total: decider + deriver + envoyer,
  vide: decider + deriver + envoyer === 0,
});

describe("présentation des familles", () => {
  it("trois cartes dans l'ordre du PRD, en français, avec un état vide chacune", () => {
    expect(FAMILLES_AFFICHEES).toEqual(["decider", "deriver", "envoyer"]);
    expect(PRESENTATION_FAMILLE.decider.titre).toBe("À décider");
    expect(PRESENTATION_FAMILLE.deriver.titre).toBe("Ça dérive");
    expect(PRESENTATION_FAMILLE.envoyer.titre).toBe("Prêt à envoyer");
    for (const f of FAMILLES_AFFICHEES) {
      expect(PRESENTATION_FAMILLE[f].vide.length).toBeGreaterThan(10);
      expect(PRESENTATION_FAMILLE[f].description.length).toBeGreaterThan(10);
    }
  });

  it("la gravité du moteur devient une tonalité et un libellé (jamais la couleur seule)", () => {
    expect(TONALITE_GRAVITE).toEqual({ haute: "danger", moyenne: "attention", basse: "neutre" });
    expect(libelleGravite("haute")).toBe("Urgent");
    expect(libelleGravite("moyenne")).toBe("À suivre");
    expect(libelleGravite("basse")).toBe("Récent");
  });
});

describe("formats", () => {
  it("ancienneté en jours", () => {
    expect(libelleAnciennete(0)).toBe("Aujourd'hui");
    expect(libelleAnciennete(-3)).toBe("Aujourd'hui");
    expect(libelleAnciennete(Number.NaN)).toBe("Aujourd'hui");
    expect(libelleAnciennete(1)).toBe("Depuis 1 jour");
    expect(libelleAnciennete(12)).toBe("Depuis 12 jours");
  });

  it("nombres d'éléments", () => {
    expect(libelleNombre(0)).toBe("Aucun élément");
    expect(libelleNombre(1)).toBe("1 élément");
    expect(libelleNombre(14)).toBe("14 éléments");
  });

  it("le lien reste interne à l'application", () => {
    expect(lienInterne("/facturation/abc")).toBe("/facturation/abc");
    expect(lienInterne("/temps?semaine=2026-10-05")).toBe("/temps?semaine=2026-10-05");
    for (const mauvais of [
      "https://exemple.test",
      "//exemple.test",
      "javascript:alert(1)",
      "facturation/abc",
      "/a b",
      "/a\\b",
      "",
    ]) {
      expect(lienInterne(mauvais), mauvais).toBeNull();
    }
  });

  it("montant : seulement s'il est servi, jamais un zéro à la place", () => {
    expect(libelleMontant(element)).toBeNull();
    expect(libelleMontant({ ...element, montant: 150000, devise: "XOF" })).toContain("150");
    expect(libelleMontant({ ...element, montant: 150000, devise: "XOF" })).toContain("FCFA");
    expect(libelleMontant({ ...element, montant: 0, devise: "XOF" })).toContain("0");
    expect(libelleMontant({ ...element, montant: 5000 })).toBeNull();
    expect(libelleMontant({ ...element, montant: 5000, devise: "GBP" })).toBeNull();
  });
});

describe("troncature et résumé", () => {
  it("la note de troncature dit combien sur combien", () => {
    expect(noteTroncature(famille(3))).toBeNull();
    expect(noteTroncature(famille(14, 10))).toBe(
      "10 affichés sur 14 : les plus urgents et les plus anciens d'abord.",
    );
    expect(noteTroncature({ total: 4, tronque: true, elements: [element] })).toBe(
      "1 affiché sur 4 : les plus urgents et les plus anciens d'abord.",
    );
  });

  it("famille tronquée sans plus d'éléments connus : le total est annoncé comme un minimum", () => {
    expect(noteTroncature({ total: 3, tronque: true, elements: famille(3).elements })).toBe(
      "Au moins 3 éléments : d'autres peuvent exister au-delà de ceux qui ont pu être examinés.",
    );
    expect(noteTroncature({ total: 1, tronque: true, elements: [element] })).toMatch(
      /^Au moins 1 élément :/,
    );
    expect(noteTroncature({ total: 0, tronque: true, elements: [] })).toMatch(
      /^D'autres éléments peuvent exister/,
    );
    const incomplet: BriefApi = {
      ...brief(2, 3, 0),
      familles: {
        decider: famille(2),
        deriver: { total: 3, tronque: true, elements: famille(3).elements },
        envoyer: famille(0),
      },
    };
    expect(resumeBrief(incomplet)).toBe("2 à décider · au moins 3 qui dérivent · 0 prêt à envoyer");
  });

  it("plafond de débit (429) : message et titre français dédiés, autres erreurs inchangées", () => {
    expect(titreErreurBrief(429)).toBe("Trop de consultations du brief.");
    expect(messageBriefIndisponible(429, "Too many")).toMatch(/dans quelques minutes/);
    expect(titreErreurBrief(500)).toBe("Le brief n'a pas pu être chargé.");
    expect(messageBriefIndisponible(500, "Erreur du serveur.")).toBe("Erreur du serveur.");
  });

  it("résumé d'une ligne, avec accords", () => {
    expect(resumeBrief(brief(0, 0, 0))).toBe(MESSAGE_BRIEF_VIDE);
    expect(resumeBrief(brief(2, 1, 0))).toBe("2 à décider · 1 qui dérive · 0 prêt à envoyer");
    expect(resumeBrief(brief(0, 3, 4))).toBe("0 à décider · 3 qui dérivent · 4 prêts à envoyer");
  });
});

describe("requête et date de rejeu", () => {
  it("construit le chemin de l'API", () => {
    expect(requeteBrief()).toBe("/api/brief");
    expect(requeteBrief("2026-10-12")).toBe("/api/brief?date=2026-10-12");
  });

  it("lit ?date= : valide et bornée, sinon ignorée", () => {
    expect(lireDateBrief({ date: "2026-10-12" })).toBe("2026-10-12");
    expect(lireDateBrief({ date: ["2026-10-12", "2027-01-01"] })).toBe("2026-10-12");
    for (const d of ["1999-12-31", "2101-01-01", "2026-02-30", "demain", "", undefined]) {
      expect(lireDateBrief({ date: d }), String(d)).toBeUndefined();
    }
    expect(lireDateBrief({})).toBeUndefined();
  });

  it("adresse et libellé du rejeu : la date vit dans l'URL, le libellé la nomme", () => {
    expect(hrefBrief()).toBe("/brief");
    expect(hrefBrief("2026-10-12")).toBe("/brief?date=2026-10-12");
    expect(libelleRejeuBrief()).toBe("Brief du jour");
    expect(libelleRejeuBrief("2026-10-12")).toMatch(/^Brief du 12 oct\.? 2026 \(rejeu\)$/);
  });

  it("date saisie dans le sélecteur : valide et bornée (2000 à 2100), sinon refusée", () => {
    expect(dateSaisieBrief("2026-10-12")).toBe("2026-10-12");
    for (const d of ["1999-12-31", "2101-01-01", "2026-02-30", "", "12/10/2026"]) {
      expect(dateSaisieBrief(d), d).toBeUndefined();
    }
  });
});
