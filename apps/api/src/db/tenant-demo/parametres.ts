import { attendre, type ContexteTenantDemo, type SessionDemo } from "./contexte.js";
import { MOT_DE_PASSE_DEMO_TENANT, NOM_CABINET_TENANT_DEMO } from "./constantes.js";
import {
  ACTIVITES_INTERNES,
  ANNEES_CALENDRIER,
  FERIES_MOBILES,
  MENTIONS_LEGALES,
} from "./donnees-parametres.js";
import { TAUX_VENTE_GRADE } from "./donnees-equipe.js";

/*
 * Paramètres du cabinet « Tenant démo » : pays et unité de temps, grades et barèmes, catalogue
 * de services, paramètres de saisie des temps, activités internes, calendrier des jours fériés
 * (2024 à 2027) et mentions légales de facturation.
 *
 * Tout passe par les VRAIES routes, avec la session de l'associé (qui détient `cabinet.gerer`,
 * `taux.gerer`, `facture.emettre`). Idempotent : chaque étape relit l'existant (activités par
 * code, jours fériés par date, mentions par raison sociale) ou est naturellement idempotente
 * (PATCH/PUT de valeurs fixes, semis du catalogue « ajoute ce qui manque »).
 */

/** Grades (code -> id) et types de mission (code -> id) du cabinet, dans le contexte. */
async function remplirReferentiels(ctx: ContexteTenantDemo, associe: SessionDemo): Promise<void> {
  const grades = await associe.get("/api/grades");
  attendre(200, grades, "liste des grades");
  for (const g of grades.json().elements as { code: string; id: string }[]) {
    ctx.grades[g.code] = g.id;
  }
  const types = await associe.get("/api/types-mission");
  attendre(200, types, "liste des types de mission");
  for (const t of types.json().elements as { code: string; id: string }[]) {
    ctx.typesMission[t.code] = t.id;
  }
}

/** Barème de vente de chaque grade (PUT idempotent : même valeur, même résultat). */
async function poserBaremes(ctx: ContexteTenantDemo, associe: SessionDemo): Promise<void> {
  for (const [code, taux] of Object.entries(TAUX_VENTE_GRADE)) {
    const id = ctx.grades[code];
    if (!id) throw new Error(`Grade « ${code} » absent du référentiel du cabinet.`);
    attendre(
      200,
      await associe.put(`/api/grades/${id}/taux`, { taux_vente_standard: taux, devise: "XOF" }),
      `barème du grade ${code}`,
    );
  }
}

/** Activités internes non facturables, créées par code si elles manquent. */
async function assurerActivites(associe: SessionDemo): Promise<void> {
  const lues = await associe.get("/api/activites-internes?inclure_inactives=true");
  attendre(200, lues, "liste des activités internes");
  const codes = new Set((lues.json().elements as { code: string }[]).map((a) => a.code));
  for (const a of ACTIVITES_INTERNES) {
    if (codes.has(a.code)) continue;
    attendre(201, await associe.post("/api/activites-internes", a), `activité ${a.code}`);
  }
}

/**
 * Calendrier : jours fériés par défaut de l'année (UEMOA), validés un à un, puis fêtes mobiles
 * musulmanes saisies à la main (le moteur ne les calcule pas). Un doublon (409) est ignoré.
 */
async function assurerCalendrier(associe: SessionDemo): Promise<void> {
  for (const annee of ANNEES_CALENDRIER) {
    const defaut = await associe.post("/api/cabinet/feries/par-defaut", { annee });
    attendre(200, defaut, `jours fériés par défaut ${annee}`);
    for (const f of FERIES_MOBILES.filter((m) => m.date.startsWith(`${annee}-`))) {
      const r = await associe.post("/api/cabinet/feries", {
        date: f.date,
        libelle: f.libelle,
        nationale: true,
      });
      if (r.statusCode !== 201 && r.statusCode !== 409) {
        attendre(201, r, `jour férié ${f.date}`);
      }
    }
    // Relecture après les ajouts manuels : tout jour encore « à valider » est validé.
    const lus = await associe.get(`/api/cabinet/feries?annee=${annee}`);
    attendre(200, lus, `jours fériés ${annee}`);
    for (const f of lus.json().elements as { id: string; date: string; a_valider: boolean }[]) {
      if (!f.a_valider) continue;
      attendre(
        200,
        await associe.post(`/api/cabinet/feries/${f.id}/valider`, {}),
        `validation du jour férié ${f.date}`,
      );
    }
  }
}

/** Mentions légales de facturation (nécessaires pour émettre) : posées une seule fois. */
async function assurerMentionsLegales(associe: SessionDemo): Promise<void> {
  const lues = await associe.get("/api/parametres-facturation");
  attendre(200, lues, "paramètres de facturation");
  const p = lues.json() as { raison_sociale: string | null; rccm: string | null };
  if (p.raison_sociale === NOM_CABINET_TENANT_DEMO && p.rccm === MENTIONS_LEGALES.rccm) return;
  attendre(
    200,
    await associe.patch("/api/parametres-facturation", {
      ...MENTIONS_LEGALES,
      raison_sociale: NOM_CABINET_TENANT_DEMO,
      // Reconfirmation d'identité exigée pour poser l'IBAN.
      mot_de_passe: MOT_DE_PASSE_DEMO_TENANT,
    }),
    "mentions légales de facturation",
  );
}

/** Paramètres du cabinet, grades, barèmes, temps, calendrier et mentions légales. Idempotent. */
export async function assurerParametres(ctx: ContexteTenantDemo): Promise<void> {
  const associe = ctx.session("associe");

  attendre(
    200,
    await associe.patch("/api/cabinet", {
      pays: "CI",
      devise_base: "XOF",
      unite_saisie_temps: "demi_journee",
      heures_par_jour: 8,
      jours_travailles: [1, 2, 3, 4, 5],
    }),
    "paramètres du cabinet",
  );

  attendre(200, await associe.post("/api/catalogue/semer-conseil"), "catalogue de conseil");
  await remplirReferentiels(ctx, associe);
  await poserBaremes(ctx, associe);

  attendre(
    200,
    await associe.patch("/api/temps/parametres", {
      controle_capacite: "signaler",
      seuil_consommation_pct: 85,
    }),
    "paramètres de temps",
  );
  await assurerActivites(associe);
  await assurerCalendrier(associe);
  await assurerMentionsLegales(associe);
  ctx.journal("Paramètres du cabinet en place (grades, barèmes, temps, calendrier, facturation).");
}
