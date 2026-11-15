"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
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
        titre={t(
          "Mot de passe provisoire : à noter maintenant",
          "Temporary password: write it down now",
        )}
      >
        <p id="titre-mdp-genere">
          {compte}. {t("Ce mot de passe ne sera ", "This password will ")}
          <strong>{t("plus jamais affiché", "never be shown again")}</strong>
          {t(
            " : copiez-le et transmettez-le de façon sécurisée avant de fermer ce message.",
            ": copy it and pass it on securely before closing this message.",
          )}
        </p>
      </Alerte>
      <div className="mp-mdp-genere__ligne">
        <label className="mp-visuellement-cache" htmlFor="mdp-genere-valeur">
          {t("Mot de passe généré", "Generated password")}
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
          {t("Copier", "Copy")}
        </Bouton>
      </div>
      <p className="mp-visuellement-cache" role="status" aria-live="polite">
        {copie === "oui"
          ? t("Mot de passe copié dans le presse-papiers.", "Password copied to the clipboard.")
          : ""}
      </p>
      {copie === "oui" ? (
        <p className="mp-texte-doux" aria-hidden="true">
          {t("Copié dans le presse-papiers.", "Copied to the clipboard.")}
        </p>
      ) : null}
      {copie === "echec" ? (
        <p className="mp-texte-doux">
          {t(
            "Copie automatique impossible : le texte est sélectionné, copiez-le avec Ctrl+C.",
            "Automatic copy is not possible: the text is selected, copy it with Ctrl+C.",
          )}
        </p>
      ) : null}
      <Bouton onClick={surTermine}>
        {t("J'ai noté le mot de passe", "I have noted the password")}
      </Bouton>
    </section>
  );
}
