import { attendre, type ContexteTenantDemo } from "./contexte.js";
import type { CleCompteCabinet } from "./cles.js";
import { COMMENTAIRES, planAbsences, type DefAbsence } from "./donnees-absences.js";

/*
 * Absences du cabinet « Tenant démo » (congés, maladie, formation, autre) sur novembre 2024 à
 * décembre 2026, aux statuts variés : validée, refusée (avec motif), demandée, annulée.
 *
 * Par les VRAIES routes, comme dans un vrai cabinet :
 * - la demande (POST /api/absences) est faite par la session du collaborateur LUI-MÊME (la route
 *   rattache l'absence au collaborateur du compte connecté et impose `conges.demander`) ;
 * - la décision (POST .../valider ou .../refuser) vient d'une session « ressources » (droit
 *   `conges.valider`), parfois d'un associé pour la demande d'un autre, jamais du demandeur ;
 * - l'annulation (POST .../annuler) est faite par le demandeur, tant que l'absence n'a pas commencé.
 *
 * Idempotent : les absences existantes sont relues (GET /api/absences, session ressources, toutes
 * pages) et une absence du même collaborateur à la même date de début n'est jamais recréée.
 * Limite connue : le déclencheur `absences_figees` interdit de modifier `cree_le`, donc les
 * absences passées portent la date réelle de création du seed ; seules les dates d'absence sont
 * historiques.
 */

interface AbsenceExistante {
  collaborateur_id: string;
  date_debut: string;
}

/** Toutes les absences du cabinet (la session « ressources » voit tout), pagination par curseur. */
async function absencesExistantes(ctx: ContexteTenantDemo): Promise<AbsenceExistante[]> {
  const ressources = ctx.session("ressources");
  const toutes: AbsenceExistante[] = [];
  let curseur: string | null = null;
  do {
    const url: string = `/api/absences?limite=200${curseur ? `&curseur=${encodeURIComponent(curseur)}` : ""}`;
    const r = await ressources.get(url);
    attendre(200, r, "liste des absences");
    const page = r.json() as { elements: AbsenceExistante[]; curseur_suivant: string | null };
    toutes.push(...page.elements);
    curseur = page.curseur_suivant;
  } while (curseur);
  return toutes;
}

/** Décideur d'une demande : ressources (le second à partir de son arrivée), parfois un associé. */
function choisirDecideur(
  ctx: ContexteTenantDemo,
  alea: ContexteTenantDemo["alea"],
  def: DefAbsence,
): CleCompteCabinet {
  if (def.cle !== "associe" && alea.proba(0.15)) return "associe";
  if (def.debut >= "2025-07-01" && alea.proba(0.4)) return "ressources.2";
  return "ressources";
}

/**
 * Crée les absences de `donnees-absences.ts` qui manquent, dans l'ordre, avec les décisions et
 * annulations voulues. Idempotent.
 */
export async function assurerAbsences(ctx: ContexteTenantDemo): Promise<void> {
  const alea = ctx.alea.deriver("absences");
  const existantes = new Set(
    (await absencesExistantes(ctx)).map((a) => `${a.collaborateur_id}|${a.date_debut}`),
  );
  let creees = 0;

  for (const def of planAbsences(ctx.jour)) {
    // Les tirages sont consommés même pour une absence déjà en base : résultat reproductible.
    const commentaire = def.commentaire ?? alea.choisir(COMMENTAIRES[def.type]);
    const decideur = choisirDecideur(ctx, alea, def);
    const collaborateurId = ctx.collaborateur(def.cle);
    if (existantes.has(`${collaborateurId}|${def.debut}`)) continue;

    const demandeur = ctx.session(def.cle);
    const r = await demandeur.post("/api/absences", {
      type: def.type,
      date_debut: def.debut,
      date_fin: def.fin,
      commentaire,
    });
    attendre(201, r, `absence ${def.cle} du ${def.debut}`);
    const id = r.json().id as string;
    creees++;

    const valider = def.statut === "validee" || def.validerAvant === true;
    if (valider) {
      attendre(
        200,
        await ctx.session(decideur).post(`/api/absences/${id}/valider`, {}),
        `validation de l'absence ${def.cle} du ${def.debut}`,
      );
    } else if (def.statut === "refusee") {
      attendre(
        200,
        await ctx
          .session(decideur)
          .post(`/api/absences/${id}/refuser`, { motif: def.motif ?? "Demande non accordée." }),
        `refus de l'absence ${def.cle} du ${def.debut}`,
      );
    }
    if (def.statut === "annulee") {
      const a = await demandeur.post(`/api/absences/${id}/annuler`, {});
      // La route compare au jour RÉEL (pas à l'horloge fictive) : si le seed est rejoué bien
      // plus tard, l'absence « future » a commencé et reste telle quelle (409), sans échec.
      if (a.statusCode === 409) {
        ctx.journal(
          `Absence ${def.cle} du ${def.debut} non annulable (déjà commencée) : conservée.`,
        );
      } else {
        attendre(200, a, `annulation de l'absence ${def.cle} du ${def.debut}`);
      }
    }
  }
  ctx.journal(`Absences : ${creees} créée(s).`);
}
