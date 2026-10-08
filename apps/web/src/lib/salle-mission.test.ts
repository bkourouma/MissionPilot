import { describe, expect, it } from "vitest";
import {
  actionsDemande,
  avancement,
  cheminModeles,
  corpsDemande,
  detailAvancement,
  echeanceDepassee,
  hrefDemande,
  hrefFichierDepot,
  messageSalle,
  modelesTries,
  peutDecider,
  peutDeposerPourLeClient,
  peutGererSalle,
  peutLireSalle,
  peutVerser,
  SAISIE_DEMANDE_VIDE,
  STATUT_PIECE,
  validerDemande,
  type DepotSalle,
  type ModeleSalle,
  type SynthesePieces,
} from "./salle-mission";

const synthese = (s: Partial<SynthesePieces>): SynthesePieces => ({
  total: 0,
  demandee: 0,
  recue: 0,
  acceptee: 0,
  rejetee: 0,
  obligatoires_restantes: 0,
  ...s,
});

describe("droits et actions", () => {
  it("lecture par l'équipe de conseil, gestion sans l'expert métier", () => {
    expect(peutLireSalle(["expert_metier"])).toBe(true);
    expect(peutGererSalle(["expert_metier"])).toBe(false);
    expect(peutGererSalle(["consultant"])).toBe(true);
    expect(peutLireSalle(["gestionnaire"])).toBe(false);
    expect(peutLireSalle(["client_dirigeant"])).toBe(false);
  });

  it("actions selon le statut de la demande et la mission", () => {
    const ouvert = { gerer: true, missionCloturee: false };
    expect(actionsDemande({ statut: "brouillon" }, ouvert)).toMatchObject({
      envoyer: true,
      supprimer: true,
      relancer: false,
    });
    expect(actionsDemande({ statut: "envoyee" }, ouvert)).toMatchObject({
      envoyer: false,
      prolonger: true,
      relancer: true,
      clore: true,
      ajouterPiece: true,
    });
    expect(Object.values(actionsDemande({ statut: "close" }, ouvert)).some(Boolean)).toBe(false);
    expect(
      Object.values(
        actionsDemande({ statut: "envoyee" }, { gerer: true, missionCloturee: true }),
      ).some(Boolean),
    ).toBe(false);
    expect(
      Object.values(
        actionsDemande({ statut: "brouillon" }, { gerer: false, missionCloturee: false }),
      ).some(Boolean),
    ).toBe(false);
  });

  it("décision, versement et dépôt pour le client", () => {
    const ctx = { gerer: true, missionCloturee: false };
    expect(peutDecider({ statut: "recue" }, ctx)).toBe(true);
    expect(peutDecider({ statut: "demandee" }, ctx)).toBe(false);
    const depot: DepotSalle = {
      id: "d",
      origine: "portail",
      depose_par: { id: "u", nom: "Awa" },
      depose_le: "2026-10-08T10:00:00Z",
      fichier: { id: "f", nom: "a.pdf", type_mime: "application/pdf", taille: 10 },
      accuse: null,
      document_id: null,
    };
    expect(peutVerser({ statut: "acceptee" }, depot)).toBe(true);
    expect(peutVerser({ statut: "acceptee" }, { ...depot, document_id: "x" })).toBe(false);
    expect(peutVerser({ statut: "recue" }, depot)).toBe(false);
    expect(peutDeposerPourLeClient({ statut: "envoyee" }, { statut: "rejetee" }, ctx)).toBe(true);
    expect(peutDeposerPourLeClient({ statut: "brouillon" }, { statut: "demandee" }, ctx)).toBe(
      false,
    );
    expect(peutDeposerPourLeClient({ statut: "envoyee" }, { statut: "acceptee" }, ctx)).toBe(false);
  });
});

describe("textes", () => {
  it("avancement et détail", () => {
    expect(avancement(synthese({}))).toBe("Aucune pièce");
    expect(avancement(synthese({ total: 7, acceptee: 3 }))).toBe("3 sur 7 pièces acceptées");
    expect(avancement(synthese({ total: 1, acceptee: 1 }))).toBe("1 sur 1 pièce acceptée");
    expect(detailAvancement(synthese({ recue: 2, rejetee: 1, demandee: 4 }))).toBe(
      "2 à examiner · 1 rejetée · 4 attendues",
    );
    expect(detailAvancement(synthese({}))).toBe("");
    expect(STATUT_PIECE.rejetee.tonalite).toBe("danger");
  });

  it("échéance dépassée seulement pour une demande envoyée", () => {
    expect(echeanceDepassee({ statut: "envoyee", echeance: "2026-10-01" }, "2026-10-08")).toBe(
      true,
    );
    expect(echeanceDepassee({ statut: "envoyee", echeance: "2026-10-08" }, "2026-10-08")).toBe(
      false,
    );
    expect(echeanceDepassee({ statut: "close", echeance: "2026-10-01" }, "2026-10-08")).toBe(false);
  });

  it("messages des refus propres à la salle", () => {
    expect(messageSalle("SALLE_SANS_DESTINATAIRE")).toContain("invitez");
    expect(messageSalle("AUTRE")).toBeNull();
    expect(messageSalle(undefined)).toBeNull();
  });

  it("chemins", () => {
    expect(hrefDemande("m1", "d1")).toBe("/missions/m1/salle/d1");
    expect(hrefFichierDepot("m1", "x", true)).toBe(
      "/api/missions/m1/salle/depots/x/fichier?affichage=inline",
    );
    expect(cheminModeles()).toBe("/api/salle/modeles");
    expect(cheminModeles("a b")).toBe("/api/salle/modeles?methode_id=a%20b");
  });
});

describe("saisie d'une demande", () => {
  it("titre obligatoire, échéance future, modèle ou pièces", () => {
    expect(validerDemande(SAISIE_DEMANDE_VIDE, "2026-10-08")).toEqual({
      titre: "Donnez un titre à la demande.",
      pieces: "Choisissez un modèle ou ajoutez au moins une pièce.",
    });
    expect(
      validerDemande(
        { ...SAISIE_DEMANDE_VIDE, titre: "T", echeance: "2026-10-01", modeleId: "m" },
        "2026-10-08",
      ),
    ).toEqual({ echeance: "L'échéance doit être aujourd'hui ou plus tard." });
    expect(
      validerDemande(
        {
          ...SAISIE_DEMANDE_VIDE,
          titre: "T",
          pieces: [{ libelle: "Statuts", description: "", obligatoire: true }],
        },
        "2026-10-08",
      ),
    ).toEqual({});
  });

  it("corps envoyé à l'API : champs vides omis, pièces vides ignorées", () => {
    expect(
      corpsDemande({
        titre: " Pièces ",
        message: " ",
        echeance: "2026-11-01",
        modeleId: "",
        pieces: [
          { libelle: " Statuts ", description: " à jour ", obligatoire: false },
          { libelle: "  ", description: "", obligatoire: true },
        ],
      }),
    ).toEqual({
      titre: "Pièces",
      echeance: "2026-11-01",
      pieces: [{ libelle: "Statuts", description: "à jour", obligatoire: false }],
    });
    expect(corpsDemande({ ...SAISIE_DEMANDE_VIDE, titre: "T", modeleId: "m" })).toEqual({
      titre: "T",
      modele_id: "m",
    });
  });

  it("modèles de la méthode de la mission proposés d'abord, archivés exclus", () => {
    const m = (id: string, methode_id: string | null, actif = true): ModeleSalle => ({
      id,
      nom: id,
      description: null,
      methode_id,
      pieces: [],
      actif,
    });
    const r = modelesTries([m("a", "x"), m("b", null), m("c", "y"), m("d", "x", false)], ["x"]);
    expect(r.suggeres.map((x) => x.id)).toEqual(["a"]);
    expect(r.autres.map((x) => x.id)).toEqual(["b", "c"]);
  });
});
