import type { CleCompte } from "../cles.js";
import { affectationsAvecCompte, montantMineur } from "./outils.js";
import { cleDeCompte, type CleMission, type MissionLue } from "./casting.js";
import type { DeboursSpec } from "./donnees-facturation.js";
import {
  appel,
  cleDe,
  etape,
  lire,
  ouvre,
  plus,
  session,
  televerserJustificatif,
  type Env,
  type Evenement,
} from "./facturation-outils.js";

/*
 * DÉBOURS des missions (FIN-05), par les vraies routes : saisie par un consultant ou un chef de la
 * mission (brouillon), justificatif PDF téléversé, soumission, puis décision par le chef de la
 * mission (ou son directeur si l'auteur est le chef) : jamais l'auteur. Une saisie récente reste
 * « soumise » ; un débours est rejeté une fois, corrigé et revalidé. Le circuit de chaque débours
 * est étalé en événements datés (saisie, rejet, correction, validation).
 */

interface Equipe {
  auteurs: CleCompte[];
  chef: CleCompte;
  directeur: CleCompte;
}

/** Auteurs possibles : les membres affectés avec un compte (ni associé ni directeur si possible). */
function equipeDe(env: Env, m: MissionLue): Equipe {
  const chef = cleDe(env, m.chefId);
  const directeur = cleDe(env, m.directeurId);
  const cles = [
    ...new Set(
      affectationsAvecCompte(m)
        .map((a) => cleDeCompte(env.ctx, a.utilisateurId) as CleCompte | undefined)
        .filter((c): c is CleCompte => !!c),
    ),
  ];
  const simples = cles.filter(
    (c) => !c.startsWith("associe") && !c.startsWith("directeur") && c !== chef,
  );
  return { auteurs: simples.length > 0 ? simples : [chef], chef, directeur };
}

const validateurDe = (e: Equipe, auteur: CleCompte): CleCompte =>
  auteur !== e.chef ? e.chef : auteur !== e.directeur ? e.directeur : "associe";

interface Ligne {
  id: string;
  statut: string;
  fichier: string | null;
}

async function trouver(
  env: Env,
  m: MissionLue,
  s: DeboursSpec,
  jour: string,
  montant: number,
): Promise<Ligne | undefined> {
  const r = await lire(
    env,
    `SELECT id, statut, justificatif_fichier_id FROM debours
      WHERE mission_id = $1 AND date = $2 AND montant = $3 AND categorie = $4`,
    [m.id, jour, montant, s.categorie],
  );
  const l = r[0];
  return l
    ? {
        id: l.id as string,
        statut: l.statut as string,
        fichier: l.justificatif_fichier_id as string | null,
      }
    : undefined;
}

type Etape = "saisir" | "valider" | "rejeter" | "corriger";

async function jouerEtape(
  env: Env,
  m: MissionLue,
  s: DeboursSpec,
  rang: number,
  etapeNom: Etape,
  date: string,
): Promise<void> {
  const equipe = equipeDe(env, m);
  const cleAuteur = equipe.auteurs[rang % equipe.auteurs.length] as CleCompte;
  const auteur = session(env, cleAuteur);
  const validateur = session(env, validateurDe(equipe, cleAuteur));
  const jour = ouvre(env, s.jour);
  // Les montants du casting sont des valeurs de référence en FCFA : unités mineures de la devise.
  const montant = montantMineur(s.montant, m.devise);
  let d = await trouver(env, m, s, jour, montant);

  await etape(env, date, async () => {
    if (etapeNom === "saisir") {
      if (!d) {
        const cree = await appel(
          201,
          `débours « ${s.libelle} »`,
          auteur.post(`/api/missions/${m.id}/debours`, {
            date: jour,
            categorie: s.categorie,
            libelle: s.libelle,
            montant,
            refacturable: s.refacturable,
          }),
        );
        env.compteurs.debours += 1;
        d = { id: cree.id as string, statut: "brouillon", fichier: null };
      }
      if (d.statut === "brouillon") {
        if (!d.fichier)
          await televerserJustificatif(env, auteur, d.id, s.libelle, montant, jour, m.devise);
        await appel(200, "soumission du débours", auteur.post(`/api/debours/${d.id}/soumettre`));
      }
      return;
    }
    if (!d) throw new Error(`Débours « ${s.libelle} » introuvable pour l'étape ${etapeNom}.`);
    if (etapeNom === "valider" && d.statut === "soumis") {
      await appel(200, "validation du débours", validateur.post(`/api/debours/${d.id}/valider`));
    } else if (etapeNom === "rejeter" && d.statut === "soumis") {
      await appel(
        200,
        "rejet du débours",
        validateur.post(`/api/debours/${d.id}/rejeter`, {
          motif: "Justificatif illisible : joindre le reçu officiel.",
        }),
      );
    } else if (etapeNom === "corriger" && d.statut === "rejete") {
      await appel(
        200,
        "correction du débours",
        auteur.patch(`/api/debours/${d.id}`, { libelle: `${s.libelle} (reçu officiel joint)` }),
      );
      await televerserJustificatif(env, auteur, d.id, s.libelle, montant, jour, m.devise);
      await appel(200, "nouvelle soumission", auteur.post(`/api/debours/${d.id}/soumettre`));
    }
  });
}

/** Événements des débours d'une mission (saisie, décision, rejet et correction éventuels). */
export function evenementsDebours(
  env: Env,
  cle: CleMission,
  m: MissionLue,
  debours: readonly DeboursSpec[],
): Evenement[] {
  const evenements: Evenement[] = [];
  debours.forEach((s, rang) => {
    const ajouter = (decalage: number, nom: Etape, rangEvt: number) => {
      const date = plus(env, ouvre(env, s.jour), decalage);
      evenements.push({
        date,
        rang: rangEvt,
        cle: `${cle}|debours|${rang}|${nom}`,
        jouer: () => jouerEtape(env, m, s, rang, nom, date),
      });
    };
    ajouter(1, "saisir", 10);
    const parcours = s.parcours ?? "valide";
    if (parcours === "valide") ajouter(3, "valider", 12);
    if (parcours === "rejete_puis_valide") {
      ajouter(3, "rejeter", 12);
      ajouter(5, "corriger", 13);
      ajouter(7, "valider", 14);
    }
  });
  return evenements;
}
