import {
  formaterMontant,
  montant as montantMoteur,
  oppose,
  type Devise,
} from "@missionpilot/engines";
import type { FactureDb, LigneVue } from "./factures.js";

/*
 * Rendu HTML imprimable d'une facture ou d'un avoir (FIN-07). Tout texte est
 * échappé ; aucun script, aucune ressource externe (la route ajoute une
 * Content-Security-Policy « default-src 'none' »). Les montants sont ceux
 * enregistrés (calculés par le moteur) et formatés par le moteur.
 * Point d'extension : le PDF (Chromium headless) et l'envoi par e-mail
 * réutiliseront ce rendu (voir `envoyee_le`).
 */

const ENTITES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "`": "&#96;",
};

export function echapper(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/[&<>"'`]/g, (c) => ENTITES[c] as string);
}

/** Texte multiligne échappé (sauts de ligne → <br>). */
const multiligne = (v: unknown) => echapper(v).replace(/\r?\n/g, "<br>");

const montantFr = (valeur: number, devise: Devise) =>
  echapper(formaterMontant(montantMoteur(valeur, devise)));

/** Montant de ligne, ou tiret s'il est masqué. */
const montantLigne = (valeur: number | null, devise: Devise) =>
  valeur === null ? "—" : montantFr(valeur, devise);

const nombreFr = (n: number) => echapper(String(n).replace(".", ","));

const dateFr = (iso: string | null) =>
  iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
    : "";

function bloc(titre: string, champs: [string, unknown][]): string {
  const lignes = champs
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([l, v]) => `<div><span class="l">${echapper(l)}</span> ${multiligne(v)}</div>`)
    .join("");
  return `<section class="bloc"><h2>${echapper(titre)}</h2>${lignes}</section>`;
}

export interface DonneesDocument {
  facture: FactureDb;
  /** Lignes servies : montants unitaires de régie masqués (null) sans « finance.lire ». */
  lignes: readonly LigneVue[];
  /** Mentions figées (émise) ou aperçu des paramètres actuels (brouillon). */
  mentions: Record<string, unknown>;
}

export function rendreDocument({ facture: f, lignes, mentions }: DonneesDocument): string {
  const devise = f.devise;
  const emetteur = (mentions.emetteur ?? {}) as Record<string, unknown>;
  const client = (mentions.client ?? {}) as Record<string, unknown>;
  const mission = (mentions.mission ?? {}) as Record<string, unknown>;
  const origine = (mentions.facture_origine ?? null) as Record<string, unknown> | null;
  const titre = f.nature === "avoir" ? "Avoir" : "Facture";
  const emise = f.statut === "emise" || f.statut === "annulee";
  const tva = (f.tva ?? []) as { taux: number; base: number; montant: number }[];
  const retenues = (f.retenues ?? []) as { libelle: string; taux: number; montant: number }[];
  const corps = lignes
    .map(
      (l) => `<tr><td>${echapper(l.libelle)}</td><td class="n">${nombreFr(l.quantite)}</td>
<td class="n">${montantLigne(l.prix_unitaire, devise)}</td><td class="n">${nombreFr(l.taux_tva)} %</td>
<td class="n">${montantLigne(l.montant_ht, devise)}</td></tr>`,
    )
    .join("");
  const totaux = [
    ["Total brut HT", f.total_brut],
    ...(Number(f.total_remises) !== 0 ? [["Remises", f.total_remises]] : []),
    ["Total HT", f.total_ht],
    ...tva.map((t) => [
      `TVA ${String(t.taux).replace(".", ",")} % sur ${formaterMontant(montantMoteur(t.base, devise))}`,
      t.montant,
    ]),
    ["Total TTC", f.total_ttc],
    ...retenues.map((r) => [
      `${r.libelle} (${String(r.taux).replace(".", ",")} %)`,
      oppose(montantMoteur(r.montant, devise)).valeur,
    ]),
    ["Net à payer", f.net_a_payer],
  ] as [string, number][];
  const lignesTotaux = totaux
    .map(
      ([l, v]) =>
        `<tr><th>${echapper(l)}</th><td class="n">${montantFr(Number(v), devise)}</td></tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${echapper(titre)} ${echapper(f.numero ?? "brouillon")}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px;font-size:13px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:13px;margin:0 0 4px;text-transform:uppercase}
.entete{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap}
.bloc{margin:12px 0}.l{color:#555}
table{width:100%;border-collapse:collapse;margin-top:12px}
td,th{border-bottom:1px solid #ccc;padding:6px;text-align:left;vertical-align:top}
.n{text-align:right;white-space:nowrap}.totaux{width:auto;margin-left:auto}
.filigrane{color:#b00;font-weight:bold;border:2px solid #b00;padding:6px;display:inline-block}
@media print{body{margin:0}}
</style></head><body>
${emise ? "" : '<p class="filigrane">BROUILLON — document sans valeur fiscale</p>'}
${f.statut === "annulee" ? '<p class="filigrane">ANNULÉE PAR AVOIR</p>' : ""}
<div class="entete">
${bloc(String(emetteur.raison_sociale ?? ""), [
  ["Forme juridique :", emetteur.forme_juridique],
  ["RCCM :", emetteur.rccm],
  ["Compte contribuable :", emetteur.compte_contribuable],
  ["Régime fiscal :", emetteur.regime_fiscal],
  ["", emetteur.adresse],
  ["Tél. :", emetteur.telephone],
  ["E-mail :", emetteur.email],
])}
${bloc("Client", [
  ["", client.raison_sociale],
  ["Forme juridique :", client.forme_juridique],
  ["RCCM :", client.rccm],
  ["Compte contribuable :", client.compte_contribuable],
  ["", client.adresse],
])}
</div>
<h1>${echapper(titre)} ${echapper(f.numero ?? "")}</h1>
${bloc("Références", [
  ["Date d'émission :", dateFr(f.date_emission)],
  ["Date d'échéance :", f.nature === "facture" ? dateFr(f.date_echeance) : ""],
  ["Mission :", mission.intitule],
  ["Objet :", f.objet],
  [
    "Facture d'origine :",
    origine
      ? `${String(origine.numero ?? "")} du ${dateFr(String(origine.date_emission ?? ""))}`
      : "",
  ],
  ["Motif :", f.motif],
])}
<table><thead><tr><th>Désignation</th><th class="n">Qté</th><th class="n">Prix unitaire HT</th>
<th class="n">TVA</th><th class="n">Montant HT</th></tr></thead><tbody>${corps}</tbody></table>
<table class="totaux"><tbody>${lignesTotaux}</tbody></table>
${bloc("Règlement", [
  ["Banque :", emetteur.banque],
  ["IBAN :", emetteur.iban],
  ["", emetteur.autres_coordonnees],
])}
${emetteur.mentions_complementaires ? `<p>${multiligne(emetteur.mentions_complementaires)}</p>` : ""}
</body></html>`;
}
