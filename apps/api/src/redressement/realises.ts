import { projeterTresorerie, type FluxRealise } from "@missionpilot/engines";
import {
  RED_CORRECTIONS_SEMAINE_MAX,
  type RedRealiseCreation,
  type RedTresorerieVue,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError, requeteInvalide } from "../errors.js";
import type { DossierRed } from "./acces.js";
import { journalRed } from "./journal.js";
import {
  entreeMoteur,
  indexSemaine,
  lireTresorerie,
  realisesCourants,
  versionCourante,
  type RealiseLu,
} from "./tresorerie.js";

/*
 * Réalisé hebdomadaire de trésorerie (RED-11), EN AJOUT SEUL : une correction est une nouvelle ligne
 * qui REMPLACE la courante de la même semaine (chaîne `remplace_id`, 10 corrections au plus). La
 * semaine doit tomber dans la fenêtre de la version courante ; la semaine précédente, si elle est
 * dans la fenêtre, doit déjà avoir un réalisé (contiguïté, jugée aussi par le moteur). Le moteur
 * valide les flux et projette avant l'écriture ; l'API ne somme rien.
 */

/** Flux validé par le schéma → jsonb : seules les catégories renseignées sont écrites. */
function fluxPropre(f: RedRealiseCreation["flux"]): FluxRealise {
  return {
    ...(f.encaissement && Object.keys(f.encaissement).length > 0
      ? { encaissement: { ...f.encaissement } }
      : {}),
    ...(f.decaissement && Object.keys(f.decaissement).length > 0
      ? { decaissement: { ...f.decaissement } }
      : {}),
  };
}

/** Route 20 : réalisé d'une semaine (dossier verrouillé par l'appelant). */
export async function enregistrerRealise(
  db: Db,
  auth: Auth,
  dossier: DossierRed,
  corps: RedRealiseCreation,
): Promise<RedTresorerieVue> {
  const version = await versionCourante(db, dossier.id);
  if (!version) {
    throw new AppError(
      409,
      "RED_TRESORERIE_ABSENTE",
      "Aucune version de trésorerie n'existe encore.",
    );
  }
  const realises = await realisesCourants(db, dossier.id, version.date_debut);
  const ecart = await db.query("SELECT ($1::date - $2::date) AS jours", [
    corps.semaine_debut,
    version.date_debut,
  ]);
  const semaine = indexSemaine(ecart.rows[0].jours as number);
  if (semaine === null) {
    throw requeteInvalide(
      "La semaine n'appartient pas à la fenêtre de la version de trésorerie courante.",
    );
  }
  const courant = realises.find((x) => x.semaine_debut === corps.semaine_debut) ?? null;
  if (semaine > 1) {
    const precedente = realises.find((x) => indexSemaine(x.jours) === semaine - 1);
    if (!precedente) {
      throw new AppError(
        409,
        "RED_SEMAINE_PRECEDENTE_MANQUANTE",
        "La semaine précédente n'a pas de réalisé : saisissez les semaines dans l'ordre.",
      );
    }
  }
  if (courant && courant.corrections >= RED_CORRECTIONS_SEMAINE_MAX) {
    throw new AppError(
      409,
      "RED_TROP_DE_CORRECTIONS",
      "Une semaine de réalisé ne se corrige pas plus de dix fois.",
    );
  }
  const flux = fluxPropre(corps.flux);
  const soldeConstate = corps.solde_constate ?? null;
  // Validation et projection par le moteur AVANT l'écriture (catégories, montants, contiguïté).
  const nouveau: RealiseLu = {
    id: "",
    semaine_debut: corps.semaine_debut,
    jours: ecart.rows[0].jours as number,
    flux,
    solde_constate: soldeConstate,
    commentaire: null,
    saisi_par: auth.utilisateurId,
    saisi_par_nom: auth.nom,
    cree_le: new Date(),
    corrections: 0,
  };
  projeterTresorerie(
    entreeMoteur(
      version.date_debut,
      version.solde_initial,
      version.seuil_tension,
      version.lignes.map((l) => ({
        semaine: l.semaine,
        sens: l.sens,
        categorie: l.categorie,
        montant: l.montant,
      })),
      [...realises.filter((x) => x.semaine_debut !== corps.semaine_debut), nouveau],
    ),
  );
  const r = await db.query(
    `INSERT INTO red_tresorerie_realises (cabinet_id, dossier_id, semaine_debut, flux, solde_constate,
       remplace_id, commentaire, saisi_par)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      auth.cabinetId,
      dossier.id,
      corps.semaine_debut,
      JSON.stringify(flux),
      soldeConstate,
      courant?.id ?? null,
      corps.commentaire ?? null,
      auth.utilisateurId,
    ],
  );
  await journalRed(db, auth, "red_tresorerie", "realise", r.rows[0].id as string, {
    dossier_id: dossier.id,
    semaine_debut: corps.semaine_debut,
    correction: courant !== null,
  });
  return lireTresorerie(db, dossier);
}
