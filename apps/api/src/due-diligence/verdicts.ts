import { indicationVerdict } from "@missionpilot/engines";
import {
  PLAFONDS_DD,
  type verdictProposeSchema,
  type verdictValidationSchema,
} from "@missionpilot/shared";
import type { z } from "zod";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, introuvable } from "../errors.js";
import { estAssocieDd, exigerVersionCourante, type ElementLu } from "./acces.js";
import { ecrireAjustement } from "./ajustements.js";
import { elementCourant } from "./elements.js";
import {
  entreesVerdict,
  lireVerdicts,
  liensCourantsHypotheses,
  verdictEnAttenteDe,
  type VerdictLigne,
} from "./hypotheses.js";
import { chargerRegistre } from "./registre.js";

/*
 * Verdicts (DD-09, SPEC-3b §8.3, R21 à R23) : « chaque verdict est sourcé ». Un verdict est une
 * décision HUMAINE indiquée par un moteur : l'indication (`indicationVerdict`) est calculée ici sur
 * TOUTES les assertions liées à l'hypothèse, jamais reçue du client. Le verdict proposé fige la
 * photographie des assertions citées (identifiant, version, sens, indice, lecture) ; il ne prend
 * effet qu'une fois validé par un tiers (séparation des tâches API et base, MPZ25 ; associé
 * dispensé de la séparation, jamais du motif). Un verdict qui s'écarte de l'indication exige un
 * motif détaillé (20 caractères) et crée un ajustement tracé (DD-08).
 */

export type CorpsVerdict = z.infer<typeof verdictProposeSchema>;
export type CorpsValidationVerdict = z.infer<typeof verdictValidationSchema>;

const MOTIF_ECART_MIN = 20;

function sansSource(message: string): AppError {
  return new AppError(409, "VERDICT_SANS_SOURCE", message);
}

/** R21 : propose un verdict sur la version lue de l'hypothèse. */
export async function proposerVerdict(
  db: Db,
  auth: Auth,
  missionId: string,
  dossierId: string,
  hypothese: ElementLu,
  c: CorpsVerdict,
): Promise<{ id: string; indication_moteur: string; ecart_indication: boolean }> {
  const courant = await elementCourant(db, hypothese.id);
  exigerVersionCourante(c.hypothese_version, courant.version);
  if (courant.retire) {
    throw new AppError(409, "HYPOTHESE_RETIREE", "L'hypothèse est retirée : aucun verdict.");
  }
  const verdicts = await lireVerdicts(db, { dossierId: null, hypotheseId: hypothese.id });
  if (verdicts.length >= PLAFONDS_DD.verdicts_par_hypothese) {
    throw new AppError(409, "PLAFOND_ATTEINT", "Trop de verdicts pour cette hypothèse.");
  }
  if (await verdictEnAttenteDe(db, hypothese.id)) {
    throw new AppError(
      409,
      "VERDICT_EN_ATTENTE",
      "Un verdict de cette hypothèse attend déjà une décision.",
    );
  }
  const liens = await liensCourantsHypotheses(db, dossierId, hypothese.id);
  const registre = await chargerRegistre(db, missionId, [
    ...new Set(liens.map((l) => l.assertion_id)),
  ]);
  const entrees = entreesVerdict(liens, registre);
  const sensParAssertion = new Map(entrees.map((e) => [e.id, e.sens]));
  for (const id of c.assertions_citees) {
    if (!sensParAssertion.has(id)) {
      throw sansSource("Une assertion citée n'est pas liée à l'hypothèse (ou est abandonnée).");
    }
  }
  const sens = c.assertions_citees.map((id) => sensParAssertion.get(id));
  if (
    (c.verdict === "confirmee" && !sens.includes("soutient")) ||
    (c.verdict === "infirmee" && !sens.includes("contredit"))
  ) {
    throw sansSource(
      c.verdict === "confirmee"
        ? "Un verdict confirmé cite au moins une assertion qui soutient l'hypothèse."
        : "Un verdict infirmé cite au moins une assertion qui la contredit.",
    );
  }
  const indication = indicationVerdict(entrees);
  const ecart = c.verdict !== indication.indication;
  if (ecart && c.motif.trim().length < MOTIF_ECART_MIN) {
    throw new AppError(
      400,
      "MOTIF_DETAILLE_REQUIS",
      `Un verdict qui s'écarte de l'indication du moteur exige un motif détaillé (${MOTIF_ECART_MIN} caractères au moins).`,
    );
  }
  const photographie = c.assertions_citees.map((id) => {
    const evaluation = registre.etat.evaluations.get(id)?.solidite;
    return {
      assertion_id: id,
      version: registre.assertions.get(id)?.version ?? 1,
      sens: sensParAssertion.get(id),
      indice_num: evaluation?.numerateur ?? 0,
      indice_den: evaluation?.denominateur ?? 1,
      lecture: evaluation?.lecture ?? "fragile",
    };
  });
  const r = await db.query(
    `INSERT INTO dd_verdicts (cabinet_id, dossier_id, hypothese_id, hypothese_version, verdict,
       indication_moteur, motif, assertions_citees, proposee_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9) RETURNING id`,
    [
      auth.cabinetId,
      dossierId,
      hypothese.id,
      courant.version,
      c.verdict,
      indication.indication,
      c.motif,
      JSON.stringify(photographie),
      auth.utilisateurId,
    ],
  );
  const id = r.rows[0].id as string;
  if (ecart) {
    await ecrireAjustement(db, auth, {
      dossierId,
      cibleType: "verdict",
      cibleId: id,
      champ: "verdict",
      avant: indication.indication,
      apres: c.verdict,
      motif: c.motif,
    });
  }
  return { id, indication_moteur: indication.indication, ecart_indication: ecart };
}

/** R22 : verdicts d'une hypothèse (du plus récent au plus ancien) avec leur décision. */
export async function listerVerdicts(db: Db, hypotheseId: string) {
  const verdicts = await lireVerdicts(db, { dossierId: null, hypotheseId });
  return verdicts
    .slice()
    .reverse()
    .map((v) => ({
      id: v.id,
      numero: v.numero,
      verdict: v.verdict,
      indication_moteur: v.indication_moteur,
      motif: v.motif,
      assertions_citees: v.assertions_citees,
      proposee_par: v.proposee_par,
      proposee_par_nom: v.proposee_par_nom,
      proposee_le: v.proposee_le,
      decision:
        v.decision === null
          ? null
          : {
              decision: v.decision.decision,
              motif: v.decision.motif,
              valide_par: v.decision.valide_par,
              valide_par_nom: v.decision.valide_par_nom,
              valide_le: v.decision.valide_le,
            },
    }));
}

/** Même règle que le déclencheur `controler_dd_verdict_validation` (MPZ25), même requête. */
async function separationVerdictViolee(
  db: Db,
  verdictId: string,
  utilisateurId: string,
): Promise<boolean> {
  const r = await db.query(
    `SELECT (
       $2::uuid = v.proposee_par
       OR EXISTS (SELECT 1 FROM dd_elements e WHERE e.id = v.hypothese_id AND e.cree_par = $2::uuid)
       OR EXISTS (SELECT 1 FROM dd_element_versions ev
                  WHERE ev.element_id = v.hypothese_id AND ev.auteur_id = $2::uuid)
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(v.assertions_citees) c
           JOIN assertions a ON a.id = (c.value ->> 'assertion_id')::uuid
         WHERE a.cree_par = $2::uuid
            OR EXISTS (SELECT 1 FROM assertion_versions av
                       WHERE av.assertion_id = a.id AND av.cree_par = $2::uuid))
     ) AS viole FROM dd_verdicts v WHERE v.id = $1`,
    [verdictId, utilisateurId],
  );
  return r.rows[0]?.viole === true;
}

/** Le verdict est le dernier de son hypothèse et l'hypothèse n'a pas changé depuis (MPZ27). */
async function verdictAJour(db: Db, verdict: VerdictLigne): Promise<boolean> {
  const r = await db.query(
    `SELECT NOT EXISTS (SELECT 1 FROM dd_verdicts y
                        WHERE y.hypothese_id = v.hypothese_id AND y.numero > v.numero)
       AND v.hypothese_version = (SELECT max(ev.version) FROM dd_element_versions ev
                                  WHERE ev.element_id = v.hypothese_id) AS a_jour
     FROM dd_verdicts v WHERE v.id = $1`,
    [verdict.id],
  );
  return r.rows[0]?.a_jour === true;
}

/**
 * Chaque assertion citée est toujours liée à l'hypothèse dans le même sens, non abandonnée, à la
 * version photographiée (même règle que le déclencheur, MPZ27) : sinon le verdict reposerait sur
 * une source qui a changé depuis sa proposition.
 */
async function citationsAJour(db: Db, verdictId: string): Promise<boolean> {
  const r = await db.query(
    `SELECT NOT EXISTS (
       SELECT 1 FROM dd_verdicts v, jsonb_array_elements(v.assertions_citees) c
       WHERE v.id = $1 AND NOT (
         EXISTS (SELECT 1 FROM (SELECT l.action, l.sens FROM dd_hypothese_liens l
                                WHERE l.hypothese_id = v.hypothese_id
                                  AND l.assertion_id = (c.value ->> 'assertion_id')::uuid
                                ORDER BY l.numero DESC LIMIT 1) d
                 WHERE d.action = 'lier' AND d.sens = c.value ->> 'sens')
         AND EXISTS (SELECT 1 FROM (SELECT av.statut, av.version FROM assertion_versions av
                                    WHERE av.assertion_id = (c.value ->> 'assertion_id')::uuid
                                    ORDER BY av.version DESC LIMIT 1) a
                     WHERE a.statut <> 'abandonnee'
                       AND a.version = (c.value ->> 'version')::integer))
     ) AS a_jour`,
    [verdictId],
  );
  return r.rows[0]?.a_jour === true;
}

/**
 * La solidité COURANTE de chaque assertion citée (lecture et indice) est celle de la photographie :
 * une preuve contraire arrivée depuis la proposition change la base du verdict (VERDICT_PERIME).
 */
async function soliditeInchangee(
  db: Db,
  missionId: string,
  verdict: VerdictLigne,
): Promise<boolean> {
  const registre = await chargerRegistre(
    db,
    missionId,
    verdict.assertions_citees.map((c) => c.assertion_id),
  );
  return verdict.assertions_citees.every((c) => {
    const s = registre.etat.evaluations.get(c.assertion_id)?.solidite;
    return (
      s !== undefined &&
      s.lecture === c.lecture &&
      s.numerateur === c.indice_num &&
      s.denominateur === c.indice_den
    );
  });
}

/** Verdict (avec sa décision) d'un dossier : 404 s'il n'en fait pas partie. */
export async function lireVerdict(
  db: Db,
  id: string,
): Promise<VerdictLigne & { dossier_id: string }> {
  const r = await db.query("SELECT dossier_id, hypothese_id FROM dd_verdicts WHERE id = $1", [id]);
  if (!r.rows[0]) throw introuvable("Verdict");
  const verdicts = await lireVerdicts(db, {
    dossierId: null,
    hypotheseId: r.rows[0].hypothese_id as string,
  });
  const v = verdicts.find((x) => x.id === id);
  if (!v) throw introuvable("Verdict");
  return { ...v, dossier_id: r.rows[0].dossier_id as string };
}

/** R23 : un tiers valide ou rejette un verdict (décidé, périmé pour une validation, puis séparation des tâches). */
export async function validerVerdict(
  db: Db,
  auth: Auth,
  missionId: string,
  verdict: VerdictLigne,
  c: CorpsValidationVerdict,
): Promise<void> {
  if (verdict.decision !== null) {
    throw new AppError(
      409,
      "VERDICT_DEJA_DECIDE",
      "Ce verdict a déjà fait l'objet d'une décision.",
    );
  }
  // Seule une validation exige un verdict à jour : un verdict périmé peut toujours être rejeté.
  if (
    c.decision === "valide" &&
    !(
      (await verdictAJour(db, verdict)) &&
      (await citationsAJour(db, verdict.id)) &&
      (await soliditeInchangee(db, missionId, verdict))
    )
  ) {
    throw new AppError(
      409,
      "VERDICT_PERIME",
      "Ce verdict n'est plus à jour : l'hypothèse, une assertion citée ou sa solidité a changé, ou un autre verdict l'a remplacé.",
    );
  }
  if (!estAssocieDd(auth) && (await separationVerdictViolee(db, verdict.id, auth.utilisateurId))) {
    throw new AppError(
      403,
      "SEPARATION_DES_TACHES",
      "Un verdict ne se valide ni par son proposant, ni par l'auteur de l'hypothèse ou d'une assertion citée.",
    );
  }
  await db.query(
    `INSERT INTO dd_verdict_validations (cabinet_id, verdict_id, decision, motif, valide_par)
     VALUES ($1, $2, $3, $4, $5)`,
    [auth.cabinetId, verdict.id, c.decision, c.motif ?? null, auth.utilisateurId],
  );
}
