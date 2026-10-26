import { pdfDemo } from "../../seed-demo-portail.js";
import { attendre, type ContexteTenantDemo, type SessionDemo } from "../contexte.js";
import type { CleCompte } from "../cles.js";
import { corpsMultipart } from "../gestion/salle-fichiers.js";
import { chronologieCommerciale } from "./chronologie.js";
import type { MissionBatie, TacheLue } from "./construction.js";

/*
 * Vie de la mission après la signature : jalons franchis (dates cohérentes avec le calendrier),
 * documents (proposition, compte rendu de lancement, livrables dont le contenu rédigé avec l'IA
 * passe de « brouillon IA » à « modifié » puis « validé » par deux personnes différentes) et,
 * pour une mission terminée, préparation de la clôture : jalons livrés, statut « à clôturer »,
 * check-list évaluée, satisfaction du client saisie. La clôture elle-même : cloture.ts.
 */

export interface DocumentDepose {
  id: string;
  /** Date fictive du dépôt (antidatage). */
  date: string;
}

const slug = (texte: string): string =>
  texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

/**
 * Téléverse un petit PDF fictif DÉTERMINISTE (route `POST /api/fichiers`, session du déposant) et
 * renvoie l'identifiant du fichier : un document de mission rattaché à un fichier réellement servi
 * est téléchargeable (portail compris), contrairement à un simple chemin de stockage.
 */
async function televerserPdf(
  ctx: ContexteTenantDemo,
  session: SessionDemo,
  m: MissionBatie,
  doc: { type: string; nom: string },
  version: number,
): Promise<string> {
  const contenu = pdfDemo(doc.nom, [
    `Document fictif de demonstration (version ${version}).`,
    `Mission : ${m.def.nom}.`,
    `Type : ${doc.type}.`,
    "Aucune donnee reelle : jeu de donnees du cabinet Tenant demo.",
  ]);
  const nomFichier = `${slug(doc.nom)}-v${version}.pdf`;
  const corps = corpsMultipart(nomFichier, contenu);
  const r = await ctx.app.inject({
    method: "POST",
    url: "/api/fichiers",
    headers: { cookie: session.cookie, ...corps.headers },
    payload: corps.payload,
  });
  attendre(201, r, `téléversement ${nomFichier}`);
  return r.json().id as string;
}

async function deposer(
  ctx: ContexteTenantDemo,
  session: SessionDemo,
  m: MissionBatie,
  doc: { type: string; nom: string; statut_contenu?: "brouillon_ia" },
  version = 1,
): Promise<string> {
  const fichierId = await televerserPdf(ctx, session, m, doc, version);
  const r = await session.post(`/api/missions/${m.id}/documents`, {
    type: doc.type,
    nom: doc.nom,
    fichier_id: fichierId,
    ...(doc.statut_contenu ? { statut_contenu: doc.statut_contenu } : {}),
  });
  attendre(201, r, `document ${doc.nom}`);
  return r.json().id as string;
}

/** Premier collaborateur senior de la mission qui a un compte (auteur des livrables), sinon le chef. */
function auteurLivrables(ctx: ContexteTenantDemo, m: MissionBatie): SessionDemo {
  for (const cle of m.def.equipe.senior ?? []) {
    const s = ctx.sessions[cle as CleCompte];
    if (s) return s;
  }
  return ctx.session(m.def.chef);
}

/** Documents de la mission : proposition, lancement, livrables échus (contenu validé par le circuit). */
export async function deposerDocuments(
  ctx: ContexteTenantDemo,
  m: MissionBatie,
): Promise<DocumentDepose[]> {
  const def = m.def;
  const chef = ctx.session(def.chef);
  const directeur = ctx.session(def.directeur);
  const deposes: DocumentDepose[] = [];
  const propId = await deposer(ctx, chef, m, {
    type: "proposition",
    nom: "Proposition technique et financière",
  });
  deposes.push({ id: propId, date: chronologieCommerciale(def).envoyee });
  if (!def.signature) return deposes;
  // La lettre de mission créée par la signature n'a pas de fichier : une version 2, PDF fictif
  // déposé par l'associé (droit de signature), la rend téléchargeable. Elle est datée du jour de signature.
  const lettreId = await deposer(
    ctx,
    ctx.session("associe"),
    m,
    { type: "lettre_de_mission", nom: "Lettre de mission" },
    2,
  );
  deposes.push({ id: lettreId, date: def.signature });
  // Le compte rendu de lancement n'existe que si la réunion a eu lieu (début passé).
  if (def.debut <= ctx.aujourdhui) {
    const lancement = await deposer(ctx, chef, m, {
      type: "autre",
      nom: "Compte rendu de la réunion de lancement",
    });
    deposes.push({ id: lancement, date: def.debut });
  }

  const auteur = auteurLivrables(ctx, m);
  const limite = ctx.jour(-2);
  for (const t of m.taches.filter((x: TacheLue) => x.est_livrable)) {
    const fin = m.fenetres.get(t.id)?.fin;
    if (!fin || fin > limite) continue;
    const id = await deposer(ctx, auteur, m, {
      type: "livrable",
      nom: t.libelle,
      statut_contenu: "brouillon_ia",
    });
    attendre(
      200,
      await chef.post(`/api/documents/${id}/statut`, { statut: "modifie" }),
      "relecture",
    );
    // Validé par le directeur (ni l'auteur ni le dernier relecteur), sauf livrable tout récent.
    if (fin <= ctx.jour(-14) || def.etat === "terminee") {
      attendre(
        200,
        await directeur.post(`/api/documents/${id}/statut`, { statut: "valide" }),
        "validation du livrable",
      );
    }
    deposes.push({ id, date: fin });
  }
  return deposes;
}

/** Marque atteints les jalons dont la date prévue est passée (tous ceux d'une mission terminée). */
export async function franchirJalons(ctx: ContexteTenantDemo, m: MissionBatie): Promise<void> {
  if (!m.def.signature) return;
  const chef = ctx.session(m.def.chef);
  const lus = await chef.get(`/api/missions/${m.id}/decoupage`);
  attendre(200, lus, "jalons");
  const limite = ctx.jour(-2);
  for (const j of lus.json().jalons as {
    id: string;
    date_prevue: string | null;
    atteint: boolean;
  }[]) {
    const franchi =
      m.def.etat === "terminee" || (j.date_prevue !== null && j.date_prevue <= limite);
    if (!franchi || j.atteint) continue;
    attendre(
      200,
      await chef.patch(`/api/missions/${m.id}/jalons/${j.id}`, { atteint: true }),
      "jalon franchi",
    );
  }
}

/** Mission terminée : « à clôturer », check-list évaluée, satisfaction du client saisie. */
export async function preparerCloture(ctx: ContexteTenantDemo, m: MissionBatie): Promise<void> {
  const def = m.def;
  if (def.etat !== "terminee") return;
  const chef = ctx.session(def.chef);
  attendre(
    200,
    await ctx.session(def.directeur).post(`/api/missions/${m.id}/statut`, { statut: "a_cloturer" }),
    "mission à clôturer",
  );
  attendre(
    200,
    await chef.post(`/api/missions/${m.id}/cloture/evaluer`, {}),
    "évaluation de clôture",
  );
  if (def.satisfaction) {
    attendre(
      201,
      await chef.post(`/api/qualite/missions/${m.id}/satisfactions`, {
        moment: "cloture",
        note: def.satisfaction.note,
        commentaire: def.satisfaction.commentaire,
        repondant: def.satisfaction.repondant,
      }),
      "satisfaction de clôture",
    );
  }
}
