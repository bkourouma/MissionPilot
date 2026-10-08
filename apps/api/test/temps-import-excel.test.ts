import { deflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  IMPORT_EXCEL_CELLULES_MAX,
  IMPORT_EXCEL_STYLES_MAX,
  IMPORT_EXCEL_TAILLE_MAX,
  lireArchive,
} from "../src/temps/import-excel.js";
import { api, type Api } from "./api.js";
import { ECHANTILLONS, multipart, televerser } from "./fichiers-outils.js";
import { demarrer, type Contexte } from "./helpers.js";
import { preparerCabinet, type ApiUtilisateur, type CabinetMissions } from "./missions-outils.js";
import { missionTemps, type MissionTemps } from "./temps-outils.js";

let ctx: Contexte;
let a: CabinetMissions;
let b: CabinetMissions;
let m: MissionTemps;
let gestionnaire: ApiUtilisateur;

const INTITULE = "Reprise historique Excel";
const SENIOR = "senior de Cabinet Excel A";
const JUNIOR = "junior de Cabinet Excel A";
const ENTETE = ["Collaborateur", "Mission", "Tâche", "Date", "Jours"];
const jour = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Classeur .xlsx construit par ExcelJS (première feuille « Temps »). */
async function classeur(
  lignes: ExcelJS.CellValue[][],
  options: {
    preparer?: (f: ExcelJS.Worksheet, c: ExcelJS.Workbook) => void | Promise<void>;
  } = {},
): Promise<Buffer> {
  const c = new ExcelJS.Workbook();
  const f = c.addWorksheet("Temps");
  for (const l of lignes) f.addRow(l);
  await options.preparer?.(f, c);
  return Buffer.from((await c.xlsx.writeBuffer()) as ArrayBuffer);
}

interface OptionsZip {
  /** Taille décompressée déclarée, par entrée (taille mensongère). */
  annonce?: Record<string, number>;
  /** Entrées stockées sans compression (taux de compression de 1). */
  stockees?: string[];
  /**
   * Entrées présentes (données locales et en-têtes centraux, compris dans la taille du
   * répertoire) mais NON comptées dans l'enregistrement de fin.
   */
  cachees?: Map<string, Buffer>;
}

/** Archive ZIP compressée (deflate, sauf entrées stockées), forgée selon `options`. */
function zipDeflate(entrees: Map<string, Buffer>, options: OptionsZip = {}): Buffer {
  const locaux: Buffer[] = [];
  const centraux: Buffer[] = [];
  let decalage = 0;
  for (const [nom, donnees] of [...entrees, ...(options.cachees ?? [])]) {
    const n = Buffer.from(nom, "latin1");
    const methode = options.stockees?.includes(nom) ? 0 : 8;
    const compresse = methode === 0 ? donnees : deflateRawSync(donnees);
    const taille = options.annonce?.[nom] ?? donnees.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(methode, 8);
    local.writeUInt32LE(compresse.length, 18);
    local.writeUInt32LE(taille, 22);
    local.writeUInt16LE(n.length, 26);
    locaux.push(local, n, compresse);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(methode, 10);
    central.writeUInt32LE(compresse.length, 20);
    central.writeUInt32LE(taille, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(decalage, 42);
    centraux.push(central, n);
    decalage += 30 + n.length + compresse.length;
  }
  const repertoire = Buffer.concat(centraux);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(entrees.size, 8);
  fin.writeUInt16LE(entrees.size, 10);
  fin.writeUInt32LE(repertoire.length, 12);
  fin.writeUInt32LE(decalage, 16);
  return Buffer.concat([...locaux, repertoire, fin]);
}

/**
 * Étend les données de la dernière entrée (stockée) jusqu'à l'enregistrement de fin : elles
 * recouvrent alors tout le répertoire central (données partagées).
 */
function chevaucherRepertoire(zip: Buffer): Buffer {
  const b = Buffer.from(zip);
  const fin = b.length - 22;
  let dernier = b.readUInt32LE(fin + 16);
  for (let p = dernier; p < fin;) {
    dernier = p;
    p += 46 + b.readUInt16LE(p + 28) + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
  }
  const local = b.readUInt32LE(dernier + 42);
  const debutDonnees = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
  for (const position of [local + 18, local + 22, dernier + 20, dernier + 24]) {
    b.writeUInt32LE(fin - debutDonnees, position);
  }
  return b;
}

/** Entrées d'un classeur valide (une ligne de temps). */
const entreesValides = async () =>
  lireArchive(await classeur([ENTETE, [SENIOR, INTITULE, "Diagnostic", jour("2025-06-02"), 1]]));

/** Classeur valide dont on modifie les entrées de l'archive. */
async function modifie(
  changer: (e: Map<string, Buffer>) => void,
  options: OptionsZip = {},
): Promise<Buffer> {
  const e = await entreesValides();
  changer(e);
  return zipDeflate(e, options);
}

const remplacer = (e: Map<string, Buffer>, nom: string, de: RegExp, par: string) =>
  e.set(nom, Buffer.from((e.get(nom) as Buffer).toString("utf8").replace(de, par)));
const ajouter = (e: Map<string, Buffer>, nom: string, texte: string) =>
  e.set(nom, Buffer.concat([e.get(nom) as Buffer, Buffer.from(texte)]));

/** Téléversement avec des en-têtes supplémentaires (Origin…). */
const televerserAvec = (u: Api, contenu: Buffer, entetes: Record<string, string>) => {
  const m = multipart("historique.xlsx", contenu);
  return u.brut({
    method: "POST",
    url: "/api/temps/import/excel?simulation=true",
    payload: m.payload,
    headers: { ...m.headers, ...entetes },
  });
};

const importer = (u: Api, contenu: Buffer, simulation = true, nom = "historique.xlsx") =>
  televerser(u, `/api/temps/import/excel?simulation=${simulation}`, nom, contenu);

const refuse = async (contenu: Buffer, motif: RegExp, statut = 400) => {
  const r = await importer(gestionnaire, contenu);
  expect(r.statusCode, r.body).toBe(statut);
  expect(r.json().erreur.message).toMatch(motif);
  // Aucun chemin ni nom de fichier dans le message.
  expect(r.json().erreur.message).not.toMatch(/historique\.xlsx|[A-Z]:\\|\/(tmp|home|usr)\//);
  return r.json().erreur;
};

beforeAll(async () => {
  ctx = await demarrer();
  a = await preparerCabinet(ctx, "Cabinet Excel A");
  b = await preparerCabinet(ctx, "Cabinet Excel B");
  m = await missionTemps(
    a,
    { Diagnostic: { senior: 10 } },
    { intitule: INTITULE, debut: "2025-06-02", fin: "2025-08-29" },
  );
  gestionnaire = await a.avecRoles(["gestionnaire"]);
});
afterAll(() => ctx.fermer());

describe("import Excel de l'historique des temps (TPS-10)", () => {
  it("modèle téléchargeable : en-tête attendu, réimportable tel quel", async () => {
    const r = await gestionnaire.get("/api/temps/import/modele.xlsx");
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(r.headers["content-disposition"]).toMatch(
      /^attachment; filename="modele-import-temps\.xlsx"$/,
    );
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    const c = new ExcelJS.Workbook();
    await c.xlsx.load(r.rawPayload as unknown as ExcelJS.Buffer);
    expect(c.worksheets.map((f) => f.name)).toEqual(["Temps", "Mode d'emploi"]);
    expect((c.worksheets[0]?.getRow(1).values as unknown[]).slice(1)).toEqual(ENTETE);
    const rapport = await importer(gestionnaire, r.rawPayload);
    expect(rapport.statusCode, rapport.body).toBe(200);
    expect(rapport.json()).toMatchObject({ lignes_lues: 0, erreurs: [] });
    // Droits : temps.importer.
    expect((await a.chef.get("/api/temps/import/modele.xlsx")).statusCode).toBe(403);
    expect((await api(ctx).get("/api/temps/import/modele.xlsx")).statusCode).toBe(401);
  });

  it("fichier valide : dates Excel et texte, virgule décimale, formule lue en cache, exécution", async () => {
    const contenu = await classeur([
      [...ENTETE, "Commentaire"],
      [SENIOR, INTITULE, "Diagnostic", jour("2025-06-02"), 1, "=cmd|' /C calc'!A0"],
      [SENIOR, INTITULE, "Diagnostic", "03/06/2025", "0,5", { error: "#N/A" }],
      [],
      // Formule jamais évaluée : la valeur en cache (0,5) est retenue, pas « 1+1 ».
      [JUNIOR, INTITULE, "diagnostic", "2025-06-10", { formula: "1+1", result: 0.5 }],
      [JUNIOR, INTITULE, "Diagnostic", jour("2025-06-11"), 1],
    ]);
    const sim = await importer(gestionnaire, contenu);
    expect(sim.statusCode, sim.body).toBe(200);
    expect(sim.json()).toMatchObject({
      simulation: true,
      executee: false,
      lignes_lues: 4,
      lignes_valides: 4,
      feuilles: 2,
      jours_total: 3,
      erreurs: [],
    });
    expect((await a.directeur.get(`/api/missions/${m.id}/suivi`)).json().arbre.realise).toBe(0);
    const exec = await importer(gestionnaire, contenu, false);
    expect(exec.statusCode, exec.body).toBe(200);
    expect(exec.json()).toMatchObject({ executee: true, lignes_valides: 4, jours_total: 3 });
    expect((await a.directeur.get(`/api/missions/${m.id}/suivi`)).json().arbre.realise).toBe(3);
    // Même verrou que le CSV : une feuille existe déjà pour ces semaines.
    const again = await importer(gestionnaire, contenu);
    expect(again.json().erreurs[0].message).toMatch(/existe déjà/);
    // Isolation : rien n'a été écrit dans le cabinet B.
    const chezB = await ctx.db.withTenant(b.cabinetId, (db) =>
      db.query("SELECT count(*)::int AS n FROM feuilles_temps"),
    );
    expect(chezB.rows[0].n).toBe(0);
  });

  it("colonnes manquantes et en-tête illisible", async () => {
    const sansJours = await classeur([
      ENTETE.slice(0, 4),
      [SENIOR, INTITULE, "Diagnostic", "2025-07-01"],
    ]);
    const e = await refuse(sansJours, /Colonnes manquantes dans l'en-tête : jours\./);
    expect(e.code).toBe("REQUETE_INVALIDE");
    const vide = await classeur([]);
    await refuse(vide, /Colonnes manquantes/);
    const formuleEnTete = await classeur([
      ["Collaborateur", "Mission", "Tâche", "Date", { formula: "A1" }],
      [SENIOR, INTITULE, "Diagnostic", "2025-07-01", 1],
    ]);
    await refuse(formuleEnTete, /Colonnes manquantes.*jours/);
  });

  it("dates et nombres mal formés : erreur par ligne Excel, rien n'est importé", async () => {
    const contenu = await classeur([
      ENTETE,
      [SENIOR, INTITULE, "Diagnostic", "2025/07/01", 1],
      [SENIOR, INTITULE, "Diagnostic", 45839, 1],
      [SENIOR, INTITULE, "Diagnostic", new Date(Date.UTC(2025, 6, 3, 14, 30)), 1],
      [SENIOR, INTITULE, "Diagnostic", "32/07/2025", 1],
      [SENIOR, INTITULE, "Diagnostic", "2025-07-07", "1.5.2"],
      [SENIOR, INTITULE, "Diagnostic", "2025-07-08", "abc"],
      [SENIOR, INTITULE, "Diagnostic", "2025-07-09", true],
      [SENIOR, INTITULE, "Diagnostic", "2025-07-10", { formula: "B2*2" }],
      [SENIOR, INTITULE, "Diagnostic", "2025-07-11", { error: "#DIV/0!" }],
      [SENIOR, INTITULE, "Diagnostic", "2025-07-14", "0,3"],
      ["=1+1", INTITULE, "Diagnostic", "2025-07-15", 1],
      [SENIOR, INTITULE, "Diagnostic", "2025-07-16", 4],
    ]);
    const r = await importer(gestionnaire, contenu);
    expect(r.statusCode, r.body).toBe(200);
    const { erreurs, lignes_lues, lignes_valides } = r.json();
    expect({ lignes_lues, lignes_valides }).toEqual({ lignes_lues: 12, lignes_valides: 0 });
    const parLigne = Object.fromEntries(
      erreurs.map((e: { ligne: number; message: string }) => [e.ligne, e.message]),
    );
    expect(Object.keys(parLigne).map(Number)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(parLigne[2]).toMatch(/Date invalide : « 2025\/07\/01 »/);
    expect(parLigne[3]).toMatch(/Date invalide : « 45839 »/);
    expect(parLigne[4]).toMatch(/Cellule D4 : la date porte une heure/);
    expect(parLigne[5]).toMatch(/Date invalide : « 32\/07\/2025 »/);
    expect(parLigne[6]).toMatch(/Jours invalides : « 1\.5\.2 »/);
    expect(parLigne[7]).toMatch(/Jours invalides : « abc »/);
    expect(parLigne[8]).toMatch(/Cellule E8 : valeur logique/);
    expect(parLigne[9]).toMatch(/Cellule E9 : formule sans valeur calculée/);
    expect(parLigne[10]).toMatch(/Cellule E10 : valeur d'erreur Excel \(#DIV\/0!\)/);
    expect(parLigne[11]).toMatch(/demi-journée/);
    // Texte commençant par « = » : simple texte, jamais une formule.
    expect(parLigne[12]).toMatch(/Collaborateur actif inconnu.*« =1\+1 »/);
    expect(parLigne[13]).toMatch(/Jours invalides : « 4 »/);
    const exec = await importer(gestionnaire, contenu, false);
    expect(exec.statusCode).toBe(400);
    expect(exec.json().erreur.code).toBe("IMPORT_INVALIDE");
  });

  it("période clôturée : même verrouillage que le CSV", async () => {
    const cloture = await gestionnaire.post("/api/temps/periodes/2025-03/cloturer");
    expect(cloture.statusCode, cloture.body).toBe(200);
    const r = await importer(
      gestionnaire,
      await classeur([ENTETE, [SENIOR, INTITULE, "Diagnostic", jour("2025-03-10"), 1]]),
    );
    expect(r.json().erreurs[0]).toEqual({ ligne: 2, message: "Période clôturée : 2025-03-10." });
  });

  it("fichier trop gros, trop de lignes, de colonnes ou de feuilles", async () => {
    const gros = Buffer.concat([
      await classeur([ENTETE]),
      Buffer.alloc(IMPORT_EXCEL_TAILLE_MAX, 0x20),
    ]);
    const e = await refuse(gros, /Fichier trop volumineux : 2 Mo au plus/, 413);
    expect(e.code).toBe("FICHIER_TROP_VOLUMINEUX");
    const lignes = Array.from({ length: 5001 }, () => [
      SENIOR,
      INTITULE,
      "Diagnostic",
      "2025-07-01",
      1,
    ]);
    await refuse(await classeur([ENTETE, ...lignes]), /limité à 5000 lignes/);
    const large = [...ENTETE, ...Array.from({ length: 30 }, () => "")];
    large[30] = "colonne AE";
    await refuse(await classeur([large]), /30 colonnes renseignées au plus/);
    const feuilles = await classeur([ENTETE], {
      preparer: (_f, c) => {
        for (let i = 0; i < 10; i++) c.addWorksheet(`Feuille ${i}`);
      },
    });
    await refuse(feuilles, /10 feuilles au plus/);
  });

  it("archives piégées : taille décompressée, taux de compression, taille mensongère", async () => {
    // 20 Mio d'espaces : au-delà du plafond décompressé total.
    const total = await modifie((e) =>
      e.set("xl/media/image1.bin", Buffer.alloc(20 * 1024 * 1024, 0x20)),
    );
    expect(total.length).toBeLessThan(IMPORT_EXCEL_TAILLE_MAX);
    await refuse(total, /Archive refusée/);
    // 2 Mio de zéros (taux ~ 1 000) : sous le plafond total, refusé par le taux.
    const taux = await modifie((e) => e.set("xl/media/image1.bin", Buffer.alloc(2 * 1024 * 1024)));
    await refuse(taux, /Archive refusée/);
    // Taille annoncée de 1 000 octets pour un flux de 5 Mio : décompression interrompue.
    const ment = await modifie((e) => e.set("xl/media/image1.bin", Buffer.alloc(5 * 1024 * 1024)), {
      annonce: { "xl/media/image1.bin": 1000 },
    });
    await refuse(ment, /Archive refusée/);
    // Taille annoncée supérieure au contenu réel : archive incohérente.
    const incoherente = await modifie(() => undefined, { annonce: { "xl/workbook.xml": 2000 } });
    await refuse(incoherente, /illisible/);
  });

  it("répertoire central : ni entrée cachée au-delà du nombre annoncé, ni chevauchement", async () => {
    // JSZip (lecteur d'ExcelJS) lit les en-têtes centraux tant que leur signature se répète :
    // une feuille cachée après le compte remplacerait la feuille contrôlée sans aucun contrôle.
    const base = await entreesValides();
    const feuille = (base.get("xl/worksheets/sheet1.xml") as Buffer)
      .toString("utf8")
      .replace(/<sheetData>/, '<sheetProtection sheet="1"/><sheetData>');
    const cachee = new Map([["xl/worksheets/sheet1.xml", Buffer.from(feuille)]]);
    await refuse(zipDeflate(base, { cachees: cachee }), /illisible/);
    const inedite = new Map([["xl/worksheets/sheet2.xml", Buffer.from("<worksheet/>")]]);
    await refuse(zipDeflate(base, { cachees: inedite }), /illisible/);
    // Données de la dernière entrée étendues sur tout le répertoire central.
    const chevauche = chevaucherRepertoire(
      await modifie((e) => e.set("xl/media/image1.bin", Buffer.from("image")), {
        stockees: ["xl/media/image1.bin"],
      }),
    );
    await refuse(chevauche, /illisible/);
    // Octets ajoutés après l'enregistrement de fin (commentaire non déclaré).
    await refuse(Buffer.concat([zipDeflate(base), Buffer.from("PK")]), /illisible/);
    // Témoin : la même archive, sans entrée cachée, est acceptée.
    expect((await importer(gestionnaire, zipDeflate(base))).statusCode).toBe(200);
  });

  it("balises non fermées ou démesurées : refus en temps borné (aucun retour arrière)", async () => {
    const debut = Date.now();
    // 256 Kio de balises jamais fermées : 4 à 5 s par entrée avec une regex à retour arrière.
    await refuse(
      await modifie(
        (e) => ajouter(e, "xl/_rels/workbook.xml.rels", "<Relationship ".repeat(18_700)),
        {
          stockees: ["xl/_rels/workbook.xml.rels"],
        },
      ),
      /illisible/,
    );
    await refuse(
      await modifie((e) => ajouter(e, "xl/workbook.xml", "<fileSharing ".repeat(20_000)), {
        stockees: ["xl/workbook.xml"],
      }),
      /illisible/,
    );
    expect(Date.now() - debut).toBeLessThan(2_000);
    // Balise fermée mais de plus de 4 096 caractères : refusée aussi.
    await refuse(
      await modifie((e) =>
        remplacer(
          e,
          "xl/_rels/workbook.xml.rels",
          /<\/Relationships>/,
          `<Relationship Id="rId98"${" ".repeat(5_000)}/></Relationships>`,
        ),
      ),
      /illisible/,
    );
    // Protection en écriture : recherchée dans xl/workbook.xml.
    await refuse(
      await modifie((e) =>
        remplacer(
          e,
          "xl/workbook.xml",
          /<workbookPr/,
          '<fileSharing userName="x" reservationPassword="CC1A"/><workbookPr',
        ),
      ),
      /protégé en écriture/,
    );
    // Élément annexe (ni feuille ni textes partagés) de plus de 1 Mio, peu compressible.
    await refuse(
      await modifie(
        (e) =>
          remplacer(
            e,
            "xl/styles.xml",
            /<\/styleSheet>/,
            `<!--${"x".repeat(1 << 20)}--></styleSheet>`,
          ),
        { stockees: ["xl/styles.xml"] },
      ),
      /plus de 1 Mo/,
    );
  });

  it("textes partagés et styles bornés comme les cellules", async () => {
    await refuse(
      await modifie(
        (e) =>
          remplacer(
            e,
            "xl/sharedStrings.xml",
            /<\/sst>/,
            `${"<si/>".repeat(IMPORT_EXCEL_CELLULES_MAX + 1)}</sst>`,
          ),
        { stockees: ["xl/sharedStrings.xml"] },
      ),
      /Classeur trop grand/,
    );
    await refuse(
      await modifie((e) =>
        remplacer(
          e,
          "xl/styles.xml",
          /<\/styleSheet>/,
          `${"<xf/>".repeat(IMPORT_EXCEL_STYLES_MAX + 1)}</styleSheet>`,
        ),
      ),
      /styles/,
    );
  });

  it("faux .xlsx : CSV, PDF, document Word, ancien format ou chiffré, archive tronquée", async () => {
    await refuse(ECHANTILLONS.csv(), /n'est pas un classeur Excel/);
    await refuse(ECHANTILLONS.pdf(), /n'est pas un classeur Excel/);
    await refuse(ECHANTILLONS.docx(), /n'est pas un classeur Excel/);
    const ole = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(512),
    ]);
    await refuse(ole, /protégé par mot de passe ou au format Excel 97-2003/);
    const valide = await classeur([ENTETE]);
    await refuse(valide.subarray(0, Math.floor(valide.length / 2)), /illisible/);
    // XML malformé dans une archive correcte : ExcelJS échoue, message générique.
    const casse = await modifie((e) => e.set("xl/workbook.xml", Buffer.from("<workbook><sheets>")));
    await refuse(casse, /illisible|n'est pas un classeur/);
  });

  it("classeurs protégés, liaisons externes, macros, entités XML", async () => {
    const feuilleProtegee = await classeur([ENTETE], {
      preparer: (f) => f.protect("secret", {}),
    });
    await refuse(feuilleProtegee, /protégé/);
    await refuse(
      await modifie((e) =>
        remplacer(
          e,
          "xl/workbook.xml",
          /<sheets>/,
          '<workbookProtection lockStructure="1"/><sheets>',
        ),
      ),
      /protégé/,
    );
    await refuse(
      await modifie((e) =>
        e.set("xl/externalLinks/externalLink1.xml", Buffer.from("<externalLink/>")),
      ),
      /liaisons externes/,
    );
    await refuse(
      await modifie((e) =>
        remplacer(
          e,
          "xl/_rels/workbook.xml.rels",
          /<\/Relationships>/,
          '<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath" Target="file:///C:/partage/budget.xlsx" TargetMode="External"/></Relationships>',
        ),
      ),
      /liaisons externes/,
    );
    await refuse(await modifie((e) => e.set("xl/vbaProject.bin", Buffer.from("macro"))), /macros/);
    // Nom non terminé par .xml, pourtant lu comme une feuille par ExcelJS (motif non ancré) :
    // toute entrée hors média est contrôlée.
    await refuse(
      await modifie((e) =>
        e.set(
          "xl/worksheets/sheet2.xml.bak",
          Buffer.from('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "a">]><worksheet/>'),
        ),
      ),
      /illisible/,
    );
    await refuse(
      await modifie((e) =>
        remplacer(
          e,
          "xl/sharedStrings.xml",
          /^<\?xml[^>]*\?>/,
          '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]>',
        ),
      ),
      /illisible/,
    );
  });

  it("droits, format du téléversement, isolation entre cabinets", async () => {
    const contenu = await classeur([ENTETE, [SENIOR, INTITULE, "Diagnostic", "2025-08-04", 1]]);
    expect((await importer(a.chef, contenu)).statusCode).toBe(403);
    expect((await importer(api(ctx), contenu)).statusCode).toBe(401);
    // Pas de multipart : 415 ; mauvais champ : 400 ; simulation inconnue : 400.
    expect((await gestionnaire.post("/api/temps/import/excel", { csv: "x" })).statusCode).toBe(415);
    const champ = await televerser(gestionnaire, "/api/temps/import/excel", "t.xlsx", contenu, {
      champ: "autre",
    });
    expect(champ.statusCode).toBe(400);
    expect(
      (await televerser(gestionnaire, "/api/temps/import/excel?simulation=oui", "t.xlsx", contenu))
        .statusCode,
    ).toBe(400);
    // Depuis B, la mission et les collaborateurs de A sont inconnus.
    const r = await importer(b.associe, contenu);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().erreurs[0].message).toMatch(/inconnu/);
    expect((await importer(b.associe, contenu, false)).statusCode).toBe(400);
  });

  it("corps annoncé au-delà du plafond : 413 avant toute lecture, même sans session", async () => {
    // `bodyLimit` ne s'applique pas au multipart : le crochet onRequest lit content-length.
    const m = multipart("historique.xlsx", Buffer.alloc(IMPORT_EXCEL_TAILLE_MAX + 64 * 1024 + 1));
    for (const u of [api(ctx), gestionnaire]) {
      const r = await u.brut({
        method: "POST",
        url: "/api/temps/import/excel",
        payload: m.payload,
        headers: m.headers,
      });
      expect(r.statusCode, r.body).toBe(413);
      expect(r.json().erreur.code).toBe("FICHIER_TROP_VOLUMINEUX");
    }
  });

  it("CSRF : Origin d'un autre site refusé ; origine du web ou absence d'Origin acceptées", async () => {
    // Garde globale d'app.ts (origine-csrf.test.ts) : même comportement que l'ancienne garde locale.
    const contenu = await classeur([ENTETE]);
    const web = ctx.config.WEB_ORIGIN;
    for (const origine of ["https://malveillant.example", "null", `${web}.malveillant.example`]) {
      const r = await televerserAvec(gestionnaire, contenu, { origin: origine });
      expect(r.statusCode, origine).toBe(403);
      expect(r.json().erreur.code).toBe("ORIGINE_REFUSEE");
    }
    // L'origine est contrôlée avant la taille annoncée, comme avant.
    const gros = multipart(
      "historique.xlsx",
      Buffer.alloc(IMPORT_EXCEL_TAILLE_MAX + 64 * 1024 + 1),
    );
    const r403 = await api(ctx).brut({
      method: "POST",
      url: "/api/temps/import/excel",
      payload: gros.payload,
      headers: { ...gros.headers, origin: "https://malveillant.example" },
    });
    expect(r403.statusCode).toBe(403);
    expect(r403.json().erreur.code).toBe("ORIGINE_REFUSEE");
    const r = await televerserAvec(gestionnaire, contenu, { origin: web });
    expect(r.statusCode, r.body).toBe(200);
    // Client hors navigateur (pas d'Origin) : cookie de session et permission suffisent.
    expect((await televerserAvec(gestionnaire, contenu, {})).statusCode).toBe(200);
    // La bonne origine ne remplace pas l'authentification.
    expect((await televerserAvec(api(ctx), contenu, { origin: web })).statusCode).toBe(401);
  });
});
