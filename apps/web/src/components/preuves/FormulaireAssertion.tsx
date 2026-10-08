"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  CLASSE_RISQUE_LIBELLES,
  CLASSES_RISQUE,
  RATTACHEMENTS_ASSERTION,
  STATUTS_ASSERTION as STATUTS,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminAssertionsMission,
  cheminVersionsAssertion,
  hrefAssertion,
  messagePreuves,
  RATTACHEMENTS,
  STATUTS_ASSERTION,
  type AssertionVue,
  type DetailAssertion,
  type DimensionVue,
} from "../../lib/preuves";
import {
  AVIS_MOTIF_MAX,
  ENONCE_MAX,
  LIVRABLE_MAX,
  MOTIF_PREUVE_MAX,
  RATTACHEMENT_CODE_MAX,
  saisieAssertionVide,
  validerAssertion,
  type ChampAssertion,
  type SaisieAssertion,
} from "../../lib/preuves-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

const OPTIONS_CLASSE = CLASSES_RISQUE.map((c) => ({
  valeur: c,
  libelle: `${c} · ${CLASSE_RISQUE_LIBELLES[c]}`,
}));
const OPTIONS_STATUT = STATUTS.map((s) => ({ valeur: s, libelle: STATUTS_ASSERTION[s] }));
const OPTIONS_RATTACHEMENT = RATTACHEMENTS_ASSERTION.map((r) => ({
  valeur: r,
  libelle: RATTACHEMENTS[r],
}));

function saisieDepuis(a: AssertionVue): SaisieAssertion {
  return {
    enonce: a.enonce,
    rattachement_type: a.rattachement?.type ?? "",
    rattachement_code: a.rattachement?.code ?? "",
    livrable: a.livrable ?? "",
    classe_risque: a.classe_risque,
    statut: a.statut,
    avis_expert: a.avis_expert !== null,
    avis_expert_motif: a.avis_expert?.motif ?? "",
    signer_avis: false,
    motif: "",
  };
}

export interface FormulaireAssertionProps {
  missionId: string;
  dimensions: readonly DimensionVue[];
  /** Présente : correction de cette assertion (nouvelle version, motif exigé). */
  assertion?: AssertionVue;
}

/**
 * Assertion : conclusion à écrire dans un livrable, sa classe de risque et, à défaut de preuve,
 * son « avis d'expert » signé. L'indice de solidité n'est jamais saisi : il vient du moteur.
 */
export function FormulaireAssertion({
  missionId,
  dimensions,
  assertion,
}: FormulaireAssertionProps) {
  const router = useRouter();
  const correction = assertion !== undefined;
  const f = useFormulaire<ChampAssertion>();
  const [s, setS] = useState<SaisieAssertion>(
    assertion ? saisieDepuis(assertion) : saisieAssertionVide(),
  );
  const maj = (partiel: Partial<SaisieAssertion>) => setS((x) => ({ ...x, ...partiel }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerAssertion(s, correction),
      (charge) =>
        correction
          ? api.post<DetailAssertion>(cheminVersionsAssertion(assertion.id), charge)
          : api.post<DetailAssertion>(cheminAssertionsMission(missionId), charge),
      {
        succes: correction
          ? "Nouvelle version enregistrée ; l'ancienne reste dans l'historique."
          : "Assertion enregistrée.",
        messageSpecifique: messagePreuves,
        apres: (r) => {
          if (!correction) router.push(hrefAssertion(missionId, r.id));
          else maj({ motif: "", signer_avis: false });
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
      aria-label={correction ? "Corriger l'assertion" : "Nouvelle assertion"}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Assertion refusée"
      />
      <ZoneTexte
        libelle="Assertion"
        required
        rows={3}
        maxLength={ENONCE_MAX}
        value={s.enonce}
        onChange={(e) => maj({ enonce: e.target.value })}
        erreur={f.erreurs.enonce}
        aide="La conclusion que vous voulez écrire dans le livrable, en une phrase vérifiable."
      />
      <div className="mp-grille-champs">
        <Select
          libelle="Classe de risque du livrable cible"
          required
          invite="Choisir…"
          options={OPTIONS_CLASSE}
          value={s.classe_risque}
          onChange={(e) => maj({ classe_risque: e.target.value })}
          erreur={f.erreurs.classe_risque}
          aide="R2 et R3 : chaque assertion doit reposer sur une preuve ou sur un avis d'expert signé."
        />
        <Champ
          libelle="Livrable cible"
          maxLength={LIVRABLE_MAX}
          value={s.livrable}
          onChange={(e) => maj({ livrable: e.target.value })}
          erreur={f.erreurs.livrable}
          aide="Facultatif : le nom du livrable regroupe les assertions pour le contrôle."
        />
      </div>
      <div className="mp-grille-champs">
        <Select
          libelle="Rattachement"
          invite="Aucun"
          options={OPTIONS_RATTACHEMENT}
          value={s.rattachement_type}
          onChange={(e) => maj({ rattachement_type: e.target.value, rattachement_code: "" })}
          erreur={f.erreurs.rattachement_type}
        />
        {s.rattachement_type === "dimension" ? (
          <Select
            libelle="Dimension"
            invite="Choisir…"
            options={dimensions
              .filter((d) => d.actif || d.code === s.rattachement_code)
              .map((d) => ({ valeur: d.code, libelle: d.libelle }))}
            value={s.rattachement_code}
            onChange={(e) => maj({ rattachement_code: e.target.value })}
            erreur={f.erreurs.rattachement_code}
          />
        ) : s.rattachement_type !== "" ? (
          <Champ
            libelle={s.rattachement_type === "risque" ? "Risque concerné" : "Hypothèse concernée"}
            maxLength={RATTACHEMENT_CODE_MAX}
            value={s.rattachement_code}
            onChange={(e) => maj({ rattachement_code: e.target.value })}
            erreur={f.erreurs.rattachement_code}
            aide="Référence ou intitulé court."
          />
        ) : null}
      </div>
      <Select
        libelle="Statut"
        options={OPTIONS_STATUT}
        value={s.statut}
        onChange={(e) => maj({ statut: e.target.value })}
        erreur={f.erreurs.statut}
      />
      <fieldset className="mp-groupe-cases">
        <legend>Avis d&apos;expert</legend>
        <CaseACocher
          libelle="Cette assertion est un avis d'expert, sans preuve"
          aide="Il doit être motivé et signé pour compter dans le contrôle des livrables R2 et R3."
          checked={s.avis_expert}
          onChange={(e) =>
            maj({ avis_expert: e.target.checked, signer_avis: e.target.checked && s.signer_avis })
          }
        />
        {s.avis_expert ? (
          <>
            <ZoneTexte
              libelle="Fondement de l'avis"
              required
              rows={2}
              maxLength={AVIS_MOTIF_MAX}
              value={s.avis_expert_motif}
              onChange={(e) => maj({ avis_expert_motif: e.target.value })}
              erreur={f.erreurs.avis_expert_motif}
              aide="Expérience, observation de terrain, référentiel de place…"
            />
            <CaseACocher
              libelle="Je signe cet avis en mon nom"
              aide="La signature porte sur cette version ; une correction ultérieure doit être signée à nouveau."
              checked={s.signer_avis}
              onChange={(e) => maj({ signer_avis: e.target.checked })}
            />
          </>
        ) : null}
      </fieldset>
      {correction ? (
        <ZoneTexte
          libelle="Motif de la correction"
          required
          rows={2}
          maxLength={MOTIF_PREUVE_MAX}
          value={s.motif}
          onChange={(e) => maj({ motif: e.target.value })}
          erreur={f.erreurs.motif}
          aide="Conservé dans l'historique des versions."
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {correction ? "Enregistrer la nouvelle version" : "Enregistrer l'assertion"}
        </Bouton>
      </div>
    </form>
  );
}
