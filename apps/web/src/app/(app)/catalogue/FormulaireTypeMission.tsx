"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../components/formulaires/useFormulaire";
import { Bouton, classesBouton } from "../../../components/ui/Bouton";
import { CaseACocher } from "../../../components/ui/CaseACocher";
import { Champ } from "../../../components/ui/Champ";
import { Select } from "../../../components/ui/Select";
import { useLangue, useT } from "../../../components/i18n/FournisseurLangue";
import { api } from "../../../lib/api";
import {
  optionsModes,
  SAISIE_TYPE_VIDE,
  saisieDepuisType,
  validerTypeMission,
  type ChampTypeMission,
  type SaisieTypeMission,
  type TypeMission,
} from "../../../lib/catalogue";

export interface FormulaireTypeMissionProps {
  type?: TypeMission;
  grades: { code: string; libelle: string }[];
}

export function FormulaireTypeMission({ type, grades }: FormulaireTypeMissionProps) {
  const router = useRouter();
  const t = useT();
  const langue = useLangue();
  const [s, setS] = useState<SaisieTypeMission>(() =>
    type ? saisieDepuisType(type) : SAISIE_TYPE_VIDE,
  );
  const f = useFormulaire<ChampTypeMission>();
  const maj =
    (k: "code" | "libelle" | "domaine" | "mode_facturation" | "duree_type_jours") =>
    (e: { target: { value: string } }) =>
      setS((x) => ({ ...x, [k]: e.target.value }));
  // Grades de l'équipe type déjà saisis mais absents de la liste (grade supprimé ou renommé).
  const gradesEquipe = [
    ...grades,
    ...Object.keys(s.equipe)
      .filter((c) => !grades.some((g) => g.code === c))
      .map((c) => ({ code: c, libelle: c })),
  ];

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerTypeMission(s, langue),
      (charge) =>
        type
          ? api.patch<TypeMission>(`/api/types-mission/${encodeURIComponent(type.id)}`, charge)
          : api.post<TypeMission>("/api/types-mission", charge),
      { rafraichir: false, apres: (cree) => router.push(`/catalogue/${cree.id}`) },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Libellé", "Label")}
          name="libelle"
          required
          maxLength={160}
          value={s.libelle}
          onChange={maj("libelle")}
          erreur={f.erreurs.libelle}
          aide={t(
            "Ex. Plan stratégique, Audit organisationnel.",
            "E.g. Strategic plan, Organizational audit.",
          )}
        />
        <Champ
          libelle={t("Code", "Code")}
          name="code"
          required
          maxLength={40}
          autoCapitalize="none"
          spellCheck={false}
          value={s.code}
          onChange={maj("code")}
          erreur={f.erreurs.code}
          aide={t(
            "Identifiant stable : minuscules, chiffres et tiret bas (ex. plan_strategique).",
            "Stable identifier: lowercase letters, digits and underscores (e.g. strategic_plan).",
          )}
        />
        <Champ
          libelle={t("Domaine", "Domain")}
          name="domaine"
          maxLength={120}
          value={s.domaine}
          onChange={maj("domaine")}
          erreur={f.erreurs.domaine}
          aide={t("Ex. Stratégie, Organisation, Finance.", "E.g. Strategy, Organization, Finance.")}
        />
        <Select
          libelle={t("Mode de facturation", "Billing mode")}
          name="mode_facturation"
          required
          options={optionsModes(langue)}
          value={s.mode_facturation}
          onChange={maj("mode_facturation")}
          erreur={f.erreurs.mode_facturation}
        />
        <Champ
          libelle={t("Durée type (jours calendaires)", "Typical duration (calendar days)")}
          name="duree_type_jours"
          inputMode="numeric"
          value={s.duree_type_jours}
          onChange={maj("duree_type_jours")}
          erreur={f.erreurs.duree_type_jours}
          aide={t("Facultatif, ex. 90.", "Optional, e.g. 90.")}
        />
      </div>
      <fieldset className="mp-groupe">
        <legend className="mp-champ__libelle">{t("Équipe type", "Typical team")}</legend>
        <p className="mp-champ__aide">
          {gradesEquipe.length === 0
            ? t(
                "Aucun grade n'est défini : créez les grades du cabinet pour composer l'équipe type.",
                "No grade is defined: create the firm's grades to build the typical team.",
              )
            : t(
                "Nombre de collaborateurs par grade. Laisser vide si le grade n'intervient pas.",
                "Number of staff per grade. Leave empty if the grade is not involved.",
              )}
        </p>
        {gradesEquipe.length > 0 ? (
          <div className="mp-grille-champs mp-grille-champs--serree">
            {gradesEquipe.map((g) => (
              <Champ
                key={g.code}
                libelle={g.libelle}
                name={`equipe-${g.code}`}
                inputMode="numeric"
                value={s.equipe[g.code] ?? ""}
                onChange={(e) =>
                  setS((x) => ({ ...x, equipe: { ...x.equipe, [g.code]: e.target.value } }))
                }
                erreur={f.erreurs[`equipe.${g.code}`]}
                autoComplete="off"
              />
            ))}
          </div>
        ) : null}
      </fieldset>
      <CaseACocher
        libelle={t("Type actif", "Active type")}
        aide={t(
          "Un type archivé n'est plus proposé à la création de missions.",
          "An archived type is no longer offered when creating engagements.",
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
          {type
            ? t("Enregistrer les modifications", "Save changes")
            : t("Créer le type de mission", "Create engagement type")}
        </Bouton>
        <Link
          href={type ? `/catalogue/${type.id}` : "/catalogue"}
          className={classesBouton("discret")}
        >
          {t("Annuler", "Cancel")}
        </Link>
      </div>
    </form>
  );
}
