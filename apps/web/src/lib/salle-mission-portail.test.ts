import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import { entreesPortail } from "./portail";
import {
  cheminApiDepot,
  depotPossible,
  etatSuivant,
  hrefDemandePortail,
  libelleEcheance,
  MESSAGE_ATTENTE_RESEAU,
  messageDepot,
  piecesAFournir,
  relancerAuRetour,
  resumePourClient,
  statutPiece,
  type EtatEnvoi,
  type PiecePortail,
} from "./salle-mission-portail";

const piece = (statut: PiecePortail["statut"], id = statut): PiecePortail => ({
  id,
  libelle: id,
  description: null,
  obligatoire: true,
  statut,
  statut_le: null,
  motif_rejet: null,
  depots: [],
});

describe("libellés et règles pour le client", () => {
  it("statuts en termes simples", () => {
    expect(statutPiece("demandee").libelle).toBe("À fournir");
    expect(statutPiece("rejetee").libelle).toBe("À fournir de nouveau");
    expect(statutPiece("inconnu").libelle).toBe("—");
  });

  it("dépôt possible sur une demande ouverte, pièce non acceptée", () => {
    expect(depotPossible({ statut: "envoyee" }, { statut: "rejetee" })).toBe(true);
    expect(depotPossible({ statut: "envoyee" }, { statut: "acceptee" })).toBe(false);
    expect(depotPossible({ statut: "close" }, { statut: "demandee" })).toBe(false);
  });

  it("pièces à fournir et résumé", () => {
    const d = { pieces: [piece("demandee"), piece("recue"), piece("rejetee"), piece("acceptee")] };
    expect(piecesAFournir(d).map((p) => p.id)).toEqual(["demandee", "rejetee"]);
    const s = {
      total: 4,
      demandee: 1,
      recue: 1,
      acceptee: 1,
      rejetee: 1,
      obligatoires_restantes: 3,
    };
    expect(resumePourClient(s)).toBe("2 pièces à fournir");
    expect(resumePourClient({ ...s, demandee: 0, rejetee: 0 })).toBe(
      "Tout est fourni, en cours d'examen",
    );
    expect(resumePourClient({ ...s, demandee: 0, rejetee: 0, recue: 0 })).toBe("Tout est fourni");
  });

  it("échéance", () => {
    expect(libelleEcheance({ statut: "close", echeance: "2026-10-01" }, "2026-10-08").texte).toBe(
      "Demande close",
    );
    const passee = libelleEcheance({ statut: "envoyee", echeance: "2026-10-01" }, "2026-10-08");
    expect(passee.tonalite).toBe("danger");
    expect(passee.texte).toMatch(/^Échéance passée/);
    expect(
      libelleEcheance({ statut: "envoyee", echeance: "2026-10-20" }, "2026-10-08").texte,
    ).toMatch(/^Avant le /);
  });

  it("chemins et entrée de navigation réservée au dirigeant et au contributeur", () => {
    expect(hrefDemandePortail("a")).toBe("/portail/salle/a");
    expect(cheminApiDepot("p")).toBe("/api/portail/salle/pieces/p/depots");
    const ids = (roles: string[]) => entreesPortail(roles).map((e) => e.id);
    expect(ids(["client_contributeur"])).toContain("salle");
    expect(ids(["client_dirigeant"])).toContain("salle");
    expect(ids(["client_investisseur"])).not.toContain("salle");
  });
});

describe("file d'envoi tolérante à la perte de réseau", () => {
  const inactif: EtatEnvoi = { etape: "inactif" };

  it("envoi, progression bornée, succès ou rejeu", () => {
    const envoi = etatSuivant(inactif, { type: "demarrer" });
    expect(envoi).toEqual({ etape: "envoi", progression: 0 });
    expect(etatSuivant(envoi, { type: "progression", fraction: 1.4 })).toEqual({
      etape: "envoi",
      progression: 1,
    });
    expect(etatSuivant(inactif, { type: "progression", fraction: 0.5 })).toBe(inactif);
    expect(etatSuivant(envoi, { type: "succes", nouveau: false })).toEqual({
      etape: "reussi",
      rejoue: true,
    });
  });

  it("hors connexion ou erreur réseau : le fichier attend le retour du réseau", () => {
    const hors = etatSuivant(inactif, { type: "hors_ligne" });
    expect(hors).toEqual({ etape: "attente_reseau", message: MESSAGE_ATTENTE_RESEAU });
    expect(relancerAuRetour(hors)).toBe(true);
    const reseau = new ErreurApi("RESEAU_INDISPONIBLE", "x", 0);
    expect(etatSuivant(inactif, { type: "erreur", erreur: reseau, enLigne: false })).toEqual(hors);
    const coupure = etatSuivant(inactif, { type: "erreur", erreur: reseau, enLigne: true });
    expect(coupure.etape).toBe("attente_reseau");
    const occupe = new ErreurApi("FICHIERS_OCCUPE", "x", 503);
    expect(etatSuivant(inactif, { type: "erreur", erreur: occupe, enLigne: true }).etape).toBe(
      "attente_reseau",
    );
  });

  it("refus définitif : message, pas de nouvel essai automatique", () => {
    const refus = new ErreurApi("CONTENU_IDENTIQUE", "x", 409);
    const e = etatSuivant(inactif, { type: "erreur", erreur: refus, enLigne: true });
    expect(e).toEqual({
      etape: "echec",
      message: "Ce fichier est identique à celui déjà examiné : déposez une version corrigée.",
    });
    expect(relancerAuRetour(e)).toBe(false);
    expect(etatSuivant(e, { type: "annuler" })).toEqual(inactif);
  });

  it("messages de refus", () => {
    expect(messageDepot(new ErreurApi("INTROUVABLE", "x", 404))).toContain("rechargez");
    expect(messageDepot(new ErreurApi("DEPOT_REFUSE", "Pièce déjà acceptée.", 409))).toBe(
      "Pièce déjà acceptée. Rechargez la page pour voir l'état à jour.",
    );
    expect(messageDepot(new ErreurApi("TYPE_FICHIER_REFUSE", "x", 415))).toContain(
      "Le serveur a refusé ce fichier",
    );
  });
});
