"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRafraichir } from "../../../../../components/formulaires/useRafraichir";
import { ConfirmationAction } from "../../../../../components/plateforme/ConfirmationAction";
import { MotDePasseGenere } from "../../../../../components/plateforme/MotDePasseGenere";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Bouton } from "../../../../../components/ui/Bouton";
import { Carte } from "../../../../../components/ui/Carte";
import { Champ } from "../../../../../components/ui/Champ";
import { GroupeCases } from "../../../../../components/ui/CaseACocher";
import { Tableau, type ColonneTableau } from "../../../../../components/ui/Tableau";
import {
  libelleRolesCabinet,
  messageErreurPlateforme,
  ROLES_PROPOSES,
  validerRoles,
  validerUtilisateur,
  type CabinetListe,
  type ErreursUtilisateur,
  type SaisieUtilisateur,
  type UtilisateurPlateforme,
} from "../../../../../lib/plateforme";
import { creerUtilisateur, modifierUtilisateur } from "../../../../../lib/plateforme-client";
import {
  ariaActionEtat,
  ariaModifierRoles,
  cleBouton,
  clePanneau,
  libelleActionEtat,
  libelleCompte,
  libelleEtatUtilisateur,
  messageSuccesEtat,
  ouvrirConfirmationEtat,
  ouvrirEditeurRoles,
  rolesIdentiques,
  SUCCES_ROLES_MIS_A_JOUR,
  SUCCES_UTILISATEUR_AJOUTE,
  texteConfirmationEtat,
  type Panneau,
} from "./gestion-utilisateurs";
import "./utilisateurs.css";

export interface GestionUtilisateursProps {
  cabinet: Pick<CabinetListe, "id" | "nom" | "actif">;
  utilisateurs: readonly UtilisateurPlateforme[];
  /** Formulaire d'ajout déjà ouvert au premier rendu (tests de rendu). */
  ajoutOuvertInitial?: boolean;
}

const SAISIE_VIDE: SaisieUtilisateur = { nom: "", email: "", roles: [], motDePasse: "" };
const ID_FORMULAIRE = "formulaire-ajout-utilisateur";
const OPTIONS_ROLES = ROLES_PROPOSES.map((r) => ({ valeur: r.valeur, libelle: r.libelle }));

interface Secret {
  motDePasse: string;
  compte: string;
}

/** Utilisateurs d'un cabinet : liste, ajout, modification des rôles, activation et désactivation. */
export function GestionUtilisateurs({
  cabinet,
  utilisateurs,
  ajoutOuvertInitial = false,
}: GestionUtilisateursProps) {
  const { rafraichir } = useRafraichir();
  const [enCours, setEnCours] = useState(false);
  const [succes, setSucces] = useState<string | null>(null);
  const [secret, setSecret] = useState<Secret | null>(null);

  const [ajoutOuvert, setAjoutOuvert] = useState(ajoutOuvertInitial);
  const [saisie, setSaisie] = useState<SaisieUtilisateur>(SAISIE_VIDE);
  const [erreurs, setErreurs] = useState<ErreursUtilisateur>({});
  const [erreurAjout, setErreurAjout] = useState<string | null>(null);
  const [mdpVisible, setMdpVisible] = useState(false);

  const [panneau, setPanneau] = useState<Panneau | null>(null);
  const [tentative, setTentative] = useState(0);

  const boutons = useRef(new Map<string, HTMLButtonElement>());
  const retourFocus = useRef<string | null>(null);
  const champNom = useRef<HTMLInputElement>(null);
  const formulaire = useRef<HTMLFormElement>(null);
  const alerteAjout = useRef<HTMLDivElement>(null);
  const zoneRoles = useRef<HTMLDivElement>(null);
  const alerteRoles = useRef<HTMLDivElement>(null);

  const refBouton = (cle: string) => (el: HTMLButtonElement | null) => {
    if (el) boutons.current.set(cle, el);
    else boutons.current.delete(cle);
  };

  // Ouverture du formulaire d'ajout : focus sur le premier champ.
  useEffect(() => {
    if (ajoutOuvert) champNom.current?.focus();
  }, [ajoutOuvert]);

  // Après fermeture d'un formulaire ou d'un panneau : retour sur le bouton d'origine.
  useEffect(() => {
    const cle = retourFocus.current;
    if (!cle) return;
    retourFocus.current = null;
    const bouton = boutons.current.get(cle);
    if (bouton && !bouton.disabled) bouton.focus();
    // Bouton d'ajout verrouillé par un mot de passe à noter : le focus va sur ce mot de passe.
    else if (cle === cleBouton.ajout) document.getElementById("mdp-genere-valeur")?.focus();
  });

  // Ouverture de l'éditeur de rôles : focus sur la première case.
  const idEditeur = panneau?.type === "roles" ? panneau.utilisateurId : null;
  useEffect(() => {
    if (idEditeur) zoneRoles.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [idEditeur]);

  // Erreur de validation ou d'envoi : focus sur l'alerte, sinon sur le premier champ en erreur.
  useEffect(() => {
    if (tentative === 0) return;
    if (erreurAjout) {
      alerteAjout.current?.focus();
      return;
    }
    if (panneau?.type === "roles") {
      if (panneau.roles.length > 0) alerteRoles.current?.focus();
      else zoneRoles.current?.querySelector<HTMLInputElement>("input")?.focus();
      return;
    }
    formulaire.current
      ?.querySelector<HTMLElement>(
        'input[aria-invalid="true"], fieldset[aria-invalid="true"] input',
      )
      ?.focus();
    // Déclenché par `tentative` seulement : les autres valeurs sont lues à cet instant.
  }, [tentative]);

  const utilisateurPanneau = panneau
    ? utilisateurs.find((u) => u.id === panneau.utilisateurId)
    : undefined;

  function fermerPanneau(retour?: string) {
    if (retour) retourFocus.current = retour;
    setPanneau(null);
  }

  function fermerAjout() {
    setAjoutOuvert(false);
    setSaisie(SAISIE_VIDE);
    setErreurs({});
    setErreurAjout(null);
    setMdpVisible(false);
    retourFocus.current = cleBouton.ajout;
  }

  function ouvrirPanneau(p: Panneau) {
    setSucces(null);
    setAjoutOuvert(false);
    setPanneau(p);
  }

  async function ajouter(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (enCours) return;
    setSucces(null);
    setErreurAjout(null);
    const e = validerUtilisateur(saisie);
    if (Object.keys(e).length > 0) {
      setErreurs(e);
      setTentative((t) => t + 1);
      return;
    }
    setErreurs({});
    setEnCours(true);
    try {
      const r = await creerUtilisateur(cabinet.id, saisie);
      setSecret(
        r.motDePasseGenere
          ? { motDePasse: r.motDePasseGenere, compte: libelleCompte(r.utilisateur) }
          : null,
      );
      fermerAjout();
      setSucces(SUCCES_UTILISATEUR_AJOUTE);
      rafraichir();
    } catch (err) {
      setErreurAjout(messageErreurPlateforme(err));
      setTentative((t) => t + 1);
    } finally {
      setEnCours(false);
    }
  }

  async function enregistrerRoles() {
    if (enCours || panneau?.type !== "roles" || !utilisateurPanneau) return;
    const cle = clePanneau(panneau);
    const manque = validerRoles(panneau.roles);
    if (manque) {
      setPanneau({ ...panneau, erreur: manque });
      setTentative((t) => t + 1);
      return;
    }
    if (rolesIdentiques(panneau.roles, utilisateurPanneau.roles)) {
      fermerPanneau(cle);
      return;
    }
    setSucces(null);
    setEnCours(true);
    try {
      await modifierUtilisateur(cabinet.id, utilisateurPanneau.id, { roles: panneau.roles });
      fermerPanneau(cle);
      setSucces(SUCCES_ROLES_MIS_A_JOUR);
      rafraichir();
    } catch (err) {
      setPanneau({ ...panneau, erreur: messageErreurPlateforme(err) });
      setTentative((t) => t + 1);
    } finally {
      setEnCours(false);
    }
  }

  async function changerEtat() {
    if (enCours || panneau?.type !== "etat" || !utilisateurPanneau) return;
    const cle = clePanneau(panneau);
    const actifApres = !utilisateurPanneau.actif;
    setSucces(null);
    setEnCours(true);
    try {
      await modifierUtilisateur(cabinet.id, utilisateurPanneau.id, { actif: actifApres });
      fermerPanneau(cle);
      setSucces(messageSuccesEtat(actifApres));
      rafraichir();
    } catch (err) {
      // 409 DERNIER_ASSOCIE compris : le message reste dans la confirmation.
      setPanneau({ ...panneau, erreur: messageErreurPlateforme(err) });
    } finally {
      setEnCours(false);
    }
  }

  const colonnes: ColonneTableau<UtilisateurPlateforme>[] = [
    {
      cle: "nom",
      entete: "Nom",
      rendu: (u) => <span className="mp-gu__nom mp-gu__identite">{u.nom}</span>,
    },
    {
      cle: "email",
      entete: "E-mail",
      rendu: (u) => <span className="mp-gu__email">{u.email}</span>,
    },
    {
      cle: "roles",
      entete: "Rôles",
      rendu: (u) => <span className="mp-gu__roles">{libelleRolesCabinet(u.roles)}</span>,
    },
    {
      cle: "etat",
      entete: "État",
      rendu: (u) => (
        <BadgeStatut tonalite={u.actif ? "succes" : "neutre"}>
          {libelleEtatUtilisateur(u.actif)}
        </BadgeStatut>
      ),
    },
    {
      cle: "actions",
      entete: "Actions",
      rendu: (u) => (
        <div className="mp-gu__actions">
          <Bouton
            ref={refBouton(cleBouton.roles(u.id))}
            variante="secondaire"
            aria-label={ariaModifierRoles(u)}
            aria-expanded={panneau?.type === "roles" && panneau.utilisateurId === u.id}
            disabled={enCours}
            onClick={() => ouvrirPanneau(ouvrirEditeurRoles(u))}
          >
            Modifier les rôles
          </Bouton>
          <Bouton
            ref={refBouton(cleBouton.etat(u.id))}
            variante={u.actif ? "discret" : "secondaire"}
            aria-label={ariaActionEtat(u)}
            aria-expanded={panneau?.type === "etat" && panneau.utilisateurId === u.id}
            disabled={enCours}
            onClick={() => ouvrirPanneau(ouvrirConfirmationEtat(u))}
          >
            {libelleActionEtat(u.actif)}
          </Bouton>
        </div>
      ),
    },
  ];

  const texteEtat =
    panneau?.type === "etat" && utilisateurPanneau
      ? texteConfirmationEtat(utilisateurPanneau)
      : null;

  return (
    <div className="mp-gu">
      {cabinet.actif ? null : (
        <Alerte tonalite="attention" annonce="aucune">
          <p>
            Ce cabinet est désactivé : ses utilisateurs ne peuvent pas se connecter. Réactivez-le
            depuis la liste des cabinets.
          </p>
        </Alerte>
      )}

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
            retourFocus.current = cleBouton.ajout;
          }}
        />
      ) : null}

      <section className="mp-gu__section" aria-labelledby="titre-utilisateurs">
        <h2 id="titre-utilisateurs" className="mp-gu__titre">
          Utilisateurs
        </h2>
        <Tableau
          legende={`Utilisateurs du cabinet ${cabinet.nom}`}
          colonnes={colonnes}
          lignes={utilisateurs}
          cleLigne={(u) => u.id}
          messageVide="Ce cabinet n'a encore aucun utilisateur. Ajoutez-en un ci-dessous."
        />

        {panneau?.type === "roles" && utilisateurPanneau ? (
          <div
            ref={zoneRoles}
            className="mp-gu__panneau"
            role="group"
            aria-labelledby="titre-roles"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !enCours) fermerPanneau(clePanneau(panneau));
            }}
          >
            <p id="titre-roles" className="mp-gu__panneau-titre">
              Rôles de {utilisateurPanneau.nom}
            </p>
            {panneau.erreur && panneau.roles.length > 0 ? (
              <Alerte ref={alerteRoles} tonalite="danger" titre="Enregistrement impossible">
                <p>{panneau.erreur}</p>
              </Alerte>
            ) : null}
            <GroupeCases
              legende="Rôles"
              requis
              nom="roles-modification"
              options={OPTIONS_ROLES}
              valeurs={panneau.roles}
              desactive={enCours}
              erreur={panneau.roles.length === 0 ? panneau.erreur : undefined}
              onChange={(roles) => setPanneau({ ...panneau, roles, erreur: undefined })}
            />
            <div className="mp-gu__barre">
              <Bouton
                chargement={enCours}
                texteChargement="Enregistrement…"
                onClick={() => void enregistrerRoles()}
              >
                Enregistrer
              </Bouton>
              <Bouton
                variante="secondaire"
                disabled={enCours}
                onClick={() => fermerPanneau(clePanneau(panneau))}
              >
                Annuler
              </Bouton>
            </div>
          </div>
        ) : null}

        {panneau?.type === "etat" && texteEtat ? (
          <ConfirmationAction
            titre={texteEtat.titre}
            libelleConfirmer={texteEtat.libelleConfirmer}
            danger={texteEtat.danger}
            enCours={enCours}
            erreur={panneau.erreur}
            surConfirmer={() => void changerEtat()}
            surAnnuler={() => fermerPanneau(clePanneau(panneau))}
          >
            <p>{texteEtat.consequence}</p>
          </ConfirmationAction>
        ) : null}
      </section>

      <Carte titre="Nouvel utilisateur">
        <div className="mp-gu__formulaire">
          <div className="mp-gu__barre">
            <Bouton
              ref={refBouton(cleBouton.ajout)}
              variante={ajoutOuvert ? "secondaire" : "primaire"}
              icone="plus"
              aria-expanded={ajoutOuvert}
              aria-controls={ID_FORMULAIRE}
              disabled={enCours || secret !== null}
              onClick={() => {
                if (ajoutOuvert) fermerAjout();
                else {
                  setSucces(null);
                  fermerPanneau();
                  setAjoutOuvert(true);
                }
              }}
            >
              Ajouter un utilisateur
            </Bouton>
            {secret ? (
              <p className="mp-gu__aide">Notez d&apos;abord le mot de passe affiché ci-dessus.</p>
            ) : null}
          </div>
          <form
            id={ID_FORMULAIRE}
            ref={formulaire}
            className="mp-gu__formulaire"
            noValidate
            hidden={!ajoutOuvert}
            onSubmit={(e) => void ajouter(e)}
          >
            {ajoutOuvert ? (
              <>
                {erreurAjout ? (
                  <Alerte ref={alerteAjout} tonalite="danger" titre="Ajout impossible">
                    <p>{erreurAjout}</p>
                  </Alerte>
                ) : null}
                <Champ
                  ref={champNom}
                  libelle="Nom"
                  name="nom"
                  required
                  autoComplete="off"
                  maxLength={200}
                  value={saisie.nom}
                  onChange={(e) => setSaisie({ ...saisie, nom: e.target.value })}
                  erreur={erreurs.nom}
                />
                <Champ
                  libelle="Adresse e-mail"
                  name="email"
                  type="email"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={254}
                  value={saisie.email}
                  onChange={(e) => setSaisie({ ...saisie, email: e.target.value })}
                  erreur={erreurs.email}
                />
                <GroupeCases
                  legende="Rôles"
                  requis
                  nom="roles"
                  options={OPTIONS_ROLES}
                  valeurs={saisie.roles}
                  erreur={erreurs.roles}
                  onChange={(roles) => setSaisie({ ...saisie, roles })}
                />
                <div className="mp-gu__mdp">
                  <Champ
                    libelle="Mot de passe provisoire (facultatif)"
                    name="motDePasse"
                    type={mdpVisible ? "text" : "password"}
                    autoComplete="new-password"
                    spellCheck={false}
                    maxLength={200}
                    aide="Laissez vide pour générer un mot de passe provisoire. Sinon, au moins 12 caractères."
                    value={saisie.motDePasse}
                    onChange={(e) => setSaisie({ ...saisie, motDePasse: e.target.value })}
                    erreur={erreurs.motDePasse}
                  />
                  <Bouton variante="discret" onClick={() => setMdpVisible((v) => !v)}>
                    {mdpVisible ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  </Bouton>
                </div>
                <div className="mp-gu__barre">
                  <Bouton type="submit" chargement={enCours} texteChargement="Ajout en cours…">
                    Ajouter l&apos;utilisateur
                  </Bouton>
                  <Bouton variante="secondaire" disabled={enCours} onClick={fermerAjout}>
                    Annuler
                  </Bouton>
                </div>
              </>
            ) : null}
          </form>
        </div>
      </Carte>
    </div>
  );
}
