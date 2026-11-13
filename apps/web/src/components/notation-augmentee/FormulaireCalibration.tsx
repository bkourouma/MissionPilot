"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  CAS_CALIBRATION_MAX,
  CHEMIN_CALIBRATIONS,
  LIBELLE_CAS_LONGUEUR_MAX,
  NIVEAUX_ITEM_MAX,
  NIVEAUX_ITEM_MIN,
  TITRE_CALIBRATION_LONGUEUR_MAX,
  TOLERANCE_CALIBRATION_MAX,
  hrefCalibration,
  messageNotationAugmentee,
  saisieCalibrationVide,
  validerSaisieCalibration,
  type SaisieCalibration,
  type SessionCalibration,
} from "../../lib/notation-augmentee";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";

/**
 * Création d'une session de calibrage (NOT-13, POST /api/notation/calibrations) : titre, échelle,
 * tolérance d'accord et cas à coter. Les évaluateurs ne se désignent pas à l'avance : tout expert ou
 * consultant habilité à rédiger les notations peut coter, et les évaluateurs d'un cas sont ceux
 * qui l'ont coté. L'échelle et les cas sont figés à la création.
 */
export function FormulaireCalibration() {
  const router = useRouter();
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<string>();
  const [saisie, setSaisie] = useState<SaisieCalibration>(saisieCalibrationVide);
  // Clé stable de chaque ligne (une ligne retirée ne décale pas l'état des autres).
  const prochaineCle = useRef(2);
  const [cles, setCles] = useState<number[]>([0, 1]);

  const maj = <K extends keyof SaisieCalibration>(cle: K, valeur: SaisieCalibration[K]) =>
    setSaisie((s) => ({ ...s, [cle]: valeur }));
  const majCas = (rang: number, champ: "code" | "libelle", valeur: string) =>
    setSaisie((s) => ({
      ...s,
      cas: s.cas.map((c, i) => (i === rang ? { ...c, [champ]: valeur } : c)),
    }));
  function ajouterCas() {
    setSaisie((s) => ({ ...s, cas: [...s.cas, { code: "", libelle: "" }] }));
    setCles((c) => [...c, prochaineCle.current++]);
  }
  function retirerCas(rang: number) {
    setSaisie((s) => ({ ...s, cas: s.cas.filter((_, i) => i !== rang) }));
    setCles((c) => c.filter((_, i) => i !== rang));
  }

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerSaisieCalibration(saisie, langue),
      (charge) => api.post<SessionCalibration>(CHEMIN_CALIBRATIONS, charge),
      {
        succes: t(
          "Session créée : ouverture de la session.",
          "Session created: opening the session.",
        ),
        messageSpecifique: (err) => messageNotationAugmentee(err, langue),
        rafraichir: false,
        apres: (s) => router.push(hrefCalibration(s.id)),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-na-formulaire"
      noValidate
      onSubmit={soumettre}
    >
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />

      <fieldset className="mp-na-groupe">
        <legend>{t("Paramètres", "Settings")}</legend>
        <Champ
          libelle={t("Titre de la session", "Session title")}
          required
          value={saisie.titre}
          onChange={(e) => maj("titre", e.target.value)}
          erreur={f.erreurs.titre}
          maxLength={TITRE_CALIBRATION_LONGUEUR_MAX + 50}
          autoComplete="off"
          aide={t("Ex. Calibrage pilotage, T1 2027", "E.g. Steering calibration, Q1 2027")}
        />
        <div className="mp-grille-champs">
          <Select
            libelle={t("Nombre de niveaux de l'échelle", "Number of scale levels")}
            required
            value={saisie.niveaux}
            onChange={(e) => maj("niveaux", e.target.value)}
            erreur={f.erreurs.niveaux}
            options={Array.from({ length: NIVEAUX_ITEM_MAX - NIVEAUX_ITEM_MIN + 1 }, (_, i) => ({
              valeur: String(NIVEAUX_ITEM_MIN + i),
              libelle: String(NIVEAUX_ITEM_MIN + i),
            }))}
          />
          <Champ
            libelle={t("Tolérance d'accord (niveaux)", "Agreement tolerance (levels)")}
            required
            inputMode="numeric"
            value={saisie.tolerance}
            onChange={(e) => maj("tolerance", e.target.value)}
            erreur={f.erreurs.tolerance}
            aide={t(
              `0 : les évaluateurs doivent coter le même niveau. Au plus ${TOLERANCE_CALIBRATION_MAX}, inférieure au nombre de niveaux.`,
              `0: raters must rate the same level. At most ${TOLERANCE_CALIBRATION_MAX}, lower than the number of levels.`,
            )}
          />
        </div>
      </fieldset>

      <fieldset className="mp-na-groupe">
        <legend>{t("Cas à coter", "Cases to rate")}</legend>
        <p className="mp-na-groupe__aide">
          {t(
            "Un cas est une situation réelle (une pratique d'une entreprise) que chaque évaluateur cote seul, à l'aveugle. Le code, facultatif, se déduit du libellé. Les évaluateurs se déclarent en cotant : aucune liste à saisir.",
            "A case is a real situation (a company's practice) that each rater rates alone, blind. The code, optional, is derived from the label. Raters identify themselves by rating: no list to enter.",
          )}
        </p>
        {f.erreurs.cas ? (
          <p className="mp-champ__erreur" role="alert">
            {f.erreurs.cas}
          </p>
        ) : null}
        {saisie.cas.map((c, i) => (
          <div key={cles[i]} className="mp-na-ligne-cas">
            <Champ
              libelle={t(`Libellé du cas ${i + 1}`, `Label of case ${i + 1}`)}
              value={c.libelle}
              onChange={(e) => majCas(i, "libelle", e.target.value)}
              erreur={f.erreurs[`cas-libelle-${i}`]}
              maxLength={LIBELLE_CAS_LONGUEUR_MAX + 50}
              autoComplete="off"
            />
            <Champ
              libelle={t("Code (facultatif)", "Code (optional)")}
              value={c.code}
              onChange={(e) => majCas(i, "code", e.target.value)}
              erreur={f.erreurs[`cas-code-${i}`]}
              maxLength={80}
              autoComplete="off"
            />
            <Bouton
              variante="discret"
              icone="fermer"
              aria-label={t(`Retirer le cas ${i + 1}`, `Remove case ${i + 1}`)}
              disabled={saisie.cas.length <= 1}
              onClick={() => retirerCas(i)}
            >
              {t("Retirer", "Remove")}
            </Bouton>
          </div>
        ))}
        <div className="mp-barre-actions">
          <Bouton
            variante="secondaire"
            icone="plus"
            disabled={saisie.cas.length >= CAS_CALIBRATION_MAX}
            onClick={ajouterCas}
          >
            {t("Ajouter un cas", "Add a case")}
          </Bouton>
        </div>
      </fieldset>

      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement={t("Création…", "Creating…")}>
          {t("Créer la session", "Create the session")}
        </Bouton>
      </div>
    </form>
  );
}
