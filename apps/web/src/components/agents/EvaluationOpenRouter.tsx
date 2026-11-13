"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { api, messageErreur } from "../../lib/api";
import {
  ajouterPage,
  cheminDemandeEvaluation,
  cheminDemandesEvaluation,
  cheminLancementEvaluation,
  consequenceStatut,
  detailCoutCas,
  estEnAttente,
  etatCas,
  fusionnerDemande,
  INTERVALLE_SONDAGE_MS,
  LIBELLES_ETAT_CAS,
  LIBELLES_ETAT_CAS_EN,
  libelleCause,
  libelleProgression,
  libelleRegressions,
  libelleReussite,
  libelleStatut,
  lignesCout,
  lireModeleCandidat,
  messageLancementEvaluation,
  noteReference,
  plafondConnu,
  possibiliteLancement,
  questionConfirmation,
  raisonsCas,
  REGLE_PRODUCTION,
  REGLE_PRODUCTION_EN,
  sondageContinue,
  TONALITES_ETAT_CAS,
  tonaliteStatut,
  type DemandeEvaluationOpenRouter,
  type LancementEvaluation,
  type PageDemandesEvaluation,
  type ResultatCasOpenRouter,
} from "../../lib/evaluations-openrouter";
import { formaterDateHeure } from "../../lib/format";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { EtatVide } from "../ui/EtatListe";
import { Select } from "../ui/Select";

/*
 * Rejeu réel d'une évaluation de non-régression sur OpenRouter (AGT-04) : choix de la version
 * du prompt, état de la dernière demande (rafraîchi tant qu'elle est en file ou en cours),
 * résultat par cas, coût et jetons seulement si l'API les fournit (`finance.lire`), lancement
 * en deux temps qui rappelle le plafond, historique paginé. Toutes les propriétés reçues de la
 * page serveur sont sérialisables (aucune fonction).
 */

export interface VersionPromptEvaluation {
  id: string;
  libelle: string;
}

type Chargement = "chargement" | "ok" | "erreur";

export function EvaluationOpenRouter({
  versions,
  idInitial,
  peutLancer,
}: {
  versions: VersionPromptEvaluation[];
  idInitial: string | null;
  peutLancer: boolean;
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"modele">();
  const [promptId, setPromptId] = useState(
    idInitial && versions.some((v) => v.id === idInitial) ? idInitial : (versions[0]?.id ?? ""),
  );
  const [modele, setModele] = useState("");
  const [demandes, setDemandes] = useState<DemandeEvaluationOpenRouter[]>([]);
  const [curseur, setCurseur] = useState<string | null>(null);
  const [etat, setEtat] = useState<Chargement>("chargement");
  const [erreur, setErreur] = useState<string | null>(null);
  const [pageEnCours, setPageEnCours] = useState(false);
  const [miseEnFile, setMiseEnFile] = useState(false);
  const [suiviArrete, setSuiviArrete] = useState(false);
  const [relance, setRelance] = useState(0);

  const derniere = demandes[0] ?? null;
  const idSuivi = derniere && estEnAttente(derniere.statut) ? derniere.demande_id : null;
  const possibilite =
    etat === "chargement" && peutLancer
      ? {
          possible: false,
          raison: t(
            "Chargement de l'état des rejeux de cette version…",
            "Loading the replay status of this version…",
          ),
        }
      : possibiliteLancement(peutLancer, promptId !== "", derniere, langue);

  // Première page de l'historique de la version choisie (annulée si le choix change).
  useEffect(() => {
    if (promptId === "") return;
    const controle = new AbortController();
    setEtat("chargement");
    setErreur(null);
    setSuiviArrete(false);
    api
      .get<PageDemandesEvaluation>(cheminDemandesEvaluation(promptId), {
        signal: controle.signal,
      })
      .then((page) => {
        setDemandes(page.elements);
        setCurseur(page.curseur_suivant);
        setEtat("ok");
      })
      .catch((e: unknown) => {
        if (controle.signal.aborted) return;
        setDemandes([]);
        setCurseur(null);
        setErreur(messageErreur(e));
        setEtat("erreur");
      });
    return () => controle.abort();
  }, [promptId, relance]);

  // Sondage espacé du statut tant que la dernière demande est en file ou en cours : arrêté à la
  // fin de la demande, au démontage, au changement de version, et borné (jamais infini).
  useEffect(() => {
    if (!idSuivi) return;
    const suivi = idSuivi;
    let annule = false;
    let sondages = 0;
    let echecs = 0;
    let minuterie: ReturnType<typeof setTimeout> | undefined;
    const controle = new AbortController();

    async function tour() {
      sondages += 1;
      let statut = "en_cours";
      try {
        const d = await api.get<DemandeEvaluationOpenRouter>(cheminDemandeEvaluation(suivi), {
          signal: controle.signal,
        });
        if (annule) return;
        echecs = 0;
        statut = d.statut;
        setDemandes((l) => fusionnerDemande(l, d));
      } catch {
        if (annule) return;
        echecs += 1;
      }
      if (estEnAttente(statut) && !sondageContinue(statut, sondages, echecs)) {
        setSuiviArrete(true);
        return;
      }
      if (estEnAttente(statut)) minuterie = setTimeout(() => void tour(), INTERVALLE_SONDAGE_MS);
    }

    setSuiviArrete(false);
    minuterie = setTimeout(() => void tour(), INTERVALLE_SONDAGE_MS);
    return () => {
      annule = true;
      if (minuterie) clearTimeout(minuterie);
      controle.abort();
    };
  }, [idSuivi, relance]);

  async function pageSuivante() {
    if (!curseur) return;
    setPageEnCours(true);
    try {
      const page = await api.get<PageDemandesEvaluation>(
        cheminDemandesEvaluation(promptId, curseur),
      );
      setDemandes((l) => ajouterPage(l, page.elements));
      setCurseur(page.curseur_suivant);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setPageEnCours(false);
    }
  }

  // Après le 202 : lit la demande créée pour l'afficher (et déclencher le sondage).
  const afficherDemande = useCallback(async (demandeId: string) => {
    try {
      const d = await api.get<DemandeEvaluationOpenRouter>(cheminDemandeEvaluation(demandeId));
      setDemandes((l) => fusionnerDemande(l, d));
      setEtat("ok");
      setErreur(null);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setMiseEnFile(false);
    }
  }, []);

  async function lancer(): Promise<boolean> {
    return f.envoyer(
      lireModeleCandidat(modele, langue),
      (charge) => api.post<LancementEvaluation>(cheminLancementEvaluation(promptId), charge),
      {
        rafraichir: false,
        succes: t(
          "Rejeu mis en file : le résultat s'affiche ci-dessous dès qu'il est connu.",
          "Replay queued: the result appears below as soon as it is known.",
        ),
        messageSpecifique: (e) => messageLancementEvaluation(e, langue),
        apres: (r) => {
          setMiseEnFile(true);
          void afficherDemande(r.demande_id);
        },
      },
    );
  }

  if (versions.length === 0) {
    return (
      <EtatVide titre={t("Aucune version de prompt à évaluer.", "No prompt version to evaluate.")}>
        <p>
          {t(
            "Créez d'abord un jeu d'essai pour un prompt (section « Jeux d'essai » ci-dessous), puis revenez lancer le rejeu réel.",
            'First create a test set for a prompt ("Test sets" section below), then come back to run the real replay.',
          )}
        </p>
      </EtatVide>
    );
  }

  return (
    <div className="mp-pile mp-evaluation-or">
      <Alerte tonalite="info" titre={t("Règle en production", "Production rule")} annonce="aucune">
        <ul className="mp-evaluation-or__regle">
          {(langue === "en" ? REGLE_PRODUCTION_EN : REGLE_PRODUCTION).map((ligne) => (
            <li key={ligne}>{ligne}</li>
          ))}
        </ul>
      </Alerte>

      <form
        ref={f.refFormulaire}
        className="mp-formulaire"
        noValidate
        onSubmit={(e) => e.preventDefault()}
      >
        <RetourFormulaire
          erreur={f.erreurGlobale}
          succes={f.succes}
          refAlerte={f.refAlerte}
          titreErreur={t("Lancement impossible", "Launch not possible")}
        />
        <div className="mp-grille-champs">
          <Select
            libelle={t("Version du prompt", "Prompt version")}
            value={promptId}
            onChange={(e) => {
              f.effacerSucces();
              setPromptId(e.target.value);
            }}
            options={versions.map((v) => ({ valeur: v.id, libelle: v.libelle }))}
          />
          {peutLancer ? (
            <Champ
              libelle={t("Modèle candidat (facultatif)", "Candidate model (optional)")}
              aide={t(
                "Par défaut, le modèle de la tâche du prompt.",
                "By default, the model of the prompt's task.",
              )}
              maxLength={170}
              value={modele}
              onChange={(e) => setModele(e.target.value)}
              erreur={f.erreurs.modele}
            />
          ) : null}
        </div>
        <div className="mp-actions-formulaire mp-evaluation-or__lancement">
          {possibilite.possible && !miseEnFile ? (
            <BoutonConfirmation
              libelle={t("Lancer l'évaluation sur OpenRouter", "Run the evaluation on OpenRouter")}
              question={questionConfirmation(plafondConnu(demandes), langue)}
              libelleConfirmation={t("Oui, lancer le rejeu facturé", "Yes, run the billed replay")}
              texteChargement={t("Mise en file…", "Queuing…")}
              variante="primaire"
              action={lancer}
            />
          ) : (
            <>
              <Bouton disabled aria-describedby="evaluation-or-raison">
                {t("Lancer l'évaluation sur OpenRouter", "Run the evaluation on OpenRouter")}
              </Bouton>
              <p id="evaluation-or-raison" className="mp-texte-petit mp-texte-doux">
                {miseEnFile
                  ? t("Mise en file du rejeu…", "Queuing the replay…")
                  : possibilite.raison}
              </p>
            </>
          )}
        </div>
      </form>

      <ResultatDemandes
        etat={etat}
        erreur={erreur}
        demandes={demandes}
        curseur={curseur}
        pageEnCours={pageEnCours}
        suiviArrete={suiviArrete && idSuivi !== null}
        onPageSuivante={() => void pageSuivante()}
        onActualiser={() => setRelance((n) => n + 1)}
      />
    </div>
  );
}

function ResultatDemandes({
  etat,
  erreur,
  demandes,
  curseur,
  pageEnCours,
  suiviArrete,
  onPageSuivante,
  onActualiser,
}: {
  etat: Chargement;
  erreur: string | null;
  demandes: DemandeEvaluationOpenRouter[];
  curseur: string | null;
  pageEnCours: boolean;
  suiviArrete: boolean;
  onPageSuivante: () => void;
  onActualiser: () => void;
}) {
  const t = useT();
  const [derniere, ...anciennes] = demandes;
  return (
    <div className="mp-pile" aria-busy={etat === "chargement"}>
      {etat === "chargement" ? (
        <p className="mp-texte-doux" role="status">
          {t("Chargement des rejeux de cette version…", "Loading the replays of this version…")}
        </p>
      ) : null}
      {erreur ? (
        <Alerte
          tonalite="danger"
          titre={t(
            "Les rejeux n'ont pas pu être chargés ou mis à jour.",
            "The replays could not be loaded or updated.",
          )}
        >
          <p>{erreur}</p>
          <Bouton variante="secondaire" onClick={onActualiser}>
            {t("Réessayer", "Try again")}
          </Bouton>
        </Alerte>
      ) : null}
      {suiviArrete ? (
        <Alerte
          tonalite="attention"
          titre={t("Le suivi automatique s'est arrêté.", "Automatic tracking has stopped.")}
        >
          <p>
            {t(
              "Le statut n'a pas pu être rafraîchi (ou la demande dure anormalement longtemps).",
              "The status could not be refreshed (or the request is taking unusually long).",
            )}
          </p>
          <Bouton variante="secondaire" onClick={onActualiser}>
            {t("Actualiser maintenant", "Refresh now")}
          </Bouton>
        </Alerte>
      ) : null}
      {etat === "ok" && !derniere ? (
        <EtatVide
          titre={t("Aucun rejeu réel pour cette version.", "No real replay for this version.")}
        >
          <p>
            {t(
              "Tant qu'aucun rejeu n'a réussi, cette version ne peut pas être activée en production.",
              "Until a replay has succeeded, this version cannot be activated in production.",
            )}
          </p>
        </EtatVide>
      ) : null}
      {derniere ? (
        <section aria-labelledby="titre-derniere-demande" className="mp-pile">
          <h3 id="titre-derniere-demande" className="mp-section__titre">
            {t("Dernier rejeu", "Latest replay")}
          </h3>
          <DetailDemande d={derniere} />
        </section>
      ) : null}
      {anciennes.length > 0 || curseur ? (
        <section aria-labelledby="titre-historique-demandes" className="mp-pile">
          <h3 id="titre-historique-demandes" className="mp-section__titre">
            {t("Historique des rejeux", "Replay history")}
          </h3>
          <ul className="mp-liste-lignes">
            {anciennes.map((d) => (
              <LigneHistorique key={d.demande_id} d={d} />
            ))}
          </ul>
          {curseur ? (
            <div>
              <Bouton
                variante="secondaire"
                chargement={pageEnCours}
                texteChargement={t("Chargement…", "Loading…")}
                onClick={onPageSuivante}
              >
                {t("Afficher plus de rejeux", "Show more replays")}
              </Bouton>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function BadgesDemande({ d }: { d: DemandeEvaluationOpenRouter }) {
  const langue = useLangue();
  const reussite = libelleReussite(d, langue);
  const regressions = libelleRegressions(d.regressions, langue);
  return (
    <span className="mp-badges">
      <BadgeStatut tonalite={tonaliteStatut(d.statut)}>
        {libelleStatut(d.statut, langue)}
      </BadgeStatut>
      {reussite ? <BadgeStatut tonalite="neutre">{reussite}</BadgeStatut> : null}
      {regressions ? <BadgeStatut tonalite="danger">{regressions}</BadgeStatut> : null}
    </span>
  );
}

function Contexte({ d }: { d: DemandeEvaluationOpenRouter }) {
  const t = useT();
  const langue = useLangue();
  return (
    <>
      {d.prompt_nom} v{d.prompt_version} · {t("jeu", "set")} v{d.jeu_version} · {d.modele} ·{" "}
      {d.demande_par_nom} · {formaterDateHeure(d.cree_le, undefined, langue)}
    </>
  );
}

function DetailDemande({ d }: { d: DemandeEvaluationOpenRouter }) {
  const t = useT();
  const langue = useLangue();
  const cause = libelleCause(d.cause, langue);
  const cout = lignesCout(d, langue);
  const enAttente = estEnAttente(d.statut);
  const id = useId();
  return (
    <div className="mp-evaluation-or__demande">
      <div className="mp-liste-lignes__texte">
        <BadgesDemande d={d} />
        <span className="mp-texte-doux mp-texte-petit">
          <Contexte d={d} />
        </span>
      </div>
      <div className="mp-evaluation-or__progression">
        <label htmlFor={id} className="mp-texte-petit">
          {libelleProgression(d, langue)}
        </label>
        <progress id={id} max={Math.max(d.cas_total, 1)} value={d.cas_traites} />
      </div>
      {enAttente ? (
        <p className="mp-texte-petit mp-texte-doux" role="status">
          {d.statut === "en_file"
            ? t(
                "En attente d'exécution par le traitement en arrière-plan. ",
                "Waiting to be run by background processing. ",
              )
            : t("Rejeu en cours. ", "Replay in progress. ")}
          {consequenceStatut(d.statut, langue)}{" "}
          {t("Actualisation toutes les 5 secondes.", "Refreshes every 5 seconds.")}
        </p>
      ) : (
        <Alerte
          tonalite={
            d.statut === "reussie" ? "succes" : d.statut === "echouee" ? "danger" : "attention"
          }
          annonce="aucune"
        >
          {cause ? <p>{cause}</p> : null}
          <p>{consequenceStatut(d.statut, langue)}</p>
        </Alerte>
      )}
      {cout.length > 0 ? (
        <dl className="mp-liste-def mp-liste-def--compacte">
          {cout.map((l) => (
            <div key={l.libelle}>
              <dt>{l.libelle}</dt>
              <dd>{l.valeur}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <ResultatsParCas resultats={d.resultats} />
    </div>
  );
}

function ResultatsParCas({ resultats }: { resultats: ResultatCasOpenRouter[] | null }) {
  const t = useT();
  const langue = useLangue();
  if (!resultats || resultats.length === 0) return null;
  return (
    <ul
      className="mp-liste-lignes"
      aria-label={t("Résultat par cas du jeu d'essai", "Result per test set case")}
    >
      {resultats.map((c) => {
        const e = etatCas(c);
        const raisons = raisonsCas(c, langue);
        const note = noteReference(c, langue);
        const cout = detailCoutCas(c, langue);
        return (
          <li key={c.code} className="mp-liste-lignes__ligne">
            <div className="mp-liste-lignes__texte">
              <strong className="mp-evaluation-or__code">{c.code}</strong>
              {raisons.length > 0 ? (
                <span className="mp-texte-petit">
                  {t("Raisons :", "Reasons:")} {raisons.join(", ")}.
                </span>
              ) : null}
              {e === "non_evalue" ? (
                <span className="mp-texte-petit mp-texte-doux">
                  {t(
                    "Ce cas n'a pas été rejoué : l'évaluation s'est arrêtée avant.",
                    "This case was not replayed: the evaluation stopped before it.",
                  )}
                </span>
              ) : null}
              {note ? <span className="mp-texte-petit">{note}</span> : null}
              {cout ? <span className="mp-texte-petit mp-texte-doux">{cout}</span> : null}
            </div>
            <BadgeStatut tonalite={TONALITES_ETAT_CAS[e]}>
              {(langue === "en" ? LIBELLES_ETAT_CAS_EN : LIBELLES_ETAT_CAS)[e]}
            </BadgeStatut>
          </li>
        );
      })}
    </ul>
  );
}

function LigneHistorique({ d }: { d: DemandeEvaluationOpenRouter }) {
  const t = useT();
  const langue = useLangue();
  const cause = libelleCause(d.cause, langue);
  const cout = lignesCout(d, langue).find((l) => l.libelle === t("Coût réel", "Actual cost"));
  return (
    <li className="mp-liste-lignes__ligne mp-evaluation-or__historique">
      <div className="mp-liste-lignes__texte">
        <BadgesDemande d={d} />
        <span className="mp-texte-doux mp-texte-petit">
          <Contexte d={d} />
          {cout ? ` · ${cout.valeur}` : ""}
        </span>
        {cause ? <span className="mp-texte-petit">{cause}</span> : null}
        {d.resultats && d.resultats.length > 0 ? (
          <details className="mp-details">
            <summary>{t("Résultat par cas", "Result per case")}</summary>
            <ResultatsParCas resultats={d.resultats} />
          </details>
        ) : null}
      </div>
    </li>
  );
}
