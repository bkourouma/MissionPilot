import { describe, expect, it } from "vitest";
import {
  apercuSyntheseQuerySchema,
  canalParamSchema,
  canalUtilisateurParamSchema,
  CATEGORIES_ENVOI_CANAL,
  CODES_GABARIT_CANAL,
  CODES_REFUS_ENVOI_CANAL,
  codeVerificationNumeroSchema,
  compteCanalModificationSchema,
  consentementCabinetSchema,
  corpsVideCanauxSchema,
  destinatairesQuerySchema,
  envoisCanauxQuerySchema,
  estDesactivationCanalSeule,
  LIBELLES_CATEGORIE_ENVOI_CANAL,
  LIBELLES_CODE_GABARIT_CANAL,
  LIBELLES_CODE_REFUS_CANAL,
  LIBELLES_MOTIF_BLOCAGE_CANAL,
  LIBELLES_OBJET_ENVOI_CANAL,
  LIBELLES_SOURCE_CONSENTEMENT,
  LIBELLES_STATUT_ENVOI_CANAL,
  LIBELLES_STATUT_SAISIE_KPI,
  MENTION_COURANTE,
  MENTIONS_CONSENTEMENT,
  MOTIFS_BLOCAGE_CANAL,
  numeroDestinataireSchema,
  OBJETS_ENVOI_CANAL,
  PLAFONDS_CANAUX,
  preferenceCanalPortailSchema,
  saisieKpiRejetSchema,
  saisieKpiRepriseSchema,
  saisiesKpiQuerySchema,
  simulateurEntrantSchema,
  SOURCES_CONSENTEMENT,
  STATUTS_ENVOI_CANAL,
  STATUTS_SAISIE_KPI,
  webhookCanalSchema,
} from "./canaux";

const UUID = "3f2c9b1e-0000-4000-8000-000000000001";

describe("listes fermées et libellés", () => {
  it("chaque liste a un libellé français par valeur", () => {
    const paires: [readonly string[], Record<string, string>][] = [
      [STATUTS_ENVOI_CANAL, LIBELLES_STATUT_ENVOI_CANAL],
      [MOTIFS_BLOCAGE_CANAL, LIBELLES_MOTIF_BLOCAGE_CANAL],
      [CODES_REFUS_ENVOI_CANAL, LIBELLES_CODE_REFUS_CANAL],
      [CATEGORIES_ENVOI_CANAL, LIBELLES_CATEGORIE_ENVOI_CANAL],
      [OBJETS_ENVOI_CANAL, LIBELLES_OBJET_ENVOI_CANAL],
      [CODES_GABARIT_CANAL, LIBELLES_CODE_GABARIT_CANAL],
      [SOURCES_CONSENTEMENT, LIBELLES_SOURCE_CONSENTEMENT],
      [STATUTS_SAISIE_KPI, LIBELLES_STATUT_SAISIE_KPI],
    ];
    for (const [liste, libelles] of paires) {
      expect(Object.keys(libelles).sort()).toEqual([...liste].sort());
      for (const l of Object.values(libelles)) expect(l.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("les plafonds reprennent la SPEC §13", () => {
    expect(PLAFONDS_CANAUX.envoisDestinataire24h).toBe(3);
    expect(PLAFONDS_CANAUX.envoisCabinetMois).toBe(2000);
    expect(PLAFONDS_CANAUX.reponsesService24h).toBe(10);
    expect(PLAFONDS_CANAUX.webhookParMinuteEtCompte).toBe(600);
    expect(PLAFONDS_CANAUX.webhookCorpsMaxOctets).toBe(64 * 1024);
    expect(PLAFONDS_CANAUX.saisieKpiValiditeMinutes).toBe(15);
  });

  it("une mention par canal, version en vigueur, texte exact de la SPEC pour WhatsApp", () => {
    expect(MENTION_COURANTE).toEqual({ whatsapp: "whatsapp-v1", sms: "sms-v1" });
    expect(MENTIONS_CONSENTEMENT["whatsapp-v1"].canal).toBe("whatsapp");
    expect(MENTIONS_CONSENTEMENT["sms-v1"].canal).toBe("sms");
    expect(MENTIONS_CONSENTEMENT["whatsapp-v1"].texte).toBe(
      "J'accepte de recevoir de mon cabinet de conseil, sur ce numéro, des rappels et des synthèses sans données confidentielles. Je peux me désinscrire à tout moment en répondant STOP ou depuis mon espace.",
    );
  });
});

describe("paramètres et corps simples", () => {
  it("paramètres de canal et d'utilisateur", () => {
    expect(canalParamSchema.safeParse({ canal: "whatsapp" }).success).toBe(true);
    expect(canalParamSchema.safeParse({ canal: "telegram" }).success).toBe(false);
    expect(canalParamSchema.safeParse({ canal: "sms", autre: 1 }).success).toBe(false);
    expect(
      canalUtilisateurParamSchema.safeParse({ utilisateurId: UUID, canal: "sms" }).success,
    ).toBe(true);
    expect(
      canalUtilisateurParamSchema.safeParse({ utilisateurId: "x", canal: "sms" }).success,
    ).toBe(false);
    expect(corpsVideCanauxSchema.safeParse({}).success).toBe(true);
    expect(corpsVideCanauxSchema.safeParse({ a: 1 }).success).toBe(false);
  });

  it("numéro en clair : texte court sans caractère de contrôle (l'API normalise)", () => {
    expect(numeroDestinataireSchema.parse({ numero: " +225 00 00 00 00 12 " }).numero).toBe(
      "+225 00 00 00 00 12",
    );
    expect(numeroDestinataireSchema.safeParse({ numero: "12" }).success).toBe(false);
    expect(numeroDestinataireSchema.safeParse({ numero: "1".repeat(41) }).success).toBe(false);
    expect(numeroDestinataireSchema.safeParse({ numero: "+22500\n000012" }).success).toBe(false);
    expect(numeroDestinataireSchema.safeParse({ numero: "+2250000000012", x: 1 }).success).toBe(
      false,
    );
  });

  it("code de vérification : six chiffres, espaces tolérés", () => {
    expect(codeVerificationNumeroSchema.parse({ code: "123 456" })).toEqual({ code: "123456" });
    expect(codeVerificationNumeroSchema.safeParse({ code: "12345" }).success).toBe(false);
    expect(codeVerificationNumeroSchema.safeParse({ code: "12345a" }).success).toBe(false);
  });
});

describe("consentement", () => {
  it("accorder exige la référence de la preuve (10 caractères au moins)", () => {
    expect(consentementCabinetSchema.safeParse({ statut: "accorde" }).success).toBe(false);
    expect(
      consentementCabinetSchema.safeParse({ statut: "accorde", reference_preuve: "123456789" })
        .success,
    ).toBe(false);
    expect(
      consentementCabinetSchema.safeParse({ statut: "accorde", reference_preuve: "1234567890" })
        .success,
    ).toBe(true);
    expect(
      consentementCabinetSchema.safeParse({ statut: "accorde", reference_preuve: "x".repeat(501) })
        .success,
    ).toBe(false);
  });

  it("un retrait n'exige aucune preuve et n'est jamais refusé", () => {
    expect(consentementCabinetSchema.safeParse({ statut: "retire" }).success).toBe(true);
    expect(consentementCabinetSchema.safeParse({ statut: "autre" }).success).toBe(false);
  });

  it("portail : la case de la mention cochée est obligatoire, version connue, numéro facultatif", () => {
    expect(
      preferenceCanalPortailSchema.safeParse({ mention_version: "whatsapp-v1", consentement: true })
        .success,
    ).toBe(true);
    expect(
      preferenceCanalPortailSchema.safeParse({
        numero: "+2250000000012",
        mention_version: "sms-v1",
        consentement: true,
      }).success,
    ).toBe(true);
    expect(
      preferenceCanalPortailSchema.safeParse({
        mention_version: "whatsapp-v1",
        consentement: false,
      }).success,
    ).toBe(false);
    expect(
      preferenceCanalPortailSchema.safeParse({ mention_version: "whatsapp-v0", consentement: true })
        .success,
    ).toBe(false);
    expect(preferenceCanalPortailSchema.safeParse({ consentement: true }).success).toBe(false);
  });
});

describe("compte de canal", () => {
  it("au moins un champ, aucun champ inconnu", () => {
    expect(compteCanalModificationSchema.safeParse({}).success).toBe(false);
    expect(compteCanalModificationSchema.safeParse({ mot_de_passe: "x" }).success).toBe(false);
    expect(compteCanalModificationSchema.safeParse({ actif: true, autre: 1 }).success).toBe(false);
    expect(
      compteCanalModificationSchema.safeParse({ synthese_hebdo: true, saisie_kpi: false }).success,
    ).toBe(true);
  });

  it("reconfirmation : code OU code de secours, jamais les deux", () => {
    expect(
      compteCanalModificationSchema.safeParse({
        actif: true,
        mot_de_passe: "secret",
        code: "123456",
      }).success,
    ).toBe(true);
    expect(
      compteCanalModificationSchema.safeParse({
        actif: true,
        mot_de_passe: "secret",
        code: "123456",
        code_secours: "abcde-12345",
      }).success,
    ).toBe(false);
  });

  it("désactivation seule : le seul cas admis à canaux.gerer", () => {
    const parse = (v: unknown) => compteCanalModificationSchema.parse(v);
    expect(estDesactivationCanalSeule(parse({ actif: false }))).toBe(true);
    expect(estDesactivationCanalSeule(parse({ actif: false, mot_de_passe: "x" }))).toBe(true);
    expect(estDesactivationCanalSeule(parse({ actif: true }))).toBe(false);
    expect(estDesactivationCanalSeule(parse({ actif: false, saisie_kpi: true }))).toBe(false);
    expect(estDesactivationCanalSeule(parse({ repli_sms: false }))).toBe(false);
  });
});

describe("requêtes paginées", () => {
  it("limite de 1 à 100, 30 par défaut ; client obligatoire pour les destinataires", () => {
    expect(destinatairesQuerySchema.parse({ client_id: UUID }).limite).toBe(30);
    expect(destinatairesQuerySchema.parse({ client_id: UUID, limite: "100" }).limite).toBe(100);
    expect(destinatairesQuerySchema.safeParse({ client_id: UUID, limite: "101" }).success).toBe(
      false,
    );
    expect(destinatairesQuerySchema.safeParse({ client_id: UUID, limite: "0" }).success).toBe(
      false,
    );
    expect(destinatairesQuerySchema.safeParse({}).success).toBe(false);
  });

  it("filtres du journal d'envois", () => {
    expect(
      envoisCanauxQuerySchema.safeParse({
        statut: "bloque",
        objet_type: "synthese",
        objet_id: UUID,
        destinataire_id: UUID,
        curseur: "abc",
      }).success,
    ).toBe(true);
    expect(envoisCanauxQuerySchema.safeParse({ statut: "inconnu" }).success).toBe(false);
    expect(envoisCanauxQuerySchema.safeParse({ contenu: "x" }).success).toBe(false);
  });

  it("aperçu de la synthèse : client et destinataire", () => {
    expect(
      apercuSyntheseQuerySchema.safeParse({ client_id: UUID, destinataire_id: UUID }).success,
    ).toBe(true);
    expect(apercuSyntheseQuerySchema.safeParse({ client_id: UUID }).success).toBe(false);
  });

  it("saisies de KPI : statut connu", () => {
    expect(saisiesKpiQuerySchema.safeParse({ statut: "confirmee" }).success).toBe(true);
    expect(saisiesKpiQuerySchema.safeParse({ statut: "x" }).success).toBe(false);
  });
});

describe("saisies de KPI : reprise et rejet", () => {
  it("reprise : date bornée et commentaire facultatifs", () => {
    expect(saisieKpiRepriseSchema.safeParse({}).success).toBe(true);
    expect(
      saisieKpiRepriseSchema.safeParse({ date_mesure: "2026-10-12", commentaire: "Reçu" }).success,
    ).toBe(true);
    expect(saisieKpiRepriseSchema.safeParse({ date_mesure: "1999-01-01" }).success).toBe(false);
    expect(saisieKpiRepriseSchema.safeParse({ date_mesure: "2026-13-01" }).success).toBe(false);
    expect(saisieKpiRepriseSchema.safeParse({ valeur: "5" }).success).toBe(false);
  });

  it("rejet : motif obligatoire", () => {
    expect(saisieKpiRejetSchema.safeParse({ motif: "Valeur fausse" }).success).toBe(true);
    expect(saisieKpiRejetSchema.safeParse({ motif: "  " }).success).toBe(false);
    expect(saisieKpiRejetSchema.safeParse({}).success).toBe(false);
  });
});

describe("simulateur", () => {
  it("message texte, message vocal de test, statut", () => {
    expect(
      simulateurEntrantSchema.safeParse({
        type: "message",
        numero: "+2250000000012",
        texte: "STOP",
      }).success,
    ).toBe(true);
    expect(
      simulateurEntrantSchema.safeParse({
        type: "message",
        numero: "+2250000000012",
        audio_texte: "affaires 105",
        duree_ms: 3000,
      }).success,
    ).toBe(true);
    expect(
      simulateurEntrantSchema.safeParse({ type: "statut", id_externe: "sim-wa-1", statut: "livre" })
        .success,
    ).toBe(true);
  });

  it("refuse les combinaisons incohérentes", () => {
    expect(
      simulateurEntrantSchema.safeParse({ type: "message", numero: "+2250000000012" }).success,
    ).toBe(false);
    expect(
      simulateurEntrantSchema.safeParse({
        type: "message",
        numero: "+2250000000012",
        texte: "a",
        audio_texte: "b",
      }).success,
    ).toBe(false);
    expect(
      simulateurEntrantSchema.safeParse({ type: "statut", id_externe: "x", statut: "perdu" })
        .success,
    ).toBe(false);
    expect(
      simulateurEntrantSchema.safeParse({
        type: "message",
        numero: "+2250000000012",
        texte: "a".repeat(4097),
      }).success,
    ).toBe(false);
  });
});

describe("charge du webhook (SPEC §8.2)", () => {
  const message = {
    compte: "cpt-test-1",
    evenement: "evt-0002",
    type: "message",
    numero: "+2250000000012",
    recu_le: "2026-10-12T08:00:00.000Z",
    genre: "texte",
    texte: "STOP",
  };

  it("le corps de la SPEC §18.1 (W-08) est valide", () => {
    expect(webhookCanalSchema.safeParse(message).success).toBe(true);
  });

  it("message audio : référence et type du média, pas de texte", () => {
    const audio = {
      ...message,
      evenement: "evt-0003",
      genre: "audio",
      texte: undefined,
      ref_media: "media-123",
      type_mime: "audio/ogg; codecs=opus",
      duree_ms: 4200,
    };
    expect(webhookCanalSchema.safeParse(audio).success).toBe(true);
    expect(webhookCanalSchema.safeParse({ ...audio, ref_media: undefined }).success).toBe(false);
    expect(webhookCanalSchema.safeParse({ ...audio, texte: "x" }).success).toBe(false);
    expect(webhookCanalSchema.safeParse({ ...audio, type_mime: "video/mp4" }).success).toBe(false);
    expect(webhookCanalSchema.safeParse({ ...audio, duree_ms: null }).success).toBe(true);
  });

  it("message texte sans texte, ou avec un média : refusé ; autre genre sans contenu", () => {
    expect(webhookCanalSchema.safeParse({ ...message, texte: undefined }).success).toBe(false);
    expect(webhookCanalSchema.safeParse({ ...message, ref_media: "m1" }).success).toBe(false);
    expect(
      webhookCanalSchema.safeParse({ ...message, genre: "autre", texte: undefined }).success,
    ).toBe(true);
    expect(webhookCanalSchema.safeParse({ ...message, genre: "autre" }).success).toBe(false);
    expect(webhookCanalSchema.safeParse({ ...message, genre: "image" }).success).toBe(false);
  });

  it("statut d'un message", () => {
    const statut = {
      compte: "cpt-test-1",
      evenement: "evt-statut-1",
      type: "statut",
      id_externe_message: "sim-wa-bd7662a5eeb41614",
      statut: "livre",
    };
    expect(webhookCanalSchema.safeParse(statut).success).toBe(true);
    expect(webhookCanalSchema.safeParse({ ...statut, code_refus: "INDISPONIBLE" }).success).toBe(
      true,
    );
    expect(webhookCanalSchema.safeParse({ ...statut, code_refus: null }).success).toBe(true);
    expect(webhookCanalSchema.safeParse({ ...statut, code_refus: "AUTRE" }).success).toBe(false);
    expect(webhookCanalSchema.safeParse({ ...statut, statut: "perdu" }).success).toBe(false);
  });

  it("forme stricte : évènement trop court, numéro non E.164, date invalide, clé inconnue", () => {
    expect(webhookCanalSchema.safeParse({ ...message, evenement: "evt-1" }).success).toBe(false);
    expect(webhookCanalSchema.safeParse({ ...message, evenement: "evt 00002" }).success).toBe(
      false,
    );
    expect(webhookCanalSchema.safeParse({ ...message, numero: "0612345678" }).success).toBe(false);
    expect(webhookCanalSchema.safeParse({ ...message, numero: "+0225123456789" }).success).toBe(
      false,
    );
    expect(webhookCanalSchema.safeParse({ ...message, recu_le: "hier" }).success).toBe(false);
    expect(webhookCanalSchema.safeParse({ ...message, compte: "cpt test" }).success).toBe(false);
    expect(webhookCanalSchema.safeParse({ ...message, surprise: 1 }).success).toBe(false);
    expect(webhookCanalSchema.safeParse({ ...message, texte: "x".repeat(4097) }).success).toBe(
      false,
    );
    expect(webhookCanalSchema.safeParse({ ...message, type: "autre" }).success).toBe(false);
  });
});
