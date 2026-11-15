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
import { useLangue, useT } from "../i18n/FournisseurLangue";
import {
  optionsDevisesService,
  optionsObjets,
  optionsTypesGuichet,
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
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampGuichet>();
  const [s, setS] = useState<SaisieGuichet>(() =>
    guichet ? saisieDepuisGuichet(guichet) : SAISIE_GUICHET_VIDE,
  );
  const texte = (k: ChampTexte) => (e: { target: { value: string } }) =>
    setS((x) => ({ ...x, [k]: e.target.value }));

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerGuichet(s, langue),
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
        {t(
          "Les informations saisies ici sont à valider par un expert : aucune source externe n'est consultée.",
          "The information entered here must be approved by an expert: no external source is consulted.",
        )}
      </p>
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Nom du guichet", "Funding source name")}
          name="nom"
          required
          maxLength={200}
          value={s.nom}
          onChange={texte("nom")}
          erreur={f.erreurs.nom}
        />
        <Select
          libelle={t("Type de guichet", "Funding source type")}
          name="type"
          required
          options={optionsTypesGuichet(langue)}
          invite={t("Choisir…", "Choose…")}
          value={s.type}
          onChange={(e) => setS((x) => ({ ...x, type: e.target.value }))}
          erreur={f.erreurs.type}
        />
        <Champ
          libelle={t("Pays", "Countries")}
          name="pays"
          value={s.pays}
          onChange={texte("pays")}
          erreur={f.erreurs.pays}
          aide={t(
            "Séparés par des virgules. Vide : aucune restriction.",
            "Separated by commas. Empty: no restriction.",
          )}
        />
        <Champ
          libelle={t("Secteurs", "Sectors")}
          name="secteurs"
          value={s.secteurs}
          onChange={texte("secteurs")}
          erreur={f.erreurs.secteurs}
          aide={t(
            "Séparés par des virgules. Vide : aucune restriction.",
            "Separated by commas. Empty: no restriction.",
          )}
        />
        <Champ
          libelle={t("Filières", "Value chains")}
          name="filieres"
          value={s.filieres}
          onChange={texte("filieres")}
          erreur={f.erreurs.filieres}
          aide={t(
            "Séparées par des virgules. Vide : aucune restriction.",
            "Separated by commas. Empty: no restriction.",
          )}
        />
        <Champ
          libelle={t("Tailles d'entreprise", "Company sizes")}
          name="tailles"
          value={s.tailles}
          onChange={texte("tailles")}
          erreur={f.erreurs.tailles}
          aide={t(
            "Séparées par des virgules. Vide : aucune restriction.",
            "Separated by commas. Empty: no restriction.",
          )}
        />
      </div>
      <GroupeCases
        legende={t("Objets de financement", "Financing purposes")}
        aide={t("Aucune case cochée : aucune restriction.", "No box checked: no restriction.")}
        nom="objets"
        options={optionsObjets(langue)}
        valeurs={s.objets}
        onChange={(objets) => setS((x) => ({ ...x, objets }))}
        erreur={f.erreurs.objets}
        disposition="ligne"
      />
      <GroupeCases
        legende={t("Devises acceptées", "Accepted currencies")}
        aide={t("Aucune case cochée : aucune restriction.", "No box checked: no restriction.")}
        nom="devises"
        options={optionsDevisesService(langue)}
        valeurs={s.devises}
        onChange={(devises) => setS((x) => ({ ...x, devises }))}
        erreur={f.erreurs.devises}
        disposition="ligne"
      />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Montant minimum", "Minimum amount")}
          name="montant_min"
          inputMode="numeric"
          autoComplete="off"
          value={s.montant_min}
          onChange={texte("montant_min")}
          erreur={f.erreurs.montant_min}
          aide={t("Montant entier ; vide : pas de borne.", "Whole amount; empty: no bound.")}
        />
        <Champ
          libelle={t("Montant maximum", "Maximum amount")}
          name="montant_max"
          inputMode="numeric"
          autoComplete="off"
          value={s.montant_max}
          onChange={texte("montant_max")}
          erreur={f.erreurs.montant_max}
          aide={t("Montant entier ; vide : pas de borne.", "Whole amount; empty: no bound.")}
        />
        <Select
          libelle={t("Devise des montants", "Amount currency")}
          name="devise_montant"
          options={optionsDevisesService(langue)}
          invite={t("Aucune", "None")}
          value={s.devise_montant}
          onChange={(e) => setS((x) => ({ ...x, devise_montant: e.target.value }))}
          erreur={f.erreurs.devise_montant}
          aide={t(
            "Obligatoire dès qu'une borne est donnée.",
            "Required as soon as a bound is given.",
          )}
        />
        <Champ
          libelle={t("Date limite de candidature", "Application deadline")}
          name="date_limite"
          type="date"
          value={s.date_limite}
          onChange={texte("date_limite")}
          erreur={f.erreurs.date_limite}
          aide={t("Facultatif.", "Optional.")}
        />
      </div>
      <Champ
        libelle={t("Adresse du guichet", "Funding source website")}
        name="url"
        type="url"
        inputMode="url"
        autoComplete="off"
        value={s.url}
        onChange={texte("url")}
        erreur={f.erreurs.url}
        aide={t("Lien http ou https, facultatif.", "http or https link, optional.")}
      />
      <ZoneTexte
        libelle={t("Description", "Description")}
        name="description"
        maxLength={2000}
        value={s.description}
        onChange={(e) => setS((x) => ({ ...x, description: e.target.value }))}
        erreur={f.erreurs.description}
      />
      <CaseACocher
        libelle={t("Guichet actif", "Active funding source")}
        aide={t(
          "Un guichet désactivé est exclu du rapprochement ; il n'est jamais supprimé.",
          "A disabled funding source is excluded from matching; it is never deleted.",
        )}
        checked={s.actif}
        onChange={(e) => setS((x) => ({ ...x, actif: e.target.checked }))}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {guichet
            ? t("Enregistrer les modifications", "Save changes")
            : t("Créer le guichet", "Create funding source")}
        </Bouton>
        <Bouton variante="discret" onClick={onAnnuler}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}
