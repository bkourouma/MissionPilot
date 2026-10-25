import type { ContexteTenantDemo } from "../contexte.js";

/*
 * ALIGNEMENT DES DATES D'ACTION sur la clôture des missions terminées (dernière étape de la phase
 * `gestion`, après la clôture et les revues à froid). Les routes horodatent les ACTIONS (envoi,
 * dépôt, décision, levée, signature…) « maintenant », alors que les `cree_le` de ces lignes ont été
 * remontés à la date fictive : une mission clôturée en 2025 porterait des actions du jour du seed.
 * Pour chaque mission `cloturee`, toute date d'action postérieure à `cloturee_le` est ramenée entre
 * le `cree_le` de la ligne (ou sa date de début) et la clôture.
 *
 * SQL LITTÉRAL du rôle propriétaire, filtré par cabinet, un UPDATE par table (noms écrits en dur),
 * dans une seule transaction sous le rôle `replica` (comme `facturation-dates.ts` et
 * `rapports-dates.ts`) : seules des DATES changent. Idempotent : une date déjà antérieure à la
 * clôture n'est jamais modifiée. NE TOUCHE PAS : `journal_audit`, les `cree_le` techniques, les
 * suivis post-mission légitimes (retours d'expérience, satisfactions, revues à froid, échéances
 * prévisionnelles) ni `signatures_preuves.horodatage` (il entre dans l'empreinte de la chaîne de
 * preuves, ajout seul : le laisser intact préserve rang et empreinte).
 *
 * Cas particulier des demandes de signature : leur propre `cree_le` est au jour du seed, donc
 * postérieur à la clôture ; la demande (création, envoi, fin, expiration) et ses signataires sont
 * ramenées à la signature de la lettre de mission. Les événements de la chaîne de preuves gardent
 * leur horodatage réel (limite assumée).
 */

/** Part (0,1 à 0,9) déterministe d'une ligne dans un intervalle, pour étaler les dates sans hasard. */
const PART = (id: string): string => `(0.1 + 0.8 * (abs(hashtext(${id}::text)) % 1000) / 1000.0)`;

export async function alignerDatesActions(ctx: ContexteTenantDemo): Promise<void> {
  const c = ctx.proprietaire;
  const p = [ctx.cabinetId];
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL session_replication_role = replica");

    // Vérifications de la check-list de clôture (hors celle qui a clos la mission).
    await c.query(
      `UPDATE cloture_verifications v SET
         verifie_le = GREATEST(coalesce(m.date_debut::timestamptz, m.cloturee_le - interval '30 days'),
                               LEAST(v.verifie_le, m.cloturee_le - interval '1 hour'))
       FROM missions m
       WHERE v.cabinet_id = $1 AND m.id = v.mission_id AND m.statut = 'cloturee'
         AND v.verifie_le > m.cloturee_le`,
      p,
    );

    // Salle de mission : demandes (envoi peu après la création, fermeture avant la clôture), puis dépôts.
    await c.query(
      `UPDATE salle_demandes d SET
         envoyee_le = CASE WHEN d.envoyee_le IS NULL THEN NULL
                           ELSE LEAST(d.cree_le + interval '2 hours', m.cloturee_le - interval '2 hours') END,
         close_le = CASE WHEN d.close_le IS NULL THEN NULL
                         ELSE LEAST(d.cree_le + interval '2 hours', m.cloturee_le - interval '2 hours')
                              + (m.cloturee_le - interval '1 hour'
                                 - LEAST(d.cree_le + interval '2 hours', m.cloturee_le - interval '2 hours'))
                                * ${PART("d.id")} END
       FROM missions m
       WHERE d.cabinet_id = $1 AND m.id = d.mission_id AND m.statut = 'cloturee'
         AND (d.envoyee_le > m.cloturee_le OR d.close_le > m.cloturee_le)`,
      p,
    );
    await c.query(
      `UPDATE salle_depots x SET
         depose_le = coalesce(d.envoyee_le, d.cree_le)
                     + (coalesce(d.close_le, m.cloturee_le - interval '1 hour') - coalesce(d.envoyee_le, d.cree_le))
                       * ${PART("x.id")}
       FROM salle_demandes d JOIN missions m ON m.id = d.mission_id
       WHERE x.cabinet_id = $1 AND d.id = x.demande_id AND m.statut = 'cloturee'
         AND x.depose_le > m.cloturee_le`,
      p,
    );

    // Corrections de temps : demandée après le jour corrigé, décidée ensuite.
    await c.query(
      `UPDATE corrections_temps c SET
         demandee_le = e.nouvelle,
         decidee_le = CASE WHEN c.decidee_le IS NULL THEN NULL
                           ELSE GREATEST(e.nouvelle, LEAST(c.decidee_le, e.cloture - interval '1 hour')) END
       FROM (SELECT x.id, m.cloturee_le AS cloture,
                    GREATEST(x.date::timestamptz + interval '1 day',
                             LEAST(x.demandee_le, m.cloturee_le - interval '3 hours')) AS nouvelle
               FROM corrections_temps x JOIN missions m ON m.id = x.mission_id
              WHERE x.cabinet_id = $1 AND m.statut = 'cloturee'
                AND (x.demandee_le > m.cloturee_le OR x.decidee_le > m.cloturee_le)) e
       WHERE c.id = e.id`,
      p,
    );

    // Liens facture <-> échéance/débours libérés, alertes de suivi levées.
    await c.query(
      `UPDATE facturation_liens l SET
         libere_le = GREATEST(l.cree_le, LEAST(l.libere_le, m.cloturee_le - interval '1 hour'))
       FROM missions m
       WHERE l.cabinet_id = $1 AND m.id = l.mission_id AND m.statut = 'cloturee'
         AND l.libere_le > m.cloturee_le AND l.cree_le < m.cloturee_le`,
      p,
    );
    await c.query(
      `UPDATE alertes_suivi a SET
         levee_le = GREATEST(a.declenchee_le, LEAST(a.levee_le, m.cloturee_le - interval '1 hour'))
       FROM missions m
       WHERE a.cabinet_id = $1 AND m.id = a.mission_id AND m.statut = 'cloturee'
         AND a.levee_le > m.cloturee_le AND a.declenchee_le < m.cloturee_le`,
      p,
    );

    // Assertions signées et demandes IA terminées, quand la ligne a été créée avant la clôture.
    await c.query(
      `UPDATE assertion_versions v SET
         signe_le = GREATEST(v.cree_le, LEAST(v.signe_le, m.cloturee_le - interval '1 hour'))
       FROM assertions a JOIN missions m ON m.id = a.mission_id
       WHERE v.cabinet_id = $1 AND a.id = v.assertion_id AND m.statut = 'cloturee'
         AND v.signe_le > m.cloturee_le AND v.cree_le < m.cloturee_le`,
      p,
    );
    await c.query(
      `UPDATE ia_demandes d SET
         termine_le = GREATEST(d.cree_le, LEAST(d.termine_le, m.cloturee_le - interval '1 hour'))
       FROM missions m
       WHERE d.cabinet_id = $1 AND m.id = d.mission_id AND m.statut = 'cloturee'
         AND d.termine_le > m.cloturee_le AND d.cree_le < m.cloturee_le`,
      p,
    );

    // Membres ajoutés à l'équipe d'une mission clôturée : au plus tard le lendemain du démarrage.
    await c.query(
      `UPDATE mission_equipe e SET
         ajoute_le = coalesce(m.date_debut::timestamptz, m.cloturee_le - interval '30 days')
                     + interval '1 day 9 hours'
       FROM missions m
       WHERE e.cabinet_id = $1 AND m.id = e.mission_id AND m.statut = 'cloturee'
         AND e.ajoute_le > m.cloturee_le`,
      p,
    );

    // Signatures électroniques de la lettre de mission d'une mission clôturée (signataires d'abord).
    await c.query(
      `UPDATE signatures_signataires s SET
         invite_le = CASE WHEN s.invite_le IS NULL THEN NULL
                          ELSE m.date_signature::timestamptz + interval '10 hours 2 minutes' END,
         decide_le = CASE WHEN s.decide_le IS NULL THEN NULL
                          ELSE m.date_signature::timestamptz + interval '1 day 15 hours' END
       FROM signatures_demandes d JOIN missions m ON m.id = d.mission_id
       WHERE s.cabinet_id = $1 AND d.id = s.demande_id AND m.statut = 'cloturee'
         AND m.date_signature IS NOT NULL AND d.cree_le > m.cloturee_le`,
      p,
    );
    await c.query(
      `UPDATE signatures_demandes d SET
         cree_le = m.date_signature::timestamptz + interval '10 hours',
         envoyee_le = CASE WHEN d.envoyee_le IS NULL THEN NULL
                           ELSE m.date_signature::timestamptz + interval '10 hours 1 minute' END,
         termine_le = CASE WHEN d.termine_le IS NULL THEN NULL
                           ELSE m.date_signature::timestamptz + interval '1 day 16 hours' END,
         expire_le = CASE WHEN d.expire_le IS NULL THEN NULL
                          ELSE m.date_signature::timestamptz + interval '30 days 10 hours' END
       FROM missions m
       WHERE d.cabinet_id = $1 AND m.id = d.mission_id AND m.statut = 'cloturee'
         AND m.date_signature IS NOT NULL AND d.cree_le > m.cloturee_le`,
      p,
    );

    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}
