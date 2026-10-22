"use client";

import { useCallback, useEffect, useState } from "react";
import type { TypeEntiteCollaboration } from "@missionpilot/shared";
import { api, messageErreur } from "../../lib/api";
import {
  fusionnerCommentaires,
  requeteCommentaires,
  secondesRestantes,
  type Commentaire,
  type PageCommentaires,
} from "../../lib/commentaires";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { EtatVide } from "../ui/EtatListe";
import { Icone } from "../ui/Icone";
import { Squelette } from "../ui/Squelette";
import { ElementCommentaire } from "./CommentairesElement";
import { NouveauCommentaire } from "./CommentairesSaisie";

export interface CommentairesProps {
  entiteType: TypeEntiteCollaboration;
  entiteId: string;
  utilisateurId: string;
  /** Un associé peut supprimer le commentaire d'autrui. */
  associe: boolean;
  /** Niveau du titre « Commentaires » (aucun titre si `null`). */
  niveauTitre?: 2 | 3 | 4 | null;
  /** Nom de l'élément commenté pour les noms accessibles (ex. « la facture F-2026-0012 »). */
  nomElement?: string;
}

type Etat =
  | { phase: "chargement" }
  | { phase: "erreur"; message: string }
  | { phase: "pret"; elements: Commentaire[]; curseur: string | null };

/** Rafraîchissement du compte à rebours de modification. */
const TIC_MS = 15_000;

/**
 * Fil de commentaires d'un élément (SOC-08) : liste paginée (du plus ancien au plus récent),
 * saisie avec mentions « @ », modification par l'auteur dans les 15 minutes (compte à rebours
 * discret), historique des modifications, suppression logique confirmée en deux temps. Le
 * texte est rendu comme du texte brut (React l'échappe ; aucun HTML interprété), retours à la
 * ligne conservés par CSS.
 */
export function Commentaires({
  entiteType,
  entiteId,
  utilisateurId,
  associe,
  niveauTitre = 2,
  nomElement,
}: CommentairesProps) {
  const [etat, setEtat] = useState<Etat>({ phase: "chargement" });
  const [suite, setSuite] = useState<{ enCours: boolean; erreur: string | null }>({
    enCours: false,
    erreur: null,
  });
  const [maintenant, setMaintenant] = useState(() => Date.now());

  const charger = useCallback(
    async (signal?: AbortSignal) => {
      setEtat({ phase: "chargement" });
      try {
        const r = await api.get<PageCommentaires>(requeteCommentaires(entiteType, entiteId), {
          signal,
        });
        setMaintenant(Date.now());
        setEtat({ phase: "pret", elements: r.elements, curseur: r.curseur_suivant });
      } catch (e) {
        if (signal?.aborted) return;
        setEtat({ phase: "erreur", message: messageErreur(e) });
      }
    },
    [entiteType, entiteId],
  );

  useEffect(() => {
    const controle = new AbortController();
    void charger(controle.signal);
    return () => controle.abort();
  }, [charger]);

  // Compte à rebours : seulement tant qu'un de ses commentaires est encore modifiable.
  const fenetreOuverte =
    etat.phase === "pret" &&
    etat.elements.some(
      (c) =>
        c.auteur_id === utilisateurId &&
        !c.supprime &&
        secondesRestantes(c.modifiable_jusqu_au, maintenant) > 0,
    );
  useEffect(() => {
    if (!fenetreOuverte) return;
    const t = setInterval(() => setMaintenant(Date.now()), TIC_MS);
    return () => clearInterval(t);
  }, [fenetreOuverte]);

  const integrer = (nouveaux: Commentaire[], curseur?: string | null) =>
    setEtat((e) =>
      e.phase === "pret"
        ? {
            phase: "pret",
            elements: fusionnerCommentaires(e.elements, nouveaux),
            curseur: curseur === undefined ? e.curseur : curseur,
          }
        : e,
    );

  async function chargerSuite() {
    if (etat.phase !== "pret" || !etat.curseur) return;
    setSuite({ enCours: true, erreur: null });
    try {
      const r = await api.get<PageCommentaires>(
        requeteCommentaires(entiteType, entiteId, etat.curseur),
      );
      integrer(r.elements, r.curseur_suivant);
      setSuite({ enCours: false, erreur: null });
    } catch (e) {
      setSuite({ enCours: false, erreur: messageErreur(e) });
    }
  }

  const Titre = niveauTitre ? (`h${niveauTitre}` as const) : null;
  const nombre = etat.phase === "pret" ? etat.elements.length : null;
  return (
    <section className="mp-commentaires" aria-label={Titre ? undefined : "Commentaires"}>
      {Titre ? (
        <Titre className="mp-commentaires__titre">
          <Icone nom="bulle" />
          <span>Commentaires</span>
          {nombre ? (
            <span className="mp-texte-doux">{` (${nombre}${etat.phase === "pret" && etat.curseur ? "+" : ""})`}</span>
          ) : null}
        </Titre>
      ) : null}
      {etat.phase === "chargement" ? (
        <Squelette lignes={2} libelle="Chargement des commentaires…" />
      ) : etat.phase === "erreur" ? (
        <div className="mp-pile">
          <Alerte tonalite="danger" titre="Les commentaires n'ont pas pu être chargés.">
            <p>{etat.message}</p>
          </Alerte>
          <div>
            <Bouton variante="secondaire" onClick={() => void charger()}>
              Réessayer
            </Bouton>
          </div>
        </div>
      ) : (
        <>
          {etat.elements.length === 0 ? (
            <EtatVide titre="Aucun commentaire pour l'instant." icone="bulle">
              <p>
                Posez une question ou laissez une précision à l&apos;équipe ; mentionnez un collègue
                avec « @ ».
              </p>
            </EtatVide>
          ) : (
            <ol className="mp-commentaires__liste">
              {etat.elements.map((c) => (
                <ElementCommentaire
                  key={c.id}
                  c={c}
                  utilisateurId={utilisateurId}
                  associe={associe}
                  maintenant={maintenant}
                  onMaj={(x) => integrer([x])}
                />
              ))}
            </ol>
          )}
          {etat.curseur ? (
            <div className="mp-pile">
              {suite.erreur ? (
                <p className="mp-champ__erreur" role="alert">
                  {suite.erreur}
                </p>
              ) : null}
              <div>
                <Bouton
                  variante="secondaire"
                  chargement={suite.enCours}
                  texteChargement="Chargement…"
                  onClick={() => void chargerSuite()}
                >
                  Afficher les commentaires suivants
                </Bouton>
              </div>
            </div>
          ) : null}
          <NouveauCommentaire
            entiteType={entiteType}
            entiteId={entiteId}
            nomElement={nomElement}
            onPublie={(c) => {
              setMaintenant(Date.now());
              integrer([c]);
            }}
          />
        </>
      )}
    </section>
  );
}

/**
 * Commentaires repliés (listes : débours, tâches du découpage) : le fil n'est chargé qu'à
 * l'ouverture, pour épargner la connexion.
 */
export function CommentairesRepliables(props: Omit<CommentairesProps, "niveauTitre">) {
  const [ouvert, setOuvert] = useState(false);
  return (
    <details
      className="mp-details mp-commentaires-repliables"
      onToggle={(e) => setOuvert((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <Icone nom="bulle" taille={18} />
        <span>
          Commentaires
          {props.nomElement ? (
            <span className="mp-visuellement-cache">{` sur ${props.nomElement}`}</span>
          ) : null}
        </span>
      </summary>
      {ouvert ? <Commentaires {...props} niveauTitre={null} /> : null}
    </details>
  );
}
