import type { ContexteTenantDemo } from "../contexte.js";
import { exiger, lire } from "./outils.js";

/*
 * Veille de guichets de financement du cabinet (business plan bancable) et observations
 * d'efficacité de la bibliothèque d'initiatives types. Contenus FICTIFS : aucun organisme réel,
 * aucune source externe (le produit n'invente pas de guichet). Les guichets se gèrent par la
 * session d'un associé (« services_candidats.gerer »), les observations par un associé aussi
 * (« standard.gerer »). Rejouable : guichets retrouvés par nom, observations par (type, commentaire).
 */

const NOTE = "Guichet FICTIF du jeu de données de démonstration : aucune source réelle.";

export const GUICHETS_VEILLE = [
  {
    nom: "Banque Lagune Commerce (fictive) — crédit d'investissement commerce",
    type: "banque",
    pays: ["CI", "SN"],
    secteurs: ["Distribution"],
    filieres: [],
    tailles: ["pme", "eti", "grande_entreprise"],
    objets: ["investissement", "croissance"],
    devises: ["XOF"],
    montant_min: 500_000_000,
    montant_max: 5_000_000_000,
    devise_montant: "XOF",
    date_limite: "2027-03-31",
    description: `Crédit d'investissement à 7 ans pour l'ouverture de points de vente. ${NOTE}`,
    actif: true,
  },
  {
    nom: "Fonds Savane Croissance (fictif) — fonds d'investissement PME",
    type: "fonds_investissement",
    pays: ["CI", "SN", "BF", "ML"],
    secteurs: [],
    filieres: [],
    tailles: ["pme", "eti"],
    objets: ["croissance", "investissement"],
    devises: ["XOF", "EUR"],
    montant_min: 300_000_000,
    montant_max: 3_000_000_000,
    devise_montant: "XOF",
    date_limite: "2026-12-15",
    description: `Prise de participation minoritaire de cinq à sept ans. ${NOTE}`,
    actif: true,
  },
  {
    nom: "Programme d'appui à l'agro-industrie UEMOA (fictif)",
    type: "programme_public",
    pays: ["CI", "SN", "BF", "ML", "BJ", "TG"],
    secteurs: ["Agro-industrie"],
    filieres: ["café", "cacao", "anacarde", "coton"],
    tailles: [],
    objets: ["investissement", "export"],
    devises: ["XOF"],
    montant_min: null,
    montant_max: null,
    devise_montant: null,
    date_limite: null,
    description: `Subvention de 20 à 30 % de l'équipement de transformation. ${NOTE}`,
    actif: true,
  },
  {
    nom: "Facilité Export Afrique centrale (fictive) — bailleur",
    type: "bailleur",
    pays: ["CM", "GA"],
    secteurs: [],
    filieres: [],
    tailles: ["pme"],
    objets: ["export", "bfr"],
    devises: ["XAF", "EUR"],
    montant_min: 50_000_000,
    montant_max: 800_000_000,
    devise_montant: "XAF",
    date_limite: "2027-01-29",
    description: `Préfinancement des commandes à l'export. ${NOTE}`,
    actif: true,
  },
  {
    nom: "Ligne verte énergie PME (fictive) — banque",
    type: "banque",
    pays: ["CM", "CI"],
    secteurs: ["Énergie"],
    filieres: [],
    tailles: ["pme"],
    objets: ["investissement"],
    devises: ["XAF", "XOF"],
    montant_min: 100_000_000,
    montant_max: 1_500_000_000,
    devise_montant: "XOF",
    date_limite: null,
    description: `Ligne dédiée aux énergies renouvelables. ${NOTE}`,
    actif: true,
  },
  {
    nom: "Appel Restructuration 2025 (fictif) — clos",
    type: "programme_public",
    pays: [],
    secteurs: [],
    filieres: [],
    tailles: [],
    objets: ["restructuration"],
    devises: ["XOF"],
    montant_min: null,
    montant_max: null,
    devise_montant: null,
    date_limite: "2025-12-31",
    description: `Appel clos, conservé pour mémoire (désactivé). ${NOTE}`,
    actif: false,
  },
] as const;

export async function semerGuichets(ctx: ContexteTenantDemo): Promise<void> {
  const associe = ctx.session("associe");
  const liste = await associe.get("/api/guichets-financement?limite=200");
  exiger(liste, 200, "guichets de financement");
  const noms = new Set((liste.json().elements as { nom: string }[]).map((g) => g.nom));
  for (const g of GUICHETS_VEILLE) {
    if (noms.has(g.nom)) continue;
    exiger(await associe.post("/api/guichets-financement", g), 201, `guichet « ${g.nom} »`);
  }
}

/** Rapprochement indicatif d'un client avec les guichets (lecture : aucune écriture). */
export async function rapprocherClient(
  ctx: ContexteTenantDemo,
  clientId: string,
  profil: Record<string, unknown>,
): Promise<number> {
  const r = await ctx.session("associe").post("/api/guichets-financement/rapprochement", {
    client_id: clientId,
    profil,
  });
  exiger(r, 200, "rapprochement de guichets");
  return (r.json().resultats as unknown[]).length;
}

interface ObservationType {
  code: string;
  secteur: string;
  taille: "pme" | "eti" | "grande_entreprise";
  pays: string;
  efficacite: number;
  commentaire: string;
}

/** Retours d'expérience de missions antérieures du cabinet (2024-2026), tous fictifs. */
const OBSERVATIONS: readonly ObservationType[] = [
  {
    code: "recouvrement_creances",
    secteur: "Distribution de boissons",
    taille: "pme",
    pays: "CM",
    efficacite: 81,
    commentaire: "Mission de redressement : encours clients ramenés de 74 à 49 jours.",
  },
  {
    code: "recouvrement_creances",
    secteur: "Services pétroliers offshore",
    taille: "eti",
    pays: "GA",
    efficacite: 69,
    commentaire: "Gain limité par les délais de paiement des compagnies pétrolières.",
  },
  {
    code: "recouvrement_creances",
    secteur: "Transport et logistique",
    taille: "eti",
    pays: "SN",
    efficacite: 75,
    commentaire: "Relances automatisées et blocage des livraisons sur impayés.",
  },
  {
    code: "reduction_couts",
    secteur: "Boissons et brasserie",
    taille: "grande_entreprise",
    pays: "CM",
    efficacite: 63,
    commentaire: "Réduction des coûts d'emballage, partiellement compensée par la hausse du verre.",
  },
  {
    code: "reduction_couts",
    secteur: "Distribution",
    taille: "grande_entreprise",
    pays: "FR",
    efficacite: 70,
    commentaire: "Renégociation des contrats de transport.",
  },
  {
    code: "reduction_couts",
    secteur: "Énergie solaire",
    taille: "pme",
    pays: "CM",
    efficacite: 55,
    commentaire: "Économies sur les achats de composants moins importantes qu'attendu.",
  },
  {
    code: "digitalisation_processus",
    secteur: "Transport et logistique",
    taille: "eti",
    pays: "SN",
    efficacite: 77,
    commentaire: "Suivi des tournées numérisé : retards divisés par deux.",
  },
  {
    code: "digitalisation_processus",
    secteur: "Assurance",
    taille: "eti",
    pays: "SN",
    efficacite: 61,
    commentaire: "Adoption lente en agence faute d'accompagnement du changement.",
  },
  {
    code: "digitalisation_processus",
    secteur: "Filière coton",
    taille: "eti",
    pays: "ML",
    efficacite: 66,
    commentaire: "Pesée et paiement des producteurs numérisés sur deux zones.",
  },
  {
    code: "formation_managers",
    secteur: "Agro-industrie (café-cacao)",
    taille: "grande_entreprise",
    pays: "CI",
    efficacite: 72,
    commentaire: "Meilleure rétention des chefs d'équipe sur 12 mois.",
  },
  {
    code: "formation_managers",
    secteur: "Microfinance et banque",
    taille: "pme",
    pays: "BF",
    efficacite: 68,
    commentaire: "Qualité d'instruction des dossiers de crédit en hausse.",
  },
  {
    code: "formation_managers",
    secteur: "Distribution",
    taille: "grande_entreprise",
    pays: "FR",
    efficacite: 64,
    commentaire: "Effet visible surtout sur les magasins de plus de 40 salariés.",
  },
  {
    code: "tableau_de_bord_pilotage",
    secteur: "Boissons et brasserie",
    taille: "grande_entreprise",
    pays: "CM",
    efficacite: 83,
    commentaire: "Tableau de bord hebdomadaire adopté par le comité de direction.",
  },
  {
    code: "tableau_de_bord_pilotage",
    secteur: "Services pétroliers offshore",
    taille: "eti",
    pays: "GA",
    efficacite: 74,
    commentaire: "Pilotage de la trésorerie à treize semaines.",
  },
  {
    code: "tableau_de_bord_pilotage",
    secteur: "Énergie solaire",
    taille: "pme",
    pays: "CM",
    efficacite: 71,
    commentaire: "Suivi des chantiers et des marges par projet.",
  },
  {
    code: "controle_interne",
    secteur: "Microfinance et banque",
    taille: "pme",
    pays: "BF",
    efficacite: 79,
    commentaire: "Séparation des tâches de décaissement mise en place.",
  },
  {
    code: "controle_interne",
    secteur: "Boissons et brasserie",
    taille: "grande_entreprise",
    pays: "CM",
    efficacite: 67,
    commentaire: "Écarts d'inventaire réduits de moitié.",
  },
  {
    code: "controle_interne",
    secteur: "Transport et logistique",
    taille: "eti",
    pays: "SN",
    efficacite: 60,
    commentaire: "Dispositif contourné sur les sites éloignés.",
  },
  {
    code: "developpement_commercial",
    secteur: "Distribution de boissons",
    taille: "pme",
    pays: "CM",
    efficacite: 65,
    commentaire: "Nouveaux points de vente actifs, mais rotation élevée des commerciaux.",
  },
  {
    code: "developpement_commercial",
    secteur: "Énergie solaire",
    taille: "pme",
    pays: "CM",
    efficacite: 73,
    commentaire: "Partenariats avec des institutions de microfinance.",
  },
  {
    code: "developpement_commercial",
    secteur: "Assurance",
    taille: "eti",
    pays: "SN",
    efficacite: 58,
    commentaire: "Résultats décevants sans refonte de l'offre.",
  },
  {
    code: "refonte_organisation",
    secteur: "Services pétroliers offshore",
    taille: "eti",
    pays: "GA",
    efficacite: 62,
    commentaire: "Gain de réactivité, résistances au changement en première année.",
  },
  {
    code: "refonte_organisation",
    secteur: "Boissons et brasserie",
    taille: "grande_entreprise",
    pays: "CM",
    efficacite: 68,
    commentaire: "Organisation par ligne de produits.",
  },
  {
    code: "refonte_organisation",
    secteur: "Microfinance et banque",
    taille: "pme",
    pays: "BF",
    efficacite: 76,
    commentaire: "Séparation de la fonction risque et de la fonction commerciale.",
  },
];

export async function semerObservationsBibliotheque(ctx: ContexteTenantDemo): Promise<void> {
  const associe = ctx.session("associe");
  for (const o of OBSERVATIONS) {
    const [type] = await lire<{ id: string }>(
      ctx,
      "SELECT id FROM initiatives_types WHERE code = $1 AND cabinet_id IS NULL",
      [o.code],
    );
    if (!type) throw new Error(`Initiative type « ${o.code} » absente de la bibliothèque.`);
    const deja = await lire(
      ctx,
      "SELECT 1 FROM initiative_type_observations WHERE initiative_type_id = $1 AND commentaire = $2",
      [type.id, o.commentaire],
    );
    if (deja.length) continue;
    const r = await associe.post(`/api/bibliotheque-initiatives/${type.id}/observations`, {
      secteur: o.secteur,
      taille: o.taille,
      pays: o.pays,
      efficacite: o.efficacite,
      commentaire: o.commentaire,
    });
    exiger(r, 201, `observation « ${o.code} »`);
  }
}
