"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
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
    const trouvees = validerInvitation(saisie);
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
      setErreurGlobale(messageErreurInvitation(e));
      setEnCours(false);
    }
  }

  if (etat === "lecture") return <Squelette lignes={4} libelle="Lecture de l'invitation…" />;

  if (etat === "absent") {
    return (
      <div className="mp-formulaire">
        <Alerte tonalite="attention" titre="Lien d'invitation incomplet" annonce="alert">
          <p>
            Ouvrez le lien complet reçu par e-mail, sans le modifier. S&apos;il ne fonctionne
            toujours pas, demandez à un associé de votre cabinet de vous renvoyer une invitation.
          </p>
        </Alerte>
        <Link href="/connexion" className={classesBouton("secondaire", true)}>
          J&apos;ai déjà un compte : me connecter
        </Link>
      </div>
    );
  }

  const longueur = motDePasse.length;
  return (
    <form className="mp-formulaire" noValidate onSubmit={soumettre} aria-busy={enCours}>
      {erreurGlobale ? (
        <Alerte ref={refAlerte} tonalite="danger" titre="Création du compte impossible">
          <p>{erreurGlobale}</p>
        </Alerte>
      ) : null}
      <Champ
        ref={refNom}
        libelle="Nom complet"
        name="nom"
        autoComplete="name"
        required
        maxLength={120}
        value={nom}
        onChange={(e) => setNom(e.target.value)}
        erreur={erreurs.nom}
        aide="Tel qu'il apparaîtra à vos collègues, ex. Awa Koné."
      />
      <div className="mp-champ-mdp">
        <Champ
          ref={refMdp}
          libelle="Mot de passe"
          type={afficher ? "text" : "password"}
          name="mot_de_passe"
          autoComplete="new-password"
          required
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
          erreur={erreurs.motDePasse}
          aide={
            <>
              Au moins {MOT_DE_PASSE_MIN} caractères. Une phrase facile à retenir convient, ex. «
              Mon cabinet ouvre à 8 h ».{" "}
              <span className={longueur >= MOT_DE_PASSE_MIN ? "mp-indication-ok" : undefined}>
                {longueur >= MOT_DE_PASSE_MIN
                  ? `Longueur suffisante (${longueur} caractères).`
                  : `${longueur} caractères saisis sur ${MOT_DE_PASSE_MIN} requis.`}
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
          Afficher les mots de passe
        </Bouton>
      </div>
      <Champ
        ref={refConfirmation}
        libelle="Confirmez le mot de passe"
        type={afficher ? "text" : "password"}
        name="confirmation"
        autoComplete="new-password"
        required
        value={confirmation}
        onChange={(e) => setConfirmation(e.target.value)}
        erreur={erreurs.confirmation}
      />
      <Bouton
        type="submit"
        pleineLargeur
        chargement={enCours}
        texteChargement="Création du compte…"
      >
        Créer mon compte
      </Bouton>
    </form>
  );
}
