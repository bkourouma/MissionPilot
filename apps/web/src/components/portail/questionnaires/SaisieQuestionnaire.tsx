"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { QuestionQuestionnaire } from "@missionpilot/shared";
import { api } from "../../../lib/api";
import {
  annonceVisibilite,
  cheminApiQuestionnaire,
  cheminApiSoumission,
  erreursQuestionsServeur,
  estModifiable,
  finApresEnvoi,
  finInaccessible,
  finLectureSeule,
  issueBloquante,
  issueRefus,
  libelleReponse,
  messageActualisation,
  messageRefus,
  type FinSaisie,
  type IssueRefus,
  type ProgressionPortail,
  type QuestionnaireComplet,
  type QuestionnairePortail,
} from "../../../lib/portail-questionnaires";
import {
  ecartVisibilite,
  erreursAvantEnvoi,
  estVideCharge,
  idBlocQuestion,
  idsQuestions,
  possede,
  propre,
  questionsDe,
  reconcilier,
  versSaisie,
  visiblesDepuisSaisies,
  type ChargeBrouillon,
  type ValeurSaisie,
} from "../../../lib/portail-questionnaires-saisie";
import type { ErreurAffichee } from "./EnvoiQuestionnaire";
import { SaisieQuestionnaireVue } from "./SaisieQuestionnaireVue";
import {
  annonceEnvoiImpossible,
  annonceIntegration,
  chargePreparee,
  courantInitial,
  erreurQuestion,
  finParLecture,
  listeErreursQuestionnaire,
  MESSAGE_ENVOI_SUSPENDU,
  sansCle,
  useAnnonces,
  type Courant,
} from "./saisie-questionnaire-outils";
import { useSauvegardeQuestionnaire, type Envoye } from "./useSauvegardeQuestionnaire";
import "./questionnaires.css";

export interface SaisieQuestionnaireProps {
  questionnaire: QuestionnaireComplet;
  /** Progression la plus récente calculée par l'API. */
  progression: ProgressionPortail;
  aujourdhui: string;
  onVue: (vue: QuestionnairePortail) => void;
  /** Le formulaire laisse la place à la lecture seule ou à un message (avec la vue relue). */
  onFin: (fin: FinSaisie, vue?: QuestionnairePortail) => void;
}

/**
 * Formulaire de réponse : sections et questions visibles selon les réponses (en direct),
 * brouillon enregistré côté serveur, conflits avec les collègues (mode collectif), contrôle
 * des obligatoires avec focus sur la première erreur, envoi après confirmation.
 */
export function SaisieQuestionnaire({
  questionnaire,
  progression,
  aujourdhui,
  onVue,
  onFin,
}: SaisieQuestionnaireProps) {
  const def = questionnaire.definition;
  const { id, mode } = questionnaire;
  const collectif = mode === "collectif";
  const questions = useMemo(() => new Map(questionsDe(def).map((q) => [q.id, q])), [def]);
  const ids = useMemo(() => idsQuestions(def), [def]);

  const [initial] = useState<Courant>(() =>
    courantInitial(def, questionnaire.reponse.reponses ?? {}),
  );
  const courant = useRef<Courant>(initial);
  const [saisies, setSaisies] = useState(initial.saisies);
  const [refusees, setRefusees] = useState(initial.refusees);
  const [conflits, setConflits] = useState(initial.conflits);
  const [majCollegues, setMajCollegues] = useState<ReadonlySet<string>>(() => new Set());
  const [touchees, setTouchees] = useState<ReadonlySet<string>>(() => new Set());
  const [tentative, setTentative] = useState(false);
  const [refusEnvoi, setRefusEnvoi] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreurEnvoi, setErreurEnvoi] = useState<{ message: string; n: number } | null>(null);
  const [sessionEnvoi, setSessionEnvoi] = useState(false);
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [actualisation, setActualisation] = useState(false);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const refErreurEnvoi = useRef<HTMLDivElement>(null);
  const { annonce, annoncer } = useAnnonces();

  function mettreAJour(maj: Partial<Courant>) {
    courant.current = { ...courant.current, ...maj };
    if (maj.saisies) setSaisies(maj.saisies);
    if (maj.refusees) setRefusees(maj.refusees);
    if (maj.conflits) setConflits(maj.conflits);
  }

  /** Réponses à enregistrer ; les questions refusées ou en conflit attendent une action. */
  function preparer(): ChargeBrouillon {
    return chargePreparee(def, courant.current);
  }

  function nonEnregistrees(): number {
    const c = preparer();
    return new Set([...Object.keys(c.reponses), ...c.invalides]).size;
  }

  /** Intègre une vue du serveur (sauvegarde ou relecture) sans perdre la saisie en cours. */
  function integrer(vue: QuestionnairePortail, envoye: Envoye) {
    const avant = visiblesDepuisSaisies(def, courant.current.saisies);
    const r = reconcilier(def, courant.current, envoye, vue.reponse.reponses ?? {}, collectif);
    const nouveaux = Object.keys(r.conflits).filter((q) => !possede(courant.current.conflits, q));
    mettreAJour({
      saisies: r.saisies,
      base: r.base,
      conflits: { ...courant.current.conflits, ...r.conflits },
    });
    if (r.misesAJour.length > 0) setMajCollegues((prev) => new Set([...prev, ...r.misesAJour]));
    const ecart = ecartVisibilite(avant, visiblesDepuisSaisies(def, r.saisies));
    annoncer(annonceIntegration(r.misesAJour.length, nouveaux.length, ecart));
    onVue(vue);
    return { misesAJour: r.misesAJour.length, conflits: nouveaux.length };
  }

  /** Refus qui met fin à la saisie (verrouillage, clôture, droits) ou message affiché. */
  async function terminer(issue: IssueRefus, e: unknown, moment: "brouillon" | "envoi") {
    if (issue === "verrouille" || issue === "clos" || issue === "echeance") {
      const perdues = nonEnregistrees();
      sauvegarde.bloquer();
      const r = await finParLecture(issue, mode, id, perdues);
      onFin(r.fin, r.vue);
      return;
    }
    if (issueBloquante(issue) || issue === "securite") {
      const perdues = nonEnregistrees();
      sauvegarde.bloquer();
      onFin(finInaccessible(issue, mode, perdues));
      return;
    }
    const message = messageRefus(issue, mode, moment, e);
    if (moment === "envoi") {
      setSessionEnvoi(issue === "session");
      setErreurEnvoi((prev) => ({ message, n: (prev?.n ?? 0) + 1 }));
    } else {
      setErreurGlobale(message);
    }
  }

  function refuser(e: unknown, issue: IssueRefus): boolean {
    if (issue === "invalide") {
      const champs = erreursQuestionsServeur(e, ids);
      if (Object.keys(champs).length > 0) {
        mettreAJour({ refusees: { ...courant.current.refusees, ...champs } });
        annoncer("Certaines réponses ont été refusées : corrigez les questions signalées.");
        return true;
      }
    }
    void terminer(issue, e, "brouillon");
    return false;
  }

  const sauvegarde = useSauvegardeQuestionnaire({
    questionnaireId: id,
    derniereSauvegarde: questionnaire.reponse.derniere_saisie,
    preparer,
    appliquer: (vue, envoye) => {
      setErreurGlobale(null);
      integrer(vue, envoye);
    },
    refuser,
    annoncer,
  });

  useEffect(() => {
    if (!focus) return;
    const bloc = document.getElementById(idBlocQuestion(focus.id));
    const cible =
      bloc?.querySelector<HTMLElement>("input:checked") ??
      bloc?.querySelector<HTMLElement>("input, textarea, select");
    cible?.focus();
  }, [focus]);

  useEffect(() => {
    if (erreurEnvoi) refErreurEnvoi.current?.focus();
  }, [erreurEnvoi]);

  const allerA = (qid: string) => setFocus((f) => ({ id: qid, n: (f?.n ?? 0) + 1 }));

  function modifier(qid: string, v: ValeurSaisie) {
    const avant = visiblesDepuisSaisies(def, courant.current.saisies);
    const suivantes = { ...courant.current.saisies, [qid]: v };
    const maj: Partial<Courant> = { saisies: suivantes };
    if (possede(courant.current.refusees, qid))
      maj.refusees = sansCle(courant.current.refusees, qid);
    mettreAJour(maj);
    if (possede(refusEnvoi, qid)) setRefusEnvoi((prev) => sansCle(prev, qid));
    if (majCollegues.has(qid)) {
      setMajCollegues((prev) => new Set([...prev].filter((x) => x !== qid)));
    }
    const ecart = ecartVisibilite(avant, visiblesDepuisSaisies(def, suivantes));
    annoncer(annonceVisibilite(ecart.apparues, ecart.masquees));
    sauvegarde.signaler();
  }

  function toucher(qid: string) {
    setTouchees((prev) => (prev.has(qid) ? prev : new Set([...prev, qid])));
  }

  function trancher(qid: string, choix: "garder" | "reprendre") {
    const leur = propre(courant.current.conflits, qid) ?? null;
    const maj: Partial<Courant> = { conflits: sansCle(courant.current.conflits, qid) };
    const q = questions.get(qid);
    if (choix === "reprendre" && q)
      maj.saisies = { ...courant.current.saisies, [qid]: versSaisie(q, leur) };
    mettreAJour(maj);
    sauvegarde.signaler();
    allerA(qid);
  }

  /** Mode collectif : relit la réponse partagée entre deux sauvegardes. */
  async function actualiser() {
    setActualisation(true);
    setErreurGlobale(null);
    try {
      await sauvegarde.enFile(async () => {
        const vue = await api.get<QuestionnairePortail>(cheminApiQuestionnaire(id), {
          redirigerSi401: false,
        });
        if (!estModifiable(vue, aujourdhui)) {
          const perdues = nonEnregistrees();
          sauvegarde.bloquer();
          onFin(finLectureSeule(vue, perdues, aujourdhui), vue);
          return;
        }
        const bilan = integrer(vue, {});
        if (bilan.misesAJour === 0 && bilan.conflits === 0) {
          annoncer("Aucune nouvelle réponse de vos collègues.");
        }
      });
      if (!estVideCharge(preparer())) sauvegarde.signaler();
    } catch (e) {
      const issue = issueRefus(e);
      if (issueBloquante(issue) || issue === "securite") await terminer(issue, e, "brouillon");
      else setErreurGlobale(messageActualisation(issue, e));
    } finally {
      setActualisation(false);
    }
  }

  /** Erreurs à reprendre, dans l'ordre du questionnaire (refus du serveur d'abord). */
  function listeErreurs(c: Courant, refus: Record<string, string>): ErreurAffichee[] {
    return listeErreursQuestionnaire(def, c, refus);
  }

  function signalerErreurs(erreurs: readonly ErreurAffichee[]) {
    setTentative(true);
    setConfirmation(false);
    annoncer(annonceEnvoiImpossible(erreurs.length));
    if (erreurs[0]) allerA(erreurs[0].id);
  }

  function demanderEnvoi() {
    setErreurEnvoi(null);
    const erreurs = listeErreurs(courant.current, refusEnvoi);
    if (erreurs.length > 0) {
      signalerErreurs(erreurs);
      return;
    }
    setConfirmation(true);
  }

  async function confirmerEnvoi() {
    setEnvoi(true);
    setErreurEnvoi(null);
    setSessionEnvoi(false);
    try {
      if (!(await sauvegarde.envoyer())) {
        setConfirmation(false);
        setErreurEnvoi({
          message: MESSAGE_ENVOI_SUSPENDU,
          n: Date.now(),
        });
        return;
      }
      // La sauvegarde a pu intégrer des réponses de collègues : nouveau contrôle.
      const erreurs = listeErreurs(courant.current, refusEnvoi);
      if (erreurs.length > 0) {
        signalerErreurs(erreurs);
        return;
      }
      const vue = await sauvegarde.enFile(() =>
        api.post<QuestionnairePortail>(cheminApiSoumission(id), undefined, {
          redirigerSi401: false,
        }),
      );
      sauvegarde.bloquer();
      onFin(finApresEnvoi(vue), vue);
    } catch (e) {
      const issue = issueRefus(e);
      setConfirmation(false);
      const champs = issue === "invalide" ? erreursQuestionsServeur(e, ids) : {};
      if (Object.keys(champs).length > 0) {
        setRefusEnvoi(champs);
        const liste = listeErreurs(courant.current, champs);
        // Questions refusées masquées ici (affichage divergent) : message général ci-dessous.
        if (liste.length > 0) {
          signalerErreurs(liste);
          return;
        }
      }
      await terminer(issue, e, "envoi");
    } finally {
      setEnvoi(false);
    }
  }

  const visibles = useMemo(() => visiblesDepuisSaisies(def, saisies), [def, saisies]);
  const erreursEnvoi = useMemo(
    () =>
      tentative
        ? new Map(erreursAvantEnvoi(def, saisies, conflits).map((e) => [e.id, e.message]))
        : null,
    [def, saisies, conflits, tentative],
  );

  function erreurDe(q: QuestionQuestionnaire): string | undefined {
    return erreurQuestion(q, { refusees, refusEnvoi, erreursEnvoi, touchees, saisies });
  }

  function conflitDe(q: QuestionQuestionnaire) {
    if (!possede(conflits, q.id)) return null;
    return {
      leur: libelleReponse(q, propre(conflits, q.id)),
      onGarder: () => trancher(q.id, "garder"),
      onReprendre: () => trancher(q.id, "reprendre"),
    };
  }

  const erreurs = tentative
    ? listeErreurs({ ...courant.current, saisies, refusees, conflits }, refusEnvoi)
    : [];

  return (
    <SaisieQuestionnaireVue
      questionnaire={questionnaire}
      progression={progression}
      aujourdhui={aujourdhui}
      actualisation={actualisation}
      onActualiser={() => void actualiser()}
      erreurGlobale={erreurGlobale}
      etatSauvegarde={sauvegarde.etat}
      derniereSauvegarde={sauvegarde.derniere}
      visibles={visibles}
      saisies={saisies}
      majCollegues={majCollegues}
      erreurDe={erreurDe}
      conflitDe={conflitDe}
      onModifier={modifier}
      onToucher={toucher}
      sessionEnvoi={sessionEnvoi}
      erreurs={erreurs}
      erreurEnvoi={erreurEnvoi?.message ?? null}
      refErreurEnvoi={refErreurEnvoi}
      confirmation={confirmation}
      envoi={envoi}
      onEnregistrer={() => {
        setErreurGlobale(null);
        void sauvegarde.enregistrer();
      }}
      onDemander={demanderEnvoi}
      onConfirmer={() => void confirmerEnvoi()}
      onAnnuler={() => setConfirmation(false)}
      onAllerA={allerA}
      annonce={annonce}
    />
  );
}
