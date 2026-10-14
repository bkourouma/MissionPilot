import { describe, expect, it } from "vitest";
import { CanalWhatsAppSimule, signerWebhook } from "../src/canaux/whatsapp-simule.js";
import { PasserelleSmsSimulee } from "../src/canaux/sms-simule.js";
import { ErreurCanal, type EnvoiGabarit } from "../src/canaux/ports.js";

/*
 * Ports WhatsApp et SMS SIMULÉS (SPEC-3c §4.1, §18.1) : cas W-01 à W-13. Aucune base, aucun réseau :
 * numéros de test seuls, comportement selon les deux derniers chiffres, idempotence, webhook signé.
 */

const SECRET = "secret-de-test-webhook-0123456789abcdef";
const IDEM = "11111111-1111-4111-8111-111111111111";
const NUMERO = "+2250000000012";

const envoi = (numero: string, idempotence = IDEM): EnvoiGabarit => ({
  idempotence,
  compte: "cpt-test-1",
  numero,
  gabarit: "relance_questionnaire_j10",
  langue: "fr",
  variables: ["Cabinet", "/portail/questionnaires/x"],
  texte: "texte rendu",
});

const CORPS_STOP =
  '{"compte":"cpt-test-1","evenement":"evt-0002","type":"message","numero":"+2250000000012","recu_le":"2026-10-12T08:00:00.000Z","genre":"texte","texte":"STOP"}';
const MAINTENANT = new Date(1_700_000_000_000);

const verifier = (
  canal: CanalWhatsAppSimule,
  corps: string,
  horodatage: number,
  secrets: readonly string[] = [SECRET],
  secretSignature = SECRET,
) => {
  const e = signerWebhook(corps, secretSignature, horodatage);
  return canal.verifierWebhook({
    entetes: e,
    corps: Buffer.from(corps),
    maintenant: MAINTENANT,
    secrets,
  });
};

describe("CanalWhatsAppSimule : envois", () => {
  it("W-01 et W-02 : accepté, identifiant déterministe, rejeu sans nouveau message", async () => {
    const c = new CanalWhatsAppSimule();
    const r = await c.envoyerGabarit(envoi(NUMERO));
    expect(r).toEqual({
      statut: "accepte",
      idExterne: "sim-wa-bd7662a5eeb41614",
      codeRefus: null,
      reessayable: false,
    });
    expect(c.boite).toHaveLength(1);
    expect(await c.envoyerGabarit(envoi(NUMERO))).toEqual(r);
    expect(c.boite).toHaveLength(1);
  });

  it("W-03 : numéro réel refusé, boîte inchangée, erreur sans le numéro", async () => {
    const c = new CanalWhatsAppSimule();
    const erreur = await c.envoyerGabarit(envoi("+33612345678")).catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(ErreurCanal);
    expect((erreur as ErreurCanal).code).toBe("NUMERO_REEL_REFUSE_EN_SIMULE");
    expect((erreur as Error).message).not.toContain("33612345678");
    expect(c.boite).toHaveLength(0);
  });

  it("W-04 : comportement selon les deux derniers chiffres", async () => {
    const c = new CanalWhatsAppSimule();
    const cas: [string, string, boolean][] = [
      ["+2250000000000", "NUMERO_NON_JOIGNABLE", false],
      ["+2250000000097", "GABARIT_REFUSE", false],
      ["+2250000000098", "QUOTA_ATTEINT", false],
      ["+2250000000099", "INDISPONIBLE", true],
    ];
    for (const [numero, code, reessayable] of cas) {
      expect(await c.envoyerGabarit(envoi(numero))).toEqual({
        statut: "refuse",
        idExterne: null,
        codeRefus: code,
        reessayable,
      });
    }
    expect(c.boite).toHaveLength(0);
    // « 99 » est indisponible toujours.
    expect((await c.envoyerGabarit(envoi("+2250000000099"))).codeRefus).toBe("INDISPONIBLE");
  });

  it("W-05 : « 96 » est indisponible au premier appel d'une idempotence, accepté ensuite", async () => {
    const c = new CanalWhatsAppSimule();
    expect((await c.envoyerGabarit(envoi("+2250000000096"))).codeRefus).toBe("INDISPONIBLE");
    expect((await c.envoyerGabarit(envoi("+2250000000096"))).statut).toBe("accepte");
  });

  it("W-06 : « 95 » lève une issue inconnue", async () => {
    const c = new CanalWhatsAppSimule();
    await expect(c.envoyerGabarit(envoi("+2250000000095"))).rejects.toMatchObject({
      code: "DELAI_DEPASSE",
    });
  });

  it("W-07 : réponse de session seulement dans les 24 h d'un message entrant", async () => {
    let maintenant = new Date("2026-10-12T12:00:00Z");
    const c = new CanalWhatsAppSimule({ horloge: () => maintenant });
    const session = (id: string) =>
      c.envoyerSession({ idempotence: id, compte: "cpt-test-1", numero: NUMERO, texte: "Merci" });
    expect((await session("a1")).codeRefus).toBe("FENETRE_FERMEE");
    c.noterEntrant(NUMERO, new Date(maintenant.getTime() - 23 * 3_600_000));
    expect((await session("a2")).statut).toBe("accepte");
    maintenant = new Date(maintenant.getTime() + 2 * 3_600_000);
    expect((await session("a3")).codeRefus).toBe("FENETRE_FERMEE");
  });

  it("la boîte garde les 100 derniers messages", async () => {
    const c = new CanalWhatsAppSimule();
    for (let i = 0; i < 105; i++) {
      await c.envoyerGabarit(
        envoi(NUMERO, `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
      );
    }
    expect(c.boite).toHaveLength(100);
  });
});

describe("CanalWhatsAppSimule : webhook", () => {
  it("W-08 : signature du jeu d'essai acceptée, un événement message texte", () => {
    const c = new CanalWhatsAppSimule();
    const e = signerWebhook(CORPS_STOP, SECRET, 1_700_000_000);
    expect(e["x-mp-signature"]).toBe(
      "c78343e48ec02348ef94bc13ad299d63d366b83c8d6f9cc88282253210363fd6",
    );
    const evts = verifier(c, CORPS_STOP, 1_700_000_000);
    expect(evts).toHaveLength(1);
    expect(evts[0]).toMatchObject({
      type: "message",
      idEvenement: "evt-0002",
      compte: "cpt-test-1",
      numero: NUMERO,
      contenu: { genre: "texte", texte: "STOP" },
    });
  });

  it("W-09 : un caractère modifié donne SIGNATURE_INVALIDE", () => {
    const c = new CanalWhatsAppSimule();
    const e = signerWebhook(CORPS_STOP, SECRET, 1_700_000_000);
    const modifie = Buffer.from(CORPS_STOP.replace("STOP", "STOQ"));
    expect(() =>
      c.verifierWebhook({ entetes: e, corps: modifie, maintenant: MAINTENANT, secrets: [SECRET] }),
    ).toThrow(expect.objectContaining({ code: "SIGNATURE_INVALIDE" }));
    // Signature mal formée ou absente : même erreur.
    expect(() =>
      c.verifierWebhook({
        entetes: { ...e, "x-mp-signature": "zz" },
        corps: Buffer.from(CORPS_STOP),
        maintenant: MAINTENANT,
        secrets: [SECRET],
      }),
    ).toThrow(expect.objectContaining({ code: "SIGNATURE_INVALIDE" }));
    expect(() =>
      c.verifierWebhook({
        entetes: {},
        corps: Buffer.from(CORPS_STOP),
        maintenant: MAINTENANT,
        secrets: [SECRET],
      }),
    ).toThrow(expect.objectContaining({ code: "SIGNATURE_INVALIDE" }));
  });

  it("W-10 : fenêtre de 300 s incluse, 301 s refusée", () => {
    const c = new CanalWhatsAppSimule();
    const t = MAINTENANT.getTime() / 1000;
    expect(() => verifier(c, CORPS_STOP, t - 301)).toThrow(
      expect.objectContaining({ code: "HORODATAGE_HORS_FENETRE" }),
    );
    expect(verifier(c, CORPS_STOP, t - 300)).toHaveLength(1);
    expect(verifier(c, CORPS_STOP, t + 300)).toHaveLength(1);
    expect(() => verifier(c, CORPS_STOP, t + 301)).toThrow(
      expect.objectContaining({ code: "HORODATAGE_HORS_FENETRE" }),
    );
  });

  it("W-11 : rotation du secret : l'ancien secret est accepté, un troisième refusé", () => {
    const c = new CanalWhatsAppSimule();
    const precedent = "ancien-secret-de-test-webhook-0123456789";
    expect(verifier(c, CORPS_STOP, 1_700_000_000, [SECRET, precedent], precedent)).toHaveLength(1);
    expect(() =>
      verifier(
        c,
        CORPS_STOP,
        1_700_000_000,
        [SECRET, precedent],
        "troisieme-secret-de-test-0123456789abcdef",
      ),
    ).toThrow(expect.objectContaining({ code: "SIGNATURE_INVALIDE" }));
  });

  it("W-12 : signature valide d'un corps non JSON ou hors schéma : CORPS_INVALIDE", () => {
    const c = new CanalWhatsAppSimule();
    const enPlus =
      '{"compte":"cpt-test-1","evenement":"evt-0002","type":"message","numero":"+2250000000012","recu_le":"2026-10-12T08:00:00.000Z","genre":"texte","texte":"x","en_plus":1}';
    for (const corps of ["pas du json", '{"compte":"cpt-test-1"}', enPlus]) {
      expect(() => verifier(c, corps, 1_700_000_000)).toThrow(
        expect.objectContaining({ code: "CORPS_INVALIDE" }),
      );
    }
  });

  it("événement de statut et message audio", () => {
    const c = new CanalWhatsAppSimule();
    const statut =
      '{"compte":"cpt-test-1","evenement":"evt-0003","type":"statut","id_externe_message":"sim-wa-bd7662a5eeb41614","statut":"livre"}';
    expect(verifier(c, statut, 1_700_000_000)[0]).toMatchObject({
      type: "statut",
      statut: "livre",
      codeRefus: null,
    });
    const audio =
      '{"compte":"cpt-test-1","evenement":"evt-0004","type":"message","numero":"+2250000000012","recu_le":"2026-10-12T08:00:00.000Z","genre":"audio","ref_media":"media-1","type_mime":"audio/ogg","duree_ms":4000}';
    expect(verifier(c, audio, 1_700_000_000)[0]).toMatchObject({
      contenu: { genre: "audio", refMedia: "media-1", dureeMs: 4000 },
    });
  });

  it("média : introuvable tant qu'il n'a pas été déposé", async () => {
    const c = new CanalWhatsAppSimule();
    await expect(c.telechargerMedia("cpt-test-1", "media-1")).rejects.toMatchObject({
      code: "MEDIA_INTROUVABLE",
    });
    c.deposerMedia("cpt-test-1", "media-1", { contenu: Buffer.from("x"), typeMime: "audio/ogg" });
    expect((await c.telechargerMedia("cpt-test-1", "media-1")).typeMime).toBe("audio/ogg");
  });
});

describe("PasserelleSmsSimulee", () => {
  const sms = (texte: string, numero = NUMERO, idempotence = IDEM) => ({
    idempotence,
    compte: "cpt-test-1",
    numero,
    gabarit: "relance_questionnaire_j10" as const,
    texte,
  });

  it("W-13 : GSM-7 de 160 caractères au plus ; identifiant sim-sms-", async () => {
    const p = new PasserelleSmsSimulee();
    expect((await p.envoyer(sms("a".repeat(161)))).codeRefus).toBe("GABARIT_REFUSE");
    expect((await p.envoyer(sms("Un questionnaire attend votre réponse"))).codeRefus).toBe(
      "GABARIT_REFUSE",
    );
    const bon =
      "MissionPilot : un questionnaire attend votre reponse : http://localhost:3100/portail/questionnaires/3f2c9b1e-0000-4000-8000-000000000001 STOP pour arreter";
    expect(bon).toHaveLength(154);
    expect(await p.envoyer(sms(bon))).toMatchObject({
      statut: "accepte",
      idExterne: "sim-sms-bd7662a5eeb41614",
    });
    expect(p.boite).toHaveLength(1);
  });

  it("numéro réel refusé, mêmes comportements par numéro", async () => {
    const p = new PasserelleSmsSimulee();
    await expect(p.envoyer(sms("ok", "+33612345678"))).rejects.toMatchObject({
      code: "NUMERO_REEL_REFUSE_EN_SIMULE",
    });
    expect((await p.envoyer(sms("ok", "+2250000000000"))).codeRefus).toBe("NUMERO_NON_JOIGNABLE");
    expect((await p.envoyer(sms("ok", "+2250000000099", "2"))).reessayable).toBe(true);
    await expect(p.envoyer(sms("ok", "+2250000000095", "3"))).rejects.toMatchObject({
      code: "DELAI_DEPASSE",
    });
  });
});
