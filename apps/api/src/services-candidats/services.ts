import {
  CODES_SERVICES_CANDIDATS,
  SERVICES_PRIX_REQUIS,
  SERVICES_CANDIDATS_LIBELLES,
  type CodeServiceCandidat,
  type PrixFixe,
} from "@missionpilot/shared";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import { semerTypesServicesCandidats } from "../catalogue/services-candidats.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { validerVersionStockee } from "../standard/methodes.js";

/*
 * Services candidats (PRD complémentaire §11.6) : diagnostic flash et business plan bancable.
 * Le CONTENU (méthode) est dans le standard (migrations 0560 et 0561) ; ici : lecture des deux
 * services avec leur méthode publiée et sa cohérence, activation des types de mission du cabinet,
 * prix fixe. Une mission se crée par les routes existantes (POST /missions, PUT /missions/:id/methode).
 * Droits (routes/services-candidats.ts) : lecture `services_candidats.lire`, gestion `…gerer`.
 */

export interface MethodePubliee {
  methode_id: string;
  version_id: string;
  version: number;
  libelle: string;
}

export interface ServiceCandidat {
  code: CodeServiceCandidat;
  libelle: string;
  description: string | null;
  methode: MethodePubliee | null;
  coherence: { valide: boolean; erreurs: string[]; avertissements: string[] } | null;
  type_mission: { id: string; a_valider: boolean } | null;
  prix: {
    montant: number | null;
    devise: string;
    /** Vrai tant que le cabinet n'a pas saisi le prix d'un service à prix fixe (aucun défaut). */
    a_fixer: boolean;
    /** Vrai dès que le cabinet a saisi une ligne de prix. */
    personnalise: boolean;
    commentaire: string | null;
  };
  /** Contenu de départ : à valider par un expert avant tout usage client. */
  a_valider_expert: true;
}

const enNombre = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

async function methodePubliee(db: Db, code: string): Promise<MethodePubliee | null> {
  const r = await db.query(
    `SELECT m.id AS methode_id, v.id AS version_id, v.version, m.libelle
     FROM methodes m JOIN methode_versions v ON v.methode_id = m.id
     WHERE m.cabinet_id IS NULL AND m.code = $1 AND v.statut = 'publiee'
     ORDER BY v.version DESC LIMIT 1`,
    [code],
  );
  return (r.rows[0] as MethodePubliee | undefined) ?? null;
}

export async function lireServices(db: Db): Promise<ServiceCandidat[]> {
  const services: ServiceCandidat[] = [];
  for (const code of CODES_SERVICES_CANDIDATS) {
    const s = await db.query(
      `SELECT description FROM services_conseil WHERE cabinet_id IS NULL AND code = $1`,
      [code],
    );
    const methode = await methodePubliee(db, code);
    let coherence: ServiceCandidat["coherence"] = null;
    if (methode) {
      const v = await validerVersionStockee(db, methode.version_id);
      coherence = {
        valide: v.valide,
        erreurs: v.anomalies.filter((a) => a.gravite === "erreur").map((a) => a.message),
        avertissements: v.anomalies.filter((a) => a.gravite !== "erreur").map((a) => a.message),
      };
    }
    const t = await db.query(
      `SELECT id, a_valider FROM types_mission WHERE code = $1 ORDER BY id LIMIT 1`,
      [code],
    );
    const p = await db.query(
      `SELECT prix_fixe, devise, commentaire FROM services_candidats_parametres
       WHERE service_code = $1`,
      [code],
    );
    const ligne = p.rows[0] as
      { prix_fixe: string | null; devise: string; commentaire: string | null } | undefined;
    const montant = enNombre(ligne?.prix_fixe);
    services.push({
      code,
      libelle: SERVICES_CANDIDATS_LIBELLES[code],
      description: (s.rows[0]?.description as string | undefined) ?? null,
      methode,
      coherence,
      type_mission: (t.rows[0] as ServiceCandidat["type_mission"]) ?? null,
      prix: {
        montant,
        devise: ligne?.devise ?? "XOF",
        a_fixer: montant === null && SERVICES_PRIX_REQUIS[code],
        personnalise: ligne !== undefined,
        commentaire: ligne?.commentaire ?? null,
      },
      a_valider_expert: true,
    });
  }
  return services;
}

/**
 * Crée le type de mission d'UN service dans le cabinet (idempotent). Un service à prix fixe
 * (`SERVICES_PRIX_REQUIS`) ne s'active qu'une fois son prix saisi : aucun prix par défaut.
 */
export async function activerTypes(
  db: Db,
  auth: Auth,
  code: CodeServiceCandidat,
): Promise<{ types_crees: number }> {
  if (SERVICES_PRIX_REQUIS[code]) {
    const p = await db.query(
      `SELECT prix_fixe FROM services_candidats_parametres WHERE service_code = $1`,
      [code],
    );
    if (enNombre(p.rows[0]?.prix_fixe) === null) {
      throw new AppError(
        409,
        "PRIX_A_FIXER",
        `Fixez d'abord le prix fixe du service « ${SERVICES_CANDIDATS_LIBELLES[code]} » : son type de mission ne peut pas être activé sans prix.`,
      );
    }
  }
  const { grades, types } = await semerTypesServicesCandidats(db, auth.cabinetId, code);
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "activation",
    entite: "services_candidats",
    details: { service: code, types_crees: types, grades_crees: grades },
  });
  return { types_crees: types };
}

/** Fixe le prix du service pour le cabinet (upsert) : saisi par le cabinet, aucun défaut. */
export async function fixerPrix(
  db: Db,
  auth: Auth,
  code: CodeServiceCandidat,
  prix: PrixFixe,
): Promise<ServiceCandidat["prix"]> {
  const avant = await db.query(
    `SELECT prix_fixe, devise FROM services_candidats_parametres WHERE service_code = $1`,
    [code],
  );
  await db.query(
    `INSERT INTO services_candidats_parametres
       (cabinet_id, service_code, prix_fixe, devise, commentaire, a_valider, modifie_par)
     VALUES ($1, $2, $3, $4, $5, false, $6)
     ON CONFLICT (cabinet_id, service_code) DO UPDATE
       SET prix_fixe = EXCLUDED.prix_fixe, devise = EXCLUDED.devise,
           commentaire = EXCLUDED.commentaire, a_valider = false,
           modifie_par = EXCLUDED.modifie_par, modifie_le = now()`,
    [auth.cabinetId, code, prix.montant, prix.devise, prix.commentaire ?? null, auth.utilisateurId],
  );
  const a = avant.rows[0] as { prix_fixe: string | null; devise: string } | undefined;
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "prix_fixe",
    entite: "service_candidat",
    details: {
      service: code,
      avant: a ? { montant: enNombre(a.prix_fixe), devise: a.devise } : null,
      apres: { montant: prix.montant, devise: prix.devise, commentaire: prix.commentaire ?? null },
    },
  });
  return {
    montant: prix.montant,
    devise: prix.devise,
    a_fixer: prix.montant === null && SERVICES_PRIX_REQUIS[code],
    personnalise: true,
    commentaire: prix.commentaire ?? null,
  };
}
