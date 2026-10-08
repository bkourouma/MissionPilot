"use client";

import Link from "next/link";
import { useState } from "react";
import {
  casesRemplies,
  correctionPossible,
  libelleMotif,
  type SaisieEnAttente,
} from "../../lib/hors-ligne/file-temps";
import { libelleDateCourte } from "../../lib/semaine";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";

export interface DecisionSaisieProps {
  entree: SaisieEnAttente;
  /** Libellé de la rangée (tâche, activité) quand la page le connaît. */
  libelleRangee?: (cleRangee: string) => string | undefined;
  /** Absent : le renvoi n'a pas de sens (feuille plus modifiable). */
  onRenvoyer?: () => Promise<unknown>;
  onAbandonner: () => Promise<unknown>;
  /** Lien vers la semaine concernée (panneau des autres semaines). */
  lienSemaine?: boolean;
  libelleRenvoyer?: string;
  libelleAbandonner?: string;
}

/**
 * Saisie gardée sur l'appareil qui n'a pas pu être appliquée : le détail est montré et
 * l'utilisateur décide. L'abandon demande une confirmation (rien n'est jeté par erreur).
 */
export function DecisionSaisie({
  entree,
  libelleRangee,
  onRenvoyer,
  onAbandonner,
  lienSemaine = false,
  libelleRenvoyer = "Renvoyer ma saisie",
  libelleAbandonner = "Abandonner ma saisie",
}: DecisionSaisieProps) {
  const [confirmer, setConfirmer] = useState(false);
  const [enCours, setEnCours] = useState<"renvoyer" | "abandonner" | null>(null);
  const cases = casesRemplies(entree);
  const titre = entree.etat === "refuse" ? "Saisie refusée" : "Saisie non appliquée";

  async function agir(choix: "renvoyer" | "abandonner") {
    setEnCours(choix);
    try {
      await (choix === "renvoyer" ? onRenvoyer?.() : onAbandonner());
    } finally {
      setEnCours(null);
      setConfirmer(false);
    }
  }

  return (
    <Alerte
      tonalite="attention"
      titre={`${titre} — semaine du ${libelleDateCourte(entree.semaine)}`}
    >
      <p>{libelleMotif(entree.motif) || "Cette saisie attend votre décision."}</p>
      <p>Votre saisie est gardée sur cet appareil tant que vous n&apos;avez pas choisi.</p>
      {cases.length > 0 ? (
        <details className="mp-hors-ligne__detail">
          <summary>{`Voir ma saisie (${cases.length} case${cases.length > 1 ? "s" : ""})`}</summary>
          <ul className="mp-liste-simple">
            {cases.map((c) => {
              const rangee = libelleRangee?.(c.cle.slice(0, c.cle.lastIndexOf("|")));
              return (
                <li key={c.cle}>
                  {`${libelleDateCourte(c.date)}${rangee ? ` — ${rangee}` : ""} : ${c.valeur}`}
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
      <div className="mp-hors-ligne__actions">
        {onRenvoyer ? (
          <Bouton
            variante="secondaire"
            icone="envoyer"
            chargement={enCours === "renvoyer"}
            texteChargement="Envoi…"
            disabled={enCours !== null}
            onClick={() => void agir("renvoyer")}
          >
            {libelleRenvoyer}
          </Bouton>
        ) : null}
        {confirmer ? (
          <>
            <Bouton
              variante="danger"
              icone="corbeille"
              chargement={enCours === "abandonner"}
              texteChargement="Suppression…"
              disabled={enCours !== null}
              onClick={() => void agir("abandonner")}
            >
              Confirmer l&apos;abandon
            </Bouton>
            <Bouton
              variante="discret"
              disabled={enCours !== null}
              onClick={() => setConfirmer(false)}
            >
              Garder ma saisie
            </Bouton>
          </>
        ) : (
          <Bouton
            variante="discret"
            icone="corbeille"
            disabled={enCours !== null}
            onClick={() => setConfirmer(true)}
          >
            {libelleAbandonner}
          </Bouton>
        )}
        {correctionPossible(entree.motif) ? (
          <Link href="/temps/corrections">Faire une demande de correction</Link>
        ) : null}
        {lienSemaine ? (
          <Link href={`/temps?semaine=${encodeURIComponent(entree.semaine)}`}>
            Ouvrir la semaine
          </Link>
        ) : null}
      </div>
    </Alerte>
  );
}
