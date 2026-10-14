import { describe, expect, it } from "vitest";
import type { MoiCanalApi, SyntheseDirigeantApi } from "@missionpilot/shared";
import { ErreurApi } from "./api";
import {
  avancementPortail,
  canauxMoi,
  cheminPreferenceCanal,
  cheminRetraitCanalPortail,
  cheminVerificationCanalPortail,
  etapePreference,
  grouperSynthese,
  hrefDocumentSignaturePortail,
  libelleMonStatut,
  lienSynthese,
  messageErreurPreferences,
  messageErreurSignaturePortail,
  phraseCompteur,
  texteMention,
  validerPreference,
} from "./portail-canaux";

const moi = (over: Partial<MoiCanalApi> = {}): MoiCanalApi => ({
  canal: "whatsapp",
  mode_fournisseur: "simule",
  canal_actif: true,
  numero_masque: null,
  verifie: false,
  consentement: "absent",
  mention: { version: "whatsapp-v1", texte: "Texte de la mention." },
  ...over,
});

describe("chemins : uniquement les routes du portail, jamais celles du cabinet", () => {
  it("construit les chemins de ses préférences", () => {
    expect(cheminPreferenceCanal("whatsapp")).toBe("/api/portail/canaux/moi/whatsapp");
    expect(cheminVerificationCanalPortail("sms")).toBe("/api/portail/canaux/moi/sms/verification");
    expect(cheminRetraitCanalPortail("sms")).toBe("/api/portail/canaux/moi/sms/retrait");
    expect(hrefDocumentSignaturePortail("abc")).toBe("/api/portail/signatures/abc/document");
  });
});

describe("préférences de messagerie", () => {
  it("range WhatsApp avant SMS et ignore une forme inattendue", () => {
    expect(
      canauxMoi([moi({ canal: "sms" }), moi({ canal: "whatsapp" })]).map((c) => c.canal),
    ).toEqual(["whatsapp", "sms"]);
    expect(canauxMoi({ elements: [moi()] })).toHaveLength(1);
    expect(canauxMoi({ elements: [{ canal: "telegram" }] })).toEqual([]);
    expect(canauxMoi(null)).toEqual([]);
  });

  it("propose une seule étape à la fois : numéro, code, accord, puis actif", () => {
    expect(etapePreference(moi())).toBe("numero");
    expect(etapePreference(moi({ numero_masque: "+225…12" }))).toBe("code");
    expect(etapePreference(moi({ numero_masque: "+225…12", verifie: true }))).toBe("consentement");
    expect(
      etapePreference(moi({ numero_masque: "+225…12", verifie: true, consentement: "retire" })),
    ).toBe("consentement");
    expect(
      etapePreference(moi({ numero_masque: "+225…12", verifie: true, consentement: "accorde" })),
    ).toBe("actif");
  });

  it("affiche la mention servie par l'API, sinon celle du lot", () => {
    expect(texteMention(moi())).toBe("Texte de la mention.");
    expect(texteMention({ canal: "sms", mention: undefined as never })).toContain("par SMS");
  });

  it("exige la case de la mention ; le numéro seulement quand il est (re)saisi", () => {
    expect(
      validerPreference(
        { numero: "+2250000000012", mentionCochee: true, avecNumero: true },
        "whatsapp-v1",
      ),
    ).toEqual({
      ok: true,
      charge: { numero: "+2250000000012", mention_version: "whatsapp-v1", consentement: true },
    });
    expect(
      validerPreference({ numero: "", mentionCochee: true, avecNumero: false }, "whatsapp-v1"),
    ).toEqual({ ok: true, charge: { mention_version: "whatsapp-v1", consentement: true } });
    const sansCase = validerPreference(
      { numero: "+2250000000012", mentionCochee: false, avecNumero: true },
      "whatsapp-v1",
    );
    expect(sansCase.ok).toBe(false);
    if (!sansCase.ok) expect(sansCase.erreurs.mention).toContain("Cochez");
    const sansNumero = validerPreference(
      { numero: " ", mentionCochee: true, avecNumero: true },
      "whatsapp-v1",
    );
    expect(sansNumero.ok).toBe(false);
    if (!sansNumero.ok) expect(sansNumero.erreurs.numero).toContain("numéro");
  });

  it("messages du portail : jamais le vocabulaire du cabinet", () => {
    const e = (code: string, statut: number) => new ErreurApi(code, "message de l'API", statut);
    expect(messageErreurPreferences(e("NUMERO_REEL_REFUSE_EN_SIMULE", 400))).toContain(
      "numéros de test",
    );
    expect(messageErreurPreferences(e("CODE_INVALIDE", 409))).toContain("Code incorrect");
    expect(messageErreurPreferences(e("ACCES_REFUSE", 403))).toContain("interlocuteur au cabinet");
    expect(messageErreurPreferences(e("INTROUVABLE", 404))).toContain("n'existe pas");
  });
});

describe("signatures du portail", () => {
  it("dit ce que la personne doit faire, ou ce qu'elle a fait", () => {
    expect(libelleMonStatut({ mon_statut: "invite", peut_signer: true })).toEqual({
      libelle: "À signer",
      tonalite: "attention",
    });
    expect(libelleMonStatut({ mon_statut: "signe", peut_signer: false })).toEqual({
      libelle: "A signé",
      tonalite: "succes",
    });
    expect(libelleMonStatut({ mon_statut: "refuse", peut_signer: false }).tonalite).toBe("danger");
  });

  it("l'avancement est un compteur, jamais le nom d'un membre du cabinet", () => {
    expect(avancementPortail({ signataires_signes: 1, signataires_total: 2 })).toBe(
      "1 sur 2 signatures",
    );
    expect(avancementPortail({ signataires_signes: 0, signataires_total: 1 })).toBe(
      "0 sur 1 signature",
    );
  });

  it("signer sans double authentification renvoie vers « Sécurité » de l'espace client", () => {
    const m = messageErreurSignaturePortail(new ErreurApi("TFA_INACTIVE", "x", 409));
    expect(m).toContain("« Sécurité » de votre espace");
    expect(m).not.toContain("Sécurité du compte");
  });
});

describe("synthèse du dirigeant", () => {
  const synthese: Pick<
    SyntheseDirigeantApi,
    "points_attention" | "decisions_attendues" | "sections"
  > = {
    points_attention: 3,
    decisions_attendues: 2,
    sections: [
      {
        code: "kpi_rouge",
        groupe: "point_attention",
        libelle: "KPI en rouge",
        nombre: 2,
        lien: "/portail/kpi",
      },
      {
        code: "kpi_orange",
        groupe: "point_attention",
        libelle: "KPI en orange",
        nombre: 1,
        lien: "/portail/kpi",
      },
      {
        code: "signatures",
        groupe: "decision",
        libelle: "Documents à signer",
        nombre: 2,
        lien: "/portail/signatures",
      },
      { code: "vide", groupe: "decision", libelle: "Rien", nombre: 0, lien: "/portail/salle" },
    ],
  };

  it("regroupe les sections, points d'attention d'abord, sans ligne à zéro", () => {
    const g = grouperSynthese(synthese);
    expect(g.map((x) => [x.titre, x.total, x.sections.length])).toEqual([
      ["Points d'attention", 3, 2],
      ["Décisions attendues", 2, 1],
    ]);
  });

  it("reprend les totaux de l'API au lieu de les recalculer", () => {
    const g = grouperSynthese({ ...synthese, points_attention: 7 });
    expect(g[0]?.total).toBe(7);
  });

  it("conjugue les compteurs", () => {
    expect(phraseCompteur(1, "point_attention")).toBe("1 point d'attention");
    expect(phraseCompteur(3, "point_attention")).toBe("3 points d'attention");
    expect(phraseCompteur(1, "decision")).toBe("1 décision attendue");
    expect(phraseCompteur(2, "decision")).toBe("2 décisions attendues");
  });

  it("ne suit qu'un chemin interne du portail", () => {
    expect(lienSynthese("/portail/questionnaires/abc")).toBe("/portail/questionnaires/abc");
    expect(lienSynthese("/portail")).toBe("/portail");
    for (const mauvais of [
      "https://exemple.org/portail/x",
      "//exemple.org",
      "/missions/abc",
      "/portail/../parametres",
      "/portail//x",
      "javascript:alert(1)",
      "/portail/x y",
      "/portail\\x",
    ]) {
      expect(lienSynthese(mauvais), mauvais).toBeNull();
    }
  });
});
