#!/usr/bin/env node
"use strict";
// Vérifie les empreintes SHA-256 des données de langue de l'OCR local (ADR-009, décision 16).
// Node pur, sans dépendance, SANS réseau. Code de sortie 0 si tout est conforme, 1 sinon.
//
//   node scripts/ocr-verifier-donnees.cjs                # dossier par défaut : apps/api/ocr-data
//   node scripts/ocr-verifier-donnees.cjs <dossier>
//
// Le dossier contient `SHA256SUMS` (format de `sha256sum` : « <empreinte hexadécimale>  <fichier> ») et
// chaque fichier qu'il cite. Tout fichier `*.traineddata` présent mais absent de `SHA256SUMS` est une
// erreur (une donnée de langue non vérifiée ne doit pas être livrée).

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const dossier = path.resolve(process.argv[2] || path.join(__dirname, "..", "apps", "api", "ocr-data"));
const LIGNE = /^([0-9a-f]{64}) [ *]([A-Za-z0-9._-]+)$/;

function echec(message) {
  console.error(`ocr-verifier-donnees : ${message}`);
  process.exitCode = 1;
}

function principal() {
  let contenu;
  try {
    contenu = fs.readFileSync(path.join(dossier, "SHA256SUMS"), "utf8");
  } catch {
    echec(`SHA256SUMS introuvable dans ${dossier}`);
    return;
  }
  const attendues = new Map();
  for (const brute of contenu.split(/\r?\n/)) {
    const ligne = brute.trim();
    if (ligne === "") continue;
    const m = LIGNE.exec(ligne);
    if (!m) {
      echec(`ligne illisible dans SHA256SUMS : ${JSON.stringify(ligne.slice(0, 80))}`);
      return;
    }
    attendues.set(m[2], m[1]);
  }
  if (attendues.size === 0) {
    echec("SHA256SUMS ne cite aucun fichier");
    return;
  }
  let conformes = 0;
  for (const [fichier, attendue] of attendues) {
    const chemin = path.join(dossier, fichier);
    let octets;
    try {
      octets = fs.readFileSync(chemin);
    } catch {
      echec(`${fichier} : absent`);
      continue;
    }
    const reelle = crypto.createHash("sha256").update(octets).digest("hex");
    if (reelle !== attendue) {
      echec(`${fichier} : empreinte différente (attendue ${attendue}, obtenue ${reelle})`);
      continue;
    }
    conformes += 1;
    console.log(`ok  ${fichier}  ${octets.length} octets`);
  }
  for (const nom of fs.readdirSync(dossier)) {
    if (nom.endsWith(".traineddata") && !attendues.has(nom)) {
      echec(`${nom} : présent mais absent de SHA256SUMS`);
    }
  }
  if (!process.exitCode) console.log(`${conformes} fichier(s) conforme(s) dans ${dossier}`);
}

principal();
