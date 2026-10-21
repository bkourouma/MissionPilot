/**
 * Validations de saisie de la revue à froid (QUA-05) : messages français par champ, puis charge
 * confirmée par les schémas partagés (`packages/shared`, les mêmes que l'API). Aucun calcul
 * métier : le score, la conclusion et les indicateurs viennent de l'API.
 */
import {
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
): Erreurs<K> {
  const erreurs: Erreurs<K> = {};
  for (const issue of erreur.issues) {
    const champ = issue.path
      .map(String)
      .find((p): p is K => (champs as readonly string[]).includes(p));
    erreurs[champ ?? defaut] ??= MESSAGE_SAISIE_REFUSEE;
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
): Resultat<CampagneFroideCreation, ChampCampagne> {
  const erreurs: Erreurs<ChampCampagne> = {};
  const intitule = s.intitule.trim();
  if (intitule === "") erreurs.intitule = "Donnez un intitulé à la campagne.";
  else if (intitule.length > 200)
    erreurs.intitule = "L'intitulé ne doit pas dépasser 200 caractères.";
  if (!dateValide(s.periode_debut))
    erreurs.periode_debut = "Indiquez le début de la période de clôture.";
  if (!dateValide(s.periode_fin)) erreurs.periode_fin = "Indiquez la fin de la période de clôture.";
  else if (dateValide(s.periode_debut) && s.periode_fin < s.periode_debut) {
    erreurs.periode_fin = "La fin de période précède son début.";
  }
  const taille = s.taille.trim() === "" ? Number.NaN : Number(s.taille.trim());
  if (!Number.isInteger(taille) || taille < 1 || taille > BORNES_REVUE_FROIDE.taille) {
    erreurs.taille = `La taille est un entier de 1 à ${BORNES_REVUE_FROIDE.taille}.`;
  }
  const graine = s.graine.trim();
  if (graine !== "" && !GRAINE.test(graine)) {
    erreurs.graine = "Graine : lettres, chiffres, « _ » et « - », 64 caractères au plus.";
  }
  if (
    s.stratifier_par !== "" &&
    !(STRATES_ECHANTILLON as readonly string[]).includes(s.stratifier_par)
  ) {
    erreurs.stratifier_par = "Choisissez un axe de stratification connu.";
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
    : { ok: false, erreurs: refusSchema(r.error, CHAMPS_CAMPAGNE, "intitule") };
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
): Resultat<ReturnType<typeof evaluationRevueFroideSchema.parse>, "note" | "commentaire"> {
  const erreurs: Erreurs<"note" | "commentaire"> = {};
  const sansObjet = s.note === NOTE_SANS_OBJET;
  if (!sansObjet && !["1", "2", "3", "4", "5"].includes(s.note)) {
    erreurs.note = "Choisissez une note de 1 à 5, ou « sans objet ».";
  }
  const commentaire = s.commentaire.trim();
  if (sansObjet && commentaire === "") erreurs.commentaire = "Justifiez un critère sans objet.";
  if (commentaire.length > 2000)
    erreurs.commentaire = "Le commentaire ne doit pas dépasser 2000 caractères.";
  if (!vide(erreurs)) return { ok: false, erreurs };
  const r = evaluationRevueFroideSchema.safeParse({
    critere: s.critere,
    note: sansObjet ? null : Number(s.note),
    commentaire: texteOuNull(s.commentaire),
  });
  return r.success
    ? { ok: true, charge: r.data }
    : { ok: false, erreurs: refusSchema(r.error, ["note", "commentaire"], "note") };
}

export interface SaisieConstat {
  critere: string;
  gravite: string;
  description: string;
  recommandation: string;
}

export function validerConstat(
  s: SaisieConstat,
): Resultat<
  ReturnType<typeof constatFroidCreationSchema.parse>,
  "critere" | "gravite" | "description" | "recommandation"
> {
  const erreurs: Erreurs<"critere" | "gravite" | "description" | "recommandation"> = {};
  if (!(GRAVITES_CONSTAT_FROID as readonly string[]).includes(s.gravite)) {
    erreurs.gravite = "Choisissez la gravité du constat.";
  }
  if (s.critere !== "" && !(CODES_CRITERES_REVUE_FROIDE as readonly string[]).includes(s.critere)) {
    erreurs.critere = "Critère inconnu.";
  }
  const description = s.description.trim();
  if (description === "") erreurs.description = "Décrivez le constat.";
  else if (description.length > 2000)
    erreurs.description = "La description ne doit pas dépasser 2000 caractères.";
  if (s.recommandation.trim().length > 2000) {
    erreurs.recommandation = "La recommandation ne doit pas dépasser 2000 caractères.";
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
        ),
      };
}

export function validerTerminaison(synthese: string): Resultat<{ synthese: string }, "synthese"> {
  const t = synthese.trim();
  if (t === "")
    return { ok: false, erreurs: { synthese: "La synthèse de la revue est obligatoire." } };
  if (t.length > 4000) {
    return {
      ok: false,
      erreurs: { synthese: "La synthèse ne doit pas dépasser 4000 caractères." },
    };
  }
  const r = revueFroideTerminaisonSchema.safeParse({ synthese: t });
  return r.success
    ? { ok: true, charge: r.data }
    : { ok: false, erreurs: { synthese: MESSAGE_SAISIE_REFUSEE } };
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
): Resultat<ReturnType<typeof actionFroideCreationSchema.parse>, ChampAction> {
  const erreurs: Erreurs<ChampAction> = {};
  const titre = s.titre.trim();
  if (titre === "") erreurs.titre = "Donnez un titre à l'action.";
  else if (titre.length > 200) erreurs.titre = "Le titre ne doit pas dépasser 200 caractères.";
  if (s.description.trim().length > 2000)
    erreurs.description = "La description ne doit pas dépasser 2000 caractères.";
  if (!UUID.test(s.responsable_id))
    erreurs.responsable_id = "Choisissez le responsable de l'action.";
  if (s.constat_id !== "" && !UUID.test(s.constat_id)) erreurs.constat_id = "Constat inconnu.";
  if (!dateValide(s.echeance)) erreurs.echeance = "Indiquez l'échéance de l'action.";
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
    : { ok: false, erreurs: refusSchema(r.error, CHAMPS_ACTION, "titre") };
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
): Resultat<ReturnType<typeof actionFroideModificationSchema.parse>, ChampSuiviAction> {
  const erreurs: Erreurs<ChampSuiviAction> = {};
  if (s.statut !== "" && !(STATUTS_ACTION_FROIDE as readonly string[]).includes(s.statut)) {
    erreurs.statut = "Statut inconnu.";
  }
  const cloture = s.statut === "faite" || s.statut === "abandonnee";
  const commentaire = s.commentaire.trim();
  if (cloture && commentaire === "") {
    erreurs.commentaire =
      s.statut === "faite"
        ? "Commentez la clôture : résultat obtenu."
        : "Commentez l'abandon : indiquez la raison.";
  }
  if (commentaire.length > 2000)
    erreurs.commentaire = "Le commentaire ne doit pas dépasser 2000 caractères.";
  const responsable =
    s.responsable_id !== "" && s.responsable_id !== actuel.responsable_id
      ? s.responsable_id
      : undefined;
  if (responsable !== undefined && !UUID.test(responsable))
    erreurs.responsable_id = "Responsable inconnu.";
  const echeance = s.echeance !== "" && s.echeance !== actuel.echeance ? s.echeance : undefined;
  if (echeance !== undefined && !dateValide(echeance)) erreurs.echeance = "Échéance invalide.";
  if (vide(erreurs) && s.statut === "" && responsable === undefined && echeance === undefined) {
    erreurs.statut =
      "Rien à modifier : choisissez un nouveau statut, un responsable ou une échéance.";
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
        ),
      };
}
