import type { CleCompte } from "../cles.js";
import { attendre, type ContexteTenantDemo } from "../contexte.js";
import { MOT_DE_PASSE_DEMO_TENANT } from "../constantes.js";
import { CV_DEMO, type ContenuCvDemo, type CvDemo, type MajCv } from "./donnees-banque-cv.js";
import { existe, sql } from "./outils.js";

/*
 * Banque de CV du Tenant démo : profils créés par les routes (`ao.gerer`), mises à jour en nouvelles
 * versions, contrôle déterministe des exigences, puis anonymisation d'un ancien collaborateur
 * (reconfirmation du mot de passe, associé). Les tables de CV sont en ajout seul : les lignes
 * portent la date du jour d'exécution (pas d'antidatage possible), seules les dates de parcours
 * (expériences, diplômes) sont étalées. Rejouable : clé = nom du profil (ou collaborateur).
 */

const CREATEUR: Record<string, CleCompte> = {
  associe: "chef.mission",
  "associe.2": "chef.mission",
  "directeur.mission": "chef.mission.2",
  "chef.mission": "chef.mission",
  "chef.mission.2": "chef.mission.2",
  consultant: "consultant",
  "consultant.2": "consultant.2",
  "ex.consultant": "chef.mission",
};
const AUTEURS_MAJ: readonly CleCompte[] = ["directeur.mission", "chef.mission.2", "consultant"];

/** Nom du profil : celui du compte du collaborateur, sinon celui de la donnée. */
function nomDu(ctx: ContexteTenantDemo, cv: CvDemo): string {
  const nom = cv.nom ?? ctx.comptes[cv.cle as CleCompte]?.nom;
  if (!nom) throw new Error(`Nom du CV « ${cv.cle} » introuvable.`);
  return nom;
}

function appliquer(contenu: ContenuCvDemo, maj: MajCv): ContenuCvDemo {
  return {
    ...contenu,
    titre: maj.titre ?? contenu.titre,
    experiences: maj.experience ? [maj.experience, ...contenu.experiences] : contenu.experiences,
    competences: [...contenu.competences, ...(maj.competences ?? [])],
    langues: maj.langues ?? contenu.langues,
  };
}

/** Contenu d'un CV après les `n` premières mises à jour. */
function contenuApres(cv: CvDemo, n: number): ContenuCvDemo {
  return cv.majs.slice(0, n).reduce(appliquer, cv.contenu);
}

interface LigneCv {
  id: string;
  versions: number;
  anonymise: boolean;
}

async function ligneDuCv(ctx: ContexteTenantDemo, nom: string, collaborateurId: string) {
  return (
    await sql<LigneCv>(
      ctx,
      `SELECT c.id, (SELECT count(*)::int FROM ao_cv_versions v WHERE v.cv_id = c.id) AS versions,
         (c.anonymise_le IS NOT NULL) AS anonymise
       FROM ao_cv c WHERE c.cabinet_id = $1 AND (c.nom = $2 OR c.collaborateur_id = $3)`,
      [ctx.cabinetId, nom, collaborateurId],
    )
  )[0];
}

async function semerUnCv(ctx: ContexteTenantDemo, cv: CvDemo, rang: number): Promise<string> {
  const nom = nomDu(ctx, cv);
  const collaborateurId = ctx.collaborateur(cv.cle);
  let ligne = await ligneDuCv(ctx, nom, collaborateurId);
  if (!ligne && cv.cle === "ex.consultant") {
    // Après anonymisation, le profil n'a plus ni nom ni collaborateur : on le retrouve par son état.
    ligne = (
      await sql<LigneCv>(
        ctx,
        `SELECT id, 1 AS versions, true AS anonymise FROM ao_cv
         WHERE cabinet_id = $1 AND anonymise_le IS NOT NULL LIMIT 1`,
        [ctx.cabinetId],
      )
    )[0];
  }
  if (!ligne) {
    const createur = ctx.session(CREATEUR[cv.cle] ?? "chef.mission");
    const r = await createur.post("/api/banque-ao/cv", {
      nom,
      collaborateur_id: collaborateurId,
      contenu: cv.contenu,
    });
    attendre(201, r, `CV ${nom}`);
    ligne = { id: (r.json() as { id: string }).id, versions: 1, anonymise: false };
  }
  if (ligne.anonymise) return ligne.id;
  for (let i = ligne.versions; i <= cv.majs.length; i++) {
    const maj = cv.majs[i - 1] as MajCv;
    const auteur = ctx.session(AUTEURS_MAJ[(rang + i) % AUTEURS_MAJ.length] as CleCompte);
    const r = await auteur.post(`/api/banque-ao/cv/${ligne.id}/versions`, {
      contenu: contenuApres(cv, i),
      motif: maj.motif,
    });
    attendre(201, r, `version ${i + 1} du CV ${nom}`);
  }
  return ligne.id;
}

/** Contrôle déterministe d'un CV contre des exigences de type termes de référence (mois fixe). */
async function controler(ctx: ContexteTenantDemo, cvId: string, nom: string): Promise<void> {
  const r = await ctx.session("chef.mission").post(`/api/banque-ao/cv/${cvId}/controle`, {
    annees_min: 5,
    annees_par_secteur: [{ secteur: "Agro-industrie", annees: 2 }],
    niveau_diplome_min: "bac_5",
    langues: [{ langue: "anglais", niveau_min: "courant" }],
    reference: "2026-10",
  });
  attendre(200, r, `contrôle du CV ${nom}`);
  const res = r.json() as { conforme: boolean; annees_experience: number };
  ctx.journal(`  CV ${nom} : ${res.annees_experience} an(s), conforme=${res.conforme}.`);
}

/** Anonymise le CV de l'ancien collaborateur (une fois) ; reconfirmation du mot de passe. */
async function anonymiser(ctx: ContexteTenantDemo, cvId: string): Promise<void> {
  const r = await ctx.session("associe").post(`/api/banque-ao/cv/${cvId}/anonymisation`, {
    motif: "Départ du collaborateur (septembre 2025) : effacement de son parcours à sa demande.",
    confirmation: { mot_de_passe: MOT_DE_PASSE_DEMO_TENANT },
  });
  attendre(200, r, "anonymisation du CV de l'ancien collaborateur");
}

export async function semerCv(ctx: ContexteTenantDemo): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  let rang = 0;
  for (const cv of CV_DEMO) {
    const id = await semerUnCv(ctx, cv, rang++);
    ids[cv.cle] = id;
    const nom = nomDu(ctx, cv);
    const anonyme = await existe(
      ctx,
      "SELECT 1 FROM ao_cv WHERE id = $1 AND anonymise_le IS NOT NULL",
      [id],
    );
    if (anonyme) continue;
    await controler(ctx, id, nom);
    if (cv.cle === "ex.consultant") await anonymiser(ctx, id);
  }
  return ids;
}
