import type { Api } from "./api.js";
import type { Contexte } from "./helpers.js";
import {
  creerMission,
  preparerCabinet,
  type ApiUtilisateur,
  type CabinetMissions,
} from "./missions-outils.js";
import { attendre } from "./portail-outils.js";

/*
 * Outils des tests du redressement (service #5, lot 3a) : deux cabinets, une mission par cabinet,
 * des utilisateurs internes aux droits variés, des états financiers du dossier client semés par
 * l'API (cas A de SPEC-3a §6.3) et un dossier de redressement ouvert.
 */

export const INCONNU = "00000000-0000-4000-8000-000000000000";

export interface ScenarioRed {
  a: CabinetMissions;
  b: CabinetMissions;
  missionId: string;
  missionB: string;
  /** Membre de l'équipe de la mission de A : lit et écrit. */
  consultantEquipe: ApiUtilisateur;
  /** Consultant qui n'est pas de l'équipe : mission invisible (404). */
  consultantHors: ApiUtilisateur;
  expert: ApiUtilisateur;
  expert2: ApiUtilisateur;
  gestionnaire: ApiUtilisateur;
  ressources: ApiUtilisateur;
  expertExterne: ApiUtilisateur;
  /** Second associé de A : valideur dispensé, auteur de seuils. */
  associe2: ApiUtilisateur;
}

export async function preparerRed(ctx: Contexte, nom = "Redressement"): Promise<ScenarioRed> {
  const a = await preparerCabinet(ctx, `${nom} A`);
  const b = await preparerCabinet(ctx, `${nom} B`);
  const missionId = (await creerMission(a, { intitule: "Redressement du client A" })).id;
  const missionB = (await creerMission(b, { intitule: "Mission du cabinet B" })).id;
  const consultantEquipe = await a.avecRoles(["consultant"]);
  attendre(
    201,
    await a.chef.post(`/api/missions/${missionId}/equipe`, {
      utilisateur_id: consultantEquipe.utilisateurId,
    }),
    "équipe",
  );
  return {
    a,
    b,
    missionId,
    missionB,
    consultantEquipe,
    consultantHors: await a.avecRoles(["consultant"]),
    expert: await a.avecRoles(["expert_metier"]),
    expert2: await a.avecRoles(["expert_metier"]),
    gestionnaire: await a.avecRoles(["gestionnaire"]),
    ressources: await a.avecRoles(["ressources"]),
    expertExterne: await a.avecRoles(["expert_externe"]),
    associe2: await a.avecRoles(["associe"]),
  };
}

/** Ouvre le dossier de redressement d'une mission (chef de mission par défaut). */
export async function ouvrirDossierRed(
  s: ScenarioRed,
  missionId = s.missionId,
  corps: Record<string, unknown> = {},
  par: Api = s.a.chef,
): Promise<Record<string, unknown> & { id: string }> {
  const r = await par.post(`/api/missions/${missionId}/redressement`, {
    intitule: "Redressement du client",
    ...corps,
  });
  attendre(201, r, "dossier de redressement");
  return r.json();
}

/* ------------------------------------------------------------------------------------------ */
/* États financiers du client (cas A de SPEC-3a §6.3)                                          */
/* ------------------------------------------------------------------------------------------ */

type Ligne = { code: string; libelle: string; section: string; montant: number; role?: string };

const l = (
  code: string,
  libelle: string,
  section: string,
  montant: number,
  role?: string,
): Ligne => ({ code, libelle, section, montant, ...(role ? { role } : {}) });

/**
 * Exercice N, cas A : stocks 120 M, créances clients 240 M, autres créances 30 M, trésorerie 60 M,
 * capitaux propres 150 M (CP 132 + résultat 18), dettes financières 200 M, fournisseurs 180 M,
 * dettes à court terme 330 M (fournisseurs + DX 150 M), CA 1,2 G, coût des ventes 780 M,
 * « résultat d'exploitation » 48 M (ligne XE : le poste se lit par code), charges financières 24 M, résultat net 18 M ; actif = passif = 800 M.
 */
export function lignesCasA(): Ligne[] {
  return [
    l("ST", "Stocks", "actif", 120_000_000),
    l("CL", "Créances clients", "actif", 240_000_000),
    l("AC", "Autres créances", "actif", 30_000_000),
    l("TR", "Trésorerie", "actif", 60_000_000),
    l("IM", "Actif immobilisé", "actif", 350_000_000),
    l("BZ", "Total actif", "actif", 800_000_000, "total"),
    l("CP", "Capital et réserves", "passif", 132_000_000),
    l("CJ", "Résultat de l'exercice", "passif", 18_000_000, "resultat_exercice"),
    l("DF", "Dettes financières", "passif", 200_000_000),
    l("DJ", "Fournisseurs", "passif", 180_000_000),
    l("DX", "Autres dettes à court terme", "passif", 150_000_000),
    l("PR", "Provisions", "passif", 120_000_000),
    l("BP", "Total passif", "passif", 800_000_000, "total"),
    l("RA", "Coût des ventes", "charges", 780_000_000),
    l("RB", "Autres charges d'exploitation", "charges", 324_000_000),
    l(
      "XE",
      "Dotations d'exploitation (valeur du poste « résultat d'exploitation » du cas A)",
      "charges",
      48_000_000,
    ),
    l("RF", "Charges financières", "charges", 24_000_000),
    l("RI", "Impôts", "charges", 6_000_000),
    l("XB", "Chiffre d'affaires", "produits", 1_200_000_000),
    l("XI", "Résultat net", "resultat", 18_000_000, "resultat_net"),
  ];
}

/** Exercice N-1 : CA 1 G, coût des ventes 620 M (marge brute 3800 pb) ; actif = passif = 700 M. */
export function lignesCasAPrecedent(): Ligne[] {
  return [
    l("ST", "Stocks", "actif", 100_000_000),
    l("CL", "Créances clients", "actif", 200_000_000),
    l("AC", "Autres créances", "actif", 30_000_000),
    l("TR", "Trésorerie", "actif", 50_000_000),
    l("IM", "Actif immobilisé", "actif", 320_000_000),
    l("BZ", "Total actif", "actif", 700_000_000, "total"),
    l("CP", "Capital et réserves", "passif", 100_000_000),
    l("CJ", "Résultat de l'exercice", "passif", 70_000_000, "resultat_exercice"),
    l("DF", "Dettes financières", "passif", 200_000_000),
    l("DJ", "Fournisseurs", "passif", 150_000_000),
    l("DX", "Autres dettes à court terme", "passif", 100_000_000),
    l("PR", "Provisions", "passif", 80_000_000),
    l("BP", "Total passif", "passif", 700_000_000, "total"),
    l("RA", "Coût des ventes", "charges", 620_000_000),
    l("RB", "Autres charges d'exploitation", "charges", 180_000_000),
    l("XE", "Dotations d'exploitation (poste « résultat d'exploitation »)", "charges", 100_000_000),
    l("RF", "Charges financières", "charges", 24_000_000),
    l("RI", "Impôts", "charges", 6_000_000),
    l("XB", "Chiffre d'affaires", "produits", 1_000_000_000),
    l("XI", "Résultat net", "resultat", 70_000_000, "resultat_net"),
  ];
}

/** Correspondance de postes du cas A (corps de `POST /redressement/dossiers/:id/correspondances`). */
export const CORRESPONDANCE_CAS_A = {
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

/** Valeurs du cas A rendues par le moteur (points de base ; BFR en jours). */
export const RATIOS_CAS_A = {
  liquidite_generale: 13636,
  liquidite_reduite: 10000,
  liquidite_immediate: 1818,
  autonomie_financiere: 1875,
  solvabilite_generale: 12308,
  endettement: 13333,
  marge_brute: 3500,
  marge_nette: 150,
  couverture_charges_financieres: 20000,
  bfr_jours: 54,
} as const;

/** Sème un état financier du client par l'API ; il est accepté automatiquement s'il est équilibré. */
export async function semerEtat(
  par: Api,
  clientId: string,
  exercice: number,
  lignes: Ligne[] = lignesCasA(),
  devise = "XOF",
): Promise<Record<string, unknown> & { id: string; statut: string }> {
  const r = await par.post(`/api/dossiers/${clientId}/etats-financiers`, {
    exercice,
    date_cloture: `${exercice}-12-31`,
    devise,
    source_libelle: `Liasse ${exercice}`,
    lignes,
  });
  attendre(201, r, `état ${exercice}`);
  return r.json();
}

/** Cas A prêt : états N (2025) et N-1 (2024) acceptés, dossier ouvert, correspondance courante posée. */
export async function preparerCasA(
  s: ScenarioRed,
  missionId = s.missionId,
  clientId = s.a.clientId,
): Promise<{ dossierId: string }> {
  const n = await semerEtat(s.a.chef, clientId, 2025);
  if (n.statut !== "accepte") throw new Error(`L'état du cas A n'est pas accepté : ${n.statut}`);
  const n1 = await semerEtat(s.a.chef, clientId, 2024, lignesCasAPrecedent());
  if (n1.statut !== "accepte") throw new Error(`L'état N-1 n'est pas accepté : ${n1.statut}`);
  const dossier = await ouvrirDossierRed(s, missionId);
  attendre(
    201,
    await s.a.chef.post(`/api/redressement/dossiers/${dossier.id}/correspondances`, {
      postes: CORRESPONDANCE_CAS_A,
    }),
    "correspondance",
  );
  return { dossierId: dossier.id };
}

/** Code d'erreur de domaine d'une réponse d'erreur. */
export const erreur = (r: { json: () => { erreur?: { code?: string } } }) => r.json().erreur?.code;

/** Parcours récursif : toutes les clés d'un objet JSON (FIN-02). */
export function toutesLesCles(v: unknown, cles: Set<string> = new Set()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => toutesLesCles(x, cles));
  else if (v !== null && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      cles.add(k);
      toutesLesCles(x, cles);
    }
  }
  return cles;
}

/** Les 37 routes du module (méthode, chemin avec identifiants factices), pour les tests de fermeture. */
export function routesRedressement(id: {
  dossier: string;
  mission: string;
  creancier: string;
  action: string;
  version: string;
  seuils: string;
}): { methode: "GET" | "POST" | "PATCH"; url: string; corps?: unknown }[] {
  const d = `/api/redressement/dossiers/${id.dossier}`;
  return [
    { methode: "GET", url: "/api/redressement/referentiel" },
    { methode: "GET", url: "/api/redressement/dossiers" },
    { methode: "POST", url: `/api/missions/${id.mission}/redressement`, corps: { intitule: "x" } },
    { methode: "GET", url: `/api/missions/${id.mission}/redressement` },
    { methode: "GET", url: d },
    { methode: "PATCH", url: d, corps: { intitule: "x" } },
    { methode: "POST", url: `${d}/statut`, corps: { statut: "mise_en_oeuvre" } },
    { methode: "GET", url: `${d}/correspondances` },
    { methode: "POST", url: `${d}/correspondances`, corps: {} },
    { methode: "GET", url: `${d}/ratios` },
    { methode: "GET", url: `${d}/urgences` },
    { methode: "POST", url: `${d}/urgences`, corps: {} },
    { methode: "GET", url: "/api/redressement/seuils" },
    { methode: "POST", url: "/api/redressement/seuils", corps: {} },
    { methode: "POST", url: `/api/redressement/seuils/${id.seuils}/publication`, corps: {} },
    { methode: "GET", url: `${d}/scores` },
    { methode: "POST", url: `${d}/scores`, corps: {} },
    { methode: "GET", url: `${d}/tresorerie` },
    { methode: "POST", url: `${d}/tresorerie/versions`, corps: {} },
    { methode: "POST", url: `${d}/tresorerie/realises`, corps: {} },
    { methode: "GET", url: `${d}/tresorerie/echeances-accords` },
    { methode: "POST", url: `${d}/point-mort`, corps: {} },
    { methode: "GET", url: `${d}/creanciers` },
    { methode: "POST", url: `${d}/creanciers`, corps: {} },
    { methode: "GET", url: `/api/redressement/creanciers/${id.creancier}` },
    {
      methode: "PATCH",
      url: `/api/redressement/creanciers/${id.creancier}`,
      corps: { actif: true },
    },
    { methode: "POST", url: `/api/redressement/creanciers/${id.creancier}/creances`, corps: {} },
    { methode: "POST", url: `/api/redressement/creanciers/${id.creancier}/evenements`, corps: {} },
    { methode: "GET", url: `${d}/plan` },
    { methode: "POST", url: `${d}/actions`, corps: {} },
    { methode: "PATCH", url: `/api/redressement/actions/${id.action}`, corps: { titre: "x" } },
    { methode: "POST", url: `/api/redressement/actions/${id.action}/deplacement`, corps: {} },
    { methode: "POST", url: `/api/redressement/actions/${id.action}/commentaires`, corps: {} },
    { methode: "GET", url: `/api/redressement/actions/${id.action}` },
    { methode: "POST", url: `${d}/plan/versions`, corps: {} },
    { methode: "POST", url: `/api/redressement/plan/versions/${id.version}/validation`, corps: {} },
    { methode: "POST", url: `${d}/leviers/simulation`, corps: {} },
  ];
}

export async function appeler(
  par: Api,
  r: { methode: "GET" | "POST" | "PATCH"; url: string; corps?: unknown },
) {
  if (r.methode === "GET") return par.get(r.url);
  if (r.methode === "PATCH") return par.patch(r.url, r.corps ?? {});
  return par.post(r.url, r.corps ?? {});
}
