"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { TYPES_SOURCE_PREUVE } from "@missionpilot/shared";
import { api } from "../../lib/api";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import {
  cheminPreuvesMission,
  cheminVersionsPreuve,
  hrefPreuve,
  libelleFiabiliteApi,
  libelleTypeSourcePreuve,
  messagePreuves,
  type DetailPreuve,
  type DimensionVue,
  type PreuveVue,
} from "../../lib/preuves";
import {
  EXTRAIT_MAX,
  MOTIF_PREUVE_MAX,
  saisiePreuveVide,
  SOURCE_MAX,
  validerPreuve,
  type ChampPreuve,
  type SaisiePreuve,
  type TypeLienPreuve,
} from "../../lib/preuves-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

function saisieDepuis(p: PreuveVue): SaisiePreuve {
  const lien: { lien_type: TypeLienPreuve; lien_id: string } = p.document_id
    ? { lien_type: "document", lien_id: p.document_id }
    : p.fichier_id
      ? { lien_type: "fichier", lien_id: p.fichier_id }
      : p.reponse_id
        ? { lien_type: "reponse", lien_id: p.reponse_id }
        : { lien_type: "aucun", lien_id: "" };
  return {
    type_source: p.type_source,
    source_precise: p.source_precise,
    date_preuve: p.date_preuve,
    auteur_id: p.auteur.id,
    fiabilite: p.fiabilite,
    extrait: p.extrait ?? "",
    ...lien,
    dimensions: p.dimensions,
    nominatif: p.nominatif,
    accord_nominatif: p.accord_nominatif,
    motif: "",
  };
}

export interface FormulairePreuveProps {
  missionId: string;
  dimensions: readonly DimensionVue[];
  aujourdhui: string;
  /** Présente : correction de cette preuve (nouvelle version, motif exigé). */
  preuve?: PreuveVue;
}

/**
 * Enregistrement d'une preuve ou correction d'une preuve existante. Une preuve ne s'écrase
 * jamais : la correction crée une nouvelle version, l'ancienne reste consultable.
 */
export function FormulairePreuve({
  missionId,
  dimensions,
  aujourdhui,
  preuve,
}: FormulairePreuveProps) {
  const router = useRouter();
  const t = useT();
  const langue = useLangue();
  const optionsType = TYPES_SOURCE_PREUVE.map((type) => ({
    valeur: type,
    libelle: libelleTypeSourcePreuve(type, langue),
  }));
  const optionsFiabilite = (["A", "B", "C", "D"] as const).map((fi) => ({
    valeur: fi,
    libelle: libelleFiabiliteApi(fi, langue),
  }));
  const optionsLien: { valeur: TypeLienPreuve; libelle: string }[] = [
    { valeur: "aucun", libelle: t("Aucun", "None") },
    { valeur: "document", libelle: t("Document de la mission", "Engagement document") },
    { valeur: "fichier", libelle: t("Fichier téléversé", "Uploaded file") },
    { valeur: "reponse", libelle: t("Réponse de questionnaire", "Questionnaire answer") },
  ];
  const correction = preuve !== undefined;
  const f = useFormulaire<ChampPreuve>();
  const [s, setS] = useState<SaisiePreuve>(
    preuve && !preuve.masque ? saisieDepuis(preuve) : saisiePreuveVide(aujourdhui),
  );
  const maj = (partiel: Partial<SaisiePreuve>) => setS((x) => ({ ...x, ...partiel }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerPreuve(s, correction, langue),
      (charge) =>
        correction
          ? api.post<DetailPreuve>(cheminVersionsPreuve(preuve.id), charge)
          : api.post<DetailPreuve>(cheminPreuvesMission(missionId), charge),
      {
        succes: correction
          ? t(
              "Nouvelle version enregistrée ; l'ancienne reste dans l'historique.",
              "New version saved; the previous one stays in the history.",
            )
          : t("Preuve enregistrée.", "Evidence saved."),
        messageSpecifique: (e) => messagePreuves(e, langue),
        apres: (r) => {
          if (!correction) router.push(hrefPreuve(missionId, r.id));
        },
      },
    );
  }

  const dimensionsActives = dimensions.filter((d) => d.actif || s.dimensions.includes(d.code));

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={
        correction
          ? t("Corriger la preuve", "Correct the evidence")
          : t("Nouvelle preuve", "New evidence")
      }
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Preuve refusée", "Evidence rejected")}
      />
      <div className="mp-grille-champs">
        <Select
          libelle={t("Type de source", "Source type")}
          required
          invite={t("Choisir…", "Choose…")}
          options={optionsType}
          value={s.type_source}
          onChange={(e) => maj({ type_source: e.target.value })}
          erreur={f.erreurs.type_source}
          aide={t(
            "Les sources de types différents sont indépendantes : c'est ce qui fonde la triangulation.",
            "Sources of different types are independent: this is what underpins triangulation.",
          )}
        />
        <Select
          libelle={t("Fiabilité", "Reliability")}
          required
          invite={t("Choisir…", "Choose…")}
          options={optionsFiabilite}
          value={s.fiabilite}
          onChange={(e) => maj({ fiabilite: e.target.value })}
          erreur={f.erreurs.fiabilite}
          aide={t(
            "A : très fiable, D : peu fiable. À justifier dans le motif si elle change.",
            "A: highly reliable, D: low reliability. Justify in the reason if it changes.",
          )}
        />
      </div>
      <Champ
        libelle={t("Source précise", "Specific source")}
        required
        maxLength={SOURCE_MAX}
        value={s.source_precise}
        onChange={(e) => maj({ source_precise: e.target.value })}
        erreur={f.erreurs.source_precise}
        aide={t(
          "Qui, quoi, où : « Entretien avec la direction financière », « Rapport annuel 2025, p. 14 ».",
          'Who, what, where: "Interview with the finance department", "2025 annual report, p. 14".',
        )}
      />
      <Champ
        libelle={t("Date de la preuve", "Evidence date")}
        type="date"
        required
        value={s.date_preuve}
        onChange={(e) => maj({ date_preuve: e.target.value })}
        erreur={f.erreurs.date_preuve}
      />
      <ZoneTexte
        libelle={t("Extrait", "Excerpt")}
        rows={4}
        maxLength={EXTRAIT_MAX}
        value={s.extrait}
        onChange={(e) => maj({ extrait: e.target.value })}
        erreur={f.erreurs.extrait}
        aide={t(
          "Verbatim, donnée ou passage cité. Facultatif si la preuve est un fichier.",
          "Verbatim, data or quoted passage. Optional if the evidence is a file.",
        )}
      />
      <div className="mp-grille-champs">
        <Select
          libelle={t("Lien vers un élément existant", "Link to an existing item")}
          options={optionsLien}
          value={s.lien_type}
          onChange={(e) => maj({ lien_type: e.target.value as TypeLienPreuve, lien_id: "" })}
          aide={t("Un seul lien par preuve.", "One link per piece of evidence.")}
        />
        {s.lien_type !== "aucun" ? (
          <Champ
            libelle={t("Identifiant de l'élément", "Item ID")}
            autoComplete="off"
            value={s.lien_id}
            onChange={(e) => maj({ lien_id: e.target.value })}
            erreur={f.erreurs.lien_id}
            aide={t(
              "Copiez l'identifiant depuis l'élément concerné.",
              "Copy the ID from the item concerned.",
            )}
          />
        ) : null}
      </div>
      {dimensionsActives.length > 0 ? (
        <fieldset className="mp-groupe-cases">
          <legend>{t("Dimensions éclairées", "Dimensions covered")}</legend>
          {dimensionsActives.map((d) => (
            <CaseACocher
              key={d.code}
              libelle={d.actif ? d.libelle : `${d.libelle} ${t("(désactivée)", "(deactivated)")}`}
              checked={s.dimensions.includes(d.code)}
              onChange={(e) =>
                maj({
                  dimensions: e.target.checked
                    ? [...s.dimensions, d.code]
                    : s.dimensions.filter((c) => c !== d.code),
                })
              }
            />
          ))}
          {f.erreurs.dimensions ? <p className="mp-champ__erreur">{f.erreurs.dimensions}</p> : null}
        </fieldset>
      ) : (
        <p className="mp-texte-doux">
          {t(
            "Aucune dimension n'est déclarée pour cette mission : déclarez-les dans l'onglet « Triangulation » pour rattacher les preuves.",
            'No dimension is declared for this engagement: declare them in the "Triangulation" tab to link evidence.',
          )}
        </p>
      )}
      <fieldset className="mp-groupe-cases">
        <legend>{t("Verbatim nominatif", "Named verbatim")}</legend>
        <CaseACocher
          libelle={t("L'extrait identifie une personne", "The excerpt identifies a person")}
          aide={t(
            "Sans l'accord de la personne, l'extrait est masqué pour les membres de l'équipe qui ne l'ont pas recueilli.",
            "Without the person's consent, the excerpt is hidden from team members who did not collect it.",
          )}
          checked={s.nominatif}
          onChange={(e) =>
            maj({
              nominatif: e.target.checked,
              accord_nominatif: e.target.checked && s.accord_nominatif,
            })
          }
        />
        {s.nominatif ? (
          <CaseACocher
            libelle={t(
              "La personne a donné son accord pour que l'extrait soit cité",
              "The person has agreed to the excerpt being quoted",
            )}
            checked={s.accord_nominatif}
            onChange={(e) => maj({ accord_nominatif: e.target.checked })}
          />
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
          aide={t(
            "Conservé dans l'historique. Corriger une preuve rouvre les contradictions qu'elle concerne.",
            "Kept in the history. Correcting evidence reopens the contradictions it relates to.",
          )}
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
            : t("Enregistrer la preuve", "Save the evidence")}
        </Bouton>
      </div>
    </form>
  );
}
