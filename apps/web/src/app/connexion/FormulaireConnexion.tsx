"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alerte } from "../../components/ui/Alerte";
import { Bouton } from "../../components/ui/Bouton";
import { useLangue, useT } from "../../components/i18n/FournisseurLangue";
import { Champ } from "../../components/ui/Champ";
import { api, ErreurApi } from "../../lib/api";
import { validerConnexion, type ErreursConnexion } from "../../lib/connexion";
import type { Demo } from "../../lib/demo-connexion";
import { destinationApresConnexion } from "../../lib/portail-routes";
import { ConnexionDemo } from "./ConnexionDemo";
import type { Langue } from "@missionpilot/shared";
import {
  chargeConnexion2fa,
  ETAT_INITIAL,
  messageErreurLangue,
  transitionConnexion,
  validerFacteur,
  type EtatConnexion,
  type EvenementConnexion,
} from "../../lib/double-authentification";

/** Message affiché pour une erreur de l'API ; l'API fournit déjà des messages traduits. */
function messageErreur(e: unknown, langue: Langue): string {
  if (!(e instanceof ErreurApi)) return messageErreurLangue(e, langue);
  if (e.code === "REQUETE_INVALIDE")
    return langue === "en"
      ? "Check the email address and password you entered."
      : "Vérifiez l'adresse e-mail et le mot de passe saisis.";
  return messageErreurLangue(e, langue);
}

/**
 * Connexion en deux temps : identifiants, puis code de la double authentification si l'API
 * le demande. Le défi reste dans l'état mémoire de ce composant (jamais dans l'URL ni le
 * stockage du navigateur) et disparaît dès la connexion, l'abandon ou son expiration.
 *
 * `demo` (seulement si l'API a servi la démonstration) : le parcours en un clic passe par le
 * même automate, donc par la même redirection que la connexion normale ; le formulaire reste
 * disponible, replié sous le bloc de démonstration.
 */
export function FormulaireConnexion({ suite, demo = null }: { suite: string; demo?: Demo | null }) {
  const router = useRouter();
  const t = useT();
  const langue = useLangue();
  const [etat, setEtat] = useState<EtatConnexion>(ETAT_INITIAL);
  const avancer = (ev: EvenementConnexion) => setEtat((e) => transitionConnexion(e, ev, langue));

  useEffect(() => {
    if (etat.etape !== "connecte") return;
    let actif = true;
    // L'espace dépend du compte : portail client ou application du cabinet. En cas d'échec,
    // le chemin demandé est ouvert tel quel : la garde serveur oriente ensuite l'utilisateur.
    api
      .get<{ portail?: unknown }>("/api/auth/moi", { redirigerSi401: false })
      .then((moi) => destinationApresConnexion(suite, moi.portail === true))
      .catch(() => suite)
      .then((destination) => {
        if (!actif) return;
        router.replace(destination);
        router.refresh();
      });
    return () => {
      actif = false;
    };
  }, [etat.etape, router, suite]);

  if (etat.etape === "code") {
    return <EtapeCode etat={etat} avancer={avancer} />;
  }
  const messageInitial = etat.etape === "identifiants" ? etat.message : null;
  const connecte = etat.etape === "connecte";
  const formulaire = (
    <EtapeIdentifiants messageInitial={messageInitial} connecte={connecte} avancer={avancer} />
  );
  // Démonstration inactive : le formulaire seul, comme avant. Démonstration active : le bloc reste
  // monté pendant l'ouverture de session (la ligne cliquée garde son état de chargement).
  if (!demo) return formulaire;
  const aDesComptes = demo.superAdmin !== null || demo.cabinets.length > 0;
  return (
    <>
      <ConnexionDemo
        demo={demo}
        surConnexion={(corps) => avancer({ type: "reponse_identifiants", corps })}
      />
      <details className="mp-connexion__classique" open={!aDesComptes || messageInitial !== null}>
        <summary>
          {t(
            "Se connecter avec une adresse e-mail et un mot de passe",
            "Sign in with an email address and password",
          )}
        </summary>
        {formulaire}
      </details>
    </>
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
  const t = useT();
  const langue = useLangue();
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
    const trouvees = validerConnexion({ email, motDePasse }, langue);
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
      setErreurGlobale(messageErreur(e, langue));
      setMotDePasse("");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <form className="mp-formulaire" noValidate onSubmit={soumettre} aria-busy={enCours}>
      {erreurGlobale ? (
        <Alerte
          ref={alerte}
          tonalite="danger"
          titre={t("Connexion impossible", "Unable to sign in")}
        >
          <p>{erreurGlobale}</p>
        </Alerte>
      ) : null}
      <Champ
        ref={champEmail}
        libelle={t("Adresse e-mail", "Email address")}
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
          libelle={t("Mot de passe", "Password")}
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
          {t("Afficher le mot de passe", "Show password")}
        </Bouton>
      </div>
      <Bouton
        type="submit"
        pleineLargeur
        chargement={enCours || connecte}
        texteChargement={
          connecte
            ? t("Ouverture de votre espace…", "Opening your workspace…")
            : t("Connexion en cours…", "Signing in…")
        }
      >
        {t("Se connecter", "Sign in")}
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
  const t = useT();
  const langue = useLangue();
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
    const v = validerFacteur(saisie, etat.facteur, langue);
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
        {t("Vérification en deux étapes", "Two-step verification")}
      </h2>
      <p className="mp-texte-doux">
        {secours
          ? t(
              "Saisissez l'un des codes de secours remis lors de l'activation. Chaque code ne sert qu'une fois.",
              "Enter one of the backup codes given to you at activation. Each code can only be used once.",
            )
          : t(
              "Ouvrez votre application d'authentification et saisissez le code à 6 chiffres affiché pour CabinetPilot.",
              "Open your authenticator app and enter the 6-digit code shown for CabinetPilot.",
            )}
      </p>
      {etat.message ? (
        <Alerte ref={alerte} tonalite="danger" titre={t("Code refusé", "Code rejected")}>
          <p>{etat.message}</p>
        </Alerte>
      ) : null}
      {secours ? (
        <Champ
          ref={champ}
          key="secours"
          libelle={t("Code de secours", "Backup code")}
          name="code_secours"
          aide={t(
            "Format : abcde-12345 (tirets et majuscules acceptés).",
            "Format: abcde-12345 (hyphens and capital letters accepted).",
          )}
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
          libelle={t("Code à 6 chiffres", "6-digit code")}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          spellCheck={false}
          required
          aide={t("Le code change toutes les 30 secondes.", "The code changes every 30 seconds.")}
          className="mp-champ-code"
          value={saisie}
          onChange={(e) => setSaisie(e.target.value.replace(/[^\d ]/g, ""))}
          erreur={erreurChamp}
        />
      )}
      <Bouton
        type="submit"
        pleineLargeur
        chargement={enCours}
        texteChargement={t("Vérification…", "Verifying…")}
      >
        {t("Valider", "Verify")}
      </Bouton>
      <div className="mp-barre-actions">
        <Bouton variante="discret" onClick={() => avancer({ type: "changer_facteur" })}>
          {secours
            ? t("Utiliser le code de l'application", "Use the app code")
            : t("Utiliser un code de secours", "Use a backup code")}
        </Bouton>
        <Bouton variante="discret" onClick={() => avancer({ type: "abandonner" })}>
          {t("Revenir à la connexion", "Back to sign in")}
        </Bouton>
      </div>
    </form>
  );
}
