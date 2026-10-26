import type { ContexteTenantDemo } from "../contexte.js";
import { appliquerSql } from "./antidatage.js";

/*
 * Cohérence invitation → compte pour les comptes de portail créés par les étapes « questionnaires »
 * et « notations complémentaires » (e-mails `*@<client>.tenant-demo.test` dont le titulaire répond
 * à un questionnaire). `utilisateurs.cree_le` est déjà antidaté par ces étapes (« depuis ») ; il
 * sert de référence : invitation créée 2 jours avant, acceptée à l'ouverture du compte, expirant
 * 7 jours après sa création (même durée que la route). Les notifications « invitation au portail »
 * correspondantes (même client, instant voisin de l'invitation) suivent l'invitation. Les comptes
 * du socle (`@tenant-demo.test`) et ceux des plans ne sont pas concernés. Paramètre : $1 = cabinet.
 */

export async function antidaterComptesPortail(ctx: ContexteTenantDemo): Promise<void> {
  // Notifications d'abord : leur rapprochement avec l'invitation se fait sur l'instant en cours.
  await appliquerSql(
    ctx,
    `UPDATE notifications n
        SET cree_le = m.cible + interval '1 second'
       FROM (SELECT DISTINCT ON (n2.id) n2.id AS nid, (u.cree_le - interval '2 days') AS cible
               FROM notifications n2
               JOIN invitations i ON i.cabinet_id = n2.cabinet_id AND n2.lien = '/clients/' || i.client_id::text
               JOIN utilisateurs u ON u.cabinet_id = i.cabinet_id AND lower(u.email) = lower(i.email)
              WHERE n2.cabinet_id = $1 AND n2.type = 'securite_invitation_portail'
                AND i.email LIKE '%@%.tenant-demo.test'
                AND EXISTS (SELECT 1 FROM questionnaire_repondants r
                             WHERE r.cabinet_id = u.cabinet_id AND r.utilisateur_id = u.id)
                AND abs(extract(epoch FROM (n2.cree_le - i.cree_le))) < 5
              ORDER BY n2.id, abs(extract(epoch FROM (n2.cree_le - i.cree_le)))) m
      WHERE n.id = m.nid AND n.cabinet_id = $1`,
    [ctx.cabinetId],
  );
  await appliquerSql(
    ctx,
    `UPDATE invitations i
        SET cree_le = u.cree_le - interval '2 days',
            acceptee_le = CASE WHEN i.acceptee_le IS NULL THEN NULL ELSE u.cree_le END,
            expire_le = u.cree_le - interval '2 days' + interval '7 days'
       FROM utilisateurs u
      WHERE i.cabinet_id = $1 AND u.cabinet_id = i.cabinet_id AND lower(u.email) = lower(i.email)
        AND i.email LIKE '%@%.tenant-demo.test'
        AND EXISTS (SELECT 1 FROM questionnaire_repondants r
                     WHERE r.cabinet_id = u.cabinet_id AND r.utilisateur_id = u.id)`,
    [ctx.cabinetId],
  );
}
