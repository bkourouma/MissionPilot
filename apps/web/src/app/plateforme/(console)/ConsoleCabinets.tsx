"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLangue, useT } from "../../../components/i18n/FournisseurLangue";
import { useRafraichir } from "../../../components/formulaires/useRafraichir";
import { ConfirmationAction } from "../../../components/plateforme/ConfirmationAction";
import { MotDePasseGenere } from "../../../components/plateforme/MotDePasseGenere";
import { Alerte } from "../../../components/ui/Alerte";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { Bouton, classesBouton } from "../../../components/ui/Bouton";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { Champ } from "../../../components/ui/Champ";
import { EtatVide } from "../../../components/ui/EtatListe";
import { Select } from "../../../components/ui/Select";
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
  filtrerCabinets,
  libelleComptePremierAssocie,
  SEUIL_FILTRES_CABINETS,
  type FiltreEtatCabinet,
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
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
  const [formulaireOuvert, setFormulaireOuvert] = useState(false);
  const [succes, setSucces] = useState<string | null>(null);
  const [secret, setSecret] = useState<SecretAffiche | null>(null);
  const [aConfirmer, setAConfirmer] = useState<CabinetListe | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreurEtat, setErreurEtat] = useState<string | null>(null);
  const [recherche, setRecherche] = useState("");
  const [filtreEtat, setFiltreEtat] = useState<FiltreEtatCabinet>("tous");
  const visibles = useMemo(
    () => filtrerCabinets(cabinets, recherche, filtreEtat),
    [cabinets, recherche, filtreEtat],
  );
  const filtresAffiches = cabinets.length >= SEUIL_FILTRES_CABINETS;
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
        compte: libelleComptePremierAssocie(creation.cabinet.nom, creation.associe, langue),
      });
    } else {
      setSecret(null);
      setRetourFocus((n) => n + 1);
      setSucces(
        t(
          `Le cabinet ${creation.cabinet.nom} a été créé. Son premier associé, ${creation.associe.nom} (${creation.associe.email}), se connecte avec le mot de passe que vous avez saisi.`,
          `The firm ${creation.cabinet.nom} has been created. Its first partner, ${creation.associe.nom} (${creation.associe.email}), signs in with the password you entered.`,
        ),
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
    const texte = texteActionEtat(aConfirmer, langue);
    setEnCours(true);
    setErreurEtat(null);
    try {
      await changerEtatCabinet(aConfirmer.id, texte.actif);
      setAConfirmer(null);
      setRetourFocus((n) => n + 1);
      setSucces(texte.succes);
      rafraichir();
    } catch (e) {
      setErreurEtat(messageErreurPlateforme(e, langue));
    } finally {
      setEnCours(false);
    }
  }

  const colonnes: ColonneTableau<CabinetListe>[] = [
    {
      cle: "nom",
      entete: t("Cabinet", "Firm"),
      rendu: (c) => (
        <span className="mp-console__nom">
          <Link href={cheminCabinetPlateforme(c.id)}>{c.nom}</Link>
          {c.estDemo ? (
            <BadgeStatut tonalite="attention" sansIcone>
              {t("Démo", "Demo")}
            </BadgeStatut>
          ) : null}
        </span>
      ),
    },
    { cle: "pays", entete: t("Pays", "Country"), rendu: (c) => libellePays(c.pays, langue) },
    {
      cle: "etat",
      entete: t("État", "Status"),
      rendu: (c) =>
        c.actif ? (
          <BadgeStatut tonalite="succes">{t("Actif", "Active")}</BadgeStatut>
        ) : (
          <BadgeStatut tonalite="neutre">{t("Désactivé", "Deactivated")}</BadgeStatut>
        ),
    },
    {
      cle: "utilisateurs",
      entete: t("Utilisateurs", "Users"),
      rendu: (c) => libelleUtilisateursCabinet(c, langue),
    },
    {
      cle: "creeLe",
      entete: t("Créé le", "Created on"),
      rendu: (c) => formaterDate(c.creeLe, "UTC", langue),
    },
    {
      cle: "actions",
      entete: t("Actions", "Actions"),
      rendu: (c) => {
        const texte = texteActionEtat(c, langue);
        return (
          <span className="mp-console__actions">
            <Link
              href={cheminCabinetPlateforme(c.id)}
              className={classesBouton("secondaire")}
              aria-label={t(
                `Gérer les comptes du cabinet ${c.nom}`,
                `Manage the accounts of the firm ${c.nom}`,
              )}
            >
              {t("Gérer les comptes", "Manage accounts")}
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

  const texteConfirmation = aConfirmer ? texteActionEtat(aConfirmer, langue) : null;

  return (
    <div className="mp-page mp-console">
      <EnteteDePage
        titre={t("Cabinets", "Firms")}
        soustitre={t(
          "Créez des cabinets et gérez leurs comptes. Cette console n'accède à aucune donnée de mission ou de facturation.",
          "Create firms and manage their accounts. This console has no access to any engagement or billing data.",
        )}
        actions={
          <Bouton
            icone="plus"
            ref={boutonCreer}
            disabled={secret !== null}
            onClick={ouvrirFormulaire}
          >
            {t("Créer un cabinet", "Create a firm")}
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
          titre={t("Aucun cabinet pour le moment.", "No firms yet.")}
          icone="immeuble"
          action={
            formulaireOuvert ? null : (
              <Bouton icone="plus" disabled={secret !== null} onClick={ouvrirFormulaire}>
                {t("Créer le premier cabinet", "Create the first firm")}
              </Bouton>
            )
          }
        >
          <p>
            {t(
              "Créez un cabinet et son premier associé pour qu'il puisse se connecter.",
              "Create a firm and its first partner so they can sign in.",
            )}
          </p>
        </EtatVide>
      ) : (
        <>
          {filtresAffiches ? (
            <div className="mp-console__filtres" role="search">
              <Champ
                libelle={t("Rechercher un cabinet", "Search for a firm")}
                type="search"
                name="recherche"
                autoComplete="off"
                spellCheck={false}
                placeholder={t("Nom du cabinet", "Firm name")}
                value={recherche}
                onChange={(e) => setRecherche(e.target.value)}
              />
              <Select
                libelle={t("État", "Status")}
                name="etat"
                value={filtreEtat}
                onChange={(e) => setFiltreEtat(e.target.value as FiltreEtatCabinet)}
                options={[
                  { valeur: "tous", libelle: t("Tous", "All") },
                  { valeur: "actifs", libelle: t("Actifs", "Active") },
                  { valeur: "desactives", libelle: t("Désactivés", "Deactivated") },
                ]}
              />
              <p className="mp-texte-doux mp-console__compte" role="status" aria-live="polite">
                {t(
                  `${visibles.length} cabinet(s) sur ${cabinets.length}`,
                  `${visibles.length} of ${cabinets.length} firm(s)`,
                )}
              </p>
            </div>
          ) : null}
          {visibles.length === 0 ? (
            <EtatVide
              titre={t("Aucun cabinet ne correspond.", "No firm matches.")}
              icone="recherche"
              action={
                <Bouton
                  variante="secondaire"
                  onClick={() => {
                    setRecherche("");
                    setFiltreEtat("tous");
                  }}
                >
                  {t("Réinitialiser les filtres", "Reset filters")}
                </Bouton>
              }
            >
              <p>
                {t("Modifiez la recherche ou l'état choisi.", "Change the search or the status.")}
              </p>
            </EtatVide>
          ) : (
            <Tableau
              legende={t("Liste des cabinets", "List of firms")}
              colonnes={colonnes}
              lignes={visibles}
              cleLigne={(c) => c.id}
            />
          )}
        </>
      )}
    </div>
  );
}
