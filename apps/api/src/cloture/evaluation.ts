import { decisionCloture, type LigneCloture } from "@missionpilot/engines";
import { aPermission, CONTROLES_PAR_ATTESTATION, type ControleCloture } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { estAssocie } from "../missions/acces.js";
import { executerControle } from "./controles.js";
import { lireModele, type ItemModele } from "./modele.js";

/*
 * Évaluation de la check-list de clôture d'une mission (AUT-08) : les contrôles actifs du modèle
 * du cabinet sont exécutés, la décision (clôture autorisée ou items bloquants) est celle du
 * moteur `decisionCloture`. Une évaluation n'écrit que si on le demande : le résultat d'un
 * contrôle est ajouté à l'historique (ajout seul, 0321) quand il diffère du dernier enregistré,
 * ou toujours au moment de la clôture.
 */

export interface DerogationEnVigueur {
  motif: string;
  par: string;
  par_nom: string | null;
  le: Date;
}

export interface AttestationEnVigueur {
  attestee: boolean;
  note: string | null;
  par: string;
  par_nom: string | null;
  le: Date;
}

export interface ItemEvalue extends ItemModele {
  etat: LigneCloture["etat"];
  nombre_ecarts: number | null;
  derogation: DerogationEnVigueur | null;
  attestation: AttestationEnVigueur | null;
  verifie_le: Date | null;
}

export interface EvaluationCloture {
  mission_id: string;
  autorisee: boolean;
  /** Codes des contrôles bloquants non conformes et sans dérogation. */
  bloquants: ControleCloture[];
  items: ItemEvalue[];
}

export async function derogationsEnVigueur(
  db: Db,
  missionId: string,
): Promise<Map<ControleCloture, DerogationEnVigueur>> {
  const r = await db.query(
    `SELECT d.controle, d.action, d.motif, d.par, u.nom AS par_nom, d.le FROM (
       SELECT DISTINCT ON (controle) * FROM cloture_derogations
        WHERE mission_id = $1 ORDER BY controle, le DESC, id DESC
     ) d LEFT JOIN utilisateurs u ON u.id = d.par`,
    [missionId],
  );
  return new Map(
    r.rows
      .filter((l) => l.action === "accordee")
      .map((l) => [
        l.controle as ControleCloture,
        { motif: l.motif, par: l.par, par_nom: l.par_nom, le: l.le } as DerogationEnVigueur,
      ]),
  );
}

async function attestationsEnVigueur(
  db: Db,
  missionId: string,
): Promise<Map<ControleCloture, AttestationEnVigueur>> {
  const r = await db.query(
    `SELECT v.controle, v.resultat, v.note, v.verifie_par AS par, u.nom AS par_nom, v.verifie_le AS le FROM (
       SELECT DISTINCT ON (controle) * FROM cloture_verifications
        WHERE mission_id = $1 AND origine = 'attestation'
        ORDER BY controle, verifie_le DESC, id DESC
     ) v LEFT JOIN utilisateurs u ON u.id = v.verifie_par`,
    [missionId],
  );
  return new Map(
    r.rows.map((l) => [
      l.controle as ControleCloture,
      {
        attestee: l.resultat === "conforme",
        note: l.note,
        par: l.par,
        par_nom: l.par_nom,
        le: l.le,
      } as AttestationEnVigueur,
    ]),
  );
}

interface VerificationPrecedente {
  resultat: string;
  nombre_ecarts: number | null;
  bloquant: boolean;
  le: Date;
}

async function dernieresVerifications(
  db: Db,
  missionId: string,
): Promise<Map<string, VerificationPrecedente>> {
  const r = await db.query(
    `SELECT DISTINCT ON (controle) controle, resultat, nombre_ecarts, bloquant, verifie_le AS le
       FROM cloture_verifications WHERE mission_id = $1 AND origine = 'calcul'
      ORDER BY controle, verifie_le DESC, id DESC`,
    [missionId],
  );
  return new Map(r.rows.map((l) => [l.controle as string, l as VerificationPrecedente]));
}

export interface OptionsEvaluation {
  /** Si présent, les résultats nouveaux sont ajoutés à l'historique par cet utilisateur. */
  persister?: { auth: Auth; declencheur: "evaluation" | "cloture" };
}

/** Évalue la check-list d'une mission déjà vérifiée visible par l'appelant. */
export async function evaluerCloture(
  db: Db,
  missionId: string,
  options: OptionsEvaluation = {},
): Promise<EvaluationCloture> {
  const modele = await lireModele(db);
  const derogations = await derogationsEnVigueur(db, missionId);
  const attestations = await attestationsEnVigueur(db, missionId);
  const anciennes = await dernieresVerifications(db, missionId);

  const ecarts = new Map<ControleCloture, number | null>();
  for (const item of modele) {
    if (!item.actif) {
      ecarts.set(item.controle, null);
    } else if (CONTROLES_PAR_ATTESTATION.includes(item.controle)) {
      ecarts.set(item.controle, attestations.get(item.controle)?.attestee ? 0 : null);
    } else {
      ecarts.set(item.controle, await executerControle(db, item.controle, missionId));
    }
  }

  const decision = decisionCloture(
    modele.map((i) => ({
      controle: i.controle,
      actif: i.actif,
      bloquant: i.bloquant,
      nombre_ecarts: ecarts.get(i.controle) ?? null,
      derogation: derogations.has(i.controle),
    })),
  );

  if (options.persister) {
    const { auth, declencheur } = options.persister;
    for (const item of modele) {
      const n = ecarts.get(item.controle);
      if (!item.actif || n === undefined || n === null) continue;
      if (CONTROLES_PAR_ATTESTATION.includes(item.controle)) continue;
      const resultat = n === 0 ? "conforme" : "non_conforme";
      const avant = anciennes.get(item.controle);
      const inchange =
        avant !== undefined &&
        avant.resultat === resultat &&
        avant.nombre_ecarts === n &&
        avant.bloquant === item.bloquant;
      if (inchange && declencheur !== "cloture") continue;
      await db.query(
        `INSERT INTO cloture_verifications
           (cabinet_id, mission_id, controle, resultat, nombre_ecarts, bloquant, origine, declencheur, verifie_par)
         VALUES ($1, $2, $3, $4, $5, $6, 'calcul', $7, $8)`,
        [
          auth.cabinetId,
          missionId,
          item.controle,
          resultat,
          n,
          item.bloquant,
          declencheur,
          auth.utilisateurId,
        ],
      );
    }
  }

  const lignes = new Map(decision.lignes.map((l) => [l.controle, l]));
  return {
    mission_id: missionId,
    autorisee: decision.autorisee,
    bloquants: decision.bloquants as ControleCloture[],
    items: modele.map((i) => ({
      ...i,
      etat: (lignes.get(i.controle) as LigneCloture).etat,
      nombre_ecarts: ecarts.get(i.controle) ?? null,
      derogation: derogations.get(i.controle) ?? null,
      attestation: attestations.get(i.controle) ?? null,
      verifie_le: anciennes.get(i.controle)?.le ?? null,
    })),
  };
}

/**
 * Refuse la clôture (409 `CLOTURE_BLOQUEE`, liste des items bloquants dans `manquants`) tant
 * qu'un item bloquant est non conforme sans dérogation. Appelée par la route de clôture, dans sa
 * transaction ; en cas de succès, la vérification de clôture est ajoutée à l'historique.
 */
export async function exigerClotureAutorisee(
  db: Db,
  auth: Auth,
  missionId: string,
): Promise<EvaluationCloture> {
  const evaluation = await evaluerCloture(db, missionId, {
    persister: { auth, declencheur: "cloture" },
  });
  if (!evaluation.autorisee) {
    const libelles = evaluation.items
      .filter((i) => evaluation.bloquants.includes(i.controle))
      .map((i) => i.libelle);
    throw new AppError(
      409,
      "CLOTURE_BLOQUEE",
      `Clôture impossible : la check-list comporte des items bloquants (${libelles.join(", ")}).`,
      { manquants: evaluation.bloquants },
    );
  }
  // Séparation des tâches : qui a accordé une dérogation en vigueur ne clôt pas la mission
  // (sauf associé). Doublé en base par `controler_cloture_separation` (MPX03, 0323).
  if (!estAssocie(auth) && evaluation.items.some((i) => i.derogation?.par === auth.utilisateurId)) {
    throw new AppError(
      409,
      "DEROGATION_PAR_CLOTUREUR",
      "Séparation des tâches : vous avez accordé une dérogation de cette check-list ; un autre directeur de mission ou un associé clôt la mission.",
    );
  }
  return evaluation;
}

/** Contrôles dont le nombre d'écarts est une donnée financière (visible avec `facture.lire`). */
export const CONTROLES_CLOTURE_FINANCIERS: readonly ControleCloture[] = [
  "factures_emises",
  "encaissements_soldes",
];

/**
 * Projection d'une évaluation selon les droits : sans `facture.lire`, le nombre d'écarts des
 * contrôles financiers est ABSENT de la réponse (jamais masqué par un zéro) ; l'état de l'item
 * (conforme, bloqué…) reste servi.
 */
export function vueEvaluation(auth: Auth, e: EvaluationCloture): EvaluationCloture {
  if (aPermission(auth.roles, "facture.lire")) return e;
  return {
    ...e,
    items: e.items.map((i) => {
      if (!CONTROLES_CLOTURE_FINANCIERS.includes(i.controle)) return i;
      return Object.fromEntries(
        Object.entries(i).filter(([cle]) => cle !== "nombre_ecarts"),
      ) as unknown as ItemEvalue;
    }),
  };
}
