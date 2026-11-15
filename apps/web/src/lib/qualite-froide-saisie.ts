/**
 * Validations de saisie de la revue à froid (QUA-05) : messages français par champ, puis charge
 * confirmée par les schémas partagés (`packages/shared`, les mêmes que l'API). Aucun calcul
 * métier : le score, la conclusion et les indicateurs viennent de l'API.
 */
import {
  creerTraduire,
  type Langue,
  actionFroideCreationSchema,
  actionFroideModificationSchema,
  BORNES_REVUE_FROIDE,
  campagneFroideCreationSchema,
  CODES_CRITERES_REVUE_FROIDE,
  constatFroidCreationSchema,
  evaluationRevueFroideSchema,
  GRAVITES_CONSTAT_FROID,
  revueFroideTerminaisonSchema,
  STATUTS_ACTION_FROIDE,
  STRATES_ECHANTILLON,
  type CampagneFroideCreation,
} from "@missionpilot/shared";
import type { Resultat } from "./saisie";

export const MESSAGE_SAISIE_REFUSEE = "Valeur refusée : vérifiez ce champ.";
export const MESSAGE_SAISIE_REFUSEE_EN = "Value rejected: check this field.";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const GRAINE = /^[A-Za-z0-9_-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Forme minimale d'une erreur Zod (pas de dépendance directe à zod côté web). */
interface ZodErreur {
  issues: readonly { path: readonly (string | number | symbol)[] }[];
}

type Erreurs<K extends string> = Partial<Record<K, string>>;

const dateValide = (v: string) =>
  DATE.test(v) &&
  !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
  new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);

/** Filet : un refus du schéma partagé que les contrôles ci-dessus n'ont pas vu. */
function refusSchema<K extends string>(
  erreur: ZodErreur,
  champs: readonly K[],
  defaut: K,
  langue: Langue = "fr",
): Erreurs<K> {
  const erreurs: Erreurs<K> = {};
  for (const issue of erreur.issues) {
    const champ = issue.path
      .map(String)
      .find((p): p is K => (champs as readonly string[]).includes(p));
    erreurs[champ ?? defaut] ??=
      langue === "en" ? MESSAGE_SAISIE_REFUSEE_EN : MESSAGE_SAISIE_REFUSEE;
  }
  return erreurs;
}

const vide = (e: object) => Object.keys(e).length === 0;
const texteOuNull = (v: string) => (v.trim() === "" ? null : v.trim());

// --- Tirage de l'échantillon -----------------------------------------------------------------

export interface SaisieCampagne {
  intitule: string;
  periode_debut: string;
  periode_fin: string;
  types_mission_ids: string[];
  directeur_ids: string[];
  stratifier_par: string;
  taille: string;
  graine: string;
  exclure_deja_revues: boolean;
}

export type ChampCampagne =
  "intitule" | "periode_debut" | "periode_fin" | "taille" | "graine" | "stratifier_par";
const CHAMPS_CAMPAGNE: readonly ChampCampagne[] = [
  "intitule",
  "periode_debut",
  "periode_fin",
  "taille",
  "graine",
  "stratifier_par",
];

export function validerCampagne(
  s: SaisieCampagne,
  langue: Langue = "fr",
): Resultat<CampagneFroideCreation, ChampCampagne> {
  const t = creerTraduire(langue);
  const erreurs: Erreurs<ChampCampagne> = {};
  const intitule = s.intitule.trim();
  if (intitule === "") {
    erreurs.intitule = t("Donnez un intitulé à la campagne.", "Give the campaign a title.");
  } else if (intitule.length > 200) {
    erreurs.intitule = t(
      "L'intitulé ne doit pas dépasser 200 caractères.",
      "The title must not exceed 200 characters.",
    );
  }
  if (!dateValide(s.periode_debut)) {
    erreurs.periode_debut = t(
      "Indiquez le début de la période de clôture.",
      "Enter the start of the close-out period.",
    );
  }
  if (!dateValide(s.periode_fin)) {
    erreurs.periode_fin = t(
      "Indiquez la fin de la période de clôture.",
      "Enter the end of the close-out period.",
    );
  } else if (dateValide(s.periode_debut) && s.periode_fin < s.periode_debut) {
    erreurs.periode_fin = t(
      "La fin de période précède son début.",
      "The period end is before its start.",
    );
  }
  const taille = s.taille.trim() === "" ? Number.NaN : Number(s.taille.trim());
  if (!Number.isInteger(taille) || taille < 1 || taille > BORNES_REVUE_FROIDE.taille) {
    erreurs.taille = t(
      `La taille est un entier de 1 à ${BORNES_REVUE_FROIDE.taille}.`,
      `The size is an integer from 1 to ${BORNES_REVUE_FROIDE.taille}.`,
    );
  }
  const graine = s.graine.trim();
  if (graine !== "" && !GRAINE.test(graine)) {
    erreurs.graine = t(
      "Graine : lettres, chiffres, « _ » et « - », 64 caractères au plus.",
      'Seed: letters, digits, "_" and "-", 64 characters at most.',
    );
  }
  if (
    s.stratifier_par !== "" &&
    !(STRATES_ECHANTILLON as readonly string[]).includes(s.stratifier_par)
  ) {
    erreurs.stratifier_par = t(
      "Choisissez un axe de stratification connu.",
      "Choose a known stratification axis.",
    );
  }
  if (!vide(erreurs)) return { ok: false, erreurs };
  const r = campagneFroideCreationSchema.safeParse({
    intitule,
    criteres: {
      periode_debut: s.periode_debut,
      periode_fin: s.periode_fin,
      types_mission_ids: s.types_mission_ids,
      directeur_ids: s.directeur_ids,
      stratifier_par: s.stratifier_par === "" ? null : s.stratifier_par,
      exclure_deja_revues: s.exclure_deja_revues,
    },
    taille,
    ...(graine === "" ? {} : { graine }),
  });
  return r.success
    ? { ok: true, charge: r.data }
    : { ok: false, erreurs: refusSchema(r.error, CHAMPS_CAMPAGNE, "intitule", langue) };
}

// --- Grille de revue -------------------------------------------------------------------------

export const NOTE_SANS_OBJET = "sans_objet";

export interface SaisieEvaluation {
  critere: string;
  /** « 1 » à « 5 », « sans_objet » ou vide (non choisi). */
  note: string;
  commentaire: string;
}

export function validerEvaluation(
  s: SaisieEvaluation,
  langue: Langue = "fr",
): Resultat<ReturnType<typeof evaluationRevueFroideSchema.parse>, "note" | "commentaire"> {
  const t = creerTraduire(langue);
  const erreurs: Erreurs<"note" | "commentaire"> = {};
  const sansObjet = s.note === NOTE_SANS_OBJET;
  if (!sansObjet && !["1", "2", "3", "4", "5"].includes(s.note)) {
    erreurs.note = t(
      "Choisissez une note de 1 à 5, ou « sans objet ».",
      'Choose a score from 1 to 5, or "not applicable".',
    );
  }
  const commentaire = s.commentaire.trim();
  if (sansObjet && commentaire === "") {
    erreurs.commentaire = t(
      "Justifiez un critère sans objet.",
      "Justify a criterion marked not applicable.",
    );
  }
  if (commentaire.length > 2000) {
    erreurs.commentaire = t(
      "Le commentaire ne doit pas dépasser 2000 caractères.",
      "The comment must not exceed 2000 characters.",
    );
  }
  if (!vide(erreurs)) return { ok: false, erreurs };
  const r = evaluationRevueFroideSchema.safeParse({
    critere: s.critere,
    note: sansObjet ? null : Number(s.note),
    commentaire: texteOuNull(s.commentaire),
  });
  return r.success
    ? { ok: true, charge: r.data }
    : { ok: false, erreurs: refusSchema(r.error, ["note", "commentaire"], "note", langue) };
}

export interface SaisieConstat {
  critere: string;
  gravite: string;
  description: string;
  recommandation: string;
}

export function validerConstat(
  s: SaisieConstat,
  langue: Langue = "fr",
): Resultat<
  ReturnType<typeof constatFroidCreationSchema.parse>,
  "critere" | "gravite" | "description" | "recommandation"
> {
  const t = creerTraduire(langue);
  const erreurs: Erreurs<"critere" | "gravite" | "description" | "recommandation"> = {};
  if (!(GRAVITES_CONSTAT_FROID as readonly string[]).includes(s.gravite)) {
    erreurs.gravite = t("Choisissez la gravité du constat.", "Choose the severity of the finding.");
  }
  if (s.critere !== "" && !(CODES_CRITERES_REVUE_FROIDE as readonly string[]).includes(s.critere)) {
    erreurs.critere = t("Critère inconnu.", "Unknown criterion.");
  }
  const description = s.description.trim();
  if (description === "") {
    erreurs.description = t("Décrivez le constat.", "Describe the finding.");
  } else if (description.length > 2000) {
    erreurs.description = t(
      "La description ne doit pas dépasser 2000 caractères.",
      "The description must not exceed 2000 characters.",
    );
  }
  if (s.recommandation.trim().length > 2000) {
    erreurs.recommandation = t(
      "La recommandation ne doit pas dépasser 2000 caractères.",
      "The recommendation must not exceed 2000 characters.",
    );
  }
  if (!vide(erreurs)) return { ok: false, erreurs };
  const r = constatFroidCreationSchema.safeParse({
    critere: s.critere === "" ? null : s.critere,
    gravite: s.gravite,
    description,
    recommandation: texteOuNull(s.recommandation),
  });
  return r.success
    ? { ok: true, charge: r.data }
    : {
        ok: false,
        erreurs: refusSchema(
          r.error,
          ["critere", "gravite", "description", "recommandation"],
          "description",
          langue,
        ),
      };
}

export function validerTerminaison(
  synthese: string,
  langue: Langue = "fr",
): Resultat<{ synthese: string }, "synthese"> {
  const tr = creerTraduire(langue);
  const t = synthese.trim();
  if (t === "") {
    return {
      ok: false,
      erreurs: {
        synthese: tr("La synthèse de la revue est obligatoire.", "The review summary is required."),
      },
    };
  }
  if (t.length > 4000) {
    return {
      ok: false,
      erreurs: {
        synthese: tr(
          "La synthèse ne doit pas dépasser 4000 caractères.",
          "The summary must not exceed 4000 characters.",
        ),
      },
    };
  }
  const r = revueFroideTerminaisonSchema.safeParse({ synthese: t });
  return r.success
    ? { ok: true, charge: r.data }
    : {
        ok: false,
        erreurs: { synthese: langue === "en" ? MESSAGE_SAISIE_REFUSEE_EN : MESSAGE_SAISIE_REFUSEE },
      };
}

// --- Plan d'amélioration ---------------------------------------------------------------------

export interface SaisieAction {
  titre: string;
  description: string;
  constat_id: string;
  responsable_id: string;
  echeance: string;
}
export type ChampAction = "titre" | "description" | "constat_id" | "responsable_id" | "echeance";
const CHAMPS_ACTION: readonly ChampAction[] = [
  "titre",
  "description",
  "constat_id",
  "responsable_id",
  "echeance",
];

export function validerAction(
  s: SaisieAction,
  langue: Langue = "fr",
): Resultat<ReturnType<typeof actionFroideCreationSchema.parse>, ChampAction> {
  const t = creerTraduire(langue);
  const erreurs: Erreurs<ChampAction> = {};
  const titre = s.titre.trim();
  if (titre === "") {
    erreurs.titre = t("Donnez un titre à l'action.", "Give the action a title.");
  } else if (titre.length > 200) {
    erreurs.titre = t(
      "Le titre ne doit pas dépasser 200 caractères.",
      "The title must not exceed 200 characters.",
    );
  }
  if (s.description.trim().length > 2000) {
    erreurs.description = t(
      "La description ne doit pas dépasser 2000 caractères.",
      "The description must not exceed 2000 characters.",
    );
  }
  if (!UUID.test(s.responsable_id)) {
    erreurs.responsable_id = t(
      "Choisissez le responsable de l'action.",
      "Choose the person responsible for the action.",
    );
  }
  if (s.constat_id !== "" && !UUID.test(s.constat_id)) {
    erreurs.constat_id = t("Constat inconnu.", "Unknown finding.");
  }
  if (!dateValide(s.echeance)) {
    erreurs.echeance = t("Indiquez l'échéance de l'action.", "Enter the action's due date.");
  }
  if (!vide(erreurs)) return { ok: false, erreurs };
  const r = actionFroideCreationSchema.safeParse({
    titre,
    description: texteOuNull(s.description),
    constat_id: s.constat_id === "" ? null : s.constat_id,
    responsable_id: s.responsable_id,
    echeance: s.echeance,
  });
  return r.success
    ? { ok: true, charge: r.data }
    : { ok: false, erreurs: refusSchema(r.error, CHAMPS_ACTION, "titre", langue) };
}

export interface SaisieSuiviAction {
  statut: string;
  responsable_id: string;
  echeance: string;
  commentaire: string;
}
export type ChampSuiviAction = "statut" | "responsable_id" | "echeance" | "commentaire";

/**
 * Suivi d'une action : seuls les champs modifiés partent. Clôturer (faite ou abandonnée) exige un
 * commentaire ; sans modification, la saisie est refusée.
 */
export function validerSuiviAction(
  s: SaisieSuiviAction,
  actuel: { responsable_id: string; echeance: string },
  langue: Langue = "fr",
): Resultat<ReturnType<typeof actionFroideModificationSchema.parse>, ChampSuiviAction> {
  const t = creerTraduire(langue);
  const erreurs: Erreurs<ChampSuiviAction> = {};
  if (s.statut !== "" && !(STATUTS_ACTION_FROIDE as readonly string[]).includes(s.statut)) {
    erreurs.statut = t("Statut inconnu.", "Unknown status.");
  }
  const cloture = s.statut === "faite" || s.statut === "abandonnee";
  const commentaire = s.commentaire.trim();
  if (cloture && commentaire === "") {
    erreurs.commentaire =
      s.statut === "faite"
        ? t("Commentez la clôture : résultat obtenu.", "Comment on the close-out: result achieved.")
        : t(
            "Commentez l'abandon : indiquez la raison.",
            "Comment on the abandonment: give the reason.",
          );
  }
  if (commentaire.length > 2000) {
    erreurs.commentaire = t(
      "Le commentaire ne doit pas dépasser 2000 caractères.",
      "The comment must not exceed 2000 characters.",
    );
  }
  const responsable =
    s.responsable_id !== "" && s.responsable_id !== actuel.responsable_id
      ? s.responsable_id
      : undefined;
  if (responsable !== undefined && !UUID.test(responsable)) {
    erreurs.responsable_id = t("Responsable inconnu.", "Unknown owner.");
  }
  const echeance = s.echeance !== "" && s.echeance !== actuel.echeance ? s.echeance : undefined;
  if (echeance !== undefined && !dateValide(echeance))
    erreurs.echeance = t("Échéance invalide.", "Invalid due date.");
  if (vide(erreurs) && s.statut === "" && responsable === undefined && echeance === undefined) {
    erreurs.statut = t(
      "Rien à modifier : choisissez un nouveau statut, un responsable ou une échéance.",
      "Nothing to change: choose a new status, an owner or a due date.",
    );
  }
  if (!vide(erreurs)) return { ok: false, erreurs };
  const r = actionFroideModificationSchema.safeParse({
    ...(s.statut === "" ? {} : { statut: s.statut }),
    ...(responsable === undefined ? {} : { responsable_id: responsable }),
    ...(echeance === undefined ? {} : { echeance }),
    ...(commentaire === "" ? {} : { commentaire }),
  });
  return r.success
    ? { ok: true, charge: r.data }
    : {
        ok: false,
        erreurs: refusSchema(
          r.error,
          ["statut", "responsable_id", "echeance", "commentaire"],
          "statut",
          langue,
        ),
      };
}

/**
 * Erreur de champ à afficher : celle du dernier envoi, sauf si le champ a été modifié depuis
 * (ou si le panneau de confirmation s'est ouvert), auquel cas elle est périmée et disparaît.
 */
export const erreurChampAffichee = (
  erreur: string | undefined,
  perimee: boolean,
): string | undefined => (perimee ? undefined : erreur);

/**
 * Erreur globale (bandeau de l'API) à afficher : celle du dernier envoi, sauf si l'état qui l'a
 * causée a changé depuis (synthèse modifiée, panneau de confirmation ouvert). Une erreur d'un
 * nouvel envoi n'est jamais périmée : l'appelant réinitialise `perimee` avant d'envoyer.
 */
export const erreurGlobaleAffichee = (erreur: string | null, perimee: boolean): string | null =>
  perimee ? null : erreur;
