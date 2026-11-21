"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLangue, useT } from "../../../../../components/i18n/FournisseurLangue";
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
  rolesProposes,
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
  succesRolesMisAJour,
  succesUtilisateurAjoute,
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
  const t = useT();
  const langue = useLangue();
  const optionsRoles = rolesProposes(langue).map((r) => ({
    valeur: r.valeur,
    libelle: r.libelle,
  }));
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
    const e = validerUtilisateur(saisie, langue);
    if (Object.keys(e).length > 0) {
      setErreurs(e);
      setTentative((n) => n + 1);
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
      setSucces(succesUtilisateurAjoute(langue));
      rafraichir();
    } catch (err) {
      setErreurAjout(messageErreurPlateforme(err, langue));
      setTentative((n) => n + 1);
    } finally {
      setEnCours(false);
    }
  }

  async function enregistrerRoles() {
    if (enCours || panneau?.type !== "roles" || !utilisateurPanneau) return;
    const cle = clePanneau(panneau);
    const manque = validerRoles(panneau.roles, langue);
    if (manque) {
      setPanneau({ ...panneau, erreur: manque });
      setTentative((n) => n + 1);
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
      setSucces(succesRolesMisAJour(langue));
      rafraichir();
    } catch (err) {
      setPanneau({ ...panneau, erreur: messageErreurPlateforme(err, langue) });
      setTentative((n) => n + 1);
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
      setSucces(messageSuccesEtat(actifApres, langue));
      rafraichir();
    } catch (err) {
      // 409 DERNIER_ASSOCIE compris : le message reste dans la confirmation.
      setPanneau({ ...panneau, erreur: messageErreurPlateforme(err, langue) });
    } finally {
      setEnCours(false);
    }
  }

  const colonnes: ColonneTableau<UtilisateurPlateforme>[] = [
    {
      cle: "nom",
      entete: t("Nom", "Name"),
      rendu: (u) => <span className="mp-gu__nom mp-gu__identite">{u.nom}</span>,
    },
    {
      cle: "email",
      entete: t("E-mail", "Email"),
      rendu: (u) => <span className="mp-gu__email">{u.email}</span>,
    },
    {
      cle: "roles",
      entete: t("Rôles", "Roles"),
      rendu: (u) => <span className="mp-gu__roles">{libelleRolesCabinet(u.roles, langue)}</span>,
    },
    {
      cle: "etat",
      entete: t("État", "Status"),
      rendu: (u) => (
        <BadgeStatut tonalite={u.actif ? "succes" : "neutre"}>
          {libelleEtatUtilisateur(u.actif, langue)}
        </BadgeStatut>
      ),
    },
    {
      cle: "actions",
      entete: t("Actions", "Actions"),
      rendu: (u) => (
        <div className="mp-gu__actions">
          <Bouton
            ref={refBouton(cleBouton.roles(u.id))}
            variante="secondaire"
            aria-label={ariaModifierRoles(u, langue)}
            aria-expanded={panneau?.type === "roles" && panneau.utilisateurId === u.id}
            disabled={enCours}
            onClick={() => ouvrirPanneau(ouvrirEditeurRoles(u))}
          >
            {t("Modifier les rôles", "Edit roles")}
          </Bouton>
          <Bouton
            ref={refBouton(cleBouton.etat(u.id))}
            variante={u.actif ? "discret" : "secondaire"}
            aria-label={ariaActionEtat(u, langue)}
            aria-expanded={panneau?.type === "etat" && panneau.utilisateurId === u.id}
            disabled={enCours}
            onClick={() => ouvrirPanneau(ouvrirConfirmationEtat(u))}
          >
            {libelleActionEtat(u.actif, langue)}
          </Bouton>
        </div>
      ),
    },
  ];

  const texteEtat =
    panneau?.type === "etat" && utilisateurPanneau
      ? texteConfirmationEtat(utilisateurPanneau, langue)
      : null;

  return (
    <div className="mp-gu">
      {cabinet.actif ? null : (
        <Alerte tonalite="attention" annonce="aucune">
          <p>
            {t(
              "Ce cabinet est désactivé : ses utilisateurs ne peuvent pas se connecter. Réactivez-le depuis la liste des cabinets.",
              "This firm is deactivated: its users cannot sign in. Reactivate it from the list of firms.",
            )}
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
          {t("Utilisateurs", "Users")}
        </h2>
        <Tableau
          legende={t(`Utilisateurs du cabinet ${cabinet.nom}`, `Users of the firm ${cabinet.nom}`)}
          colonnes={colonnes}
          lignes={utilisateurs}
          cleLigne={(u) => u.id}
          messageVide={t(
            "Ce cabinet n'a encore aucun utilisateur. Ajoutez-en un ci-dessous.",
            "This firm has no users yet. Add one below.",
          )}
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
              {t(`Rôles de ${utilisateurPanneau.nom}`, `Roles of ${utilisateurPanneau.nom}`)}
            </p>
            {panneau.erreur && panneau.roles.length > 0 ? (
              <Alerte
                ref={alerteRoles}
                tonalite="danger"
                titre={t("Enregistrement impossible", "Unable to save")}
              >
                <p>{panneau.erreur}</p>
              </Alerte>
            ) : null}
            <GroupeCases
              legende={t("Rôles", "Roles")}
              requis
              nom="roles-modification"
              options={optionsRoles}
              valeurs={panneau.roles}
              desactive={enCours}
              erreur={panneau.roles.length === 0 ? panneau.erreur : undefined}
              onChange={(roles) => setPanneau({ ...panneau, roles, erreur: undefined })}
            />
            <div className="mp-gu__barre">
              <Bouton
                chargement={enCours}
                texteChargement={t("Enregistrement…", "Saving…")}
                onClick={() => void enregistrerRoles()}
              >
                {t("Enregistrer", "Save")}
              </Bouton>
              <Bouton
                variante="secondaire"
                disabled={enCours}
                onClick={() => fermerPanneau(clePanneau(panneau))}
              >
                {t("Annuler", "Cancel")}
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

      <Carte titre={t("Nouvel utilisateur", "New user")}>
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
              {t("Ajouter un utilisateur", "Add a user")}
            </Bouton>
            {secret ? (
              <p className="mp-gu__aide">
                {t(
                  "Notez d'abord le mot de passe affiché ci-dessus.",
                  "First note the password shown above.",
                )}
              </p>
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
                  <Alerte
                    ref={alerteAjout}
                    tonalite="danger"
                    titre={t("Ajout impossible", "Unable to add")}
                  >
                    <p>{erreurAjout}</p>
                  </Alerte>
                ) : null}
                <Champ
                  ref={champNom}
                  libelle={t("Nom", "Name")}
                  name="nom"
                  required
                  autoComplete="off"
                  maxLength={200}
                  value={saisie.nom}
                  onChange={(e) => setSaisie({ ...saisie, nom: e.target.value })}
                  erreur={erreurs.nom}
                />
                <Champ
                  libelle={t("Adresse e-mail", "Email address")}
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
                  legende={t("Rôles", "Roles")}
                  requis
                  nom="roles"
                  options={optionsRoles}
                  valeurs={saisie.roles}
                  erreur={erreurs.roles}
                  onChange={(roles) => setSaisie({ ...saisie, roles })}
                />
                <div className="mp-gu__mdp">
                  <Champ
                    libelle={t(
                      "Mot de passe provisoire (facultatif)",
                      "Temporary password (optional)",
                    )}
                    name="motDePasse"
                    type={mdpVisible ? "text" : "password"}
                    autoComplete="new-password"
                    spellCheck={false}
                    maxLength={200}
                    aide={t(
                      "Laissez vide pour générer un mot de passe provisoire. Sinon, au moins 12 caractères.",
                      "Leave empty to generate a temporary password. Otherwise, at least 12 characters.",
                    )}
                    value={saisie.motDePasse}
                    onChange={(e) => setSaisie({ ...saisie, motDePasse: e.target.value })}
                    erreur={erreurs.motDePasse}
                  />
                  <Bouton
                    variante="discret"
                    icone="oeil"
                    aria-pressed={mdpVisible}
                    onClick={() => setMdpVisible((v) => !v)}
                  >
                    {t("Afficher le mot de passe", "Show password")}
                  </Bouton>
                </div>
                <div className="mp-gu__barre">
                  <Bouton
                    type="submit"
                    chargement={enCours}
                    texteChargement={t("Ajout en cours…", "Adding…")}
                  >
                    {t("Ajouter l'utilisateur", "Add the user")}
                  </Bouton>
                  <Bouton variante="secondaire" disabled={enCours} onClick={fermerAjout}>
                    {t("Annuler", "Cancel")}
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
