"use client";

import { useEffect, useRef, useState } from "react";
import { useLangue, useT } from "../../components/i18n/FournisseurLangue";
import { Alerte } from "../../components/ui/Alerte";
import {
  CHEMIN_PLATEFORME,
  connecterCompteDemo,
  connecterSuperAdminDemo,
  connexionCompteReussie,
  ETAT_DEMO_INITIAL,
  MESSAGE_DEMO_REPONSE_INATTENDUE,
  MESSAGE_DEMO_REPONSE_INATTENDUE_EN,
  messageErreurDemo,
  transitionDemo,
  type Demo,
  type DemoCabinet,
  type DemoCompte,
  type EtatDemo,
  type EvenementDemo,
} from "../../lib/demo-connexion";
import {
  filtreInitial,
  transitionFiltre,
  type EvenementFiltreDemo,
  type FiltreComptesDemo,
} from "../../lib/demo-connexion-comptes";
import { EtapeComptes } from "./EtapeComptesDemo";
import { EtapeChoix, type OuvertureDemo } from "./EtapesDemo";
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
  const t = useT();
  const langue = useLangue();
  const [etat, setEtat] = useState<EtatDemo>(ETAT_DEMO_INITIAL);
  const [filtre, setFiltre] = useState<FiltreComptesDemo>({ espace: "equipe", role: null });
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
    // Chaque cabinet s'ouvre sur son premier espace non vide, sans rôle retenu.
    if (ev.type === "choisir_cabinet") {
      const choisi = demo.cabinets.find((c) => c.id === ev.cabinetId);
      setFiltre(filtreInitial(choisi?.comptes ?? []));
    }
    setEtat((e) => transitionDemo(e, ev));
  }

  function filtrer(ev: EvenementFiltreDemo) {
    setFiltre((f) => transitionFiltre(f, ev));
    setAnnonce("");
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
    setAnnonce(
      t(`Connexion au compte de ${compte.nom} en cours…`, `Signing in to ${compte.nom}'s account…`),
    );
    let corps: unknown;
    try {
      corps = await connecterCompteDemo(cab.id, compte.email);
    } catch (e) {
      return echec(messageErreurDemo(e, langue));
    }
    if (!connexionCompteReussie(corps))
      return echec(t(MESSAGE_DEMO_REPONSE_INATTENDUE, MESSAGE_DEMO_REPONSE_INATTENDUE_EN));
    setAnnonce(
      t(
        `Session ouverte pour ${compte.nom}. Ouverture de votre espace…`,
        `Signed in as ${compte.nom}. Opening your workspace…`,
      ),
    );
    // La ligne reste en chargement jusqu'à la redirection.
    surConnexion(corps);
  }

  async function ouvrirSuperAdmin() {
    if (occupe || !demo.superAdmin) return;
    setErreur(null);
    setOuverture({ type: "super_admin" });
    setAnnonce(
      t(`Connexion de ${demo.superAdmin.nom} en cours…`, `Signing in ${demo.superAdmin.nom}…`),
    );
    let reussie: boolean;
    try {
      reussie = await connecterSuperAdminDemo(demo.superAdmin.email);
    } catch (e) {
      return echec(messageErreurDemo(e, langue));
    }
    if (!reussie)
      return echec(t(MESSAGE_DEMO_REPONSE_INATTENDUE, MESSAGE_DEMO_REPONSE_INATTENDUE_EN));
    setRedirection(true);
    setAnnonce(
      t(
        "Session ouverte. Ouverture de l'espace plateforme…",
        "Signed in. Opening the platform space…",
      ),
    );
    window.location.assign(CHEMIN_PLATEFORME);
  }

  return (
    <section className="mp-demo" aria-labelledby="titre-demo" aria-busy={occupe}>
      <h2 id="titre-demo" className="mp-demo__titre">
        {t("Mode démonstration", "Demo mode")}
      </h2>
      <p className="mp-texte-doux mp-demo__aide">
        {t(
          "Un clic ouvre la session du compte choisi, sans mot de passe.",
          "One click opens the chosen account's session, no password needed.",
        )}
      </p>
      {erreur ? (
        <Alerte
          ref={alerte}
          tonalite="danger"
          titre={t("Connexion impossible", "Unable to sign in")}
        >
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {etat.etape === "cabinet" && cabinet ? (
        <EtapeComptes
          cabinet={cabinet}
          filtre={filtre}
          surFiltre={filtrer}
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
