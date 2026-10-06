"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alerte } from "../../components/ui/Alerte";
import { Bouton } from "../../components/ui/Bouton";
import { Champ } from "../../components/ui/Champ";
import { api, ErreurApi, MESSAGE_INATTENDU } from "../../lib/api";
import { validerConnexion, type ErreursConnexion } from "../../lib/connexion";

/** Message affiché pour une erreur de l'API ; l'API fournit déjà des messages en français. */
function messageErreur(e: unknown): string {
  if (!(e instanceof ErreurApi)) return MESSAGE_INATTENDU;
  if (e.code === "REQUETE_INVALIDE") return "Vérifiez l'adresse e-mail et le mot de passe saisis.";
  return e.message;
}

export function FormulaireConnexion({ suite }: { suite: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [afficherMdp, setAfficherMdp] = useState(false);
  const [erreurs, setErreurs] = useState<ErreursConnexion>({});
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const alerte = useRef<HTMLDivElement>(null);
  const champEmail = useRef<HTMLInputElement>(null);
  const champMdp = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (erreurGlobale) alerte.current?.focus();
  }, [erreurGlobale]);

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setErreurGlobale(null);
    const trouvees = validerConnexion({ email, motDePasse });
    setErreurs(trouvees);
    if (trouvees.email) return champEmail.current?.focus();
    if (trouvees.motDePasse) return champMdp.current?.focus();

    setEnCours(true);
    try {
      await api.post(
        "/api/auth/connexion",
        { email: email.trim(), mot_de_passe: motDePasse },
        { redirigerSi401: false },
      );
      router.replace(suite);
      router.refresh();
    } catch (e) {
      setErreurGlobale(messageErreur(e));
      setMotDePasse("");
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
        chargement={enCours}
        texteChargement="Connexion en cours…"
      >
        Se connecter
      </Bouton>
    </form>
  );
}
