import { describe, expect, it } from "vitest";
import { ErreurApi } from "./api";
import {
  avecConfirmationIa,
  chargeModeles,
  cheminVersionsPrompt,
  decalerMois,
  ERREUR_CLE_FORMAT,
  ERREUR_CLE_VIDE,
  ERREUR_MODELE_NON_AUTORISE,
  ERREUR_PLAFOND_MAX,
  erreurTestConnexion,
  estPlafondAtteint,
  etatPlafond,
  formaterMicroUsd,
  hausseDePlafond,
  hrefCoutsIa,
  libelleMois,
  libelleSourceCle,
  lireMois,
  lirePlafond,
  marquerActive,
  messageActivation,
  MESSAGE_CLE_ILLISIBLE,
  messageErreurIa,
  MESSAGES_ERREURS_IA,
  optionsModele,
  plafondBorne,
  plafondVersSaisie,
  presentationMode,
  resumeSchemaSortie,
  saisiesModeles,
  textePlafondPlateforme,
  validerCleApi,
  variablesASaisir,
  voitCoutsIa,
  type ModeleTacheIa,
  type PromptIa,
} from "./ia";

const modeles: ModeleTacheIa[] = [
  {
    tache: "redaction",
    modele: "anthropic/claude-sonnet-4.5",
    recommande: "anthropic/claude-sonnet-4.5",
    personnalise: false,
  },
  {
    tache: "classification",
    modele: "openai/gpt-4o-mini",
    recommande: "google/gemini-2.5-flash",
    personnalise: true,
  },
];

describe("état et mode", () => {
  it("mode IA ou gabarit, avec la raison du repli", () => {
    expect(presentationMode({ mode: "ia", ia_activee: true, source_cle: "cabinet" })).toMatchObject(
      {
        libelle: "IA active",
        tonalite: "succes",
      },
    );
    // IA désactivée par défaut (GET : ia_activee faux, mode gabarit) : le bouton est cité.
    expect(
      presentationMode({ mode: "gabarit", ia_activee: false, source_cle: "plateforme" })
        .explication,
    ).toMatch(
      /^L'IA est désactivée tant que le cabinet ne l'a pas activée \(bouton « Activer l'IA »\)/,
    );
    expect(
      presentationMode({ mode: "gabarit", ia_activee: true, source_cle: null }).explication,
    ).toMatch(/^Aucune clé API/);
    expect(libelleSourceCle(null)).toBe("Aucune clé disponible");
    expect(libelleSourceCle("cabinet")).toBe("Clé du cabinet");
  });

  it("activation : sans clé disponible, l'IA activée reste en gabarit", () => {
    expect(messageActivation(true, "cabinet")).toBe("IA activée pour le cabinet.");
    expect(messageActivation(true, null)).toMatch(/aucune clé API n'est disponible/);
    expect(messageActivation(false, "plateforme")).toMatch(/^IA désactivée/);
  });
});

describe("clé API", () => {
  it("retire les espaces de bord, refuse vide, espace interne et caractères spéciaux", () => {
    const cle = "sk-or-v1-0123456789abcdef0123456789abcdef";
    expect(validerCleApi(`  ${cle}\n`)).toEqual({ ok: true, charge: { cle_api: cle } });
    expect(validerCleApi("   ")).toEqual({ ok: false, erreurs: { cle_api: ERREUR_CLE_VIDE } });
    expect(validerCleApi("sk-or v1 0123456789abcdef0123")).toEqual({
      ok: false,
      erreurs: { cle_api: ERREUR_CLE_FORMAT },
    });
    expect(validerCleApi("court").ok).toBe(false);
    expect(validerCleApi("sk-or-v1-0123456789abcdef\r\nX-Injection: 1").ok).toBe(false);
  });
});

describe("plafond mensuel", () => {
  it("dollars saisis → micro-dollars entiers", () => {
    expect(lirePlafond("50")).toEqual({
      ok: true,
      charge: { plafond_mensuel_micro_usd: 50_000_000 },
    });
    expect(lirePlafond("49,90")).toEqual({
      ok: true,
      charge: { plafond_mensuel_micro_usd: 49_900_000 },
    });
    expect(lirePlafond("1 000,5")).toEqual({
      ok: true,
      charge: { plafond_mensuel_micro_usd: 1_000_500_000 },
    });
    expect(lirePlafond("0")).toEqual({ ok: true, charge: { plafond_mensuel_micro_usd: 0 } });
  });

  it("refuse vide, négatif, trop précis, illisible et au-delà de 100 000 $US", () => {
    expect(lirePlafond("").ok).toBe(false);
    expect(lirePlafond("-1").ok).toBe(false);
    expect(lirePlafond("1,234").ok).toBe(false);
    expect(lirePlafond("abc").ok).toBe(false);
    expect(lirePlafond("100000,01")).toEqual({
      ok: false,
      erreurs: { plafond: ERREUR_PLAFOND_MAX },
    });
    expect(lirePlafond("100000").ok).toBe(true);
  });

  it("affichage et saisie", () => {
    expect(formaterMicroUsd(50_000_000)).toBe("50,00\u00a0$US");
    expect(formaterMicroUsd(8_100)).toBe("0,0081\u00a0$US");
    expect(formaterMicroUsd(0)).toBe("0,00\u00a0$US");
    expect(formaterMicroUsd(undefined)).toBe("—");
    expect(plafondVersSaisie(49_900_000)).toBe("49,9");
    expect(plafondVersSaisie(undefined)).toBe("");
  });

  it("plafond borné par l'opérateur (clé de plateforme)", () => {
    expect(
      plafondBorne({
        plafond_mensuel_micro_usd: 50_000_000,
        plafond_effectif_micro_usd: 20_000_000,
      }),
    ).toBe(true);
    expect(
      plafondBorne({
        plafond_mensuel_micro_usd: 50_000_000,
        plafond_effectif_micro_usd: 50_000_000,
      }),
    ).toBe(false);
    expect(plafondBorne({ plafond_mensuel_micro_usd: 50_000_000 })).toBe(false);
  });

  it("limite de l'opérateur affichée avec la clé de la plateforme seulement", () => {
    const base = {
      plafond_mensuel_micro_usd: 50_000_000,
      plafond_plateforme_micro_usd: 20_000_000,
      plafond_effectif_micro_usd: 20_000_000,
    };
    expect(textePlafondPlateforme({ ...base, source_cle: "plateforme" })).toBe(
      "Avec la clé de la plateforme, l'opérateur limite le plafond à 20,00 $US par mois : le plafond appliqué est donc de 20,00 $US, quel que soit celui du cabinet.",
    );
    expect(
      textePlafondPlateforme({
        source_cle: "plateforme",
        plafond_mensuel_micro_usd: 10_000_000,
        plafond_plateforme_micro_usd: 20_000_000,
        plafond_effectif_micro_usd: 10_000_000,
      }),
    ).toMatch(/le plafond du cabinet reste en deçà et s'applique\.$/);
    expect(textePlafondPlateforme({ ...base, source_cle: "cabinet" })).toBeNull();
    expect(textePlafondPlateforme({ source_cle: "plateforme" })).toBeNull();
  });

  it("hausse du plafond : reconfirmation demandée", () => {
    expect(hausseDePlafond(60_000_000, 50_000_000)).toBe(true);
    expect(hausseDePlafond(40_000_000, 50_000_000)).toBe(false);
    expect(hausseDePlafond(50_000_000, 50_000_000)).toBe(false);
    expect(hausseDePlafond(1, undefined)).toBe(true);
  });
});

describe("modèles par tâche (liste fermée modeles_autorises)", () => {
  const autorises = [
    "anthropic/claude-sonnet-4.5",
    "google/gemini-2.5-flash",
    "openai/gpt-4o-mini",
  ];

  it("n'envoie que les changements ; recommandé → null si personnalisé", () => {
    const s = saisiesModeles(modeles);
    expect(s).toEqual([
      { tache: "redaction", recommande: true, modele: "anthropic/claude-sonnet-4.5" },
      { tache: "classification", recommande: false, modele: "openai/gpt-4o-mini" },
    ]);
    expect(chargeModeles(s, modeles, autorises)).toEqual({ ok: true, charge: { modeles: {} } });
    const r = chargeModeles(
      [
        { tache: "redaction", recommande: false, modele: "openai/gpt-4o-mini" },
        { tache: "classification", recommande: true, modele: "openai/gpt-4o-mini" },
      ],
      modeles,
      autorises,
    );
    expect(r).toEqual({
      ok: true,
      charge: { modeles: { redaction: "openai/gpt-4o-mini", classification: null } },
    });
  });

  it("refuse tout modèle hors liste, même bien formé ou en variante (aucune saisie libre)", () => {
    for (const modele of [
      "../../x",
      "mistral/mistral-large",
      "anthropic/claude-sonnet-4.5:online",
      " openai/gpt-4o-mini",
    ]) {
      expect(
        chargeModeles([{ tache: "redaction", recommande: false, modele }], modeles, autorises),
        modele,
      ).toEqual({ ok: false, erreurs: { modele_redaction: ERREUR_MODELE_NON_AUTORISE } });
    }
    // Liste vide : seul le retour au modèle recommandé reste possible.
    expect(
      chargeModeles(
        [{ tache: "redaction", recommande: false, modele: "openai/gpt-4o-mini" }],
        modeles,
        [],
      ).ok,
    ).toBe(false);
    expect(
      chargeModeles(
        [{ tache: "classification", recommande: true, modele: "openai/gpt-4o-mini" }],
        modeles,
        [],
      ),
    ).toEqual({ ok: true, charge: { modeles: { classification: null } } });
  });

  it("modèle personnalisé plus autorisé : conservé s'il est inchangé, signalé dans la liste", () => {
    const restreinte = ["anthropic/claude-sonnet-4.5", "google/gemini-2.5-flash"];
    expect(chargeModeles(saisiesModeles(modeles), modeles, restreinte)).toEqual({
      ok: true,
      charge: { modeles: {} },
    });
    const options = optionsModele(modeles[1]!, restreinte);
    expect(options[0]).toEqual({
      valeur: "openai/gpt-4o-mini",
      libelle: "openai/gpt-4o-mini (plus autorisé : à remplacer)",
    });
    expect(options.map((o) => o.libelle)).toContain("google/gemini-2.5-flash (recommandé)");
    expect(optionsModele(modeles[0]!, restreinte).map((o) => o.valeur)).toEqual(restreinte);
  });
});

describe("prompts", () => {
  const prompt = (p: Partial<PromptIa> = {}): PromptIa => ({
    id: "a",
    nom: "reformulation",
    version: 1,
    tache: "redaction",
    description: "",
    gabarit_systeme: "",
    gabarit_utilisateur: "{{texte}}\n{{chiffres}}",
    variables: ["texte", "chiffres"],
    schema_sortie: { type: "texte" },
    exemple: true,
    auteur_id: null,
    cree_le: "2026-10-06T10:00:00Z",
    actif: false,
    ...p,
  });

  it("« chiffres » n'est jamais saisi par l'écran", () => {
    expect(variablesASaisir(prompt())).toEqual(["texte"]);
  });

  it("résumé du format de sortie", () => {
    expect(resumeSchemaSortie({ type: "texte", longueur_max: 5000 })).toBe(
      "Texte libre (5\u202f000 caractères au plus)",
    );
    expect(
      resumeSchemaSortie({
        type: "objet",
        champs: {
          tonalite: { type: "choix", valeurs: ["positif", "negatif"] },
          justification: { type: "texte" },
        },
      }),
    ).toBe("Objet JSON : tonalite (choix : positif, negatif) ; justification (texte)");
  });

  it("une seule version active par nom après activation", () => {
    const v1 = prompt({ id: "v1", version: 1 });
    const v2 = prompt({ id: "v2", version: 2, actif: true });
    const autre = prompt({ id: "x", nom: "autre", actif: true });
    expect(marquerActive([v2, v1, autre], v1).map((p) => [p.id, p.actif])).toEqual([
      ["v2", false],
      ["v1", true],
      ["x", true],
    ]);
  });

  it("chemin des versions, nom encodé", () => {
    expect(cheminVersionsPrompt("resume_neutre", "c/1")).toBe(
      "/api/ia/prompts?nom=resume_neutre&limite=20&curseur=c%2F1",
    );
  });
});

describe("coûts", () => {
  it("réservés à ia.configurer ET finance.lire", () => {
    expect(voitCoutsIa(["associe"])).toBe(true);
    expect(voitCoutsIa(["gestionnaire"])).toBe(false);
    expect(voitCoutsIa(["consultant"])).toBe(false);
  });

  it("mois lu dans l'URL, décalé et libellé", () => {
    const maintenant = new Date("2026-10-06T12:00:00Z");
    expect(lireMois("2026-03", maintenant)).toBe("2026-03");
    expect(lireMois("2026-13", maintenant)).toBe("2026-10");
    expect(lireMois(undefined, maintenant)).toBe("2026-10");
    expect(decalerMois("2026-01", -1)).toBe("2025-12");
    expect(decalerMois("2026-12", 1)).toBe("2027-01");
    expect(libelleMois("2026-10")).toBe("octobre 2026");
    expect(hrefCoutsIa("2026-10", "abc")).toBe("/parametres/ia?mois=2026-10&missions=abc#couts");
  });

  it("état du plafond d'après la part calculée par l'API", () => {
    expect(etatPlafond(0.5).tonalite).toBe("succes");
    expect(etatPlafond(0.8).tonalite).toBe("attention");
    expect(etatPlafond(1).tonalite).toBe("danger");
    expect(etatPlafond(null).tonalite).toBe("neutre");
  });
});

describe("erreurs", () => {
  it("messages propres aux codes IA, message de l'API pour les refus explicites", () => {
    expect(messageErreurIa(new ErreurApi("PLAFOND_IA_ATTEINT", "x", 409))).toBe(
      MESSAGES_ERREURS_IA.PLAFOND_IA_ATTEINT,
    );
    expect(messageErreurIa(new ErreurApi("APPROBATION_REQUISE", "Validé par un autre.", 403))).toBe(
      "Validé par un autre.",
    );
    expect(
      messageErreurIa(new ErreurApi("CLE_REFUSEE", "Le fournisseur a refusé la clé.", 502)),
    ).toBe("Le fournisseur a refusé la clé.");
    // Quota journalier par utilisateur : le message de l'API porte le nombre (50 par jour).
    expect(
      messageErreurIa(
        new ErreurApi(
          "QUOTA_IA_UTILISATEUR",
          "Quota de 50 générations IA par jour atteint : réessayez demain.",
          429,
        ),
      ),
    ).toBe("Quota de 50 générations IA par jour atteint : réessayez demain.");
    expect(messageErreurIa(new ErreurApi("GENERATIONS_SIMULTANEES", "x", 429))).toBe(
      MESSAGES_ERREURS_IA.GENERATIONS_SIMULTANEES,
    );
    expect(messageErreurIa(new ErreurApi("INTERDIT", "Forbidden", 403))).toBe(
      "Votre rôle ne vous permet pas d'effectuer cette action.",
    );
    expect(messageErreurIa(new Error("boom"))).toMatch(/inattendue/);
    expect(estPlafondAtteint(new ErreurApi("PLAFOND_IA_ATTEINT", "x", 409))).toBe(true);
    expect(estPlafondAtteint(new ErreurApi("CONFLIT", "x", 409))).toBe(false);
  });

  it("test de connexion : IA désactivée, clé illisible (message dédié), autres échecs", () => {
    expect(erreurTestConnexion(new ErreurApi("IA_DESACTIVEE", "x", 409))).toEqual({
      titre: "L'IA n'est pas activée",
      message: MESSAGES_ERREURS_IA.IA_DESACTIVEE,
    });
    const illisible = erreurTestConnexion(new ErreurApi("CLE_IA_ILLISIBLE", "x", 409));
    expect(illisible).toEqual({
      titre: "Clé API du cabinet illisible",
      message: MESSAGE_CLE_ILLISIBLE,
    });
    expect(illisible.message).toMatch(/la clé de la plateforme ne la remplace pas/);
    expect(illisible.message).toMatch(/Enregistrez de nouveau la clé/);
    expect(erreurTestConnexion(new ErreurApi("GENERATIONS_SIMULTANEES", "x", 429)).message).toBe(
      MESSAGES_ERREURS_IA.GENERATIONS_SIMULTANEES,
    );
    expect(erreurTestConnexion(new ErreurApi("CLE_REFUSEE", "Clé refusée.", 502))).toEqual({
      titre: "La connexion a échoué",
      message: "Clé refusée.",
    });
  });
});

describe("reconfirmation (bloc confirmation de PUT /api/ia/parametres)", () => {
  const cle = { ok: true as const, charge: { cle_api: "sk-or-v1-0123456789abcdef0123" } };

  it("bloc imbriqué : mot de passe et code normalisé", () => {
    expect(
      avecConfirmationIa(cle, { motDePasse: "secret", code: "123 456", facteur: "totp" }),
    ).toEqual({
      ok: true,
      charge: {
        cle_api: "sk-or-v1-0123456789abcdef0123",
        confirmation: { mot_de_passe: "secret", code: "123456" },
      },
    });
    expect(
      avecConfirmationIa(cle, { motDePasse: "secret", code: "ABCDE-12345", facteur: "secours" }),
    ).toMatchObject({ charge: { confirmation: { code_secours: "abcde12345" } } });
  });

  it("code facultatif (2FA inactive), mot de passe obligatoire, erreurs réunies", () => {
    expect(avecConfirmationIa(cle, { motDePasse: "secret", code: "", facteur: "totp" })).toEqual({
      ok: true,
      charge: { ...cle.charge, confirmation: { mot_de_passe: "secret" } },
    });
    const r = avecConfirmationIa(
      { ok: false as const, erreurs: { cle_api: ERREUR_CLE_VIDE } },
      { motDePasse: "", code: "12", facteur: "totp" },
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && Object.keys(r.erreurs).sort()).toEqual(["cle_api", "code", "mot_de_passe"]);
    // Aucune reconfirmation demandée : la charge part telle quelle.
    expect(avecConfirmationIa(cle, null)).toEqual(cle);
  });

  it("retrait de la clé (cle_api null) : la confirmation accompagne toujours le changement", () => {
    expect(
      avecConfirmationIa(
        { ok: true as const, charge: { cle_api: null } },
        { motDePasse: "secret", code: "", facteur: "totp" },
      ),
    ).toEqual({ ok: true, charge: { cle_api: null, confirmation: { mot_de_passe: "secret" } } });
  });
});
