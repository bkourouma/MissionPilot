"use client";

import { useState, type FormEvent } from "react";
import { PLAFONDS_DD } from "@missionpilot/shared";
import { api } from "../../lib/api";
import { messageDd, type EntreeTaxonomie, type ReponseEcriture } from "../../lib/due-diligence";
import {
  ANALYSES_MODELE_LIBELLES,
  ANALYSES_MODELE_LIBELLES_EN,
  cheminModelesSecteur,
  cheminVersionsModele,
  deplacerPoint,
  LIBELLE_POINT_MAX,
  MOTIF_MODELE_MAX,
  optionsAnalyseModele,
  optionsCategories,
  saisieDepuisModele,
  saisieModeleVide,
  saisiePointVide,
  validerModele,
  type ChampModele,
  type ModeleSecteur,
  type SaisieModele,
  type SaisiePointModele,
} from "../../lib/due-diligence-modeles";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

export interface FormulaireModeleSecteurProps {
  secteurs: readonly EntreeTaxonomie[];
  /** Présent : nouvelle version de ce modèle (motif exigé ; secteur et analyse ne changent pas). */
  modele?: ModeleSecteur;
}

/**
 * Modèle d'analyse d'un secteur (DD-07) : une liste ordonnée de « points à examiner », des rappels
 * pour l'expert (jamais des affirmations ni des chiffres). Création, ou nouvelle version motivée ;
 * décocher « actif » retire le modèle des dossiers.
 */
export function FormulaireModeleSecteur({ secteurs, modele }: FormulaireModeleSecteurProps) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampModele>();
  const correction = modele !== undefined;
  const [s, setS] = useState<SaisieModele>(
    modele ? saisieDepuisModele(modele) : saisieModeleVide(),
  );
  const maj = (p: Partial<SaisieModele>) => setS((x) => ({ ...x, ...p }));
  const majPoint = (i: number, p: Partial<SaisiePointModele>) =>
    maj({ points: s.points.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const categories = optionsCategories(s.analyse, langue);
  const plein = s.points.length >= PLAFONDS_DD.points_par_modele;

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerModele(s, correction, langue),
      (charge) =>
        modele
          ? api.post<ReponseEcriture>(cheminVersionsModele(modele.id), {
              ...charge,
              version_courante: modele.version,
            })
          : api.post<ReponseEcriture>(cheminModelesSecteur(), charge),
      {
        succes: correction
          ? t("Nouvelle version enregistrée.", "New version saved.")
          : t("Modèle ajouté à la bibliothèque.", "Template added to the library."),
        messageSpecifique: (err) => messageDd(err, langue),
        apres: () => (correction ? maj({ motif: "" }) : setS(saisieModeleVide())),
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
          ? t("Nouvelle version du modèle", "New template version")
          : t("Nouveau modèle sectoriel", "New sector template")
      }
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Modèle refusé", "Template refused")}
      />
      {correction ? null : (
        <div className="mp-grille-champs">
          <Select
            libelle={t("Secteur", "Sector")}
            required
            invite={t("Choisir…", "Choose…")}
            options={secteurs.map((e) => ({ valeur: e.code, libelle: e.libelle }))}
            value={s.secteur_code}
            onChange={(e) => maj({ secteur_code: e.target.value })}
            erreur={f.erreurs.secteur_code}
          />
          <Select
            libelle={t("Analyse", "Analysis")}
            required
            invite={t("Choisir…", "Choose…")}
            options={optionsAnalyseModele(langue)}
            value={s.analyse}
            onChange={(e) =>
              maj({
                analyse: e.target.value,
                points: s.points.map((p) => ({ ...p, categorie: "" })),
              })
            }
            erreur={f.erreurs.analyse}
          />
        </div>
      )}
      <fieldset className="mp-dd-pile">
        <legend>{t("Points à examiner", "Points to examine")}</legend>
        <p className="mp-texte-doux mp-texte-petit">
          {t(
            "Des questions ou des rappels pour l'expert, dans l'ordre où ils seront proposés. Ne saisissez ni affirmation ni chiffre.",
            "Questions or reminders for the expert, in the order they will be offered. Do not enter any statement or figure.",
          )}
        </p>
        {f.erreurs.points ? (
          <Alerte tonalite="danger" annonce="alert">
            <p>{f.erreurs.points}</p>
          </Alerte>
        ) : null}
        <ol
          className="mp-dd-liste"
          aria-label={t("Points à examiner du modèle", "Template points to examine")}
        >
          {s.points.map((p, i) => (
            <li key={i} className="mp-dd-element">
              <Select
                libelle={t(`Catégorie du point ${i + 1}`, `Category of item ${i + 1}`)}
                invite={
                  s.analyse === ""
                    ? t("Choisissez d'abord l'analyse", "Choose the analysis first")
                    : t("Choisir…", "Choose…")
                }
                options={categories}
                value={p.categorie}
                onChange={(e) => majPoint(i, { categorie: e.target.value })}
                disabled={categories.length === 0}
              />
              <Champ
                libelle={t(`Point à examiner ${i + 1}`, `Point to examine ${i + 1}`)}
                maxLength={LIBELLE_POINT_MAX}
                value={p.libelle}
                onChange={(e) => majPoint(i, { libelle: e.target.value })}
              />
              <div className="mp-barre-actions mp-barre-actions--compacte">
                <Bouton
                  variante="discret"
                  disabled={i === 0}
                  aria-label={t(`Monter le point ${i + 1}`, `Move item ${i + 1} up`)}
                  onClick={() => maj({ points: deplacerPoint(s.points, i, -1) })}
                >
                  {t("Monter", "Move up")}
                </Bouton>
                <Bouton
                  variante="discret"
                  disabled={i === s.points.length - 1}
                  aria-label={t(`Descendre le point ${i + 1}`, `Move item ${i + 1} down`)}
                  onClick={() => maj({ points: deplacerPoint(s.points, i, 1) })}
                >
                  {t("Descendre", "Move down")}
                </Bouton>
                <Bouton
                  variante="discret"
                  disabled={s.points.length === 1}
                  aria-label={t(`Retirer le point ${i + 1}`, `Remove item ${i + 1}`)}
                  onClick={() => maj({ points: s.points.filter((_, j) => j !== i) })}
                >
                  {t("Retirer", "Remove")}
                </Bouton>
              </div>
            </li>
          ))}
        </ol>
        <div>
          <Bouton
            variante="secondaire"
            disabled={plein}
            onClick={() => maj({ points: [...s.points, saisiePointVide()] })}
          >
            {t("Ajouter un point", "Add an item")}
          </Bouton>
        </div>
        {plein ? (
          <p className="mp-texte-doux mp-texte-petit">
            {t(
              `Un modèle compte ${PLAFONDS_DD.points_par_modele} points au plus.`,
              `A template has at most ${PLAFONDS_DD.points_par_modele} items.`,
            )}
          </p>
        ) : null}
      </fieldset>
      {correction ? (
        <>
          <CaseACocher
            libelle={t(
              "Modèle actif (proposé aux dossiers de ce secteur) : décochez pour le retirer",
              "Active template (offered to files of this sector): uncheck to remove it",
            )}
            checked={s.actif}
            onChange={(e) => maj({ actif: e.target.checked })}
          />
          <ZoneTexte
            libelle={t("Motif de la correction", "Reason for the correction")}
            required
            rows={2}
            maxLength={MOTIF_MODELE_MAX}
            value={s.motif}
            onChange={(e) => maj({ motif: e.target.value })}
            erreur={f.erreurs.motif}
            aide={t(
              `Conservé dans l'historique des versions. Analyse : ${ANALYSES_MODELE_LIBELLES[modele.analyse]}.`,
              `Kept in the version history. Analysis: ${ANALYSES_MODELE_LIBELLES_EN[modele.analyse]}.`,
            )}
          />
        </>
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {correction
            ? t("Enregistrer la nouvelle version", "Save the new version")
            : t("Ajouter le modèle", "Add the template")}
        </Bouton>
      </div>
    </form>
  );
}
