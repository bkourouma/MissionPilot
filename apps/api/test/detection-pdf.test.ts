import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { cheminNavigateur, htmlEnPdf } from "../src/rapports/pdf.js";
import { detecterType, PLAFONDS_PDF } from "../src/stockage/detection.js";
import { configTest } from "./helpers.js";

/*
 * Détection du contenu actif des PDF (stockage/detection.ts) : les données
 * de flux ne sont plus fouillées (faux positifs), les noms actifs sont
 * cherchés dans la syntaxe et dans les flux d'objets décompressés sous
 * plafonds ; toute structure ambiguë retombe sur l'ancienne recherche brute.
 * Les PDF « Chromium réels » exigent le navigateur local (CHROMIUM_PATH, ou
 * Chrome sous Windows) : sans lui, le test est SAUTÉ et le dit.
 */

const navigateur = cheminNavigateur(configTest());
const raison = navigateur ? "" : " (SAUTÉ : aucun navigateur, définir CHROMIUM_PATH)";

const ACTIF = /contenu actif/;
const ILLISIBLE = /non analysable/;
const VOLUME = /trop volumineux/;

/** Refus (code et message), ou null si le PDF est accepté. */
function verdict(pdf: Buffer): { code: string; message: string } | null {
  try {
    detecterType(pdf, "pdf");
    return null;
  } catch (erreur) {
    const { code, message } = erreur as { code: string; message: string };
    return { code, message };
  }
}

function refuse(pdf: Buffer, motif: RegExp): void {
  const v = verdict(pdf);
  expect(v?.code).toBe("TYPE_FICHIER_REFUSE");
  expect(v?.message).toMatch(motif);
}

/** Ancienne règle (recherche sur le fichier entier, flux compris) : montre les faux positifs levés. */
const ancienneRegle = (pdf: Buffer) =>
  /\/(JavaScript|JS|Launch|EmbeddedFiles?|RichMedia)(?![A-Za-z0-9])/.test(
    pdf
      .toString("latin1")
      .replace(/#([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))),
  );

/** Octets pseudo-aléatoires reproductibles (xorshift32), éventuellement tirés d'un alphabet. */
function aleatoire(n: number, alphabet?: Buffer, graine = 0x2545f491): Buffer {
  const b = Buffer.alloc(n);
  let x = graine;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    b[i] = alphabet ? (alphabet[(x >>> 0) % alphabet.length] as number) : x & 0xff;
  }
  return b;
}

/** PDF : objets numérotés à partir de 1, table xref et trailer. */
function assembler(objets: (string | Buffer)[], trailer = "/Root 1 0 R"): Buffer {
  const entete = Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1");
  const morceaux = [entete];
  const decalages: number[] = [];
  let position = entete.length;
  objets.forEach((corps, i) => {
    const objet = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`, "latin1"),
      Buffer.isBuffer(corps) ? corps : Buffer.from(corps, "latin1"),
      Buffer.from("\nendobj\n", "latin1"),
    ]);
    decalages.push(position);
    morceaux.push(objet);
    position += objet.length;
  });
  const lignes = decalages.map((d) => `${String(d).padStart(10, "0")} 00000 n \n`).join("");
  const n = objets.length + 1;
  morceaux.push(
    Buffer.from(
      `xref\n0 ${n}\n0000000000 65535 f \n${lignes}trailer\n<< /Size ${n} ${trailer} >>\nstartxref\n${position}\n%%EOF\n`,
      "latin1",
    ),
  );
  return Buffer.concat(morceaux);
}

/** Corps d'un objet flux : dictionnaire (Length ajoutée) puis données. */
function flux(dict: string, donnees: Buffer | string): Buffer {
  const d = Buffer.isBuffer(donnees) ? donnees : Buffer.from(donnees, "latin1");
  return Buffer.concat([
    Buffer.from(`<< ${dict} /Length ${d.length} >>\nstream\n`, "latin1"),
    d,
    Buffer.from("\nendstream", "latin1"),
  ]);
}

/** Flux d'objets (ObjStm) : objets numérotés à partir de `premier`. */
function fluxObjets(
  objets: string[],
  options: { premier?: number; dict?: string; compresser?: boolean } = {},
): Buffer {
  const { premier = 10, dict = "/Type /ObjStm", compresser = true } = options;
  let corps = "";
  const paires: string[] = [];
  objets.forEach((o, i) => {
    paires.push(`${premier + i} ${corps.length}`);
    corps += `${o}\n`;
  });
  const tete = `${paires.join(" ")}\n`;
  const donnees = Buffer.from(tete + corps, "latin1");
  const filtre = compresser ? " /Filter /FlateDecode" : "";
  return flux(
    `${dict} /N ${objets.length} /First ${tete.length}${filtre}`,
    compresser ? deflateSync(donnees) : donnees,
  );
}

const CATALOGUE = "<< /Type /Catalog /Pages 2 0 R >>";
const PAGES = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
const PAGE = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>";
const CONTENU = flux("/Filter /FlateDecode", deflateSync("BT /F1 12 Tf 72 720 Td (Bonjour) Tj ET"));

/** Document d'une page ; objets supplémentaires numérotés à partir de 5. */
const documentPdf = (catalogue = CATALOGUE, autres: (string | Buffer)[] = [], trailer?: string) =>
  assembler([catalogue, PAGES, PAGE, CONTENU, ...autres], trailer);

/** Écrit des motifs au milieu des données du plus grand flux Flate (tirage malchanceux simulé). */
function piquer(pdf: Buffer, motifs: string[]): Buffer {
  const texte = pdf.toString("latin1");
  let zone = [0, 0];
  for (const m of texte.matchAll(/\/FlateDecode[^>]*>>\s*stream\r?\n/g)) {
    const debut = (m.index as number) + m[0].length;
    const fin = texte.indexOf("endstream", debut);
    if (fin - debut > (zone[1] as number) - (zone[0] as number)) zone = [debut, fin];
  }
  const [debut, fin] = zone as [number, number];
  const pas = Math.floor((fin - debut) / (motifs.length + 1));
  expect(pas).toBeGreaterThan(16);
  const copie = Buffer.from(pdf);
  motifs.forEach((motif, i) => copie.write(motif, debut + pas * (i + 1), "latin1"));
  return copie;
}

const MOTIFS_HASARD = [
  " /JS ",
  "/J#53]",
  "/JavaScript(",
  "/Launch ",
  "/EmbeddedFile<",
  "/XFA ",
  "/3D>",
];

describe.skipIf(!navigateur)(`PDF Chromium réels${raison}`, () => {
  it("acceptés, y compris avec « /JS » dans le titre et au hasard dans un flux compressé", async () => {
    const pages = {
      texte: `<h1>Rapport</h1>${Array.from({ length: 300 }, (_, i) => `<p>Ligne ${i} : été, ŒUVRE, 漢字</p>`).join("")}`,
      tableau: `<table border="1">${Array.from({ length: 150 }, (_, i) => `<tr><td>${i}</td><td><b>${i * 17}</b></td><td><a href="https://exemple.invalid/${i}">lien</a></td></tr>`).join("")}</table>`,
      dessin: `<svg width="400" height="300">${Array.from({ length: 200 }, (_, i) => `<circle cx="${(i * 37) % 400}" cy="${(i * 53) % 300}" r="${i % 20}" fill="rgba(${i % 255},90,${(i * 7) % 255},0.5)"/>`).join("")}</svg>`,
    };
    for (const [nom, corps] of Object.entries(pages)) {
      const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Mission CI/JS ${nom} #4AS, maquette /3D et /XFA</title></head><body>${corps}</body></html>`;
      const pdf = await htmlEnPdf(html, {
        cheminNavigateur: navigateur as string,
        cabinetId: null,
      });
      expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(pdf.includes("/ObjStm")).toBe(false); // Chromium n'écrit pas de flux d'objets
      expect(verdict(pdf), nom).toBeNull();
      const pique = piquer(pdf, MOTIFS_HASARD);
      expect(ancienneRegle(pique)).toBe(true); // l'ancienne règle le refusait
      expect(verdict(pique), `${nom} piqué`).toBeNull();
    }
  }, 120_000);
});

describe("PDF : faux positifs des données de flux supprimés", () => {
  it("motifs actifs au hasard dans des données binaires de flux : acceptés", () => {
    const binaire = Buffer.concat([
      aleatoire(3000),
      Buffer.from(MOTIFS_HASARD.join("")),
      aleatoire(3000, undefined, 7),
    ]);
    const image = flux(
      "/Type /XObject /Subtype /Image /Width 10 /Height 10 /Filter /DCTDecode",
      binaire,
    );
    const pdf = documentPdf(CATALOGUE, [image]);
    expect(ancienneRegle(pdf)).toBe(true);
    expect(verdict(pdf)).toBeNull();
  });

  it("« /JS » dans une chaîne de texte (titre, auteur) : accepté", () => {
    const pdf = documentPdf(
      CATALOGUE,
      ["<< /Title (Mission CI/JS) /Author <FEFF0041> >>"],
      "/Root 1 0 R /Info 5 0 R",
    );
    expect(ancienneRegle(pdf)).toBe(true);
    expect(verdict(pdf)).toBeNull();
  });

  it("variantes de structure courantes acceptées en lecture stricte (CRLF, mise à jour incrémentale, flux xref)", () => {
    const binaire = Buffer.concat([
      aleatoire(500),
      Buffer.from(" /JS "),
      aleatoire(500, undefined, 3),
    ]);
    // Mise à jour incrémentale : second corps, seconde table xref et trailer /Prev.
    const base = documentPdf(CATALOGUE, [flux("/Filter /FlateDecode", binaire)]);
    const ajout = Buffer.from(
      `% mise à jour\n6 0 obj<</Type/Annot/Subtype/Text/Rect[0 0 10 10]/Contents(note)>>endobj\r\n` +
        `7 0 obj\r\n<< /Type /XRef /W [1 2 1] /Size 8 /Filter /FlateDecode /Length 5 >>\r\nstream\r\n\x00\x01/JS\r\nendstream\r\nendobj\r\n` +
        `8 0 obj\r\n<< /Length 4 >>\r\nstream\r\n/JS \r\nendstream\r\n` + // endobj manquant : toléré
        `9 0 obj\nendobj\n` +
        `xref\n6 1\n0000000000 00000 n \ntrailer\n<< /Size 10 /Root 1 0 R /Prev 100 >>\nstartxref\n0\n%%EOF\r\n`,
      "latin1",
    );
    const pdf = Buffer.concat([base, ajout]);
    expect(ancienneRegle(pdf)).toBe(true);
    expect(verdict(pdf)).toBeNull();
  });

  it("15 Mo de données binaires : acceptés, en temps borné", () => {
    const binaire = Buffer.concat([aleatoire(15 * 1024 * 1024 - 4096), Buffer.from(" /JS ")]);
    const pdf = documentPdf(CATALOGUE, [flux("/Filter /DCTDecode", binaire)]);
    const debut = performance.now();
    expect(verdict(pdf)).toBeNull();
    expect(performance.now() - debut).toBeLessThan(5_000);
  });
});

describe("PDF : contenu actif refusé", () => {
  it("JavaScript, Launch, pièce jointe, RichMedia, actions automatiques", () => {
    const cas: Buffer[] = [
      // Action d'ouverture JavaScript, en ligne.
      documentPdf(
        "<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >> >>",
      ),
      // Action d'ouverture vers un objet Launch.
      documentPdf("<< /Type /Catalog /Pages 2 0 R /OpenAction 5 0 R >>", [
        "<< /S /Launch /F (programme.exe) >>",
      ]),
      // Arbre de noms JavaScript du document.
      documentPdf("<< /Type /Catalog /Pages 2 0 R /Names << /JavaScript 5 0 R >> >>", [
        "<< /Names [(a) 6 0 R] >>",
      ]),
      // Pièce jointe : arbre EmbeddedFiles et flux de type EmbeddedFile.
      documentPdf("<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles 5 0 R >> >>", [
        "<< /Names [(a.exe) 6 0 R] >>",
        "<< /Type /Filespec /F (a.exe) /EF << /F 7 0 R >> >>",
        flux("/Type /EmbeddedFile", "MZ"),
      ]),
      // Actions additionnelles (/AA) d'une annotation, en JavaScript.
      documentPdf(CATALOGUE, [
        "<< /Type /Annot /Subtype /Widget /AA << /K << /S /JavaScript /JS 6 0 R >> >> >>",
        flux("", "app.alert(1)"),
      ]),
      // Multimédia actif.
      documentPdf(CATALOGUE, [
        "<< /Type /Annot /Subtype /RichMedia /RichMediaContent 6 0 R >>",
        "<< >>",
      ]),
    ];
    for (const pdf of cas) refuse(pdf, ACTIF);
  });

  it("noms obfusqués (#xx, NUL final) : décodés puis refusés", () => {
    for (const nom of [
      "/J#53",
      "/#4A#53",
      "/Java#53cript",
      "/#4a#53",
      "/JS#00",
      "/L#61unch",
      "/EmbeddedFile#73",
      "/Rich#4Dedia",
    ]) {
      refuse(documentPdf(`<< /Type /Catalog /Pages 2 0 R /OpenAction << /S ${nom} >> >>`), ACTIF);
    }
  });

  it("formulaire XFA et annotation ou flux 3D : refusés, y compris obfusqués", () => {
    const xfa = "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [] /XFA 5 0 R >> >>";
    refuse(documentPdf(xfa, [flux("", "<xdp:xdp/>")]), ACTIF);
    const annotation3d = "<< /Type /Annot /Subtype /3D /Rect [0 0 100 100] /3DD 6 0 R >>";
    refuse(documentPdf(CATALOGUE, [annotation3d, flux("/Subtype /U3D", "U3D")]), ACTIF);
    refuse(documentPdf(CATALOGUE, [flux("/Type /3D /Subtype /PRC", "PRC")]), ACTIF);
    for (const nom of ["/X#46A", "/#58FA", "/3#44", "/#33#44", "/3D#00"]) {
      refuse(
        documentPdf(`<< /Type /Catalog /Pages 2 0 R /AcroForm << /${nom.slice(1)} 5 0 R >> >>`),
        ACTIF,
      );
    }
    // Dans un flux d'objets, et en repli (fichier non conforme).
    refuse(documentPdf(CATALOGUE, [fluxObjets(["<< /AcroForm << /XFA 9 0 R >> >>"])]), ACTIF);
    const malforme = Buffer.concat([
      documentPdf(CATALOGUE, [annotation3d]),
      Buffer.from(") ", "latin1"),
    ]);
    refuse(malforme, ACTIF);
  });

  it("noms qui commencent par 3D ou XFA sans l'être (couleur, police) : acceptés, aussi en repli", () => {
    const sain = [
      "<< /ColorSpace [/Separation /3D-Rouge /DeviceCMYK 6 0 R] /Font /3DFont /Nom /3D#20Bleu /X /XFAx >>",
      "<< /FunctionType 2 /Domain [0 1] /C0 [0] /C1 [1] /N 1 >>",
    ];
    expect(verdict(documentPdf(CATALOGUE, sain))).toBeNull();
    const malforme = Buffer.concat([documentPdf(CATALOGUE, sain), Buffer.from(") ", "latin1")]);
    expect(verdict(malforme)).toBeNull();
  });

  it("/OpenAction vers une simple destination : accepté (seule l'action active est refusée)", () => {
    expect(
      verdict(documentPdf("<< /Type /Catalog /Pages 2 0 R /OpenAction [3 0 R /Fit] >>")),
    ).toBeNull();
    expect(
      verdict(
        documentPdf("<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /GoTo /D [3 0 R /Fit] >> >>"),
      ),
    ).toBeNull();
  });
});

describe("PDF : flux d'objets (ObjStm)", () => {
  const actionCachee =
    "<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >> >>";

  it("décompressé et inspecté : objets sains acceptés, action JavaScript cachée refusée", () => {
    const sain = documentPdf(CATALOGUE, [
      fluxObjets(["<< /Type /Annot /Subtype /Text >>", "[1 2 3]"]),
    ]);
    expect(verdict(sain)).toBeNull();
    const cache = documentPdf(CATALOGUE, [fluxObjets([actionCachee])], "/Root 10 0 R");
    expect(ancienneRegle(cache)).toBe(false); // l'ancienne règle ne le voyait pas
    refuse(cache, ACTIF);
  });

  it("inspecté aussi sans /Type (/N et /First seuls), avec un nom de clé obfusqué, ou sans filtre", () => {
    refuse(documentPdf(CATALOGUE, [fluxObjets([actionCachee], { dict: "" })]), ACTIF);
    refuse(
      documentPdf(CATALOGUE, [fluxObjets([actionCachee], { dict: "/Type /Obj#53tm" })]),
      ACTIF,
    );
    refuse(documentPdf(CATALOGUE, [fluxObjets([actionCachee], { compresser: false })]), ACTIF);
    refuse(documentPdf(CATALOGUE, [fluxObjets(["<< /S /J#53 >>"])]), ACTIF);
  });

  it("objets lus depuis leurs décalages : un lien « …/JavaScript » est une chaîne, pas un nom", () => {
    const lien =
      "<< /Type /Annot /Subtype /Link /A << /S /URI /URI (https://developer.mozilla.org/fr/docs/Web/JavaScript) >> >>";
    const pdf = documentPdf(CATALOGUE, [fluxObjets([lien, "(Mission CI/JS)"])]);
    expect(verdict(pdf)).toBeNull();
  });

  it("décalage qui pointe dans une chaîne : objet lu comme le lirait le lecteur, refusé", () => {
    // Lecture suivie : une chaîne puis « null », rien d'actif. L'en-tête place pourtant
    // l'objet 11 sur le « << » qui est dans la chaîne : c'est ce que lit le lecteur.
    const cache = "(x /OpenAction << /S /JavaScript >> ) null";
    const tete = `10 0 11 ${cache.indexOf("<<")}\n`;
    const donnees = Buffer.from(`${tete}${cache}`, "latin1");
    const pdf = documentPdf(CATALOGUE, [
      flux(`/Type /ObjStm /N 2 /First ${tete.length} /Filter /FlateDecode`, deflateSync(donnees)),
    ]);
    refuse(pdf, ACTIF);
  });

  it("profil ICC (/N sans /First) : pas un flux d'objets, données binaires non fouillées", () => {
    const icc = Buffer.concat([
      Buffer.from([0, 0, 0x0c, 0x48]),
      Buffer.from("lcms", "latin1"),
      aleatoire(600_000, undefined, 11),
      Buffer.from(MOTIFS_HASARD.join(""), "latin1"),
    ]);
    const pdf = documentPdf(CATALOGUE, [
      flux("/N 4 /Alternate /DeviceCMYK /Filter /FlateDecode", deflateSync(icc)),
    ]);
    expect(verdict(pdf)).toBeNull();
    // Sans /First mais commençant par un nombre : lisible par MuPDF (décalage 0), donc inspecté.
    const mupdf = documentPdf(CATALOGUE, [
      flux("/N 1 /Filter /FlateDecode", deflateSync("10 4 << /S /JavaScript >>")),
    ]);
    refuse(mupdf, ACTIF);
  });

  it("/First indirect : en-tête inexploitable, recherche brute du contenu", () => {
    const donnees = deflateSync("10 0\n(https://exemple.invalid/JavaScript)");
    const pdf = documentPdf(CATALOGUE, [
      flux("/Type /ObjStm /N 1 /First 9 0 R /Filter /FlateDecode", donnees),
    ]);
    refuse(pdf, ACTIF);
  });

  it("indécodable : refusé (autre filtre, prédicteur, alias, données corrompues, fichier chiffré)", () => {
    const donnees = Buffer.from("10 0\n<< /A 1 >>\n", "latin1");
    const tete = "/Type /ObjStm /N 1 /First 5";
    for (const dict of [
      `${tete} /Filter /LZWDecode`,
      `${tete} /Filter /ASCIIHexDecode`,
      `${tete} /Filter [/ASCIIHexDecode /FlateDecode]`,
      `${tete} /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 4 >>`,
      `${tete} /F /FlateDecode`,
      `${tete} /Filter 9 0 R`,
      `${tete} /Filter /FlateDecode /Filter /FlateDecode`,
    ]) {
      refuse(documentPdf(CATALOGUE, [flux(dict, deflateSync(donnees))]), ILLISIBLE);
    }
    // Données Flate corrompues, ou sans en-tête zlib.
    const corrompu = deflateSync(donnees);
    corrompu.fill(0xff, 2, 6);
    refuse(documentPdf(CATALOGUE, [flux(`${tete} /Filter /FlateDecode`, corrompu)]), ILLISIBLE);
    refuse(documentPdf(CATALOGUE, [flux(`${tete} /Filter /FlateDecode`, donnees)]), ILLISIBLE);
    // Fichier chiffré : les objets compressés ne sont pas lisibles sans le mot de passe.
    const chiffre = documentPdf(
      CATALOGUE,
      [fluxObjets(["<< /A 1 >>"]), "<< /Filter /Standard /V 2 /R 3 >>"],
      "/Root 1 0 R /Encrypt 6 0 R",
    );
    refuse(chiffre, ILLISIBLE);
  });

  it("flux tronqué : lu jusqu'où il va (comme les lecteurs tolérants)", () => {
    // Données Flate amputées de leur fin (somme Adler-32 comprise), enveloppe du flux intacte.
    const tronque = (objet: string) => {
      const compresse = deflateSync(Buffer.from(`10 0\n${objet}`, "latin1"));
      const donnees = compresse.subarray(0, compresse.length - 12);
      return documentPdf(CATALOGUE, [
        flux("/Type /ObjStm /N 1 /First 5 /Filter /FlateDecode", donnees),
      ]);
    };
    const suite = ` ${aleatoire(400, Buffer.from("0123456789 ")).toString("latin1")}`;
    refuse(tronque(`<< /S /JavaScript >>${suite}`), ACTIF);
    expect(verdict(tronque(`<< /S /GoTo >>${suite}`))).toBeNull();
  });
});

describe("PDF : bombes de décompression", () => {
  const objStm = (donnees: Buffer) =>
    flux("/Type /ObjStm /N 1 /First 5 /Filter /FlateDecode", deflateSync(donnees));

  it(`flux d'objets au-delà de ${PLAFONDS_PDF.fluxOctets / 1024 / 1024} Mio décompressés : refusé`, () => {
    // Faible entropie (ratio ~4, sous le plafond de ratio) : seul le plafond de taille joue.
    const gros = aleatoire(PLAFONDS_PDF.fluxOctets + 1024, Buffer.from("0123456789 \n"));
    refuse(documentPdf(CATALOGUE, [objStm(gros)]), VOLUME);
  });

  it(`ratio de décompression au-delà de ${PLAFONDS_PDF.ratio} : refusé (bombe classique)`, () => {
    const bombe = objStm(Buffer.alloc(4 * 1024 * 1024, 0x20));
    expect(bombe.length).toBeLessThan(10_000);
    refuse(documentPdf(CATALOGUE, [bombe]), VOLUME);
  });

  it(`cumul au-delà de ${PLAFONDS_PDF.totalOctets / 1024 / 1024} Mio : refusé`, () => {
    const bloc = objStm(aleatoire(7 * 1024 * 1024, Buffer.from("0123456789 \n")));
    refuse(documentPdf(CATALOGUE, [bloc, bloc, bloc, bloc, bloc]), VOLUME);
    expect(verdict(documentPdf(CATALOGUE, [bloc, bloc, bloc, bloc]))).toBeNull();
  });

  it(`plus de ${PLAFONDS_PDF.nombreFlux} flux d'objets : refusé`, () => {
    const petit = fluxObjets(["<< >>"], { compresser: false });
    refuse(
      documentPdf(
        CATALOGUE,
        Array.from({ length: PLAFONDS_PDF.nombreFlux + 1 }, () => petit),
      ),
      VOLUME,
    );
  });
});

describe("PDF : lectures divergentes (repli sur la recherche brute)", () => {
  const ACTION = "<< /S /JavaScript /JS (app.alert\\(1\\)) >>";

  it("objet ou trailer caché dans les données d'un flux : refusé", () => {
    refuse(
      documentPdf(CATALOGUE, [
        flux("/Filter /DCTDecode", `\xff\xd8\n9 0 obj\n${ACTION}\nendobj\n`),
      ]),
      ACTIF,
    );
    refuse(documentPdf(CATALOGUE, [flux("", `x\n9 %commentaire\n0\nobj ${ACTION}`)]), ACTIF);
    refuse(documentPdf(CATALOGUE, [flux("", `x trailer << /Root ${ACTION} >>`)]), ACTIF);
  });

  it("constructions ambiguës (clé sans valeur, chaîne hexadécimale invalide, en-tête dans une chaîne ou un commentaire) : refusées", () => {
    // pdf.js lirait les données du « flux » comme la suite du dictionnaire.
    refuse(documentPdf(`<< /Type /Catalog /A >> stream\n/OpenAction ${ACTION}\nendstream`), ACTIF);
    // Clé qui n'est pas un nom : un lecteur tolérant y ouvrirait un tableau englobant « >> stream ».
    refuse(
      documentPdf(`<< /Type /Catalog [ >> stream\n] /OpenAction ${ACTION} >>\nendstream`),
      ACTIF,
    );
    // Chaîne hexadécimale qu'un lecteur arrêterait au « ( ».
    refuse(
      documentPdf(`<< /Type /Catalog /T <41( >>> stream\n) /OpenAction ${ACTION} >>\nendstream`),
      ACTIF,
    );
    // En-tête d'objet dans une chaîne ou un commentaire : un lecteur peut y entrer par la table xref.
    refuse(
      documentPdf(
        `<< /Type /Catalog /T (2 0 obj << /OpenAction ${ACTION.replace(/[()]/g, "")} >>) >>`,
      ),
      ACTIF,
    );
    refuse(documentPdf(`<< /Type /Catalog % 2 0 obj << /OpenAction /JavaScript\n>>`), ACTIF);
  });

  it("repli : l'ancienne règle s'applique au fichier entier, et un flux d'objets y est refusé", () => {
    const malforme = (autres: (string | Buffer)[]) =>
      Buffer.concat([documentPdf(CATALOGUE, autres), Buffer.from(") (orphelin\n", "latin1")]);
    // Hors du sous-ensemble strict : les données des flux sont de nouveau fouillées (jamais moins strict).
    refuse(malforme([flux("/Filter /DCTDecode", Buffer.from("\x00 /JS \x00", "latin1"))]), ACTIF);
    // Flux d'objets non inspectable sans structure fiable.
    refuse(malforme([fluxObjets(["<< /A 1 >>"])]), ILLISIBLE);
    expect(verdict(malforme([flux("/Filter /DCTDecode", aleatoire(64).fill(0x41))]))).toBeNull();
  });
});
