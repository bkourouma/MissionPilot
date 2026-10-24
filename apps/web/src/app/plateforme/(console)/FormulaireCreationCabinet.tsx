"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alerte } from "../../../components/ui/Alerte";
import { Bouton } from "../../../components/ui/Bouton";
import { Carte } from "../../../components/ui/Carte";
import { Champ } from "../../../components/ui/Champ";
import { Select, type OptionSelect } from "../../../components/ui/Select";
import {
  libellePays,
  messageErreurPlateforme,
  MOT_DE_PASSE_MAX,
  PAYS_PAR_DEFAUT,
  PAYS_PROPOSES,
  validerCabinet,
  type CreationCabinet,
  type ErreursCabinet,
  type SaisieCabinet,
} from "../../../lib/plateforme";
import { creerCabinet } from "../../../lib/plateforme-client";

export const ID_FORMULAIRE_CABINET = "formulaire-cabinet";

const SAISIE_VIDE: SaisieCabinet = {
  nom: "",
  pays: PAYS_PAR_DEFAUT,
  associeNom: "",
  associeEmail: "",
  associeMotDePasse: "",
};

/** Ordre d'affichage des champs : le focus va sur le premier en erreur. */
const ORDRE: readonly (keyof SaisieCabinet)[] = [
  "nom",
  "pays",
  "associeNom",
  "associeEmail",
  "associeMotDePasse",
];

export function optionsPays(): OptionSelect[] {
  return PAYS_PROPOSES.map((code) => ({ valeur: code, libelle: libellePays(code) }));
}

/** Premier champ en erreur selon l'ordre d'affichage, ou `undefined`. */
export function premierChampEnErreur(erreurs: ErreursCabinet): keyof SaisieCabinet | undefined {
  return ORDRE.find((cle) => erreurs[cle]);
}

/**
 * Formulaire de création d'un cabinet et de son premier associé. Le mot de passe est facultatif
 * (vide = généré par le serveur) et ne vit que dans l'état de ce composant.
 */
export function FormulaireCreationCabinet({
  surCree,
  surAnnuler,
}: {
  surCree: (creation: CreationCabinet) => void;
  surAnnuler: () => void;
}) {
  const [saisie, setSaisie] = useState<SaisieCabinet>(SAISIE_VIDE);
  const [erreurs, setErreurs] = useState<ErreursCabinet>({});
  const [erreurGlobale, setErreurGlobale] = useState<string | null>(null);
  const [afficherMdp, setAfficherMdp] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const alerte = useRef<HTMLDivElement>(null);
  const champNom = useRef<HTMLInputElement>(null);
  const champPays = useRef<HTMLSelectElement>(null);
  const champAssocieNom = useRef<HTMLInputElement>(null);
  const champAssocieEmail = useRef<HTMLInputElement>(null);
  const champAssocieMdp = useRef<HTMLInputElement>(null);

  useEffect(() => {
    champNom.current?.focus();
  }, []);

  useEffect(() => {
    if (erreurGlobale) alerte.current?.focus();
  }, [erreurGlobale]);

  const maj = (cle: keyof SaisieCabinet, valeur: string) =>
    setSaisie((s) => ({ ...s, [cle]: valeur }));

  function focaliser(cle: keyof SaisieCabinet) {
    const refs = {
      nom: champNom,
      pays: champPays,
      associeNom: champAssocieNom,
      associeEmail: champAssocieEmail,
      associeMotDePasse: champAssocieMdp,
    };
    refs[cle].current?.focus();
  }

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (enCours) return;
    setErreurGlobale(null);
    const trouvees = validerCabinet(saisie);
    setErreurs(trouvees);
    const premier = premierChampEnErreur(trouvees);
    if (premier) return focaliser(premier);
    setEnCours(true);
    try {
      const creation = await creerCabinet(saisie);
      // Formulaire vidé avant de rendre la main : le mot de passe saisi ne reste pas en mémoire.
      setSaisie(SAISIE_VIDE);
      surCree(creation);
    } catch (e) {
      setErreurGlobale(messageErreurPlateforme(e));
      setEnCours(false);
    }
  }

  return (
    <div id={ID_FORMULAIRE_CABINET}>
      <Carte titre="Nouveau cabinet">
        <form className="mp-formulaire" noValidate onSubmit={soumettre} aria-busy={enCours}>
          {erreurGlobale ? (
            <Alerte ref={alerte} tonalite="danger" titre="Création impossible">
              <p>{erreurGlobale}</p>
            </Alerte>
          ) : null}
          <fieldset className="mp-console__section">
            <legend>Cabinet</legend>
            <div className="mp-console__grille">
              <Champ
                ref={champNom}
                libelle="Nom du cabinet"
                name="nom"
                autoComplete="organization"
                maxLength={200}
                required
                value={saisie.nom}
                onChange={(e) => maj("nom", e.target.value)}
                erreur={erreurs.nom}
              />
              <Select
                ref={champPays}
                libelle="Pays"
                name="pays"
                required
                options={optionsPays()}
                value={saisie.pays}
                onChange={(e) => maj("pays", e.target.value)}
                erreur={erreurs.pays}
              />
            </div>
          </fieldset>
          <fieldset className="mp-console__section">
            <legend>Premier associé</legend>
            <div className="mp-console__grille">
              <Champ
                ref={champAssocieNom}
                libelle="Nom de l'associé"
                name="associe_nom"
                autoComplete="off"
                maxLength={200}
                required
                value={saisie.associeNom}
                onChange={(e) => maj("associeNom", e.target.value)}
                erreur={erreurs.associeNom}
              />
              <Champ
                ref={champAssocieEmail}
                libelle="Adresse e-mail de l'associé"
                type="email"
                name="associe_email"
                autoComplete="off"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={254}
                required
                value={saisie.associeEmail}
                onChange={(e) => maj("associeEmail", e.target.value)}
                erreur={erreurs.associeEmail}
              />
            </div>
            <div className="mp-champ-mdp">
              <Champ
                ref={champAssocieMdp}
                libelle="Mot de passe (facultatif)"
                type={afficherMdp ? "text" : "password"}
                name="associe_mot_de_passe"
                autoComplete="new-password"
                maxLength={MOT_DE_PASSE_MAX}
                aide="Laissez vide pour générer un mot de passe provisoire. Sinon, au moins 12 caractères."
                value={saisie.associeMotDePasse}
                onChange={(e) => maj("associeMotDePasse", e.target.value)}
                erreur={erreurs.associeMotDePasse}
              />
              <Bouton
                variante="discret"
                icone="oeil"
                className="mp-champ-mdp__bascule"
                aria-pressed={afficherMdp}
                onClick={() => setAfficherMdp((v) => !v)}
              >
                Afficher le mot de passe
              </Bouton>
            </div>
          </fieldset>
          <div className="mp-actions-formulaire">
            <Bouton type="submit" chargement={enCours} texteChargement="Création en cours…">
              Créer le cabinet
            </Bouton>
            <Bouton variante="secondaire" disabled={enCours} onClick={surAnnuler}>
              Annuler
            </Bouton>
          </div>
        </form>
      </Carte>
    </div>
  );
}
