import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  cheminMissionsClient,
  commentaireEnvoye,
  compteurCommentaire,
  construireDemande,
  estFormatEtatFinancier,
  filtrerEtatsFinanciers,
  lireExercices,
  longueurCommentaire,
  messageEtatFinancier,
  MESSAGE_AUCUN_ETAT_ACCEPTE,
  missionsGenerables,
} from "./rapport-etat-financier";
import { MESSAGE_LIMITE_RAPPORTS, type RapportMission } from "./rapports";

const CLIENT = "3f2c9a4e-8d1b-4c6a-9e0f-1a2b3c4d5e6f";
const MISSION = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const erreur = (statut: number, code: string) => new ErreurApi(code, "msg serveur", statut);

describe("choix de la mission", () => {
  it("chemin filtré sur le client", () => {
    expect(cheminMissionsClient(CLIENT)).toBe(`/api/missions?client_id=${CLIENT}&limite=200`);
  });
  it("exclut les missions clôturées et trie par intitulé", () => {
    const l = missionsGenerables([
      { id: "1", intitule: "Zeta", statut: "en_cours" },
      { id: "2", intitule: "Alpha", statut: "cloturee" },
      { id: "3", intitule: "Émile", statut: "signee" },
    ]);
    expect(l.map((m) => m.id)).toEqual(["3", "1"]);
  });
});

describe("saisie", () => {
  it("exercices : entier de 1 à 5", () => {
    expect(lireExercices("3")).toBe(3);
    expect(lireExercices(" 5 ")).toBe(5);
    for (const v of ["0", "6", "", "2,5", "-1", "abc", "03x"]) {
      expect(lireExercices(v), v).toBeNull();
    }
  });
  it("commentaire : vide = absent, sinon tel quel ; compté en caractères", () => {
    expect(commentaireEnvoye("   ")).toBeUndefined();
    expect(commentaireEnvoye("  À relire ")).toBe("  À relire ");
    expect(longueurCommentaire("a😀")).toBe(2);
    expect(compteurCommentaire("abc")).toBe("3 / 4000 caractères");
  });
  it("formats", () => {
    expect(estFormatEtatFinancier("pdf")).toBe(true);
    expect(estFormatEtatFinancier("pptx")).toBe(false);
  });
});

describe("construireDemande", () => {
  const base = { missionId: MISSION, format: "pdf" as const, exercices: "3", commentaire: "" };
  it("construit le chemin sans corps quand pas de commentaire", () => {
    expect(construireDemande(CLIENT, base)).toEqual({
      ok: true,
      chemin: `/api/dossiers/${CLIENT}/rapports/etat-financier?format=pdf&mission_id=${MISSION}&exercices=3`,
      corps: undefined,
    });
  });
  it("joint le commentaire", () => {
    const r = construireDemande(CLIENT, { ...base, format: "docx", commentaire: "Note" });
    expect(r.ok && r.corps).toEqual({ commentaire: "Note" });
    expect(r.ok && r.chemin).toContain("format=docx");
  });
  it("signale chaque champ invalide", () => {
    const r = construireDemande(CLIENT, {
      ...base,
      missionId: "",
      exercices: "9",
      commentaire: "x".repeat(4001),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.erreurs).sort()).toEqual(["commentaire", "exercices", "mission"]);
    }
  });
  it("4000 caractères exactement : accepté", () => {
    expect(construireDemande(CLIENT, { ...base, commentaire: "x".repeat(4000) }).ok).toBe(true);
  });
});

describe("liste et messages", () => {
  it("ne garde que le modèle etat_financier", () => {
    const r = (modele: string) => ({ id: modele, modele }) as unknown as RapportMission;
    expect(filtrerEtatsFinanciers([r("etat_avancement"), r("etat_financier")])).toHaveLength(1);
  });
  it("traduit chaque refus", () => {
    expect(messageEtatFinancier(erreur(409, "AUCUN_ETAT_ACCEPTE"))).toBe(
      MESSAGE_AUCUN_ETAT_ACCEPTE,
    );
    expect(messageEtatFinancier(erreur(409, "CONFLIT"))).toMatch(/clôturée/);
    expect(messageEtatFinancier(erreur(400, "REQUETE_INVALIDE"))).toMatch(/n'appartient pas/);
    expect(messageEtatFinancier(erreur(403, "INTERDIT"))).toMatch(/rôle/);
    expect(messageEtatFinancier(erreur(404, "INTROUVABLE"))).toMatch(/introuvable/);
    expect(messageEtatFinancier(erreur(429, "TROP_DE_RAPPORTS"))).toBe(MESSAGE_LIMITE_RAPPORTS);
  });
});
