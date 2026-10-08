import type { RapportsParametres } from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { FacteurConfirme } from "../auth/confirmer-identite.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";

/*
 * Paramètres des rapports par cabinet (migration 0132), lus dans la
 * transaction du cabinet (RLS) ; sans ligne, les valeurs par défaut :
 *
 * - durée de conservation des rapports générés : CONSERVATION_JOURS_DEFAUT
 *   (3 ans), de 90 à 3 650 jours ; au-delà, le fichier est purgé
 *   (rapports/purge.ts) SANS RETOUR : une mission clôturée refuse la génération
 *   (409), un rapport purgé d'une telle mission ne peut donc plus être refait.
 *   Raccourcir la durée est une action à fort impact (reconfirmation de
 *   l'identité, `conservationRaccourcie`). Valeur À VALIDER avec le conseil
 *   juridique ;
 * - mention de la contribution de l'IA en pied de page (PRD complémentaire,
 *   décision 21.2 : « au choix du cabinet, avec une mention par défaut ») :
 *   active par défaut, texte MENTION_IA_DEFAUT sauf texte du cabinet.
 *
 * Modification : « cabinet.gerer », journalisée (avec le facteur de reconfirmation
 * quand elle a été exigée).
 */

/** Doit rester égal à `conservation_rapports_defaut()` (0132) ; vérifié par un test. */
export const CONSERVATION_JOURS_DEFAUT = 1095;
export const CONSERVATION_JOURS_MIN = 90;
export const CONSERVATION_JOURS_MAX = 3650;

export const MENTION_IA_DEFAUT =
  "Document établi par le cabinet avec MissionPilot : les chiffres sont calculés par des " +
  "moteurs vérifiables ; tout contenu préparé avec l'aide de l'IA a été relu et validé par un consultant.";

export interface ParametresRapports {
  conservation_jours: number;
  mention_ia_active: boolean;
  /** Texte propre au cabinet ; null : texte par défaut. */
  mention_ia: string | null;
  /** Mention effectivement imprimée (null : aucune). */
  mention_effective: string | null;
  /** Vrai tant que le cabinet n'a rien enregistré (valeurs par défaut). */
  par_defaut: boolean;
  modifie_par: string | null;
  modifie_le: Date | null;
}

function vue(ligne: Record<string, unknown> | undefined): ParametresRapports {
  const active = (ligne?.mention_ia_active as boolean | undefined) ?? true;
  const texte = (ligne?.mention_ia as string | null | undefined) ?? null;
  return {
    conservation_jours:
      (ligne?.conservation_jours as number | undefined) ?? CONSERVATION_JOURS_DEFAUT,
    mention_ia_active: active,
    mention_ia: texte,
    mention_effective: active ? (texte ?? MENTION_IA_DEFAUT) : null,
    par_defaut: ligne === undefined,
    modifie_par: (ligne?.modifie_par as string | undefined) ?? null,
    modifie_le: (ligne?.modifie_le as Date | undefined) ?? null,
  };
}

/** Vrai si la nouvelle durée de conservation est plus courte que l'actuelle (action à confirmer). */
export const conservationRaccourcie = (avant: ParametresRapports, corps: RapportsParametres) =>
  corps.conservation_jours < avant.conservation_jours;

export const confirmationConservationRequise = () =>
  new AppError(
    403,
    "CONFIRMATION_REQUISE",
    "Confirmez votre mot de passe (et votre code de vérification) pour raccourcir la durée de conservation des rapports.",
  );

/** Paramètres du cabinet du contexte (valeurs par défaut sans ligne). */
export async function lireParametresRapports(db: Db): Promise<ParametresRapports> {
  const r = await db.query(
    `SELECT conservation_jours, mention_ia_active, mention_ia, modifie_par, modifie_le
     FROM rapports_parametres WHERE cabinet_id = app_cabinet_id()`,
  );
  return vue(r.rows[0] as Record<string, unknown> | undefined);
}

/**
 * Enregistre les paramètres (remplacement complet), journalisé avec l'état précédent.
 * `facteur` : facteur de la reconfirmation faite avant l'appel, null si aucune ; raccourcir la
 * durée sans reconfirmation est refusé ici même (403), sous la transaction d'écriture.
 */
export async function modifierParametresRapports(
  db: Db,
  auth: Auth,
  corps: RapportsParametres,
  facteur: FacteurConfirme | null = null,
): Promise<ParametresRapports> {
  const avant = await lireParametresRapports(db);
  if (conservationRaccourcie(avant, corps) && facteur === null) {
    throw confirmationConservationRequise();
  }
  const mention = corps.mention_ia?.trim() ? corps.mention_ia.trim() : null;
  await db.query(
    `INSERT INTO rapports_parametres (cabinet_id, conservation_jours, mention_ia_active, mention_ia,
       modifie_par, modifie_le)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (cabinet_id) DO UPDATE SET conservation_jours = EXCLUDED.conservation_jours,
       mention_ia_active = EXCLUDED.mention_ia_active, mention_ia = EXCLUDED.mention_ia,
       modifie_par = EXCLUDED.modifie_par, modifie_le = EXCLUDED.modifie_le`,
    [
      auth.cabinetId,
      corps.conservation_jours,
      corps.mention_ia_active,
      mention,
      auth.utilisateurId,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "rapports.parametres",
    entite: "cabinet",
    entiteId: auth.cabinetId,
    details: {
      avant: {
        conservation_jours: avant.conservation_jours,
        mention_ia_active: avant.mention_ia_active,
        mention_ia: avant.mention_ia,
      },
      apres: {
        conservation_jours: corps.conservation_jours,
        mention_ia_active: corps.mention_ia_active,
        mention_ia: mention,
      },
      ...(facteur ? { facteur } : {}),
    },
  });
  return lireParametresRapports(db);
}
