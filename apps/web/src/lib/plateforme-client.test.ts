import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErreurApi } from "./api";
import {
  changerEtatCabinet,
  connecterSuperAdmin,
  creerCabinet,
  creerUtilisateur,
  deconnecterSuperAdmin,
  modifierUtilisateur,
  ReponseInattendue,
} from "./plateforme-client";
import { MESSAGE_REPONSE_INATTENDUE } from "./plateforme";
import type { SaisieCabinet, SaisieUtilisateur } from "./plateforme";

const fetchSimule = vi.fn();
const assignSimule = vi.fn();

const cabinetValide = {
  id: "cab-1",
  nom: "Cabinet Alliance",
  pays: "CI",
  actif: false,
  estDemo: false,
  creeLe: "2026-10-01T10:00:00.000Z",
};

const utilisateurValide = {
  id: "usr-1",
  email: "awa@exemple.ci",
  nom: "Awa Koné",
  roles: ["associe"],
  actif: true,
  creeLe: "2026-10-02T10:00:00.000Z",
};

/** Réponse JSON simulée (`corps` absent = réponse sans contenu). */
function reponse(statut: number, corps?: unknown): Response {
  return new Response(corps === undefined ? null : JSON.stringify(corps), {
    status: statut,
    headers: { "Content-Type": "application/json" },
  });
}

/** Erreur de l'API au format de l'enveloppe `{ erreur: { code, message } }`. */
const reponseErreur = (statut: number, code: string, message: string) =>
  reponse(statut, { erreur: { code, message } });

/** URL, méthode, en-têtes et corps (JSON lu) du N-ième appel simulé. */
function appel(index = 0) {
  const [url, init] = fetchSimule.mock.calls[index] as [string, RequestInit];
  const corps = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
  return { url, init, methode: init.method, entetes: init.headers, corps };
}

beforeEach(() => {
  fetchSimule.mockReset();
  assignSimule.mockReset();
  vi.stubGlobal("fetch", fetchSimule);
  vi.stubGlobal("window", {
    location: { assign: assignSimule, pathname: "/plateforme", search: "" },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("connecterSuperAdmin", () => {
  it("POST /api/plateforme/connexion avec l'e-mail rogné et le mot de passe exact", async () => {
    fetchSimule.mockResolvedValueOnce(
      reponse(200, {
        superAdmin: { id: "sa-1", email: "root@mp.ci", nom: "Root", estDemo: false },
      }),
    );
    await connecterSuperAdmin("  root@mp.ci  ", "Phrase-Longue-2026");
    const a = appel();
    expect(a.url).toBe("/api/plateforme/connexion");
    expect(a.methode).toBe("POST");
    expect(a.corps).toStrictEqual({ email: "root@mp.ci", motDePasse: "Phrase-Longue-2026" });
    expect(a.entetes).toEqual({ Accept: "application/json", "Content-Type": "application/json" });
    expect(a.init).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
    });
  });

  it("lit le super admin d'une réponse valide", async () => {
    fetchSimule.mockResolvedValueOnce(
      reponse(200, { superAdmin: { id: "sa-1", email: "root@mp.ci", nom: "Root", estDemo: true } }),
    );
    await expect(connecterSuperAdmin("root@mp.ci", "Phrase-Longue-2026")).resolves.toEqual({
      id: "sa-1",
      email: "root@mp.ci",
      nom: "Root",
      estDemo: true,
    });
    expect(assignSimule).not.toHaveBeenCalled();
  });

  it("réponse mal formée → ReponseInattendue", async () => {
    fetchSimule.mockResolvedValueOnce(reponse(200, { autre: true }));
    const resultat = connecterSuperAdmin("root@mp.ci", "Phrase-Longue-2026");
    await expect(resultat).rejects.toBeInstanceOf(ReponseInattendue);
    await expect(resultat).rejects.toMatchObject({ name: "ReponseInattendue" });
  });

  it("ReponseInattendue porte le message français", async () => {
    fetchSimule.mockResolvedValueOnce(reponse(200, {}));
    await expect(connecterSuperAdmin("root@mp.ci", "Phrase-Longue-2026")).rejects.toThrow(
      MESSAGE_REPONSE_INATTENDUE,
    );
  });

  it("401 d'identifiants invalides : ErreurApi, sans redirection", async () => {
    fetchSimule.mockResolvedValueOnce(
      reponseErreur(401, "IDENTIFIANTS_INVALIDES", "E-mail ou mot de passe incorrect."),
    );
    const resultat = connecterSuperAdmin("root@mp.ci", "mauvais-mot-de-passe");
    await expect(resultat).rejects.toBeInstanceOf(ErreurApi);
    await expect(resultat).rejects.toMatchObject({
      code: "IDENTIFIANTS_INVALIDES",
      statut: 401,
    });
    expect(assignSimule).not.toHaveBeenCalled();
  });

  it("429 : ErreurApi avec son code, sans redirection", async () => {
    fetchSimule.mockResolvedValueOnce(
      reponseErreur(429, "TROP_DE_TENTATIVES", "Trop de tentatives."),
    );
    await expect(connecterSuperAdmin("root@mp.ci", "Phrase-Longue-2026")).rejects.toMatchObject({
      code: "TROP_DE_TENTATIVES",
      statut: 429,
    });
    expect(assignSimule).not.toHaveBeenCalled();
  });
});

describe("deconnecterSuperAdmin", () => {
  it("POST /api/plateforme/deconnexion sans corps ni Content-Type", async () => {
    fetchSimule.mockResolvedValueOnce(reponse(204));
    await expect(deconnecterSuperAdmin()).resolves.toBeUndefined();
    const a = appel();
    expect(a.url).toBe("/api/plateforme/deconnexion");
    expect(a.methode).toBe("POST");
    expect(a.init.body).toBeUndefined();
    expect(a.entetes).toEqual({ Accept: "application/json" });
  });
});

describe("creerCabinet", () => {
  const saisie: SaisieCabinet = {
    nom: "  Cabinet Alliance  ",
    pays: "CI",
    associeNom: " Awa Koné ",
    associeEmail: " awa@exemple.ci ",
    associeMotDePasse: "",
  };

  it("POST /api/plateforme/cabinets, sans motDePasse quand il est vide, saisies rognées", async () => {
    fetchSimule.mockResolvedValueOnce(
      reponse(201, {
        cabinet: cabinetValide,
        associe: utilisateurValide,
        motDePasseGenere: "Genere-42-Abc",
      }),
    );
    await creerCabinet(saisie);
    const a = appel();
    expect(a.url).toBe("/api/plateforme/cabinets");
    expect(a.methode).toBe("POST");
    expect(a.corps).toStrictEqual({
      nom: "Cabinet Alliance",
      pays: "CI",
      associe: { nom: "Awa Koné", email: "awa@exemple.ci" },
    });
    expect(a.entetes).toEqual({ Accept: "application/json", "Content-Type": "application/json" });
  });

  it("envoie le motDePasse fourni", async () => {
    fetchSimule.mockResolvedValueOnce(
      reponse(201, { cabinet: cabinetValide, associe: utilisateurValide, motDePasseGenere: null }),
    );
    await creerCabinet({ ...saisie, associeMotDePasse: "Phrase-Longue-2026" });
    expect(appel().corps).toStrictEqual({
      nom: "Cabinet Alliance",
      pays: "CI",
      associe: { nom: "Awa Koné", email: "awa@exemple.ci", motDePasse: "Phrase-Longue-2026" },
    });
  });

  it("lit la création d'une réponse valide (mot de passe généré)", async () => {
    fetchSimule.mockResolvedValueOnce(
      reponse(201, {
        cabinet: cabinetValide,
        associe: utilisateurValide,
        motDePasseGenere: "Genere-42-Abc",
      }),
    );
    const creation = await creerCabinet(saisie);
    expect(creation.cabinet.id).toBe("cab-1");
    expect(creation.associe.email).toBe("awa@exemple.ci");
    expect(creation.motDePasseGenere).toBe("Genere-42-Abc");
  });

  it("réponse mal formée (associé absent) → ReponseInattendue", async () => {
    fetchSimule.mockResolvedValueOnce(
      reponse(201, { cabinet: cabinetValide, motDePasseGenere: null }),
    );
    await expect(creerCabinet(saisie)).rejects.toBeInstanceOf(ReponseInattendue);
  });

  it("réponse 201 mal formée : le message dit que le cabinet a peut-être été créé", async () => {
    fetchSimule.mockResolvedValueOnce(reponse(201, {}));
    const resultat = creerCabinet(saisie);
    await expect(resultat).rejects.toThrow(/a peut-être été créé/);
    await expect(resultat).rejects.toThrow(/Rechargez la liste/);
  });

  it("401 hors connexion : redirection vers la connexion de la console, puis erreur", async () => {
    fetchSimule.mockResolvedValueOnce(reponseErreur(401, "NON_AUTHENTIFIE", "Session expirée."));
    await expect(creerCabinet(saisie)).rejects.toMatchObject({
      statut: 401,
      code: "NON_AUTHENTIFIE",
    });
    expect(assignSimule).toHaveBeenCalledTimes(1);
    expect(assignSimule).toHaveBeenCalledWith("/plateforme/connexion");
  });

  it("409 : ErreurApi avec son code, sans redirection", async () => {
    fetchSimule.mockResolvedValueOnce(
      reponseErreur(409, "EMAIL_DEJA_UTILISE", "Cette adresse e-mail est déjà utilisée."),
    );
    await expect(creerCabinet(saisie)).rejects.toMatchObject({
      code: "EMAIL_DEJA_UTILISE",
      statut: 409,
    });
    expect(assignSimule).not.toHaveBeenCalled();
  });

  it("429 : ErreurApi avec son code, sans redirection", async () => {
    fetchSimule.mockResolvedValueOnce(
      reponseErreur(429, "TROP_DE_TENTATIVES", "Trop de tentatives."),
    );
    await expect(creerCabinet(saisie)).rejects.toMatchObject({
      code: "TROP_DE_TENTATIVES",
      statut: 429,
    });
    expect(assignSimule).not.toHaveBeenCalled();
  });
});

describe("changerEtatCabinet", () => {
  it("PATCH /api/plateforme/cabinets/:id avec le corps {actif} exact", async () => {
    fetchSimule.mockResolvedValueOnce(reponse(200, { cabinet: { ...cabinetValide, actif: true } }));
    const cabinet = await changerEtatCabinet("cab-1", true);
    const a = appel();
    expect(a.url).toBe("/api/plateforme/cabinets/cab-1");
    expect(a.methode).toBe("PATCH");
    expect(a.corps).toStrictEqual({ actif: true });
    expect(cabinet.actif).toBe(true);
  });

  it("désactivation : corps {actif: false}", async () => {
    fetchSimule.mockResolvedValueOnce(reponse(200, { cabinet: cabinetValide }));
    await changerEtatCabinet("cab-1", false);
    expect(appel().corps).toStrictEqual({ actif: false });
  });

  it("réponse mal formée → ReponseInattendue", async () => {
    fetchSimule.mockResolvedValueOnce(reponse(200, {}));
    await expect(changerEtatCabinet("cab-1", false)).rejects.toBeInstanceOf(ReponseInattendue);
  });

  it("409 DERNIER_ASSOCIE : ErreurApi avec son code, sans redirection", async () => {
    fetchSimule.mockResolvedValueOnce(reponseErreur(409, "DERNIER_ASSOCIE", "Dernier associé."));
    await expect(changerEtatCabinet("cab-1", false)).rejects.toMatchObject({
      code: "DERNIER_ASSOCIE",
      statut: 409,
    });
    expect(assignSimule).not.toHaveBeenCalled();
  });

  it("401 hors connexion : redirection vers la connexion de la console", async () => {
    fetchSimule.mockResolvedValueOnce(reponseErreur(401, "NON_AUTHENTIFIE", "Session expirée."));
    await expect(changerEtatCabinet("cab-1", false)).rejects.toMatchObject({ statut: 401 });
    expect(assignSimule).toHaveBeenCalledWith("/plateforme/connexion");
  });
});

describe("creerUtilisateur", () => {
  const saisie: SaisieUtilisateur = {
    nom: " Koffi Yao ",
    email: " koffi@exemple.ci ",
    roles: ["consultant", "gestionnaire"],
    motDePasse: "",
  };

  it("POST /api/plateforme/cabinets/:id/utilisateurs, sans motDePasse vide, saisies rognées", async () => {
    fetchSimule.mockResolvedValueOnce(
      reponse(201, {
        utilisateur: { ...utilisateurValide, roles: ["consultant"] },
        motDePasseGenere: null,
      }),
    );
    await creerUtilisateur("cab-1", saisie);
    const a = appel();
    expect(a.url).toBe("/api/plateforme/cabinets/cab-1/utilisateurs");
    expect(a.methode).toBe("POST");
    expect(a.corps).toStrictEqual({
      nom: "Koffi Yao",
      email: "koffi@exemple.ci",
      roles: ["consultant", "gestionnaire"],
    });
  });

  it("envoie le motDePasse fourni", async () => {
    fetchSimule.mockResolvedValueOnce(
      reponse(201, { utilisateur: utilisateurValide, motDePasseGenere: null }),
    );
    await creerUtilisateur("cab-1", { ...saisie, motDePasse: "Phrase-Longue-2026" });
    expect(appel().corps).toMatchObject({ motDePasse: "Phrase-Longue-2026" });
  });

  it("lit l'utilisateur créé et le mot de passe généré", async () => {
    fetchSimule.mockResolvedValueOnce(
      reponse(201, { utilisateur: utilisateurValide, motDePasseGenere: "Genere-42-Abc" }),
    );
    const creation = await creerUtilisateur("cab-1", saisie);
    expect(creation.utilisateur.id).toBe("usr-1");
    expect(creation.motDePasseGenere).toBe("Genere-42-Abc");
  });

  it("réponse mal formée → ReponseInattendue", async () => {
    fetchSimule.mockResolvedValueOnce(reponse(201, { motDePasseGenere: null }));
    await expect(creerUtilisateur("cab-1", saisie)).rejects.toBeInstanceOf(ReponseInattendue);
  });

  it("401 hors connexion : redirection vers la connexion de la console", async () => {
    fetchSimule.mockResolvedValueOnce(reponseErreur(401, "NON_AUTHENTIFIE", "Session expirée."));
    await expect(creerUtilisateur("cab-1", saisie)).rejects.toMatchObject({ statut: 401 });
    expect(assignSimule).toHaveBeenCalledWith("/plateforme/connexion");
  });
});

describe("modifierUtilisateur", () => {
  it("PATCH des rôles seuls : corps exact, sans clé actif", async () => {
    fetchSimule.mockResolvedValueOnce(
      reponse(200, { utilisateur: { ...utilisateurValide, roles: ["consultant"] } }),
    );
    const utilisateur = await modifierUtilisateur("cab-1", "usr-1", { roles: ["consultant"] });
    const a = appel();
    expect(a.url).toBe("/api/plateforme/cabinets/cab-1/utilisateurs/usr-1");
    expect(a.methode).toBe("PATCH");
    expect(a.corps).toStrictEqual({ roles: ["consultant"] });
    expect(utilisateur.roles).toEqual(["consultant"]);
  });

  it("PATCH de l'état seul : corps {actif} exact", async () => {
    fetchSimule.mockResolvedValueOnce(
      reponse(200, { utilisateur: { ...utilisateurValide, actif: false } }),
    );
    await modifierUtilisateur("cab-1", "usr-1", { actif: false });
    expect(appel().corps).toStrictEqual({ actif: false });
  });

  it("réponse mal formée → ReponseInattendue", async () => {
    fetchSimule.mockResolvedValueOnce(reponse(200, { utilisateur: { id: "usr-1" } }));
    await expect(modifierUtilisateur("cab-1", "usr-1", { actif: true })).rejects.toBeInstanceOf(
      ReponseInattendue,
    );
  });

  it("401 hors connexion : redirection vers la connexion de la console", async () => {
    fetchSimule.mockResolvedValueOnce(reponseErreur(401, "NON_AUTHENTIFIE", "Session expirée."));
    await expect(modifierUtilisateur("cab-1", "usr-1", { actif: true })).rejects.toMatchObject({
      statut: 401,
    });
    expect(assignSimule).toHaveBeenCalledWith("/plateforme/connexion");
  });

  it("409 DERNIER_ASSOCIE : ErreurApi avec son code, sans redirection", async () => {
    fetchSimule.mockResolvedValueOnce(reponseErreur(409, "DERNIER_ASSOCIE", "Dernier associé."));
    await expect(modifierUtilisateur("cab-1", "usr-1", { actif: false })).rejects.toMatchObject({
      code: "DERNIER_ASSOCIE",
      statut: 409,
    });
    expect(assignSimule).not.toHaveBeenCalled();
  });
});
