"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { NIVEAUX_DIPLOME_AO, NIVEAUX_LANGUE_AO } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  libelleCritere,
  libelleNiveauDiplome,
  libelleNiveauLangue,
  lireCv,
  lireExigences,
  messageBanqueAo,
  RACINE_BANQUES,
  type ContenuCv,
  type ResultatControle,
  type SaisieCv,
  type SaisieExigences,
  valeurCritere,
} from "../../lib/banque-ao";
import { lireMotif } from "../../lib/agents";
import type { Resultat } from "../../lib/saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

/*
 * Formulaires de la banque de CV (AO-04) : création et nouvelle version (saisie structurée,
 * une ligne par expérience, diplôme ou langue), contrôle des exigences d'un appel d'offres
 * (calculé par l'API, moteur `banque-cv`).
 */

const VIDE: SaisieCv = {
  nom: "",
  titre: "",
  nationalite: "",
  resume: "",
  secteurs: "",
  competences: "",
  experiences: "",
  diplomes: "",
  langues: "",
};

export function FormulaireCv({
  cvId,
  initial,
}: {
  /** Absent : création ; présent : nouvelle version du CV. */
  cvId?: string;
  initial?: SaisieCv;
}) {
  const t = useT();
  const langue = useLangue();
  const router = useRouter();
  const f = useFormulaire<keyof SaisieCv | "motif">();
  const [s, setS] = useState<SaisieCv>(initial ?? VIDE);
  const [motif, setMotif] = useState("");
  const maj = (cle: keyof SaisieCv) => (e: { target: { value: string } }) =>
    setS((x) => ({ ...x, [cle]: e.target.value }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const lu = lireCv(s, langue);
    if (cvId) {
      const m = lireMotif(motif, 500, langue);
      const validation: Resultat<{ contenu: ContenuCv; motif: string }, keyof SaisieCv | "motif"> =
        !lu.ok
          ? { ok: false, erreurs: lu.erreurs }
          : !m.ok
            ? { ok: false, erreurs: m.erreurs }
            : { ok: true, charge: { contenu: lu.charge.contenu, motif: m.charge.motif } };
      await f.envoyer(validation, (c) => api.post(`/api/banque-ao/cv/${cvId}/versions`, c), {
        succes: t("Nouvelle version enregistrée.", "New version saved."),
        messageSpecifique: (err) => messageBanqueAo(err, langue),
      });
      return;
    }
    await f.envoyer(lu, (c) => api.post<{ id: string }>("/api/banque-ao/cv", c), {
      messageSpecifique: (err) => messageBanqueAo(err, langue),
      rafraichir: false,
      apres: (r) => router.push(`${RACINE_BANQUES}/cv/${r.id}`),
    });
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        {cvId ? null : (
          <Champ
            libelle={t("Nom de l'expert", "Expert's name")}
            required
            maxLength={160}
            value={s.nom}
            onChange={maj("nom")}
            erreur={f.erreurs.nom}
          />
        )}
        <Champ
          libelle={t("Titre ou poste", "Title or position")}
          required
          maxLength={200}
          value={s.titre}
          onChange={maj("titre")}
          erreur={f.erreurs.titre}
        />
        <Champ
          libelle={t("Nationalité", "Nationality")}
          maxLength={80}
          value={s.nationalite}
          onChange={maj("nationalite")}
        />
        <Champ
          libelle={t("Secteurs", "Sectors")}
          aide={t("Séparés par des virgules.", "Separated by commas.")}
          value={s.secteurs}
          onChange={maj("secteurs")}
        />
        <Champ
          libelle={t("Compétences", "Skills")}
          aide={t("Séparées par des virgules.", "Separated by commas.")}
          value={s.competences}
          onChange={maj("competences")}
        />
      </div>
      <ZoneTexte
        libelle={t("Profil", "Profile")}
        maxLength={4000}
        value={s.resume}
        onChange={maj("resume")}
      />
      <ZoneTexte
        libelle={t("Expériences", "Experience")}
        aide={t(
          "Une par ligne : début (AAAA-MM) | fin (AAAA-MM ou « en cours ») | intitulé | employeur | pays (CI, SN…) | secteurs séparés par ; | bailleur.",
          "One per line: start (YYYY-MM) | end (YYYY-MM or “en cours” for ongoing) | title | employer | country (CI, SN…) | sectors separated by ; | donor.",
        )}
        rows={6}
        value={s.experiences}
        onChange={maj("experiences")}
        erreur={f.erreurs.experiences}
      />
      <ZoneTexte
        libelle={t("Diplômes", "Degrees")}
        aide={t(
          "Un par ligne : année | niveau (bac, bac+2… bac+5, master, doctorat) | intitulé | domaine | établissement.",
          "One per line: year | level (bac, bac+2… bac+5, master, doctorate) | title | field | institution.",
        )}
        rows={3}
        value={s.diplomes}
        onChange={maj("diplomes")}
        erreur={f.erreurs.diplomes}
      />
      <ZoneTexte
        libelle={t("Langues", "Languages")}
        aide={t(
          "Une par ligne : langue : niveau (notions, courant, bilingue, maternelle).",
          "One per line: language: level (basic, fluent, bilingual, native).",
        )}
        rows={3}
        value={s.langues}
        onChange={maj("langues")}
        erreur={f.erreurs.langues}
      />
      {cvId ? (
        <Champ
          libelle={t("Motif de la nouvelle version", "Reason for the new version")}
          required
          maxLength={500}
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          erreur={f.erreurs.motif}
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours}>
          {cvId
            ? t("Enregistrer la nouvelle version", "Save the new version")
            : t("Créer le CV", "Create the CV")}
        </Bouton>
      </div>
    </form>
  );
}

const EXIGENCES_VIDES: SaisieExigences = {
  annees_min: "",
  niveau_diplome_min: "",
  secteur: "",
  annees_secteur: "",
  langue: "",
  niveau_langue: "",
  reference: "",
};

export function FormulaireControleCv({ cvId }: { cvId: string }) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<keyof SaisieExigences>();
  const [s, setS] = useState(EXIGENCES_VIDES);
  const [resultat, setResultat] = useState<ResultatControle | null>(null);
  const maj = (cle: keyof SaisieExigences) => (e: { target: { value: string } }) =>
    setS((x) => ({ ...x, [cle]: e.target.value }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      lireExigences(s, langue),
      (c) => api.post<ResultatControle>(`/api/banque-ao/cv/${cvId}/controle`, c),
      {
        rafraichir: false,
        apres: setResultat,
        messageSpecifique: (err) => messageBanqueAo(err, langue),
      },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Années d'expérience exigées", "Years of experience required")}
          inputMode="numeric"
          value={s.annees_min}
          onChange={maj("annees_min")}
          erreur={f.erreurs.annees_min}
        />
        <Select
          libelle={t("Diplôme minimal", "Minimum degree")}
          value={s.niveau_diplome_min}
          onChange={maj("niveau_diplome_min")}
          options={[
            { valeur: "", libelle: t("Aucune exigence", "No requirement") },
            ...NIVEAUX_DIPLOME_AO.map((n) => ({
              valeur: n,
              libelle: libelleNiveauDiplome(n, langue),
            })),
          ]}
        />
        <Champ
          libelle={t("Secteur exigé", "Sector required")}
          value={s.secteur}
          onChange={maj("secteur")}
        />
        <Champ
          libelle={t("Années dans ce secteur", "Years in this sector")}
          inputMode="numeric"
          value={s.annees_secteur}
          onChange={maj("annees_secteur")}
          erreur={f.erreurs.annees_secteur}
        />
        <Champ
          libelle={t("Langue exigée", "Language required")}
          value={s.langue}
          onChange={maj("langue")}
        />
        <Select
          libelle={t("Niveau minimal", "Minimum level")}
          value={s.niveau_langue}
          onChange={maj("niveau_langue")}
          erreur={f.erreurs.niveau_langue}
          options={[
            { valeur: "", libelle: "—" },
            ...NIVEAUX_LANGUE_AO.map((n) => ({
              valeur: n,
              libelle: libelleNiveauLangue(n, langue),
            })),
          ]}
        />
        <Champ
          libelle={t("Mois de référence", "Reference month")}
          aide={t(
            "AAAA-MM, en général le mois de dépôt ; vide : mois courant.",
            "YYYY-MM, usually the submission month; empty: current month.",
          )}
          value={s.reference}
          onChange={maj("reference")}
          erreur={f.erreurs.reference}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" variante="secondaire" chargement={f.enCours}>
          {t("Contrôler", "Check")}
        </Bouton>
      </div>
      {resultat ? (
        <div role="status">
          <p>
            <BadgeStatut tonalite={resultat.conforme ? "succes" : "danger"}>
              {resultat.conforme ? t("Conforme", "Compliant") : t("Non conforme", "Non-compliant")}
            </BadgeStatut>{" "}
            {t(
              `${resultat.annees_experience} an(s) d'expérience au ${resultat.reference}.`,
              `${resultat.annees_experience} year(s) of experience as of ${resultat.reference}.`,
            )}
          </p>
          <ul>
            {resultat.criteres.map((c, i) => (
              <li key={`${c.code}-${i}`}>
                {c.conforme ? t("Tenu", "Met") : t("Non tenu", "Not met")} —{" "}
                {libelleCritere(c, langue)}
                {t(" : exigé ", ": required ")}
                {valeurCritere(c, "exige", langue)}
                {t(", constaté ", ", found ")}
                {valeurCritere(c, "constate", langue)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}
