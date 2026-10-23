"use client";

import { useEffect, useRef, useState } from "react";
import { Alerte } from "../../components/ui/Alerte";
import {
  CHEMIN_PLATEFORME,
  connecterCompteDemo,
  connecterSuperAdminDemo,
  connexionCompteReussie,
  ETAT_DEMO_INITIAL,
  MESSAGE_DEMO_REPONSE_INATTENDUE,
  messageErreurDemo,
  transitionDemo,
  type Demo,
  type DemoCabinet,
  type DemoCompte,
  type EtatDemo,
  type EvenementDemo,
} from "../../lib/demo-connexion";
import { EtapeChoix, EtapeComptes, type OuvertureDemo } from "./EtapesDemo";
import "./comptes-demo.css";

/**
 * Mode démonstration : parcours en deux niveaux (espace, puis compte) qui ouvre une session en
 * un clic, sans rien saisir. Affiché seulement si l'API a servi la démonstration (`page.tsx`).
 *
 * - Compte de cabinet ou de portail : la réponse passe dans l'automate de la connexion normale
 *   (`surConnexion`), donc par sa redirection.
 * - Super administrateur : redirection pleine page vers la plateforme ; rien n'est stocké dans
 *   le navigateur ni placé dans l'URL.
 */
export function ConnexionDemo({
  demo,
  surConnexion,
}: {
  demo: Demo;
  /** Réponse vérifiée de l'API, transmise à l'automate de la connexion normale. */
  surConnexion: (corps: unknown) => void;
}) {
  const [etat, setEtat] = useState<EtatDemo>(ETAT_DEMO_INITIAL);
  const [ouverture, setOuverture] = useState<OuvertureDemo>(null);
  const [redirection, setRedirection] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState("");
  // Chaque refus (même message répété) redonne le focus à l'alerte.
  const [refus, setRefus] = useState(0);
  const alerte = useRef<HTMLDivElement>(null);
  const titre = useRef<HTMLHeadingElement>(null);
  const cartes = useRef(new Map<string, HTMLButtonElement>());
  const premierRendu = useRef(true);
  const occupe = ouverture !== null || redirection;
  const cabinet = etat.cabinetId ? demo.cabinets.find((c) => c.id === etat.cabinetId) : undefined;

  useEffect(() => {
    if (erreur) alerte.current?.focus();
  }, [erreur, refus]);

  // Au changement d'étape : focus sur le titre, ou sur la carte choisie au retour sur le choix.
  useEffect(() => {
    if (premierRendu.current) {
      premierRendu.current = false;
      return;
    }
    const carte = etat.etape === "choix" && etat.focus ? cartes.current.get(etat.focus) : null;
    (carte ?? titre.current)?.focus();
  }, [etat]);

  function naviguer(ev: EvenementDemo) {
    if (occupe) return;
    setErreur(null);
    setAnnonce("");
    setEtat((e) => transitionDemo(e, ev));
  }

  function echec(message: string) {
    setAnnonce("");
    setErreur(message);
    setRefus((n) => n + 1);
    setOuverture(null);
  }

  async function ouvrirCompte(cab: DemoCabinet, compte: DemoCompte) {
    if (occupe) return;
    setErreur(null);
    setOuverture({ type: "compte", email: compte.email });
    setAnnonce(`Connexion au compte de ${compte.nom} en cours…`);
    let corps: unknown;
    try {
      corps = await connecterCompteDemo(cab.id, compte.email);
    } catch (e) {
      return echec(messageErreurDemo(e));
    }
    if (!connexionCompteReussie(corps)) return echec(MESSAGE_DEMO_REPONSE_INATTENDUE);
    setAnnonce(`Session ouverte pour ${compte.nom}. Ouverture de votre espace…`);
    // La ligne reste en chargement jusqu'à la redirection.
    surConnexion(corps);
  }

  async function ouvrirSuperAdmin() {
    if (occupe || !demo.superAdmin) return;
    setErreur(null);
    setOuverture({ type: "super_admin" });
    setAnnonce(`Connexion de ${demo.superAdmin.nom} en cours…`);
    let reussie: boolean;
    try {
      reussie = await connecterSuperAdminDemo(demo.superAdmin.email);
    } catch (e) {
      return echec(messageErreurDemo(e));
    }
    if (!reussie) return echec(MESSAGE_DEMO_REPONSE_INATTENDUE);
    setRedirection(true);
    setAnnonce("Session ouverte. Ouverture de l'espace plateforme…");
    window.location.assign(CHEMIN_PLATEFORME);
  }

  return (
    <section className="mp-demo" aria-labelledby="titre-demo" aria-busy={occupe}>
      <h2 id="titre-demo" className="mp-demo__titre">
        Mode démonstration
      </h2>
      <p className="mp-texte-doux mp-demo__aide">
        Un clic ouvre la session du compte choisi, sans mot de passe.
      </p>
      {erreur ? (
        <Alerte ref={alerte} tonalite="danger" titre="Connexion impossible">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {etat.etape === "cabinet" && cabinet ? (
        <EtapeComptes
          cabinet={cabinet}
          occupe={occupe}
          ouverture={ouverture}
          refTitre={titre}
          surCompte={(compte) => void ouvrirCompte(cabinet, compte)}
          surRetour={() => naviguer({ type: "retour" })}
        />
      ) : (
        <EtapeChoix
          demo={demo}
          occupe={occupe}
          ouverture={ouverture}
          refTitre={titre}
          enregistrerCarte={(cle, el) => {
            if (el) cartes.current.set(cle, el);
            else cartes.current.delete(cle);
          }}
          surCabinet={(c) => naviguer({ type: "choisir_cabinet", cabinetId: c.id })}
          surSuperAdmin={() => void ouvrirSuperAdmin()}
        />
      )}
      <p className="mp-visuellement-cache" role="status" aria-live="polite">
        {annonce}
      </p>
    </section>
  );
}
