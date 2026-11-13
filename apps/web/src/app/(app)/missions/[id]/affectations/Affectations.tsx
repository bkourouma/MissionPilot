"use client";

import { useState, type FormEvent } from "react";
import { useLangue, useT } from "../../../../../components/i18n/FournisseurLangue";
import { BoutonConfirmation } from "../../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../../components/formulaires/useFormulaire";
import { Alerte } from "../../../../../components/ui/Alerte";
import { Bouton } from "../../../../../components/ui/Bouton";
import { Champ } from "../../../../../components/ui/Champ";
import { Select, type OptionSelect } from "../../../../../components/ui/Select";
import { api } from "../../../../../lib/api";
import { formaterDate } from "../../../../../lib/format";
import {
  SAISIE_AFFECTATION_VIDE,
  saisieDepuisAffectation,
  validerAffectation,
  validerModificationAffectation,
  validerReplanification,
  type Affectation,
  type AvertissementAffectation,
  type ChampAffectation,
  type ReponseAffectation,
  type ResultatReplanification,
  type SaisieAffectation,
} from "../../../../../lib/planification";

export interface TacheChoix extends OptionSelect {
  debut?: string;
  fin?: string;
}

function Avertissements({ liste }: { liste: AvertissementAffectation[] }) {
  const t = useT();
  if (liste.length === 0) return null;
  return (
    <Alerte
      tonalite="attention"
      titre={t(
        "Affectation enregistrée, budget de la tâche dépassé",
        "Assignment saved, task budget exceeded",
      )}
    >
      {liste.map((a) => (
        <p key={a.message}>{a.message}</p>
      ))}
      <p>
        {t(
          "Réduisez les jours alloués ou demandez une révision du budget.",
          "Reduce the allocated days or request a budget revision.",
        )}
      </p>
    </Alerte>
  );
}

/** Création ou modification d'une affectation (PLN-04, PLN-08). */
export function FormulaireAffectation({
  missionId,
  taches,
  collaborateurs,
  grades,
  affectation,
  bornes,
  onTermine,
}: {
  missionId: string;
  taches: TacheChoix[];
  collaborateurs: OptionSelect[];
  grades: OptionSelect[];
  affectation?: Affectation;
  bornes: { min?: string; max?: string };
  onTermine?: () => void;
}) {
  const t = useT();
  const langue = useLangue();
  const [saisie, setSaisie] = useState<SaisieAffectation>(
    affectation ? saisieDepuisAffectation(affectation) : SAISIE_AFFECTATION_VIDE,
  );
  const [avertissements, setAvertissements] = useState<AvertissementAffectation[]>([]);
  const f = useFormulaire<ChampAffectation>();
  const maj = <K extends keyof SaisieAffectation>(k: K, v: SaisieAffectation[K]) =>
    setSaisie((s) => ({ ...s, [k]: v }));
  const base = `/api/missions/${encodeURIComponent(missionId)}/affectations`;

  function choisirTache(id: string) {
    const tache = taches.find((x) => x.valeur === id);
    setSaisie((s) => ({
      ...s,
      tache_id: id,
      date_debut: s.date_debut || tache?.debut || "",
      date_fin: s.date_fin || tache?.fin || "",
    }));
  }

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setAvertissements([]);
    const apres = (r: ReponseAffectation) => {
      setAvertissements(r.avertissements ?? []);
      if (!affectation) setSaisie(SAISIE_AFFECTATION_VIDE);
      if ((r.avertissements ?? []).length === 0) onTermine?.();
    };
    if (affectation) {
      await f.envoyer(
        validerModificationAffectation(saisie, affectation, langue),
        (c) => api.patch<ReponseAffectation>(`${base}/${encodeURIComponent(affectation.id)}`, c),
        { succes: t("Affectation modifiée.", "Assignment updated."), apres },
      );
    } else {
      await f.envoyer(
        validerAffectation(saisie, langue),
        (c) => api.post<ReponseAffectation>(base, c),
        {
          succes: t("Affectation créée.", "Assignment created."),
          apres,
        },
      );
    }
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={
        affectation
          ? t("Modifier l'affectation", "Edit the assignment")
          : t("Nouvelle affectation", "New assignment")
      }
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <Avertissements liste={avertissements} />
      <div className="mp-grille-champs mp-grille-champs--bas">
        <Select
          libelle={t("Tâche", "Task")}
          required
          options={taches}
          invite={t("Choisir la tâche…", "Choose the task…")}
          value={saisie.tache_id}
          onChange={(e) => choisirTache(e.target.value)}
          erreur={f.erreurs.tache_id}
        />
        {affectation ? null : (
          <Select
            libelle={t("Type d'affectation", "Assignment type")}
            options={[
              {
                valeur: "nominative",
                libelle: t("Nominative (une personne)", "Named (one person)"),
              },
              {
                valeur: "profil",
                libelle: t("Profil à pourvoir (grade)", "Profile to fill (grade)"),
              },
            ]}
            value={saisie.mode}
            onChange={(e) => maj("mode", e.target.value as SaisieAffectation["mode"])}
          />
        )}
        {affectation ? null : saisie.mode === "nominative" ? (
          <Select
            libelle={t("Personne", "Person")}
            required
            options={collaborateurs}
            invite={
              collaborateurs.length
                ? t("Choisir…", "Choose…")
                : t("Aucun collaborateur actif", "No active team members")
            }
            value={saisie.collaborateur_id}
            onChange={(e) => maj("collaborateur_id", e.target.value)}
            erreur={f.erreurs.collaborateur_id}
            aide={t(
              "Internes, experts externes et sous-traitants actifs.",
              "Active internal staff, external experts and subcontractors.",
            )}
          />
        ) : (
          <>
            <Select
              libelle={t("Grade recherché", "Grade sought")}
              required
              options={grades}
              invite={t("Choisir le grade…", "Choose the grade…")}
              value={saisie.grade_id}
              onChange={(e) => maj("grade_id", e.target.value)}
              erreur={f.erreurs.grade_id}
            />
            <Champ
              libelle={t("Compétence (facultatif)", "Skill (optional)")}
              maxLength={80}
              value={saisie.competence}
              onChange={(e) => maj("competence", e.target.value)}
              erreur={f.erreurs.competence}
            />
          </>
        )}
        <Champ
          libelle={t("Jours alloués", "Allocated days")}
          required
          inputMode="decimal"
          autoComplete="off"
          value={saisie.jours_alloues}
          onChange={(e) => maj("jours_alloues", e.target.value)}
          erreur={f.erreurs.jours_alloues}
          aide={t(
            "Au pas de saisie du cabinet (ex. 2,5).",
            "In the firm's entry increment (e.g. 2.5).",
          )}
        />
        <Champ
          libelle={t("Du", "From")}
          type="date"
          required
          min={bornes.min}
          max={bornes.max}
          value={saisie.date_debut}
          onChange={(e) => maj("date_debut", e.target.value)}
          erreur={f.erreurs.date_debut}
        />
        <Champ
          libelle={t("Au", "To")}
          type="date"
          required
          min={saisie.date_debut || bornes.min}
          max={bornes.max}
          value={saisie.date_fin}
          onChange={(e) => maj("date_fin", e.target.value)}
          erreur={f.erreurs.date_fin}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone={affectation ? "succes" : "plus"}
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {affectation ? t("Enregistrer", "Save") : t("Affecter", "Assign")}
        </Bouton>
        {onTermine ? (
          <Bouton variante="secondaire" onClick={onTermine} disabled={f.enCours}>
            {t("Fermer", "Close")}
          </Bouton>
        ) : null}
      </div>
    </form>
  );
}

/** Actions d'une affectation : modifier, pourvoir un profil, supprimer. */
export function ActionsAffectation({
  missionId,
  affectation: a,
  taches,
  collaborateurs,
  bornes,
}: {
  missionId: string;
  affectation: Affectation;
  taches: TacheChoix[];
  collaborateurs: OptionSelect[];
  bornes: { min?: string; max?: string };
}) {
  const t = useT();
  const [mode, setMode] = useState<"repos" | "modifier" | "pourvoir">("repos");
  const langue = useLangue();
  const [personne, setPersonne] = useState("");
  const [avertissements, setAvertissements] = useState<AvertissementAffectation[]>([]);
  const f = useFormulaire<"collaborateur_id">();
  const chemin = `/api/missions/${encodeURIComponent(missionId)}/affectations/${encodeURIComponent(a.id)}`;
  const nom = a.a_pourvoir
    ? `${t("profil", "profile")} ${a.grade_libelle ?? ""}`
    : (a.collaborateur_nom ?? t("affectation", "assignment"));

  async function pourvoir(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      personne
        ? { ok: true, charge: { collaborateur_id: personne } }
        : {
            ok: false,
            erreurs: { collaborateur_id: t("Choisissez la personne.", "Choose the person.") },
          },
      (c) => api.post<ReponseAffectation>(`${chemin}/pourvoir`, c),
      {
        succes: t("Profil pourvu.", "Profile filled."),
        apres: (r) => setAvertissements(r.avertissements ?? []),
      },
    );
  }

  if (mode === "modifier") {
    return (
      <FormulaireAffectation
        missionId={missionId}
        taches={taches}
        collaborateurs={collaborateurs}
        grades={[]}
        affectation={a}
        bornes={bornes}
        onTermine={() => setMode("repos")}
      />
    );
  }
  return (
    <div className="mp-pile">
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <Avertissements liste={avertissements} />
      {mode === "pourvoir" ? (
        <form
          ref={f.refFormulaire}
          className="mp-formulaire mp-formulaire--ligne"
          noValidate
          onSubmit={pourvoir}
        >
          <div className="mp-ligne-action">
            <Select
              libelle={t(
                `Pourvoir le profil ${a.grade_libelle ?? ""}`,
                `Fill the profile ${a.grade_libelle ?? ""}`,
              )}
              options={collaborateurs}
              invite={t("Choisir la personne…", "Choose the person…")}
              value={personne}
              onChange={(e) => setPersonne(e.target.value)}
              erreur={f.erreurs.collaborateur_id}
            />
            <Bouton
              type="submit"
              chargement={f.enCours}
              texteChargement={t("Enregistrement…", "Saving…")}
            >
              {t("Pourvoir", "Fill")}
            </Bouton>
            <Bouton variante="secondaire" onClick={() => setMode("repos")}>
              {t("Annuler", "Cancel")}
            </Bouton>
          </div>
        </form>
      ) : (
        <div className="mp-barre-actions mp-barre-actions--compacte">
          <Bouton
            variante="discret"
            icone="crayon"
            aria-label={`${t("Modifier l'affectation", "Edit the assignment")} : ${nom}`}
            onClick={() => setMode("modifier")}
          >
            {t("Modifier", "Edit")}
          </Bouton>
          {a.a_pourvoir ? (
            <Bouton
              variante="discret"
              icone="personnes"
              aria-label={`${t("Pourvoir", "Fill")} : ${nom}`}
              onClick={() => setMode("pourvoir")}
            >
              {t("Pourvoir", "Fill")}
            </Bouton>
          ) : null}
          <BoutonConfirmation
            libelle={t("Supprimer", "Delete")}
            variante="discret"
            icone="corbeille"
            ariaLabel={`${t("Supprimer l'affectation", "Delete the assignment")} : ${nom}`}
            question={t(
              `Supprimer l'affectation (${nom}, ${formaterDate(a.date_debut)} → ${formaterDate(a.date_fin)}) ?`,
              `Delete the assignment (${nom}, ${formaterDate(a.date_debut, "UTC", langue)} → ${formaterDate(a.date_fin, "UTC", langue)})?`,
            )}
            libelleConfirmation={t("Oui, supprimer", "Yes, delete")}
            texteChargement={t("Suppression…", "Deleting…")}
            action={() => f.envoyer({ ok: true, charge: null }, () => api.supprimer(chemin))}
          />
        </div>
      )}
    </div>
  );
}

/** Re-planification d'une phase (PLN-09) : aperçu obligatoire, puis application. */
export function Replanification({
  missionId,
  phases,
}: {
  missionId: string;
  phases: OptionSelect[];
}) {
  const t = useT();
  const langue = useLangue();
  const [phase, setPhase] = useState("");
  const [decalage, setDecalage] = useState("");
  const [apercu, setApercu] = useState<ResultatReplanification | null>(null);
  const [applique, setApplique] = useState<ResultatReplanification | null>(null);
  const f = useFormulaire<"phase_id" | "decalage">();
  const chemin = `/api/missions/${encodeURIComponent(missionId)}/replanifier`;
  const validation = validerReplanification(phase, decalage, langue);

  async function previsualiser(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setApplique(null);
    await f.envoyer(
      validation,
      (c) => api.post<ResultatReplanification>(`${chemin}?apercu=true`, c),
      {
        rafraichir: false,
        apres: setApercu,
      },
    );
  }

  async function appliquer() {
    await f.envoyer(validation, (c) => api.post<ResultatReplanification>(chemin, c), {
      succes: t(
        "Re-planification appliquée : les personnes concernées sont prévenues.",
        "Rescheduling applied: the people concerned have been notified.",
      ),
      apres: (r) => {
        setApplique(r);
        setApercu(null);
      },
    });
  }

  const resultat = apercu ?? applique;
  return (
    <div className="mp-pile">
      <form
        ref={f.refFormulaire}
        className="mp-formulaire"
        noValidate
        onSubmit={previsualiser}
        aria-label={t("Re-planifier une phase", "Reschedule a phase")}
      >
        <RetourFormulaire
          erreur={f.erreurGlobale}
          succes={f.succes}
          refAlerte={f.refAlerte}
          titreErreur={t("Re-planification impossible", "Rescheduling not possible")}
        />
        <div className="mp-grille-champs mp-grille-champs--bas">
          <Select
            libelle={t("Phase à décaler", "Phase to shift")}
            options={phases}
            invite={t("Choisir la phase…", "Choose the phase…")}
            value={phase}
            onChange={(e) => {
              setPhase(e.target.value);
              setApercu(null);
            }}
            erreur={f.erreurs.phase_id}
          />
          <Champ
            libelle={t("Décalage en jours ouvrés", "Offset in business days")}
            inputMode="numeric"
            autoComplete="off"
            value={decalage}
            onChange={(e) => {
              setDecalage(e.target.value);
              setApercu(null);
            }}
            erreur={f.erreurs.decalage}
            aide={t(
              "Positif pour retarder, négatif pour avancer (ex. 3 ou -2).",
              "Positive to delay, negative to advance (e.g. 3 or -2).",
            )}
          />
        </div>
        <div className="mp-actions-formulaire">
          <Bouton
            type="submit"
            variante="secondaire"
            icone="oeil"
            chargement={f.enCours && !apercu}
            texteChargement={t("Calcul…", "Calculating…")}
          >
            {t("Prévisualiser", "Preview")}
          </Bouton>
        </div>
      </form>
      {resultat ? <ResultatReplanif r={resultat} /> : null}
      {apercu && apercu.taches.length > 0 ? (
        <div className="mp-actions-formulaire">
          <Bouton
            icone="calendrier"
            chargement={f.enCours}
            texteChargement={t("Application…", "Applying…")}
            onClick={appliquer}
          >
            {t("Appliquer et prévenir les personnes", "Apply and notify the people")}
          </Bouton>
        </div>
      ) : null}
    </div>
  );
}

function ResultatReplanif({ r }: { r: ResultatReplanification }) {
  const t = useT();
  const langue = useLangue();
  if (r.taches.length === 0) {
    return (
      <Alerte tonalite="info" titre={t("Aucune date ne change", "No date changes")}>
        <p>
          {t(
            "Le décalage est absorbé (dépendances ou calendrier) : rien à appliquer.",
            "The offset is absorbed (dependencies or calendar): nothing to apply.",
          )}
        </p>
      </Alerte>
    );
  }
  return (
    <section
      className="mp-pile"
      aria-label={
        r.apercu
          ? t("Aperçu de la re-planification", "Rescheduling preview")
          : t("Re-planification appliquée", "Rescheduling applied")
      }
    >
      <h3 className="mp-sous-formulaire__titre">
        {r.apercu
          ? t("Aperçu : rien n'est encore modifié", "Preview: nothing has been changed yet")
          : t("Re-planification appliquée", "Rescheduling applied")}
      </h3>
      <ul className="mp-liste-lignes">
        {r.taches.map((x) => (
          <li key={x.id} className="mp-liste-lignes__ligne">
            <span className="mp-liste-lignes__texte">
              <strong>{x.libelle ?? t("Tâche", "Task")}</strong>
              <span className="mp-texte-doux">
                {t(
                  `${formaterDate(x.avant.debut)} → ${formaterDate(x.avant.fin)} devient ${formaterDate(x.apres.debut)} → ${formaterDate(x.apres.fin)}`,
                  `${formaterDate(x.avant.debut, "UTC", langue)} → ${formaterDate(x.avant.fin, "UTC", langue)} becomes ${formaterDate(x.apres.debut, "UTC", langue)} → ${formaterDate(x.apres.fin, "UTC", langue)}`,
                )}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p>
        {t(
          `${r.affectations.length} affectation(s) recalée(s). `,
          `${r.affectations.length} assignment(s) rescheduled. `,
        )}
        {r.personnes.length === 0
          ? t("Aucune personne à prévenir.", "No one to notify.")
          : t(
              `Personnes ${r.apercu ? "qui seront prévenues" : "prévenues"} : ${r.personnes.map((p) => p.nom ?? "Collaborateur").join(", ")}.`,
              `People ${r.apercu ? "who will be notified" : "notified"}: ${r.personnes.map((p) => p.nom ?? "Team member").join(", ")}.`,
            )}
      </p>
    </section>
  );
}
