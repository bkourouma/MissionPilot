import { describe, expect, it } from "vitest";
import { TEXTES_CANAUX, type DestinataireCanalApi } from "@missionpilot/shared";
import { ErreurApi } from "./api";
import {
  actionsDestinataire,
  BANDEAU_SIMULE,
  chargeModificationCompte,
  dateCourte,
  dateHeureCourte,
  dateJourCourte,
  dirigeantsApercu,
  droitsCanaux,
  estSimule,
  etatApresEnregistrement,
  exigeReconfirmationCompte,
  formaterValeurSaisie,
  hrefJournal,
  hrefSaisies,
  libelleCanal,
  libelleMotifBlocage,
  libelleNumero,
  libelleRole,
  libelleStatutEnvoi,
  listeDepuis,
  lireParametresJournal,
  lireParametresSaisies,
  mentionPourCanal,
  messageErreurCanaux,
  messagesSimulateur,
  ongletsCanaux,
  pageDepuis,
  precisionEnvoi,
  requeteApercuSynthese,
  requeteJournal,
  requeteSaisies,
  tonaliteConsentement,
  tonaliteStatutEnvoi,
  tonaliteVraisemblance,
  validerCodeVerification,
  validerEntrantSimule,
  validerNumeroSaisi,
  validerReferencePreuve,
  validerRejetSaisie,
  validerRepriseSaisie,
  type EtatCompteEditable,
} from "./canaux";

const ID = "3f2b8c1e-5d4a-4b6f-9e7d-1a2b3c4d5e6f";
const ACTIF: EtatCompteEditable = {
  actif: true,
  repli_sms: true,
  relance_questionnaire_j10: true,
  synthese_hebdo: false,
  saisie_kpi: false,
};
const INACTIF: EtatCompteEditable = { ...ACTIF, actif: false };
const ASSOCIE = { gerer: true, configurer: true };
const DIRECTEUR = { gerer: true, configurer: false };

describe("règle ferme : tout est simulé", () => {
  it("le bandeau est le texte partagé « Simulé : aucun envoi réel »", () => {
    expect(BANDEAU_SIMULE).toBe("Simulé : aucun envoi réel");
    expect(BANDEAU_SIMULE).toBe(TEXTES_CANAUX.bandeauSimule);
    expect(estSimule("simule")).toBe(true);
    expect(estSimule("reel")).toBe(false);
    expect(estSimule(undefined)).toBe(false);
  });
});

describe("formes de réponse tolérantes", () => {
  it("accepte un tableau ou une enveloppe, jamais une exception", () => {
    expect(listeDepuis<number>([1, 2])).toEqual([1, 2]);
    expect(listeDepuis<number>({ elements: [3] })).toEqual([3]);
    expect(listeDepuis<number>({ elements: "x" })).toEqual([]);
    expect(listeDepuis<number>(null)).toEqual([]);
    expect(listeDepuis<number>(undefined)).toEqual([]);
  });

  it("convertit curseur_suivant en suivant (forme de chargerToutesLesPages)", () => {
    expect(pageDepuis({ elements: [1], curseur_suivant: "abc" })).toEqual({
      elements: [1],
      suivant: "abc",
    });
    expect(pageDepuis({ elements: [1], suivant: "def" }).suivant).toBe("def");
    expect(pageDepuis({ elements: [], curseur_suivant: null }).suivant).toBeNull();
    expect(pageDepuis("n'importe quoi")).toEqual({ elements: [], suivant: null });
  });
});

describe("dates JJ/MM/AAAA", () => {
  it("formate un instant à l'heure d'Abidjan et un jour calendaire sans décalage", () => {
    expect(dateCourte("2027-03-12T09:30:00Z")).toBe("12/03/2027");
    expect(dateHeureCourte("2027-03-12T09:30:00Z")).toBe("12/03/2027 à 09:30");
    expect(dateJourCourte("2027-03-12")).toBe("12/03/2027");
    expect(dateCourte(null)).toBe("—");
    expect(dateCourte("pas une date")).toBe("—");
    expect(dateJourCourte("n'importe quoi")).toBe("—");
  });
});

describe("libellés en français, jamais un identifiant technique", () => {
  it("traduit statuts, motifs, canaux et rôles ; inconnu : tiret", () => {
    expect(libelleCanal("whatsapp")).toBe("WhatsApp");
    expect(libelleStatutEnvoi("bloque")).toBe("Bloqué");
    expect(libelleMotifBlocage("consentement_retire")).toBe("Consentement retiré");
    expect(libelleStatutEnvoi("inconnu")).toBe("—");
    expect(libelleStatutEnvoi(null)).toBe("—");
    expect(libelleRole("client_dirigeant")).toBe("Dirigeant client");
    expect(libelleRole("role_futur")).toBe("Utilisateur");
  });

  it("donne une tonalité sobre : le blocage est une attention, l'échec un danger", () => {
    expect(tonaliteStatutEnvoi("livre")).toBe("succes");
    expect(tonaliteStatutEnvoi("bloque")).toBe("attention");
    expect(tonaliteStatutEnvoi("incertain")).toBe("attention");
    expect(tonaliteStatutEnvoi("echec")).toBe("danger");
    expect(tonaliteStatutEnvoi("reserve")).toBe("neutre");
    expect(tonaliteConsentement("accorde")).toBe("succes");
    expect(tonaliteConsentement("retire")).toBe("danger");
    expect(tonaliteConsentement("absent")).toBe("neutre");
    expect(tonaliteVraisemblance("a_verifier")).toBe("attention");
    expect(tonaliteVraisemblance("invraisemblable")).toBe("danger");
  });
});

describe("droits (confort d'affichage)", () => {
  it("l'associé configure, le directeur gère, le chef lit seulement", () => {
    expect(droitsCanaux(["associe"])).toMatchObject({ lire: true, gerer: true, configurer: true });
    expect(droitsCanaux(["directeur_mission"])).toMatchObject({
      lire: true,
      gerer: true,
      configurer: false,
    });
    expect(droitsCanaux(["chef_mission"])).toMatchObject({
      lire: true,
      gerer: false,
      configurer: false,
    });
    expect(droitsCanaux(["consultant"])).toMatchObject({ lire: false, gerer: false });
    expect(droitsCanaux(["client_dirigeant"]).lire).toBe(false);
  });

  it("n'affiche le simulateur qu'à l'associé et en mode simulé", () => {
    const ids = (roles: Parameters<typeof droitsCanaux>[0], simule: boolean) =>
      ongletsCanaux(droitsCanaux(roles), { simule }).map((o) => o.id);
    expect(ids(["associe"], true)).toEqual([
      "comptes",
      "destinataires",
      "journal",
      "saisies",
      "simulateur",
    ]);
    expect(ids(["associe"], false)).not.toContain("simulateur");
    expect(ids(["directeur_mission"], true)).not.toContain("simulateur");
    expect(ids(["chef_mission"], false)).toEqual([
      "comptes",
      "destinataires",
      "journal",
      "saisies",
    ]);
    expect(ids(["consultant"], true)).toEqual([]);
  });
});

describe("comptes : activation, désactivation, options", () => {
  it("exige la reconfirmation seulement à l'activation", () => {
    expect(exigeReconfirmationCompte(INACTIF, ACTIF)).toBe(true);
    expect(exigeReconfirmationCompte(ACTIF, INACTIF)).toBe(false);
    const optionChangee: EtatCompteEditable = { ...ACTIF, saisie_kpi: true };
    expect(exigeReconfirmationCompte(ACTIF, optionChangee)).toBe(false);
  });

  it("refuse une charge vide", () => {
    const r = chargeModificationCompte(ACTIF, ACTIF, ASSOCIE, null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs.aucun).toBe("Aucune modification à enregistrer.");
  });

  it("n'envoie que les champs modifiés ; désactiver est { actif: false } seul", () => {
    expect(chargeModificationCompte(ACTIF, INACTIF, ASSOCIE, null)).toEqual({
      ok: true,
      charge: { actif: false },
    });
    expect(
      chargeModificationCompte(ACTIF, { ...ACTIF, synthese_hebdo: true }, ASSOCIE, null),
    ).toEqual({
      ok: true,
      charge: { synthese_hebdo: true },
    });
  });

  it("l'activation joint le mot de passe (et le code facultatif) ; sans mot de passe : refus local", () => {
    const sans = chargeModificationCompte(INACTIF, ACTIF, ASSOCIE, {
      motDePasse: "",
      code: "",
      facteur: "totp",
    });
    expect(sans.ok).toBe(false);
    if (!sans.ok) expect(sans.erreurs.mot_de_passe).toBe("Saisissez votre mot de passe.");
    const avec = chargeModificationCompte(INACTIF, ACTIF, ASSOCIE, {
      motDePasse: "Mot-de-passe-de-test",
      code: "123456",
      facteur: "totp",
    });
    expect(avec).toEqual({
      ok: true,
      charge: { actif: true, mot_de_passe: "Mot-de-passe-de-test", code: "123456" },
    });
  });

  it("le directeur (canaux.gerer seul) ne peut que désactiver, sans reconfirmation", () => {
    expect(chargeModificationCompte(ACTIF, INACTIF, DIRECTEUR, null)).toEqual({
      ok: true,
      charge: { actif: false },
    });
    // Désactiver ET changer une option : refusé (coupe-circuit seul).
    const melange = chargeModificationCompte(
      ACTIF,
      { ...INACTIF, saisie_kpi: true },
      DIRECTEUR,
      null,
    );
    expect(melange.ok).toBe(false);
    // Activer : refusé.
    expect(chargeModificationCompte(INACTIF, ACTIF, DIRECTEUR, null).ok).toBe(false);
    // Changer une option : refusé.
    expect(
      chargeModificationCompte(ACTIF, { ...ACTIF, repli_sms: false }, DIRECTEUR, null).ok,
    ).toBe(false);
  });

  it("reprend l'état de la réponse de l'API, sinon les valeurs envoyées", () => {
    expect(
      etatApresEnregistrement({ ...ACTIF, actif: false, synthese_hebdo: true }, ACTIF),
    ).toEqual({
      ...ACTIF,
      actif: false,
      synthese_hebdo: true,
    });
    expect(
      etatApresEnregistrement({ actif: true }, { ...ACTIF, saisie_kpi: true }).saisie_kpi,
    ).toBe(true);
    expect(etatApresEnregistrement(undefined, INACTIF)).toEqual(INACTIF);
  });
});

describe("numéro, code, preuve de consentement", () => {
  it("valide le numéro saisi sans jamais le normaliser (c'est l'API qui juge)", () => {
    expect(validerNumeroSaisi("  +2250000000012 ")).toEqual({
      ok: true,
      charge: { numero: "+2250000000012" },
    });
    expect(validerNumeroSaisi("").ok).toBe(false);
    expect(validerNumeroSaisi("1234").ok).toBe(false);
    expect(validerNumeroSaisi("+225\u0000000012345").ok).toBe(false);
  });

  it("le code comporte 6 chiffres, espaces tolérés", () => {
    expect(validerCodeVerification("123 456")).toEqual({ ok: true, charge: { code: "123456" } });
    expect(validerCodeVerification("12345").ok).toBe(false);
    expect(validerCodeVerification("abcdef").ok).toBe(false);
    expect(validerCodeVerification("").ok).toBe(false);
  });

  it("la référence de la preuve a 10 à 500 caractères", () => {
    expect(validerReferencePreuve("court").ok).toBe(false);
    expect(validerReferencePreuve("formulaire signé le 12/03/2027")).toEqual({
      ok: true,
      charge: { statut: "accorde", reference_preuve: "formulaire signé le 12/03/2027" },
    });
    expect(validerReferencePreuve("x".repeat(501)).ok).toBe(false);
  });

  it("la mention affichée est celle du serveur pour le canal, en entier", () => {
    const wa = mentionPourCanal("whatsapp");
    expect(wa.version).toBe("whatsapp-v1");
    expect(wa.texte).toContain("STOP");
    expect(mentionPourCanal("sms").version).toBe("sms-v1");
  });
});

describe("actions sur un destinataire", () => {
  const base: Pick<
    DestinataireCanalApi,
    "numero_masque" | "verifie" | "consentement" | "consentement_source"
  > = { numero_masque: null, verifie: false, consentement: "absent", consentement_source: null };

  it("sans numéro : seulement l'enregistrement du numéro", () => {
    expect(actionsDestinataire(base, { gerer: true })).toMatchObject({
      enregistrerNumero: true,
      saisirCode: false,
      enregistrerConsentement: false,
      retirer: false,
    });
  });

  it("numéro non vérifié : le code d'abord, pas de consentement possible", () => {
    const a = actionsDestinataire({ ...base, numero_masque: "+225…12" }, { gerer: true });
    expect(a.saisirCode).toBe(true);
    expect(a.enregistrerConsentement).toBe(false);
    expect(a.motifConsentementImpossible).toContain("vérifié");
  });

  it("numéro vérifié sans accord : consentement recueilli possible ; accordé : retrait possible", () => {
    const verifie = { ...base, numero_masque: "+225…12", verifie: true };
    expect(actionsDestinataire(verifie, { gerer: true }).enregistrerConsentement).toBe(true);
    const accorde = actionsDestinataire(
      { ...verifie, consentement: "accorde", consentement_source: "portail" },
      { gerer: true },
    );
    expect(accorde.retirer).toBe(true);
    expect(accorde.enregistrerConsentement).toBe(false);
  });

  it("après STOP, le cabinet ne peut pas redonner l'accord : seule la personne le peut", () => {
    const a = actionsDestinataire(
      {
        numero_masque: "+225…12",
        verifie: true,
        consentement: "retire",
        consentement_source: "message_stop",
      },
      { gerer: true },
    );
    expect(a.enregistrerConsentement).toBe(false);
    expect(a.motifConsentementImpossible).toContain("STOP");
    // Un retrait par le cabinet, lui, peut être rétabli avec une preuve.
    const retraitCabinet = actionsDestinataire(
      {
        numero_masque: "+225…12",
        verifie: true,
        consentement: "retire",
        consentement_source: "retrait_cabinet",
      },
      { gerer: true },
    );
    expect(retraitCabinet.enregistrerConsentement).toBe(true);
  });

  it("sans canaux.gerer : aucune action", () => {
    const a = actionsDestinataire(
      { ...base, numero_masque: "+225…12", verifie: true, consentement: "accorde" },
      { gerer: false },
    );
    expect(a).toMatchObject({
      enregistrerNumero: false,
      saisirCode: false,
      enregistrerConsentement: false,
      retirer: false,
    });
  });

  it("affiche le masque seulement, jamais un numéro", () => {
    expect(libelleNumero({ numero_masque: null, verifie: false })).toBe("Aucun numéro");
    expect(libelleNumero({ numero_masque: "+225…12", verifie: true })).toBe("+225…12 (vérifié)");
    expect(libelleNumero({ numero_masque: "+225…12", verifie: false })).toBe(
      "+225…12 (à vérifier)",
    );
  });
});

describe("messages d'erreur en français", () => {
  const e = (code: string, statut = 409) => new ErreurApi(code, "message de l'API", statut);

  it("traduit les codes du lot", () => {
    expect(messageErreurCanaux(e("NUMERO_REEL_REFUSE_EN_SIMULE", 400))).toContain(
      "numéros de test",
    );
    expect(messageErreurCanaux(e("CODE_INVALIDE"))).toContain("Code incorrect");
    expect(messageErreurCanaux(e("CODE_EXPIRE"))).toContain("expiré");
    expect(messageErreurCanaux(e("MENTION_PERIMEE"))).toContain("mention");
    expect(messageErreurCanaux(e("CANAL_NON_ACTIF"))).toContain("pas activé");
    expect(messageErreurCanaux(e("TROP_DE_REQUETES", 429))).toContain("Trop de demandes");
  });

  it("explique la 2FA inactive et retombe sur le message de l'API pour le reste", () => {
    expect(messageErreurCanaux(e("TFA_INACTIVE"))).toContain("double authentification");
    expect(messageErreurCanaux(e("CONFLIT"))).toBe("message de l'API");
  });
});

describe("journal des envois : paramètres d'URL", () => {
  it("ignore toute valeur hors liste et construit la requête de l'API", () => {
    const p = lireParametresJournal({
      statut: "bloque",
      objet_type: "n'importe quoi",
      destinataire_id: ID,
      curseur: "abc_-9",
    });
    expect(p).toEqual({
      statut: "bloque",
      objet_type: null,
      destinataire_id: ID,
      curseur: "abc_-9",
    });
    expect(requeteJournal(p)).toBe(
      `/api/canaux/envois?limite=30&statut=bloque&destinataire_id=${ID}&curseur=abc_-9`,
    );
    expect(lireParametresJournal({ destinataire_id: "pas-un-uuid", curseur: "a b" })).toEqual({
      statut: null,
      objet_type: null,
      destinataire_id: null,
      curseur: null,
    });
  });

  it("construit les liens de pagination avec les mêmes filtres", () => {
    const p = lireParametresJournal({ statut: "echec" });
    expect(hrefJournal(p)).toBe("/parametres/canaux/journal?statut=echec");
    expect(hrefJournal(p, "xyz")).toBe("/parametres/canaux/journal?statut=echec&curseur=xyz");
    expect(hrefJournal(lireParametresJournal({}))).toBe("/parametres/canaux/journal");
  });

  it("n'affiche que le motif ou le refus, jamais un contenu", () => {
    expect(
      precisionEnvoi({ statut: "bloque", motif_blocage: "plafond_destinataire", code_refus: null }),
    ).toBe("Plafond d'envois du destinataire atteint");
    expect(
      precisionEnvoi({ statut: "echec", motif_blocage: null, code_refus: "NUMERO_NON_JOIGNABLE" }),
    ).toBe("Numéro non joignable");
    expect(precisionEnvoi({ statut: "livre", motif_blocage: null, code_refus: null })).toBeNull();
  });
});

describe("saisies de KPI reçues par message", () => {
  it("formate la valeur décimale exacte sans passer par un nombre flottant", () => {
    expect(formaterValeurSaisie("12.500000")).toBe("12,5");
    expect(formaterValeurSaisie("1234567.000000")).toBe("1 234 567");
    expect(formaterValeurSaisie("-0.250000")).toBe("-0,25");
    expect(formaterValeurSaisie("0.100000000000000001")).toBe("0,100000000000000001");
    expect(formaterValeurSaisie("pas un nombre")).toBe("pas un nombre");
  });

  it("par défaut : les saisies confirmées ; un statut inconnu y retombe", () => {
    expect(lireParametresSaisies({}).statut).toBe("confirmee");
    expect(lireParametresSaisies({ statut: "reprise" }).statut).toBe("reprise");
    expect(lireParametresSaisies({ statut: "nimporte" }).statut).toBe("confirmee");
    expect(requeteSaisies(lireParametresSaisies({}))).toBe(
      "/api/canaux/saisies-kpi?statut=confirmee&limite=30",
    );
    expect(hrefSaisies(lireParametresSaisies({}))).toBe("/parametres/canaux/saisies");
    expect(hrefSaisies(lireParametresSaisies({ statut: "reprise" }), "c1")).toBe(
      "/parametres/canaux/saisies?statut=reprise&curseur=c1",
    );
  });

  it("la reprise accepte une date bornée et un commentaire facultatif", () => {
    expect(validerRepriseSaisie({ date_mesure: "", commentaire: "" })).toEqual({
      ok: true,
      charge: {},
    });
    expect(validerRepriseSaisie({ date_mesure: "2027-03-01", commentaire: " vérifié " })).toEqual({
      ok: true,
      charge: { date_mesure: "2027-03-01", commentaire: "vérifié" },
    });
    expect(validerRepriseSaisie({ date_mesure: "1999-12-31", commentaire: "" }).ok).toBe(false);
    expect(validerRepriseSaisie({ date_mesure: "01/03/2027", commentaire: "" }).ok).toBe(false);
    expect(validerRepriseSaisie({ date_mesure: "", commentaire: "x".repeat(501) }).ok).toBe(false);
  });

  it("le rejet exige un motif", () => {
    expect(validerRejetSaisie("  ").ok).toBe(false);
    expect(validerRejetSaisie(" valeur absurde ")).toEqual({
      ok: true,
      charge: { motif: "valeur absurde" },
    });
  });
});

describe("simulateur (développement)", () => {
  it("fabrique un message écrit, une voix de test ou un statut", () => {
    const base = { numero: "+2250000000012", texte: "STOP", idExterne: "", statut: "livre" };
    expect(validerEntrantSimule({ ...base, type: "texte" })).toEqual({
      ok: true,
      charge: { type: "message", numero: "+2250000000012", texte: "STOP" },
    });
    expect(
      validerEntrantSimule({ ...base, type: "vocal", texte: "chiffre d'affaires 12 500" }),
    ).toEqual({
      ok: true,
      charge: {
        type: "message",
        numero: "+2250000000012",
        audio_texte: "chiffre d'affaires 12 500",
      },
    });
    expect(validerEntrantSimule({ ...base, type: "statut", idExterne: "sim-wa-abc" })).toEqual({
      ok: true,
      charge: { type: "statut", id_externe: "sim-wa-abc", statut: "livre" },
    });
  });

  it("refuse un message sans numéro ou sans contenu, et un statut sans message", () => {
    const base = { numero: "", texte: "", idExterne: "", statut: "livre" };
    const r = validerEntrantSimule({ ...base, type: "texte" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erreurs).sort()).toEqual(["numero", "texte"]);
    expect(validerEntrantSimule({ ...base, type: "statut" }).ok).toBe(false);
  });

  it("trie la boîte du plus récent au plus ancien", () => {
    const m = (id: string, instant: string) => ({
      id_externe: id,
      canal: "whatsapp" as const,
      gabarit: "reponse_stop" as const,
      numero_masque: "+225…12",
      texte: "t",
      instant,
    });
    expect(
      messagesSimulateur([m("a", "2027-01-01T10:00:00Z"), m("b", "2027-01-01T11:00:00Z")]).map(
        (x) => x.id_externe,
      ),
    ).toEqual(["b", "a"]);
    expect(messagesSimulateur(undefined)).toEqual([]);
  });
});

describe("aperçu de la synthèse", () => {
  it("construit la requête de l'aperçu (n'envoie rien)", () => {
    expect(requeteApercuSynthese(ID, "dest-1")).toBe(
      `/api/canaux/synthese-dirigeant/apercu?client_id=${ID}&destinataire_id=dest-1`,
    );
  });

  it("ne propose que les dirigeants du client sur WhatsApp, par ordre alphabétique", () => {
    const d = (id: string | null, nom: string, role: string, canal: "whatsapp" | "sms") =>
      ({
        id,
        utilisateur_id: `u-${id}`,
        utilisateur_nom: nom,
        role,
        canal,
        numero_masque: null,
        verifie: false,
        consentement: "absent",
        consentement_source: null,
        consentement_le: null,
      }) as DestinataireCanalApi;
    expect(
      dirigeantsApercu([
        d("1", "Zoé Koné", "client_dirigeant", "whatsapp"),
        d(null, "Awa Traoré", "client_dirigeant", "whatsapp"),
        d("3", "Awa Traoré", "client_dirigeant", "sms"),
        d("4", "Paul Yao", "client_contributeur", "whatsapp"),
      ]),
    ).toEqual([
      // L'identifiant de l'utilisateur, pas la ligne canaux_destinataires (nulle sans numéro).
      { valeur: "u-null", libelle: "Awa Traoré" },
      { valeur: "u-1", libelle: "Zoé Koné" },
    ]);
  });
});
