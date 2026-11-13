"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { Bouton, classesBouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Icone } from "../ui/Icone";
import { Squelette } from "../ui/Squelette";
import { api } from "../../lib/api";
import {
  chargeInvitation,
  lireJetonFragment,
  validerInvitation,
  type ErreursInvitation,
} from "../../lib/invitation";
import { messageErreurInvitationPortail, reglesMotDePasse } from "../../lib/portail";
import { CHEMIN_PORTAIL } from "../../lib/portail-routes";

type EtatJeton = "lecture" | "absent" | "present";

/**
 * Acceptation d'une invitation au portail : nom et mot de passe (règles affichées). Le jeton
 * est lu dans le fragment puis retiré de l'URL ; il ne vit que dans la mémoire de ce composant
 * (jamais dans le stockage du navigateur) et part dans le corps de la requête.
 */
export function FormulaireInvitationPortail() {
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
  const [cree, setCree] = useState(false);
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
      await api.post("/api/portail/invitations/accepter", chargeInvitation(jeton.current, saisie), {
        redirigerSi401: false,
      });
      // Le jeton est consommé : il ne sert plus, on l'oublie avec les mots de passe.
      jeton.current = null;
      setMotDePasse("");
      setConfirmation("");
      setCree(true);
      // Rechargement complet : la session vient d'être ouverte par l'API (cookie httpOnly).
      window.location.assign(CHEMIN_PORTAIL);
    } catch (e) {
      setErreurGlobale(messageErreurInvitationPortail(e, langue));
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
              "Ouvrez le lien complet reçu par e-mail, sans le modifier. S'il ne fonctionne toujours pas, demandez à votre interlocuteur au cabinet de vous envoyer une nouvelle invitation.",
              "Open the full link you received by email, without changing it. If it still does not work, ask your contact person at the firm to send you a new invitation.",
            )}
          </p>
        </Alerte>
        <Link href="/connexion?suite=%2Fportail" className={classesBouton("secondaire", true)}>
          {t("J'ai déjà un accès : me connecter", "I already have access: sign in")}
        </Link>
      </div>
    );
  }

  const regles = reglesMotDePasse(motDePasse, confirmation, langue);
  return (
    <form className="mp-formulaire" noValidate onSubmit={soumettre} aria-busy={enCours}>
      {erreurGlobale ? (
        <Alerte
          ref={refAlerte}
          tonalite="danger"
          titre={t("Création de l'accès impossible", "Unable to create access")}
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
          "Tel qu'il apparaîtra à l'équipe du cabinet, ex. Awa Koné.",
          "As it will appear to the firm's team, e.g. Awa Koné.",
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
          maxLength={200}
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
          erreur={erreurs.motDePasse}
          aide={t(
            "Une phrase facile à retenir convient, ex. « Notre usine ouvre à 7 h ».",
            'An easy-to-remember phrase works, e.g. "Our factory opens at 7 am".',
          )}
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
        maxLength={200}
        value={confirmation}
        onChange={(e) => setConfirmation(e.target.value)}
        erreur={erreurs.confirmation}
      />
      <div>
        <p className="mp-champ__libelle" id="regles-mot-de-passe">
          {t("Règles du mot de passe", "Password rules")}
        </p>
        <ul className="mp-portail-regles" aria-labelledby="regles-mot-de-passe">
          {regles.map((r) => (
            <li key={r.id} className={r.respectee ? "mp-portail-regles__ok" : undefined}>
              <Icone nom={r.respectee ? "succes" : "neutre"} taille={16} />
              <span>
                {r.texte}
                <span className="mp-visuellement-cache">
                  {r.respectee
                    ? t(" : respectée", ": met")
                    : t(" : pas encore respectée", ": not met yet")}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <Bouton
        type="submit"
        pleineLargeur
        chargement={enCours || cree}
        texteChargement={
          cree
            ? t("Ouverture de votre espace…", "Opening your space…")
            : t("Création de votre accès…", "Creating your access…")
        }
      >
        {t("Créer mon accès", "Create my access")}
      </Bouton>
      <p className="mp-texte-doux mp-texte-petit">
        {t(
          "Ce lien est personnel : ne le transférez pas. Vous ne verrez que les informations que votre cabinet choisit de partager avec votre entreprise.",
          "This link is personal: do not forward it. You will only see the information your firm chooses to share with your company.",
        )}
      </p>
    </form>
  );
}
