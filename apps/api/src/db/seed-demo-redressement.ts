import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { ajouterJours } from "@missionpilot/engines";
import { buildApp } from "../app.js";
import type { Config } from "../config.js";
import { createDatabase, type Database } from "./pool.js";
import {
  attendre,
  aujourdhuiISO,
  configDemo,
  emailAbidjan,
  lundi,
  NOM_CABINET_ABIDJAN,
  ouvrirSession,
  type Session,
} from "./seed-demo.js";

/*
 * Service #5 « Redressement » : jeu de données de DÉMONSTRATION pour la recette humaine des
 * écrans (jamais en production). Sous-semis de `seed-demo.ts` (appelé en fin d'exécution après
 * les comptes 2FA, comme `seed-demo-portail.ts` et `seed-demo-2fa.ts`) ; il se lance aussi seul
 * sur une base déjà peuplée par `db:seed-demo` :
 *
 *   pnpm --filter @missionpilot/api db:seed-demo     (base NEUVE, RUNBOOK : le cabinet n'est semé qu'une fois)
 *   cd apps/api && npx tsx src/db/seed-demo-redressement.ts     (base déjà peuplée par db:seed-demo)
 *
 * Tout passe par les vraies routes HTTP du module (app.inject) : aucune insertion SQL, donc les
 * moteurs de calcul produisent eux-mêmes ratios, voyants, scores, trésorerie, covenants et bilan.
 * Aucun appel réseau, aucune clé : la configuration de démonstration n'a pas d'IA activée, et la
 * cartographie des causes est fabriquée par le gabarit déterministe de l'orchestrateur (« brouillon
 * IA » à compléter par un consultant).
 *
 * Client : « Transports Akwaba (fictif) » (déjà créé par `seed-demo.ts`). Deux missions, chacune
 * avec son dossier de redressement :
 *
 *  1. « Redressement Transports Akwaba (fictif) » (secteur services), dossier ACTIF et complet :
 *     - états financiers du dossier client sur deux exercices (N-1 et N-2, acceptés) et
 *       correspondance de postes ; ratios, voyants calculés ;
 *     - questionnaire d'urgence (deux évaluations) et score d'alerte (seuils par défaut du moteur) ;
 *     - trésorerie à 13 semaines (deux versions, deux semaines de réalisé, une semaine de tension) ;
 *     - trois créanciers dont un accord avec échéancier régulier et un paiement ;
 *     - plan d'actions (kanban : à faire, en cours, terminée) avec deux leviers chiffrés par le
 *       moteur, une version de plan VALIDÉE par le directeur de la mission ;
 *     - check-list de départ « services » activée, avec quelques réponses ;
 *     - cartographie des causes racines : demandée par le chef de mission (gabarit, sans IA),
 *       modifiée par la consultante junior, validée par le consultant (jamais par un auteur) ;
 *     - covenants (dernière version) et plan de financement sur trois ans ;
 *     - bilan de clôture au statut BROUILLON (non validé).
 *  2. « Redressement express Transports Akwaba (fictif) » (secteur général), dossier plus petit et
 *     CLOS par le directeur : états du client, urgence, score, trésorerie, puis suivi post-mission
 *     (jalons à 6 et 12 mois, un relevé saisi sur le premier jalon).
 *
 * Comptes : ceux de `PERSONNES` (seed-demo.ts), mot de passe commun `MOT_DE_PASSE_DEMO_ABIDJAN`.
 * Idempotent par refus : si le dossier de démonstration existe déjà, renvoie `null` sans rien
 * écrire. Les noms sont fictifs, les montants en XOF.
 */

export const CLIENT_REDRESSEMENT_DEMO = "Transports Akwaba (fictif)";
export const DOSSIER_ACTIF_DEMO = "Redressement Transports Akwaba (fictif)";
export const DOSSIER_CLOS_DEMO = "Redressement express Transports Akwaba (fictif)";

const M = 1_000_000;

export interface OptionsRedressementDemo {
  /** Adresse d'un compte de `PERSONNES` (par défaut celle du cabinet de démonstration). */
  email?: (cle: string) => string;
  /** Raison sociale du client (par défaut « Transports Akwaba (fictif) »). */
  client?: string;
}

export interface ResumeRedressementDemo {
  actif: {
    missionId: string;
    dossierId: string;
    versionPlanId: string;
    causesId: string;
    bilanId: string;
  };
  clos: { missionId: string; dossierId: string };
}

/* ----- États financiers du client (équilibrés ; postes lus par code) ----- */

type Ligne = { code: string; libelle: string; section: string; montant: number; role?: string };

const l = (
  code: string,
  libelle: string,
  section: string,
  montant: number,
  role?: string,
): Ligne => ({ code, libelle, section, montant, ...(role ? { role } : {}) });

/** Exercice N-1 : chiffre d'affaires 1,2 Md XOF, actif = passif = 800 M. */
function etatRecent(): Ligne[] {
  return [
    l("ST", "Stocks (pièces, carburant)", "actif", 120 * M),
    l("CL", "Créances clients", "actif", 240 * M),
    l("AC", "Autres créances", "actif", 30 * M),
    l("TR", "Trésorerie", "actif", 60 * M),
    l("IM", "Flotte et immobilisations", "actif", 350 * M),
    l("BZ", "Total actif", "actif", 800 * M, "total"),
    l("CP", "Capital et réserves", "passif", 132 * M),
    l("CJ", "Résultat de l'exercice", "passif", 18 * M, "resultat_exercice"),
    l("DF", "Dettes financières", "passif", 200 * M),
    l("DJ", "Fournisseurs", "passif", 180 * M),
    l("DX", "Autres dettes à court terme", "passif", 150 * M),
    l("PR", "Provisions", "passif", 120 * M),
    l("BP", "Total passif", "passif", 800 * M, "total"),
    l("RA", "Coût des ventes", "charges", 780 * M),
    l("RB", "Autres charges d'exploitation", "charges", 324 * M),
    l("XE", "Résultat d'exploitation (poste de synthèse)", "charges", 48 * M),
    l("RF", "Charges financières", "charges", 24 * M),
    l("RI", "Impôts", "charges", 6 * M),
    l("XB", "Chiffre d'affaires", "produits", 1_200 * M),
    l("XI", "Résultat net", "resultat", 18 * M, "resultat_net"),
  ];
}

/** Exercice N-2 : chiffre d'affaires 1 Md XOF, actif = passif = 700 M. */
function etatPrecedent(): Ligne[] {
  return [
    l("ST", "Stocks (pièces, carburant)", "actif", 100 * M),
    l("CL", "Créances clients", "actif", 200 * M),
    l("AC", "Autres créances", "actif", 30 * M),
    l("TR", "Trésorerie", "actif", 50 * M),
    l("IM", "Flotte et immobilisations", "actif", 320 * M),
    l("BZ", "Total actif", "actif", 700 * M, "total"),
    l("CP", "Capital et réserves", "passif", 100 * M),
    l("CJ", "Résultat de l'exercice", "passif", 70 * M, "resultat_exercice"),
    l("DF", "Dettes financières", "passif", 200 * M),
    l("DJ", "Fournisseurs", "passif", 150 * M),
    l("DX", "Autres dettes à court terme", "passif", 100 * M),
    l("PR", "Provisions", "passif", 80 * M),
    l("BP", "Total passif", "passif", 700 * M, "total"),
    l("RA", "Coût des ventes", "charges", 620 * M),
    l("RB", "Autres charges d'exploitation", "charges", 180 * M),
    l("XE", "Résultat d'exploitation (poste de synthèse)", "charges", 100 * M),
    l("RF", "Charges financières", "charges", 24 * M),
    l("RI", "Impôts", "charges", 6 * M),
    l("XB", "Chiffre d'affaires", "produits", 1_000 * M),
    l("XI", "Résultat net", "resultat", 70 * M, "resultat_net"),
  ];
}

const CORRESPONDANCE = {
  stocks: { codes: ["ST"], sans_objet: false },
  creances_clients: { codes: ["CL"], sans_objet: false },
  autres_creances: { codes: ["AC"], sans_objet: false },
  tresorerie_actif: { codes: ["TR"], sans_objet: false },
  capitaux_propres: { codes: ["CP", "CJ"], sans_objet: false },
  dettes_financieres: { codes: ["DF"], sans_objet: false },
  dettes_fournisseurs: { codes: ["DJ"], sans_objet: false },
  dettes_court_terme: { codes: ["DJ", "DX"], sans_objet: false },
  chiffre_affaires: { codes: ["XB"], sans_objet: false },
  cout_ventes: { codes: ["RA"], sans_objet: false },
  resultat_exploitation: { codes: ["XE"], sans_objet: false },
  charges_financieres: { codes: ["RF"], sans_objet: false },
  resultat_net: { codes: ["XI"], sans_objet: false },
};

/* ----- Outils ----- */

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function session(
  app: FastifyInstance,
  email: (cle: string) => string,
  cle: string,
): Promise<Session> {
  const brute = await ouvrirSession(app, email(cle), "");
  const moi = await brute.get("/api/auth/moi");
  attendre(200, moi, `profil ${cle}`);
  return { ...brute, utilisateurId: moi.json().utilisateur.id as string };
}

async function compteExiste(database: Database, email: string): Promise<boolean> {
  return database.withoutTenant(async (c) => {
    const r = await c.query("SELECT 1 FROM trouver_connexion($1)", [email]);
    return (r.rowCount ?? 0) > 0;
  });
}

const urlD = (dossierId: string, suffixe = ""): string =>
  `/api/redressement/dossiers/${dossierId}${suffixe}`;

interface Acteurs {
  associe: Session;
  directeur: Session;
  chef: Session;
  consultant: Session;
  junior: Session;
}

/** Mission du client, dirigée par le directeur et le chef, avec l'équipe donnée. */
async function creerMission(
  a: Acteurs,
  clientId: string,
  intitule: string,
  equipe: Session[],
): Promise<string> {
  const debut = ajouterJours(lundi(aujourdhuiISO()), -28);
  const m = await a.associe.post("/api/missions", {
    intitule,
    client_id: clientId,
    type_mission_id: null,
    directeur_id: a.directeur.utilisateurId,
    chef_id: a.chef.utilisateurId,
    date_debut: debut,
    date_fin: ajouterJours(debut, 7 * 26),
    mode_facturation: "forfait",
    activite: "Conseil en redressement",
    bureau: "Abidjan",
  });
  attendre(201, m, `mission ${intitule}`);
  const id = m.json().id as string;
  for (const membre of equipe) {
    attendre(
      201,
      await a.chef.post(`/api/missions/${id}/equipe`, { utilisateur_id: membre.utilisateurId }),
      "équipe",
    );
  }
  return id;
}

/** Dossier de redressement de la mission, correspondance de postes courante posée. */
async function ouvrirDossier(
  a: Acteurs,
  missionId: string,
  intitule: string,
  secteur: string,
): Promise<string> {
  const d = await a.chef.post(`/api/missions/${missionId}/redressement`, { intitule, secteur });
  attendre(201, d, `dossier ${intitule}`);
  const id = d.json().id as string;
  attendre(
    201,
    await a.chef.post(urlD(id, "/correspondances"), { postes: CORRESPONDANCE }),
    "correspondance",
  );
  return id;
}

async function semerEtats(a: Acteurs, clientId: string): Promise<void> {
  const annee = new Date().getUTCFullYear();
  const exercices: [number, Ligne[]][] = [
    [annee - 1, etatRecent()],
    [annee - 2, etatPrecedent()],
  ];
  for (const [exercice, lignes] of exercices) {
    const r = await a.chef.post(`/api/dossiers/${clientId}/etats-financiers`, {
      exercice,
      date_cloture: `${exercice}-12-31`,
      devise: "XOF",
      source_libelle: `Liasse ${exercice} (fictive)`,
      lignes,
    });
    attendre(201, r, `état financier ${exercice}`);
    if (r.json().statut !== "accepte") {
      throw new Error(`L'état financier ${exercice} n'est pas accepté : ${r.json().statut}`);
    }
  }
}

/** Deux évaluations d'urgence (la seconde allège la première) et deux scores d'alerte. */
async function semerDiagnostic(a: Acteurs, dossierId: string): Promise<void> {
  for (const reponses of [
    { T1: "oui", T2: "oui", T3: "oui" },
    { T1: "non", T2: "partiellement", T3: "non" },
  ]) {
    attendre(201, await a.chef.post(urlD(dossierId, "/urgences"), { reponses }), "urgence");
  }
  const incidents = (rejets: number, retards: number, arrieres: boolean) => ({
    incidents: {
      rejets_bancaires_12m: rejets,
      retards_fournisseurs_90j: retards,
      arrieres_fiscaux_sociaux: arrieres,
    },
  });
  for (const corps of [incidents(3, 8, true), incidents(1, 2, false)]) {
    attendre(201, await a.chef.post(urlD(dossierId, "/scores"), corps), "score d'alerte");
  }
}

const ligneTreso = (semaine: number, sens: string, categorie: string, montant: number) => ({
  semaine,
  sens,
  categorie,
  montant,
});

/**
 * Trésorerie à 13 semaines à partir du lundi d'il y a deux semaines : solde initial 50 M, seuil de
 * tension 10 M, tension en semaine 2 (solde 5 M) ; deux versions, deux semaines de réalisé.
 */
async function semerTresorerie(a: Acteurs, dossierId: string, complet: boolean): Promise<void> {
  const debut = ajouterJours(lundi(aujourdhuiISO()), -14);
  const lignes = [
    ligneTreso(1, "encaissement", "clients", 30 * M),
    ligneTreso(1, "decaissement", "fournisseurs", 40 * M),
    ligneTreso(1, "decaissement", "salaires", 25 * M),
    ligneTreso(2, "encaissement", "clients", 20 * M),
    ligneTreso(2, "decaissement", "fournisseurs", 30 * M),
    ligneTreso(3, "encaissement", "clients", 15 * M),
    ligneTreso(3, "decaissement", "fournisseurs", 35 * M),
    ligneTreso(4, "encaissement", "clients", 90 * M),
    ligneTreso(13, "decaissement", "salaires", 5 * M),
  ];
  const version = (extra: Record<string, unknown>) => ({
    date_debut: debut,
    solde_initial: 50 * M,
    seuil_tension: 10 * M,
    lignes,
    ...extra,
  });
  attendre(
    201,
    await a.chef.post(
      urlD(dossierId, "/tresorerie/versions"),
      version({ motif: "Prévision initiale" }),
    ),
    "trésorerie v1",
  );
  if (!complet) return;
  attendre(
    201,
    await a.chef.post(
      urlD(dossierId, "/tresorerie/versions"),
      version({
        lignes: [...lignes, ligneTreso(5, "encaissement", "clients", 200 * M)],
        motif: "Révision après l'accord avec la banque",
      }),
    ),
    "trésorerie v2",
  );
  const realises = [
    { semaine_debut: debut, clients: 28 * M, fournisseurs: 41 * M, salaires: 25 * M },
    { semaine_debut: ajouterJours(debut, 7), clients: 18 * M, fournisseurs: 33 * M, salaires: 0 },
  ];
  for (const r of realises) {
    attendre(
      201,
      await a.chef.post(urlD(dossierId, "/tresorerie/realises"), {
        semaine_debut: r.semaine_debut,
        flux: {
          encaissement: { clients: r.clients },
          decaissement: {
            fournisseurs: r.fournisseurs,
            ...(r.salaires > 0 ? { salaires: r.salaires } : {}),
          },
        },
      }),
      "réalisé",
    );
  }
}

/** Trois créanciers ; un accord à échéancier régulier (3 mensualités) et un paiement (la 1re). */
async function semerCreanciers(a: Acteurs, dossierId: string): Promise<void> {
  const auj = aujourdhuiISO();
  const creer = async (corps: Record<string, unknown>): Promise<Json> => {
    const r = await a.chef.post(urlD(dossierId, "/creanciers"), {
      date_arrete: auj,
      interets: 0,
      ...corps,
    });
    attendre(201, r, `créancier ${String(corps.nom)}`);
    return r.json();
  };
  const banque = await creer({
    nom: "Banque Atlantique Lagune (fictive)",
    categorie: "banque",
    principal: 90 * M,
    interets: 10 * M,
  });
  await creer({
    nom: "Garage Plateau Équipements (fictif)",
    categorie: "fournisseur",
    principal: 35 * M,
  });
  await creer({
    nom: "Administration fiscale (fictive)",
    categorie: "fiscal",
    principal: 18 * M,
  });
  const accord = await a.chef.post(`/api/redressement/creanciers/${banque.id}/evenements`, {
    type: "accord",
    date_evenement: auj,
    montant: 60 * M,
    conditions: "Remise partielle des intérêts et étalement sur trois mensualités.",
    echeancier: {
      mode: "regulier",
      nombre_echeances: 3,
      date_premiere: ajouterJours(auj, 30),
      periodicite_mois: 1,
    },
  });
  attendre(201, accord, "accord");
  attendre(
    201,
    await a.chef.post(`/api/redressement/creanciers/${banque.id}/evenements`, {
      type: "paiement",
      date_evenement: auj,
      montant: 20 * M,
      accord_id: accord.json().accord_en_vigueur.id,
      echeance_rang: 1,
    }),
    "paiement",
  );
}

/** Plan : quatre actions (kanban), deux leviers, version validée par le directeur de la mission. */
async function semerPlan(a: Acteurs, dossierId: string): Promise<string> {
  const auj = aujourdhuiISO();
  const creer = async (extra: Record<string, unknown>): Promise<Json> => {
    const r = await a.chef.post(urlD(dossierId, "/actions"), {
      titre: "Relancer les clients en retard",
      volet: "quick_win",
      domaine: "tresorerie",
      echeance: ajouterJours(auj, 30),
      responsable_id: a.directeur.utilisateurId,
      ...extra,
    });
    attendre(201, r, "action");
    return r.json();
  };
  const levierClients = await creer({
    titre: "Réduire le délai de paiement des clients",
    levier: { code: "reduction_delai_clients", parametres: { joursGagnes: 10 } },
  });
  const fournisseurs = await creer({
    titre: "Renégocier les délais avec les fournisseurs",
    domaine: "financement",
  });
  await creer({
    titre: "Réduire les charges fixes",
    volet: "restructuration",
    domaine: "exploitation",
    echeance: ajouterJours(auj, 300),
    levier: {
      code: "reduction_charges_fixes",
      parametres: { chargesFixesAnnuelles: 300 * M, reductionPb: 1000, moisMiseEnOeuvre: 3 },
    },
  });
  await creer({
    titre: "Mettre en place un suivi hebdomadaire de la trésorerie",
    domaine: "tresorerie",
    echeance: ajouterJours(auj, 14),
  });
  const version = await a.chef.post(urlD(dossierId, "/plan/versions"), {});
  attendre(201, version, "version de plan");
  const versionId = version.json().id as string;
  attendre(
    200,
    await a.directeur.post(`/api/redressement/plan/versions/${versionId}/validation`, {}),
    "validation du plan par le directeur",
  );
  attendre(
    200,
    await a.chef.post(`/api/redressement/actions/${levierClients.id}/deplacement`, {
      statut: "terminee",
      termine_le: ajouterJours(auj, -1),
    }),
    "action terminée",
  );
  attendre(
    200,
    await a.chef.post(`/api/redressement/actions/${fournisseurs.id}/deplacement`, {
      statut: "en_cours",
    }),
    "action en cours",
  );
  return versionId;
}

/** Check-list de départ « services » activée, avec quelques réponses. */
async function semerChecklist(a: Acteurs, dossierId: string): Promise<void> {
  const c = await a.chef.post(urlD(dossierId, "/checklists"), {
    origine: "depart",
    code: "depart_services",
  });
  attendre(201, c, "check-list");
  attendre(
    201,
    await a.chef.post(`/api/redressement/checklists/${c.json().id}/reponses`, {
      reponses: [
        { item_id: "srv_tre_01", reponse: "non", commentaire: "Prévisionnel à reconstruire." },
        { item_id: "srv_tre_02", reponse: "partiel" },
        { item_id: "srv_act_01", reponse: "oui" },
        { item_id: "srv_act_02", reponse: "partiel", commentaire: "Deux clients font 45 %." },
        { item_id: "srv_soc_01", reponse: "oui" },
      ],
    }),
    "réponses de la check-list",
  );
}

/**
 * Causes racines sans IA : le chef de mission demande une proposition (gabarit déterministe, IA
 * désactivée), la consultante junior la retouche, le consultant la valide (il n'en est ni le
 * demandeur ni l'auteur d'un rang).
 */
async function semerCauses(a: Acteurs, dossierId: string): Promise<string> {
  const g = await a.chef.post(urlD(dossierId, "/causes/generation"), {});
  attendre(201, g, "causes racines");
  const vue = g.json() as Json;
  if (vue.gabarit !== true) {
    throw new Error("La cartographie de démonstration devait venir du gabarit (IA désactivée).");
  }
  const causes = (vue.causes as Json[]).map((c) => ({
    id: c.id,
    domaine: c.domaine,
    libelle: c.libelle,
    description: c.description,
    confiance: c.confiance ?? null,
  }));
  const [premiere, ...suite] = causes;
  if (!premiere) throw new Error("Cartographie de causes vide.");
  attendre(
    200,
    await a.junior.patch(`/api/redressement/causes/${vue.id}`, {
      causes: [
        {
          ...premiere,
          description:
            "Les clients règlent en moyenne bien après l'échéance, et le suivi des factures émises est partiel (constat de la consultante, à confirmer sur la balance âgée).",
        },
        ...suite,
      ],
    }),
    "causes modifiées",
  );
  attendre(
    200,
    await a.consultant.post(`/api/redressement/causes/${vue.id}/validation`, {}),
    "causes validées",
  );
  return vue.id as string;
}

/** Covenants (associé) puis plan de financement sur trois ans (chef). */
async function semerFinancement(a: Acteurs, dossierId: string): Promise<void> {
  const covenant = (extra: Record<string, unknown>) => ({
    ratio: "liquidite_generale",
    operateur: "min",
    seuil_pb: 13_636,
    frequence: "annuelle",
    ...extra,
  });
  attendre(
    201,
    await a.associe.post(urlD(dossierId, "/covenants/versions"), {
      covenants: [
        covenant({ preteur: "Banque Atlantique Lagune (fictive)" }),
        covenant({
          ratio: "endettement",
          operateur: "max",
          seuil_pb: 12_000,
          frequence: "semestrielle",
        }),
        covenant({
          ratio: "couverture_charges_financieres",
          seuil_pb: 15_000,
          frequence: "trimestrielle",
        }),
        covenant({ ratio: "autonomie_financiere", seuil_pb: 2_000 }),
      ],
      motif: "Contrat de prêt (fictif)",
    }),
    "covenants",
  );
  const ligne = (
    periode: number,
    sens: "emploi" | "ressource",
    nature: string,
    montant: number,
    extra: Record<string, unknown> = {},
  ) => ({ periode, sens, nature, montant, ...extra });
  attendre(
    201,
    await a.chef.post(urlD(dossierId, "/financement/versions"), {
      date_debut: `${new Date().getUTCFullYear()}-01-01`,
      type_periode: "annee",
      nombre_periodes: 3,
      lignes: [
        ligne(1, "emploi", "remboursement_dettes_accords", 100 * M),
        ligne(1, "emploi", "besoin_fonds_roulement", 50 * M, { libelle: "Reconstitution du BFR" }),
        ligne(1, "ressource", "apport_associes", 120 * M),
        ligne(2, "emploi", "investissements", 80 * M),
        ligne(2, "ressource", "nouveaux_concours_bancaires", 30 * M),
        ligne(2, "ressource", "autofinancement", 10 * M),
        ligne(3, "ressource", "cessions_actifs", 60 * M),
      ],
      motif: "Plan de financement initial",
    }),
    "plan de financement",
  );
}

/* ----- Point d'entrée ----- */

/**
 * Sème le redressement de démonstration ; `null` si le dossier de démonstration existe déjà (rien
 * n'est écrit). Exige le cabinet de démonstration et le client « Transports Akwaba (fictif) ».
 */
export async function semerRedressementDemo(
  database: Database,
  config: Config,
  options: OptionsRedressementDemo = {},
): Promise<ResumeRedressementDemo | null> {
  const email = options.email ?? emailAbidjan;
  const nomClient = options.client ?? CLIENT_REDRESSEMENT_DEMO;
  if (!(await compteExiste(database, email("associe")))) {
    throw new Error(
      `Le cabinet « ${NOM_CABINET_ABIDJAN} » n'existe pas dans cette base : lancer d'abord db:seed-demo.`,
    );
  }
  // NODE_ENV=test : application muette (aucun transport de messages, aucun journal HTTP).
  const app = await buildApp({ ...config, NODE_ENV: "test", TOTP_REQUIS: "non" }, database);
  try {
    const a: Acteurs = {
      associe: await session(app, email, "associe"),
      directeur: await session(app, email, "directeur.mission"),
      chef: await session(app, email, "chef.mission"),
      consultant: await session(app, email, "consultant"),
      junior: await session(app, email, "consultant.junior"),
    };
    const clients = await a.associe.get(
      `/api/clients?q=${encodeURIComponent(nomClient)}&limite=10`,
    );
    attendre(200, clients, "clients");
    const client = (clients.json().elements as { id: string; raison_sociale: string }[]).find(
      (c) => c.raison_sociale === nomClient,
    );
    if (!client) throw new Error(`Client « ${nomClient} » introuvable : lancer db:seed-demo.`);
    const deja = await a.associe.get(
      `/api/redressement/dossiers?client_id=${client.id}&limite=100`,
    );
    attendre(200, deja, "dossiers de redressement");
    const existants = deja.json().elements as { intitule: string }[];
    if (existants.some((d) => d.intitule === DOSSIER_ACTIF_DEMO)) return null;

    // 1. Dossier actif et complet (les états du client se lisent par les membres d’une mission du client).
    const missionActive = await creerMission(a, client.id, DOSSIER_ACTIF_DEMO, [
      a.consultant,
      a.junior,
    ]);
    await semerEtats(a, client.id);
    const actif = await ouvrirDossier(a, missionActive, DOSSIER_ACTIF_DEMO, "services");
    await semerDiagnostic(a, actif);
    await semerTresorerie(a, actif, true);
    await semerCreanciers(a, actif);
    const versionPlanId = await semerPlan(a, actif);
    await semerChecklist(a, actif);
    const causesId = await semerCauses(a, actif);
    await semerFinancement(a, actif);
    const bilan = await a.chef.post(urlD(actif, "/clotures"), {});
    attendre(201, bilan, "bilan de clôture (brouillon)");

    // 2. Dossier plus petit, clos, avec son suivi post-mission.
    const missionClose = await creerMission(a, client.id, DOSSIER_CLOS_DEMO, []);
    const clos = await ouvrirDossier(a, missionClose, DOSSIER_CLOS_DEMO, "general");
    await semerDiagnostic(a, clos);
    await semerTresorerie(a, clos, false);
    attendre(
      200,
      await a.directeur.post(urlD(clos, "/statut"), {
        statut: "clos",
        motif: "Objectifs atteints : trésorerie stabilisée.",
      }),
      "clôture du dossier",
    );
    const suivi = await a.chef.post(urlD(clos, "/suivi"), {});
    attendre(201, suivi, "plan de suivi");
    const jalon = (suivi.json().jalons as { id: string }[])[0];
    if (!jalon) throw new Error("Le plan de suivi n'a produit aucun jalon.");
    attendre(
      201,
      await a.chef.post(urlD(clos, "/suivi/releves"), {
        jalon_id: jalon.id,
        date_releve: aujourdhuiISO(),
        source: "saisie",
        ratios: { endettement: 13_333 },
        commentaire: "Relevé de contrôle saisi à la clôture.",
      }),
      "relevé de suivi",
    );

    return {
      actif: {
        missionId: missionActive,
        dossierId: actif,
        versionPlanId,
        causesId,
        bilanId: bilan.json().id as string,
      },
      clos: { missionId: missionClose, dossierId: clos },
    };
  } finally {
    await app.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  let config: Config;
  try {
    config = configDemo();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
  const database = createDatabase(config);
  semerRedressementDemo(database, config)
    .then((r) => {
      if (!r) {
        console.error("Le redressement de démonstration existe déjà : rien n'a été écrit.");
        process.exitCode = 2;
        return;
      }
      console.log(
        `Redressement de démonstration prêt : dossier actif ${r.actif.dossierId}, dossier clos ${r.clos.dossierId}.`,
      );
    })
    .catch((error: Error) => {
      console.error(`Échec du seed du redressement de démonstration : ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => database.close());
}
