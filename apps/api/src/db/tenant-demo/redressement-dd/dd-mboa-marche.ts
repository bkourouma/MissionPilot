import type { Chantier } from "./dd-mboa.js";
import {
  ACTIONS,
  ACTIVITE_DIESEL,
  ACTIVITES_MBOA,
  DIMENSIONNEMENTS,
  THEMES_FILTRAGE_1,
  THEMES_FILTRAGE_2,
  type DefParametre,
} from "./dd-mboa-marche-donnees.js";
import { ecrire } from "./dd-outils.js";
import type { Referentiel } from "./dd-referentiel.js";

/*
 * Dimensionnement de marché, filtrage environnemental et social et plan des 100 jours du dossier
 * Mboa Solaire, par les routes `/api/dd/**` :
 *
 * - dimensionnement ascendant (deux versions, la seconde avec un ajustement tracé) et descendant :
 *   les bornes et les sources sont des entrées, les résultats et le recoupement sortent du moteur ;
 * - filtrage E&S : premier filtrage sur la liste standard du cabinet, second sur la liste propre
 *   au client (le dernier filtrage reçoit les décisions). Les décisions viennent de comptes
 *   `dd.valider` qui n'ont rédigé aucun filtrage (séparation des tâches, MPZ28) ;
 * - plan des 100 jours : actions posées par les consultants, une avancée en cours.
 */

function parametres(ch: Chantier, liste: DefParametre[]) {
  return liste.map((p) => ({
    code: p.code,
    bas: p.bas,
    base: p.base,
    haut: p.haut,
    source:
      "preuve" in p.source
        ? { type: "preuve", preuve_id: ch.preuves.get(p.source.preuve) }
        : { type: "avis_expert", motif: p.source.avis },
  }));
}

async function dimensionnements(ch: Chantier): Promise<void> {
  const d = ch.dossierId;
  for (const def of DIMENSIONNEMENTS) {
    const cree = await ecrire<{ id: string }>(
      ch.par(def.par),
      `/api/dd/dossiers/${d}/dimensionnements`,
      {
        methode: def.methode,
        libelle: def.libelle,
        parametres: parametres(ch, def.parametres),
        ajustements: def.ajustements,
      },
      `dimensionnement ${def.methode}`,
    );
    await ch.dater(def.j);
    if (def.revision) {
      const r = def.revision;
      await ecrire(
        ch.par(r.par),
        `/api/dd/dimensionnements/${cree.id}/versions`,
        {
          libelle: r.libelle,
          parametres: parametres(ch, def.parametres),
          ajustements: r.ajustements,
          version_courante: 1,
          motif: r.motif,
        },
        `dimensionnement ${def.methode} v2`,
      );
      await ch.dater(r.j);
    }
  }
}

async function filtrages(ch: Chantier, ref: Referentiel): Promise<void> {
  const d = ch.dossierId;
  const standard = ref.listes.get("Liste d'exclusion standard du cabinet");
  const client = ref.listes.get(
    "Liste d'exclusion — Mboa Énergie Solaire (cadre de l'investisseur)",
  );
  if (!standard || !client) throw new Error("Listes d'exclusion du référentiel introuvables.");
  // Premier filtrage (liste du cabinet) : aucune règle touchée.
  await ecrire(
    ch.par("consultant"),
    `/api/dd/dossiers/${d}/filtrages`,
    {
      liste_id: standard,
      declarations: { activites: ACTIVITES_MBOA, secteur_codes: ["citi_d"], pays_codes: ["cm"] },
      themes: THEMES_FILTRAGE_1,
    },
    "filtrage 1",
  );
  await ch.dater(52);
  // Second filtrage (liste propre au client) : l'activité accessoire de secours touche une règle.
  const f2 = await ecrire<{ id: string; touches: { regle: string }[] }>(
    ch.par("consultant2"),
    `/api/dd/dossiers/${d}/filtrages`,
    {
      liste_id: client,
      declarations: {
        activites: [...ACTIVITES_MBOA, ACTIVITE_DIESEL],
        secteur_codes: ["citi_d"],
        pays_codes: ["cm"],
      },
      themes: THEMES_FILTRAGE_2,
    },
    "filtrage 2",
  );
  await ch.dater(78);
  const regle = f2.touches[0]?.regle;
  if (!regle) throw new Error("Le second filtrage ne touche aucune règle : décisions impossibles.");
  await ecrire(
    ch.a.expert,
    `/api/dd/filtrages/${f2.id}/decisions`,
    {
      regle_code: regle,
      decision: "confirmee",
      motif:
        "Activité de fourniture de groupes diesel confirmée en attente des contrats de secours.",
    },
    "décision 1",
  );
  await ch.dater(79);
  await ecrire(
    ch.a.expert2,
    `/api/dd/filtrages/${f2.id}/decisions`,
    {
      regle_code: regle,
      decision: "ecartee",
      motif:
        "Les contrats de secours examinés montrent une activité accessoire sans production d'électricité pour la vente : exclusion écartée.",
    },
    "décision 2",
  );
  await ch.dater(83);
}

async function plan(ch: Chantier): Promise<void> {
  const d = ch.dossierId;
  const ids: string[] = [];
  for (const act of ACTIONS) {
    const r = await ecrire<{ id: string }>(
      ch.par(act.responsable ?? "consultant"),
      `/api/dd/dossiers/${d}/plan-100j/actions`,
      {
        libelle: act.libelle,
        description: act.description,
        jour_debut: act.jour_debut,
        jour_fin: act.jour_fin,
        statut_action: act.statut,
        responsable_id: act.responsable ? ch.par(act.responsable).utilisateurId : null,
      },
      `action ${act.libelle}`,
    );
    ids.push(r.id);
    await ch.dater(act.j);
  }
  await ecrire(
    ch.par("consultant"),
    `/api/dd/actions/${ids[2]}/versions`,
    {
      version_courante: 1,
      motif: "Travail engagé avec le directeur financier du vendeur.",
      statut_action: "en_cours",
    },
    "action v2",
  );
  await ch.dater(100);
}

export async function semerMarcheMboa(ch: Chantier, ref: Referentiel): Promise<void> {
  // Dimensionnement et premier filtrage précèdent les verdicts dans le calendrier, mais leurs
  // lignes sont antidatées à leur jour : l'ordre d'exécution ne change pas l'ordre des dates.
  await dimensionnements(ch);
  await filtrages(ch, ref);
  await plan(ch);
  ch.ctx.journal("  DD Mboa : dimensionnements, filtrages et plan des 100 jours posés.");
}
