import type { CleClient } from "./cles.js";
import { FAITS_B } from "./donnees-faits-2.js";
import {
  doc,
  entretien,
  externe,
  f,
  nb,
  observation,
  oui,
  txt,
  xaf,
  xof,
  type DefFait,
} from "./donnees-faits-outils.js";

/*
 * Faits des dossiers client du cabinet « Tenant démo » (DOS-01, DOS-02) : 4 à 6 faits par client,
 * datés (2024 à 2026), sourcés et notés en fiabilité. La plupart sont « confirmés » ; un ou deux
 * par dossier restent « proposés » (à confirmer par un autre membre). Chiffres de démonstration.
 * Les derniers clients sont dans donnees-faits-2.ts.
 */

export type { DefFait };

const FAITS_A: Pick<
  Record<CleClient, readonly DefFait[]>,
  | "sicafe"
  | "sicafe-transformation"
  | "sicafe-export"
  | "brasseries-wouri"
  | "wouri-distribution"
  | "banque-sahel"
> = {
  sicafe: [
    f("profil", "annee_creation", nb(1994), "2024-10-15", doc("Statuts et extrait RCCM"), "A"),
    f("organisation", "effectif_total", nb(1850), "2025-01-31", doc("Bilan social 2024"), "B"),
    f(
      "produits_marches",
      "marche_principal",
      txt("Export de fèves de cacao vers l'Europe et l'Asie"),
      "2024-11-12",
      entretien("Entretien avec la direction générale"),
      "B",
    ),
    f(
      "finances",
      "chiffre_affaires_2025",
      xof(53_200_000_000),
      "2026-02-27",
      doc("États financiers 2025"),
      "A",
    ),
    f(
      "risques",
      "dependance_cours_mondiaux",
      txt("Marge très exposée aux cours du cacao à New York et Londres"),
      "2025-06-10",
      observation("Revue des contrats de couverture"),
      "C",
      "propose",
    ),
    f(
      "parties_prenantes",
      "actionnaire_reference",
      txt("Fonds d'investissement régional (34 % du capital)"),
      "2025-09-02",
      entretien("Entretien avec la direction financière"),
      "B",
    ),
  ],
  "sicafe-transformation": [
    f("profil", "annee_creation", nb(2013), "2025-02-10", doc("Statuts"), "A"),
    f(
      "organisation",
      "sites_production",
      nb(3),
      "2025-03-15",
      observation("Visite des usines de Vridi et de San-Pédro"),
      "A",
    ),
    f(
      "processus",
      "capacite_broyage_tonnes_an",
      nb(120_000),
      "2025-04-02",
      entretien("Entretien avec le directeur technique"),
      "B",
    ),
    f(
      "finances",
      "investissement_ligne_beurre_cacao",
      xof(4_800_000_000),
      "2025-11-20",
      doc("Plan d'investissement 2026"),
      "B",
      "propose",
    ),
    f(
      "risques",
      "arrets_non_planifies",
      txt("Pannes récurrentes de la ligne de torréfaction en saison haute"),
      "2025-08-05",
      observation("Constat sur site"),
      "B",
    ),
  ],
  "sicafe-export": [
    f("profil", "annee_creation", nb(2015), "2025-03-24", doc("Statuts"), "A"),
    f(
      "organisation",
      "effectif_total",
      nb(46),
      "2025-04-30",
      entretien("Entretien avec le gérant"),
      "B",
    ),
    f(
      "produits_marches",
      "volume_exporte_tonnes_2025",
      nb(38_500),
      "2026-01-20",
      doc("Déclarations d'exportation 2025"),
      "A",
    ),
    f(
      "processus",
      "certification_durable",
      oui(true),
      "2025-10-01",
      doc("Certificat de durabilité en cours de validité"),
      "A",
    ),
    f(
      "risques",
      "concentration_acheteurs",
      txt("Trois acheteurs représentent 70 % des ventes"),
      "2026-03-12",
      entretien("Entretien avec la responsable financière"),
      "C",
      "propose",
    ),
  ],
  "brasseries-wouri": [
    f("profil", "annee_creation", nb(1972), "2024-11-18", doc("Historique de l'entreprise"), "A"),
    f(
      "organisation",
      "effectif_total",
      nb(1240),
      "2025-01-31",
      doc("Registre du personnel au 31 décembre 2024"),
      "B",
    ),
    f(
      "produits_marches",
      "part_marche_bieres",
      txt("Environ 38 % du marché camerounais de la bière"),
      "2025-03-20",
      externe("Étude sectorielle Cameroun 2025"),
      "C",
      "propose",
    ),
    f(
      "finances",
      "chiffre_affaires_2025",
      xaf(76_400_000_000),
      "2026-03-05",
      doc("États financiers 2025"),
      "A",
    ),
    f(
      "processus",
      "sites_brassage",
      nb(2),
      "2025-05-14",
      observation("Visite des brasseries de Douala et de Garoua"),
      "A",
    ),
    f(
      "risques",
      "droits_accises",
      txt("Hausse des droits d'accises annoncée pour la loi de finances 2026"),
      "2025-12-02",
      externe("Projet de loi de finances 2026"),
      "B",
    ),
  ],
  "wouri-distribution": [
    f("profil", "annee_creation", nb(2011), "2025-04-07", doc("Statuts"), "A"),
    f(
      "organisation",
      "flotte_camions",
      nb(64),
      "2025-05-19",
      observation("Inventaire de la flotte"),
      "A",
    ),
    f(
      "produits_marches",
      "points_de_vente_servis",
      nb(5400),
      "2025-06-30",
      entretien("Entretien avec la responsable commerciale"),
      "B",
    ),
    f(
      "finances",
      "delai_moyen_paiement_clients",
      nb(47),
      "2025-09-15",
      doc("Balance âgée des clients"),
      "B",
      "propose",
    ),
    f(
      "parties_prenantes",
      "actionnaire_majoritaire",
      txt("Brasseries du Wouri SA (60 %)"),
      "2025-03-01",
      doc("Registre des titres"),
      "A",
    ),
  ],
  "banque-sahel": [
    f(
      "profil",
      "agrement",
      txt("Établissement de microfinance de deuxième catégorie"),
      "2025-03-03",
      doc("Décision d'agrément"),
      "A",
    ),
    f("organisation", "agences", nb(27), "2025-04-18", doc("Liste des agences"), "A"),
    f(
      "produits_marches",
      "clients_actifs",
      nb(86_000),
      "2025-06-30",
      doc("Rapport d'activité du premier semestre 2025"),
      "B",
    ),
    f(
      "finances",
      "encours_credits",
      xof(41_500_000_000),
      "2025-12-31",
      doc("Situation arrêtée au 31 décembre 2025"),
      "B",
    ),
    f(
      "risques",
      "taux_credits_douteux",
      nb(7.4),
      "2026-01-15",
      entretien("Entretien avec la direction des risques"),
      "C",
      "propose",
    ),
    f(
      "parties_prenantes",
      "regulateur",
      txt("Direction de la supervision des systèmes financiers décentralisés"),
      "2025-03-03",
      externe("Registre de l'autorité de supervision"),
      "A",
    ),
  ],
};

export const FAITS: Record<CleClient, readonly DefFait[]> = { ...FAITS_A, ...FAITS_B };
