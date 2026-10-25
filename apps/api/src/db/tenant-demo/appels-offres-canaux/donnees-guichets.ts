import type { Devise, ObjetFinancement, TypeGuichet } from "@missionpilot/shared";

/*
 * Guichets de financement du Tenant démo (services candidats, lot 5).
 *
 * TOUS FICTIFS : aucun organisme, programme ni condition réelle. Les noms sont inventés et chaque
 * description porte la mention « Guichet fictif de démonstration (Tenant démo) ». Les montants et
 * dates sont plausibles mais ne reflètent aucune offre réelle. Le cabinet devra les valider (le
 * schéma pose `a_valider = true` à la création).
 *
 * Vocabulaires : `pays` en codes ISO à deux lettres (comme les clients du Tenant démo), `tailles`
 * repris de TAILLES_CLIENT (tpe, pme, eti, grande_entreprise), `filieres` en libellés courts.
 * Montants en unité entière de la devise (XOF, XAF) ; pour EUR, en euros entiers.
 * Liste vide = pas de restriction sur le critère (voir packages/engines, guichets.ts).
 */

export interface GuichetDemo {
  nom: string;
  type: TypeGuichet;
  pays: string[];
  secteurs: string[];
  filieres: string[];
  tailles: string[];
  objets: ObjetFinancement[];
  devises: Devise[];
  montant_min: number | null;
  montant_max: number | null;
  devise_montant: Devise | null;
  date_limite: string | null;
  description: string;
  actif: boolean;
}

/** Mention commune de toutes les descriptions (aucune source réelle). */
const MENTION = "Guichet fictif de démonstration (Tenant démo) : aucune source réelle, à valider.";

export const GUICHETS_TENANT_DEMO: readonly GuichetDemo[] = [
  {
    nom: "Banque de l'Habitat et de l'Entreprise du Golfe de Guinée (fictive)",
    type: "banque",
    pays: ["CI"],
    secteurs: [],
    filieres: [],
    tailles: ["pme", "eti"],
    objets: ["investissement", "bfr"],
    devises: ["XOF"],
    montant_min: 10_000_000,
    montant_max: 200_000_000,
    devise_montant: "XOF",
    date_limite: null,
    description: `${MENTION} Crédit d'investissement et de fonds de roulement, garanties à négocier.`,
    actif: true,
  },
  {
    nom: "Banque Régionale de Développement des Savanes Occidentales (fictive)",
    type: "bailleur",
    pays: ["CI", "SN", "BF", "ML", "BJ", "TG"],
    secteurs: [],
    filieres: [],
    tailles: ["eti", "grande_entreprise"],
    objets: ["investissement", "croissance", "export"],
    devises: ["XOF"],
    montant_min: 50_000_000,
    montant_max: 1_500_000_000,
    devise_montant: "XOF",
    date_limite: "2027-06-30",
    description: `${MENTION} Financement de projets de croissance et d'exportation dans l'espace UEMOA.`,
    actif: true,
  },
  {
    nom: "Fonds Régional de Garantie des PME d'Afrique de l'Ouest (fictif)",
    type: "autre",
    pays: ["CI", "SN", "BF", "ML", "BJ", "TG"],
    secteurs: [],
    filieres: [],
    tailles: ["tpe", "pme"],
    objets: ["bfr", "investissement", "creation"],
    devises: ["XOF"],
    montant_min: 5_000_000,
    montant_max: 100_000_000,
    devise_montant: "XOF",
    date_limite: null,
    description: `${MENTION} Garantie partielle de crédits bancaires accordés aux petites entreprises.`,
    actif: true,
  },
  {
    nom: "Programme national fictif d'appui à l'entrepreneuriat féminin (Sénégal)",
    type: "programme_public",
    pays: ["SN"],
    secteurs: [],
    filieres: [],
    tailles: ["tpe", "pme"],
    objets: ["creation", "croissance"],
    devises: ["XOF"],
    montant_min: 1_000_000,
    montant_max: 25_000_000,
    devise_montant: "XOF",
    date_limite: "2027-03-31",
    description: `${MENTION} Appui financier et accompagnement pour les entreprises dirigées par des femmes.`,
    actif: true,
  },
  {
    nom: "Programme fictif de soutien à la transformation agricole (Côte d'Ivoire)",
    type: "programme_public",
    pays: ["CI"],
    secteurs: [],
    filieres: ["cacao", "café", "anacarde"],
    tailles: ["pme", "eti"],
    objets: ["investissement", "export"],
    devises: ["XOF"],
    montant_min: 20_000_000,
    montant_max: 300_000_000,
    devise_montant: "XOF",
    date_limite: "2026-12-15",
    description: `${MENTION} Subvention et prêt bonifié pour la transformation de produits agricoles.`,
    actif: true,
  },
  {
    nom: "Facilité fictive de financement du secteur privé africain (bailleur international)",
    type: "bailleur",
    pays: ["CI", "SN", "CM", "GA", "BF"],
    secteurs: [],
    filieres: [],
    tailles: ["pme", "eti"],
    objets: ["investissement", "croissance"],
    devises: ["EUR", "USD"],
    montant_min: 250_000,
    montant_max: 3_000_000,
    devise_montant: "EUR",
    date_limite: "2027-09-30",
    description: `${MENTION} Prêts en devises pour des investissements productifs, montants en euros entiers.`,
    actif: true,
  },
  {
    nom: "Fonds fictif d'investissement en fonds propres pour PME (zone CEMAC)",
    type: "fonds_investissement",
    pays: ["CM", "GA", "CG", "TD"],
    secteurs: [],
    filieres: [],
    tailles: ["pme", "eti"],
    objets: ["croissance", "restructuration"],
    devises: ["XAF"],
    montant_min: 100_000_000,
    montant_max: 800_000_000,
    devise_montant: "XAF",
    date_limite: null,
    description: `${MENTION} Prise de participation minoritaire dans des entreprises en croissance.`,
    actif: true,
  },
  {
    nom: "Banque commerciale fictive du Littoral (Cameroun)",
    type: "banque",
    pays: ["CM"],
    secteurs: [],
    filieres: [],
    tailles: ["pme", "eti", "grande_entreprise"],
    objets: ["bfr", "investissement", "export"],
    devises: ["XAF"],
    montant_min: 15_000_000,
    montant_max: 250_000_000,
    devise_montant: "XAF",
    date_limite: null,
    description: `${MENTION} Lignes de crédit court terme et moyen terme, garanties usuelles.`,
    actif: true,
  },
  {
    nom: "Réseau fictif de microfinance de l'Oubangui (CEMAC)",
    type: "autre",
    pays: ["GA", "CG"],
    secteurs: [],
    filieres: [],
    tailles: ["tpe"],
    objets: ["bfr", "creation"],
    devises: ["XAF"],
    montant_min: 500_000,
    montant_max: 10_000_000,
    devise_montant: "XAF",
    date_limite: null,
    description: `${MENTION} Microcrédits pour les très petites entreprises et le démarrage d'activité.`,
    actif: true,
  },
  {
    nom: "Banque sahélienne fictive, ancienne ligne PME (suspendue)",
    type: "banque",
    pays: ["BF", "ML"],
    secteurs: [],
    filieres: [],
    tailles: ["pme"],
    objets: ["bfr"],
    devises: ["XOF"],
    montant_min: 5_000_000,
    montant_max: 60_000_000,
    devise_montant: "XOF",
    date_limite: null,
    description: `${MENTION} Ligne désactivée pour la démonstration.`,
    actif: false,
  },
  {
    nom: "Programme fictif de soutien aux PME du Tchad (suspendu)",
    type: "programme_public",
    pays: ["TD"],
    secteurs: [],
    filieres: [],
    tailles: ["tpe", "pme"],
    objets: ["creation", "investissement"],
    devises: ["XAF"],
    montant_min: null,
    montant_max: null,
    devise_montant: null,
    date_limite: "2027-01-31",
    description: `${MENTION} Programme désactivé pour la démonstration, sans montant renseigné.`,
    actif: false,
  },
];
