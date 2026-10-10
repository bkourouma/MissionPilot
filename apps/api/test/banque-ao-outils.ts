/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Api } from "./api.js";
import type { Contexte } from "./helpers.js";
import { preparerCabinet, type ApiUtilisateur, type CabinetMissions } from "./missions-outils.js";
import { attendre } from "./portail-outils.js";

/*
 * Outils des tests du lot AO-B (banques de CV et de références, offres technique et
 * financière) : deux cabinets, des utilisateurs internes aux droits variés.
 */

export const INCONNU = "00000000-0000-4000-8000-000000000000";

export interface ScenarioBanqueAo {
  a: CabinetMissions;
  b: CabinetMissions;
  consultant: ApiUtilisateur;
  expert: ApiUtilisateur;
  gestionnaire: ApiUtilisateur;
  ressources: ApiUtilisateur;
  externe: ApiUtilisateur;
}

export async function preparerBanqueAo(ctx: Contexte, nom: string): Promise<ScenarioBanqueAo> {
  const a = await preparerCabinet(ctx, `${nom} A`);
  const b = await preparerCabinet(ctx, `${nom} B`);
  return {
    a,
    b,
    consultant: await a.avecRoles(["consultant"]),
    expert: await a.avecRoles(["expert_metier"]),
    gestionnaire: await a.avecRoles(["gestionnaire"]),
    ressources: await a.avecRoles(["ressources"]),
    externe: await a.avecRoles(["expert_externe"]),
  };
}

export const CONTENU_CV = {
  titre: "Expert en finances publiques",
  nationalite: "Ivoirienne",
  resume: "Quinze ans d'appui aux réformes budgétaires en Afrique de l'Ouest.",
  secteurs: ["Finances publiques", "Gouvernance"],
  competences: ["Budget-programme", "Contrôle interne"],
  experiences: [
    {
      intitule: "Conseiller budgétaire",
      employeur: "Ministère du Budget",
      pays: "CI",
      debut: "2010-01",
      fin: "2017-12",
      secteurs: ["Finances publiques"],
      bailleur: "Banque mondiale",
      description: "Appui à la préparation du budget-programme.",
    },
    {
      intitule: "Chef de mission",
      employeur: "Cabinet",
      debut: "2018-01",
      fin: null,
      secteurs: ["Gouvernance"],
      bailleur: "BAD",
    },
  ],
  diplomes: [
    {
      intitule: "Master en gestion publique",
      niveau: "bac_5",
      domaine: "Gestion publique",
      etablissement: "Université Félix Houphouët-Boigny",
      annee: 2009,
    },
  ],
  langues: [
    { langue: "Français", niveau: "maternelle" },
    { langue: "Anglais", niveau: "courant" },
  ],
};

export async function creerCv(
  par: Api,
  corps: Record<string, unknown> = {},
): Promise<Record<string, any> & { id: string }> {
  const r = await par.post("/api/banque-ao/cv", { nom: "Awa Koné", contenu: CONTENU_CV, ...corps });
  attendre(201, r, "CV");
  return r.json();
}

export const REFERENCE = {
  titre: "Appui à la réforme des finances publiques",
  client_nom: "Ministère des Finances",
  pays: "CI",
  secteurs: ["Finances publiques"],
  bailleur: "Banque mondiale",
  montant: 150_000_000,
  devise: "XOF",
  date_debut: "2022-01-15",
  date_fin: "2023-06-30",
  role_cabinet: "chef_de_file",
  description: "Diagnostic et plan d'action de la réforme budgétaire.",
};

export async function creerReference(
  par: Api,
  corps: Record<string, unknown> = {},
): Promise<Record<string, any> & { id: string }> {
  const r = await par.post("/api/banque-ao/references", { ...REFERENCE, ...corps });
  attendre(201, r, "référence");
  return r.json();
}

export const ENTREE_FINANCIERE = {
  devise: "XOF",
  honoraires: [
    { cle: "chef", libelle: "Chef d'équipe", jours: 20, taux_journalier: 450_000 },
    { cle: "expert", libelle: "Expert", jours: 12.5, taux_journalier: 350_000 },
  ],
  per_diem: [{ libelle: "Per diem terrain", quantite: 10, prix_unitaire: 45_000 }],
  debours: [{ libelle: "Billets d'avion", quantite: 2, prix_unitaire: 650_000 }],
  taxes: [{ libelle: "TVA", taux: 18, assiette: "total_ht" }],
};
