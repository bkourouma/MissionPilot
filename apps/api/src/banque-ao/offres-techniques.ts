import type {
  OffreTechniqueCreation,
  OffreTechniqueSections,
  offresQuerySchema,
  offreTechniqueValidationSchema,
} from "@missionpilot/shared";
import type { z } from "zod";
import type { Auth } from "../auth/contexte.js";
import type { Database, Db } from "../db/pool.js";
import { AppError, conflit, introuvable } from "../errors.js";
import { lireDemandeVisible } from "../ia/generations.js";
import { genererContenu, type DependancesIa } from "../ia/orchestrateur.js";
import type { NotificationCreee } from "../notifications/notifier.js";
import { estAssocie } from "../missions/acces.js";
import { lireContenu, lireVersion } from "../standard/contenu.js";
import { lireFiche } from "../appels-offres/fiches.js";
import { anneesDuCv, contenuCourant, exigerCvUtilisable } from "./cv.js";
import { curseurNumero, journal, pageParNumero, verrouEntite } from "./commun.js";
import {
  assurerPromptOffreTechnique,
  contientRepereACompleter,
  methodeEnTexte,
  NOM_PROMPT_OFFRE_TECHNIQUE,
  sectionsDepuisSortie,
  sectionsGabarit,
  VARIABLES_NON_FIABLES_OFFRE,
  type ContexteOffre,
  type EtapeMethode,
  type ExpertOffre,
} from "./redaction-offre.js";

/*
 * Offre technique (AO-06) : brouillon rédigé par l'orchestrateur IA ou par le gabarit
 * déterministe, puis modifications humaines en nouvelles versions et VALIDATION humaine de la
 * dernière version (0382). Rien n'est utilisable avant validation : « l'IA propose, l'expert
 * dispose ». Statut : « brouillon_ia » (version 1 non validée), « modifiee » (version humaine non
 * validée), « validee » (dernière version validée).
 */

export type StatutOffreTechnique = "brouillon_ia" | "modifiee" | "validee";

export function statutOffre(origine: string, validee: boolean): StatutOffreTechnique {
  if (validee) return "validee";
  return origine === "manuel" ? "modifiee" : "brouillon_ia";
}

interface Preparation {
  etapes: EtapeMethode[];
  experts: ExpertOffre[];
  cvIds: string[];
}

/** Étapes et activités actives par défaut d'une version PUBLIÉE et visible de méthode. */
async function etapesDeMethode(db: Db, versionId: string): Promise<EtapeMethode[]> {
  const version = await lireVersion(db, versionId);
  if (version.statut !== "publiee") {
    throw conflit("Seule une version publiée d'une méthode sert de base à une offre.");
  }
  const contenu = await lireContenu(db, versionId);
  return contenu.etapes.map((e) => ({
    libelle: e.libelle as string,
    description: (e.description as string | null) ?? null,
    briques: contenu.briques
      .filter((b) => b.etape_id === e.id && b.active_par_defaut !== false)
      .map((b) => ({
        libelle: b.libelle as string,
        objet: b.objet as string,
        temps_type_jours: (b.temps_type_jours as number | null) ?? null,
      })),
  }));
}

/** Méthode et experts de l'offre (CV visibles, sinon 404). */
async function preparer(
  db: Db,
  methodeVersionId: string | null,
  cvIds: readonly string[],
): Promise<Preparation> {
  const etapes = methodeVersionId ? await etapesDeMethode(db, methodeVersionId) : [];
  const uniques = [...new Set(cvIds)];
  const experts: ExpertOffre[] = [];
  for (const id of uniques) {
    const profil = await exigerCvUtilisable(db, id);
    const { contenu } = await contenuCourant(db, id);
    experts.push({
      nom: profil.nom,
      titre: contenu.titre,
      annees_experience: anneesDuCv(contenu),
      secteurs: contenu.secteurs,
    });
  }
  return { etapes, experts, cvIds: uniques };
}

const contexteDe = (c: OffreTechniqueCreation["contexte"]): ContexteOffre => ({
  client: c.client,
  pays: c.pays ?? null,
  secteur: c.secteur ?? null,
  bailleur: c.bailleur ?? null,
  objectifs: c.objectifs ?? null,
  termes_reference: c.termes_reference,
});

interface Brouillon {
  sections: OffreTechniqueSections;
  origine: "ia" | "gabarit";
  demandeId: string | null;
  chiffresNonVerifies: boolean;
  nombresNonVerifies: string[];
}

/** Lit la génération terminée et en tire le brouillon ; gabarit si la sortie est inexploitable. */
async function brouillonDeDemande(
  db: Db,
  auth: Auth,
  demandeId: string,
  contexte: ContexteOffre,
  prep: Preparation,
): Promise<Brouillon> {
  const demande = await lireDemandeVisible(db, auth, demandeId);
  if (demande.statut !== "terminee" || demande.g_version === null) {
    throw new AppError(
      502,
      "GENERATION_IA_ECHEC",
      "La rédaction de l'offre a échoué : réessayez plus tard ou partez du gabarit.",
    );
  }
  const propose =
    demande.p_gabarit === true
      ? null
      : sectionsDepuisSortie(demande.g_donnees, prep.etapes, prep.experts);
  if (!propose) {
    return {
      sections: sectionsGabarit(contexte, prep.etapes, prep.experts),
      origine: "gabarit",
      demandeId,
      chiffresNonVerifies: false,
      nombresNonVerifies: [],
    };
  }
  return {
    sections: propose,
    origine: "ia",
    demandeId,
    chiffresNonVerifies: demande.g_chiffres_non_verifies === true,
    nombresNonVerifies: (demande.g_nombres_non_verifies ?? []).slice(0, 200),
  };
}

async function enregistrerOffre(
  db: Db,
  auth: Auth,
  corps: OffreTechniqueCreation,
  prep: Preparation,
  b: Brouillon,
): Promise<string> {
  const r = await db.query(
    `INSERT INTO ao_offres_techniques (cabinet_id, appel_offres_id, titre, methode_version_id,
       contexte, cv_ids, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      auth.cabinetId,
      corps.appel_offres_id ?? null,
      corps.titre,
      corps.methode_version_id ?? null,
      JSON.stringify(corps.contexte),
      prep.cvIds,
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  await db.query(
    `INSERT INTO ao_offre_technique_versions (cabinet_id, offre_id, version, sections, origine,
       demande_ia_id, chiffres_non_verifies, nombres_non_verifies, cree_par)
     VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8)`,
    [
      auth.cabinetId,
      id,
      JSON.stringify(b.sections),
      b.origine,
      b.demandeId,
      b.chiffresNonVerifies,
      b.nombresNonVerifies,
      auth.utilisateurId,
    ],
  );
  // Jamais le contenu : identifiants et indicateurs seulement.
  await journal(db, auth, "creation_offre_technique", "ao_offre_technique", id, {
    appel_offres_id: corps.appel_offres_id ?? null,
    origine: b.origine,
    demande_ia_id: b.demandeId,
  });
  return id;
}

/**
 * Crée une offre technique : préparation (méthode publiée et CV visibles), rédaction par
 * l'orchestrateur (« ia », avec repli) ou par le gabarit, enregistrement de la version 1.
 */
export async function creerOffreTechnique(
  database: Database,
  deps: DependancesIa,
  auth: Auth,
  corps: OffreTechniqueCreation,
): Promise<{ id: string; notifications: readonly (NotificationCreee | null)[] }> {
  const contexte = contexteDe(corps.contexte);
  const prep = await database.withTenant(auth.cabinetId, async (db) => {
    // Un appel d'offres cité existe dans le cabinet (404 sinon : aucun identifiant orphelin).
    if (corps.appel_offres_id) await lireFiche(db, corps.appel_offres_id);
    const p = await preparer(db, corps.methode_version_id ?? null, corps.cv_ids);
    if (corps.generation === "ia") await assurerPromptOffreTechnique(db, auth.cabinetId);
    return p;
  });
  if (corps.generation === "gabarit") {
    const id = await database.withTenant(auth.cabinetId, (db) =>
      enregistrerOffre(db, auth, corps, prep, {
        sections: sectionsGabarit(contexte, prep.etapes, prep.experts),
        origine: "gabarit",
        demandeId: null,
        chiffresNonVerifies: false,
        nombresNonVerifies: [],
      }),
    );
    return { id, notifications: [] };
  }
  const { demandeId, resultat } = await genererContenu(database, deps, {
    tache: "redaction",
    promptNom: NOM_PROMPT_OFFRE_TECHNIQUE,
    variables: {
      client: contexte.client,
      pays: contexte.pays ?? "non précisé",
      secteur: contexte.secteur ?? "non précisé",
      bailleur: contexte.bailleur ?? "non précisé",
      methode: methodeEnTexte(prep.etapes),
      objectifs: contexte.objectifs ?? "non précisés",
      termes_reference: contexte.termes_reference,
    },
    variablesNonFiables: VARIABLES_NON_FIABLES_OFFRE,
    termesSensibles: corps.termes_sensibles,
    utilisateur: auth,
    // Sans budget IA, le gabarit déterministe répond (l'expert complète).
    repliSiPlafond: true,
  });
  const id = await database.withTenant(auth.cabinetId, async (db) =>
    enregistrerOffre(
      db,
      auth,
      corps,
      prep,
      await brouillonDeDemande(db, auth, demandeId, contexte, prep),
    ),
  );
  return { id, notifications: resultat.notifications };
}

/** Offre visible (RLS), ou 404. */
export async function exigerOffreTechnique(db: Db, id: string) {
  const r = await db.query(
    `SELECT o.id, o.numero, o.appel_offres_id, o.titre, o.methode_version_id, o.contexte,
       o.cv_ids, o.cree_par, o.cree_le
     FROM ao_offres_techniques o WHERE o.id = $1`,
    [id],
  );
  const l = r.rows[0];
  if (!l) throw introuvable("Offre technique");
  return { ...l, numero: Number(l.numero) } as Record<string, unknown> & {
    id: string;
    numero: number;
  };
}

async function versionsDe(db: Db, offreId: string) {
  const r = await db.query(
    `SELECT v.id, v.version, v.sections, v.origine, v.demande_ia_id, v.chiffres_non_verifies,
       v.nombres_non_verifies, v.motif, v.cree_par, v.cree_le,
       w.valide_par, w.acquitte_chiffres, w.cree_le AS valide_le
     FROM ao_offre_technique_versions v
     LEFT JOIN ao_offre_technique_validations w ON w.version_id = v.id
     WHERE v.offre_id = $1 ORDER BY v.version DESC`,
    [offreId],
  );
  return r.rows.map((l) => ({
    id: l.id as string,
    version: l.version as number,
    sections: l.sections as OffreTechniqueSections,
    origine: l.origine as string,
    demande_ia_id: (l.demande_ia_id as string | null) ?? null,
    chiffres_non_verifies: l.chiffres_non_verifies as boolean,
    nombres_non_verifies: l.nombres_non_verifies as string[],
    motif: (l.motif as string | null) ?? null,
    cree_par: l.cree_par as string,
    cree_le: l.cree_le as Date,
    validation:
      l.valide_par === null
        ? null
        : {
            valide_par: l.valide_par as string,
            acquitte_chiffres: l.acquitte_chiffres as boolean,
            valide_le: l.valide_le as Date,
          },
  }));
}

export async function detailOffreTechnique(db: Db, id: string) {
  const offre = await exigerOffreTechnique(db, id);
  const versions = await versionsDe(db, id);
  const derniere = versions[0];
  return {
    ...offre,
    statut: derniere ? statutOffre(derniere.origine, derniere.validation !== null) : "brouillon_ia",
    courante: derniere ?? null,
    versions,
  };
}

export async function nouvelleVersionOffreTechnique(
  db: Db,
  auth: Auth,
  id: string,
  sections: OffreTechniqueSections,
  motif: string,
): Promise<void> {
  await verrouEntite(db, "offre_technique", id);
  await exigerOffreTechnique(db, id);
  const versions = await versionsDe(db, id);
  const suivante = (versions[0]?.version ?? 0) + 1;
  await db.query(
    `INSERT INTO ao_offre_technique_versions (cabinet_id, offre_id, version, sections, origine,
       motif, cree_par)
     VALUES ($1, $2, $3, $4, 'manuel', $5, $6)`,
    [auth.cabinetId, id, suivante, JSON.stringify(sections), motif, auth.utilisateurId],
  );
  await journal(db, auth, "version_offre_technique", "ao_offre_technique", id, {
    version: suivante,
  });
}

/**
 * Séparation des tâches (SECURITY.md §5) : le valideur n'est ni le demandeur de l'offre, ni le
 * demandeur de la génération IA, ni l'auteur d'AUCUNE version, sauf associé (doublé en base :
 * MPW05).
 */
async function exigerValideurDistinct(
  db: Db,
  auth: Auth,
  offre: Record<string, unknown>,
  versions: readonly { cree_par: string; demande_ia_id: string | null }[],
): Promise<void> {
  if (estAssocie(auth)) return;
  const demandes = versions.flatMap((v) => (v.demande_ia_id ? [v.demande_ia_id] : []));
  const demandeurs = await db.query(
    "SELECT DISTINCT demandeur_id FROM ia_demandes WHERE id = ANY($1::uuid[])",
    [demandes],
  );
  const intervenants = new Set<string>([
    offre.cree_par as string,
    ...versions.map((v) => v.cree_par),
    ...demandeurs.rows.map((x) => x.demandeur_id as string),
  ]);
  if (intervenants.has(auth.utilisateurId)) {
    throw new AppError(
      403,
      "APPROBATION_REQUISE",
      "Le demandeur ou l'auteur d'une version d'une offre ne la valide pas lui-même : " +
        "demandez à un autre utilisateur ou à un associé.",
    );
  }
}

/** Valide la DERNIÈRE version (doublé en base : MPW03, MPW04, MPW05). */
export async function validerOffreTechnique(
  db: Db,
  auth: Auth,
  id: string,
  corps: z.infer<typeof offreTechniqueValidationSchema>,
): Promise<void> {
  await verrouEntite(db, "offre_technique", id);
  const offre = await exigerOffreTechnique(db, id);
  const versions = await versionsDe(db, id);
  const derniere = versions[0];
  if (!derniere || derniere.version !== corps.version) {
    throw new AppError(
      409,
      "VERSION_PERIMEE",
      "Seule la dernière version se valide : rechargez l'offre.",
    );
  }
  if (derniere.validation) throw new AppError(409, "VERSION_DEJA_VALIDEE", "Version déjà validée.");
  await exigerValideurDistinct(db, auth, offre, versions);
  if (contientRepereACompleter(derniere.sections)) {
    throw new AppError(
      409,
      "OFFRE_A_COMPLETER",
      "Une section contient encore un repère du gabarit à rédiger ou à adapter : " +
        "complétez l'offre dans une nouvelle version avant de la valider.",
    );
  }
  if (derniere.chiffres_non_verifies && corps.acquitte_chiffres !== true) {
    throw new AppError(
      409,
      "CHIFFRES_A_ACQUITTER",
      "Le brouillon IA cite des nombres non vérifiés : relisez-les puis acquittez-les pour valider.",
    );
  }
  await db.query(
    `INSERT INTO ao_offre_technique_validations (cabinet_id, offre_id, version_id, valide_par,
       acquitte_chiffres)
     VALUES ($1, $2, $3, $4, $5)`,
    [auth.cabinetId, id, derniere.id, auth.utilisateurId, corps.acquitte_chiffres === true],
  );
  await journal(db, auth, "validation_offre_technique", "ao_offre_technique", id, {
    version: derniere.version,
    origine: derniere.origine,
    acquitte_chiffres: corps.acquitte_chiffres === true,
  });
}

export async function listerOffresTechniques(db: Db, q: z.infer<typeof offresQuerySchema>) {
  const apres = curseurNumero(q.curseur);
  const r = await db.query(
    `SELECT o.id, o.numero, o.appel_offres_id, o.titre, o.cree_par, o.cree_le,
       v.version, v.origine, (w.id IS NOT NULL) AS validee
     FROM ao_offres_techniques o
     JOIN LATERAL (SELECT x.id, x.version, x.origine FROM ao_offre_technique_versions x
                   WHERE x.offre_id = o.id ORDER BY x.version DESC LIMIT 1) v ON true
     LEFT JOIN ao_offre_technique_validations w ON w.version_id = v.id
     WHERE ($1::uuid IS NULL OR o.appel_offres_id = $1)
       AND ($2::bigint IS NULL OR o.numero < $2)
     ORDER BY o.numero DESC
     LIMIT $3`,
    [q.appel_offres_id ?? null, apres, q.limite + 1],
  );
  const lignes = r.rows.map((l) => ({
    id: l.id as string,
    numero: Number(l.numero),
    appel_offres_id: (l.appel_offres_id as string | null) ?? null,
    titre: l.titre as string,
    version: l.version as number,
    statut: statutOffre(l.origine as string, l.validee as boolean),
    cree_par: l.cree_par as string,
    cree_le: l.cree_le as Date,
  }));
  return pageParNumero(lignes, q.limite);
}
