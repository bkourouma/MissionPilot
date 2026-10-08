"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { LIBELLES_NIVEAU_DIPLOME, NIVEAUX_DIPLOME_AO } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  libelleCritere,
  lireCv,
  lireExigences,
  messageBanqueAo,
  RACINE_BANQUES,
  type ContenuCv,
  type ResultatControle,
  type SaisieCv,
  type SaisieExigences,
} from "../../lib/banque-ao";
import { lireMotif } from "../../lib/agents";
import type { Resultat } from "../../lib/saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
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
  const router = useRouter();
  const f = useFormulaire<keyof SaisieCv | "motif">();
  const [s, setS] = useState<SaisieCv>(initial ?? VIDE);
  const [motif, setMotif] = useState("");
  const maj = (cle: keyof SaisieCv) => (e: { target: { value: string } }) =>
    setS((x) => ({ ...x, [cle]: e.target.value }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const lu = lireCv(s);
    if (cvId) {
      const m = lireMotif(motif, 500);
      const validation: Resultat<{ contenu: ContenuCv; motif: string }, keyof SaisieCv | "motif"> =
        !lu.ok
          ? { ok: false, erreurs: lu.erreurs }
          : !m.ok
            ? { ok: false, erreurs: m.erreurs }
            : { ok: true, charge: { contenu: lu.charge.contenu, motif: m.charge.motif } };
      await f.envoyer(validation, (c) => api.post(`/api/banque-ao/cv/${cvId}/versions`, c), {
        succes: "Nouvelle version enregistrée.",
        messageSpecifique: messageBanqueAo,
      });
      return;
    }
    await f.envoyer(lu, (c) => api.post<{ id: string }>("/api/banque-ao/cv", c), {
      messageSpecifique: messageBanqueAo,
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
            libelle="Nom de l'expert"
            required
            maxLength={160}
            value={s.nom}
            onChange={maj("nom")}
            erreur={f.erreurs.nom}
          />
        )}
        <Champ
          libelle="Titre ou poste"
          required
          maxLength={200}
          value={s.titre}
          onChange={maj("titre")}
          erreur={f.erreurs.titre}
        />
        <Champ
          libelle="Nationalité"
          maxLength={80}
          value={s.nationalite}
          onChange={maj("nationalite")}
        />
        <Champ
          libelle="Secteurs"
          aide="Séparés par des virgules."
          value={s.secteurs}
          onChange={maj("secteurs")}
        />
        <Champ
          libelle="Compétences"
          aide="Séparées par des virgules."
          value={s.competences}
          onChange={maj("competences")}
        />
      </div>
      <ZoneTexte libelle="Profil" maxLength={4000} value={s.resume} onChange={maj("resume")} />
      <ZoneTexte
        libelle="Expériences"
        aide="Une par ligne : début (AAAA-MM) | fin (AAAA-MM ou « en cours ») | intitulé | employeur | pays (CI, SN…) | secteurs séparés par ; | bailleur."
        rows={6}
        value={s.experiences}
        onChange={maj("experiences")}
        erreur={f.erreurs.experiences}
      />
      <ZoneTexte
        libelle="Diplômes"
        aide="Un par ligne : année | niveau (bac, bac+2… bac+5, master, doctorat) | intitulé | domaine | établissement."
        rows={3}
        value={s.diplomes}
        onChange={maj("diplomes")}
        erreur={f.erreurs.diplomes}
      />
      <ZoneTexte
        libelle="Langues"
        aide="Une par ligne : langue : niveau (notions, courant, bilingue, maternelle)."
        rows={3}
        value={s.langues}
        onChange={maj("langues")}
        erreur={f.erreurs.langues}
      />
      {cvId ? (
        <Champ
          libelle="Motif de la nouvelle version"
          required
          maxLength={500}
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          erreur={f.erreurs.motif}
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours}>
          {cvId ? "Enregistrer la nouvelle version" : "Créer le CV"}
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
  const f = useFormulaire<keyof SaisieExigences>();
  const [s, setS] = useState(EXIGENCES_VIDES);
  const [resultat, setResultat] = useState<ResultatControle | null>(null);
  const maj = (cle: keyof SaisieExigences) => (e: { target: { value: string } }) =>
    setS((x) => ({ ...x, [cle]: e.target.value }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      lireExigences(s),
      (c) => api.post<ResultatControle>(`/api/banque-ao/cv/${cvId}/controle`, c),
      { rafraichir: false, apres: setResultat, messageSpecifique: messageBanqueAo },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <div className="mp-grille-champs">
        <Champ
          libelle="Années d'expérience exigées"
          inputMode="numeric"
          value={s.annees_min}
          onChange={maj("annees_min")}
          erreur={f.erreurs.annees_min}
        />
        <Select
          libelle="Diplôme minimal"
          value={s.niveau_diplome_min}
          onChange={maj("niveau_diplome_min")}
          options={[
            { valeur: "", libelle: "Aucune exigence" },
            ...NIVEAUX_DIPLOME_AO.map((n) => ({ valeur: n, libelle: LIBELLES_NIVEAU_DIPLOME[n] })),
          ]}
        />
        <Champ libelle="Secteur exigé" value={s.secteur} onChange={maj("secteur")} />
        <Champ
          libelle="Années dans ce secteur"
          inputMode="numeric"
          value={s.annees_secteur}
          onChange={maj("annees_secteur")}
          erreur={f.erreurs.annees_secteur}
        />
        <Champ libelle="Langue exigée" value={s.langue} onChange={maj("langue")} />
        <Select
          libelle="Niveau minimal"
          value={s.niveau_langue}
          onChange={maj("niveau_langue")}
          erreur={f.erreurs.niveau_langue}
          options={[
            { valeur: "", libelle: "—" },
            { valeur: "notions", libelle: "Notions" },
            { valeur: "courant", libelle: "Courant" },
            { valeur: "bilingue", libelle: "Bilingue" },
            { valeur: "maternelle", libelle: "Langue maternelle" },
          ]}
        />
        <Champ
          libelle="Mois de référence"
          aide="AAAA-MM, en général le mois de dépôt ; vide : mois courant."
          value={s.reference}
          onChange={maj("reference")}
          erreur={f.erreurs.reference}
        />
      </div>
      <div className="mp-actions-formulaire">
        <Bouton type="submit" variante="secondaire" chargement={f.enCours}>
          Contrôler
        </Bouton>
      </div>
      {resultat ? (
        <div role="status">
          <p>
            <BadgeStatut tonalite={resultat.conforme ? "succes" : "danger"}>
              {resultat.conforme ? "Conforme" : "Non conforme"}
            </BadgeStatut>{" "}
            {resultat.annees_experience} an(s) d&apos;expérience au {resultat.reference}.
          </p>
          <ul>
            {resultat.criteres.map((c, i) => (
              <li key={`${c.code}-${i}`}>
                {c.conforme ? "Tenu" : "Non tenu"} — {libelleCritere(c)} : exigé {c.exige}, constaté{" "}
                {c.constate}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}
