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
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  libelleRenvoyer,
  libelleAbandonner,
}: DecisionSaisieProps) {
  const t = useT();
  const langue = useLangue();
  const [confirmer, setConfirmer] = useState(false);
  const [enCours, setEnCours] = useState<"renvoyer" | "abandonner" | null>(null);
  const cases = casesRemplies(entree);
  const titre =
    entree.etat === "refuse"
      ? t("Saisie refusée", "Entry refused")
      : t("Saisie non appliquée", "Entry not applied");

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
      titre={t(
        `${titre} — semaine du ${libelleDateCourte(entree.semaine, langue)}`,
        `${titre} — week of ${libelleDateCourte(entree.semaine, langue)}`,
      )}
    >
      <p>
        {libelleMotif(entree.motif, langue) ||
          t("Cette saisie attend votre décision.", "This entry is waiting for your decision.")}
      </p>
      <p>
        {t(
          "Votre saisie est gardée sur cet appareil tant que vous n'avez pas choisi.",
          "Your entry is kept on this device until you choose.",
        )}
      </p>
      {cases.length > 0 ? (
        <details className="mp-hors-ligne__detail">
          <summary>
            {t(
              `Voir ma saisie (${cases.length} case${cases.length > 1 ? "s" : ""})`,
              `View my entry (${cases.length} cell${cases.length > 1 ? "s" : ""})`,
            )}
          </summary>
          <ul className="mp-liste-simple">
            {cases.map((c) => {
              const rangee = libelleRangee?.(c.cle.slice(0, c.cle.lastIndexOf("|")));
              return (
                <li key={c.cle}>
                  {`${libelleDateCourte(c.date, langue)}${rangee ? ` — ${rangee}` : ""} : ${c.valeur}`}
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
            texteChargement={t("Envoi…", "Sending…")}
            disabled={enCours !== null}
            onClick={() => void agir("renvoyer")}
          >
            {libelleRenvoyer ?? t("Renvoyer ma saisie", "Resend my entry")}
          </Bouton>
        ) : null}
        {confirmer ? (
          <>
            <Bouton
              variante="danger"
              icone="corbeille"
              chargement={enCours === "abandonner"}
              texteChargement={t("Suppression…", "Deleting…")}
              disabled={enCours !== null}
              onClick={() => void agir("abandonner")}
            >
              {t("Confirmer l'abandon", "Confirm abandoning")}
            </Bouton>
            <Bouton
              variante="discret"
              disabled={enCours !== null}
              onClick={() => setConfirmer(false)}
            >
              {t("Garder ma saisie", "Keep my entry")}
            </Bouton>
          </>
        ) : (
          <Bouton
            variante="discret"
            icone="corbeille"
            disabled={enCours !== null}
            onClick={() => setConfirmer(true)}
          >
            {libelleAbandonner ?? t("Abandonner ma saisie", "Abandon my entry")}
          </Bouton>
        )}
        {correctionPossible(entree.motif) ? (
          <Link href="/temps/corrections">
            {t("Faire une demande de correction", "Make a correction request")}
          </Link>
        ) : null}
        {lienSemaine ? (
          <Link href={`/temps?semaine=${encodeURIComponent(entree.semaine)}`}>
            {t("Ouvrir la semaine", "Open the week")}
          </Link>
        ) : null}
      </div>
    </Alerte>
  );
}
