"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { CaseACocher, GroupeCases } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { api } from "../../lib/api";
import {
  OPTIONS_DEVISES_SERVICE,
  OPTIONS_OBJETS,
  OPTIONS_TYPES_GUICHET,
  SAISIE_GUICHET_VIDE,
  saisieDepuisGuichet,
  validerGuichet,
  type ChampGuichet,
  type Guichet,
  type SaisieGuichet,
} from "../../lib/services-candidats";

export interface FormulaireGuichetProps {
  /** Modification d'un guichet existant ; création sinon. */
  guichet?: Guichet;
  /** Appelé après enregistrement (fermeture du formulaire). */
  onTermine: () => void;
  onAnnuler: () => void;
}

type ChampTexte =
  | "nom"
  | "pays"
  | "secteurs"
  | "filieres"
  | "tailles"
  | "montant_min"
  | "montant_max"
  | "date_limite"
  | "url";

/** Création (POST) ou modification (PATCH) d'un guichet de financement du cabinet. */
export function FormulaireGuichet({ guichet, onTermine, onAnnuler }: FormulaireGuichetProps) {
  const f = useFormulaire<ChampGuichet>();
  const [s, setS] = useState<SaisieGuichet>(() =>
    guichet ? saisieDepuisGuichet(guichet) : SAISIE_GUICHET_VIDE,
  );
  const texte = (k: ChampTexte) => (e: { target: { value: string } }) =>
    setS((x) => ({ ...x, [k]: e.target.value }));

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerGuichet(s),
      (charge) =>
        guichet
          ? api.patch<Guichet>(
              `/api/guichets-financement/${encodeURIComponent(guichet.id)}`,
              charge,
            )
          : api.post<Guichet>("/api/guichets-financement", charge),
      { apres: onTermine },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <p className="mp-champ__aide">
        Les informations saisies ici sont à valider par un expert : aucune source externe n&apos;est
        consultée.
      </p>
      <div className="mp-grille-champs">
        <Champ
          libelle="Nom du guichet"
          name="nom"
          required
          maxLength={200}
          value={s.nom}
          onChange={texte("nom")}
          erreur={f.erreurs.nom}
        />
        <Select
          libelle="Type de guichet"
          name="type"
          required
          options={OPTIONS_TYPES_GUICHET}
          invite="Choisir…"
          value={s.type}
          onChange={(e) => setS((x) => ({ ...x, type: e.target.value }))}
          erreur={f.erreurs.type}
        />
        <Champ
          libelle="Pays"
          name="pays"
          value={s.pays}
          onChange={texte("pays")}
          erreur={f.erreurs.pays}
          aide="Séparés par des virgules. Vide : aucune restriction."
        />
        <Champ
          libelle="Secteurs"
          name="secteurs"
          value={s.secteurs}
          onChange={texte("secteurs")}
          erreur={f.erreurs.secteurs}
          aide="Séparés par des virgules. Vide : aucune restriction."
        />
        <Champ
          libelle="Filières"
          name="filieres"
          value={s.filieres}
          onChange={texte("filieres")}
          erreur={f.erreurs.filieres}
          aide="Séparées par des virgules. Vide : aucune restriction."
        />
        <Champ
          libelle="Tailles d'entreprise"
          name="tailles"
          value={s.tailles}
          onChange={texte("tailles")}
          erreur={f.erreurs.tailles}
          aide="Séparées par des virgules. Vide : aucune restriction."
        />
      </div>
      <GroupeCases
        legende="Objets de financement"
        aide="Aucune case cochée : aucune restriction."
        nom="objets"
        options={OPTIONS_OBJETS}
        valeurs={s.objets}
        onChange={(objets) => setS((x) => ({ ...x, objets }))}
        erreur={f.erreurs.objets}
        disposition="ligne"
      />
      <GroupeCases
        legende="Devises acceptées"
        aide="Aucune case cochée : aucune restriction."
        nom="devises"
        options={OPTIONS_DEVISES_SERVICE}
        valeurs={s.devises}
        onChange={(devises) => setS((x) => ({ ...x, devises }))}
        erreur={f.erreurs.devises}
        disposition="ligne"
      />
      <div className="mp-grille-champs">
        <Champ
          libelle="Montant minimum"
          name="montant_min"
          inputMode="numeric"
          autoComplete="off"
          value={s.montant_min}
          onChange={texte("montant_min")}
          erreur={f.erreurs.montant_min}
          aide="Montant entier ; vide : pas de borne."
        />
        <Champ
          libelle="Montant maximum"
          name="montant_max"
          inputMode="numeric"
          autoComplete="off"
          value={s.montant_max}
          onChange={texte("montant_max")}
          erreur={f.erreurs.montant_max}
          aide="Montant entier ; vide : pas de borne."
        />
        <Select
          libelle="Devise des montants"
          name="devise_montant"
          options={OPTIONS_DEVISES_SERVICE}
          invite="Aucune"
          value={s.devise_montant}
          onChange={(e) => setS((x) => ({ ...x, devise_montant: e.target.value }))}
          erreur={f.erreurs.devise_montant}
          aide="Obligatoire dès qu'une borne est donnée."
        />
        <Champ
          libelle="Date limite de candidature"
          name="date_limite"
          type="date"
          value={s.date_limite}
          onChange={texte("date_limite")}
          erreur={f.erreurs.date_limite}
          aide="Facultatif."
        />
      </div>
      <Champ
        libelle="Adresse du guichet"
        name="url"
        type="url"
        inputMode="url"
        autoComplete="off"
        value={s.url}
        onChange={texte("url")}
        erreur={f.erreurs.url}
        aide="Lien http ou https, facultatif."
      />
      <ZoneTexte
        libelle="Description"
        name="description"
        maxLength={2000}
        value={s.description}
        onChange={(e) => setS((x) => ({ ...x, description: e.target.value }))}
        erreur={f.erreurs.description}
      />
      <CaseACocher
        libelle="Guichet actif"
        aide="Un guichet désactivé est exclu du rapprochement ; il n'est jamais supprimé."
        checked={s.actif}
        onChange={(e) => setS((x) => ({ ...x, actif: e.target.checked }))}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {guichet ? "Enregistrer les modifications" : "Créer le guichet"}
        </Bouton>
        <Bouton variante="discret" onClick={onAnnuler}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
