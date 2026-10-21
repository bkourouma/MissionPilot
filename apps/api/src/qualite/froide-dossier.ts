import { calculerBudget, syntheseNps } from "@missionpilot/engines";
import { aPermission } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import {
  chargerVersions,
  versionDeReference,
  versVersionMoteur,
  vueSynthese,
} from "../missions/budget.js";
import { droitsBudget } from "../missions/outils.js";
import { accesEchantillon } from "./froide-donnees.js";

/*
 * Dossier de revue d'une mission tirée (QUA-05) : ce que le relecteur indépendant lit pour noter
 * la grille, SANS appartenir à l'équipe de la mission (la visibilité ordinaire des missions ne
 * s'applique pas ici ; l'accès est celui de la revue : relecteur affecté ou gestionnaire).
 *
 * FIN-02 : aucun montant ni coût interne sans la permission. `budget_jours` exige
 * `budget.lire_jours` ; honoraires et débours exigent `budget.lire_montants` ; coûts internes,
 * sous-traitance, marge et taux de marge exigent `finance.lire`. Sans le droit, la clé est ABSENTE.
 * Les chiffres du budget sortent de la synthèse du moteur finance (`calculerBudget`, version de
 * référence figée) filtrée par `vueSynthese`, comme la route du budget.
 */

export async function dossierRevue(db: Db, auth: Auth, echantillonId: string) {
  const e = await accesEchantillon(db, auth, echantillonId);
  const missionId = e.mission_id;

  const identite = await db.query(
    `SELECT m.id, m.intitule, m.statut, m.date_debut::text AS date_debut, m.date_fin::text AS date_fin,
       m.date_signature::text AS date_signature, m.cloturee_le,
       cl.raison_sociale AS client_nom, t.libelle AS type_mission_libelle,
       d.nom AS directeur_nom, ch.nom AS chef_nom
     FROM missions m
     JOIN clients cl ON cl.id = m.client_id
     LEFT JOIN types_mission t ON t.id = m.type_mission_id
     LEFT JOIN utilisateurs d ON d.id = m.directeur_id
     LEFT JOIN utilisateurs ch ON ch.id = m.chef_id
     WHERE m.id = $1`,
    [missionId],
  );

  const suivis = await db.query(
    `SELECT s.id, s.type_livrable, s.libelle, s.version, s.classe, s.statut,
       g.signe_le, g.qualite AS signature_qualite, u.nom AS signataire_nom
     FROM qualite_suivis s
     LEFT JOIN qualite_signatures g ON g.suivi_id = s.id
     LEFT JOIN utilisateurs u ON u.id = g.signataire_id
     WHERE s.mission_id = $1 ORDER BY s.ouvert_le, s.id`,
    [missionId],
  );

  const acc = await db.query(
    `SELECT niveau_risque, decision, evalue_le, jsonb_array_length(conflits) AS conflits_detectes
     FROM qualite_acceptations WHERE mission_id = $1 ORDER BY rang DESC LIMIT 1`,
    [missionId],
  );

  const notes = await db.query(
    `SELECT s.moment, j.libelle AS jalon_libelle, s.note, s.saisi_le FROM (
       SELECT DISTINCT ON (cle) * FROM qualite_satisfactions WHERE mission_id = $1 ORDER BY cle, rang DESC
     ) s LEFT JOIN mission_jalons j ON j.id = s.jalon_id ORDER BY s.saisi_le, s.id`,
    [missionId],
  );

  const derogations = await db.query(
    `SELECT count(*)::int AS total,
       count(*) FILTER (WHERE statut = 'approuvee')::int AS approuvees,
       count(*) FILTER (WHERE statut = 'refusee')::int AS refusees,
       count(*) FILTER (WHERE statut = 'demandee')::int AS demandees
     FROM derogations WHERE mission_id = $1`,
    [missionId],
  );

  const dossier: Record<string, unknown> = {
    echantillon_id: e.id,
    mission: identite.rows[0],
    suivis_qualite: suivis.rows.map((s) => ({
      id: s.id,
      type_livrable: s.type_livrable,
      libelle: s.libelle,
      version: s.version,
      classe: s.classe,
      statut: s.statut,
      signature: s.signe_le
        ? { signataire_nom: s.signataire_nom, qualite: s.signature_qualite, signe_le: s.signe_le }
        : null,
    })),
    acceptation: acc.rows[0] ?? null,
    satisfaction: {
      notes: notes.rows,
      synthese: syntheseNps(notes.rows.map((n) => n.note as number)),
    },
    derogations: derogations.rows[0],
  };

  // Méthode figée de la mission : lisible avec `standard.lire` seulement.
  if (aPermission(auth.roles, "standard.lire")) {
    const m = await db.query(
      `SELECT mm.rang, mm.evenement, mm.cree_le, me.code, me.libelle, v.version
       FROM mission_methodes mm
       JOIN methode_versions v ON v.id = mm.methode_version_id
       JOIN methodes me ON me.id = v.methode_id
       WHERE mm.mission_id = $1 ORDER BY mm.rang DESC LIMIT 1`,
      [missionId],
    );
    dossier.methode = m.rows[0] ?? null;
  }

  // Budget (FIN-02) : chaque clé est ajoutée seulement si le droit correspondant est détenu.
  const droits = droitsBudget(auth);
  const joursLisibles = aPermission(auth.roles, "budget.lire_jours");
  if (joursLisibles || droits.montants || droits.finance) {
    const versions = await chargerVersions(db, missionId);
    const reference = versionDeReference(versions);
    if (reference) {
      const synthese = vueSynthese(calculerBudget(versVersionMoteur(reference)), droits);
      const budget: Record<string, unknown> = { version_reference: reference.numero };
      if (joursLisibles) budget.budget_jours = synthese.jours_vendus;
      if (droits.montants || droits.finance) {
        budget.devise = synthese.devise;
        budget.honoraires = synthese.honoraires;
        budget.debours_refacturables = synthese.debours_refacturables;
        budget.debours_non_refacturables = synthese.debours_non_refacturables;
      }
      if (droits.finance) {
        budget.couts_internes = synthese.couts_internes;
        budget.sous_traitance = synthese.sous_traitance;
        budget.marge = synthese.marge;
        budget.taux_marge = synthese.taux_marge;
      }
      dossier.budget = budget;
    }
  }
  return dossier;
}
