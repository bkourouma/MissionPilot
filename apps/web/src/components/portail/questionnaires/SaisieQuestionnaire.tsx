"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { QuestionQuestionnaire } from "@missionpilot/shared";
import { api } from "../../../lib/api";
import { formaterDate } from "../../../lib/format";
import {
  annonceCollegues,
  annonceVisibilite,
  cheminApiQuestionnaire,
  cheminApiSoumission,
  echeance,
  erreursQuestionsServeur,
  estModifiable,
  finApresEnvoi,
  finInaccessible,
  finLectureSeule,
  hrefReconnexion,
  issueBloquante,
  issueRefus,
  libelleReponse,
  messageActualisation,
  messageRefus,
  texteSauvegarde,
  type FinSaisie,
  type IssueRefus,
  type ProgressionPortail,
  type QuestionnaireComplet,
  type QuestionnairePortail,
  type Reponses,
  type ValeurReponse,
} from "../../../lib/portail-questionnaires";
import {
  chargeBrouillon,
  ecartVisibilite,
  erreursAvantEnvoi,
  estVideCharge,
  idBlocQuestion,
  idsQuestions,
  lireSaisie,
  possede,
  propre,
  questionsDe,
  reconcilier,
  saisiesInitiales,
  versSaisie,
  visiblesDepuisSaisies,
  type ChargeBrouillon,
  type Saisies,
  type ValeurSaisie,
} from "../../../lib/portail-questionnaires-saisie";
import { Alerte } from "../../ui/Alerte";
import { Icone } from "../../ui/Icone";
import { BandeauMode } from "./BandeauMode";
import { ChampQuestion } from "./ChampQuestion";
import { EnvoiQuestionnaire, type ErreurAffichee } from "./EnvoiQuestionnaire";
import { ProgressionQuestionnaire } from "./ProgressionQuestionnaire";
import { useSauvegardeQuestionnaire, type Envoye } from "./useSauvegardeQuestionnaire";
import "./questionnaires.css";

const ETATS_ALERTE = new Set(["hors_ligne", "indisponible", "session", "refuse", "bloque"]);

export interface SaisieQuestionnaireProps {
  questionnaire: QuestionnaireComplet;
  /** Progression la plus récente calculée par l'API. */
  progression: ProgressionPortail;
  aujourdhui: string;
  onVue: (vue: QuestionnairePortail) => void;
  /** Le formulaire laisse la place à la lecture seule ou à un message (avec la vue relue). */
  onFin: (fin: FinSaisie, vue?: QuestionnairePortail) => void;
}

/** État lu par la sauvegarde entre deux rendus (toujours à jour, sans attendre React). */
interface Courant {
  saisies: Saisies;
  base: Reponses;
  refusees: Record<string, string>;
  conflits: Record<string, ValeurReponse | null>;
}

const sansCle = <T,>(objet: Record<string, T>, cle: string) => {
  const copie = { ...objet };
  delete copie[cle];
  return copie;
};

/** Annonces polies regroupées : deux messages rapprochés sont lus ensemble. */
function useAnnonces() {
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

  const [initial] = useState<Courant>(() => ({
    saisies: saisiesInitiales(def, questionnaire.reponse.reponses ?? {}),
    base: { ...(questionnaire.reponse.reponses ?? {}) },
    refusees: {},
    conflits: {},
  }));
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
    const c = courant.current;
    const exclues = new Set([...Object.keys(c.refusees), ...Object.keys(c.conflits)]);
    const charge = chargeBrouillon(def, c.saisies, c.base, exclues);
    const visibles = visiblesDepuisSaisies(def, c.saisies);
    return {
      reponses: charge.reponses,
      invalides: [...charge.invalides, ...[...exclues].filter((q) => visibles.has(q))],
    };
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
    annoncer(
      [
        annonceCollegues(r.misesAJour.length, nouveaux.length),
        annonceVisibilite(ecart.apparues, ecart.masquees),
      ]
        .filter(Boolean)
        .join(" "),
    );
    onVue(vue);
    return { misesAJour: r.misesAJour.length, conflits: nouveaux.length };
  }

  /** Refus qui met fin à la saisie (verrouillage, clôture, droits) ou message affiché. */
  async function terminer(issue: IssueRefus, e: unknown, moment: "brouillon" | "envoi") {
    if (issue === "verrouille" || issue === "clos") {
      const perdues = nonEnregistrees();
      sauvegarde.bloquer();
      try {
        const vue = await api.get<QuestionnairePortail>(cheminApiQuestionnaire(id), {
          redirigerSi401: false,
        });
        onFin(finLectureSeule(vue, perdues), vue);
      } catch {
        onFin(finInaccessible(issue, mode, perdues));
      }
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
        if (!estModifiable(vue)) {
          const perdues = nonEnregistrees();
          sauvegarde.bloquer();
          onFin(finLectureSeule(vue, perdues), vue);
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

  function signalerErreurs(erreurs: readonly ErreurAffichee[]) {
    setTentative(true);
    setConfirmation(false);
    const n = erreurs.length;
    annoncer(
      `Envoi impossible : ${n === 1 ? "une question demande" : `${n} questions demandent`} votre attention.`,
    );
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
          message:
            "Vos dernières réponses n'ont pas pu être enregistrées : l'envoi est suspendu. Consultez l'état du brouillon ci-dessus, puis réessayez.",
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
    const serveur = propre(refusees, q.id) ?? propre(refusEnvoi, q.id);
    if (serveur) return serveur;
    const locale = erreursEnvoi?.get(q.id);
    if (locale) return locale;
    if (touchees.has(q.id) || q.type === "choix_multiple") {
      const r = lireSaisie(q, propre(saisies, q.id));
      if (!r.ok) return r.message;
    }
    return undefined;
  }

  function conflitDe(q: QuestionQuestionnaire) {
    if (!possede(conflits, q.id)) return null;
    return {
      leur: libelleReponse(q, propre(conflits, q.id)),
      onGarder: () => trancher(q.id, "garder"),
      onReprendre: () => trancher(q.id, "reprendre"),
    };
  }

  const sections = def.sections
    .map((s) => ({ section: s, questions: s.questions.filter((q) => visibles.has(q.id)) }))
    .filter((x) => x.questions.length > 0);
  const ech = echeance(questionnaire.date_limite, aujourdhui);
  const etatAlerte = ETATS_ALERTE.has(sauvegarde.etat);
  const texteEtat = texteSauvegarde(sauvegarde.etat, sauvegarde.derniere);
  const erreurs = tentative
    ? listeErreurs({ ...courant.current, saisies, refusees, conflits }, refusEnvoi)
    : [];

  return (
    <>
      <BandeauMode
        mode={mode}
        fonction={questionnaire.fonction}
        onActualiser={collectif ? () => void actualiser() : undefined}
        actualisation={actualisation}
      />
      {ech?.depassee ? (
        <Alerte tonalite="attention" annonce="aucune" titre="Date limite dépassée">
          <p>
            La date limite était le {formaterDate(questionnaire.date_limite)}. Vous pouvez encore
            répondre tant que le cabinet n&apos;a pas clos le questionnaire : envoyez vos réponses
            dès que possible.
          </p>
        </Alerte>
      ) : null}

      <div className="mp-pq-suivi">
        <ProgressionQuestionnaire progression={progression} id="mp-pq-progression" />
        <p className={etatAlerte ? "mp-pq-etat mp-pq-etat--alerte" : "mp-pq-etat"}>
          <Icone nom={etatAlerte ? "attention" : "nuage"} taille={16} />
          <span>{texteEtat}</span>
        </p>
        {erreurGlobale ? (
          <Alerte tonalite="danger" titre="Attention">
            <p>{erreurGlobale}</p>
          </Alerte>
        ) : null}
        <p className="mp-pq-note">
          Les questions marquées d&apos;un astérisque (*) sont obligatoires. Vos réponses sont
          enregistrées automatiquement au fil de la saisie : vous pouvez vous interrompre et
          reprendre plus tard.
        </p>
      </div>

      {sections.length >= 3 ? (
        <details className="mp-details mp-pq-sommaire">
          <summary>Sommaire ({sections.length} sections)</summary>
          <ol>
            {sections.map(({ section }) => (
              <li key={section.id}>
                <a href={`#mp-pq-section-${section.id}`}>{section.titre}</a>
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      <form
        className="mp-pq-formulaire"
        noValidate
        aria-label={`Réponses au questionnaire « ${questionnaire.titre} »`}
        onSubmit={(e) => e.preventDefault()}
      >
        {sections.map(({ section, questions: qs }) => {
          const idTitre = `mp-pq-titre-${section.id}`;
          return (
            <section
              key={section.id}
              id={`mp-pq-section-${section.id}`}
              className="mp-pq-section"
              aria-labelledby={idTitre}
            >
              <h2 id={idTitre} className="mp-section__titre mp-pq-section__titre">
                {section.titre}
              </h2>
              {section.description ? (
                <p className="mp-pq-section__description">{section.description}</p>
              ) : null}
              {qs.map((q) => (
                <ChampQuestion
                  key={q.id}
                  question={q}
                  valeur={propre(saisies, q.id)}
                  erreur={erreurDe(q)}
                  onChange={(v) => modifier(q.id, v)}
                  onBlur={() => toucher(q.id)}
                  miseAJour={majCollegues.has(q.id)}
                  conflit={conflitDe(q)}
                />
              ))}
            </section>
          );
        })}

        <EnvoiQuestionnaire
          collectif={collectif}
          texteEtat={texteEtat}
          etatAlerte={etatAlerte}
          enregistrement={sauvegarde.etat === "enregistrement"}
          hrefReconnexion={
            sauvegarde.etat === "session" || sessionEnvoi ? hrefReconnexion(id) : null
          }
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
        />
      </form>

      <div className="mp-visuellement-cache" role="status" aria-atomic="true">
        {annonce}
      </div>
    </>
  );
}
