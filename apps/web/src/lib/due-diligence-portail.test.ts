import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  actionCompte,
  badgePublication,
  CONFIRMATION_ACTIVATION,
  cheminInvitationsPortailDd,
  cheminOptionPortailDd,
  cheminPartageDossier,
  cheminPublicationsNote,
  cheminRetraitInvitationPortailDd,
  cheminRetraitPublication,
  compteARetirer,
  droitsPortailDd,
  etatOption,
  hrefPartageInvestisseur,
  libelleCompte,
  libelleRapport,
  messagePortailDd,
  MESSAGES_PORTAIL_DD,
  partageChange,
  publicationPossible,
  publicationsActives,
  validerPublication,
} from "./due-diligence-portail";
import { sousPagesDd, sousPagesParametresDd } from "./due-diligence";

const DOSSIER = "22222222-2222-4222-8222-222222222222";
const MISSION = "11111111-1111-4111-8111-111111111111";
const USER = "33333333-3333-4333-8333-333333333333";
const NOTE = "44444444-4444-4444-8444-444444444444";
const PUB = "55555555-5555-4555-8555-555555555555";

const pub = (extra = {}) => ({
  id: PUB,
  note_id: NOTE,
  version: 2,
  titre: "Note",
  recommandation: "favorable" as const,
  valide_le: "2026-10-05T10:00:00Z",
  publie_le: "2026-10-06T10:00:00Z",
  retiree: false,
  retiree_le: null,
  perimee: false,
  pieces: [],
  ...extra,
});

describe("chemins du partage investisseur", () => {
  it("construit les chemins de l'API et des pages", () => {
    expect(cheminOptionPortailDd).toBe("/api/dd/portail/option");
    expect(cheminPartageDossier(DOSSIER)).toBe(`/api/dd/dossiers/${DOSSIER}/portail`);
    expect(cheminInvitationsPortailDd(DOSSIER)).toBe(
      `/api/dd/dossiers/${DOSSIER}/portail/invitations`,
    );
    expect(cheminRetraitInvitationPortailDd(DOSSIER, USER)).toBe(
      `/api/dd/dossiers/${DOSSIER}/portail/invitations/${USER}/retrait`,
    );
    expect(cheminPublicationsNote(NOTE)).toBe(`/api/dd/notes/${NOTE}/portail/publications`);
    expect(cheminRetraitPublication(PUB)).toBe(`/api/dd/portail/publications/${PUB}/retrait`);
    expect(hrefPartageInvestisseur(MISSION, DOSSIER)).toBe(
      `/missions/${MISSION}/due-diligence/${DOSSIER}/portail`,
    );
  });
});

describe("droits et onglets", () => {
  it("associé : gère et configure ; directeur de mission : gère seulement ; consultant : aucun", () => {
    expect(droitsPortailDd(["associe"])).toEqual({ gerer: true, configurer: true });
    expect(droitsPortailDd(["directeur_mission"])).toEqual({ gerer: true, configurer: false });
    expect(droitsPortailDd(["consultant"])).toEqual({ gerer: false, configurer: false });
    expect(droitsPortailDd(["client_investisseur"])).toEqual({ gerer: false, configurer: false });
  });

  it("l'onglet du dossier n'apparaît que pour qui peut gérer le partage", () => {
    expect(sousPagesDd(MISSION, DOSSIER).map((p) => p.id)).not.toContain("portail");
    const avec = sousPagesDd(MISSION, DOSSIER, { partage: true });
    expect(avec.at(-1)).toEqual({
      id: "portail",
      libelle: "Partage investisseur",
      href: `/missions/${MISSION}/due-diligence/${DOSSIER}/portail`,
    });
  });

  it("l'onglet des paramètres n'apparaît que pour qui peut gérer ou configurer", () => {
    expect(sousPagesParametresDd().map((p) => p.id)).not.toContain("portail");
    expect(sousPagesParametresDd({ portail: true }).at(-1)?.href).toBe(
      "/parametres/due-diligence/portail",
    );
  });
});

describe("option du cabinet", () => {
  it("est désactivée par défaut et dit comment la confirmer", () => {
    expect(etatOption(false, null)).toBe("Désactivé (réglage par défaut)");
    expect(etatOption(false, "2026-10-01T00:00:00Z")).toBe("Désactivé");
    expect(etatOption(true, "2026-10-01T00:00:00Z")).toBe("Activé");
    expect(CONFIRMATION_ACTIVATION).toBe(
      "Les investisseurs invités pourront consulter les notes validées que vous publierez.",
    );
  });
});

describe("comptes", () => {
  it("propose Inviter à un compte admissible non invité, Retirer à un compte invité", () => {
    expect(actionCompte({ admissible: true, invite: false })).toBe("inviter");
    expect(actionCompte({ admissible: true, invite: true })).toBe("retirer");
    expect(actionCompte({ admissible: false, invite: true })).toBe("retirer");
    expect(actionCompte({ admissible: false, invite: false })).toBeNull();
  });

  it("signale un compte invité qui n'est plus admissible", () => {
    expect(compteARetirer({ admissible: false, invite: true })).toBe(true);
    expect(compteARetirer({ admissible: true, invite: true })).toBe(false);
    expect(libelleCompte({ admissible: false, invite: true }).tonalite).toBe("attention");
    expect(libelleCompte({ admissible: true, invite: true }).libelle).toBe("Invité");
    expect(libelleCompte({ admissible: true, invite: false }).libelle).toBe("Non invité");
    expect(libelleCompte({ admissible: false, invite: false }).libelle).toBe("Non admissible");
  });
});

describe("publications", () => {
  it("ne garde que les publications actives, la plus récente d'abord", () => {
    const liste = publicationsActives([
      pub({ id: "a", publie_le: "2026-10-01T00:00:00Z" }),
      pub({ id: "b", retiree: true }),
      pub({ id: "c", publie_le: "2026-10-09T00:00:00Z" }),
    ]);
    expect(liste.map((p) => p.id)).toEqual(["c", "a"]);
    expect(publicationsActives([])).toEqual([]);
  });

  it("marque une publication périmée", () => {
    expect(badgePublication({ perimee: true }).libelle).toMatch(/^Périmée/);
    expect(badgePublication({ perimee: false }).libelle).toBe("À jour");
  });

  it("refuse de publier sans option active ou avec une publication déjà active", () => {
    expect(publicationPossible({ publication_active_id: null }, false).possible).toBe(false);
    expect(publicationPossible({ publication_active_id: PUB }, true).raison).toMatch(/retirez-la/);
    expect(publicationPossible({ publication_active_id: null }, true)).toEqual({
      possible: true,
      raison: null,
    });
  });

  it("nomme un rapport par variante et format", () => {
    expect(libelleRapport({ variante: "executive", format: "pdf" })).toBe(
      "Version exécutive (PDF)",
    );
    expect(libelleRapport({ variante: "detaillee", format: "docx" })).toBe(
      "Version détaillée (Word)",
    );
  });
});

describe("choix des rapports", () => {
  const dispo = [{ id: "r1" }, { id: "r2" }];

  it("construit le corps : version et rapports sans doublon", () => {
    expect(validerPublication(3, ["r1", "r2", "r1"], dispo)).toEqual({
      ok: true,
      charge: { version: 3, rapports: ["r1", "r2"] },
    });
    expect(validerPublication(1, [], dispo)).toEqual({
      ok: true,
      charge: { version: 1, rapports: [] },
    });
  });

  it("refuse un rapport non proposé", () => {
    const r = validerPublication(1, ["zz"], dispo);
    expect(r.ok).toBe(false);
  });

  it("refuse plus de dix rapports", () => {
    const ids = Array.from({ length: 11 }, (_, i) => `r${i}`);
    const r = validerPublication(
      1,
      ids,
      ids.map((id) => ({ id })),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs.rapports).toMatch(/10 rapports au plus/);
  });
});

describe("traduction des erreurs", () => {
  it("traduit chaque code métier du partage en français", () => {
    const codes: [string, number][] = [
      ["DD_PORTAIL_COMPTE_NON_ADMISSIBLE", 400],
      ["DD_PORTAIL_PIECE_NON_ADMISSIBLE", 400],
      ["DD_PORTAIL_DEJA_INVITE", 409],
      ["NOTE_NON_VALIDEE", 409],
      ["NOTE_PERIMEE", 409],
      ["DD_PORTAIL_PUBLICATION_ACTIVE", 409],
      ["DD_PORTAIL_PUBLICATION_RETIREE", 409],
      ["MISSION_CLOTUREE", 409],
      ["PLAFOND_ATTEINT", 409],
    ];
    for (const [code, statut] of codes) {
      const m = messagePortailDd(new ErreurApi(code, "English text", statut));
      expect(m).toBe(MESSAGES_PORTAIL_DD[code]);
      expect(m).not.toMatch(/English/);
    }
  });

  it("garde un message générique pour un 404, un 403 et une erreur inconnue", () => {
    expect(messagePortailDd(new ErreurApi("INTROUVABLE", "x", 404))).toMatch(/rechargez/);
    expect(messagePortailDd(new ErreurApi("ACCES_REFUSE", "x", 403))).toMatch(/rôle/);
    expect(messagePortailDd(new Error("boom"))).toMatch(/erreur inattendue/);
  });

  it("recharge l'écran après un conflit ou un 404, pas après un plafond", () => {
    expect(partageChange(new ErreurApi("DD_PORTAIL_DEJA_INVITE", "x", 409))).toBe(true);
    expect(partageChange(new ErreurApi("INTROUVABLE", "x", 404))).toBe(true);
    expect(partageChange(new ErreurApi("PLAFOND_ATTEINT", "x", 409))).toBe(false);
    expect(partageChange(new Error("x"))).toBe(false);
  });
});
