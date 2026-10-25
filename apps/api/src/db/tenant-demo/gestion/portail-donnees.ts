import type { CleClient } from "../cles.js";

/*
 * Comptes du portail client ajoutés par la phase `gestion`, en plus de ceux du socle. AUCUN compte actif n'est ajouté
 * (les comptes du socle et des autres lots sont réutilisés ; au plus 2 comptes sont créés ailleurs, pour la salle de mission) (la liste de connexion rapide est tronquée à 50 comptes) ; les autres lignes
 * sont des invitations en attente, expirée ou révoquée (aucun compte actif). Chaque dirigeant valide les jalons de SON entreprise ; les invitations
 * en attente, expirée et révoquée montrent le cycle de vie complet. Noms fictifs, adresses en
 * `@tenant-demo.test`. La clé est la partie locale de l'adresse.
 */

export type RolePortail = "client_dirigeant" | "client_contributeur" | "client_investisseur";

export interface DefComptePortail {
  cle: string;
  nom: string;
  role: RolePortail;
  client: CleClient;
  /** Jour de l'invitation (le compte est créé et activé le lendemain). */
  jour: string;
  /** accepte : compte actif ; attente : invitation en cours ; expiree : délai dépassé ; revoquee : annulée. */
  issue: "accepte" | "attente" | "expiree" | "revoquee";
}

export const COMPTES_PORTAIL_AJOUTES: readonly DefComptePortail[] = [
  {
    cle: "investisseur.wouri",
    nom: "Roger Fotso",
    role: "client_investisseur",
    client: "brasseries-wouri",
    jour: "2025-06-02",
    issue: "revoquee",
  },
  {
    cle: "contributeur.teranga",
    nom: "Fatou Mbaye",
    role: "client_contributeur",
    client: "teranga-logistique",
    jour: "2026-09-02",
    issue: "expiree",
  },
  {
    cle: "contributeur.gabon",
    nom: "Judith Nzé",
    role: "client_contributeur",
    client: "gabon-offshore",
    jour: "2026-10-22",
    issue: "attente",
  },
  {
    cle: "investisseur.baobab",
    nom: "Alain Brou",
    role: "client_investisseur",
    client: "baobab-assurances",
    jour: "2026-10-23",
    issue: "attente",
  },
];

/** Commentaires du dirigeant à la validation d'un jalon (alternés, jamais de montant). */
export const COMMENTAIRES_VALIDATION: readonly string[] = [
  "Jalon conforme à nos attentes, merci à l'équipe.",
  "Validé après relecture avec notre direction.",
  "Validé. Nous attendons la prochaine étape.",
  "Travail clair et bien documenté, jalon validé.",
  "Validé sous réserve des remarques transmises lors de la réunion.",
  "Conforme au cahier des charges, validé.",
];
