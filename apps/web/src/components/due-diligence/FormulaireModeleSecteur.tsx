"use client";

import { useState, type FormEvent } from "react";
import { PLAFONDS_DD } from "@missionpilot/shared";
import { api } from "../../lib/api";
import { messageDd, type EntreeTaxonomie, type ReponseEcriture } from "../../lib/due-diligence";
import {
  ANALYSES_MODELE_LIBELLES,
  cheminModelesSecteur,
  cheminVersionsModele,
  deplacerPoint,
  LIBELLE_POINT_MAX,
  MOTIF_MODELE_MAX,
  OPTIONS_ANALYSE_MODELE,
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
  const f = useFormulaire<ChampModele>();
  const correction = modele !== undefined;
  const [s, setS] = useState<SaisieModele>(
    modele ? saisieDepuisModele(modele) : saisieModeleVide(),
  );
  const maj = (p: Partial<SaisieModele>) => setS((x) => ({ ...x, ...p }));
  const majPoint = (i: number, p: Partial<SaisiePointModele>) =>
    maj({ points: s.points.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const categories = optionsCategories(s.analyse);
  const plein = s.points.length >= PLAFONDS_DD.points_par_modele;

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerModele(s, correction),
      (charge) =>
        modele
          ? api.post<ReponseEcriture>(cheminVersionsModele(modele.id), {
              ...charge,
              version_courante: modele.version,
            })
          : api.post<ReponseEcriture>(cheminModelesSecteur(), charge),
      {
        succes: correction ? "Nouvelle version enregistrée." : "Modèle ajouté à la bibliothèque.",
        messageSpecifique: messageDd,
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
      aria-label={correction ? "Nouvelle version du modèle" : "Nouveau modèle sectoriel"}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Modèle refusé"
      />
      {correction ? null : (
        <div className="mp-grille-champs">
          <Select
            libelle="Secteur"
            required
            invite="Choisir…"
            options={secteurs.map((e) => ({ valeur: e.code, libelle: e.libelle }))}
            value={s.secteur_code}
            onChange={(e) => maj({ secteur_code: e.target.value })}
            erreur={f.erreurs.secteur_code}
          />
          <Select
            libelle="Analyse"
            required
            invite="Choisir…"
            options={OPTIONS_ANALYSE_MODELE}
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
        <legend>Points à examiner</legend>
        <p className="mp-texte-doux mp-texte-petit">
          Des questions ou des rappels pour l&apos;expert, dans l&apos;ordre où ils seront proposés.
          Ne saisissez ni affirmation ni chiffre.
        </p>
        {f.erreurs.points ? (
          <Alerte tonalite="danger" annonce="alert">
            <p>{f.erreurs.points}</p>
          </Alerte>
        ) : null}
        <ol className="mp-dd-liste" aria-label="Points à examiner du modèle">
          {s.points.map((p, i) => (
            <li key={i} className="mp-dd-element">
              <Select
                libelle={`Catégorie du point ${i + 1}`}
                invite={s.analyse === "" ? "Choisissez d'abord l'analyse" : "Choisir…"}
                options={categories}
                value={p.categorie}
                onChange={(e) => majPoint(i, { categorie: e.target.value })}
                disabled={categories.length === 0}
              />
              <Champ
                libelle={`Point à examiner ${i + 1}`}
                maxLength={LIBELLE_POINT_MAX}
                value={p.libelle}
                onChange={(e) => majPoint(i, { libelle: e.target.value })}
              />
              <div className="mp-barre-actions mp-barre-actions--compacte">
                <Bouton
                  variante="discret"
                  disabled={i === 0}
                  aria-label={`Monter le point ${i + 1}`}
                  onClick={() => maj({ points: deplacerPoint(s.points, i, -1) })}
                >
                  Monter
                </Bouton>
                <Bouton
                  variante="discret"
                  disabled={i === s.points.length - 1}
                  aria-label={`Descendre le point ${i + 1}`}
                  onClick={() => maj({ points: deplacerPoint(s.points, i, 1) })}
                >
                  Descendre
                </Bouton>
                <Bouton
                  variante="discret"
                  disabled={s.points.length === 1}
                  aria-label={`Retirer le point ${i + 1}`}
                  onClick={() => maj({ points: s.points.filter((_, j) => j !== i) })}
                >
                  Retirer
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
            Ajouter un point
          </Bouton>
        </div>
        {plein ? (
          <p className="mp-texte-doux mp-texte-petit">
            {`Un modèle compte ${PLAFONDS_DD.points_par_modele} points au plus.`}
          </p>
        ) : null}
      </fieldset>
      {correction ? (
        <>
          <CaseACocher
            libelle="Modèle actif (proposé aux dossiers de ce secteur) : décochez pour le retirer"
            checked={s.actif}
            onChange={(e) => maj({ actif: e.target.checked })}
          />
          <ZoneTexte
            libelle="Motif de la correction"
            required
            rows={2}
            maxLength={MOTIF_MODELE_MAX}
            value={s.motif}
            onChange={(e) => maj({ motif: e.target.value })}
            erreur={f.erreurs.motif}
            aide={`Conservé dans l'historique des versions. Analyse : ${ANALYSES_MODELE_LIBELLES[modele.analyse]}.`}
          />
        </>
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {correction ? "Enregistrer la nouvelle version" : "Ajouter le modèle"}
        </Bouton>
      </div>
    </form>
  );
}
