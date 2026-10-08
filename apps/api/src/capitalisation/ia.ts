import type { Auth } from "../auth/contexte.js";
import type { Database } from "../db/pool.js";
import { AppError } from "../errors.js";
import { lireDemandeVisible } from "../ia/generations.js";
import { genererContenu, type DependancesIa, type ResultatExecution } from "../ia/orchestrateur.js";
import { chargerFaitsRetour } from "./donnees.js";
import { donneesVersion, gabaritRetour } from "./gabarit.js";
import {
  assurerPromptRetour,
  chiffresRetour,
  NOM_PROMPT_RETOUR,
  VARIABLES_NON_FIABLES_RETOUR,
  versionDepuisSortie,
} from "./prompt.js";
import { exigerRetourRedigeable, inscrireVersionGeneree } from "./retours.js";

/*
 * Option IA du retour d'expérience (CAP-01) : une génération par l'ORCHESTRATEUR (masquage du nom
 * du client et de l'intitulé, quota, plafond avec repli sur gabarit, garde-chiffres, trace),
 * inscrite comme nouvelle version « ia » du brouillon. Sans clé, IA désactivée, plafond atteint ou
 * sortie inexploitable : le gabarit déterministe est inscrit (origine « gabarit »). Rien n'atteint
 * la base de connaissances sans la validation du chef de mission.
 *
 * La génération n'est pas rattachée à la mission (`entite` = retour d'expérience) : la mission est
 * clôturée, l'orchestrateur n'y rattache plus de coût ; la visibilité et le rôle de responsable
 * sont vérifiés ici avant tout appel.
 */

export async function genererRetourIa(
  database: Database,
  deps: DependancesIa,
  auth: Auth,
  id: string,
): Promise<{
  retour: Awaited<ReturnType<typeof inscrireVersionGeneree>>;
  resultat: ResultatExecution;
}> {
  const prep = await database.withTenant(auth.cabinetId, async (db) => {
    const { retour } = await exigerRetourRedigeable(db, auth, id);
    const faits = await chargerFaitsRetour(db, retour.mission_id);
    const v = await db.query(
      `SELECT contexte, methode, ecarts, lecons FROM retour_experience_versions
       WHERE retour_id = $1 ORDER BY version DESC LIMIT 1`,
      [id],
    );
    await assurerPromptRetour(db, auth.cabinetId);
    return {
      faits,
      courante: v.rows[0] as Record<"contexte" | "methode" | "ecarts" | "lecons", string>,
    };
  });
  const { faits, courante } = prep;
  const { demandeId, resultat } = await genererContenu(database, deps, {
    tache: "redaction",
    promptNom: NOM_PROMPT_RETOUR,
    variables: courante,
    contexteChiffres: chiffresRetour(faits),
    termesSensibles: [
      { valeur: faits.mission.client, categorie: "organisation" },
      { valeur: faits.mission.intitule.slice(0, 200), categorie: "autre" },
    ],
    variablesNonFiables: [...VARIABLES_NON_FIABLES_RETOUR],
    entite: { type: "retour_experience", id },
    utilisateur: auth,
    repliSiPlafond: true,
  });
  const retour = await database.withTenant(auth.cabinetId, async (db) => {
    const demande = await lireDemandeVisible(db, auth, demandeId);
    if (demande.statut !== "terminee" || demande.g_version === null) {
      throw new AppError(
        502,
        "GENERATION_IA_ECHEC",
        "La génération du retour d'expérience a échoué : réessayez plus tard.",
      );
    }
    const propose = demande.p_gabarit === true ? null : versionDepuisSortie(demande.g_donnees);
    const base = donneesVersion(faits);
    if (propose === null) {
      return inscrireVersionGeneree(db, auth, id, {
        origine: "gabarit",
        contenu: gabaritRetour(faits),
        donnees: base,
        demandeId,
      });
    }
    return inscrireVersionGeneree(db, auth, id, {
      origine: "ia",
      contenu: propose,
      donnees: {
        ...base,
        chiffres_non_verifies: demande.g_chiffres_non_verifies === true,
        nombres_non_verifies: (demande.g_nombres_non_verifies ?? []).slice(0, 50),
      },
      demandeId,
    });
  });
  return { retour, resultat };
}
