"use client";

import { useState, type FormEvent } from "react";
import { FAMILLES_RISQUE_DD, NIVEAUX_RISQUE_DD } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminSignaux,
  cheminVersionsSignal,
  libellesDd,
  messageDd,
  optionsDe,
  type EntreeTaxonomie,
  type SignalBibliotheque,
  type ReponseEcriture,
} from "../../lib/due-diligence";
import {
  MOTIF_MAX,
  MOTIF_VERDICT_MAX,
  MOTIF_LONG_MAX,
  saisieSignalVide,
  TITRE_MAX,
  validerSignal,
  type ChampSignal,
  type SaisieSignal,
} from "../../lib/due-diligence-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

const optionsTaxonomie = (entrees: readonly EntreeTaxonomie[]) =>
  entrees.map((e) => ({ valeur: e.code, libelle: e.libelle }));

export interface FormulaireSignalProps {
  secteurs: readonly EntreeTaxonomie[];
  filieres: readonly EntreeTaxonomie[];
  pays: readonly EntreeTaxonomie[];
  /** Présent : correction de ce signal (nouvelle version, motif exigé). */
  signal?: SignalBibliotheque;
}

/**
 * Signal d'alerte de la bibliothèque (DD-11), propre au cabinet : famille, secteur (ou filière) et
 * pays (ou zone) concernés (vides : tous), gravité indicative, question à poser et référence
 * publique (nom d'un document, jamais un extrait). Le code interne est tiré du titre.
 */
export function FormulaireSignal({ secteurs, filieres, pays, signal }: FormulaireSignalProps) {
  const t = useT();
  const langue = useLangue();
  const L = libellesDd(langue);
  const optionsFamille = optionsDe(FAMILLES_RISQUE_DD, L.FAMILLE);
  const optionsGravite = optionsDe(NIVEAUX_RISQUE_DD, L.NIVEAU_RISQUE);
  const f = useFormulaire<ChampSignal>();
  const correction = signal !== undefined;
  const [s, setS] = useState<SaisieSignal>(
    signal
      ? {
          libelle: signal.libelle,
          description: signal.description ?? "",
          famille: signal.famille,
          secteur_code: signal.secteur_code ?? "",
          pays_code: signal.pays_code ?? "",
          gravite_indicative: signal.gravite_indicative,
          question: signal.question ?? "",
          reference_publique: signal.reference_publique ?? "",
          actif: signal.actif,
          motif: "",
        }
      : saisieSignalVide(),
  );
  const maj = (p: Partial<SaisieSignal>) => setS((x) => ({ ...x, ...p }));
  const secteursEtFilieres = [...secteurs, ...filieres];

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerSignal(s, correction, [], langue),
      (charge) =>
        signal
          ? api.post<ReponseEcriture>(cheminVersionsSignal(signal.id), {
              ...charge,
              version_courante: signal.version,
            })
          : api.post<ReponseEcriture>(cheminSignaux(), charge),
      {
        succes: correction
          ? t("Nouvelle version enregistrée.", "New version saved.")
          : t("Signal ajouté à la bibliothèque.", "Signal added to the library."),
        messageSpecifique: (err) => messageDd(err, langue),
        apres: () => (correction ? maj({ motif: "" }) : setS(saisieSignalVide())),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={
        correction
          ? t(`Corriger le signal ${signal.libelle}`, `Edit the signal ${signal.libelle}`)
          : t("Nouveau signal d'alerte", "New warning signal")
      }
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Signal refusé", "Signal refused")}
      />
      <Champ
        libelle={t("Titre du signal", "Signal title")}
        required
        maxLength={TITRE_MAX}
        value={s.libelle}
        onChange={(e) => maj({ libelle: e.target.value })}
        erreur={f.erreurs.libelle}
      />
      <div className="mp-grille-champs">
        <Select
          libelle={t("Famille de risque", "Risk family")}
          required
          invite={t("Choisir…", "Choose…")}
          options={optionsFamille}
          value={s.famille}
          onChange={(e) => maj({ famille: e.target.value })}
          erreur={f.erreurs.famille}
        />
        <Select
          libelle={t("Gravité indicative", "Indicative severity")}
          required
          invite={t("Choisir…", "Choose…")}
          options={optionsGravite}
          value={s.gravite_indicative}
          onChange={(e) => maj({ gravite_indicative: e.target.value })}
          erreur={f.erreurs.gravite_indicative}
        />
      </div>
      <div className="mp-grille-champs">
        <Select
          libelle={t("Secteur ou filière concerné", "Sector or subsector concerned")}
          invite={t("Tous les secteurs", "All sectors")}
          options={optionsTaxonomie(secteursEtFilieres)}
          value={s.secteur_code}
          onChange={(e) => maj({ secteur_code: e.target.value })}
          erreur={f.erreurs.secteur_code}
        />
        <Select
          libelle={t("Pays concerné", "Country concerned")}
          invite={t("Tous les pays", "All countries")}
          options={optionsTaxonomie(pays)}
          value={s.pays_code}
          onChange={(e) => maj({ pays_code: e.target.value })}
          erreur={f.erreurs.pays_code}
        />
      </div>
      <ZoneTexte
        libelle={t("Question à poser", "Question to ask")}
        rows={2}
        maxLength={MOTIF_LONG_MAX}
        value={s.question}
        onChange={(e) => maj({ question: e.target.value })}
        erreur={f.erreurs.question}
        aide={t(
          "La question que l'analyste posera au dirigeant ou à la source.",
          "The question the analyst will ask the executive or the source.",
        )}
      />
      <Champ
        libelle={t("Référence publique", "Public reference")}
        maxLength={500}
        value={s.reference_publique}
        onChange={(e) => maj({ reference_publique: e.target.value })}
        erreur={f.erreurs.reference_publique}
        aide={t(
          "Le nom d'un document public, jamais un extrait.",
          "The name of a public document, never an excerpt.",
        )}
      />
      <ZoneTexte
        libelle={t("Description", "Description")}
        rows={2}
        maxLength={MOTIF_VERDICT_MAX}
        value={s.description}
        onChange={(e) => maj({ description: e.target.value })}
        erreur={f.erreurs.description}
      />
      <CaseACocher
        libelle={t(
          "Signal actif (proposé aux dossiers concernés)",
          "Active signal (offered to the files concerned)",
        )}
        checked={s.actif}
        onChange={(e) => maj({ actif: e.target.checked })}
      />
      {correction ? (
        <ZoneTexte
          libelle={t("Motif de la correction", "Reason for the correction")}
          required
          rows={2}
          maxLength={MOTIF_MAX}
          value={s.motif}
          onChange={(e) => maj({ motif: e.target.value })}
          erreur={f.erreurs.motif}
          aide={t("Conservé dans l'historique des versions.", "Kept in the version history.")}
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {correction
            ? t("Enregistrer la nouvelle version", "Save the new version")
            : t("Ajouter le signal", "Add the signal")}
        </Bouton>
      </div>
    </form>
  );
}
