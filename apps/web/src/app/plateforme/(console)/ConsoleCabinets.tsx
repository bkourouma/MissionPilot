"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRafraichir } from "../../../components/formulaires/useRafraichir";
import { ConfirmationAction } from "../../../components/plateforme/ConfirmationAction";
import { MotDePasseGenere } from "../../../components/plateforme/MotDePasseGenere";
import { Alerte } from "../../../components/ui/Alerte";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { Bouton, classesBouton } from "../../../components/ui/Bouton";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatVide } from "../../../components/ui/EtatListe";
import { Tableau, type ColonneTableau } from "../../../components/ui/Tableau";
import { formaterDate } from "../../../lib/format";
import {
  libellePays,
  messageErreurPlateforme,
  type CabinetListe,
  type CreationCabinet,
} from "../../../lib/plateforme";
import { changerEtatCabinet } from "../../../lib/plateforme-client";
import { cheminCabinetPlateforme } from "../../../lib/plateforme-routes";
import {
  libelleComptePremierAssocie,
  libelleUtilisateursCabinet,
  texteActionEtat,
} from "./console-logique";
import { FormulaireCreationCabinet } from "./FormulaireCreationCabinet";

interface SecretAffiche {
  motDePasse: string;
  compte: string;
}

/**
 * Liste des cabinets et actions (créer, activer, désactiver). Les données viennent du serveur
 * (props) ; après une écriture, `rafraichir()` les recharge. Le mot de passe généré reste dans
 * l'état de ce composant uniquement, jusqu'à « J'ai noté le mot de passe ».
 */
export function ConsoleCabinets({ cabinets }: { cabinets: readonly CabinetListe[] }) {
  const { rafraichir } = useRafraichir();
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [succes, setSucces] = useState<string | null>(null);
  const [secret, setSecret] = useState<SecretAffiche | null>(null);
  const [aConfirmer, setAConfirmer] = useState<CabinetListe | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreurEtat, setErreurEtat] = useState<string | null>(null);
  // Rend le focus au bouton de création quand un panneau se ferme (sinon il tombe sur <body>).
  const boutonCreer = useRef<HTMLButtonElement>(null);
  const [retourFocus, setRetourFocus] = useState(0);
  useEffect(() => {
    if (retourFocus > 0) boutonCreer.current?.focus();
  }, [retourFocus]);

  function ouvrirFormulaire() {
    setSucces(null);
    setAConfirmer(null);
    setFormulaireOuvert(true);
  }

  function apresCreation(creation: CreationCabinet) {
    setFormulaireOuvert(false);
    if (creation.motDePasseGenere !== null) {
      setSucces(null);
      setSecret({
        motDePasse: creation.motDePasseGenere,
        compte: libelleComptePremierAssocie(creation.cabinet.nom, creation.associe),
      });
    } else {
      setSecret(null);
      setRetourFocus((n) => n + 1);
      setSucces(
        `Le cabinet ${creation.cabinet.nom} a été créé. Son premier associé, ${creation.associe.nom} (${creation.associe.email}), se connecte avec le mot de passe que vous avez saisi.`,
      );
    }
    rafraichir();
  }

  function demanderChangement(cabinet: CabinetListe) {
    setSucces(null);
    setErreurEtat(null);
    setAConfirmer(cabinet);
  }

  async function confirmerChangement() {
    if (!aConfirmer) return;
    const texte = texteActionEtat(aConfirmer);
    setEnCours(true);
    setErreurEtat(null);
    try {
      await changerEtatCabinet(aConfirmer.id, texte.actif);
      setAConfirmer(null);
      setRetourFocus((n) => n + 1);
      setSucces(texte.succes);
      rafraichir();
    } catch (e) {
      setErreurEtat(messageErreurPlateforme(e));
    } finally {
      setEnCours(false);
    }
  }

  const colonnes: ColonneTableau<CabinetListe>[] = [
    {
      cle: "nom",
      entete: "Cabinet",
      rendu: (c) => (
        <span className="mp-console__nom">
          <Link href={cheminCabinetPlateforme(c.id)}>{c.nom}</Link>
          {c.estDemo ? (
            <BadgeStatut tonalite="attention" sansIcone>
              Démo
            </BadgeStatut>
          ) : null}
        </span>
      ),
    },
    { cle: "pays", entete: "Pays", rendu: (c) => libellePays(c.pays) },
    {
      cle: "etat",
      entete: "État",
      rendu: (c) =>
        c.actif ? (
          <BadgeStatut tonalite="succes">Actif</BadgeStatut>
        ) : (
          <BadgeStatut tonalite="neutre">Désactivé</BadgeStatut>
        ),
    },
    { cle: "utilisateurs", entete: "Utilisateurs", rendu: libelleUtilisateursCabinet },
    { cle: "creeLe", entete: "Créé le", rendu: (c) => formaterDate(c.creeLe) },
    {
      cle: "actions",
      entete: "Actions",
      rendu: (c) => {
        const texte = texteActionEtat(c);
        return (
          <span className="mp-console__actions">
            <Link
              href={cheminCabinetPlateforme(c.id)}
              className={classesBouton("secondaire")}
              aria-label={`Gérer les comptes du cabinet ${c.nom}`}
            >
              Gérer les comptes
            </Link>
            <Bouton
              variante={c.actif ? "danger" : "secondaire"}
              aria-label={texte.nomAccessible}
              onClick={() => demanderChangement(c)}
            >
              {texte.bouton}
            </Bouton>
          </span>
        );
      },
    },
  ];

  const texteConfirmation = aConfirmer ? texteActionEtat(aConfirmer) : null;

  return (
    <div className="mp-page mp-console">
      <EnteteDePage
        titre="Cabinets"
        soustitre="Créez des cabinets et gérez leurs comptes. Cette console n'accède à aucune donnée de mission ou de facturation."
        actions={
          <Bouton
            icone="plus"
            ref={boutonCreer}
            disabled={secret !== null}
            onClick={ouvrirFormulaire}
          >
            Créer un cabinet
          </Bouton>
        }
      />

      <div role="status" aria-live="polite">
        {succes ? (
          <Alerte tonalite="succes" annonce="aucune">
            <p>{succes}</p>
          </Alerte>
        ) : null}
      </div>

      {secret ? (
        <MotDePasseGenere
          motDePasse={secret.motDePasse}
          compte={secret.compte}
          surTermine={() => {
            setSecret(null);
            setRetourFocus((n) => n + 1);
          }}
        />
      ) : null}

      {formulaireOuvert ? (
        <FormulaireCreationCabinet
          surCree={apresCreation}
          surAnnuler={() => {
            setFormulaireOuvert(false);
            setRetourFocus((n) => n + 1);
          }}
        />
      ) : null}

      {aConfirmer && texteConfirmation ? (
        <div className="mp-console__confirmation">
          <ConfirmationAction
            titre={texteConfirmation.titre}
            libelleConfirmer={texteConfirmation.confirmer}
            danger={aConfirmer.actif}
            enCours={enCours}
            erreur={erreurEtat}
            surConfirmer={() => void confirmerChangement()}
            surAnnuler={() => {
              setAConfirmer(null);
              setErreurEtat(null);
              setRetourFocus((n) => n + 1);
            }}
          >
            <p>{texteConfirmation.consequences}</p>
          </ConfirmationAction>
        </div>
      ) : null}

      {cabinets.length === 0 ? (
        <EtatVide
          titre="Aucun cabinet pour le moment."
          icone="immeuble"
          action={
            formulaireOuvert ? null : (
              <Bouton icone="plus" disabled={secret !== null} onClick={ouvrirFormulaire}>
                Créer le premier cabinet
              </Bouton>
            )
          }
        >
          <p>Créez un cabinet et son premier associé pour qu&apos;il puisse se connecter.</p>
        </EtatVide>
      ) : (
        <Tableau
          legende="Liste des cabinets"
          colonnes={colonnes}
          lignes={cabinets}
          cleLigne={(c) => c.id}
        />
      )}
    </div>
  );
}
