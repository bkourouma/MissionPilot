import { describe, expect, it } from "vitest";
import { ROLE_LIBELLES, ROLES_CABINET } from "@missionpilot/shared";
import { ErreurApi, MESSAGE_ORIGINE_REFUSEE } from "./api";
import {
  corpsCreationCabinet,
  corpsCreationUtilisateur,
  estSessionExpiree,
  lireCabinetModifie,
  lireCabinets,
  lireCreationCabinet,
  lireCreationUtilisateur,
  lireSuperAdmin,
  lireUtilisateurModifie,
  lireUtilisateurs,
  libelleNombreUtilisateurs,
  libellePays,
  libelleRolesCabinet,
  MESSAGE_DERNIER_ASSOCIE,
  MESSAGE_IDENTIFIANTS_INVALIDES,
  MESSAGE_REPONSE_INATTENDUE,
  MESSAGE_SESSION_EXPIREE,
  MESSAGE_TROP_DE_TENTATIVES,
  messageErreurPlateforme,
  ROLES_PROPOSES,
  validerCabinet,
  validerRoles,
  validerUtilisateur,
  type SaisieCabinet,
  type SaisieUtilisateur,
} from "./plateforme";
import {
  CHEMIN_CONNEXION_PLATEFORME,
  CHEMIN_PLATEFORME,
  COOKIE_PLATEFORME,
  cheminCabinetPlateforme,
  estCheminPlateforme,
  estPagePubliquePlateforme,
} from "./plateforme-routes";

const cabinetValide = {
  id: "cab-1",
  nom: "Cabinet Alliance",
  pays: "CI",
  actif: true,
  estDemo: false,
  creeLe: "2026-10-01T10:00:00.000Z",
};

const utilisateurValide = {
  id: "usr-1",
  email: "awa@exemple.ci",
  nom: "Awa Koné",
  roles: ["associe", "consultant"],
  actif: true,
  creeLe: "2026-10-02T10:00:00.000Z",
};

const saisieCabinet = (surcharge: Partial<SaisieCabinet> = {}): SaisieCabinet => ({
  nom: "Cabinet Alliance",
  pays: "CI",
  associeNom: "Awa Koné",
  associeEmail: "awa@exemple.ci",
  associeMotDePasse: "",
  ...surcharge,
});

const saisieUtilisateur = (surcharge: Partial<SaisieUtilisateur> = {}): SaisieUtilisateur => ({
  nom: "Koffi Yao",
  email: "koffi@exemple.ci",
  roles: ["consultant"],
  motDePasse: "",
  ...surcharge,
});

/** Erreur d'API construite comme le fait `erreurDepuisReponse`. */
const erreur = (code: string, message: string, statut: number) =>
  new ErreurApi(code, message, statut);

describe("lecteurs de réponses (lireSuperAdmin)", () => {
  it("lit un super admin valide ; estDemo absent vaut faux", () => {
    expect(
      lireSuperAdmin({
        superAdmin: { id: "sa-1", email: "root@mp.ci", nom: "Root", estDemo: true },
      }),
    ).toEqual({ id: "sa-1", email: "root@mp.ci", nom: "Root", estDemo: true });
    expect(
      lireSuperAdmin({ superAdmin: { id: "sa-1", email: "root@mp.ci", nom: "Root" } }),
    ).toEqual({ id: "sa-1", email: "root@mp.ci", nom: "Root", estDemo: false });
  });

  it("estDemo qui n'est pas le booléen vrai devient faux", () => {
    const lu = lireSuperAdmin({
      superAdmin: { id: "sa-1", email: "root@mp.ci", nom: "Root", estDemo: "oui" },
    });
    expect(lu?.estDemo).toBe(false);
  });

  it("réponse partielle ou forme invalide → null", () => {
    expect(lireSuperAdmin({ superAdmin: { id: "sa-1", nom: "Root" } })).toBeNull();
    expect(lireSuperAdmin({ superAdmin: { id: "", email: "a@b.ci", nom: "Root" } })).toBeNull();
    expect(lireSuperAdmin({})).toBeNull();
    expect(lireSuperAdmin(null)).toBeNull();
    expect(lireSuperAdmin("texte")).toBeNull();
  });
});

describe("lecteurs de listes (cabinets et utilisateurs)", () => {
  it("lireCabinets : compteurs conservés, négatifs ou non numériques ramenés à 0", () => {
    const liste = lireCabinets({
      elements: [
        { ...cabinetValide, nbUtilisateurs: 3, nbUtilisateursActifs: 2 },
        { ...cabinetValide, id: "cab-2", nbUtilisateurs: -1, nbUtilisateursActifs: "2" },
      ],
    });
    expect(liste).not.toBeNull();
    expect(liste?.[0]).toMatchObject({ nbUtilisateurs: 3, nbUtilisateursActifs: 2 });
    expect(liste?.[1]).toMatchObject({ nbUtilisateurs: 0, nbUtilisateursActifs: 0 });
  });

  it("lireCabinets : écarte les entrées invalides sans rejeter la liste", () => {
    const liste = lireCabinets({
      elements: [cabinetValide, { id: "cab-2" }, null, "texte", { ...cabinetValide, actif: "oui" }],
    });
    expect(liste?.map((c) => c.id)).toEqual(["cab-1"]);
  });

  it("lireCabinets : champs facultatifs par défaut (estDemo faux, creeLe vide)", () => {
    const sansOptionnels = {
      id: cabinetValide.id,
      nom: cabinetValide.nom,
      pays: cabinetValide.pays,
      actif: cabinetValide.actif,
    };
    const [cab] = lireCabinets({ elements: [sansOptionnels] }) ?? [];
    expect(cab).toMatchObject({ estDemo: false, creeLe: "", nbUtilisateurs: 0 });
  });

  it("lireCabinets : liste vide valide ; forme invalide → null", () => {
    expect(lireCabinets({ elements: [] })).toEqual([]);
    expect(lireCabinets({})).toBeNull();
    expect(lireCabinets({ elements: "x" })).toBeNull();
    expect(lireCabinets(null)).toBeNull();
  });

  it("lireUtilisateurs : rôles inconnus et rôles client écartés", () => {
    const [u] =
      lireUtilisateurs({
        elements: [
          {
            ...utilisateurValide,
            roles: ["associe", "client_dirigeant", "inconnu", "expert_externe"],
          },
        ],
      }) ?? [];
    expect(u?.roles).toEqual(["associe", "expert_externe"]);
  });

  it("lireUtilisateurs : entrée dont roles n'est pas un tableau écartée", () => {
    const liste = lireUtilisateurs({
      elements: [{ ...utilisateurValide, roles: "associe" }, utilisateurValide],
    });
    expect(liste?.map((u) => u.id)).toEqual(["usr-1"]);
  });

  it("lireUtilisateurs : forme invalide → null", () => {
    expect(lireUtilisateurs({ elements: {} })).toBeNull();
    expect(lireUtilisateurs(undefined)).toBeNull();
  });
});

describe("lecteurs de créations et de modifications", () => {
  it("lireCreationCabinet : mot de passe généré `null` accepté, chaîne acceptée", () => {
    const sansMdp = lireCreationCabinet({
      cabinet: cabinetValide,
      associe: utilisateurValide,
      motDePasseGenere: null,
    });
    expect(sansMdp?.motDePasseGenere).toBeNull();
    expect(sansMdp?.cabinet.id).toBe("cab-1");
    expect(sansMdp?.associe.roles).toEqual(["associe", "consultant"]);

    const avecMdp = lireCreationCabinet({
      cabinet: cabinetValide,
      associe: utilisateurValide,
      motDePasseGenere: "Provisoire-Genere-42",
    });
    expect(avecMdp?.motDePasseGenere).toBe("Provisoire-Genere-42");
  });

  it("lireCreationCabinet : mot de passe généré absent ou vide → refusé (null)", () => {
    expect(lireCreationCabinet({ cabinet: cabinetValide, associe: utilisateurValide })).toBeNull();
    expect(
      lireCreationCabinet({
        cabinet: cabinetValide,
        associe: utilisateurValide,
        motDePasseGenere: "",
      }),
    ).toBeNull();
  });

  it("lireCreationCabinet : cabinet ou associé invalide → null", () => {
    expect(
      lireCreationCabinet({
        cabinet: { id: "cab-1" },
        associe: utilisateurValide,
        motDePasseGenere: null,
      }),
    ).toBeNull();
    expect(
      lireCreationCabinet({
        cabinet: cabinetValide,
        associe: { id: "usr-1" },
        motDePasseGenere: null,
      }),
    ).toBeNull();
    expect(lireCreationCabinet(null)).toBeNull();
  });

  it("lireCreationUtilisateur : mot de passe `null` accepté, absent refusé, forme invalide refusée", () => {
    expect(
      lireCreationUtilisateur({ utilisateur: utilisateurValide, motDePasseGenere: null }),
    ).toEqual({
      utilisateur: {
        id: "usr-1",
        email: "awa@exemple.ci",
        nom: "Awa Koné",
        roles: ["associe", "consultant"],
        actif: true,
        creeLe: "2026-10-02T10:00:00.000Z",
      },
      motDePasseGenere: null,
    });
    expect(lireCreationUtilisateur({ utilisateur: utilisateurValide })).toBeNull();
    expect(
      lireCreationUtilisateur({ utilisateur: { id: "usr-1" }, motDePasseGenere: null }),
    ).toBeNull();
  });

  it("lireCabinetModifie et lireUtilisateurModifie lisent la clé attendue", () => {
    expect(lireCabinetModifie({ cabinet: { ...cabinetValide, actif: false } })?.actif).toBe(false);
    expect(lireCabinetModifie({})).toBeNull();
    expect(lireCabinetModifie(null)).toBeNull();

    const modifie = lireUtilisateurModifie({
      utilisateur: { ...utilisateurValide, roles: ["gestionnaire", "rôle-inventé"] },
    });
    expect(modifie?.roles).toEqual(["gestionnaire"]);
    expect(lireUtilisateurModifie({ utilisateur: { id: "usr-1" } })).toBeNull();
  });
});

describe("libellés", () => {
  it("libelleRolesCabinet : libellés joints, 'Aucun rôle' si vide ou sans rôle connu", () => {
    expect(libelleRolesCabinet(["associe", "consultant"])).toBe("Associé, Consultant");
    expect(libelleRolesCabinet([])).toBe("Aucun rôle");
    expect(libelleRolesCabinet(["client_dirigeant", "inconnu"])).toBe("Aucun rôle");
    expect(libelleRolesCabinet(["inconnu", "associe"])).toBe("Associé");
  });

  it("libelleNombreUtilisateurs : 0 (et négatif), 1, n", () => {
    expect(libelleNombreUtilisateurs(0)).toBe("Aucun utilisateur");
    expect(libelleNombreUtilisateurs(-2)).toBe("Aucun utilisateur");
    expect(libelleNombreUtilisateurs(1)).toBe("1 utilisateur");
    expect(libelleNombreUtilisateurs(12)).toBe("12 utilisateurs");
  });

  it("libellePays : nom français pour un code connu, code brut sinon", () => {
    expect(libellePays("CI")).not.toBe("");
    expect(libellePays("CI")).toMatch(/Ivoire/);
    // Code bien formé mais inconnu du navigateur : Intl renvoie le code lui-même.
    expect(libellePays("XQ")).toBe("XQ");
    // Code mal formé : Intl lève une RangeError, capturée, le code brut est renvoyé.
    expect(libellePays("C")).toBe("C");
  });

  it("ROLES_PROPOSES : 8 rôles de cabinet, jamais un rôle client, libellés partagés", () => {
    expect(ROLES_PROPOSES).toHaveLength(8);
    expect(ROLES_PROPOSES.map((r) => r.valeur)).toEqual([...ROLES_CABINET]);
    expect(ROLES_PROPOSES.some((r) => r.valeur.startsWith("client_"))).toBe(false);
    for (const { valeur, libelle } of ROLES_PROPOSES) {
      expect(libelle).toBe(ROLE_LIBELLES[valeur]);
      expect(libelle).not.toBe("");
    }
  });
});

describe("validation des saisies", () => {
  it("un cabinet complet et valide n'a aucune erreur", () => {
    expect(validerCabinet(saisieCabinet())).toEqual({});
    expect(validerCabinet(saisieCabinet({ associeMotDePasse: "abcdefghijkl" }))).toEqual({});
  });

  it("validerCabinet : nom vide, trop long, avec caractère de contrôle", () => {
    expect(validerCabinet(saisieCabinet({ nom: "   " })).nom).toBe("Saisissez le nom du cabinet.");
    expect(validerCabinet(saisieCabinet({ nom: "x".repeat(201) })).nom).toBe(
      "Maximum 200 caractères.",
    );
    expect(validerCabinet(saisieCabinet({ nom: "Cabinet\u0007Alliance" })).nom).toBe(
      "Caractères de contrôle interdits.",
    );
    expect(validerCabinet(saisieCabinet({ nom: "x".repeat(200) })).nom).toBeUndefined();
  });

  it("validerCabinet : pays invalide (minuscules, trois lettres, vide)", () => {
    for (const pays of ["ci", "CIV", "C1", ""]) {
      expect(validerCabinet(saisieCabinet({ pays })).pays).toBe("Choisissez un pays.");
    }
  });

  it("validerCabinet : nom de l'associé vide", () => {
    expect(validerCabinet(saisieCabinet({ associeNom: "" })).associeNom).toBe(
      "Saisissez le nom du premier associé.",
    );
  });

  it("validerCabinet : e-mail vide, sans domaine, avec espace, trop long", () => {
    const msgFormat = "Adresse e-mail invalide. Exemple : prenom.nom@cabinet.ci";
    expect(validerCabinet(saisieCabinet({ associeEmail: "" })).associeEmail).toBe(
      "Saisissez l'adresse e-mail.",
    );
    expect(validerCabinet(saisieCabinet({ associeEmail: "awa@exemple" })).associeEmail).toBe(
      msgFormat,
    );
    expect(
      validerCabinet(saisieCabinet({ associeEmail: "awa koné@exemple.ci" })).associeEmail,
    ).toBe(msgFormat);
    expect(
      validerCabinet(saisieCabinet({ associeEmail: `${"a".repeat(250)}@b.ci` })).associeEmail,
    ).toBe(msgFormat);
  });

  it("validerCabinet : e-mail accepté après rognage des espaces", () => {
    expect(validerCabinet(saisieCabinet({ associeEmail: "  awa@exemple.ci  " }))).toEqual({});
  });

  it("mot de passe de l'associé : vide accepté (généré), 11 caractères refusés, 12 acceptés", () => {
    expect(
      validerCabinet(saisieCabinet({ associeMotDePasse: "" })).associeMotDePasse,
    ).toBeUndefined();
    expect(
      validerCabinet(saisieCabinet({ associeMotDePasse: "abcdefghijk" })).associeMotDePasse,
    ).toBe("Au moins 12 caractères, ou laissez vide pour en générer un.");
    expect(
      validerCabinet(saisieCabinet({ associeMotDePasse: "abcdefghijkl" })).associeMotDePasse,
    ).toBeUndefined();
    expect(
      validerCabinet(saisieCabinet({ associeMotDePasse: "x".repeat(201) })).associeMotDePasse,
    ).toBe("Maximum 200 caractères.");
  });

  it("validerUtilisateur : nom, e-mail, rôles, mot de passe", () => {
    expect(validerUtilisateur(saisieUtilisateur())).toEqual({});
    expect(validerUtilisateur(saisieUtilisateur({ nom: "" })).nom).toBe(
      "Saisissez le nom de l'utilisateur.",
    );
    expect(validerUtilisateur(saisieUtilisateur({ email: "pas-un-mail" })).email).toMatch(
      /^Adresse e-mail invalide/,
    );
    expect(validerUtilisateur(saisieUtilisateur({ roles: [] })).roles).toBe(
      "Choisissez au moins un rôle.",
    );
    expect(validerUtilisateur(saisieUtilisateur({ motDePasse: "" })).motDePasse).toBeUndefined();
    expect(validerUtilisateur(saisieUtilisateur({ motDePasse: "abcdefghijk" })).motDePasse).toMatch(
      /^Au moins 12 caractères/,
    );
  });

  it("validerRoles : au moins un rôle", () => {
    expect(validerRoles([])).toBe("Choisissez au moins un rôle.");
    expect(validerRoles(["associe"])).toBeUndefined();
  });
});

describe("corps des requêtes de création", () => {
  it("corpsCreationCabinet : mot de passe vide omis, saisies rognées", () => {
    const corps = corpsCreationCabinet(
      saisieCabinet({
        nom: "  Cabinet Alliance  ",
        associeNom: " Awa Koné ",
        associeEmail: " awa@exemple.ci ",
      }),
    );
    expect(corps).toStrictEqual({
      nom: "Cabinet Alliance",
      pays: "CI",
      associe: { nom: "Awa Koné", email: "awa@exemple.ci" },
    });
    expect(JSON.stringify(corps)).not.toContain("motDePasse");
  });

  it("corpsCreationCabinet : mot de passe fourni repris tel quel", () => {
    const corps = corpsCreationCabinet(saisieCabinet({ associeMotDePasse: "Phrase-Longue-2026" }));
    expect(corps.associe).toStrictEqual({
      nom: "Awa Koné",
      email: "awa@exemple.ci",
      motDePasse: "Phrase-Longue-2026",
    });
  });

  it("corpsCreationUtilisateur : mot de passe vide omis, saisies rognées, rôles copiés", () => {
    const roles = ["consultant", "associe"];
    const corps = corpsCreationUtilisateur(
      saisieUtilisateur({ nom: " Koffi Yao ", email: " koffi@exemple.ci ", roles }),
    );
    expect(corps).toStrictEqual({
      nom: "Koffi Yao",
      email: "koffi@exemple.ci",
      roles: ["consultant", "associe"],
    });
    expect(corps.roles).not.toBe(roles);
    expect(JSON.stringify(corps)).not.toContain("motDePasse");
  });

  it("corpsCreationUtilisateur : mot de passe fourni présent", () => {
    expect(
      corpsCreationUtilisateur(saisieUtilisateur({ motDePasse: "Phrase-Longue-2026" })).motDePasse,
    ).toBe("Phrase-Longue-2026");
  });
});

describe("messageErreurPlateforme", () => {
  it("429 et code TROP_DE_TENTATIVES : message d'attente", () => {
    expect(messageErreurPlateforme(erreur("TROP_DE_TENTATIVES", "x", 429))).toBe(
      MESSAGE_TROP_DE_TENTATIVES,
    );
    expect(messageErreurPlateforme(erreur("TROP_DE_TENTATIVES", "x", 423))).toBe(
      MESSAGE_TROP_DE_TENTATIVES,
    );
  });

  it("401 IDENTIFIANTS_INVALIDES : identifiants incorrects", () => {
    expect(messageErreurPlateforme(erreur("IDENTIFIANTS_INVALIDES", "x", 401))).toBe(
      MESSAGE_IDENTIFIANTS_INVALIDES,
    );
    expect(MESSAGE_IDENTIFIANTS_INVALIDES).toBe("E-mail ou mot de passe incorrect.");
  });

  it("401 autre : session expirée", () => {
    expect(messageErreurPlateforme(erreur("NON_AUTHENTIFIE", "x", 401))).toBe(
      MESSAGE_SESSION_EXPIREE,
    );
    expect(MESSAGE_SESSION_EXPIREE).toBe("Votre session a expiré. Reconnectez-vous.");
  });

  it("409 DERNIER_ASSOCIE : message dédié", () => {
    expect(messageErreurPlateforme(erreur("DERNIER_ASSOCIE", "brut", 409))).toBe(
      MESSAGE_DERNIER_ASSOCIE,
    );
  });

  it("409 autre (e-mail déjà pris) : message de l'API repris tel quel", () => {
    expect(
      messageErreurPlateforme(
        erreur("EMAIL_DEJA_UTILISE", "Cette adresse e-mail est déjà utilisée.", 409),
      ),
    ).toBe("Cette adresse e-mail est déjà utilisée.");
  });

  it("400 REQUETE_INVALIDE : valeurs refusées", () => {
    expect(messageErreurPlateforme(erreur("REQUETE_INVALIDE", "Données invalides.", 400))).toBe(
      "Certaines valeurs ont été refusées. Vérifiez les champs puis réessayez.",
    );
  });

  it("403 : action refusée ; 404 : cabinet ou utilisateur introuvable", () => {
    expect(messageErreurPlateforme(erreur("ACCES_REFUSE", "x", 403))).toBe(
      "Action refusée pour ce compte.",
    );
    expect(messageErreurPlateforme(erreur("INTROUVABLE", "x", 404))).toBe(
      "Cabinet ou utilisateur introuvable. Rechargez la page.",
    );
  });

  it("autre statut d'API : message de l'erreur (500)", () => {
    expect(
      messageErreurPlateforme(erreur("SERVICE_INDISPONIBLE", "Service indisponible.", 500)),
    ).toBe("Service indisponible.");
  });

  it("Error nommée ReponseInattendue : son message, sinon celui de réponse inattendue", () => {
    const e = new Error("Le cabinet a peut-être été créé.");
    e.name = "ReponseInattendue";
    expect(messageErreurPlateforme(e)).toBe("Le cabinet a peut-être été créé.");
    const vide = new Error("");
    vide.name = "ReponseInattendue";
    expect(messageErreurPlateforme(vide)).toBe(MESSAGE_REPONSE_INATTENDUE);
  });

  it("403 ORIGINE_REFUSEE : message d'origine, avant le refus générique", () => {
    expect(messageErreurPlateforme(erreur("ORIGINE_REFUSEE", "Origine refusée.", 403))).toBe(
      MESSAGE_ORIGINE_REFUSEE,
    );
    expect(messageErreurPlateforme(erreur("ACCES_REFUSE", "x", 403))).toBe(
      "Action refusée pour ce compte.",
    );
  });

  it("erreur inconnue ou valeur quelconque : message générique", () => {
    expect(messageErreurPlateforme(new Error("boom"))).toBe(
      "Une erreur inattendue est survenue. Réessayez dans un instant.",
    );
    expect(messageErreurPlateforme("texte")).toBe(
      "Une erreur inattendue est survenue. Réessayez dans un instant.",
    );
  });
});

describe("estSessionExpiree", () => {
  it("vraie seulement pour une ErreurApi 401", () => {
    expect(estSessionExpiree(erreur("NON_AUTHENTIFIE", "x", 401))).toBe(true);
    expect(estSessionExpiree(erreur("IDENTIFIANTS_INVALIDES", "x", 401))).toBe(true);
    expect(estSessionExpiree(erreur("ACCES_REFUSE", "x", 403))).toBe(false);
    expect(estSessionExpiree(erreur("DERNIER_ASSOCIE", "x", 409))).toBe(false);
    expect(estSessionExpiree(new Error("x"))).toBe(false);
    expect(estSessionExpiree(undefined)).toBe(false);
  });
});

describe("chemins de la console (plateforme-routes)", () => {
  it("cookie et chemins de référence", () => {
    expect(COOKIE_PLATEFORME).toBe("mp_plateforme");
    expect(CHEMIN_PLATEFORME).toBe("/plateforme");
    expect(CHEMIN_CONNEXION_PLATEFORME).toBe("/plateforme/connexion");
  });

  it("estCheminPlateforme : la console et ce qui est en dessous, rien d'autre", () => {
    expect(estCheminPlateforme("/plateforme")).toBe(true);
    expect(estCheminPlateforme("/plateforme/x")).toBe(true);
    expect(estCheminPlateforme("/plateforme/cabinets/cab-1")).toBe(true);
    expect(estCheminPlateforme("/plateforme/connexion")).toBe(true);
    expect(estCheminPlateforme("/plateformes")).toBe(false);
    expect(estCheminPlateforme("/plateforme-x")).toBe(false);
    expect(estCheminPlateforme("/")).toBe(false);
    expect(estCheminPlateforme("/cabinet")).toBe(false);
  });

  it("estPagePubliquePlateforme : seule la connexion est publique", () => {
    expect(estPagePubliquePlateforme("/plateforme/connexion")).toBe(true);
    expect(estPagePubliquePlateforme("/plateforme")).toBe(false);
    expect(estPagePubliquePlateforme("/plateforme/connexion/x")).toBe(false);
  });

  it("cheminCabinetPlateforme : chemin encodé du cabinet", () => {
    expect(cheminCabinetPlateforme("cab-1")).toBe("/plateforme/cabinets/cab-1");
    expect(cheminCabinetPlateforme("a b/c")).toBe("/plateforme/cabinets/a%20b%2Fc");
  });
});
