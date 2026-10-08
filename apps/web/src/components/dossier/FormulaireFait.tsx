"use client";

import { useState, type FormEvent } from "react";
import { DEVISES } from "@missionpilot/shared";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { api } from "../../lib/api";
import {
  cheminApiDossier,
  OPTIONS_CATEGORIES,
  OPTIONS_FIABILITE,
  OPTIONS_SOURCES,
  OPTIONS_TYPES_VALEUR,
  SAISIE_FAIT_VIDE,
  validerFait,
  type ChampFait,
  type SaisieFait,
} from "../../lib/dossier";
import type { Devise } from "../../lib/format";

/**
 * Ajout (ou remplacement) d'un fait daté et sourcé (DOS-02). « Proposer » : un autre membre le
 * confirmera ; « J'atteste ce fait » : l'auteur le confirme lui-même. Un fait ne se modifie
 * jamais : une correction est un nouveau fait qui remplace l'ancien.
 */
export function FormulaireFait({
  clientId,
  saisieInitiale = SAISIE_FAIT_VIDE,
  titre = "Ajouter un fait",
  onTermine,
}: {
  clientId: string;
  saisieInitiale?: SaisieFait;
  titre?: string;
  onTermine?: () => void;
}) {
  const [s, setS] = useState<SaisieFait>(saisieInitiale);
  const f = useFormulaire<ChampFait>();
  const maj = <K extends keyof SaisieFait>(k: K, v: SaisieFait[K]) =>
    setS((x) => ({ ...x, [k]: v }));
  const remplacement = Boolean(s.remplace_id);

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerFait(s),
      (charge) => api.post(`${cheminApiDossier(clientId)}/faits`, charge),
      {
        succes: remplacement ? "Le fait est remplacé." : "Le fait est enregistré.",
        apres: () => {
          setS(saisieInitiale.remplace_id ? saisieInitiale : SAISIE_FAIT_VIDE);
          onTermine?.();
        },
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={titre}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Select
          libelle="Catégorie"
          options={OPTIONS_CATEGORIES}
          value={s.categorie}
          disabled={remplacement}
          onChange={(e) => maj("categorie", e.target.value as SaisieFait["categorie"])}
        />
        <Champ
          libelle="Clé"
          required
          maxLength={120}
          value={s.cle}
          disabled={remplacement}
          onChange={(e) => maj("cle", e.target.value)}
          erreur={f.erreurs.cle}
          aide="Ce que décrit le fait, ex. effectif_total, actionnaire_principal."
          autoComplete="off"
        />
        <Select
          libelle="Type de valeur"
          options={OPTIONS_TYPES_VALEUR}
          value={s.type_valeur}
          onChange={(e) => maj("type_valeur", e.target.value as SaisieFait["type_valeur"])}
        />
        {s.type_valeur === "booleen" ? (
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
            type={s.type_valeur === "date" ? "date" : "text"}
            inputMode={
              s.type_valeur === "nombre" || s.type_valeur === "montant" ? "decimal" : undefined
            }
            value={s.valeur}
            onChange={(e) => maj("valeur", e.target.value)}
            erreur={f.erreurs.valeur}
            autoComplete="off"
          />
        )}
        {s.type_valeur === "montant" ? (
          <Select
            libelle="Devise"
            options={DEVISES.map((d) => ({ valeur: d, libelle: d }))}
            value={s.devise}
            onChange={(e) => maj("devise", e.target.value as Devise)}
          />
        ) : null}
        <Champ
          libelle="Date d'effet"
          type="date"
          required
          value={s.date_effet}
          onChange={(e) => maj("date_effet", e.target.value)}
          erreur={f.erreurs.date_effet}
          aide="Date à laquelle la valeur est vraie (ex. date de clôture, date de l'entretien)."
        />
        <Select
          libelle="Type de source"
          options={OPTIONS_SOURCES}
          value={s.source_type}
          onChange={(e) => maj("source_type", e.target.value as SaisieFait["source_type"])}
        />
        <Champ
          libelle="Source"
          required
          maxLength={300}
          value={s.source_libelle}
          onChange={(e) => maj("source_libelle", e.target.value)}
          erreur={f.erreurs.source_libelle}
          aide="Ex. « Statuts mis à jour en 2024 », « Entretien avec le DAF du 12/09/2026 »."
        />
        {s.source_type === "document" ? (
          <Champ
            libelle="Page du document"
            inputMode="numeric"
            value={s.source_page}
            onChange={(e) => maj("source_page", e.target.value)}
            erreur={f.erreurs.source_page}
          />
        ) : null}
        <Select
          libelle="Fiabilité de la source"
          options={OPTIONS_FIABILITE}
          value={s.fiabilite}
          onChange={(e) => maj("fiabilite", e.target.value as SaisieFait["fiabilite"])}
        />
      </div>
      <ZoneTexte
        libelle="Commentaire"
        rows={2}
        maxLength={2000}
        value={s.commentaire}
        onChange={(e) => maj("commentaire", e.target.value)}
      />
      <CaseACocher
        libelle="J'atteste ce fait"
        aide="Sinon, il est proposé et un autre membre de l'équipe le confirmera."
        checked={s.confirmer}
        onChange={(e) => maj("confirmer", e.target.checked)}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {remplacement ? "Remplacer le fait" : s.confirmer ? "Enregistrer" : "Proposer"}
        </Bouton>
        {onTermine ? (
          <Bouton variante="discret" onClick={onTermine}>
            Annuler
          </Bouton>
        ) : null}
      </div>
    </form>
  );
}
