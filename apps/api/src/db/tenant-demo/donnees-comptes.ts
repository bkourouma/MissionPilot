import type { RoleCabinet, RoleClient } from "@missionpilot/shared";
import type { CleClient, CleComptePortail, CleCompteCabinet } from "./cles.js";

/*
 * Données des comptes du cabinet « Tenant démo » et de son portail client. Noms fictifs
 * (personnes africaines francophones), jamais d'identité réelle. `depuis` = date d'arrivée dans
 * le cabinet (sert à antidater `utilisateurs.cree_le`) : l'équipe fondatrice date d'octobre
 * 2024, les autres comptes arrivent ensuite.
 */

export interface DefCompteCabinet {
  cle: CleCompteCabinet;
  role: RoleCabinet;
  nom: string;
  depuis: string;
}

export const COMPTES_CABINET: readonly DefCompteCabinet[] = [
  { cle: "associe", role: "associe", nom: "Aïssatou Diabaté", depuis: "2024-10-01" },
  { cle: "associe.2", role: "associe", nom: "Cheikh Ndiaye", depuis: "2024-10-01" },
  {
    cle: "directeur.mission",
    role: "directeur_mission",
    nom: "Moussa Sylla",
    depuis: "2024-10-01",
  },
  {
    cle: "directeur.mission.2",
    role: "directeur_mission",
    nom: "Estelle Mballa",
    depuis: "2025-02-03",
  },
  { cle: "chef.mission", role: "chef_mission", nom: "Nadia Ouédraogo", depuis: "2024-10-01" },
  { cle: "chef.mission.2", role: "chef_mission", nom: "Landry Tchoumi", depuis: "2025-03-17" },
  { cle: "consultant", role: "consultant", nom: "Fabrice Gnagne", depuis: "2024-10-01" },
  { cle: "consultant.2", role: "consultant", nom: "Rokhaya Sow", depuis: "2025-01-13" },
  { cle: "consultant.junior", role: "consultant", nom: "Prisca Zadi", depuis: "2025-04-07" },
  { cle: "consultant.junior.2", role: "consultant", nom: "Mamadou Keïta", depuis: "2025-09-01" },
  { cle: "consultant.stagiaire", role: "consultant", nom: "Axelle Ntamack", depuis: "2026-03-02" },
  { cle: "ressources", role: "ressources", nom: "Mariétou Camara", depuis: "2024-10-01" },
  { cle: "ressources.2", role: "ressources", nom: "Yannick Ehui", depuis: "2025-06-02" },
  { cle: "gestionnaire", role: "gestionnaire", nom: "Brice Adjovi", depuis: "2024-10-01" },
  { cle: "gestionnaire.2", role: "gestionnaire", nom: "Salimata Coulibaly", depuis: "2025-05-05" },
  { cle: "expert.metier", role: "expert_metier", nom: "Hamidou Barry", depuis: "2024-11-04" },
  {
    cle: "expert.metier.2",
    role: "expert_metier",
    nom: "Christelle Ebongue",
    depuis: "2025-07-01",
  },
  { cle: "expert.externe", role: "expert_externe", nom: "Olivier Kamga", depuis: "2025-01-06" },
  { cle: "expert.externe.2", role: "expert_externe", nom: "Fanta Traoré", depuis: "2025-10-06" },
];

export interface DefComptePortail {
  cle: CleComptePortail;
  role: RoleClient;
  nom: string;
  /** Fonction dans l'entreprise cliente. */
  fonction: string;
  /** Client auquel le compte est rattaché (`utilisateurs_portail`). */
  client: CleClient;
  depuis: string;
}

export const COMPTES_PORTAIL: readonly DefComptePortail[] = [
  {
    cle: "dirigeant.client",
    role: "client_dirigeant",
    nom: "Désiré Konan",
    fonction: "Directeur général",
    client: "sicafe",
    depuis: "2025-01-20",
  },
  {
    cle: "dirigeant.client.2",
    role: "client_dirigeant",
    nom: "Bintou Sawadogo",
    fonction: "Directrice générale",
    client: "banque-sahel",
    depuis: "2025-06-16",
  },
  {
    cle: "contributeur.client",
    role: "client_contributeur",
    nom: "Estelle Aka",
    fonction: "Directrice administrative et financière",
    client: "sicafe",
    depuis: "2025-01-20",
  },
  {
    cle: "contributeur.client.2",
    role: "client_contributeur",
    nom: "Ibrahima Faye",
    fonction: "Responsable du contrôle de gestion",
    client: "banque-sahel",
    depuis: "2025-06-16",
  },
  {
    cle: "investisseur.client",
    role: "client_investisseur",
    nom: "Thierry Bakayoko",
    fonction: "Représentant de l'actionnaire principal",
    client: "sicafe",
    depuis: "2025-03-10",
  },
  {
    cle: "investisseur.client.2",
    role: "client_investisseur",
    nom: "Léa Dosso",
    fonction: "Chargée d'investissement du fonds partenaire",
    client: "banque-sahel",
    depuis: "2025-09-22",
  },
];
