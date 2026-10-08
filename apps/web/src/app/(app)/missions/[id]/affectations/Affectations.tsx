"use client";

import { useState, type FormEvent } from "react";
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
  if (liste.length === 0) return null;
  return (
    <Alerte tonalite="attention" titre="Affectation enregistrée, budget de la tâche dépassé">
      {liste.map((a) => (
        <p key={a.message}>{a.message}</p>
      ))}
      <p>Réduisez les jours alloués ou demandez une révision du budget.</p>
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
  const [saisie, setSaisie] = useState<SaisieAffectation>(
    affectation ? saisieDepuisAffectation(affectation) : SAISIE_AFFECTATION_VIDE,
  );
  const [avertissements, setAvertissements] = useState<AvertissementAffectation[]>([]);
  const f = useFormulaire<ChampAffectation>();
  const maj = <K extends keyof SaisieAffectation>(k: K, v: SaisieAffectation[K]) =>
    setSaisie((s) => ({ ...s, [k]: v }));
  const base = `/api/missions/${encodeURIComponent(missionId)}/affectations`;

  function choisirTache(id: string) {
    const t = taches.find((x) => x.valeur === id);
    setSaisie((s) => ({
      ...s,
      tache_id: id,
      date_debut: s.date_debut || t?.debut || "",
      date_fin: s.date_fin || t?.fin || "",
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
        validerModificationAffectation(saisie, affectation),
        (c) => api.patch<ReponseAffectation>(`${base}/${encodeURIComponent(affectation.id)}`, c),
        { succes: "Affectation modifiée.", apres },
      );
    } else {
      await f.envoyer(validerAffectation(saisie), (c) => api.post<ReponseAffectation>(base, c), {
        succes: "Affectation créée.",
        apres,
      });
    }
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={affectation ? "Modifier l'affectation" : "Nouvelle affectation"}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <Avertissements liste={avertissements} />
      <div className="mp-grille-champs">
        <Select
          libelle="Tâche"
          required
          options={taches}
          invite="Choisir la tâche…"
          value={saisie.tache_id}
          onChange={(e) => choisirTache(e.target.value)}
          erreur={f.erreurs.tache_id}
        />
        {affectation ? null : (
          <Select
            libelle="Type d'affectation"
            options={[
              { valeur: "nominative", libelle: "Nominative (une personne)" },
              { valeur: "profil", libelle: "Profil à pourvoir (grade)" },
            ]}
            value={saisie.mode}
            onChange={(e) => maj("mode", e.target.value as SaisieAffectation["mode"])}
          />
        )}
        {affectation ? null : saisie.mode === "nominative" ? (
          <Select
            libelle="Personne"
            required
            options={collaborateurs}
            invite={collaborateurs.length ? "Choisir…" : "Aucun collaborateur actif"}
            value={saisie.collaborateur_id}
            onChange={(e) => maj("collaborateur_id", e.target.value)}
            erreur={f.erreurs.collaborateur_id}
            aide="Internes, experts externes et sous-traitants actifs."
          />
        ) : (
          <>
            <Select
              libelle="Grade recherché"
              required
              options={grades}
              invite="Choisir le grade…"
              value={saisie.grade_id}
              onChange={(e) => maj("grade_id", e.target.value)}
              erreur={f.erreurs.grade_id}
            />
            <Champ
              libelle="Compétence (facultatif)"
              maxLength={80}
              value={saisie.competence}
              onChange={(e) => maj("competence", e.target.value)}
              erreur={f.erreurs.competence}
            />
          </>
        )}
        <Champ
          libelle="Jours alloués"
          required
          inputMode="decimal"
          autoComplete="off"
          value={saisie.jours_alloues}
          onChange={(e) => maj("jours_alloues", e.target.value)}
          erreur={f.erreurs.jours_alloues}
          aide="Au pas de saisie du cabinet (ex. 2,5)."
        />
        <Champ
          libelle="Du"
          type="date"
          required
          min={bornes.min}
          max={bornes.max}
          value={saisie.date_debut}
          onChange={(e) => maj("date_debut", e.target.value)}
          erreur={f.erreurs.date_debut}
        />
        <Champ
          libelle="Au"
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
          texteChargement="Enregistrement…"
        >
          {affectation ? "Enregistrer" : "Affecter"}
        </Bouton>
        {onTermine ? (
          <Bouton variante="secondaire" onClick={onTermine} disabled={f.enCours}>
            Fermer
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
  const [mode, setMode] = useState<"repos" | "modifier" | "pourvoir">("repos");
  const [personne, setPersonne] = useState("");
  const [avertissements, setAvertissements] = useState<AvertissementAffectation[]>([]);
  const f = useFormulaire<"collaborateur_id">();
  const chemin = `/api/missions/${encodeURIComponent(missionId)}/affectations/${encodeURIComponent(a.id)}`;
  const nom = a.a_pourvoir
    ? `profil ${a.grade_libelle ?? ""}`
    : (a.collaborateur_nom ?? "affectation");

  async function pourvoir(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      personne
        ? { ok: true, charge: { collaborateur_id: personne } }
        : { ok: false, erreurs: { collaborateur_id: "Choisissez la personne." } },
      (c) => api.post<ReponseAffectation>(`${chemin}/pourvoir`, c),
      { succes: "Profil pourvu.", apres: (r) => setAvertissements(r.avertissements ?? []) },
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
              libelle={`Pourvoir le profil ${a.grade_libelle ?? ""}`}
              options={collaborateurs}
              invite="Choisir la personne…"
              value={personne}
              onChange={(e) => setPersonne(e.target.value)}
              erreur={f.erreurs.collaborateur_id}
            />
            <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
              Pourvoir
            </Bouton>
            <Bouton variante="secondaire" onClick={() => setMode("repos")}>
              Annuler
            </Bouton>
          </div>
        </form>
      ) : (
        <div className="mp-barre-actions mp-barre-actions--compacte">
          <Bouton
            variante="discret"
            icone="crayon"
            aria-label={`Modifier l'affectation : ${nom}`}
            onClick={() => setMode("modifier")}
          >
            Modifier
          </Bouton>
          {a.a_pourvoir ? (
            <Bouton
              variante="discret"
              icone="personnes"
              aria-label={`Pourvoir : ${nom}`}
              onClick={() => setMode("pourvoir")}
            >
              Pourvoir
            </Bouton>
          ) : null}
          <BoutonConfirmation
            libelle="Supprimer"
            variante="discret"
            icone="corbeille"
            ariaLabel={`Supprimer l'affectation : ${nom}`}
            question={`Supprimer l'affectation (${nom}, ${formaterDate(a.date_debut)} → ${formaterDate(a.date_fin)}) ?`}
            libelleConfirmation="Oui, supprimer"
            texteChargement="Suppression…"
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
  const [phase, setPhase] = useState("");
  const [decalage, setDecalage] = useState("");
  const [apercu, setApercu] = useState<ResultatReplanification | null>(null);
  const [applique, setApplique] = useState<ResultatReplanification | null>(null);
  const f = useFormulaire<"phase_id" | "decalage">();
  const chemin = `/api/missions/${encodeURIComponent(missionId)}/replanifier`;
  const validation = validerReplanification(phase, decalage);

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
      succes: "Re-planification appliquée : les personnes concernées sont prévenues.",
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
        aria-label="Re-planifier une phase"
      >
        <RetourFormulaire
          erreur={f.erreurGlobale}
          succes={f.succes}
          refAlerte={f.refAlerte}
          titreErreur="Re-planification impossible"
        />
        <div className="mp-grille-champs">
          <Select
            libelle="Phase à décaler"
            options={phases}
            invite="Choisir la phase…"
            value={phase}
            onChange={(e) => {
              setPhase(e.target.value);
              setApercu(null);
            }}
            erreur={f.erreurs.phase_id}
          />
          <Champ
            libelle="Décalage en jours ouvrés"
            inputMode="numeric"
            autoComplete="off"
            value={decalage}
            onChange={(e) => {
              setDecalage(e.target.value);
              setApercu(null);
            }}
            erreur={f.erreurs.decalage}
            aide="Positif pour retarder, négatif pour avancer (ex. 3 ou -2)."
          />
        </div>
        <div className="mp-actions-formulaire">
          <Bouton
            type="submit"
            variante="secondaire"
            icone="oeil"
            chargement={f.enCours && !apercu}
            texteChargement="Calcul…"
          >
            Prévisualiser
          </Bouton>
        </div>
      </form>
      {resultat ? <ResultatReplanif r={resultat} /> : null}
      {apercu && apercu.taches.length > 0 ? (
        <div className="mp-actions-formulaire">
          <Bouton
            icone="calendrier"
            chargement={f.enCours}
            texteChargement="Application…"
            onClick={appliquer}
          >
            Appliquer et prévenir les personnes
          </Bouton>
        </div>
      ) : null}
    </div>
  );
}

function ResultatReplanif({ r }: { r: ResultatReplanification }) {
  if (r.taches.length === 0) {
    return (
      <Alerte tonalite="info" titre="Aucune date ne change">
        <p>Le décalage est absorbé (dépendances ou calendrier) : rien à appliquer.</p>
      </Alerte>
    );
  }
  return (
    <section
      className="mp-pile"
      aria-label={r.apercu ? "Aperçu de la re-planification" : "Re-planification appliquée"}
    >
      <h3 className="mp-sous-formulaire__titre">
        {r.apercu ? "Aperçu : rien n'est encore modifié" : "Re-planification appliquée"}
      </h3>
      <ul className="mp-liste-lignes">
        {r.taches.map((t) => (
          <li key={t.id} className="mp-liste-lignes__ligne">
            <span className="mp-liste-lignes__texte">
              <strong>{t.libelle ?? "Tâche"}</strong>
              <span className="mp-texte-doux">
                {`${formaterDate(t.avant.debut)} → ${formaterDate(t.avant.fin)} devient ${formaterDate(t.apres.debut)} → ${formaterDate(t.apres.fin)}`}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <p>
        {`${r.affectations.length} affectation(s) recalée(s). `}
        {r.personnes.length === 0
          ? "Aucune personne à prévenir."
          : `Personnes ${r.apercu ? "qui seront prévenues" : "prévenues"} : ${r.personnes.map((p) => p.nom ?? "Collaborateur").join(", ")}.`}
      </p>
    </section>
  );
}
