"use client";

import { useId, useState } from "react";
import { Alerte } from "../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Bouton } from "../../../../components/ui/Bouton";
import { EtatVide } from "../../../../components/ui/EtatListe";
import { api } from "../../../../lib/api";
import { formaterDateHeure } from "../../../../lib/format";
import {
  cheminActivationPrompt,
  cheminVersionsPrompt,
  libelleTache,
  LIMITE_PROMPTS,
  marquerActive,
  messageErreurIa,
  resumeSchemaSortie,
  type PageIa,
  type PromptIa,
} from "../../../../lib/ia";
import "../../../../components/ia/ia.css";

type Message = { tonalite: "succes" | "danger"; texte: string };

/**
 * Prompts versionnés du cabinet : la version active de chaque prompt, l'historique de ses
 * versions (lecture des consignes) et la réactivation d'une version (« ia.configurer »).
 */
export function PromptsIa({ initiale }: { initiale: PageIa<PromptIa> }) {
  const [prompts, setPrompts] = useState(initiale.elements);
  const [curseur, setCurseur] = useState(initiale.curseur_suivant);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function suite() {
    if (!curseur) return;
    setChargement(true);
    setErreur(null);
    try {
      const p = new URLSearchParams({ limite: String(LIMITE_PROMPTS), curseur });
      const r = await api.get<PageIa<PromptIa>>(`/api/ia/prompts?${p.toString()}`);
      setPrompts((l) => [...l, ...r.elements]);
      setCurseur(r.curseur_suivant);
    } catch (e) {
      setErreur(messageErreurIa(e));
    } finally {
      setChargement(false);
    }
  }

  if (prompts.length === 0) {
    return <EtatVide titre="Aucun prompt">Les prompts d&apos;exemple apparaissent ici.</EtatVide>;
  }
  return (
    <div className="mp-pile">
      <p className="mp-texte-petit mp-texte-doux">
        Une génération utilise la version active de son prompt, figée dans sa traçabilité. Les
        variables entre doubles accolades sont remplies par l&apos;écran ; « chiffres » l&apos;est
        par MissionPilot avec les résultats des moteurs de calcul.
      </p>
      <ul className="mp-liste-lignes">
        {prompts.map((p) => (
          <LignePrompt
            key={p.nom}
            prompt={p}
            onActive={(a) => setPrompts((l) => l.map((x) => (x.nom === a.nom ? a : x)))}
          />
        ))}
      </ul>
      {erreur ? (
        <Alerte tonalite="danger" titre="La suite de la liste n'a pas pu être chargée.">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {curseur ? (
        <div>
          <Bouton
            variante="secondaire"
            chargement={chargement}
            texteChargement="Chargement…"
            onClick={suite}
          >
            Afficher plus de prompts
          </Bouton>
        </div>
      ) : null}
    </div>
  );
}

function LignePrompt({ prompt, onActive }: { prompt: PromptIa; onActive: (p: PromptIa) => void }) {
  const id = useId();
  const [ouvert, setOuvert] = useState(false);
  const [versions, setVersions] = useState<PromptIa[] | null>(null);
  const [curseur, setCurseur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(false);
  const [activation, setActivation] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  async function charger(suiteDe: string | null) {
    setChargement(true);
    setMessage(null);
    try {
      const r = await api.get<PageIa<PromptIa>>(cheminVersionsPrompt(prompt.nom, suiteDe));
      setVersions((l) => (suiteDe && l ? [...l, ...r.elements] : r.elements));
      setCurseur(r.curseur_suivant);
      return true;
    } catch (e) {
      setMessage({ tonalite: "danger", texte: messageErreurIa(e) });
      return false;
    } finally {
      setChargement(false);
    }
  }

  async function basculer() {
    if (!ouvert && versions === null && !(await charger(null))) return;
    setOuvert(!ouvert);
  }

  async function activer(v: PromptIa) {
    setActivation(v.id);
    setMessage(null);
    try {
      const r = await api.post<PromptIa>(cheminActivationPrompt(v.id));
      setVersions((l) => marquerActive(l ?? [], r));
      onActive(r);
      setMessage({
        tonalite: "succes",
        texte: `Version ${r.version} de « ${r.nom} » activée : les prochaines générations l'utiliseront.`,
      });
    } catch (e) {
      setMessage({ tonalite: "danger", texte: messageErreurIa(e) });
    } finally {
      setActivation(null);
    }
  }

  return (
    <li className="mp-liste-lignes__ligne">
      <div className="mp-liste-lignes__texte">
        <span>
          <span className="mp-ia-code">{prompt.nom}</span>
          {` — ${libelleTache(prompt.tache)}`}
        </span>
        <span className="mp-badges">
          <BadgeStatut tonalite="succes">{`Version ${prompt.version} active`}</BadgeStatut>
          {prompt.exemple ? (
            <BadgeStatut tonalite="neutre" sansIcone>
              Exemple
            </BadgeStatut>
          ) : null}
        </span>
        {prompt.description ? (
          <span className="mp-texte-petit mp-texte-doux">{prompt.description}</span>
        ) : null}
      </div>
      <Bouton
        variante="secondaire"
        aria-expanded={ouvert}
        aria-controls={id}
        chargement={chargement && versions === null}
        texteChargement="Chargement…"
        onClick={basculer}
      >
        {ouvert ? "Masquer les versions" : "Versions et consignes"}
      </Bouton>
      {message && !ouvert ? (
        <div className="mp-ia-versions">
          <Alerte tonalite={message.tonalite}>
            <p>{message.texte}</p>
          </Alerte>
        </div>
      ) : null}
      <div id={id} hidden={!ouvert} className="mp-ia-versions">
        {ouvert && versions ? (
          <div className="mp-pile">
            {message ? (
              <Alerte tonalite={message.tonalite}>
                <p>{message.texte}</p>
              </Alerte>
            ) : null}
            <ol className="mp-versions-ia__liste" aria-label={`Versions du prompt ${prompt.nom}`}>
              {versions.map((v) => (
                <VersionPrompt
                  key={v.id}
                  v={v}
                  enCours={activation === v.id}
                  bloque={activation !== null}
                  activer={() => void activer(v)}
                />
              ))}
            </ol>
            {curseur ? (
              <div>
                <Bouton
                  variante="discret"
                  chargement={chargement}
                  texteChargement="Chargement…"
                  onClick={() => void charger(curseur)}
                >
                  Versions plus anciennes
                </Bouton>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function VersionPrompt({
  v,
  enCours,
  bloque,
  activer,
}: {
  v: PromptIa;
  enCours: boolean;
  bloque: boolean;
  activer: () => void;
}) {
  return (
    <li className="mp-versions-ia__element">
      <div className="mp-versions-ia__ligne">
        <strong>{`Version ${v.version}`}</strong>
        <span className="mp-texte-doux">{`créée le ${formaterDateHeure(v.cree_le)}`}</span>
        {v.actif ? (
          <BadgeStatut tonalite="succes">Active</BadgeStatut>
        ) : (
          <Bouton
            variante="secondaire"
            chargement={enCours}
            disabled={bloque && !enCours}
            texteChargement="Activation…"
            onClick={activer}
          >
            {`Activer la version ${v.version}`}
          </Bouton>
        )}
      </div>
      <details className="mp-details">
        <summary>{`Consignes de la version ${v.version}`}</summary>
        <dl className="mp-liste-def mp-liste-def--compacte">
          <div>
            <dt>Consigne système</dt>
            <dd>
              <p className="mp-contenu-ia__texte mp-ia-gabarit">{v.gabarit_systeme || "—"}</p>
            </dd>
          </div>
          <div>
            <dt>Consigne utilisateur</dt>
            <dd>
              <p className="mp-contenu-ia__texte mp-ia-gabarit">{v.gabarit_utilisateur}</p>
            </dd>
          </div>
          <div>
            <dt>Variables</dt>
            <dd className="mp-ia-code">
              {v.variables.length > 0 ? v.variables.join(", ") : "Aucune"}
            </dd>
          </div>
          <div>
            <dt>Format de sortie</dt>
            <dd>{resumeSchemaSortie(v.schema_sortie)}</dd>
          </div>
        </dl>
      </details>
    </li>
  );
}
