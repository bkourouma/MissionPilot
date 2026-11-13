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
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { api } from "../../lib/api";
import {
  cheminApiDossier,
  optionsCategories,
  optionsFiabilite,
  optionsSources,
  optionsTypesValeur,
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
  titre,
  onTermine,
}: {
  clientId: string;
  saisieInitiale?: SaisieFait;
  titre?: string;
  onTermine?: () => void;
}) {
  const t = useT();
  const langue = useLangue();
  const libelleForm = titre ?? t("Ajouter un fait", "Add a fact");
  const [s, setS] = useState<SaisieFait>(saisieInitiale);
  const f = useFormulaire<ChampFait>();
  const maj = <K extends keyof SaisieFait>(k: K, v: SaisieFait[K]) =>
    setS((x) => ({ ...x, [k]: v }));
  const remplacement = Boolean(s.remplace_id);

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerFait(s, langue),
      (charge) => api.post(`${cheminApiDossier(clientId)}/faits`, charge),
      {
        succes: remplacement
          ? t("Le fait est remplacé.", "The fact has been replaced.")
          : t("Le fait est enregistré.", "The fact has been saved."),
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
      aria-label={libelleForm}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Select
          libelle={t("Catégorie", "Category")}
          options={optionsCategories(langue)}
          value={s.categorie}
          disabled={remplacement}
          onChange={(e) => maj("categorie", e.target.value as SaisieFait["categorie"])}
        />
        <Champ
          libelle={t("Clé", "Key")}
          required
          maxLength={120}
          value={s.cle}
          disabled={remplacement}
          onChange={(e) => maj("cle", e.target.value)}
          erreur={f.erreurs.cle}
          aide={t(
            "Ce que décrit le fait, ex. effectif_total, actionnaire_principal.",
            "What the fact describes, e.g. effectif_total, actionnaire_principal.",
          )}
          autoComplete="off"
        />
        <Select
          libelle={t("Type de valeur", "Value type")}
          options={optionsTypesValeur(langue)}
          value={s.type_valeur}
          onChange={(e) => maj("type_valeur", e.target.value as SaisieFait["type_valeur"])}
        />
        {s.type_valeur === "booleen" ? (
          <Select
            libelle={t("Valeur", "Value")}
            invite={t("Choisir…", "Choose…")}
            options={[
              { valeur: "oui", libelle: t("Oui", "Yes") },
              { valeur: "non", libelle: t("Non", "No") },
            ]}
            value={s.valeur}
            onChange={(e) => maj("valeur", e.target.value)}
            erreur={f.erreurs.valeur}
          />
        ) : (
          <Champ
            libelle={t("Valeur", "Value")}
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
            libelle={t("Devise", "Currency")}
            options={DEVISES.map((d) => ({ valeur: d, libelle: d }))}
            value={s.devise}
            onChange={(e) => maj("devise", e.target.value as Devise)}
          />
        ) : null}
        <Champ
          libelle={t("Date d'effet", "Effective date")}
          type="date"
          required
          value={s.date_effet}
          onChange={(e) => maj("date_effet", e.target.value)}
          erreur={f.erreurs.date_effet}
          aide={t(
            "Date à laquelle la valeur est vraie (ex. date de clôture, date de l'entretien).",
            "Date on which the value holds (e.g. closing date, interview date).",
          )}
        />
        <Select
          libelle={t("Type de source", "Source type")}
          options={optionsSources(langue)}
          value={s.source_type}
          onChange={(e) => maj("source_type", e.target.value as SaisieFait["source_type"])}
        />
        <Champ
          libelle={t("Source", "Source")}
          required
          maxLength={300}
          value={s.source_libelle}
          onChange={(e) => maj("source_libelle", e.target.value)}
          erreur={f.erreurs.source_libelle}
          aide={t(
            "Ex. « Statuts mis à jour en 2024 », « Entretien avec le DAF du 12/09/2026 ».",
            'E.g. "Articles of association updated in 2024", "Interview with the CFO on 12/09/2026".',
          )}
        />
        {s.source_type === "document" ? (
          <Champ
            libelle={t("Page du document", "Document page")}
            inputMode="numeric"
            value={s.source_page}
            onChange={(e) => maj("source_page", e.target.value)}
            erreur={f.erreurs.source_page}
          />
        ) : null}
        <Select
          libelle={t("Fiabilité de la source", "Source reliability")}
          options={optionsFiabilite(langue)}
          value={s.fiabilite}
          onChange={(e) => maj("fiabilite", e.target.value as SaisieFait["fiabilite"])}
        />
      </div>
      <ZoneTexte
        libelle={t("Commentaire", "Comment")}
        rows={2}
        maxLength={2000}
        value={s.commentaire}
        onChange={(e) => maj("commentaire", e.target.value)}
      />
      <CaseACocher
        libelle={t("J'atteste ce fait", "I attest this fact")}
        aide={t(
          "Sinon, il est proposé et un autre membre de l'équipe le confirmera.",
          "Otherwise, it is proposed and another team member will confirm it.",
        )}
        checked={s.confirmer}
        onChange={(e) => maj("confirmer", e.target.checked)}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {remplacement
            ? t("Remplacer le fait", "Replace the fact")
            : s.confirmer
              ? t("Enregistrer", "Save")
              : t("Proposer", "Propose")}
        </Bouton>
        {onTermine ? (
          <Bouton variante="discret" onClick={onTermine}>
            {t("Annuler", "Cancel")}
          </Bouton>
        ) : null}
      </div>
    </form>
  );
}
