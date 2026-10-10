import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  acceptationParDeposant,
  actionsDemande,
  avancement,
  cheminModeles,
  corpsDemande,
  detailAvancement,
  dernierDepotRetenable,
  echeanceDepassee,
  erreurEcheance,
  erreurEcheanceApi,
  hrefDemande,
  hrefFichierDepot,
  messageSalle,
  modelesTries,
  peutDecider,
  peutDeposerPourLeClient,
  peutGererSalle,
  peutLireSalle,
  peutRetirerDepot,
  peutVerser,
  SAISIE_DEMANDE_VIDE,
  STATUT_PIECE,
  validerDemande,
  type DepotSalle,
  type EvenementPiece,
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

const depot = (
  id: string,
  par: string,
  le: string,
  extra: Partial<DepotSalle> = {},
): DepotSalle => ({
  id,
  origine: "portail",
  depose_par: { id: par, nom: par },
  depose_le: le,
  fichier: { id: `f-${id}`, nom: `${id}.pdf`, type_mime: "application/pdf", taille: 10 },
  accuse: null,
  document_id: null,
  ...extra,
});

describe("séparation des tâches à l'acceptation (MPL09)", () => {
  const moi = { utilisateurId: "u1", associe: false };

  it("le dernier dépôt retenable est le plus récent dont le fichier n'est pas retiré", () => {
    const retire = depot("c", "u2", "2026-10-03T10:00:00Z", { fichier: null });
    const p = {
      depots: [
        depot("b", "u2", "2026-10-02T10:00:00Z"),
        retire,
        depot("a", "u1", "2026-10-01T10:00:00Z"),
      ],
    };
    expect(dernierDepotRetenable(p)?.id).toBe("b");
    expect(dernierDepotRetenable({ depots: [retire] })).toBeNull();
    expect(dernierDepotRetenable({ depots: [] })).toBeNull();
  });

  it("refuse d'avance l'acceptation du dépôt qu'on a fait, sauf associé", () => {
    const p = {
      depots: [depot("a", "u2", "2026-10-01T10:00:00Z"), depot("b", "u1", "2026-10-02T10:00:00Z")],
    };
    expect(acceptationParDeposant(p, moi)).toBe(true);
    expect(acceptationParDeposant(p, { ...moi, associe: true })).toBe(false);
    expect(acceptationParDeposant(p, { utilisateurId: "u3", associe: false })).toBe(false);
  });

  it("seul le dernier dépôt compte : un ancien dépôt de soi ne bloque pas", () => {
    const p = {
      depots: [depot("a", "u1", "2026-10-01T10:00:00Z"), depot("b", "u2", "2026-10-02T10:00:00Z")],
    };
    expect(acceptationParDeposant(p, moi)).toBe(false);
    expect(acceptationParDeposant({ depots: [] }, moi)).toBe(false);
  });
});

describe("retrait d'un dépôt non retenu", () => {
  const ouvert = { gerer: true, missionCloturee: false };
  const acceptation = (depotId: string): EvenementPiece => ({
    rang: 2,
    statut: "acceptee",
    motif: null,
    depot_id: depotId,
    par_nom: "Chef",
    le: "2026-10-02T10:00:00Z",
  });

  it("proposé pour un dépôt libre, pas pour un dépôt retenu, versé ou déjà retiré", () => {
    const d = depot("a", "u2", "2026-10-01T10:00:00Z");
    expect(peutRetirerDepot({ historique: [] }, d, ouvert)).toBe(true);
    expect(peutRetirerDepot({ historique: [acceptation("a")] }, d, ouvert)).toBe(false);
    expect(peutRetirerDepot({ historique: [acceptation("autre")] }, d, ouvert)).toBe(true);
    expect(peutRetirerDepot({ historique: [] }, { ...d, document_id: "doc" }, ouvert)).toBe(false);
    expect(peutRetirerDepot({ historique: [] }, { ...d, fichier: null }, ouvert)).toBe(false);
  });

  it("réservé à qui gère la salle, mission ouverte", () => {
    const d = depot("a", "u2", "2026-10-01T10:00:00Z");
    expect(peutRetirerDepot({ historique: [] }, d, { gerer: false, missionCloturee: false })).toBe(
      false,
    );
    expect(peutRetirerDepot({ historique: [] }, d, { gerer: true, missionCloturee: true })).toBe(
      false,
    );
  });
});

describe("échéance bornée", () => {
  it("contrôle local : bornes 2000 à 2100, puis pas dans le passé", () => {
    expect(erreurEcheance("", "2026-10-10")).toBeNull();
    expect(erreurEcheance("1999-12-31", "2026-10-10")).toBe(
      "Date comprise entre 2000 et 2100 attendue.",
    );
    expect(erreurEcheance("2150-01-01", "2026-10-10")).toBe(
      "Date comprise entre 2000 et 2100 attendue.",
    );
    expect(erreurEcheance("2026-10-09", "2026-10-10")).toBe(
      "L'échéance doit être aujourd'hui ou plus tard.",
    );
    expect(erreurEcheance("2026-10-10", "2026-10-10")).toBeNull();
    expect(erreurEcheance("2100-12-31", "2026-10-10")).toBeNull();
  });

  it("la saisie d'une demande signale une échéance hors bornes", () => {
    expect(
      validerDemande(
        { ...SAISIE_DEMANDE_VIDE, titre: "T", modeleId: "m", echeance: "2150-01-01" },
        "2026-10-10",
      ),
    ).toEqual({ echeance: "Date comprise entre 2000 et 2100 attendue." });
  });

  it("message du schéma rendu par l'API pour le champ échéance", () => {
    const refus = new ErreurApi("REQUETE_INVALIDE", "Données invalides.", 400, {
      fieldErrors: { echeance: ["Date comprise entre 2000 et 2100 attendue."] },
      formErrors: [],
    });
    expect(erreurEcheanceApi(refus)).toBe("Date comprise entre 2000 et 2100 attendue.");
    const sansMessage = new ErreurApi("REQUETE_INVALIDE", "Données invalides.", 400, {
      fieldErrors: { echeance: [] },
    });
    expect(erreurEcheanceApi(sansMessage)).toBe("Échéance invalide : saisissez une date valide.");
    const autreChamp = new ErreurApi("REQUETE_INVALIDE", "Données invalides.", 400, {
      fieldErrors: { titre: ["x"] },
    });
    expect(erreurEcheanceApi(autreChamp)).toBeNull();
    expect(erreurEcheanceApi(new ErreurApi("CONFLIT", "x", 409))).toBeNull();
    expect(erreurEcheanceApi(new Error("x"))).toBeNull();
  });
});
