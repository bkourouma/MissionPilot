"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { api } from "../../lib/api";
import {
  cheminApiDossier,
  FACTEURS_CONVENTION,
  OPTIONS_FIABILITE,
  OPTIONS_SOURCES,
  validerFacteur,
  type ChampFacteur,
  type SaisieFacteur,
} from "../../lib/dossier";

const VIDE: SaisieFacteur = {
  code: "fiabilite_comptes",
  type: "enumeration",
  valeur: "",
  date_effet: "",
  source_type: "document",
  source_libelle: "",
  fiabilite: "B",
};

const TYPES = [
  { valeur: "enumeration", libelle: "Code (choix dans une liste)" },
  { valeur: "liste", libelle: "Liste de codes" },
  { valeur: "nombre", libelle: "Nombre" },
  { valeur: "booleen", libelle: "Oui / non" },
];

/**
 * Nouvelle valeur d'un facteur de contexte (STD-04), datée et sourcée. Les facteurs de
 * convention (fiabilité des comptes, part de l'informel) alimentent l'indice de fiabilité.
 */
export function FormulaireFacteur({ clientId }: { clientId: string }) {
  const [s, setS] = useState<SaisieFacteur>(VIDE);
  const f = useFormulaire<ChampFacteur>();
  const maj = <K extends keyof SaisieFacteur>(k: K, v: SaisieFacteur[K]) =>
    setS((x) => ({ ...x, [k]: v }));
  const convention = FACTEURS_CONVENTION.find((c) => c.code === s.code);
  const autre = !convention;

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerFacteur(s),
      (charge) => api.post(`${cheminApiDossier(clientId)}/facteurs`, charge),
      { succes: "Valeur du facteur enregistrée.", apres: () => setS({ ...VIDE, code: s.code }) },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Renseigner un facteur de contexte"
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Select
          libelle="Facteur"
          options={[
            ...FACTEURS_CONVENTION.map((c) => ({ valeur: c.code, libelle: c.libelle })),
            { valeur: "", libelle: "Autre facteur…" },
          ]}
          value={convention ? s.code : ""}
          onChange={(e) => setS({ ...s, code: e.target.value, valeur: "" })}
        />
        {autre ? (
          <>
            <Champ
              libelle="Code du facteur"
              required
              maxLength={120}
              value={s.code}
              onChange={(e) => maj("code", e.target.value)}
              erreur={f.erreurs.code}
              aide="Code du référentiel de méthodes, ex. secteur_filiere, effectif."
              autoComplete="off"
            />
            <Select
              libelle="Type"
              options={TYPES}
              value={s.type}
              onChange={(e) => maj("type", e.target.value as SaisieFacteur["type"])}
            />
          </>
        ) : null}
        {convention ? (
          <Select
            libelle="Valeur"
            invite="Choisir…"
            options={convention.valeurs}
            value={s.valeur}
            onChange={(e) => maj("valeur", e.target.value)}
            erreur={f.erreurs.valeur}
          />
        ) : s.type === "booleen" ? (
          <Select
            libelle="Valeur"
            invite="Choisir…"
            options={[
              { valeur: "oui", libelle: "Oui" },
              { valeur: "non", libelle: "Non" },
            ]}
            value={s.valeur}
            onChange={(e) => maj("valeur", e.target.value)}
            erreur={f.erreurs.valeur}
          />
        ) : (
          <Champ
            libelle="Valeur"
            required
            value={s.valeur}
            onChange={(e) => maj("valeur", e.target.value)}
            erreur={f.erreurs.valeur}
            aide={
              s.type === "liste"
                ? "Codes séparés par des virgules, ex. cacao, anacarde."
                : undefined
            }
            autoComplete="off"
          />
        )}
        <Champ
          libelle="Date d'effet"
          type="date"
          required
          value={s.date_effet}
          onChange={(e) => maj("date_effet", e.target.value)}
          erreur={f.erreurs.date_effet}
        />
        <Select
          libelle="Type de source"
          options={OPTIONS_SOURCES}
          value={s.source_type}
          onChange={(e) => maj("source_type", e.target.value as SaisieFacteur["source_type"])}
        />
        <Champ
          libelle="Source"
          required
          maxLength={300}
          value={s.source_libelle}
          onChange={(e) => maj("source_libelle", e.target.value)}
          erreur={f.erreurs.source_libelle}
          aide="Ex. « Rapport du commissaire aux comptes 2025 »."
        />
        <Select
          libelle="Fiabilité de la source"
          options={OPTIONS_FIABILITE}
          value={s.fiabilite}
          onChange={(e) => maj("fiabilite", e.target.value as SaisieFacteur["fiabilite"])}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer la valeur
        </Bouton>
      </div>
    </form>
  );
}
