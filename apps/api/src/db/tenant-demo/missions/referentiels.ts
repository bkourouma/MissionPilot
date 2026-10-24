import { attendre, type ContexteTenantDemo } from "../contexte.js";
import { PRIX_DIAGNOSTIC_FLASH, TYPES_SUPPLEMENTAIRES } from "./donnees-types.js";

/*
 * Référentiels dont la phase « missions » a besoin : grades et types de mission validés par le
 * métier (levée de `a_valider`), services candidats activés (diagnostic flash, business plan
 * bancable), types propres au cabinet (notation, redressement, due diligence) créés par les routes
 * du catalogue. Idempotent : chaque étape relit l'existant (par code) avant d'écrire.
 */

interface LigneCode {
  id: string;
  code: string;
  a_valider?: boolean;
}

export async function assurerReferentiels(ctx: ContexteTenantDemo): Promise<void> {
  const associe = ctx.session("associe");

  // Services candidats : prix fixe du diagnostic flash, puis activation des deux types.
  const services = await associe.get("/api/services-candidats");
  attendre(200, services, "services candidats");
  const flash = (
    services.json().elements as { code: string; prix: { personnalise: boolean } }[]
  ).find((s) => s.code === "diagnostic_flash");
  if (!flash?.prix.personnalise) {
    attendre(
      200,
      await associe.put("/api/services-candidats/diagnostic_flash/prix", PRIX_DIAGNOSTIC_FLASH),
      "prix du diagnostic flash",
    );
  }
  for (const service of ["diagnostic_flash", "business_plan_bancable"]) {
    attendre(
      200,
      await associe.post("/api/services-candidats/activer", { service }),
      `activation du service ${service}`,
    );
  }

  // Types propres au cabinet : créés s'ils manquent (code), avec leur modèle de découpage.
  const existants = new Set(
    ((await associe.get("/api/types-mission")).json().elements as LigneCode[]).map((t) => t.code),
  );
  for (const t of TYPES_SUPPLEMENTAIRES) {
    if (existants.has(t.code)) continue;
    const cree = await associe.post("/api/types-mission", {
      code: t.code,
      libelle: t.libelle,
      domaine: t.domaine,
      mode_facturation: t.mode_facturation,
      duree_type_jours: t.duree_type_jours,
      equipe_type: t.equipe_type,
    });
    attendre(201, cree, `type ${t.code}`);
    const typeId = cree.json().id as string;
    for (const [i, phase] of t.phases.entries()) {
      const p = await associe.post(`/api/types-mission/${typeId}/elements`, {
        libelle: phase.libelle,
        ordre: i,
      });
      attendre(201, p, `phase ${phase.libelle}`);
      for (const [j, tache] of phase.taches.entries()) {
        attendre(
          201,
          await associe.post(`/api/types-mission/${typeId}/elements`, {
            parent_id: p.json().id,
            libelle: tache.libelle,
            ordre: j,
            jours_par_grade: tache.jours,
            est_livrable: tache.livrable ?? false,
            est_jalon: tache.jalon ?? false,
          }),
          `tâche ${tache.libelle}`,
        );
      }
    }
  }

  // Validation métier des valeurs de départ (grades, puis types).
  const grades = (await associe.get("/api/grades")).json().elements as LigneCode[];
  for (const g of grades.filter((x) => x.a_valider)) {
    attendre(
      200,
      await associe.patch(`/api/grades/${g.id}`, { a_valider: false }),
      `grade ${g.code}`,
    );
  }
  const types = (await associe.get("/api/types-mission")).json().elements as LigneCode[];
  for (const t of types.filter((x) => x.a_valider)) {
    attendre(
      200,
      await associe.patch(`/api/types-mission/${t.id}`, { a_valider: false }),
      `type ${t.code}`,
    );
  }
  for (const t of types) ctx.typesMission[t.code] = t.id;
  for (const g of grades) ctx.grades[g.code] = g.id;
}
