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
  sondageContinue,
  TONALITES_ETAT_CAS,
  tonaliteStatut,
  type DemandeEvaluationOpenRouter,
  type LancementEvaluation,
  type PageDemandesEvaluation,
  type ResultatCasOpenRouter,
} from "../../lib/evaluations-openrouter";
import { formaterDateHeure } from "../../lib/format";
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
      ? { possible: false, raison: "Chargement de l'état des rejeux de cette version…" }
      : possibiliteLancement(peutLancer, promptId !== "", derniere);

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
      lireModeleCandidat(modele),
      (charge) => api.post<LancementEvaluation>(cheminLancementEvaluation(promptId), charge),
      {
        rafraichir: false,
        succes: "Rejeu mis en file : le résultat s'affiche ci-dessous dès qu'il est connu.",
        messageSpecifique: messageLancementEvaluation,
        apres: (r) => {
          setMiseEnFile(true);
          void afficherDemande(r.demande_id);
        },
      },
    );
  }

  if (versions.length === 0) {
    return (
      <EtatVide titre="Aucune version de prompt à évaluer.">
        <p>
          Créez d&apos;abord un jeu d&apos;essai pour un prompt (section « Jeux d&apos;essai »
          ci-dessous), puis revenez lancer le rejeu réel.
        </p>
      </EtatVide>
    );
  }

  return (
    <div className="mp-pile mp-evaluation-or">
      <Alerte tonalite="info" titre="Règle en production" annonce="aucune">
        <ul className="mp-evaluation-or__regle">
          {REGLE_PRODUCTION.map((ligne) => (
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
          titreErreur="Lancement impossible"
        />
        <div className="mp-grille-champs">
          <Select
            libelle="Version du prompt"
            value={promptId}
            onChange={(e) => {
              f.effacerSucces();
              setPromptId(e.target.value);
            }}
            options={versions.map((v) => ({ valeur: v.id, libelle: v.libelle }))}
          />
          {peutLancer ? (
            <Champ
              libelle="Modèle candidat (facultatif)"
              aide="Par défaut, le modèle de la tâche du prompt."
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
              libelle="Lancer l'évaluation sur OpenRouter"
              question={questionConfirmation(plafondConnu(demandes))}
              libelleConfirmation="Oui, lancer le rejeu facturé"
              texteChargement="Mise en file…"
              variante="primaire"
              action={lancer}
            />
          ) : (
            <>
              <Bouton disabled aria-describedby="evaluation-or-raison">
                Lancer l&apos;évaluation sur OpenRouter
              </Bouton>
              <p id="evaluation-or-raison" className="mp-texte-petit mp-texte-doux">
                {miseEnFile ? "Mise en file du rejeu…" : possibilite.raison}
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
  const [derniere, ...anciennes] = demandes;
  return (
    <div className="mp-pile" aria-busy={etat === "chargement"}>
      {etat === "chargement" ? (
        <p className="mp-texte-doux" role="status">
          Chargement des rejeux de cette version…
        </p>
      ) : null}
      {erreur ? (
        <Alerte tonalite="danger" titre="Les rejeux n'ont pas pu être chargés ou mis à jour.">
          <p>{erreur}</p>
          <Bouton variante="secondaire" onClick={onActualiser}>
            Réessayer
          </Bouton>
        </Alerte>
      ) : null}
      {suiviArrete ? (
        <Alerte tonalite="attention" titre="Le suivi automatique s'est arrêté.">
          <p>
            Le statut n&apos;a pas pu être rafraîchi (ou la demande dure anormalement longtemps).
          </p>
          <Bouton variante="secondaire" onClick={onActualiser}>
            Actualiser maintenant
          </Bouton>
        </Alerte>
      ) : null}
      {etat === "ok" && !derniere ? (
        <EtatVide titre="Aucun rejeu réel pour cette version.">
          <p>
            Tant qu&apos;aucun rejeu n&apos;a réussi, cette version ne peut pas être activée en
            production.
          </p>
        </EtatVide>
      ) : null}
      {derniere ? (
        <section aria-labelledby="titre-derniere-demande" className="mp-pile">
          <h3 id="titre-derniere-demande" className="mp-section__titre">
            Dernier rejeu
          </h3>
          <DetailDemande d={derniere} />
        </section>
      ) : null}
      {anciennes.length > 0 || curseur ? (
        <section aria-labelledby="titre-historique-demandes" className="mp-pile">
          <h3 id="titre-historique-demandes" className="mp-section__titre">
            Historique des rejeux
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
                texteChargement="Chargement…"
                onClick={onPageSuivante}
              >
                Afficher plus de rejeux
              </Bouton>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function BadgesDemande({ d }: { d: DemandeEvaluationOpenRouter }) {
  const reussite = libelleReussite(d);
  const regressions = libelleRegressions(d.regressions);
  return (
    <span className="mp-badges">
      <BadgeStatut tonalite={tonaliteStatut(d.statut)}>{libelleStatut(d.statut)}</BadgeStatut>
      {reussite ? <BadgeStatut tonalite="neutre">{reussite}</BadgeStatut> : null}
      {regressions ? <BadgeStatut tonalite="danger">{regressions}</BadgeStatut> : null}
    </span>
  );
}

function Contexte({ d }: { d: DemandeEvaluationOpenRouter }) {
  return (
    <>
      {d.prompt_nom} v{d.prompt_version} · jeu v{d.jeu_version} · {d.modele} · {d.demande_par_nom} ·{" "}
      {formaterDateHeure(d.cree_le)}
    </>
  );
}

function DetailDemande({ d }: { d: DemandeEvaluationOpenRouter }) {
  const cause = libelleCause(d.cause);
  const cout = lignesCout(d);
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
          {libelleProgression(d)}
        </label>
        <progress id={id} max={Math.max(d.cas_total, 1)} value={d.cas_traites} />
      </div>
      {enAttente ? (
        <p className="mp-texte-petit mp-texte-doux" role="status">
          {d.statut === "en_file"
            ? "En attente d'exécution par le traitement en arrière-plan. "
            : "Rejeu en cours. "}
          {consequenceStatut(d.statut)} Actualisation toutes les 5 secondes.
        </p>
      ) : (
        <Alerte
          tonalite={
            d.statut === "reussie" ? "succes" : d.statut === "echouee" ? "danger" : "attention"
          }
          annonce="aucune"
        >
          {cause ? <p>{cause}</p> : null}
          <p>{consequenceStatut(d.statut)}</p>
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
  if (!resultats || resultats.length === 0) return null;
  return (
    <ul className="mp-liste-lignes" aria-label="Résultat par cas du jeu d'essai">
      {resultats.map((c) => {
        const e = etatCas(c);
        const raisons = raisonsCas(c);
        const note = noteReference(c);
        const cout = detailCoutCas(c);
        return (
          <li key={c.code} className="mp-liste-lignes__ligne">
            <div className="mp-liste-lignes__texte">
              <strong className="mp-evaluation-or__code">{c.code}</strong>
              {raisons.length > 0 ? (
                <span className="mp-texte-petit">Raisons : {raisons.join(", ")}.</span>
              ) : null}
              {e === "non_evalue" ? (
                <span className="mp-texte-petit mp-texte-doux">
                  Ce cas n&apos;a pas été rejoué : l&apos;évaluation s&apos;est arrêtée avant.
                </span>
              ) : null}
              {note ? <span className="mp-texte-petit">{note}</span> : null}
              {cout ? <span className="mp-texte-petit mp-texte-doux">{cout}</span> : null}
            </div>
            <BadgeStatut tonalite={TONALITES_ETAT_CAS[e]}>{LIBELLES_ETAT_CAS[e]}</BadgeStatut>
          </li>
        );
      })}
    </ul>
  );
}

function LigneHistorique({ d }: { d: DemandeEvaluationOpenRouter }) {
  const cause = libelleCause(d.cause);
  const cout = lignesCout(d).find((l) => l.libelle === "Coût réel");
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
            <summary>Résultat par cas</summary>
            <ResultatsParCas resultats={d.resultats} />
          </details>
        ) : null}
      </div>
    </li>
  );
}
