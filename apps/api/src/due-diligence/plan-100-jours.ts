import { planCentJours, type ActionCentJours, type DateISO } from "@missionpilot/engines";
import {
  aPermission,
  PLAFONDS_DD,
  type planActionCreationSchema,
  type planActionVersionSchema,
} from "@missionpilot/shared";
import type { z } from "zod";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, requeteInvalide } from "../errors.js";
import { filtreVisibilite, voitToutesLesMissions } from "../missions/acces.js";
import { aujourdhui } from "../missions/outils.js";
import { estMembreActifMission } from "../preuves/acces.js";
import {
  exigerPlafondElements,
  exigerVersionCourante,
  exigerVersionsRestantes,
  type DossierLu,
  type ElementLu,
} from "./acces.js";
import { cadrageCourant } from "./dossiers.js";
import {
  CHAMPS_VIDES,
  champsDe,
  elementCourant,
  elementsCourants,
  fusionner,
  insererElement,
  insererVersionElement,
  type ChampsVersion,
  type ElementCourant,
} from "./elements.js";
import { vuePlan } from "./vues.js";

/*
 * Plan des 100 jours (DD-15, SPEC-3b §8.7, R43 à R45) : actions datées par rapport à la date de
 * l'opération, reliées à une initiative d'un plan stratégique (service #3) et à un KPI (service #4)
 * DU MÊME CLIENT, par clés composites (MPZ30 doublé ici en 400 LIEN_INCOHERENT). La synthèse
 * (phases, retards, taux de réalisation) sort du moteur. Un lien n'est RÉSOLU (libellé) que si
 * l'appelant a `plan.lire` / `kpi.lire` ET voit la mission cible : sinon `{ id: null, masque: true }`
 * (aucune fuite de titre).
 */

export type CorpsAction = z.infer<typeof planActionCreationSchema>;
export type CorpsActionVersion = z.infer<typeof planActionVersionSchema>;

function lienIncoherent(message: string): AppError {
  return new AppError(400, "LIEN_INCOHERENT", message);
}

async function verifierLiens(
  db: Db,
  auth: Auth,
  dossier: DossierLu,
  liens: { responsable_id: string | null; plan_element_id: string | null; kpi_id: string | null },
  changes: { responsable: boolean; plan: boolean; kpi: boolean },
): Promise<void> {
  const voit = voitToutesLesMissions(auth);
  if (changes.responsable && liens.responsable_id !== null) {
    if (!(await estMembreActifMission(db, dossier.mission_id, liens.responsable_id))) {
      throw lienIncoherent("Le responsable d'une action est un membre actif de la mission.");
    }
  }
  if (changes.plan && liens.plan_element_id !== null) {
    const r = await db.query(
      `SELECT 1 FROM plan_elements pe
         JOIN plans_strategiques p ON p.id = pe.plan_id
         JOIN missions m ON m.id = p.mission_id
       WHERE pe.id = $1 AND pe.type = 'initiative' AND m.client_id = $2
         AND ${filtreVisibilite(3, 4)}`,
      [liens.plan_element_id, dossier.client_id, voit, auth.utilisateurId],
    );
    if (!r.rows[0]) {
      throw lienIncoherent(
        "L'initiative désignée n'appartient pas à un plan visible du même client.",
      );
    }
  }
  if (changes.kpi && liens.kpi_id !== null) {
    const r = await db.query(
      `SELECT 1 FROM kpi_definitions k JOIN missions m ON m.id = k.mission_id
       WHERE k.id = $1 AND k.client_id = $2 AND ${filtreVisibilite(3, 4)}`,
      [liens.kpi_id, dossier.client_id, voit, auth.utilisateurId],
    );
    if (!r.rows[0]) {
      throw lienIncoherent("Le KPI désigné n'appartient pas à une mission visible du même client.");
    }
  }
}

export async function creerAction(
  db: Db,
  auth: Auth,
  dossier: DossierLu,
  c: CorpsAction,
): Promise<{ id: string; version: 1 }> {
  await exigerPlafondElements(
    db,
    dossier.id,
    "action_100j",
    PLAFONDS_DD.actions_par_dossier,
    "actions du plan des 100 jours par dossier",
  );
  await verifierLiens(db, auth, dossier, c, { responsable: true, plan: true, kpi: true });
  const id = await insererElement(db, auth, { dossierId: dossier.id, type: "action_100j" });
  await insererVersionElement(
    db,
    auth,
    { id, type: "action_100j" },
    1,
    {
      ...CHAMPS_VIDES,
      libelle: c.libelle,
      description: c.description,
      jour_debut: c.jour_debut,
      jour_fin: c.jour_fin,
      statut_action: c.statut_action,
      responsable_id: c.responsable_id,
      plan_element_id: c.plan_element_id,
      kpi_id: c.kpi_id,
    },
    null,
  );
  return { id, version: 1 };
}

export async function corrigerAction(
  db: Db,
  auth: Auth,
  dossier: DossierLu,
  element: ElementLu,
  c: CorpsActionVersion,
): Promise<number> {
  const courant = await elementCourant(db, element.id);
  exigerVersionCourante(c.version_courante, courant.version);
  exigerVersionsRestantes(courant.version + 1, PLAFONDS_DD.versions_par_objet);
  const suivant: ChampsVersion = fusionner(champsDe(courant), {
    libelle: c.libelle,
    description: c.description,
    jour_debut: c.jour_debut,
    jour_fin: c.jour_fin,
    statut_action: c.statut_action,
    responsable_id: c.responsable_id,
    plan_element_id: c.plan_element_id,
    kpi_id: c.kpi_id,
    retire: c.retire,
  });
  if ((suivant.jour_debut as number) > (suivant.jour_fin as number)) {
    throw requeteInvalide("Le jour de fin ne précède pas le jour de début.");
  }
  await verifierLiens(db, auth, dossier, suivant, {
    responsable: suivant.responsable_id !== courant.responsable_id,
    plan: suivant.plan_element_id !== courant.plan_element_id,
    kpi: suivant.kpi_id !== courant.kpi_id,
  });
  await insererVersionElement(db, auth, courant, courant.version + 1, suivant, c.motif);
  return courant.version + 1;
}

export function actionsPourMoteur(actions: readonly ElementCourant[]): ActionCentJours[] {
  return actions.map((a) => ({
    id: a.id,
    jourDebut: a.jour_debut as number,
    jourFin: a.jour_fin as number,
    statut: a.statut_action as ActionCentJours["statut"],
    responsableId: a.responsable_id,
    reliePlan: a.plan_element_id !== null,
    relieKpi: a.kpi_id !== null,
  }));
}

/** Synthèse du moteur sur les actions courantes d'un dossier (date du jour : paramètre). */
export async function synthesePlan(db: Db, dossierId: string) {
  const cadrage = await cadrageCourant(db, dossierId);
  const actions = await elementsCourants(
    db,
    dossierId,
    "action_100j",
    PLAFONDS_DD.actions_par_dossier,
  );
  const synthese = planCentJours({
    dateOperation: cadrage.date_operation as DateISO | null,
    aujourdhui: aujourdhui() as DateISO,
    actions: actionsPourMoteur(actions),
  });
  return { cadrage, actions, synthese };
}

type Lien = { id: string; libelle: string; mission_id: string } | { id: null; masque: true };

/** Libellés des initiatives et des KPI visibles ; les autres sont masqués (aucune fuite de titre). */
async function resoudreLiens(db: Db, auth: Auth, actions: readonly ElementCourant[]) {
  const voit = voitToutesLesMissions(auth);
  const planIds = [
    ...new Set(actions.flatMap((a) => (a.plan_element_id ? [a.plan_element_id] : []))),
  ];
  const kpiIds = [...new Set(actions.flatMap((a) => (a.kpi_id ? [a.kpi_id] : [])))];
  const plans = new Map<string, Lien>();
  const kpis = new Map<string, Lien>();
  if (planIds.length > 0 && aPermission(auth.roles, "plan.lire")) {
    const r = await db.query(
      `SELECT pe.id, pv.contenu ->> 'titre' AS libelle, p.mission_id
       FROM plan_elements pe
         JOIN plans_strategiques p ON p.id = pe.plan_id
         JOIN missions m ON m.id = p.mission_id
         JOIN LATERAL (SELECT v.contenu FROM plan_element_versions v WHERE v.element_id = pe.id
                       ORDER BY v.version DESC LIMIT 1) pv ON true
       WHERE pe.id = ANY ($1::uuid[]) AND ${filtreVisibilite(2, 3)}`,
      [planIds, voit, auth.utilisateurId],
    );
    for (const l of r.rows) {
      plans.set(l.id as string, {
        id: l.id as string,
        libelle: (l.libelle as string | null) ?? "Initiative",
        mission_id: l.mission_id as string,
      });
    }
  }
  if (kpiIds.length > 0 && aPermission(auth.roles, "kpi.lire")) {
    const r = await db.query(
      `SELECT k.id, k.libelle, k.mission_id FROM kpi_definitions k
         JOIN missions m ON m.id = k.mission_id
       WHERE k.id = ANY ($1::uuid[]) AND ${filtreVisibilite(2, 3)}`,
      [kpiIds, voit, auth.utilisateurId],
    );
    for (const l of r.rows) {
      kpis.set(l.id as string, {
        id: l.id as string,
        libelle: l.libelle as string,
        mission_id: l.mission_id as string,
      });
    }
  }
  const masque: Lien = { id: null, masque: true };
  return {
    plan: (id: string | null) => (id === null ? null : (plans.get(id) ?? masque)),
    kpi: (id: string | null) => (id === null ? null : (kpis.get(id) ?? masque)),
  };
}

/** R43 : actions courantes, liens résolus ou masqués, synthèse du moteur. */
export async function lirePlan(db: Db, auth: Auth, dossierId: string) {
  const { cadrage, actions, synthese } = await synthesePlan(db, dossierId);
  const liens = await resoudreLiens(db, auth, actions);
  const responsables = new Map<string, string>();
  const ids = [...new Set(actions.flatMap((a) => (a.responsable_id ? [a.responsable_id] : [])))];
  if (ids.length > 0) {
    const r = await db.query("SELECT id, nom FROM utilisateurs WHERE id = ANY ($1::uuid[])", [ids]);
    for (const u of r.rows) responsables.set(u.id as string, u.nom as string);
  }
  const parId = new Map(synthese.actions.map((a) => [a.id, a]));
  return {
    date_operation: cadrage.date_operation,
    actions: [...actions]
      .sort(
        (a, b) =>
          (a.jour_debut as number) - (b.jour_debut as number) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )
      .map((a) => {
        const s = parId.get(a.id);
        return {
          id: a.id,
          version: a.version,
          libelle: a.libelle,
          description: a.description,
          jour_debut: a.jour_debut,
          jour_fin: a.jour_fin,
          date_debut: s?.dateDebut ?? null,
          date_fin: s?.dateFin ?? null,
          phase: s?.phase ?? null,
          statut_action: a.statut_action,
          en_retard: s?.enRetard ?? false,
          responsable:
            a.responsable_id === null
              ? null
              : { id: a.responsable_id, nom: responsables.get(a.responsable_id) ?? null },
          plan_element: liens.plan(a.plan_element_id),
          kpi: liens.kpi(a.kpi_id),
        };
      }),
    synthese: vuePlan(synthese),
  };
}
