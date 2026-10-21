import {
  cartographieDeRepli,
  contexteChiffresCauses,
  entreeCausesExploitable,
  normaliserCartographie,
  syntheseContexteCauses,
  CAUSES_MAX,
} from "@missionpilot/engines";
import {
  RED_CAUSES_VERSIONS_MAX,
  RED_SECTEUR_LIBELLES,
  type RedCausesGeneration,
  type RedCausesModification,
  type RedCausesVersionVue,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Config } from "../config.js";
import type { Database, Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { suspectsRestants } from "../ia/garde-chiffres.js";
import { lireDemandeVisible } from "../ia/generations.js";
import { genererContenu, type ResultatExecution } from "../ia/orchestrateur.js";
import {
  assurerPromptRedressementCauses,
  causesDepuisSortie,
  NOM_PROMPT_REDRESSEMENT_CAUSES,
} from "../ia/prompts/gabarits/redressement-causes.js";
import { exigerDossierRedEcriture } from "./acces.js";
import {
  accesCartographie,
  brouillonVerrouille,
  creerCartographie,
  DEBIT_CAUSES_GENERATION,
  DEBIT_CAUSES_MODIFICATION,
  inscrireModification,
  lireEntreeCauses,
} from "./causes.js";
import { verifierDebit } from "./limites.js";

/*
 * Causes racines proposées par l'IA (RED-04) : SEUL fichier du module de redressement qui parle à
 * l'IA, et uniquement par l'ORCHESTRATEUR (ia/orchestrateur.ts, point d'entrée unique, ADR-003) :
 * jamais un client de modèle directement, aucun appel réseau ici.
 *
 * 1. Préparation (transaction) : dossier ouvert à l'écriture, débit par utilisateur, volume
 *    de cartographies du dossier, au moins une donnée de diagnostic (sinon 409 avant tout appel
 *    payant), prompt `red_causes_racines` semé dans le cabinet.
 * 2. Génération par l'orchestrateur : masquage des termes sensibles, quota et plafond, garde-chiffres
 *    contre la liste blanche bâtie par le MOTEUR (`contexteChiffresCauses`), trace. Le contexte libre
 *    du consultant est une donnée non fiable (masquée, neutralisée et encadrée). Sans clé, IA
 *    désactivée ou plafond atteint, le gabarit de l'orchestrateur répond et la cartographie de
 *    REPLI est construite par code (`cartographieDeRepli`).
 * 3. Enregistrement (transaction) : cartographie N du dossier en BROUILLON et rang 1
 *    « brouillon IA » de l'historique. Rien n'est exploitable avant la validation d'un consultant.
 *
 * Aucun chiffre ne vient du modèle : les nombres qu'il cite hors liste blanche sont signalés et
 * exigent un acquittement explicite à la validation.
 */

const MESSAGES_ECHEC: Record<string, string> = {
  PLAFOND_IA_ATTEINT: "Plafond mensuel de coût IA atteint.",
  GENERATIONS_SIMULTANEES: "Trop de générations IA en cours pour le cabinet.",
};

/** Texte des causes soumis à la garde-chiffres (sans les identifiants « cNN »). */
const texteDesCauses = (causes: readonly { libelle: string; description: string }[]) =>
  causes.map((c) => `${c.libelle}. ${c.description}`).join("\n");

/** Texte du contexte lorsque le consultant n'en fournit pas. */
const SANS_CONTEXTE = "(aucun contexte complémentaire)";

export async function genererCausesIa(
  database: Database,
  deps: { config: Config; journal?: (entree: unknown) => void },
  auth: Auth,
  dossierId: string,
  corps: RedCausesGeneration,
): Promise<{ vue: RedCausesVersionVue; resultat: ResultatExecution }> {
  const prep = await database.withTenant(auth.cabinetId, async (db) => {
    const { dossier } = await exigerDossierRedEcriture(db, auth, dossierId);
    await verifierDebit(db, auth, DEBIT_CAUSES_GENERATION);
    const n = await db.query(
      "SELECT count(*)::int AS n FROM red_causes_versions WHERE dossier_id = $1",
      [dossier.id],
    );
    if ((n.rows[0].n as number) >= RED_CAUSES_VERSIONS_MAX) {
      throw new AppError(
        409,
        "RED_PLAFOND_ATTEINT",
        `Au plus ${RED_CAUSES_VERSIONS_MAX} cartographies de causes racines par dossier.`,
      );
    }
    const entree = await lireEntreeCauses(db, dossier);
    if (!entreeCausesExploitable(entree)) {
      throw new AppError(
        409,
        "RED_CAUSES_SANS_DIAGNOSTIC",
        "Aucune donnée de diagnostic (urgence, score d'alerte, ratios ou trésorerie) : renseignez-en au moins une avant de demander une proposition.",
      );
    }
    await assurerPromptRedressementCauses(db, auth.cabinetId);
    return { dossier, entree };
  });
  const { dossier, entree } = prep;
  const chiffres = contexteChiffresCauses(entree);

  const { demandeId, resultat } = await genererContenu(database, deps, {
    tache: "redaction",
    promptNom: NOM_PROMPT_REDRESSEMENT_CAUSES,
    variables: {
      secteur: RED_SECTEUR_LIBELLES[dossier.secteur as keyof typeof RED_SECTEUR_LIBELLES],
      synthese: syntheseContexteCauses(entree),
      contexte: corps.contexte ?? SANS_CONTEXTE,
      nombre_causes_max: String(CAUSES_MAX),
    },
    // Les seuls nombres citables viennent des moteurs, par le code (jamais d'une requête HTTP).
    contexteChiffres: chiffres,
    termesSensibles: corps.termes_sensibles,
    // Le contexte libre d'un consultant est une donnée non fiable (AGT-07).
    variablesNonFiables: ["contexte"],
    entite: { missionId: dossier.mission_id, type: "red_causes", id: dossier.id },
    utilisateur: auth,
    // Sans budget IA, le gabarit déterministe répond (le consultant complète).
    repliSiPlafond: true,
  });

  const vue = await database.withTenant(auth.cabinetId, async (db) => {
    const { dossier: courant } = await exigerDossierRedEcriture(db, auth, dossierId);
    const demande = await lireDemandeVisible(db, auth, demandeId);
    if (demande.statut !== "terminee" || demande.g_version === null) {
      const code = String(demande.erreur_code ?? "");
      throw new AppError(
        502,
        "GENERATION_IA_ECHEC",
        MESSAGES_ECHEC[code] ?? "La proposition de causes racines a échoué : réessayez plus tard.",
      );
    }
    const propose = demande.p_gabarit === true ? null : causesDepuisSortie(demande.g_donnees);
    const repli = propose === null;
    const cartographie = propose ?? cartographieDeRepli(entree);
    // Seuls les nombres encore présents dans la cartographie retenue restent à acquitter ;
    // un repli est fabriqué par code : aucun nombre du modèle.
    const nombres = repli
      ? []
      : suspectsRestants(texteDesCauses(cartographie.causes), demande.g_nombres_non_verifies ?? []);
    return creerCartographie(db, auth, courant, {
      cartographie,
      demandeId,
      gabarit: repli,
      brief: {
        avec_contexte: corps.contexte !== undefined,
        termes_sensibles: corps.termes_sensibles.length,
        chiffres_fournis: chiffres.length,
        domaines_evalues: entree.urgence?.domaines.length ?? 0,
      },
      nombresNonVerifies: nombres,
    });
  });
  return { vue, resultat };
}

/**
 * Retouche d'une cartographie en brouillon par un consultant : normalisée par le moteur, nouveau
 * rang « modifie » ; les nombres du modèle qui ne figurent plus dans le contenu n'ont plus à être
 * acquittés (garde-chiffres de l'orchestrateur).
 */
export async function modifierCausesIa(
  db: Db,
  auth: Auth,
  versionId: string,
  corps: RedCausesModification,
): Promise<RedCausesVersionVue> {
  const acces = await accesCartographie(db, auth, versionId);
  await verifierDebit(db, auth, DEBIT_CAUSES_MODIFICATION);
  const brouillon = await brouillonVerrouille(db, acces.dossier.id, versionId);
  const cartographie = normaliserCartographie({ causes: corps.causes });
  const dernier = brouillon.rangs[brouillon.rangs.length - 1];
  const restants = suspectsRestants(
    texteDesCauses(cartographie.causes),
    dernier?.nombres_non_verifies ?? [],
  );
  return inscrireModification(db, auth, acces.dossier, brouillon, cartographie, restants);
}
