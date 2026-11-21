"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLangue, useT } from "../../components/i18n/FournisseurLangue";
import { Alerte } from "../../components/ui/Alerte";
import { Bouton, classesBouton } from "../../components/ui/Bouton";
import { Champ } from "../../components/ui/Champ";
import { Squelette } from "../../components/ui/Squelette";
import { api } from "../../lib/api";
import {
  chargeInvitation,
  lireJetonFragment,
  messageErreurInvitation,
  MOT_DE_PASSE_MIN,
  validerInvitation,
  type ErreursInvitation,
} from "../../lib/invitation";

type EtatJeton = "lecture" | "absent" | "present";

export function FormulaireInvitation() {
  const t = useT();
  const langue = useLangue();
  const [etat, setEtat] = useState<EtatJeton>("lecture");
  const jeton = useRef<string | null>(null);
  const [nom, setNom] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [afficher, setAfficher] = useState(false);
  const [erreurs, setErreurs] = useState<ErreursInvitation>({});
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const refAlerte = useRef<HTMLDivElement>(null);
  const refNom = useRef<HTMLInputElement>(null);
  const refMdp = useRef<HTMLInputElement>(null);
  const refConfirmation = useRef<HTMLInputElement>(null);

  useEffect(() => {
    jeton.current = lireJetonFragment(window.location.hash);
    // Retire le jeton de la barre d'adresse et de l'historique dès qu'il est lu.
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    setEtat(jeton.current ? "present" : "absent");
  }, []);

  useEffect(() => {
    if (erreurGlobale) refAlerte.current?.focus();
  }, [erreurGlobale]);

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setErreurGlobale(null);
    const saisie = { nom, motDePasse, confirmation };
    const trouvees = validerInvitation(saisie, langue);
    setErreurs(trouvees);
    if (trouvees.nom) return refNom.current?.focus();
    if (trouvees.motDePasse) return refMdp.current?.focus();
    if (trouvees.confirmation) return refConfirmation.current?.focus();
    if (!jeton.current) return setEtat("absent");

    setEnCours(true);
    try {
      await api.post("/api/invitations/accepter", chargeInvitation(jeton.current, saisie), {
        redirigerSi401: false,
      });
      // Rechargement complet : la session vient d'être ouverte par l'API (cookie httpOnly).
      window.location.assign("/");
    } catch (e) {
      setErreurGlobale(messageErreurInvitation(e, langue));
      setEnCours(false);
    }
  }

  if (etat === "lecture")
    return (
      <Squelette lignes={4} libelle={t("Lecture de l'invitation…", "Reading the invitation…")} />
    );

  if (etat === "absent") {
    return (
      <div className="mp-formulaire">
        <Alerte
          tonalite="attention"
          titre={t("Lien d'invitation incomplet", "Incomplete invitation link")}
          annonce="alert"
        >
          <p>
            {t(
              "Ouvrez le lien complet reçu par e-mail, sans le modifier. S'il ne fonctionne toujours pas, demandez à un associé de votre cabinet de vous renvoyer une invitation.",
              "Open the full link you received by email, without changing it. If it still does not work, ask a partner of your firm to send you a new invitation.",
            )}
          </p>
        </Alerte>
        <Link href="/connexion" className={classesBouton("secondaire", true)}>
          {t("J'ai déjà un compte : me connecter", "I already have an account: sign in")}
        </Link>
      </div>
    );
  }

  const longueur = motDePasse.length;
  return (
    <form className="mp-formulaire" noValidate onSubmit={soumettre} aria-busy={enCours}>
      {erreurGlobale ? (
        <Alerte
          ref={refAlerte}
          tonalite="danger"
          titre={t("Création du compte impossible", "Unable to create the account")}
        >
          <p>{erreurGlobale}</p>
        </Alerte>
      ) : null}
      <Champ
        ref={refNom}
        libelle={t("Nom complet", "Full name")}
        name="nom"
        autoComplete="name"
        required
        maxLength={120}
        value={nom}
        onChange={(e) => setNom(e.target.value)}
        erreur={erreurs.nom}
        aide={t(
          "Tel qu'il apparaîtra à vos collègues, ex. Awa Koné.",
          "As it will appear to your colleagues, e.g. Awa Koné.",
        )}
      />
      <div className="mp-champ-mdp">
        <Champ
          ref={refMdp}
          libelle={t("Mot de passe", "Password")}
          type={afficher ? "text" : "password"}
          name="mot_de_passe"
          autoComplete="new-password"
          required
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
          erreur={erreurs.motDePasse}
          aide={
            <>
              {t(
                `Au moins ${MOT_DE_PASSE_MIN} caractères. Une phrase facile à retenir convient, ex. « Mon cabinet ouvre à 8 h ».`,
                `At least ${MOT_DE_PASSE_MIN} characters. An easy-to-remember phrase works, e.g. "My firm opens at 8 am".`,
              )}{" "}
              <span className={longueur >= MOT_DE_PASSE_MIN ? "mp-indication-ok" : undefined}>
                {longueur >= MOT_DE_PASSE_MIN
                  ? t(
                      `Longueur suffisante (${longueur} caractères).`,
                      `Length is sufficient (${longueur} characters).`,
                    )
                  : t(
                      `${longueur} caractères saisis sur ${MOT_DE_PASSE_MIN} requis.`,
                      `${longueur} of ${MOT_DE_PASSE_MIN} required characters entered.`,
                    )}
              </span>
            </>
          }
        />
        <Bouton
          variante="discret"
          icone="oeil"
          className="mp-champ-mdp__bascule"
          aria-pressed={afficher}
          onClick={() => setAfficher((v) => !v)}
        >
          {t("Afficher les mots de passe", "Show passwords")}
        </Bouton>
      </div>
      <Champ
        ref={refConfirmation}
        libelle={t("Confirmez le mot de passe", "Confirm the password")}
        type={afficher ? "text" : "password"}
        name="confirmation"
        autoComplete="new-password"
        required
        value={confirmation}
        onChange={(e) => setConfirmation(e.target.value)}
        erreur={erreurs.confirmation}
        aide={
          confirmation.length > 0 && confirmation === motDePasse ? (
            <span className="mp-indication-ok">
              {t("Les mots de passe correspondent.", "The passwords match.")}
            </span>
          ) : undefined
        }
      />
      <Bouton
        type="submit"
        pleineLargeur
        chargement={enCours}
        texteChargement={t("Création du compte…", "Creating the account…")}
      >
        {t("Créer mon compte", "Create my account")}
      </Bouton>
    </form>
  );
}
