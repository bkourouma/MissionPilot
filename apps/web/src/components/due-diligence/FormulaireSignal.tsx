"use client";

import { useState, type FormEvent } from "react";
import { FAMILLES_RISQUE_DD, NIVEAUX_RISQUE_DD } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminSignaux,
  cheminVersionsSignal,
  FAMILLE_RISQUE_DD_LIBELLES,
  messageDd,
  NIVEAU_RISQUE_DD_LIBELLES,
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
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

const OPTIONS_FAMILLE = optionsDe(FAMILLES_RISQUE_DD, FAMILLE_RISQUE_DD_LIBELLES);
const OPTIONS_GRAVITE = optionsDe(NIVEAUX_RISQUE_DD, NIVEAU_RISQUE_DD_LIBELLES);
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
      validerSignal(s, correction),
      (charge) =>
        signal
          ? api.post<ReponseEcriture>(cheminVersionsSignal(signal.id), {
              ...charge,
              version_courante: signal.version,
            })
          : api.post<ReponseEcriture>(cheminSignaux(), charge),
      {
        succes: correction ? "Nouvelle version enregistrée." : "Signal ajouté à la bibliothèque.",
        messageSpecifique: messageDd,
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
      aria-label={correction ? `Corriger le signal ${signal.libelle}` : "Nouveau signal d'alerte"}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Signal refusé"
      />
      <Champ
        libelle="Titre du signal"
        required
        maxLength={TITRE_MAX}
        value={s.libelle}
        onChange={(e) => maj({ libelle: e.target.value })}
        erreur={f.erreurs.libelle}
      />
      <div className="mp-grille-champs">
        <Select
          libelle="Famille de risque"
          required
          invite="Choisir…"
          options={OPTIONS_FAMILLE}
          value={s.famille}
          onChange={(e) => maj({ famille: e.target.value })}
          erreur={f.erreurs.famille}
        />
        <Select
          libelle="Gravité indicative"
          required
          invite="Choisir…"
          options={OPTIONS_GRAVITE}
          value={s.gravite_indicative}
          onChange={(e) => maj({ gravite_indicative: e.target.value })}
          erreur={f.erreurs.gravite_indicative}
        />
      </div>
      <div className="mp-grille-champs">
        <Select
          libelle="Secteur ou filière concerné"
          invite="Tous les secteurs"
          options={optionsTaxonomie(secteursEtFilieres)}
          value={s.secteur_code}
          onChange={(e) => maj({ secteur_code: e.target.value })}
          erreur={f.erreurs.secteur_code}
        />
        <Select
          libelle="Pays concerné"
          invite="Tous les pays"
          options={optionsTaxonomie(pays)}
          value={s.pays_code}
          onChange={(e) => maj({ pays_code: e.target.value })}
          erreur={f.erreurs.pays_code}
        />
      </div>
      <ZoneTexte
        libelle="Question à poser"
        rows={2}
        maxLength={MOTIF_LONG_MAX}
        value={s.question}
        onChange={(e) => maj({ question: e.target.value })}
        erreur={f.erreurs.question}
        aide="La question que l'analyste posera au dirigeant ou à la source."
      />
      <Champ
        libelle="Référence publique"
        maxLength={500}
        value={s.reference_publique}
        onChange={(e) => maj({ reference_publique: e.target.value })}
        erreur={f.erreurs.reference_publique}
        aide="Le nom d'un document public, jamais un extrait."
      />
      <ZoneTexte
        libelle="Description"
        rows={2}
        maxLength={MOTIF_VERDICT_MAX}
        value={s.description}
        onChange={(e) => maj({ description: e.target.value })}
        erreur={f.erreurs.description}
      />
      <CaseACocher
        libelle="Signal actif (proposé aux dossiers concernés)"
        checked={s.actif}
        onChange={(e) => maj({ actif: e.target.checked })}
      />
      {correction ? (
        <ZoneTexte
          libelle="Motif de la correction"
          required
          rows={2}
          maxLength={MOTIF_MAX}
          value={s.motif}
          onChange={(e) => maj({ motif: e.target.value })}
          erreur={f.erreurs.motif}
          aide="Conservé dans l'historique des versions."
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {correction ? "Enregistrer la nouvelle version" : "Ajouter le signal"}
        </Bouton>
      </div>
    </form>
  );
}
