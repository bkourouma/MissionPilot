import type { CleCompte } from "../cles.js";

/*
 * Scénarios des appels d'offres de la banque d'AO du Tenant démo : qui fait quoi et quel jour,
 * de la détection à l'issue. Les chiffres (scores, recommandations) ne sont PAS ici : ils sortent
 * du moteur `evaluerGoNoGo` à partir des entrées ci-dessous. Une marge estimée n'est saisie que
 * par un compte qui a `finance.lire` ET `ao.gerer` (l'associé : le gestionnaire n'a pas `ao.gerer`).
 */

export interface EvalScenario {
  jour: string;
  auteur: CleCompte;
  adequation: number;
  referencesPertinentes: number;
  referencesExigees: number;
  joursDisponibles: number;
  joursRequis: number;
  concurrentsConnus: number;
  concurrentsForts: number;
  /** Marge estimée en points de base (FIN-02) : `null` si l'auteur n'a pas `finance.lire`. */
  margeBp: number | null;
  margeCibleBp: number;
}

export interface ReponseScenario {
  dossierJour: string;
  auteurDossier: CleCompte;
  valideurJour: string;
  valideur: CleCompte;
  depotJour: string;
  deposant: CleCompte;
  motifDepot: string;
}

export interface ScenarioAo {
  cle: string;
  createur: CleCompte;
  responsable: CleCompte;
  creeLe: string;
  evaluations: EvalScenario[];
  decision: {
    jour: string;
    decideur: "associe" | "associe.2";
    choix: "go" | "no_go";
    motif: string;
  };
  /** Absent si l'appel d'offres a été abandonné avant la réponse. */
  reponse: ReponseScenario | null;
  /** Issue finale (gagné ou perdu) ; absente pour l'abandon (no-go) et l'appel en cours. */
  issue: { jour: string; auteur: CleCompte; statut: "gagne" | "perdu"; motif: string } | null;
}

const e = (
  jour: string,
  auteur: CleCompte,
  n: [number, number, number, number, number, number, number],
  margeBp: number | null,
  margeCibleBp = 2500,
): EvalScenario => ({
  jour,
  auteur,
  adequation: n[0],
  referencesPertinentes: n[1],
  referencesExigees: n[2],
  joursDisponibles: n[3],
  joursRequis: n[4],
  concurrentsConnus: n[5],
  concurrentsForts: n[6],
  margeBp,
  margeCibleBp,
});

export const SCENARIOS_AO: readonly ScenarioAo[] = [
  {
    cle: "sicafe-plan",
    createur: "chef.mission",
    responsable: "directeur.mission",
    creeLe: "2024-10-03",
    evaluations: [
      e("2024-10-04", "chef.mission", [82, 3, 3, 90, 110, 4, 1], null),
      e("2024-10-05", "associe", [85, 3, 3, 120, 110, 4, 1], 3100),
    ],
    decision: {
      jour: "2024-10-06",
      decideur: "associe",
      choix: "go",
      motif:
        "Client historique du cabinet, trois références proches, équipe disponible : on répond.",
    },
    reponse: {
      dossierJour: "2024-10-07",
      auteurDossier: "chef.mission",
      valideurJour: "2024-10-08",
      valideur: "directeur.mission",
      depotJour: "2024-10-13",
      deposant: "directeur.mission",
      motifDepot:
        "Offre technique et financière déposée avant la date limite, accusé de réception reçu.",
    },
    issue: {
      jour: "2024-10-25",
      auteur: "associe",
      statut: "gagne",
      motif:
        "Offre retenue (note combinée 88/100). Contrat signé avec le groupe SICAFE ; la mission " +
        "« {mission} » est ouverte.",
    },
  },
  {
    cle: "banque-pme-etude",
    createur: "directeur.mission",
    responsable: "chef.mission.2",
    creeLe: "2025-01-15",
    evaluations: [
      e("2025-01-17", "directeur.mission", [64, 1, 2, 70, 85, 5, 2], null),
      e("2025-01-18", "associe.2", [64, 1, 2, 70, 85, 5, 2], 2200),
    ],
    decision: {
      jour: "2025-01-20",
      decideur: "associe.2",
      choix: "go",
      motif:
        "Marché bancaire sahélien à ouvrir ; peu de références mais l'équipe est prête à se renforcer.",
    },
    reponse: {
      dossierJour: "2025-01-21",
      auteurDossier: "directeur.mission",
      valideurJour: "2025-01-22",
      valideur: "chef.mission.2",
      depotJour: "2025-02-05",
      deposant: "chef.mission.2",
      motifDepot: "Offre déposée au guichet de la banque (récépissé n° 0417).",
    },
    issue: {
      jour: "2025-03-04",
      auteur: "associe.2",
      statut: "perdu",
      motif:
        "Offre classée 3e sur 5 (technique 78/100). Motif de perte : prix supérieur de 18 % au " +
        "lauréat et une seule référence de financement bancaire. Enseignements : s'associer à un " +
        "cabinet sénégalais, chiffrer au plus juste les journées d'enquête de terrain, joindre deux " +
        "références de produits financiers. Retour d'expérience présenté aux associés le 2025-03-11.",
    },
  },
  {
    cle: "mboa-dd",
    createur: "chef.mission",
    responsable: "directeur.mission",
    creeLe: "2025-06-18",
    evaluations: [
      e("2025-06-20", "chef.mission", [78, 2, 2, 60, 60, 3, 1], null),
      e("2025-06-21", "associe", [78, 2, 2, 60, 60, 3, 1], 2800),
    ],
    decision: {
      jour: "2025-06-23",
      decideur: "associe",
      choix: "go",
      motif: "Besoin d'expertise énergie en zone CEMAC ; équipe due diligence disponible en août.",
    },
    reponse: {
      dossierJour: "2025-06-24",
      auteurDossier: "chef.mission",
      valideurJour: "2025-06-25",
      valideur: "directeur.mission",
      depotJour: "2025-07-10",
      deposant: "directeur.mission",
      motifDepot: "Offre transmise par voie électronique au fonds d'investissement avant 12 h.",
    },
    issue: {
      jour: "2025-08-05",
      auteur: "associe",
      statut: "gagne",
      motif:
        "Offre retenue après audition du 28 juillet. La mission « {mission} » est ouverte avec " +
        "l'accord du fonds d'investissement.",
    },
  },
  {
    cle: "retail-abandon",
    createur: "chef.mission.2",
    responsable: "chef.mission.2",
    creeLe: "2025-10-08",
    evaluations: [
      e("2025-10-10", "chef.mission.2", [55, 0, 2, 30, 70, 6, 3], null),
      e("2025-10-22", "associe.2", [55, 0, 2, 30, 70, 6, 3], 600),
    ],
    decision: {
      jour: "2025-10-24",
      decideur: "associe.2",
      choix: "no_go",
      motif:
        "Abandon : équipe saturée jusqu'en décembre, marge estimée très inférieure à la cible, " +
        "trois concurrents forts déjà installés dans la distribution burkinabè.",
    },
    reponse: null,
    issue: null,
  },
  {
    cle: "gouvernance-publique",
    createur: "directeur.mission",
    responsable: "directeur.mission",
    creeLe: "2026-01-14",
    evaluations: [
      e("2026-01-16", "directeur.mission", [70, 2, 3, 80, 100, 4, 2], null),
      e("2026-01-17", "associe", [70, 2, 3, 80, 100, 4, 2], 1900),
    ],
    decision: {
      jour: "2026-01-19",
      decideur: "associe",
      choix: "go",
      motif: "Go avec réserve : première mission pour ce ministère, à tenter pour ouvrir le Gabon.",
    },
    reponse: {
      dossierJour: "2026-01-20",
      auteurDossier: "directeur.mission",
      valideurJour: "2026-01-21",
      valideur: "chef.mission",
      depotJour: "2026-02-12",
      deposant: "directeur.mission",
      motifDepot: "Offre déposée sous pli fermé à la direction générale du budget (reçu daté).",
    },
    issue: {
      jour: "2026-03-10",
      auteur: "associe",
      statut: "perdu",
      motif:
        "Technique 71/100 contre 84 au lauréat. Motif de perte : aucun expert gabonais en " +
        "finances publiques dans l'équipe clé et méthodologie jugée trop générique. Enseignements : " +
        "nommer un expert local dès le dépôt, détailler le diagnostic par processus de programmation, " +
        "demander le débriefing officiel (obtenu le 2026-03-18).",
    },
  },
  {
    cle: "baobab-plan",
    createur: "chef.mission",
    responsable: "directeur.mission",
    creeLe: "2026-03-11",
    evaluations: [
      e("2026-03-13", "directeur.mission", [88, 3, 3, 130, 120, 3, 1], null),
      e("2026-03-14", "associe.2", [88, 3, 3, 130, 120, 3, 1], 3400),
    ],
    decision: {
      jour: "2026-03-16",
      decideur: "associe",
      choix: "go",
      motif: "Cœur de métier (plan stratégique et modèle financier), secteur assurance déjà connu.",
    },
    reponse: {
      dossierJour: "2026-03-17",
      auteurDossier: "chef.mission",
      valideurJour: "2026-03-18",
      valideur: "directeur.mission",
      depotJour: "2026-04-09",
      deposant: "directeur.mission",
      motifDepot: "Offre déposée sur le portail de la compagnie la veille de la clôture.",
    },
    issue: {
      jour: "2026-05-12",
      auteur: "associe",
      statut: "gagne",
      motif:
        "Offre retenue (note combinée 91/100). Lettre d'attribution reçue ; la mission « {mission} » " +
        "est lancée avec la direction générale de Baobab Assurances.",
    },
  },
];
