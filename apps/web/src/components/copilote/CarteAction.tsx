"use client";

import { useEffect, useRef, useState } from "react";
import type { ActionProposeeCopilote, ResultatActionCopilote } from "@missionpilot/shared";
import {
  estExpiree,
  INTERVALLE_EXPIRATION_MS,
  LIBELLES_ETAT_ACTION,
  libelleExpiration,
  peutDecider,
  type EtatAction,
} from "../../lib/copilote";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut, type TonaliteStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { ListeElements } from "./ReponseVue";

const TONALITES: Record<EtatAction, TonaliteStatut> = {
  proposee: "attention",
  en_cours: "neutre",
  confirmee: "succes",
  annulee: "neutre",
  expiree: "attention",
  refusee: "danger",
  erreur: "danger",
};

export interface CarteActionProps {
  action: ActionProposeeCopilote;
  etat: EtatAction;
  resultat: ResultatActionCopilote | null;
  erreur: string | null;
  onConfirmer: () => void;
  onAnnuler: () => void;
}

/**
 * Action modifiante PROPOSÉE par le copilote : la carte EST la confirmation. Elle montre le résumé
 * exact de ce qui sera fait (texte construit par le serveur), l'expiration et les deux boutons ;
 * rien n'est modifié tant que « Confirmer » n'est pas pressé. Le focus passe au résultat une fois
 * la proposition traitée (les boutons disparaissent).
 */
export function CarteAction({
  action,
  etat,
  resultat,
  erreur,
  onConfirmer,
  onAnnuler,
}: CarteActionProps) {
  const [maintenant, setMaintenant] = useState(() => new Date());
  const ouverte = peutDecider(etat);
  const resultatRef = useRef<HTMLDivElement>(null);
  const dejaOuverte = useRef(true);

  // Compte à rebours : rafraîchi tant que la proposition peut encore être décidée.
  useEffect(() => {
    if (!ouverte) return;
    const t = setInterval(() => setMaintenant(new Date()), INTERVALLE_EXPIRATION_MS);
    return () => clearInterval(t);
  }, [ouverte]);

  // Focus sur le résultat quand la carte passe de « ouverte » à un état final.
  useEffect(() => {
    if (dejaOuverte.current && !ouverte && etat !== "en_cours") resultatRef.current?.focus();
    dejaOuverte.current = ouverte || etat === "en_cours";
  }, [ouverte, etat]);

  const expiree = ouverte && estExpiree(action.expire_le, maintenant);
  const etatAffiche: EtatAction = expiree ? "expiree" : etat;

  return (
    <section className="mp-copilote__action" aria-label={`Action proposée : ${action.libelle}`}>
      <div>
        <h3 className="mp-copilote__action-titre">{action.libelle}</h3>
        <BadgeStatut tonalite={TONALITES[etatAffiche]}>
          {LIBELLES_ETAT_ACTION[etatAffiche]}
        </BadgeStatut>
      </div>
      <p className="mp-copilote__action-resume">{action.resume}</p>
      {ouverte ? (
        <p className="mp-copilote__action-etat">
          {libelleExpiration(action.expire_le, maintenant)}
        </p>
      ) : null}
      {erreur ? (
        <Alerte tonalite="danger" titre="L'action n'a pas été effectuée">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {ouverte || etat === "en_cours" ? (
        <div className="mp-copilote__action-boutons">
          <Bouton
            onClick={onConfirmer}
            disabled={expiree || etat === "en_cours"}
            chargement={etat === "en_cours"}
            texteChargement="Confirmation…"
            icone="succes"
          >
            Confirmer
          </Bouton>
          <Bouton variante="secondaire" onClick={onAnnuler} disabled={etat === "en_cours"}>
            Annuler
          </Bouton>
        </div>
      ) : null}
      {resultat || (!ouverte && etat !== "en_cours") ? (
        <Alerte
          ref={resultatRef}
          tonalite={etat === "confirmee" ? "succes" : etat === "annulee" ? "info" : "attention"}
          annonce="status"
        >
          <p>{resultat?.texte ?? LIBELLES_ETAT_ACTION[etat]}</p>
          {resultat ? <ListeElements elements={resultat.elements} /> : null}
        </Alerte>
      ) : null}
    </section>
  );
}
