import { aPermission } from "@missionpilot/shared";
import {
  comparer,
  LIBELLE_ACTION_PLANIFIER_RELANCE,
  plierTexteCopilote,
  resumerPlanifierRelance,
  zero,
  type ParametresCopilote,
} from "@missionpilot/engines";
import { z } from "zod";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { relancerFactureManuellement } from "../finance/relance-manuelle.js";
import { situationFacture } from "../finance/paiements.js";
import { motifContient } from "../http/outils.js";
import { filtreVisibilite, voitToutesLesMissions } from "../missions/acces.js";
import { aujourdhui } from "../missions/outils.js";
import type { DefinitionAction, ExecutionAction, PreparationAction } from "./actions.js";
import type { ContexteOutil } from "./lecture.js";

/*
 * ACTION « planifier_relance » du copilote (AGT-08) : enregistrer une relance MANUELLE d'une
 * facture échue, SANS e-mail au client. C'est la seule « relance » dont un service existant permet
 * de fixer l'objet précis : `POST /api/factures/:id/relances` (finance/relance-manuelle.ts, droit
 * `encaissement.gerer`, facture de mission visible). La relance automatique (tâche quotidienne)
 * n'a pas d'objet ciblable, et l'envoi d'un e-mail au client reste une décision explicite de
 * l'écran de la facture (`envoyer_email`) : le copilote n'invente aucun mécanisme d'envoi. Il
 * enregistre la relance du niveau suivant (au plus 3), prévient l'équipe de gestion et prépare
 * l'e-mail, comme la route avec `envoyer_email: false`.
 *
 * FIN-02 : le résumé et la réponse ne portent aucun montant (numéro, client, dates, niveau).
 * Proposition : la facture doit être échue, restant due, visible, et ne pas avoir déjà une
 * relance manuelle aujourd'hui ; la confirmation revérifie tout par le service commun.
 */

const parametresSchema = z
  .object({ facture_id: z.string().uuid(), niveau: z.number().int().min(1).max(3) })
  .strict();

const CANDIDATES_MAX = 6;
const precision = (texte: string): PreparationAction => ({ type: "precision", texte });

interface FactureCandidate {
  id: string;
  numero: string | null;
  client: string;
}

/** Factures ÉCHUES visibles dont le numéro ou le client contient `cherche` (accents ignorés). */
async function chercherFactures(c: ContexteOutil, cherche: string): Promise<FactureCandidate[]> {
  const r = await c.db.query(
    `SELECT f.id, f.numero, cl.raison_sociale AS client
     FROM factures f JOIN missions m ON m.id = f.mission_id JOIN clients cl ON cl.id = f.client_id
     WHERE f.nature = 'facture' AND f.statut = 'emise' AND f.date_echeance < $4::date
       AND ${filtreVisibilite(1, 2)}
       AND (cap_sans_accents(coalesce(f.numero, '')) LIKE $5 OR cap_sans_accents(cl.raison_sociale) LIKE $5)
     ORDER BY f.date_echeance, f.id LIMIT $3`,
    [
      voitToutesLesMissions(c.auth),
      c.auth.utilisateurId,
      CANDIDATES_MAX + 1,
      c.aujourdhui,
      motifContient(cherche),
    ],
  );
  const trouvees = r.rows.map((l) => ({
    id: l.id as string,
    numero: (l.numero as string | null) ?? null,
    client: l.client as string,
  }));
  const exactes = trouvees.filter((f) => plierTexteCopilote(f.numero ?? "").trim() === cherche);
  return exactes.length === 1 ? exactes : trouvees;
}

/** Une relance MANUELLE a-t-elle déjà été enregistrée ce jour-là pour cette facture ? */
async function relanceManuelleDuJour(db: Db, factureId: string, jour: string): Promise<boolean> {
  const r = await db.query(
    `SELECT 1 FROM relances_factures
     WHERE facture_id = $1 AND mode = 'manuelle' AND date_relance = $2::date`,
    [factureId, jour],
  );
  return (r.rowCount ?? 0) > 0;
}

async function niveauSuivant(db: Db, factureId: string): Promise<number> {
  const r = await db.query(
    "SELECT coalesce(max(niveau), 0)::int AS n FROM relances_factures WHERE facture_id = $1",
    [factureId],
  );
  return Math.min(3, (r.rows[0].n as number) + 1);
}

async function preparerPlanifierRelance(
  c: ContexteOutil,
  p: ParametresCopilote["planifier_relance"],
): Promise<PreparationAction> {
  const cherche = plierTexteCopilote(p.facture).trim();
  const introuvable = precision(
    `Aucune facture échue visible ne correspond à « ${p.facture.trim()} ». Indiquez son numéro exact.`,
  );
  if (cherche === "") return introuvable;
  const candidates = await chercherFactures(c, cherche);
  if (candidates.length === 0) return introuvable;
  if (candidates.length > 1) {
    return precision(
      `Plusieurs factures échues correspondent à « ${p.facture.trim()} » : précisez le numéro (${candidates
        .slice(0, CANDIDATES_MAX)
        .map((f) => f.numero ?? "sans numéro")
        .join(", ")}).`,
    );
  }
  const f = candidates[0] as FactureCandidate;
  const s = await situationFacture(c.db, f.id, c.aujourdhui);
  if (
    !s ||
    s.situation.statut_paiement !== "en_retard" ||
    comparer(s.situation.solde, zero(s.situation.solde.devise)) <= 0
  ) {
    return precision(
      `La facture ${f.numero ?? "sans numéro"} n'est pas échue ou est soldée : aucune relance n'est nécessaire.`,
    );
  }
  if (await relanceManuelleDuJour(c.db, f.id, c.aujourdhui)) {
    return precision(
      `Une relance a déjà été enregistrée aujourd'hui pour la facture ${f.numero ?? "sans numéro"} : réessayez demain.`,
    );
  }
  const niveau = await niveauSuivant(c.db, f.id);
  return {
    type: "prete",
    parametres: { facture_id: f.id, niveau },
    resume: resumerPlanifierRelance({
      numero: f.numero,
      client: f.client,
      echeance: s.facture.date_echeance as string,
      jours_retard: s.situation.jours_retard,
      niveau,
    }),
  };
}

async function planifierRelance(db: Db, auth: Auth, parametres: unknown): Promise<ExecutionAction> {
  const p = parametresSchema.parse(parametres);
  // Une relance copilote par facture et par jour, revérifiée À LA CONFIRMATION sous verrou : deux
  // propositions faites le même jour ne produisent pas deux relances.
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `copilote_relance:${p.facture_id}`,
  ]);
  if (await relanceManuelleDuJour(db, p.facture_id, aujourdhui())) {
    throw new AppError(
      409,
      "RELANCE_DEJA_ENREGISTREE",
      "Une relance a déjà été enregistrée aujourd'hui pour cette facture : réessayez demain.",
    );
  }
  // Service commun de la relance manuelle ; jamais d'e-mail au client depuis le copilote.
  const r = await relancerFactureManuellement(
    db,
    auth,
    p.facture_id,
    { envoyer_email: false, niveau: p.niveau },
    aujourdhui(),
    "copilote",
  );
  const f = await db.query("SELECT numero FROM factures WHERE id = $1", [p.facture_id]);
  const numero = (f.rows[0]?.numero as string | null | undefined) ?? "sans numéro";
  return {
    resultatId: r.relance?.id as string,
    texte: `La relance de niveau ${p.niveau} de la facture ${numero} a été enregistrée. Aucun e-mail n'a été envoyé au client.`,
    elements: [
      {
        libelle: `Facture ${numero}`,
        detail: `Relance de niveau ${p.niveau} enregistrée`,
        lien: `/facturation/${p.facture_id}`,
      },
    ],
    notifications: r.notifications,
  };
}

export const ACTION_PLANIFIER_RELANCE: DefinitionAction<"planifier_relance"> = {
  libelle: LIBELLE_ACTION_PLANIFIER_RELANCE,
  permission: (auth) => aPermission(auth.roles, "encaissement.gerer"),
  preparer: preparerPlanifierRelance,
  executer: planifierRelance,
};
