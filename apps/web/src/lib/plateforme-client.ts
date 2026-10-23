/**
 * Appels navigateur de la console de plateforme (relayés par `/api/*`). Un 401 hors connexion
 * ramène à la connexion de la console (jamais à `/connexion` : la redirection par défaut de
 * `api.ts` est désactivée ici par `redirigerSi401: false`).
 */
import { api, ErreurApi } from "./api";
import {
  corpsCreationCabinet,
  corpsCreationUtilisateur,
  lireCabinetModifie,
  lireCreationCabinet,
  lireCreationUtilisateur,
  lireSuperAdmin,
  lireUtilisateurModifie,
  MESSAGE_CABINET_PEUT_ETRE_CREE,
  MESSAGE_REPONSE_INATTENDUE,
  MESSAGE_UTILISATEUR_PEUT_ETRE_CREE,
  type CabinetPlateforme,
  type CreationCabinet,
  type CreationUtilisateur,
  type SaisieCabinet,
  type SaisieUtilisateur,
  type SuperAdmin,
  type UtilisateurPlateforme,
} from "./plateforme";
import { CHEMIN_CONNEXION_PLATEFORME } from "./plateforme-routes";

const BASE = "/api/plateforme";
const OPTIONS = { redirigerSi401: false } as const;

/** Réponse dont la forme n'est pas celle du contrat. */
export class ReponseInattendue extends Error {
  constructor(message: string = MESSAGE_REPONSE_INATTENDUE) {
    super(message);
    this.name = "ReponseInattendue";
  }
}

function exiger<T>(valeur: T | null, message?: string): T {
  if (valeur === null) throw new ReponseInattendue(message);
  return valeur;
}

/** Session expirée en cours d'usage : retour à la connexion de la console, puis l'erreur remonte. */
async function avecSession<T>(appel: Promise<T>): Promise<T> {
  try {
    return await appel;
  } catch (e) {
    if (e instanceof ErreurApi && e.statut === 401 && typeof window !== "undefined") {
      window.location.assign(CHEMIN_CONNEXION_PLATEFORME);
    }
    throw e;
  }
}

/** Connexion du super admin ; 401 = identifiants invalides (pas de redirection). */
export async function connecterSuperAdmin(email: string, motDePasse: string): Promise<SuperAdmin> {
  const corps = await api.post<unknown>(
    `${BASE}/connexion`,
    { email: email.trim(), motDePasse },
    OPTIONS,
  );
  return exiger(lireSuperAdmin(corps));
}

export async function deconnecterSuperAdmin(): Promise<void> {
  await api.post(`${BASE}/deconnexion`, undefined, OPTIONS);
}

export async function creerCabinet(saisie: SaisieCabinet): Promise<CreationCabinet> {
  const corps = await avecSession(
    api.post<unknown>(`${BASE}/cabinets`, corpsCreationCabinet(saisie), OPTIONS),
  );
  return exiger(lireCreationCabinet(corps), MESSAGE_CABINET_PEUT_ETRE_CREE);
}

export async function changerEtatCabinet(id: string, actif: boolean): Promise<CabinetPlateforme> {
  const corps = await avecSession(api.patch<unknown>(`${BASE}/cabinets/${id}`, { actif }, OPTIONS));
  return exiger(lireCabinetModifie(corps));
}

export async function creerUtilisateur(
  cabinetId: string,
  saisie: SaisieUtilisateur,
): Promise<CreationUtilisateur> {
  const corps = await avecSession(
    api.post<unknown>(
      `${BASE}/cabinets/${cabinetId}/utilisateurs`,
      corpsCreationUtilisateur(saisie),
      OPTIONS,
    ),
  );
  return exiger(lireCreationUtilisateur(corps), MESSAGE_UTILISATEUR_PEUT_ETRE_CREE);
}

export async function modifierUtilisateur(
  cabinetId: string,
  utilisateurId: string,
  modification: { actif?: boolean; roles?: readonly string[] },
): Promise<UtilisateurPlateforme> {
  const corps = await avecSession(
    api.patch<unknown>(
      `${BASE}/cabinets/${cabinetId}/utilisateurs/${utilisateurId}`,
      modification,
      OPTIONS,
    ),
  );
  return exiger(lireUtilisateurModifie(corps));
}
