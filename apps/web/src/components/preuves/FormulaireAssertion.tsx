"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  CLASSES_RISQUE,
  RATTACHEMENTS_ASSERTION,
  STATUTS_ASSERTION as STATUTS,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import {
  cheminAssertionsMission,
  cheminVersionsAssertion,
  hrefAssertion,
  libelleClasseRisque,
  libelleRattachement,
  libelleStatutAssertion,
  messagePreuves,
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
  /** Expert métier ou associé : peut signer l'avis d'expert (l'API le vérifie, MPV04). */
  peutSigner?: boolean;
}

/**
 * Assertion : conclusion à écrire dans un livrable, sa classe de risque et, à défaut de preuve,
 * son « avis d'expert » signé. L'indice de solidité n'est jamais saisi : il vient du moteur.
 */
export function FormulaireAssertion({
  missionId,
  dimensions,
  assertion,
  peutSigner = false,
}: FormulaireAssertionProps) {
  const router = useRouter();
  const t = useT();
  const langue = useLangue();
  const optionsClasse = CLASSES_RISQUE.map((c) => ({
    valeur: c,
    libelle: libelleClasseRisque(c, langue),
  }));
  const optionsStatut = STATUTS.map((s) => ({
    valeur: s,
    libelle: libelleStatutAssertion(s, langue),
  }));
  const optionsRattachement = RATTACHEMENTS_ASSERTION.map((r) => ({
    valeur: r,
    libelle: libelleRattachement(r, langue),
  }));
  const correction = assertion !== undefined;
  const f = useFormulaire<ChampAssertion>();
  const [s, setS] = useState<SaisieAssertion>(
    assertion ? saisieDepuis(assertion) : saisieAssertionVide(),
  );
  const maj = (partiel: Partial<SaisieAssertion>) => setS((x) => ({ ...x, ...partiel }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerAssertion(s, correction, langue),
      (charge) =>
        correction
          ? api.post<DetailAssertion>(cheminVersionsAssertion(assertion.id), charge)
          : api.post<DetailAssertion>(cheminAssertionsMission(missionId), charge),
      {
        succes: correction
          ? t(
              "Nouvelle version enregistrée ; l'ancienne reste dans l'historique.",
              "New version saved; the previous one stays in the history.",
            )
          : t("Assertion enregistrée.", "Assertion saved."),
        messageSpecifique: (e) => messagePreuves(e, langue),
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
      aria-label={
        correction
          ? t("Corriger l'assertion", "Correct the assertion")
          : t("Nouvelle assertion", "New assertion")
      }
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Assertion refusée", "Assertion rejected")}
      />
      <ZoneTexte
        libelle={t("Assertion", "Assertion")}
        required
        rows={3}
        maxLength={ENONCE_MAX}
        value={s.enonce}
        onChange={(e) => maj({ enonce: e.target.value })}
        erreur={f.erreurs.enonce}
        aide={t(
          "La conclusion que vous voulez écrire dans le livrable, en une phrase vérifiable.",
          "The conclusion you want to write in the deliverable, in one verifiable sentence.",
        )}
      />
      <div className="mp-grille-champs">
        <Select
          libelle={t("Classe de risque du livrable cible", "Risk class of the target deliverable")}
          required
          invite={t("Choisir…", "Choose…")}
          options={optionsClasse}
          value={s.classe_risque}
          onChange={(e) => maj({ classe_risque: e.target.value })}
          erreur={f.erreurs.classe_risque}
          aide={t(
            "R2 et R3 : chaque assertion doit reposer sur une preuve ou sur un avis d'expert signé.",
            "R2 and R3: each assertion must rest on evidence or on a signed expert opinion.",
          )}
        />
        <Champ
          libelle={t("Livrable cible", "Target deliverable")}
          maxLength={LIVRABLE_MAX}
          value={s.livrable}
          onChange={(e) => maj({ livrable: e.target.value })}
          erreur={f.erreurs.livrable}
          aide={t(
            "Facultatif : le nom du livrable regroupe les assertions pour le contrôle.",
            "Optional: the deliverable name groups assertions for the check.",
          )}
        />
      </div>
      <div className="mp-grille-champs">
        <Select
          libelle={t("Rattachement", "Link target")}
          invite={t("Aucun", "None")}
          options={optionsRattachement}
          value={s.rattachement_type}
          onChange={(e) => maj({ rattachement_type: e.target.value, rattachement_code: "" })}
          erreur={f.erreurs.rattachement_type}
        />
        {s.rattachement_type === "dimension" ? (
          <Select
            libelle={t("Dimension", "Dimension")}
            invite={t("Choisir…", "Choose…")}
            options={dimensions
              .filter((d) => d.actif || d.code === s.rattachement_code)
              .map((d) => ({ valeur: d.code, libelle: d.libelle }))}
            value={s.rattachement_code}
            onChange={(e) => maj({ rattachement_code: e.target.value })}
            erreur={f.erreurs.rattachement_code}
          />
        ) : s.rattachement_type !== "" ? (
          <Champ
            libelle={
              s.rattachement_type === "risque"
                ? t("Risque concerné", "Risk concerned")
                : t("Hypothèse concernée", "Hypothesis concerned")
            }
            maxLength={RATTACHEMENT_CODE_MAX}
            value={s.rattachement_code}
            onChange={(e) => maj({ rattachement_code: e.target.value })}
            erreur={f.erreurs.rattachement_code}
            aide={t("Référence ou intitulé court.", "Reference or short title.")}
          />
        ) : null}
      </div>
      <Select
        libelle={t("Statut", "Status")}
        options={optionsStatut}
        value={s.statut}
        onChange={(e) => maj({ statut: e.target.value })}
        erreur={f.erreurs.statut}
      />
      <fieldset className="mp-groupe-cases">
        <legend>{t("Avis d'expert", "Expert opinion")}</legend>
        <CaseACocher
          libelle={t(
            "Cette assertion est un avis d'expert, sans preuve",
            "This assertion is an expert opinion, with no evidence",
          )}
          aide={t(
            "Il doit être motivé et signé pour compter dans le contrôle des livrables R2 et R3.",
            "It must be justified and signed to count in the check of R2 and R3 deliverables.",
          )}
          checked={s.avis_expert}
          onChange={(e) =>
            maj({ avis_expert: e.target.checked, signer_avis: e.target.checked && s.signer_avis })
          }
        />
        {s.avis_expert ? (
          <>
            <ZoneTexte
              libelle={t("Fondement de l'avis", "Basis of the opinion")}
              required
              rows={2}
              maxLength={AVIS_MOTIF_MAX}
              value={s.avis_expert_motif}
              onChange={(e) => maj({ avis_expert_motif: e.target.value })}
              erreur={f.erreurs.avis_expert_motif}
              aide={t(
                "Expérience, observation de terrain, référentiel de place…",
                "Experience, field observation, market framework…",
              )}
            />
            {peutSigner ? (
              <CaseACocher
                libelle={t("Je signe cet avis en mon nom", "I sign this opinion in my name")}
                aide={t(
                  "La signature porte sur cette version ; une correction ultérieure doit être signée à nouveau.",
                  "The signature applies to this version; a later correction must be signed again.",
                )}
                checked={s.signer_avis}
                onChange={(e) => maj({ signer_avis: e.target.checked })}
              />
            ) : (
              <p className="mp-texte-doux mp-texte-petit">
                {t(
                  "La signature d'un avis d'expert revient à un expert métier ou à un associé.",
                  "Signing an expert opinion is reserved for a subject-matter expert or a partner.",
                )}
              </p>
            )}
          </>
        ) : null}
      </fieldset>
      {correction ? (
        <ZoneTexte
          libelle={t("Motif de la correction", "Reason for the correction")}
          required
          rows={2}
          maxLength={MOTIF_PREUVE_MAX}
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
            : t("Enregistrer l'assertion", "Save the assertion")}
        </Bouton>
      </div>
    </form>
  );
}
