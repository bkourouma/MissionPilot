"use client";

import { useEffect, useRef, useState } from "react";
import type { QuestionQuestionnaire } from "@missionpilot/shared";
import { api } from "../../../lib/api";
import {
  annonceCollegues,
  annonceVisibilite,
  cheminApiQuestionnaire,
  finEcheance,
  finInaccessible,
  finLectureSeule,
  type FinSaisie,
  type IssueRefus,
  type QuestionnaireComplet,
  type QuestionnairePortail,
  type Reponses,
  type ValeurReponse,
} from "../../../lib/portail-questionnaires";
import {
  chargeBrouillon,
  erreursAvantEnvoi,
  lireSaisie,
  propre,
  questionsDe,
  saisiesInitiales,
  visiblesDepuisSaisies,
  type ChargeBrouillon,
  type Saisies,
} from "../../../lib/portail-questionnaires-saisie";
import type { ErreurAffichee } from "./EnvoiQuestionnaire";

export const ETATS_ALERTE = new Set(["hors_ligne", "indisponible", "session", "refuse", "bloque"]);

/** État lu par la sauvegarde entre deux rendus (toujours à jour, sans attendre React). */
export interface Courant {
  saisies: Saisies;
  base: Reponses;
  refusees: Record<string, string>;
  conflits: Record<string, ValeurReponse | null>;
}

export const sansCle = <T>(objet: Record<string, T>, cle: string) => {
  const copie = { ...objet };
  delete copie[cle];
  return copie;
};

/** Annonces polies regroupées : deux messages rapprochés sont lus ensemble. */
export function useAnnonces() {
  const [annonce, setAnnonce] = useState("");
  const attente = useRef<string[]>([]);
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (minuterie.current) clearTimeout(minuterie.current);
    },
    [],
  );
  const annoncer = (message: string) => {
    if (!message) return;
    attente.current.push(message);
    if (minuterie.current) clearTimeout(minuterie.current);
    setAnnonce("");
    minuterie.current = setTimeout(() => {
      setAnnonce(attente.current.join(" "));
      attente.current = [];
      minuterie.current = null;
    }, 150);
  };
  return { annonce, annoncer };
}

type Definition = QuestionnaireComplet["definition"];

/** Réponses à enregistrer ; les questions refusées ou en conflit attendent une action. */
export function chargePreparee(def: Definition, c: Courant): ChargeBrouillon {
  const exclues = new Set([...Object.keys(c.refusees), ...Object.keys(c.conflits)]);
  const charge = chargeBrouillon(def, c.saisies, c.base, exclues);
  const visibles = visiblesDepuisSaisies(def, c.saisies);
  return {
    reponses: charge.reponses,
    invalides: [...charge.invalides, ...[...exclues].filter((q) => visibles.has(q))],
  };
}

/** Erreurs à reprendre, dans l'ordre du questionnaire (refus du serveur d'abord). */
export function listeErreursQuestionnaire(
  def: Definition,
  c: Courant,
  refus: Record<string, string>,
): ErreurAffichee[] {
  const locales = new Map(
    erreursAvantEnvoi(def, c.saisies, c.conflits).map((e) => [e.id, e.message]),
  );
  const visibles = visiblesDepuisSaisies(def, c.saisies);
  const liste: ErreurAffichee[] = [];
  for (const q of questionsDe(def)) {
    if (!visibles.has(q.id)) continue;
    const message = propre(c.refusees, q.id) ?? propre(refus, q.id) ?? locales.get(q.id);
    if (message) liste.push({ id: q.id, libelle: q.libelle, message });
  }
  return liste;
}

/** Message d'erreur à afficher sous une question (serveur, contrôle d'envoi, saisie locale). */
export function erreurQuestion(
  q: QuestionQuestionnaire,
  etat: {
    refusees: Record<string, string>;
    refusEnvoi: Record<string, string>;
    erreursEnvoi: Map<string, string> | null;
    touchees: ReadonlySet<string>;
    saisies: Saisies;
  },
): string | undefined {
  const serveur = propre(etat.refusees, q.id) ?? propre(etat.refusEnvoi, q.id);
  if (serveur) return serveur;
  const locale = etat.erreursEnvoi?.get(q.id);
  if (locale) return locale;
  if (etat.touchees.has(q.id) || q.type === "choix_multiple") {
    const r = lireSaisie(q, propre(etat.saisies, q.id));
    if (!r.ok) return r.message;
  }
  return undefined;
}

/** Relit le questionnaire pour afficher la lecture seule ; message d'inaccessibilité sinon. */
export async function finParLecture(
  issue: IssueRefus,
  mode: QuestionnaireComplet["mode"],
  id: string,
  perdues: number,
): Promise<{ fin: FinSaisie; vue?: QuestionnairePortail }> {
  try {
    const vue = await api.get<QuestionnairePortail>(cheminApiQuestionnaire(id), {
      redirigerSi401: false,
    });
    return {
      fin: issue === "echeance" ? finEcheance(vue, perdues) : finLectureSeule(vue, perdues),
      vue,
    };
  } catch {
    return { fin: finInaccessible(issue, mode, perdues) };
  }
}

/** État initial lu par la sauvegarde : saisies tirées des réponses déjà enregistrées. */
export function courantInitial(def: Definition, reponses: Reponses): Courant {
  return {
    saisies: saisiesInitiales(def, reponses),
    base: { ...reponses },
    refusees: {},
    conflits: {},
  };
}

export const MESSAGE_ENVOI_SUSPENDU =
  "Vos dernières réponses n'ont pas pu être enregistrées : l'envoi est suspendu. Consultez l'état du brouillon ci-dessus, puis réessayez.";

export const annonceEnvoiImpossible = (n: number) =>
  `Envoi impossible : ${n === 1 ? "une question demande" : `${n} questions demandent`} votre attention.`;

/** Annonce regroupée après intégration d'une vue du serveur (collègues, questions affichées). */
export const annonceIntegration = (
  misesAJour: number,
  conflits: number,
  ecart: { apparues: number; masquees: number },
) =>
  [annonceCollegues(misesAJour, conflits), annonceVisibilite(ecart.apparues, ecart.masquees)]
    .filter(Boolean)
    .join(" ");
