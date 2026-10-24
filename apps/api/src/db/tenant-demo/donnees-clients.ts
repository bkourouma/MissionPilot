import type { TailleClient } from "@missionpilot/shared";
import type { CleClient } from "./cles.js";

/*
 * Clients du cabinet « Tenant démo » : 12 entreprises FICTIVES (aucune vraie raison sociale),
 * et la date d'entrée en relation qui
 * sert à antidater `clients.cree_le`. RCCM et comptes contribuables sont inventés et uniques.
 * Les taux, participations et faits sont dans donnees-dossiers.ts et donnees-faits.ts.
 */

export type DeviseClient = "XOF" | "XAF" | "EUR" | "USD";

export interface DefClient {
  cle: CleClient;
  raison_sociale: string;
  forme_juridique: string;
  rccm: string;
  compte_contribuable: string;
  secteur: string;
  pays: "CI" | "CM" | "SN" | "BF" | "ML" | "GA" | "FR";
  taille: TailleClient;
  adresse: string;
  /** Devise de facturation du client (sert aux taux négociés). */
  devise: DeviseClient;
  /** Date d'entrée en relation (entre 2024-10-15 et 2026-06-30) : antidate `cree_le`. */
  entree: string;
}

export const CLIENTS: readonly DefClient[] = [
  {
    cle: "sicafe",
    raison_sociale: "Société Ivoirienne de Café et Cacao (SICAFÉ)",
    forme_juridique: "SA",
    rccm: "CI-ABJ-2009-B-14872",
    compte_contribuable: "0912874 K",
    secteur: "Agro-industrie (café-cacao)",
    pays: "CI",
    taille: "grande_entreprise",
    adresse: "Boulevard de la République, Plateau, Abidjan",
    devise: "XOF",
    entree: "2024-10-15",
  },
  {
    cle: "sicafe-transformation",
    raison_sociale: "SICAFÉ Transformation SA",
    forme_juridique: "SA unipersonnelle",
    rccm: "CI-ABJ-2013-B-22914",
    compte_contribuable: "1318450 P",
    secteur: "Transformation du cacao et du café",
    pays: "CI",
    taille: "eti",
    adresse: "Zone industrielle de Vridi, Abidjan",
    devise: "XOF",
    entree: "2025-02-10",
  },
  {
    cle: "sicafe-export",
    raison_sociale: "SICAFÉ Export SARL",
    forme_juridique: "SARL",
    rccm: "CI-ABJ-2015-B-31207",
    compte_contribuable: "1534021 T",
    secteur: "Négoce et exportation de café-cacao",
    pays: "CI",
    taille: "pme",
    adresse: "Rue du Commerce, Cocody Angré, Abidjan",
    devise: "XOF",
    entree: "2025-03-24",
  },
  {
    cle: "brasseries-wouri",
    raison_sociale: "Brasseries du Wouri SA",
    forme_juridique: "SA",
    rccm: "CM-DLA-2002-B-01846",
    compte_contribuable: "M020200184617 N",
    secteur: "Boissons et brasserie",
    pays: "CM",
    taille: "grande_entreprise",
    adresse: "Avenue de la Liberté, Bonanjo, Douala",
    devise: "XAF",
    entree: "2024-11-18",
  },
  {
    cle: "wouri-distribution",
    raison_sociale: "Wouri Distribution SARL",
    forme_juridique: "SARL",
    rccm: "CM-DLA-2011-B-07325",
    compte_contribuable: "M031100732518 Y",
    secteur: "Distribution de boissons",
    pays: "CM",
    taille: "pme",
    adresse: "Rue Joss, Akwa, Douala",
    devise: "XAF",
    entree: "2025-04-07",
  },
  {
    cle: "banque-sahel",
    raison_sociale: "Banque du Sahel Microfinance",
    forme_juridique: "SA",
    rccm: "BF-OUA-2012-B-5608",
    compte_contribuable: "00187342 Z",
    secteur: "Microfinance et banque",
    pays: "BF",
    taille: "pme",
    adresse: "Avenue Kwame Nkrumah, Ouagadougou",
    devise: "XOF",
    entree: "2025-03-03",
  },
  {
    cle: "teranga-logistique",
    raison_sociale: "Teranga Logistique SA",
    forme_juridique: "SA",
    rccm: "SN-DKR-2010-B-9421",
    compte_contribuable: "0042716 2G3",
    secteur: "Transport et logistique",
    pays: "SN",
    taille: "eti",
    adresse: "Rue Félix Faure, Plateau, Dakar",
    devise: "XOF",
    entree: "2025-05-12",
  },
  {
    cle: "baobab-assurances",
    raison_sociale: "Baobab Assurances SA",
    forme_juridique: "SA",
    rccm: "SN-DKR-2007-B-3318",
    compte_contribuable: "0035560 2B7",
    secteur: "Assurance",
    pays: "SN",
    taille: "eti",
    adresse: "Avenue Léopold Sédar Senghor, Plateau, Dakar",
    devise: "XOF",
    entree: "2025-09-15",
  },
  {
    cle: "mboa-solaire",
    raison_sociale: "Mboa Énergie Solaire SARL",
    forme_juridique: "SARL",
    rccm: "CM-YAO-2018-B-02561",
    compte_contribuable: "M071800256102 L",
    secteur: "Énergie solaire",
    pays: "CM",
    taille: "pme",
    adresse: "Quartier Bastos, Yaoundé",
    devise: "XAF",
    entree: "2026-01-19",
  },
  {
    cle: "sahel-coton",
    raison_sociale: "Sahel Coton Mali SA",
    forme_juridique: "Société coopérative à capital variable",
    rccm: "ML-BKO-2005-B-2290",
    compte_contribuable: "084210265 Y",
    secteur: "Filière coton",
    pays: "ML",
    taille: "eti",
    adresse: "ACI 2000, Hamdallaye, Bamako",
    devise: "XOF",
    entree: "2025-11-03",
  },
  {
    cle: "atlantique-retail",
    raison_sociale: "Atlantique Retail Group SAS",
    forme_juridique: "SAS",
    rccm: "FR-RCS-PARIS-2016-B-812 447 091",
    compte_contribuable: "FR 41 812447091",
    secteur: "Distribution",
    pays: "FR",
    taille: "grande_entreprise",
    adresse: "18 rue de la Pépinière, 75008 Paris",
    devise: "EUR",
    entree: "2026-02-09",
  },
  {
    cle: "gabon-offshore",
    raison_sociale: "Gabon Offshore Services SA",
    forme_juridique: "SA",
    rccm: "GA-LBV-2014-B-00731",
    compte_contribuable: "201400731 C",
    secteur: "Services pétroliers offshore",
    pays: "GA",
    taille: "eti",
    adresse: "Boulevard Triomphal, Libreville",
    devise: "USD",
    entree: "2026-06-22",
  },
];
