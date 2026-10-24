/*
 * Données pures des paramètres du cabinet « Tenant démo » : activités internes, calendrier et
 * mentions légales de facturation. Tout est fictif (RCCM, compte contribuable, banque, IBAN).
 */

/**
 * Activités internes non facturables (TPS-02) : code technique stable, libellé affiché. Le semis
 * du catalogue crée déjà `formation`, `prospection`, `administration` et `conges` (absence) : on
 * n'ajoute pas d'activité d'absence en double.
 */
export const ACTIVITES_INTERNES: readonly {
  code: string;
  libelle: string;
  est_absence?: boolean;
}[] = [
  { code: "formation_interne", libelle: "Formation interne" },
  { code: "avant_vente", libelle: "Avant-vente et propositions commerciales" },
  { code: "gestion_cabinet", libelle: "Gestion du cabinet" },
  { code: "developpement_methodes", libelle: "Développement des méthodes" },
];

/** Années du calendrier des jours fériés (le cabinet existe depuis 2024). */
export const ANNEES_CALENDRIER: readonly number[] = [2024, 2025, 2026, 2027];

/**
 * Fêtes mobiles musulmanes (non calculées par le moteur), dates APPROXIMATIVES plausibles : la
 * date réelle dépend de l'observation de la lune et du décret annuel.
 */
export const FERIES_MOBILES: readonly { date: string; libelle: string }[] = [
  { date: "2024-04-10", libelle: "Fin du Ramadan (Aïd el-Fitr)" },
  { date: "2024-06-17", libelle: "Tabaski (Aïd el-Kébir)" },
  { date: "2024-09-16", libelle: "Maouloud (Nativité du Prophète)" },
  { date: "2025-03-31", libelle: "Fin du Ramadan (Aïd el-Fitr)" },
  { date: "2025-06-06", libelle: "Tabaski (Aïd el-Kébir)" },
  { date: "2025-09-05", libelle: "Maouloud (Nativité du Prophète)" },
  { date: "2026-03-20", libelle: "Fin du Ramadan (Aïd el-Fitr)" },
  { date: "2026-05-27", libelle: "Tabaski (Aïd el-Kébir)" },
  { date: "2026-08-26", libelle: "Maouloud (Nativité du Prophète)" },
  { date: "2027-03-10", libelle: "Fin du Ramadan (Aïd el-Fitr)" },
  { date: "2027-05-17", libelle: "Tabaski (Aïd el-Kébir)" },
  // Le 15 août tombe sur l'Assomption : la fête est reportée au lendemain.
  { date: "2027-08-16", libelle: "Maouloud (Nativité du Prophète)" },
];

/** Mentions légales de facturation (la raison sociale est le nom du cabinet, voir parametres.ts). */
export const MENTIONS_LEGALES = {
  forme_juridique: "SARL",
  rccm: "CI-ABJ-2024-B-14872",
  compte_contribuable: "2412487Z",
  regime_fiscal: "Régime du réel normal d'imposition",
  adresse: "Cocody Riviera Golf, Abidjan, Côte d'Ivoire",
  telephone: "+225 27 22 00 00 00",
  email: "facturation@tenant-demo.test",
  banque: "Banque Atlantique Démo (fictive)",
  iban: "CI93CI0080123456789012345678",
} as const;
