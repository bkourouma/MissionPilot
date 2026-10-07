"use client";

import { useEffect, useRef, useState } from "react";
import { Alerte } from "../../components/ui/Alerte";
import { classesBouton } from "../../components/ui/Bouton";
import { api } from "../../lib/api";
import {
  CHEMIN_CONNEXION_DEMO,
  connexionDemoReussie,
  libelleRoles,
  MESSAGE_CONNEXION_DEMO_INATTENDUE,
  messageErreurConnexionDemo,
  type CompteDemo,
} from "../../lib/connexion-demo";
import "./comptes-demo.css";

/**
 * Connexion rapide de démonstration (recette locale) : un bouton par compte, un clic ouvre la
 * session sans rien saisir. Affiché seulement si l'API a servi la liste (`page.tsx`) ; la
 * redirection qui suit est celle de la connexion normale (`FormulaireConnexion`, `surConnexion`).
 */
export function ComptesDemo({
  comptes,
  connecte,
  surConnexion,
}: {
  comptes: readonly CompteDemo[];
  /** Session ouverte (par ce bloc ou par le formulaire) : redirection en cours. */
  connecte: boolean;
  /** Réponse vérifiée de l'API, transmise à l'automate de la connexion normale. */
  surConnexion: (corps: unknown) => void;
}) {
  const [enCours, setEnCours] = useState<CompteDemo | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState("");
  // Chaque refus (même message répété) redonne le focus à l'alerte.
  const [refus, setRefus] = useState(0);
  const alerte = useRef<HTMLDivElement>(null);
  const occupe = enCours !== null || connecte;

  useEffect(() => {
    if (erreur) alerte.current?.focus();
  }, [erreur, refus]);

  function echec(message: string) {
    setAnnonce("");
    setErreur(message);
    setRefus((n) => n + 1);
    setEnCours(null);
  }

  async function ouvrir(compte: CompteDemo) {
    if (occupe) return;
    setErreur(null);
    setEnCours(compte);
    setAnnonce(`Connexion au compte de ${compte.nom} en cours…`);
    let corps: unknown;
    try {
      corps = await api.post<unknown>(
        CHEMIN_CONNEXION_DEMO,
        { email: compte.email },
        { redirigerSi401: false },
      );
    } catch (e) {
      return echec(messageErreurConnexionDemo(e));
    }
    if (!connexionDemoReussie(corps)) return echec(MESSAGE_CONNEXION_DEMO_INATTENDUE);
    setAnnonce(`Session ouverte pour ${compte.nom}. Ouverture de votre espace…`);
    // Le bouton reste en chargement jusqu'à la redirection.
    surConnexion(corps);
  }

  return (
    <section className="mp-comptes-demo" aria-labelledby="titre-comptes-demo">
      <h2 id="titre-comptes-demo" className="mp-comptes-demo__titre">
        Comptes de démonstration (environnement local)
      </h2>
      <p id="aide-comptes-demo" className="mp-texte-doux mp-comptes-demo__aide">
        Recette locale : un clic ouvre la session du compte choisi, sans mot de passe. Un compte
        protégé par la double authentification passe par le formulaire ci-dessus.
      </p>
      {erreur ? (
        <Alerte ref={alerte} tonalite="danger" titre="Connexion rapide impossible">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {comptes.length === 0 ? (
        <p className="mp-texte-doux">
          Aucun compte de démonstration dans cette base : lancez le seed de démonstration (commande{" "}
          <code>db:seed-demo</code> de l&apos;API) puis rechargez la page.
        </p>
      ) : (
        <ul className="mp-comptes-demo__liste">
          {comptes.map((compte) => {
            const actif = enCours?.email === compte.email;
            return (
              <li key={compte.email}>
                <button
                  type="button"
                  className={`${classesBouton("secondaire", true)} mp-comptes-demo__compte`}
                  aria-describedby="aide-comptes-demo"
                  aria-busy={actif || undefined}
                  disabled={occupe}
                  onClick={() => void ouvrir(compte)}
                >
                  {actif ? <span className="mp-bouton__indicateur" aria-hidden="true" /> : null}
                  <span className="mp-comptes-demo__texte">
                    <span className="mp-comptes-demo__nom">{compte.nom}</span>
                    <span className="mp-comptes-demo__role">
                      {actif
                        ? connecte
                          ? "Ouverture de votre espace…"
                          : "Connexion en cours…"
                        : libelleRoles(compte.roles)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mp-visuellement-cache" role="status" aria-live="polite">
        {annonce}
      </p>
    </section>
  );
}
