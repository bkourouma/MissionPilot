import { describe, expect, it } from "vitest";
import type {
  DossierPreuveApi,
  PreuveSignatureApi,
  SignataireSignatureApi,
} from "@missionpilot/shared";
import { ErreurApi } from "./api";
import type { VersionDocument } from "./documents";
import {
  actionsDemande,
  avancement,
  avancementAccessible,
  AVERTISSEMENT_SIGNATURE_SIMULEE,
  contenuDossierPreuve,
  demandeOuverte,
  demandeTerminee,
  documentsSignables,
  empreinteLisible,
  hrefDocumentSignature,
  cheminApiActionSignature,
  grouperFrise,
  libelleEcheance,
  libelleStatutDemande,
  libelleVerification,
  messageErreurSignature,
  nomFichierDossierPreuve,
  signatairesClientProposes,
  signatairesCabinetProposes,
  tonaliteStatutDemande,
  validerDemandeSignature,
  validerMotifSignature,
  validerSignature,
  type SignatairePropose,
} from "./signatures";

const DOC = "3f2b8c1e-5d4a-4b6f-9e7d-1a2b3c4d5e6f";
const MOI = "11111111-1111-4111-8111-111111111111";
const DIR = "22222222-2222-4222-8222-222222222222";
const CLI = "33333333-3333-4333-8333-333333333333";

const proposes: SignatairePropose[] = [
  { utilisateur_id: DIR, nom: "Directeur", partie: "cabinet", detail: "Directeur de la mission" },
  { utilisateur_id: CLI, nom: "Awa Traoré", partie: "client", detail: "Dirigeant du client" },
];

const doc = (id: string, type: VersionDocument["type"], mime: string | null): VersionDocument =>
  ({
    id,
    type,
    nom: `Document ${id}`,
    version: 2,
    fichier: mime === null ? null : { id: `f-${id}`, type_mime: mime },
  }) as unknown as VersionDocument;

describe("règle ferme : signature simulée", () => {
  it("porte l'avertissement fixe, sans valeur juridique", () => {
    expect(AVERTISSEMENT_SIGNATURE_SIMULEE).toBe("Signature simulée : sans valeur juridique");
  });
});

describe("chemins de l'API", () => {
  it("la lecture du document passe par la route qui inscrit la preuve « document consulté »", () => {
    expect(hrefDocumentSignature("abc")).toBe("/api/signatures/abc/document");
    expect(cheminApiActionSignature("abc", "signer")).toBe("/api/signatures/abc/signer");
  });
});

describe("libellés et avancement", () => {
  it("traduit les statuts et calcule « 1 sur 2 » à partir des compteurs de l'API", () => {
    expect(libelleStatutDemande("partielle")).toBe("Partiellement signée");
    expect(libelleStatutDemande("inconnu")).toBe("—");
    expect(avancement({ signataires_signes: 1, signataires_total: 2 })).toBe("1 sur 2");
    expect(avancementAccessible({ signataires_signes: 1, signataires_total: 2 })).toBe(
      "1 signature sur 2",
    );
    expect(avancementAccessible({ signataires_signes: 2, signataires_total: 3 })).toBe(
      "2 signatures sur 3",
    );
  });

  it("distingue demande ouverte et statut final", () => {
    expect(demandeOuverte("envoyee")).toBe(true);
    expect(demandeOuverte("partielle")).toBe(true);
    expect(demandeOuverte("brouillon")).toBe(false);
    for (const s of ["signee", "refusee", "annulee", "expiree"])
      expect(demandeTerminee(s)).toBe(true);
    expect(demandeTerminee("partielle")).toBe(false);
    expect(tonaliteStatutDemande("signee")).toBe("succes");
    expect(tonaliteStatutDemande("refusee")).toBe("danger");
  });

  it("l'échéance s'affiche en JJ/MM/AAAA ; un brouillon n'en a pas encore", () => {
    expect(libelleEcheance("2027-04-11T12:00:00Z")).toBe("11/04/2027");
    expect(libelleEcheance(null)).toBe("Fixée à l'envoi");
  });

  it("l'empreinte se lit par blocs de 8 caractères ; le fichier d'export ne porte pas le nom du document", () => {
    expect(empreinteLisible("a1b2c3d4e5f60718")).toBe("a1b2c3d4 e5f60718");
    expect(nomFichierDossierPreuve("3f2b8c1e-5d4a-4b6f")).toBe(
      "dossier-preuve-signature-3f2b8c1e.json",
    );
  });
});

describe("documents signables", () => {
  const docs = [
    doc("a", "lettre_de_mission", "application/pdf"),
    doc("b", "lettre_de_mission", "image/png"),
    doc("c", "autre", "application/pdf"),
    doc("d", "lettre_de_mission", null),
    doc("e", "livrable", "application/pdf"),
  ];

  it("une lettre de mission : un PDF de type « lettre de mission » avec fichier", () => {
    expect(documentsSignables(docs, "lettre_mission").map((d) => d.id)).toEqual(["a"]);
  });

  it("un avenant ou un procès-verbal : un PDF de type « autre »", () => {
    expect(documentsSignables(docs, "avenant").map((d) => d.id)).toEqual(["c"]);
    expect(documentsSignables(docs, "proces_verbal").map((d) => d.id)).toEqual(["c"]);
  });
});

describe("signataires proposés", () => {
  it("cabinet : le directeur de la mission et l'associé lui-même, sans doublon", () => {
    const equipe = [{ utilisateur_id: DIR, nom: "Marie Koné" }];
    expect(
      signatairesCabinetProposes({
        directeurId: DIR,
        equipe,
        moi: { id: MOI, nom: "Associé Un", roles: ["associe"] },
      }).map((p) => [p.utilisateur_id, p.nom]),
    ).toEqual([
      [DIR, "Marie Koné"],
      [MOI, "Associé Un"],
    ]);
    // L'associé qui est aussi directeur n'apparaît qu'une fois, sous son nom.
    expect(
      signatairesCabinetProposes({
        directeurId: MOI,
        equipe: [],
        moi: { id: MOI, nom: "Associé Un", roles: ["associe"] },
      }),
    ).toHaveLength(1);
    // Un chef de mission n'est pas signataire cabinet (associé ou directeur seulement).
    expect(
      signatairesCabinetProposes({
        directeurId: null,
        equipe: [],
        moi: { id: MOI, nom: "Chef", roles: ["chef_mission"] },
      }),
    ).toEqual([]);
  });

  it("client : ses dirigeants actifs seulement, par ordre alphabétique", () => {
    const u = (id: string, nom: string, roles: string[], statut = "actif") => ({
      id,
      nom,
      roles,
      statut,
    });
    expect(
      signatairesClientProposes([
        u("1", "Zoé", ["client_dirigeant"]),
        u("2", "Awa", ["client_dirigeant"]),
        u("3", "Paul", ["client_contributeur"]),
        u("4", "Inès", ["client_dirigeant"], "desactive"),
      ]).map((p) => p.nom),
    ).toEqual(["Awa", "Zoé"]);
  });
});

describe("création d'une demande", () => {
  const saisie = {
    document_id: DOC,
    objet: "lettre_mission",
    ordre: "sequentiel",
    expire_jours: "30",
    signataires: [DIR, CLI],
  };

  it("construit le corps ; la partie vient de la proposition, jamais de la saisie", () => {
    expect(validerDemandeSignature(saisie, proposes)).toEqual({
      ok: true,
      charge: {
        document_id: DOC,
        objet: "lettre_mission",
        ordre: "sequentiel",
        expire_jours: 30,
        signataires: [
          { utilisateur_id: DIR, partie: "cabinet" },
          { utilisateur_id: CLI, partie: "client" },
        ],
      },
    });
  });

  it("ignore un signataire non proposé et exige au moins un signataire", () => {
    const r = validerDemandeSignature({ ...saisie, signataires: ["inconnu"] }, proposes);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreurs.signataires).toBe("Choisissez au moins un signataire.");
  });

  it("borne la durée de validité de 1 à 90 jours", () => {
    for (const jours of ["0", "91", "abc", "", "1.5"]) {
      expect(validerDemandeSignature({ ...saisie, expire_jours: jours }, proposes).ok, jours).toBe(
        false,
      );
    }
    for (const jours of ["1", "90"]) {
      expect(validerDemandeSignature({ ...saisie, expire_jours: jours }, proposes).ok, jours).toBe(
        true,
      );
    }
  });

  it("refuse un objet, un ordre ou un document manquant", () => {
    const r = validerDemandeSignature(
      { ...saisie, objet: "x", ordre: "y", document_id: "" },
      proposes,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erreurs).sort()).toEqual(["document_id", "objet", "ordre"]);
  });

  it("limite à dix signataires", () => {
    const beaucoup: SignatairePropose[] = Array.from({ length: 11 }, (_, i) => ({
      utilisateur_id: `u${i}`,
      nom: `P${i}`,
      partie: "client",
      detail: "",
    }));
    const r = validerDemandeSignature(
      { ...saisie, signataires: beaucoup.map((p) => p.utilisateur_id) },
      beaucoup,
    );
    expect(r.ok).toBe(false);
  });
});

describe("motif et signature", () => {
  it("le motif d'annulation ou de refus est obligatoire, 500 caractères au plus", () => {
    expect(validerMotifSignature(" ", "annulation").ok).toBe(false);
    expect(validerMotifSignature("", "refus").ok).toBe(false);
    expect(validerMotifSignature(" trop cher ", "refus")).toEqual({
      ok: true,
      charge: { motif: "trop cher" },
    });
    expect(validerMotifSignature("x".repeat(501), "refus").ok).toBe(false);
  });

  it("signer exige le mot de passe ET le code de la double authentification", () => {
    expect(validerSignature({ motDePasse: "", code: "", facteur: "totp" }).ok).toBe(false);
    const sansCode = validerSignature({ motDePasse: "secret", code: "", facteur: "totp" });
    expect(sansCode.ok).toBe(false);
    expect(validerSignature({ motDePasse: "secret", code: "123456", facteur: "totp" })).toEqual({
      ok: true,
      charge: { mot_de_passe: "secret", code: "123456" },
    });
  });
});

describe("droits d'action sur une demande", () => {
  const signataire = (
    over: Partial<SignataireSignatureApi> & Pick<SignataireSignatureApi, "utilisateur_id">,
  ): SignataireSignatureApi => ({
    id: `s-${over.utilisateur_id}`,
    nom: "N",
    partie: "cabinet",
    rang: 1,
    statut: "invite",
    invite_le: null,
    decide_le: null,
    ...over,
  });

  it("brouillon : le demandeur envoie et annule, personne ne signe", () => {
    const a = actionsDemande({
      demande: { statut: "brouillon", demandeur_id: MOI },
      signataires: [signataire({ utilisateur_id: MOI, statut: "en_attente" })],
      roles: ["directeur_mission"],
      utilisateurId: MOI,
    });
    expect(a).toMatchObject({ envoyer: true, annuler: true, signer: false, refuser: false });
  });

  it("le signataire cabinet invité signe et refuse (mission.signer exigé)", () => {
    const entree = {
      demande: { statut: "envoyee" as const, demandeur_id: DIR },
      signataires: [signataire({ utilisateur_id: MOI })],
      utilisateurId: MOI,
    };
    expect(actionsDemande({ ...entree, roles: ["associe"] })).toMatchObject({
      signer: true,
      refuser: true,
      envoyer: false,
    });
    // Un gestionnaire ne signe pas (pas de mission.signer) : lecture seule.
    expect(actionsDemande({ ...entree, roles: ["gestionnaire"] })).toMatchObject({
      signer: false,
      annuler: false,
      exporter: true,
    });
  });

  it("n'annule que le demandeur ou un associé ; un statut final n'offre plus rien", () => {
    const base = {
      demande: { statut: "envoyee" as const, demandeur_id: DIR },
      signataires: [],
      utilisateurId: MOI,
    };
    expect(actionsDemande({ ...base, roles: ["directeur_mission"] }).annuler).toBe(false);
    expect(actionsDemande({ ...base, roles: ["associe"] }).annuler).toBe(true);
    const finale = actionsDemande({
      ...base,
      demande: { statut: "signee", demandeur_id: MOI },
      roles: ["associe"],
    });
    expect(finale).toMatchObject({ envoyer: false, annuler: false, signer: false });
  });

  it("le signataire du client ne signe jamais depuis l'écran du cabinet", () => {
    const a = actionsDemande({
      demande: { statut: "envoyee", demandeur_id: DIR },
      signataires: [signataire({ utilisateur_id: MOI, partie: "client" })],
      roles: ["associe"],
      utilisateurId: MOI,
    });
    expect(a.signer).toBe(false);
  });
});

describe("frise des preuves", () => {
  const preuve = (
    rang: number,
    type_evenement: PreuveSignatureApi["type_evenement"],
    signataire_id: string | null = null,
    authentification: PreuveSignatureApi["authentification"] = null,
  ): PreuveSignatureApi => ({
    rang,
    type_evenement,
    signataire_id,
    horodatage: `2027-03-12T10:0${rang}:00Z`,
    horodatage_source: "base_locale",
    authentification,
    empreinte: "e".repeat(64),
    empreinte_precedente: "0".repeat(64),
  });
  const signataires: SignataireSignatureApi[] = [
    {
      id: "s1",
      utilisateur_id: CLI,
      nom: "Awa Traoré",
      partie: "client",
      rang: 1,
      statut: "signe",
      invite_le: null,
      decide_le: null,
    },
  ];

  it("regroupe la reconfirmation et la signature d'un même signataire en « Signé »", () => {
    const frise = grouperFrise(
      [
        preuve(1, "demande_creee"),
        preuve(2, "invitation_envoyee"),
        preuve(3, "document_consulte", "s1"),
        preuve(4, "reconfirmation_identite", "s1", "mot_de_passe_et_2fa"),
        preuve(5, "signature_apposee", "s1", "mot_de_passe_et_2fa"),
        preuve(6, "scellement"),
      ],
      signataires,
    );
    expect(frise.map((e) => e.libelle)).toEqual([
      "Demande créée",
      "Invitation envoyée",
      "Document consulté",
      "Signé",
      "Dossier scellé",
    ]);
    expect(frise[2]?.detail).toBe("Awa Traoré");
    expect(frise[3]?.detail).toBe(
      "Awa Traoré · identité reconfirmée · mot de passe et double authentification",
    );
    expect(frise[3]?.tonalite).toBe("succes");
  });

  it("trie par rang et ne regroupe pas deux personnes différentes", () => {
    const frise = grouperFrise(
      [
        preuve(2, "reconfirmation_identite", "s1"),
        preuve(1, "demande_creee"),
        preuve(3, "signature_apposee", "autre"),
      ],
      signataires,
    );
    expect(frise.map((e) => e.libelle)).toEqual(["Demande créée", "Identité reconfirmée", "Signé"]);
  });

  it("montre un refus en rouge et une frise vide sans erreur", () => {
    expect(grouperFrise([preuve(1, "refus", "s1")], signataires)[0]?.tonalite).toBe("danger");
    expect(grouperFrise([], [])).toEqual([]);
  });
});

describe("vérification de la chaîne et export", () => {
  it("dit en français si la chaîne est valide ou à quelle preuve elle casse", () => {
    expect(libelleVerification({ valide: true })).toMatchObject({ tonalite: "succes" });
    const casse = libelleVerification({ valide: false, rang: 4, cause: "EMPREINTE_DIFFERENTE" });
    expect(casse.tonalite).toBe("danger");
    expect(casse.libelle).toBe(
      "Chaîne de preuves invalide à la preuve n° 4 : une preuve a été modifiée.",
    );
  });

  it("exporte le dossier en JSON lisible, tel que reçu", () => {
    const dossier = {
      verification: { valide: true },
      preuves: [],
      signataires: [],
    } as unknown as DossierPreuveApi;
    expect(JSON.parse(contenuDossierPreuve(dossier))).toEqual(dossier);
    expect(contenuDossierPreuve(dossier)).toContain("\n  ");
  });
});

describe("messages d'erreur", () => {
  const e = (code: string, statut = 409) => new ErreurApi(code, "message de l'API", statut);
  it("explique les refus propres à la signature", () => {
    expect(messageErreurSignature(e("TFA_INACTIVE"))).toContain("double authentification");
    expect(messageErreurSignature(e("PORTAIL_NON_PARTAGE"))).toContain("Portail client");
    expect(messageErreurSignature(e("DOCUMENT_NON_SIGNABLE"))).toContain("PDF");
    expect(messageErreurSignature(e("SIGNATURE_EN_COURS"))).toContain("déjà ouverte");
    expect(messageErreurSignature(e("CONFLIT"))).toBe("message de l'API");
  });
});
