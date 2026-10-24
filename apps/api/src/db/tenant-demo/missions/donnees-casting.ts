import type { CleClient, CleCollaborateur, CleCompteCabinet } from "../cles.js";

/*
 * Casting des 11 missions du « Tenant démo » : noms EXACTS partagés par tous les lots (les autres
 * phases retrouvent une mission par `missions.intitule`). Données pures.
 *
 * Chaque mission suit le cycle commercial réel : opportunité (créée à `opp`), proposition validée
 * par un associé, acceptée, puis mission ; signature à `signature` (budget initial figé) ; les
 * dates de `debut` et `fin` sont celles du casting. `etat` est le statut visé par cette phase :
 * les missions TERMINÉES s'arrêtent à « à clôturer » (check-list évaluée, satisfaction saisie) ;
 * la clôture elle-même vient en dernier (cloture.ts), après le temps, la facturation et les
 * encaissements des autres phases (une mission clôturée refuse toute écriture).
 */

export type Grade = "associe" | "directeur" | "manager" | "senior" | "junior" | "stagiaire";

export type EtatVise = "terminee" | "en_cours" | "signee" | "proposition";

export interface LigneDebours {
  libelle: string;
  montant: number;
  refacturable: boolean;
}

export interface RevisionBudget {
  /** Phase du découpage qui reçoit la tâche ajoutée (libellé exact). */
  phase: string;
  tache: { libelle: string; jours: Partial<Record<Grade, number>> };
  motif: string;
  /** Date (fictive) de validation par le directeur, utilisée pour l'antidatage. */
  date: string;
}

export interface DefMission {
  cle: string;
  nom: string;
  client: CleClient;
  /** Code du type de mission du catalogue. */
  type: string;
  etat: EtatVise;
  directeur: CleCompteCabinet;
  chef: CleCompteCabinet;
  /** Création de l'opportunité. */
  opp: string;
  /** Date de signature de la lettre de mission (absente : mission non signée). */
  signature?: string;
  debut: string;
  fin: string;
  secteur: string;
  /** Équipe par grade : collaborateurs qui se partagent les jours budgétés de ce grade. */
  equipe: Partial<Record<Grade, CleCollaborateur[]>>;
  /** Grade absent du cabinet à l'époque -> grade qui en assume les jours (avant signature). */
  regrade?: Partial<Record<Grade, Grade>>;
  debours: LigneDebours[];
  sousTraitance?: { libelle: string; montant: number }[];
  revision?: RevisionBudget;
  /** Note de satisfaction de clôture (0 à 10) et commentaire du client, missions terminées. */
  satisfaction?: { note: number; commentaire: string; repondant: string };
}

const DEPL = (m: number): LigneDebours => ({
  libelle: "Déplacements et hébergement",
  montant: m,
  refacturable: true,
});

export const CASTING: readonly DefMission[] = [
  {
    cle: "sicafe-plan",
    nom: "Plan stratégique 2025-2028 — SICAFE",
    client: "sicafe",
    type: "plan_strategique",
    etat: "terminee",
    directeur: "directeur.mission",
    chef: "chef.mission",
    opp: "2024-10-14",
    signature: "2024-10-28",
    debut: "2024-11-04",
    fin: "2025-04-30",
    secteur: "Agro-industrie (café-cacao)",
    equipe: {
      associe: ["associe"],
      manager: ["chef.mission", "expert.metier"],
      senior: ["consultant"],
    },
    regrade: { junior: "senior" },
    debours: [
      DEPL(1_200_000),
      { libelle: "Impression et reliure des plans", montant: 380_000, refacturable: true },
    ],
    satisfaction: {
      note: 9,
      commentaire:
        "Un plan clair, partagé avec le comité de direction et déjà repris dans notre budget 2025.",
      repondant: "Désiré Konan, directeur général",
    },
  },
  {
    cle: "sahel-coton-notation",
    nom: "Notation financière — Sahel Coton",
    client: "sahel-coton",
    type: "notation_financiere",
    etat: "terminee",
    directeur: "directeur.mission.2",
    chef: "chef.mission",
    opp: "2024-12-09",
    signature: "2025-01-27",
    debut: "2025-02-03",
    fin: "2025-06-20",
    secteur: "Filière coton",
    equipe: {
      associe: ["associe.2"],
      manager: ["chef.mission"],
      senior: ["consultant", "consultant.2"],
    },
    regrade: { junior: "senior" },
    debours: [DEPL(950_000)],
    satisfaction: {
      note: 8,
      commentaire:
        "Méthode rigoureuse ; la note a facilité nos discussions avec les banques de la sous-région.",
      repondant: "Responsable financier de Sahel Coton",
    },
  },
  {
    cle: "wouri-redressement",
    nom: "Redressement — Brasseries du Wouri",
    client: "brasseries-wouri",
    type: "redressement",
    etat: "terminee",
    directeur: "directeur.mission",
    chef: "chef.mission",
    opp: "2025-01-20",
    signature: "2025-03-03",
    debut: "2025-03-10",
    fin: "2025-11-14",
    secteur: "Boissons et brasserie",
    equipe: {
      associe: ["associe"],
      directeur: ["directeur.mission"],
      manager: ["chef.mission", "st.juridique"],
      senior: ["consultant", "consultant.2"],
    },
    regrade: { junior: "senior" },
    debours: [DEPL(2_400_000)],
    sousTraitance: [
      { libelle: "Conseil juridique OHADA (cabinet partenaire)", montant: 3_500_000 },
    ],
    satisfaction: {
      note: 9,
      commentaire:
        "L'entreprise a retrouvé une trésorerie positive et un calendrier de remboursement accepté par les banques.",
      repondant: "Directeur général des Brasseries du Wouri",
    },
  },
  {
    cle: "mboa-dd",
    nom: "Due diligence — Mboa Solaire",
    client: "mboa-solaire",
    type: "due_diligence",
    etat: "terminee",
    directeur: "directeur.mission.2",
    chef: "chef.mission.2",
    opp: "2025-06-16",
    signature: "2025-08-25",
    debut: "2025-09-01",
    fin: "2025-12-19",
    secteur: "Énergie solaire",
    equipe: {
      associe: ["associe.2"],
      manager: ["chef.mission.2", "expert.metier"],
      senior: ["consultant.2", "expert.externe", "st.data"],
      junior: ["consultant.junior"],
    },
    debours: [DEPL(1_650_000)],
    sousTraitance: [{ libelle: "Revue juridique et fiscale locale", montant: 2_800_000 }],
    satisfaction: {
      note: 8,
      commentaire:
        "Rapport exploitable par notre comité d'investissement ; les points de vigilance ont été négociés au closing.",
      repondant: "Chargé d'investissement du fonds acquéreur",
    },
  },
  {
    cle: "atlantique-bp",
    nom: "Business plan bancable — Atlantique Retail",
    client: "atlantique-retail",
    type: "business_plan_bancable",
    etat: "terminee",
    directeur: "directeur.mission",
    chef: "chef.mission.2",
    opp: "2025-10-13",
    signature: "2026-01-05",
    debut: "2026-01-12",
    fin: "2026-05-29",
    secteur: "Distribution",
    equipe: {
      associe: ["associe"],
      manager: ["chef.mission.2"],
      senior: ["consultant", "expert.metier.2"],
      junior: ["consultant.junior.2", "junior.temps.partiel"],
    },
    debours: [DEPL(1_100_000)],
    satisfaction: {
      note: 10,
      commentaire: "Dossier bancaire accepté du premier coup par la banque partenaire.",
      repondant: "Directeur financier d'Atlantique Retail",
    },
  },
  {
    cle: "baobab-plan",
    nom: "Plan stratégique 2026-2030 — Baobab Assurances",
    client: "baobab-assurances",
    type: "plan_strategique",
    etat: "en_cours",
    directeur: "directeur.mission.2",
    chef: "chef.mission",
    opp: "2026-03-02",
    signature: "2026-06-01",
    debut: "2026-06-08",
    fin: "2026-12-18",
    secteur: "Assurance",
    equipe: {
      associe: ["associe.2"],
      manager: ["chef.mission"],
      senior: ["consultant.2", "expert.metier.2"],
      junior: ["consultant.junior"],
    },
    debours: [DEPL(1_500_000)],
    revision: {
      phase: "Plan d'actions et modèle financier",
      tache: {
        libelle: "Atelier de déploiement avec les filiales",
        jours: { senior: 3, manager: 2, associe: 1 },
      },
      motif:
        "Demande du client : atelier de déploiement supplémentaire avec les directeurs de filiales.",
      date: "2026-09-21",
    },
  },
  {
    cle: "gabon-redressement",
    nom: "Redressement — Gabon Offshore Services",
    client: "gabon-offshore",
    type: "redressement",
    etat: "en_cours",
    directeur: "directeur.mission",
    chef: "chef.mission.2",
    opp: "2026-04-20",
    signature: "2026-06-29",
    debut: "2026-07-06",
    fin: "2027-01-29",
    secteur: "Services pétroliers offshore",
    equipe: {
      associe: ["associe"],
      directeur: ["directeur.mission"],
      manager: ["chef.mission.2", "expert.metier"],
      senior: ["consultant", "st.data"],
    },
    regrade: { junior: "senior" },
    debours: [DEPL(3_200_000)],
    revision: {
      phase: "Plan de redressement",
      tache: {
        libelle: "Négociation complémentaire avec le pool bancaire",
        jours: { senior: 4, manager: 3, directeur: 2, associe: 1.5 },
      },
      motif:
        "Le pool bancaire a exigé un second tour de négociation sur le rééchelonnement de la dette.",
      date: "2026-09-14",
    },
  },
  {
    cle: "teranga-flash",
    nom: "Diagnostic flash — Teranga Logistique",
    client: "teranga-logistique",
    type: "diagnostic_flash",
    etat: "en_cours",
    directeur: "directeur.mission.2",
    chef: "chef.mission",
    opp: "2026-08-17",
    signature: "2026-09-08",
    debut: "2026-09-14",
    fin: "2026-11-20",
    secteur: "Transport et logistique",
    equipe: {
      manager: ["chef.mission"],
      senior: ["consultant.2"],
      junior: ["consultant.junior"],
    },
    debours: [],
  },
  {
    cle: "banque-sahel-notation",
    nom: "Notation financière — Banque du Sahel (portefeuille PME)",
    client: "banque-sahel",
    type: "notation_financiere",
    etat: "en_cours",
    directeur: "directeur.mission",
    chef: "chef.mission.2",
    opp: "2026-06-22",
    signature: "2026-08-17",
    debut: "2026-08-24",
    fin: "2027-01-29",
    secteur: "Microfinance et banque",
    equipe: {
      associe: ["associe.2"],
      manager: ["chef.mission.2", "expert.metier"],
      senior: ["consultant", "consultant.2"],
      junior: ["consultant.junior.2", "consultant.junior"],
    },
    debours: [DEPL(1_800_000)],
    revision: {
      phase: "Analyse et scoring",
      tache: {
        libelle: "Extension à quinze PME supplémentaires du portefeuille",
        jours: { junior: 6, senior: 5, manager: 2 },
      },
      motif: "La banque étend le périmètre du portefeuille noté de quinze PME.",
      date: "2026-10-05",
    },
  },
  {
    cle: "sicafe-export-plan",
    nom: "Plan stratégique — Sicafe Export",
    client: "sicafe-export",
    type: "plan_strategique",
    etat: "signee",
    directeur: "directeur.mission.2",
    chef: "chef.mission",
    opp: "2026-08-24",
    signature: "2026-10-05",
    debut: "2026-11-09",
    fin: "2027-04-30",
    secteur: "Négoce et exportation de café-cacao",
    equipe: {
      associe: ["associe"],
      manager: ["chef.mission"],
      senior: ["consultant", "expert.metier.2"],
      junior: ["consultant.junior.2"],
    },
    debours: [DEPL(1_300_000)],
  },
  {
    cle: "wouri-dd",
    nom: "Due diligence — Wouri Distribution",
    client: "wouri-distribution",
    type: "due_diligence",
    etat: "proposition",
    directeur: "directeur.mission",
    chef: "chef.mission.2",
    opp: "2026-09-28",
    debut: "2026-11-30",
    fin: "2027-02-26",
    secteur: "Distribution de boissons",
    equipe: {},
    debours: [],
  },
];

/** Utilisateurs ajoutés à la main à l'équipe d'une mission non encore affectée (en préparation). */
export const EQUIPE_PREPARATION: Record<string, CleCompteCabinet[]> = {
  "wouri-dd": ["associe.2", "expert.metier", "consultant.2"],
};
