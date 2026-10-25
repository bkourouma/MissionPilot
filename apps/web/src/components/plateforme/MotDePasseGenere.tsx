"use client";

import { useEffect, useRef, useState } from "react";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import "./plateforme-commun.css";

export interface MotDePasseGenereProps {
  /** Mot de passe généré par le serveur : gardé en mémoire de l'écran seulement. */
  motDePasse: string;
  /** Ce que le mot de passe ouvre (ex. « Compte de Awa Koné (awa@exemple.ci) »). */
  compte: string;
  /** Appelé quand l'opérateur confirme l'avoir noté : le parent doit alors OUBLIER le secret. */
  surTermine: () => void;
}

/**
 * Affiche UNE fois un mot de passe généré. Aucun stockage navigateur, aucune URL : le secret
 * disparaît quand le parent le retire de son état (bouton « J'ai noté le mot de passe »).
 */
export function MotDePasseGenere({ motDePasse, compte, surTermine }: MotDePasseGenereProps) {
  const [copie, setCopie] = useState<"non" | "oui" | "echec">("non");
  const champ = useRef<HTMLInputElement>(null);

  // Affiché une seule fois : le focus y va dès l'apparition, et quitter la page avant de l'avoir
  // noté demande une confirmation au navigateur (le secret ne se retrouve nulle part ailleurs).
  useEffect(() => {
    champ.current?.focus();
    const avertir = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", avertir);
    return () => window.removeEventListener("beforeunload", avertir);
  }, []);

  async function copier() {
    try {
      await navigator.clipboard.writeText(motDePasse);
      setCopie("oui");
    } catch {
      // Presse-papiers refusé (contexte non sécurisé, autorisation) : sélection manuelle.
      champ.current?.select();
      setCopie("echec");
    }
  }

  return (
    <section className="mp-mdp-genere" aria-labelledby="titre-mdp-genere">
      <Alerte
        tonalite="attention"
        annonce="alert"
        titre="Mot de passe provisoire : à noter maintenant"
      >
        <p id="titre-mdp-genere">
          {compte}. Ce mot de passe ne sera <strong>plus jamais affiché</strong> : copiez-le et
          transmettez-le de façon sécurisée avant de fermer ce message.
        </p>
      </Alerte>
      <div className="mp-mdp-genere__ligne">
        <label className="mp-visuellement-cache" htmlFor="mdp-genere-valeur">
          Mot de passe généré
        </label>
        <input
          ref={champ}
          id="mdp-genere-valeur"
          className="mp-champ__controle mp-mdp-genere__valeur"
          type="text"
          readOnly
          value={motDePasse}
          autoComplete="off"
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
        />
        <Bouton variante="secondaire" icone="copie" onClick={() => void copier()}>
          Copier
        </Bouton>
      </div>
      <p className="mp-visuellement-cache" role="status" aria-live="polite">
        {copie === "oui" ? "Mot de passe copié dans le presse-papiers." : ""}
      </p>
      {copie === "oui" ? (
        <p className="mp-texte-doux" aria-hidden="true">
          Copié dans le presse-papiers.
        </p>
      ) : null}
      {copie === "echec" ? (
        <p className="mp-texte-doux">
          Copie automatique impossible : le texte est sélectionné, copiez-le avec Ctrl+C.
        </p>
      ) : null}
      <Bouton onClick={surTermine}>J&apos;ai noté le mot de passe</Bouton>
    </section>
  );
}
