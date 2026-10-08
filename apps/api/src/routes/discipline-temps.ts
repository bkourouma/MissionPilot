import type { FastifyPluginAsync } from "fastify";
import {
  ajouterJours,
  disciplineSaisie,
  lundiDeLaSemaine,
  semainesCouvrant,
  type FeuilleAttendue,
} from "@missionpilot/engines";
import { aPermission, DISCIPLINE_MAX_SEMAINES, disciplineQuerySchema } from "@missionpilot/shared";
import { exiger } from "../auth/contexte.js";
import { requeteInvalide } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import { exigerMissionVisible } from "../missions/acces.js";
import { aujourdhui } from "../missions/outils.js";

/*
 * Discipline de saisie (TPS-04, indicateur « Discipline de saisie ») :
 * feuilles soumises dans les délais / feuilles attendues, par le moteur.
 * - Une feuille est attendue chaque semaine pour chaque collaborateur actif
 *   rattaché à un utilisateur actif, à partir de la semaine de sa création ;
 *   date limite : le dimanche de la semaine. La date retenue est celle de la
 *   PREMIÈRE soumission (une resoumission après rejet ne la change pas).
 * - Les semaines importées (TPS-10) ne sont pas évaluées.
 * - Portée : tout le cabinet avec indicateurs.cabinet ou mission.lire_toutes ;
 *   sinon, avec temps.valider, les collaborateurs affectés aux missions dont
 *   on est chef ou directeur (et soi-même) ; sinon soi-même.
 */
export const routesDisciplineTemps: FastifyPluginAsync = async (app) => {
  app.get("/temps/discipline", async (request) => {
    const auth = exiger(request, "temps.saisir");
    const q = disciplineQuerySchema.parse(request.query);
    const reference = q.date_reference ?? aujourdhui();
    const fin = q.fin ?? reference;
    const debut = q.debut ?? ajouterJours(lundiDeLaSemaine(fin), -21);
    const semaines = semainesCouvrant({ debut: lundiDeLaSemaine(debut), fin }).map((s) => s.debut);
    if (semaines.length > DISCIPLINE_MAX_SEMAINES) {
      throw requeteInvalide(
        `La discipline se calcule sur ${DISCIPLINE_MAX_SEMAINES} semaines au plus.`,
      );
    }
    const tout =
      aPermission(auth.roles, "indicateurs.cabinet") ||
      aPermission(auth.roles, "mission.lire_toutes");
    const equipe = aPermission(auth.roles, "temps.valider");
    const apres = decoderCurseur(q.curseur);
    return app.db.withTenant(auth.cabinetId, async (db) => {
      if (q.equipe) await exigerMissionVisible(db, auth, q.equipe);
      const r = await db.query(
        `SELECT c.id, c.nom, (c.cree_le AT TIME ZONE 'UTC')::date::text AS depuis, lower(c.nom) AS cle_tri
         FROM collaborateurs c JOIN utilisateurs u ON u.id = c.utilisateur_id
         WHERE c.actif AND u.actif
           AND ($1::boolean OR c.utilisateur_id = $3
                OR ($2::boolean AND EXISTS (
                      SELECT 1 FROM affectations a JOIN missions m ON m.id = a.mission_id
                      WHERE a.collaborateur_id = c.id AND (m.chef_id = $3 OR m.directeur_id = $3))))
           AND ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM affectations a
                                            WHERE a.collaborateur_id = c.id AND a.mission_id = $4))
           AND ($5::text IS NULL OR (lower(c.nom), c.id) > ($5, $6::uuid))
         ORDER BY lower(c.nom), c.id
         LIMIT $7`,
        [
          tout,
          equipe,
          auth.utilisateurId,
          q.equipe ?? null,
          apres?.[0] ?? null,
          apres?.[1] ?? null,
          q.limite + 1,
        ],
      );
      const page = paginer(
        r.rows as { id: string; nom: string; depuis: string; cle_tri: string }[],
        q.limite,
      );
      const ids = page.elements.map((c) => c.id);
      const f = await db.query(
        `SELECT collaborateur_id, semaine::text AS semaine, statut, origine,
           (premiere_soumission_le AT TIME ZONE 'UTC')::date::text AS soumise_le
         FROM feuilles_temps WHERE collaborateur_id = ANY ($1::uuid[]) AND semaine = ANY ($2::date[])`,
        [ids, semaines],
      );
      const parCle = new Map(
        f.rows.map((l) => [`${l.collaborateur_id as string}|${l.semaine as string}`, l]),
      );
      const toutes: FeuilleAttendue[] = [];
      const elements = page.elements.map((c) => {
        const attendues: FeuilleAttendue[] = [];
        const detail = semaines
          .filter((s) => s >= lundiDeLaSemaine(c.depuis))
          .flatMap((s) => {
            const feuille = parCle.get(`${c.id}|${s}`);
            if (feuille?.origine === "import") return [];
            const attendue = {
              dateLimite: ajouterJours(s, 6),
              dateSoumission: (feuille?.soumise_le as string | null) ?? null,
            };
            attendues.push(attendue);
            return [
              {
                semaine: s,
                date_limite: attendue.dateLimite,
                statut: (feuille?.statut as string | undefined) ?? "absente",
                soumise_le: attendue.dateSoumission,
              },
            ];
          });
        toutes.push(...attendues);
        const ratio = disciplineSaisie(attendues, reference);
        return { collaborateur: { id: c.id, nom: c.nom }, ...ratio, semaines: detail };
      });
      return {
        debut: semaines[0] ?? lundiDeLaSemaine(debut),
        fin,
        date_reference: reference,
        total: disciplineSaisie(toutes, reference),
        elements,
        curseur_suivant: page.curseur_suivant,
      };
    });
  });
};
