import { createHash } from "node:crypto";
import { journaliser } from "../audit.js";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { reconstruireArchive } from "../temps/import-excel.js";
import type { ClientDossier } from "./acces.js";
import { detailEtat, listerEtats } from "./etats.js";
import { listerFacteurs, type VueFacteur } from "./facteurs.js";
import { listerFaits, type VueFait } from "./faits.js";
import { indiceSansHistorique, lireFiabilite } from "./fiabilite.js";
import { friseDossier } from "./frise.js";

/*
 * Export du dossier à la demande du client (DOS-07 : portabilité, loi n° 2013-450 et
 * RGPD). JSON complet (faits avec leur historique, facteurs, états financiers et leurs
 * lignes référencées, indice de fiabilité, frise) ou archive ZIP (le même JSON et des CSV
 * lisibles dans un tableur). Destiné au client : aucun nom ni identifiant de membre du
 * cabinet, aucune donnée FIN-02 (le dossier n'en porte pas). Chaque export est tracé
 * (`dossier_exports`, empreinte et taille du contenu remis) et journalisé, dans la même
 * transaction que sa construction.
 */

type Format = "json" | "zip";

/** Fait sans auteur ni décideur (données du client seulement). */
function faitExporte(f: VueFait) {
  return {
    id: f.id,
    categorie: f.categorie,
    cle: f.cle,
    valeur: f.valeur,
    date_effet: f.date_effet,
    source: f.source,
    fiabilite: f.fiabilite,
    origine: f.origine,
    statut: f.statut,
    remplace_id: f.remplace_id,
    enregistre_le: f.cree_le,
    decision: f.decision
      ? { decision: f.decision.decision, motif: f.decision.motif, le: f.decision.le }
      : null,
  };
}

function facteurExporte(f: VueFacteur) {
  return {
    code: f.code,
    type: f.type,
    valeur: f.valeur,
    date_effet: f.date_effet,
    source: f.source,
    fiabilite: f.fiabilite,
    enregistre_le: f.cree_le,
  };
}

/** État sans importateur ni décideur ; décision réduite à son contenu. */
const etatExporte = ({
  importe_par: _i,
  decision,
  ...detail
}: Awaited<ReturnType<typeof detailEtat>>) => ({
  ...detail,
  decision: decision
    ? {
        decision: decision.decision,
        automatique: decision.automatique,
        motif: decision.motif,
        le: decision.le,
      }
    : null,
});

async function contenuDossier(db: Db, auth: Auth, client: ClientDossier) {
  const etats = [];
  for (const e of await listerEtats(db, client.id)) {
    etats.push(etatExporte(await detailEtat(db, client.id, e.id)));
  }
  const fiabilite = indiceSansHistorique(await lireFiabilite(db, client.id));
  const frise = await friseDossier(db, auth, client.id, { limite: 500, ordre: "ancien_d_abord" });
  return {
    format: "missionpilot.dossier-client",
    version: 1,
    genere_le: new Date().toISOString(),
    mention:
      "Export du dossier de l'entreprise à sa demande (portabilité : loi n° 2013-450 et RGPD). " +
      "Montants en unités mineures de la devise indiquée (FCFA : 1 unité ; EUR, USD : centimes).",
    client: {
      raison_sociale: client.raison_sociale,
      forme_juridique: client.forme_juridique,
      rccm: client.rccm,
      secteur: client.secteur,
      pays: client.pays,
      taille: client.taille,
    },
    faits: (await listerFaits(db, client.id, "tous")).map(faitExporte),
    facteurs: (await listerFacteurs(db, client.id)).map(facteurExporte),
    etats_financiers: etats,
    fiabilite,
    frise: frise.evenements.map(({ mission_id: _m, ...e }) => e),
  };
}

/** Cellule CSV : guillemets échappés ; un texte qui commencerait une formule est neutralisé. */
function cellule(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const brut = typeof v === "string" ? v : JSON.stringify(v);
  const texte = /^[=+\-@\t\r]/.test(brut) ? `'${brut}` : brut;
  return /[";\n\r]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
}

const csv = (entete: string[], lignes: unknown[][]) =>
  `\ufeff${[entete, ...lignes].map((l) => l.map(cellule).join(";")).join("\r\n")}\r\n`;

type Contenu = Awaited<ReturnType<typeof contenuDossier>>;

function archive(contenu: Contenu, json: string): Buffer {
  const fichiers = new Map<string, Buffer>();
  fichiers.set("dossier.json", Buffer.from(json, "utf8"));
  fichiers.set(
    "faits.csv",
    Buffer.from(
      csv(
        ["categorie", "cle", "valeur", "date_effet", "source", "fiabilite", "statut"],
        contenu.faits.map((f) => [
          f.categorie,
          f.cle,
          f.valeur,
          f.date_effet,
          f.source.libelle,
          f.fiabilite,
          f.statut,
        ]),
      ),
      "utf8",
    ),
  );
  fichiers.set(
    "facteurs.csv",
    Buffer.from(
      csv(
        ["code", "valeur", "date_effet", "source", "fiabilite"],
        contenu.facteurs.map((f) => [
          f.code,
          f.valeur,
          f.date_effet,
          f.source.libelle,
          f.fiabilite,
        ]),
      ),
      "utf8",
    ),
  );
  fichiers.set(
    "etats-financiers.csv",
    Buffer.from(
      csv(
        ["exercice", "statut", "devise", "section", "code", "libelle", "montant", "reference"],
        contenu.etats_financiers.flatMap((e) =>
          e.lignes.map((l) => [
            e.exercice,
            e.statut,
            e.devise,
            l.section,
            l.code,
            l.libelle,
            l.montant,
            l.reference,
          ]),
        ),
      ),
      "utf8",
    ),
  );
  fichiers.set(
    "LISEZMOI.txt",
    Buffer.from(
      `${contenu.mention}\r\nGénéré le ${contenu.genere_le}.\r\n` +
        "dossier.json : contenu complet ; les fichiers .csv (séparateur « ; ») en reprennent l'essentiel.\r\n",
      "utf8",
    ),
  );
  return reconstruireArchive(fichiers);
}

/** Construit l'export, le trace et le journalise. Dossier visible (vérifié par l'appelant). */
export async function exporterDossier(db: Db, auth: Auth, client: ClientDossier, format: Format) {
  const contenu = await contenuDossier(db, auth, client);
  const json = JSON.stringify(contenu, null, 2);
  const corps = format === "zip" ? archive(contenu, json) : Buffer.from(json, "utf8");
  const sha256 = createHash("sha256").update(corps).digest("hex");
  const volumes = {
    faits: contenu.faits.length,
    facteurs: contenu.facteurs.length,
    etats_financiers: contenu.etats_financiers.length,
    evenements: contenu.frise.length,
  };
  const r = await db.query(
    `INSERT INTO dossier_exports (cabinet_id, client_id, format, sha256, taille, volumes, demandeur_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      auth.cabinetId,
      client.id,
      format,
      sha256,
      corps.length,
      JSON.stringify(volumes),
      auth.utilisateurId,
    ],
  );
  await journaliser(db, {
    cabinetId: auth.cabinetId,
    utilisateurId: auth.utilisateurId,
    action: "dossier.exporter",
    entite: "dossier_client",
    entiteId: client.id,
    details: { export_id: r.rows[0].id, format, sha256, taille: corps.length, ...volumes },
  });
  return { corps, format, sha256 };
}
