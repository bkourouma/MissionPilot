"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alerte } from "../../../components/ui/Alerte";
import { Bouton } from "../../../components/ui/Bouton";
import { Champ } from "../../../components/ui/Champ";
import { connecterSuperAdmin } from "../../../lib/plateforme-client";
import { CHEMIN_PLATEFORME } from "../../../lib/plateforme-routes";
import {
  messageConnexion,
  validerConnexionPlateforme,
  type ErreursConnexionPlateforme,
} from "./connexion-logique";

/**
 * Connexion du super administrateur. Identifiants uniquement dans l'état du composant : jamais
 * dans l'URL ni le stockage du navigateur ; le mot de passe est vidé dès l'envoi.
 */
export function FormulaireConnexionPlateforme() {
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [afficherMdp, setAfficherMdp] = useState(false);
  const [erreurs, setErreurs] = useState<ErreursConnexionPlateforme>({});
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [connecte, setConnecte] = useState(false);
  const alerte = useRef<HTMLDivElement>(null);
  const champEmail = useRef<HTMLInputElement>(null);
  const champMdp = useRef<HTMLInputElement>(null);
  // Chaque refus (même message répété) redonne le focus à l'alerte.
  const [refus, setRefus] = useState(0);

  useEffect(() => {
    if (erreurGlobale) alerte.current?.focus();
  }, [erreurGlobale, refus]);

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (enCours || connecte) return;
    setErreurGlobale(null);
    const trouvees = validerConnexionPlateforme({ email, motDePasse });
    setErreurs(trouvees);
    if (trouvees.email) return champEmail.current?.focus();
    if (trouvees.motDePasse) return champMdp.current?.focus();

    setEnCours(true);
    const envoye = motDePasse;
    // Le mot de passe ne reste pas en mémoire au-delà de son envoi.
    setMotDePasse("");
    try {
      await connecterSuperAdmin(email, envoye);
      setConnecte(true);
      // Rechargement complet : change d'espace et vide l'état client.
      window.location.assign(CHEMIN_PLATEFORME);
    } catch (e) {
      setErreurGlobale(messageConnexion(e));
      setRefus((n) => n + 1);
      setEnCours(false);
    }
  }

  return (
    <form className="mp-formulaire" noValidate onSubmit={soumettre} aria-busy={enCours}>
      {erreurGlobale ? (
        <Alerte ref={alerte} tonalite="danger" titre="Connexion impossible">
          <p>{erreurGlobale}</p>
        </Alerte>
      ) : null}
      <Champ
        ref={champEmail}
        libelle="Adresse e-mail"
        type="email"
        name="email"
        autoComplete="username"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        erreur={erreurs.email}
      />
      <div className="mp-champ-mdp">
        <Champ
          ref={champMdp}
          libelle="Mot de passe"
          type={afficherMdp ? "text" : "password"}
          name="mot_de_passe"
          autoComplete="current-password"
          required
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
          erreur={erreurs.motDePasse}
        />
        <Bouton
          variante="discret"
          icone="oeil"
          className="mp-champ-mdp__bascule"
          aria-pressed={afficherMdp}
          onClick={() => setAfficherMdp((v) => !v)}
        >
          Afficher le mot de passe
        </Bouton>
      </div>
      <Bouton
        type="submit"
        pleineLargeur
        chargement={enCours || connecte}
        texteChargement={connecte ? "Ouverture de la console…" : "Connexion en cours…"}
      >
        Se connecter
      </Bouton>
      <p className="mp-texte-doux">
        <Link href="/connexion">Connexion à un cabinet</Link>
      </p>
    </form>
  );
}
