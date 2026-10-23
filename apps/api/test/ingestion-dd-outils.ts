/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Api } from "./api.js";
import { creerDossierDd, preparerDd, type ScenarioDd } from "./dd-outils.js";
import { televerser } from "./fichiers-outils.js";
import {
  executerJobs,
  fabriquerPdf,
  reponseLignes,
  type ContexteIngestion,
} from "./ingestion-outils.js";
import { attendre } from "./portail-outils.js";

/*
 * Outils des tests de l'ingestion pour la due diligence (DD-02, DD-10) : scénario (deux cabinets, dossier DD),
 * rapport PDF de test à deux pages, lignes du modèle (correctes ou altérées) et téléversement + exécution des
 * jobs. Tout est fictif ; le seul fournisseur IA est le serveur factice local du harnais.
 */

/** Marqueur propre au brouillon : introuvable ailleurs que dans les tables de l'ingestion. */
export const MARQUEUR = "ZEPHYRIUM";

export const PAGE_1 = [
  "RAPPORT DE DUE DILIGENCE - SOCIETE CIBLE SA",
  "Le chiffre d'affaires 2025 atteint 12 500 000 000 FCFA.",
  "Un litige fiscal de 350 000 000 FCFA est en cours.",
  "La societe s'engage a rembourser 1 200 000 000 FCFA avant 2027.",
];
export const PAGE_2 = [
  "Risque de concentration : trois clients representent 62 % des ventes.",
  "Les stocks sont stables par rapport a l'exercice precedent.",
];

export const pdfRapport = (): Buffer => fabriquerPdf({ pages: [PAGE_1, PAGE_2] });

const RESUME = "RESUME | 1 | Rapport sur la société cible : chiffre d'affaires et litige fiscal.";
const CHIFFRE =
  `1 | chiffre | Le chiffre d'affaires 2025 atteint 12 500 000 000 FCFA | ` +
  `Chiffre d'affaires 2025 de 12 500 000 000 FCFA (${MARQUEUR}).`;
const LITIGE =
  "1 | risque | Un litige fiscal de 350 000 000 FCFA est en cours | Litige fiscal en cours de 350 000 000 FCFA.";
const CONCENTRATION =
  "2 | risque | Risque de concentration : trois clients representent 62 % des ventes | Clientèle concentrée sur trois clients.";

/** Lignes correctes : résumé et trois éléments tous retrouvés dans leur page. */
export const LIGNES_RAPPORT_OK = [RESUME, CHIFFRE, LITIGE, CONCENTRATION];

/** Un extrait altéré, un nombre absent de la page, une page inexistante, une ligne hors format. */
export const LIGNES_RAPPORT_ALTEREES = [
  RESUME,
  CHIFFRE,
  "1 | engagement | La societe s'engage a rembourser 1 300 000 000 FCFA avant 2027 | Remboursement de 1 300 000 000 FCFA avant 2027.",
  "2 | fait | Les stocks sont stables par rapport a l'exercice precedent | Stocks en hausse de 140 unités.",
  "9 | fait | Cette page n'existe pas dans le document | Élément rejeté.",
  "ligne sans aucun format reconnu",
];

export const repondreLignes = (ctx: ContexteIngestion, lignes: string[]) =>
  ctx.serveur.repondre(() => reponseLignes(lignes));

export interface ScenarioIngestionDd extends ScenarioDd {
  dossierId: string;
}

export async function preparerIngestionDd(
  ctx: ContexteIngestion,
  nom: string,
): Promise<ScenarioIngestionDd> {
  const s = await preparerDd(ctx, nom);
  ctx.cabinets.push(s.a.cabinetId, s.b.cabinetId);
  const dossier = await creerDossierDd(s.a.chef, s.missionId);
  return { ...s, dossierId: dossier.id };
}

export const urlDocuments = (dossierId: string, type?: string) =>
  `/api/dd/dossiers/${dossierId}/documents${type ? `?type=${type}` : ""}`;

export const televerserDd = (
  api: Api,
  dossierId: string,
  type: string,
  nom: string,
  contenu: Buffer,
) => televerser(api, urlDocuments(dossierId, type), nom, contenu);

/** Téléverse (202 attendu), exécute les jobs et renvoie le détail du document terminé. */
export async function ingererDd(
  ctx: ContexteIngestion,
  api: Api,
  dossierId: string,
  type: "rapport" | "salle",
  nom: string,
  contenu: Buffer,
): Promise<{ id: string; document: Record<string, any> }> {
  const r = await televerserDd(api, dossierId, type, nom, contenu);
  attendre(202, r, "téléversement DD");
  const id = r.json().id as string;
  await executerJobs(ctx);
  const d = await api.get(`/api/dd/documents/${id}`);
  attendre(200, d, "détail du document DD");
  return { id, document: d.json() };
}
