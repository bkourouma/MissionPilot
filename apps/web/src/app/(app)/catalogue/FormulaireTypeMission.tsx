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
import { api } from "../../../lib/api";
import {
  OPTIONS_MODES,
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
      validerTypeMission(s),
      (charge) =>
        type
          ? api.patch<TypeMission>(`/api/types-mission/${encodeURIComponent(type.id)}`, charge)
          : api.post<TypeMission>("/api/types-mission", charge),
      { rafraichir: false, apres: (t) => router.push(`/catalogue/${t.id}`) },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle="Libellé"
          name="libelle"
          required
          maxLength={160}
          value={s.libelle}
          onChange={maj("libelle")}
          erreur={f.erreurs.libelle}
          aide="Ex. Plan stratégique, Audit organisationnel."
        />
        <Champ
          libelle="Code"
          name="code"
          required
          maxLength={40}
          autoCapitalize="none"
          spellCheck={false}
          value={s.code}
          onChange={maj("code")}
          erreur={f.erreurs.code}
          aide="Identifiant stable : minuscules, chiffres et tiret bas (ex. plan_strategique)."
        />
        <Champ
          libelle="Domaine"
          name="domaine"
          maxLength={120}
          value={s.domaine}
          onChange={maj("domaine")}
          erreur={f.erreurs.domaine}
          aide="Ex. Stratégie, Organisation, Finance."
        />
        <Select
          libelle="Mode de facturation"
          name="mode_facturation"
          required
          options={OPTIONS_MODES}
          value={s.mode_facturation}
          onChange={maj("mode_facturation")}
          erreur={f.erreurs.mode_facturation}
        />
        <Champ
          libelle="Durée type (jours calendaires)"
          name="duree_type_jours"
          inputMode="numeric"
          value={s.duree_type_jours}
          onChange={maj("duree_type_jours")}
          erreur={f.erreurs.duree_type_jours}
          aide="Facultatif, ex. 90."
        />
      </div>
      <fieldset className="mp-groupe">
        <legend className="mp-champ__libelle">Équipe type</legend>
        <p className="mp-champ__aide">
          {gradesEquipe.length === 0
            ? "Aucun grade n'est défini : créez les grades du cabinet pour composer l'équipe type."
            : "Nombre de collaborateurs par grade. Laisser vide si le grade n'intervient pas."}
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
        libelle="Type actif"
        aide="Un type archivé n'est plus proposé à la création de missions."
        checked={s.actif}
        onChange={(e) => setS((x) => ({ ...x, actif: e.target.checked }))}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {type ? "Enregistrer les modifications" : "Créer le type de mission"}
        </Bouton>
        <Link
          href={type ? `/catalogue/${type.id}` : "/catalogue"}
          className={classesBouton("discret")}
        >
          Annuler
        </Link>
      </div>
    </form>
  );
}
