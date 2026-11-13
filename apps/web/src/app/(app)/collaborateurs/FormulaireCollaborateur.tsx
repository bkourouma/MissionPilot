"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../components/formulaires/useFormulaire";
import { useLangue, useT } from "../../../components/i18n/FournisseurLangue";
import { Bouton, classesBouton } from "../../../components/ui/Bouton";
import { Champ } from "../../../components/ui/Champ";
import { Select } from "../../../components/ui/Select";
import { api } from "../../../lib/api";
import {
  optionsTypes,
  SAISIE_COLLABORATEUR_VIDE,
  saisieDepuisCollaborateur,
  validerCollaborateur,
  type ChampCollaborateur,
  type Collaborateur,
  type Grade,
  type SaisieCollaborateur,
} from "../../../lib/collaborateurs";

export interface FormulaireCollaborateurProps {
  collaborateur?: Collaborateur;
  /** Grades actifs ; `null` si la liste n'a pas pu être chargée. */
  grades: Grade[] | null;
}

/** Fiche non financière : aucun coût ni taux dans ce formulaire (FIN-02). */
export function FormulaireCollaborateur({ collaborateur, grades }: FormulaireCollaborateurProps) {
  const router = useRouter();
  const t = useT();
  const langue = useLangue();
  const [s, setS] = useState<SaisieCollaborateur>(() =>
    collaborateur ? saisieDepuisCollaborateur(collaborateur) : SAISIE_COLLABORATEUR_VIDE,
  );
  const f = useFormulaire<ChampCollaborateur>();
  const maj = (k: ChampCollaborateur) => (e: { target: { value: string } }) =>
    setS((x) => ({ ...x, [k]: e.target.value }));
  const optionsGrades = (grades ?? []).map((g) => ({ valeur: g.id, libelle: g.libelle }));
  if (collaborateur?.grade_id && !optionsGrades.some((o) => o.valeur === collaborateur.grade_id)) {
    optionsGrades.unshift({
      valeur: collaborateur.grade_id,
      libelle: collaborateur.grade_libelle ?? t("Grade actuel", "Current grade"),
    });
  }

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerCollaborateur(s, langue),
      (charge) =>
        collaborateur
          ? api.patch<Collaborateur>(
              `/api/collaborateurs/${encodeURIComponent(collaborateur.id)}`,
              charge,
            )
          : api.post<Collaborateur>("/api/collaborateurs", charge),
      { rafraichir: false, apres: (c) => router.push(`/collaborateurs/${c.id}`) },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Nom complet", "Full name")}
          name="nom"
          required
          maxLength={160}
          value={s.nom}
          onChange={maj("nom")}
          erreur={f.erreurs.nom}
          autoComplete="off"
        />
        <Select
          libelle={t("Grade", "Grade")}
          name="grade_id"
          invite={t("Sans grade", "No grade")}
          options={optionsGrades}
          value={s.grade_id}
          onChange={maj("grade_id")}
          erreur={f.erreurs.grade_id}
          aide={
            grades === null
              ? t(
                  "La liste des grades n'a pas pu être chargée : le grade actuel est conservé.",
                  "The list of grades could not be loaded: the current grade is kept.",
                )
              : undefined
          }
        />
        <Select
          libelle={t("Type", "Type")}
          name="type"
          required
          options={optionsTypes(langue)}
          value={s.type}
          onChange={maj("type")}
          erreur={f.erreurs.type}
        />
        <Champ
          libelle={t("Capacité (%)", "Capacity (%)")}
          name="capacite_pct"
          required
          inputMode="numeric"
          value={s.capacite_pct}
          onChange={maj("capacite_pct")}
          erreur={f.erreurs.capacite_pct}
          aide={t(
            "Part du temps disponible pour les missions : 100 à temps plein, 50 à mi-temps.",
            "Share of time available for engagements: 100 for full time, 50 for half time.",
          )}
        />
      </div>
      <Champ
        libelle={t("Compétences", "Skills")}
        name="competences"
        value={s.competences}
        onChange={maj("competences")}
        erreur={f.erreurs.competences}
        aide={t(
          "Séparées par des virgules, ex. stratégie, finance d'entreprise, SYSCOHADA.",
          "Separated by commas, e.g. strategy, corporate finance, SYSCOHADA.",
        )}
      />
      <Champ
        libelle={t("Secteurs", "Sectors")}
        name="secteurs"
        value={s.secteurs}
        onChange={maj("secteurs")}
        erreur={f.erreurs.secteurs}
        aide={t(
          "Séparés par des virgules, ex. banque, agro-industrie.",
          "Separated by commas, e.g. banking, agribusiness.",
        )}
      />
      <Champ
        libelle={t("Langues", "Languages")}
        name="langues"
        value={s.langues}
        onChange={maj("langues")}
        erreur={f.erreurs.langues}
        aide={t(
          "Séparées par des virgules, ex. français, anglais, wolof.",
          "Separated by commas, e.g. French, English, Wolof.",
        )}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {collaborateur
            ? t("Enregistrer les modifications", "Save changes")
            : t("Créer le collaborateur", "Create team member")}
        </Bouton>
        <Link
          href={collaborateur ? `/collaborateurs/${collaborateur.id}` : "/collaborateurs"}
          className={classesBouton("discret")}
        >
          {t("Annuler", "Cancel")}
        </Link>
      </div>
    </form>
  );
}
