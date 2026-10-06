"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alerte } from "../../components/ui/Alerte";
import { Bouton } from "../../components/ui/Bouton";
import { Champ } from "../../components/ui/Champ";
import { api, ErreurApi, MESSAGE_INATTENDU } from "../../lib/api";
import { validerConnexion, type ErreursConnexion } from "../../lib/connexion";
import {
  chargeConnexion2fa,
  ETAT_INITIAL,
  transitionConnexion,
  validerFacteur,
  type EtatConnexion,
  type EvenementConnexion,
} from "../../lib/double-authentification";

/** Message affiché pour une erreur de l'API ; l'API fournit déjà des messages en français. */
function messageErreur(e: unknown): string {
  if (!(e instanceof ErreurApi)) return MESSAGE_INATTENDU;
  if (e.code === "REQUETE_INVALIDE") return "Vérifiez l'adresse e-mail et le mot de passe saisis.";
  return e.message;
}

/**
 * Connexion en deux temps : identifiants, puis code de la double authentification si l'API
 * le demande. Le défi reste dans l'état mémoire de ce composant (jamais dans l'URL ni le
 * stockage du navigateur) et disparaît dès la connexion, l'abandon ou son expiration.
 */
export function FormulaireConnexion({ suite }: { suite: string }) {
  const router = useRouter();
  const [etat, setEtat] = useState<EtatConnexion>(ETAT_INITIAL);
  const avancer = (ev: EvenementConnexion) => setEtat((e) => transitionConnexion(e, ev));

  useEffect(() => {
    if (etat.etape === "connecte") {
      router.replace(suite);
      router.refresh();
    }
  }, [etat.etape, router, suite]);

  if (etat.etape === "code") {
    return <EtapeCode etat={etat} avancer={avancer} />;
  }
  return (
    <EtapeIdentifiants
      messageInitial={etat.etape === "identifiants" ? etat.message : null}
      connecte={etat.etape === "connecte"}
      avancer={avancer}
    />
  );
}

function EtapeIdentifiants({
  messageInitial,
  connecte,
  avancer,
}: {
  messageInitial: string | null;
  connecte: boolean;
  avancer: (ev: EvenementConnexion) => void;
}) {
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [afficherMdp, setAfficherMdp] = useState(false);
  const [erreurs, setErreurs] = useState<ErreursConnexion>({});
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(messageInitial);
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
      const corps = await api.post<unknown>(
        "/api/auth/connexion",
        { email: email.trim(), mot_de_passe: motDePasse },
        { redirigerSi401: false },
      );
      // Le mot de passe ne reste pas en mémoire au-delà de son envoi.
      setMotDePasse("");
      avancer({ type: "reponse_identifiants", corps });
    } catch (e) {
      setErreurGlobale(messageErreur(e));
      setMotDePasse("");
    } finally {
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
        texteChargement={connecte ? "Ouverture de votre espace…" : "Connexion en cours…"}
      >
        Se connecter
      </Bouton>
    </form>
  );
}

function EtapeCode({
  etat,
  avancer,
}: {
  etat: Extract<EtatConnexion, { etape: "code" }>;
  avancer: (ev: EvenementConnexion) => void;
}) {
  const [saisie, setSaisie] = useState("");
  const [erreurChamp, setErreurChamp] = useState<string | undefined>();
  const [enCours, setEnCours] = useState(false);
  // Chaque refus (même message répété) vide le champ et redonne le focus à l'alerte.
  const [refus, setRefus] = useState(0);
  const champ = useRef<HTMLInputElement>(null);
  const alerte = useRef<HTMLDivElement>(null);
  const secours = etat.facteur === "secours";

  useEffect(() => {
    setSaisie("");
    setErreurChamp(undefined);
    champ.current?.focus();
  }, [etat.facteur]);

  useEffect(() => {
    if (etat.message) {
      setSaisie("");
      alerte.current?.focus();
    }
  }, [etat.message, refus]);

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const v = validerFacteur(saisie, etat.facteur);
    if (!v.ok) {
      setErreurChamp(v.erreurs.code);
      champ.current?.focus();
      return;
    }
    setErreurChamp(undefined);
    setEnCours(true);
    try {
      await api.post("/api/auth/connexion/2fa", chargeConnexion2fa(etat.defi, v.charge), {
        redirigerSi401: false,
      });
      avancer({ type: "reponse_code" });
    } catch (e) {
      avancer({ type: "erreur_code", erreur: e });
      setRefus((n) => n + 1);
      setEnCours(false);
    }
  }

  return (
    <form
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-busy={enCours}
      aria-labelledby="titre-verification"
    >
      <h2 id="titre-verification" className="mp-section__titre">
        Vérification en deux étapes
      </h2>
      <p className="mp-texte-doux">
        {secours
          ? "Saisissez l'un des codes de secours remis lors de l'activation. Chaque code ne sert qu'une fois."
          : "Ouvrez votre application d'authentification et saisissez le code à 6 chiffres affiché pour MissionPilot."}
      </p>
      {etat.message ? (
        <Alerte ref={alerte} tonalite="danger" titre="Code refusé">
          <p>{etat.message}</p>
        </Alerte>
      ) : null}
      {secours ? (
        <Champ
          ref={champ}
          key="secours"
          libelle="Code de secours"
          name="code_secours"
          aide="Format : abcde-12345 (tirets et majuscules acceptés)."
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={40}
          required
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          erreur={erreurChamp}
        />
      ) : (
        <Champ
          ref={champ}
          key="totp"
          libelle="Code à 6 chiffres"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          spellCheck={false}
          required
          className="mp-champ-code"
          value={saisie}
          onChange={(e) => setSaisie(e.target.value.replace(/[^\d ]/g, ""))}
          erreur={erreurChamp}
        />
      )}
      <Bouton type="submit" pleineLargeur chargement={enCours} texteChargement="Vérification…">
        Valider
      </Bouton>
      <div className="mp-barre-actions">
        <Bouton variante="discret" onClick={() => avancer({ type: "changer_facteur" })}>
          {secours ? "Utiliser le code de l'application" : "Utiliser un code de secours"}
        </Bouton>
        <Bouton variante="discret" onClick={() => avancer({ type: "abandonner" })}>
          Revenir à la connexion
        </Bouton>
      </div>
    </form>
  );
}
