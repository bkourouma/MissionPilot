import {
  estDateSaisieModifiable,
  estPasValide,
  lundiDeLaSemaine,
  sommerJours,
  versCentiemes,
  versJourUTC,
} from "@missionpilot/engines";
import { IMPORT_TEMPS_COLONNES, IMPORT_TEMPS_MAX_LIGNES } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { requeteInvalide } from "../errors.js";
import { estAssocie } from "../missions/acces.js";
import { depassementsCapacite, insererLignes, type LignePreparee } from "./feuilles.js";
import { moisClotures, semaineDe, type ParametresTemps } from "./outils.js";

/*
 * Import de l'historique des temps (TPS-10), au format CSV uniquement en V1
 * (voir le rapport de livraison : aucune bibliothèque .xlsx légère et sans
 * vulnérabilité connue n'a été retenue). Colonnes : collaborateur, mission,
 * tâche, date, jours. Séparateur « ; » ou « , », décimales « , » ou « . »,
 * dates AAAA-MM-JJ ou JJ/MM/AAAA.
 *
 * Chaque ligne est validée (collaborateur actif, mission et tâche du cabinet
 * résolues par libellé exact sans ambiguïté, date hors période clôturée, pas
 * de saisie du cabinet, pas de doublon, pas de feuille existante pour la
 * semaine, capacité du jour selon le paramètre du cabinet). L'exécution est
 * tout ou rien : la moindre erreur bloque l'import. Les temps importés
 * forment des feuilles validées d'origine « import », dont l'importateur est
 * le valideur (jamais ses propres temps, sauf associé). Une tâche n'a pas à
 * être affectée : l'historique précède les affectations.
 */

export interface ErreurImport {
  ligne: number;
  message: string;
}

export interface RapportImport {
  simulation: boolean;
  executee: boolean;
  lignes_lues: number;
  lignes_valides: number;
  feuilles: number;
  jours_total: number;
  erreurs: ErreurImport[];
  avertissements: ErreurImport[];
}

/** Découpe un CSV (guillemets, séparateur « ; » ou « , », fins de ligne CRLF/LF). */
export function lireCsv(texte: string): string[][] {
  // Marque d'ordre des octets (BOM) d'un export Excel : retirée.
  const contenu = texte.charCodeAt(0) === 0xfeff ? texte.slice(1) : texte;
  const premiereLigne = contenu.split(/\r?\n/, 1)[0] ?? "";
  const separateur = premiereLigne.includes(";") ? ";" : ",";
  const lignes: string[][] = [];
  let champ = "";
  let ligne: string[] = [];
  let guillemets = false;
  for (let i = 0; i < contenu.length; i++) {
    const c = contenu[i] as string;
    if (guillemets) {
      if (c === '"' && contenu[i + 1] === '"') {
        champ += '"';
        i++;
      } else if (c === '"') {
        guillemets = false;
      } else {
        champ += c;
      }
    } else if (c === '"') {
      guillemets = true;
    } else if (c === separateur) {
      ligne.push(champ);
      champ = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && contenu[i + 1] === "\n") i++;
      ligne.push(champ);
      lignes.push(ligne);
      ligne = [];
      champ = "";
    } else {
      champ += c;
    }
    if (lignes.length > IMPORT_TEMPS_MAX_LIGNES + 1) {
      throw requeteInvalide(`L'import est limité à ${IMPORT_TEMPS_MAX_LIGNES} lignes.`);
    }
  }
  if (champ !== "" || ligne.length > 0) {
    ligne.push(champ);
    lignes.push(ligne);
  }
  return lignes.filter((l) => l.some((v) => v.trim() !== ""));
}

const normaliser = (v: string) =>
  v.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase().replace(/\s+/g, " ");

/** Date AAAA-MM-JJ ou JJ/MM/AAAA → AAAA-MM-JJ, ou null si invalide. */
export function lireDate(v: string): string | null {
  const t = v.trim();
  const fr = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  const iso = fr ? `${fr[3]}-${fr[2]}-${fr[1]}` : t;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  try {
    versJourUTC(iso);
    return iso;
  } catch {
    return null;
  }
}

/** Jours « 1,5 » ou « 1.5 » → nombre, ou null. */
export function lireJours(v: string): number | null {
  const t = v.trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  return Number(t);
}

interface LigneImport {
  numero: number;
  collaborateurId: string;
  auteurId: string | null;
  missionId: string;
  tacheId: string;
  date: string;
  jours: number;
}

/** Index « libellé normalisé » → identifiants (plusieurs = ambiguïté). */
function indexer<T>(
  lignes: T[],
  cle: (l: T) => string,
  id: (l: T) => string,
): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const l of lignes) {
    const k = normaliser(cle(l));
    m.set(k, [...(m.get(k) ?? []), id(l)]);
  }
  return m;
}

/**
 * Valide le CSV dans le cabinet courant (RLS) et, hors simulation et sans
 * erreur, crée les feuilles validées. Renvoie le rapport.
 */
export async function importerTemps(
  db: Db,
  auth: Auth,
  csv: string,
  p: ParametresTemps,
  simulation: boolean,
): Promise<{ rapport: RapportImport; missions: string[] }> {
  const tableau = lireCsv(csv);
  const entete = (tableau[0] ?? []).map(normaliser);
  const colonnes = IMPORT_TEMPS_COLONNES.map((c) => entete.indexOf(c));
  const manquantes = IMPORT_TEMPS_COLONNES.filter((_, i) => colonnes[i] === -1);
  if (manquantes.length > 0) {
    throw requeteInvalide(`Colonnes manquantes dans l'en-tête : ${manquantes.join(", ")}.`);
  }
  const donnees = tableau.slice(1);
  if (donnees.length > IMPORT_TEMPS_MAX_LIGNES) {
    throw requeteInvalide(`L'import est limité à ${IMPORT_TEMPS_MAX_LIGNES} lignes.`);
  }

  const collaborateurs = await db.query(
    `SELECT c.id, c.nom, c.utilisateur_id FROM collaborateurs c
     LEFT JOIN utilisateurs u ON u.id = c.utilisateur_id
     WHERE c.actif AND (c.utilisateur_id IS NULL OR u.actif)`,
  );
  const parNom = indexer(
    collaborateurs.rows,
    (c) => c.nom as string,
    (c) => c.id as string,
  );
  const utilisateurDe = new Map(
    collaborateurs.rows.map((c) => [c.id as string, c.utilisateur_id as string | null]),
  );
  const missions = await db.query("SELECT id, intitule, statut FROM missions");
  const parIntitule = indexer(
    missions.rows,
    (m) => m.intitule as string,
    (m) => m.id as string,
  );
  const statutMission = new Map(missions.rows.map((m) => [m.id as string, m.statut as string]));
  const taches = await db.query("SELECT id, mission_id, libelle FROM mission_taches");
  const parTache = indexer(
    taches.rows,
    (t) => `${t.mission_id as string}|${t.libelle as string}`,
    (t) => t.id as string,
  );
  const clotures = await moisClotures(db);

  const erreurs: ErreurImport[] = [];
  const valides: LigneImport[] = [];
  const vues = new Set<string>();
  const val = (ligne: string[], i: number) => (ligne[colonnes[i] as number] ?? "").trim();
  const unique = (ids: string[] | undefined, quoi: string, nom: string): string => {
    if (!ids || ids.length === 0)
      throw new Error(`${quoi} inconnu(e) dans ce cabinet : « ${nom} ».`);
    if (ids.length > 1) throw new Error(`${quoi} ambigu(ë) : plusieurs portent le nom « ${nom} ».`);
    return ids[0] as string;
  };

  donnees.forEach((ligne, i) => {
    const numero = i + 2;
    try {
      const [nomCollaborateur, intitule, libelleTache, texteDate, texteJours] = [0, 1, 2, 3, 4].map(
        (c) => val(ligne, c),
      ) as [string, string, string, string, string];
      const collaborateurId = unique(
        parNom.get(normaliser(nomCollaborateur)),
        "Collaborateur actif",
        nomCollaborateur,
      );
      const missionId = unique(parIntitule.get(normaliser(intitule)), "Mission", intitule);
      if (statutMission.get(missionId) === "cloturee") throw new Error("La mission est clôturée.");
      const tacheId = unique(
        parTache.get(normaliser(`${missionId}|${libelleTache}`)),
        "Tâche",
        libelleTache,
      );
      const date = lireDate(texteDate);
      if (!date) throw new Error(`Date invalide : « ${texteDate} » (AAAA-MM-JJ ou JJ/MM/AAAA).`);
      const jours = lireJours(texteJours);
      if (jours === null || jours <= 0 || jours > 3) {
        throw new Error(`Jours invalides : « ${texteJours} » (entre 0 et 3).`);
      }
      if (!estPasValide(jours, p.granularite, p.heuresParJour)) {
        throw new Error(
          p.granularite === "demi_journee"
            ? "Les jours se saisissent à la demi-journée (pas de 0,5)."
            : "Les jours doivent correspondre à des minutes entières.",
        );
      }
      if (!estDateSaisieModifiable(date, { moisClotures: clotures })) {
        throw new Error(`Période clôturée : ${date}.`);
      }
      const auteurId = utilisateurDe.get(collaborateurId) ?? null;
      if (auteurId === auth.utilisateurId && !estAssocie(auth)) {
        throw new Error("Vous ne pouvez pas importer (et donc valider) vos propres temps.");
      }
      const cle = `${collaborateurId}|${date}|${tacheId}`;
      if (vues.has(cle)) throw new Error("Doublon : même collaborateur, même tâche, même jour.");
      vues.add(cle);
      valides.push({ numero, collaborateurId, auteurId, missionId, tacheId, date, jours });
    } catch (e) {
      erreurs.push({ ligne: numero, message: (e as Error).message });
    }
  });

  // Feuilles par collaborateur et semaine : aucune ne doit déjà exister.
  const feuilles = new Map<string, LigneImport[]>();
  for (const l of valides) {
    const cle = `${l.collaborateurId}|${lundiDeLaSemaine(l.date)}`;
    feuilles.set(cle, [...(feuilles.get(cle) ?? []), l]);
  }
  const avertissements: ErreurImport[] = [];
  for (const [cle, lignes] of feuilles) {
    const [collaborateurId, semaine] = cle.split("|") as [string, string];
    const existe = await db.query(
      "SELECT 1 FROM feuilles_temps WHERE collaborateur_id = $1 AND semaine = $2",
      [collaborateurId, semaine],
    );
    if (existe.rowCount) {
      for (const l of lignes) {
        erreurs.push({
          ligne: l.numero,
          message: `Une feuille de temps existe déjà pour la semaine du ${semaine}.`,
        });
      }
      continue;
    }
    const depassements = await depassementsCapacite(
      db,
      auth.cabinetId,
      collaborateurId,
      semaineDe(semaine),
      lignes.map((l) => ({
        date: l.date,
        centiemes: versCentiemes(l.jours),
        minutes: null,
        est_absence: false,
      })),
      { ...p, granularite: "demi_journee" },
    );
    for (const message of depassements) {
      const date = message.slice(0, 10);
      const concernees = lignes.filter((l) => l.date === date).map((l) => l.numero);
      const cible = {
        ligne: Math.min(...concernees),
        message: `Capacité journalière dépassée : ${message}.`,
      };
      if (p.controleCapacite === "refuser") erreurs.push(cible);
      else avertissements.push(cible);
    }
  }
  erreurs.sort((a, b) => a.ligne - b.ligne);
  const enErreur = new Set(erreurs.map((e) => e.ligne));
  const retenues = valides.filter((l) => !enErreur.has(l.numero));
  const rapport: RapportImport = {
    simulation,
    executee: false,
    lignes_lues: donnees.length,
    lignes_valides: retenues.length,
    feuilles: new Set(retenues.map((l) => `${l.collaborateurId}|${lundiDeLaSemaine(l.date)}`)).size,
    jours_total: sommerJours(retenues.map((l) => l.jours)),
    erreurs,
    avertissements,
  };
  if (simulation || erreurs.length > 0) return { rapport, missions: [] };

  for (const [cle, lignes] of feuilles) {
    const [collaborateurId, semaine] = cle.split("|") as [string, string];
    const r = await db.query(
      `INSERT INTO feuilles_temps (cabinet_id, collaborateur_id, auteur_id, semaine, origine, importee_par)
       VALUES ($1, $2, $3, $4, 'import', $5) RETURNING id`,
      [auth.cabinetId, collaborateurId, lignes[0]?.auteurId ?? null, semaine, auth.utilisateurId],
    );
    const feuilleId = r.rows[0].id as string;
    await insererLignes(
      db,
      auth.cabinetId,
      feuilleId,
      lignes.map((l): LignePreparee => ({
        date: l.date,
        mission_id: l.missionId,
        tache_id: l.tacheId,
        activite_id: null,
        centiemes: versCentiemes(l.jours),
        minutes: null,
        commentaire: "Import de l'historique",
        est_absence: false,
      })),
    );
    await db.query(
      "UPDATE feuilles_temps SET statut = 'validee', validee_le = now(), modifie_le = now() WHERE id = $1",
      [feuilleId],
    );
  }
  return {
    rapport: { ...rapport, executee: true },
    missions: [...new Set(retenues.map((l) => l.missionId))],
  };
}
