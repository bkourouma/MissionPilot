"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  PUBLIC_ITEM_LIBELLES,
  PUBLICS_ITEM_NOTATION,
  type ItemBanqueDonnees,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  AIDE_ANCRAGES_LONGUEUR_MAX,
  ANCRAGE_LONGUEUR_MAX,
  CHEMIN_BANQUE,
  FORMULATION_LONGUEUR_MAX,
  INTITULE_LONGUEUR_MAX,
  LIBELLE_NIVEAU_LONGUEUR_MAX,
  NIVEAUX_ITEM_MAX,
  NIVEAUX_ITEM_MIN,
  aideDepuisAncrages,
  cheminItemBanque,
  compteurCaracteres,
  hrefItemBanque,
  messageNotationAugmentee,
  saisieDepuisItem,
  saisieItemVide,
  validerSaisieItem,
  type ItemBanqueDetail,
  type SaisieItemBanque,
} from "../../lib/notation-augmentee";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import type { SuggestionDimension } from "./suggestions";

export interface FormulaireItemBanqueProps {
  /** Brouillon à modifier (PUT) ; `null` : nouvel item ou nouvelle version (POST). */
  itemId: string | null;
  /** Contenu enregistré qui préremplit le formulaire (et dont les exemples et l'étalonnage sont conservés). */
  base: ItemBanqueDonnees | null;
  /** Code, dimension et pratique d'une version ne changent pas : champs en lecture seule. */
  identifiantsFiges: boolean;
  suggestions: SuggestionDimension[];
  /** Avertissement affiché au-dessus du formulaire (ex. nouvelle version préremplie). */
  avertissement?: string | null;
}

/**
 * Rédaction d'un item de la banque en brouillon (NOT-09) : identification, échelle avec un
 * comportement observable (ancrage) par niveau, formulations par public, paramètres de sélection.
 * Les longueurs et formats sont contrôlés ici (confort) puis par le schéma partagé et le moteur de
 * l'API, dont les refus sont affichés en français. La validation par un expert métier est une
 * action distincte, sur la version enregistrée.
 */
export function FormulaireItemBanque({
  itemId,
  base,
  identifiantsFiges,
  suggestions,
  avertissement = null,
}: FormulaireItemBanqueProps) {
  const router = useRouter();
  const f = useFormulaire<string>();
  const [saisie, setSaisie] = useState<SaisieItemBanque>(() =>
    base ? saisieDepuisItem(base) : saisieItemVide(),
  );
  const maj = <K extends keyof SaisieItemBanque>(cle: K, valeur: SaisieItemBanque[K]) =>
    setSaisie((s) => ({ ...s, [cle]: valeur }));
  const majListe = (cle: "libelles" | "ancrages", rang: number, valeur: string) =>
    setSaisie((s) => ({ ...s, [cle]: s[cle].map((v, i) => (i === rang ? valeur : v)) }));

  const niveauxSaisis = Number(saisie.niveaux);
  const nombre =
    Number.isInteger(niveauxSaisis) &&
    niveauxSaisis >= NIVEAUX_ITEM_MIN &&
    niveauxSaisis <= NIVEAUX_ITEM_MAX
      ? niveauxSaisis
      : NIVEAUX_ITEM_MIN;
  const niveaux = Array.from({ length: nombre }, (_, i) => i + 1);
  const reuni = aideDepuisAncrages(
    niveaux.map((n) => ({ niveau: n, comportement: saisie.ancrages[n - 1]?.trim() ?? "" })),
  ).length;
  const dimensionConnue = suggestions.find((d) => d.id === saisie.dimension.trim());

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerSaisieItem(saisie, base),
      (charge) =>
        itemId
          ? api.put<ItemBanqueDetail>(cheminItemBanque(itemId), charge)
          : api.post<ItemBanqueDetail>(CHEMIN_BANQUE, charge),
      {
        succes: itemId
          ? "Brouillon enregistré. Vous en êtes désormais le dernier modificateur : un autre expert métier devra le valider."
          : "Brouillon créé : ouverture de l'item.",
        messageSpecifique: messageNotationAugmentee,
        rafraichir: itemId !== null,
        apres: (item) => {
          if (!itemId) router.push(hrefItemBanque(item.id));
        },
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
      {avertissement ? (
        <Alerte tonalite="info" annonce="aucune">
          <p>{avertissement}</p>
        </Alerte>
      ) : null}

      <fieldset className="mp-na-groupe">
        <legend>Identification</legend>
        {identifiantsFiges ? (
          <p className="mp-na-groupe__aide">
            Le code, la dimension et la pratique ne changent pas d&apos;une version à l&apos;autre.
          </p>
        ) : (
          <p className="mp-na-groupe__aide">
            Identifiants en minuscules sans accent (lettres, chiffres, « _ », « . » ou « - »). La
            dimension et la pratique proposent celles de la grille générique, mais la saisie reste
            libre.
          </p>
        )}
        <div className="mp-grille-champs">
          <Champ
            libelle="Code de l'item"
            required
            value={saisie.code}
            onChange={(e) => maj("code", e.target.value)}
            erreur={f.erreurs.code}
            readOnly={identifiantsFiges}
            maxLength={80}
            autoComplete="off"
            aide="Ex. pilotage_revue_mensuelle"
          />
          <Champ
            libelle="Dimension"
            required
            value={saisie.dimension}
            onChange={(e) => maj("dimension", e.target.value)}
            erreur={f.erreurs.dimension}
            readOnly={identifiantsFiges}
            maxLength={80}
            autoComplete="off"
            list="na-dimensions"
            aide="Ex. pilotage"
          />
          <Champ
            libelle="Pratique évaluée"
            required
            value={saisie.pratique}
            onChange={(e) => maj("pratique", e.target.value)}
            erreur={f.erreurs.pratique}
            readOnly={identifiantsFiges}
            maxLength={80}
            autoComplete="off"
            list="na-pratiques"
            aide="Une seule question par pratique dans un questionnaire."
          />
        </div>
        <datalist id="na-dimensions">
          {suggestions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.libelle}
            </option>
          ))}
        </datalist>
        <datalist id="na-pratiques">
          {(dimensionConnue?.pratiques ?? []).map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <Champ
          libelle="Intitulé de la pratique (énoncé)"
          required
          value={saisie.intitule}
          onChange={(e) => maj("intitule", e.target.value)}
          erreur={f.erreurs.intitule}
          maxLength={INTITULE_LONGUEUR_MAX + 50}
          aide={compteurCaracteres(saisie.intitule, INTITULE_LONGUEUR_MAX)}
        />
      </fieldset>

      <fieldset className="mp-na-groupe">
        <legend>Échelle et ancrages comportementaux</legend>
        <p className="mp-na-groupe__aide">
          Chaque niveau est décrit par un comportement observable : deux évaluateurs doivent arriver
          au même niveau en lisant la même description.
        </p>
        <Select
          libelle="Nombre de niveaux"
          required
          value={saisie.niveaux}
          onChange={(e) => maj("niveaux", e.target.value)}
          erreur={f.erreurs.niveaux}
          options={Array.from({ length: NIVEAUX_ITEM_MAX - NIVEAUX_ITEM_MIN + 1 }, (_, i) => ({
            valeur: String(NIVEAUX_ITEM_MIN + i),
            libelle: String(NIVEAUX_ITEM_MIN + i),
          }))}
        />
        {niveaux.map((n) => (
          <div key={n} className="mp-na-niveau">
            <p className="mp-na-niveau__titre">Niveau {n}</p>
            <Champ
              libelle={`Libellé du niveau ${n}`}
              required
              value={saisie.libelles[n - 1] ?? ""}
              onChange={(e) => majListe("libelles", n - 1, e.target.value)}
              erreur={f.erreurs[`libelle-${n}`]}
              maxLength={LIBELLE_NIVEAU_LONGUEUR_MAX + 30}
              aide={compteurCaracteres(saisie.libelles[n - 1] ?? "", LIBELLE_NIVEAU_LONGUEUR_MAX)}
            />
            <ZoneTexte
              libelle={`Comportement observable du niveau ${n}`}
              required
              rows={3}
              value={saisie.ancrages[n - 1] ?? ""}
              onChange={(e) => majListe("ancrages", n - 1, e.target.value)}
              erreur={f.erreurs[`ancrage-${n}`] ?? (n === nombre ? f.erreurs.ancrages : undefined)}
              maxLength={ANCRAGE_LONGUEUR_MAX + 200}
              aide={compteurCaracteres(saisie.ancrages[n - 1] ?? "", ANCRAGE_LONGUEUR_MAX)}
            />
          </div>
        ))}
        <p className="mp-na-aide" aria-live="polite">
          Ancrages réunis (aide de la question) : {reuni} / {AIDE_ANCRAGES_LONGUEUR_MAX} caractères.
        </p>
      </fieldset>

      <fieldset className="mp-na-groupe">
        <legend>Formulations par public</legend>
        <p className="mp-na-groupe__aide">
          Une formulation par public visé ; à défaut, le questionnaire retient la formulation « Tous
          publics ». Laissez vide un public sans formulation propre. Au moins une est obligatoire.
        </p>
        {PUBLICS_ITEM_NOTATION.map((p) => (
          <ZoneTexte
            key={p}
            libelle={PUBLIC_ITEM_LIBELLES[p]}
            rows={2}
            value={saisie.formulations[p]}
            onChange={(e) => maj("formulations", { ...saisie.formulations, [p]: e.target.value })}
            erreur={
              f.erreurs[`formulation-${p}`] ?? (p === "tous" ? f.erreurs.formulations : undefined)
            }
            maxLength={FORMULATION_LONGUEUR_MAX + 100}
            aide={compteurCaracteres(saisie.formulations[p], FORMULATION_LONGUEUR_MAX)}
          />
        ))}
      </fieldset>

      <fieldset className="mp-na-groupe">
        <legend>Sélection dans un questionnaire</legend>
        <div className="mp-grille-champs">
          <Champ
            libelle="Poids"
            required
            inputMode="decimal"
            value={saisie.poids}
            onChange={(e) => maj("poids", e.target.value)}
            erreur={f.erreurs.poids}
            aide="Supérieur à 0, au plus 100."
          />
          <Champ
            libelle="Priorité"
            required
            inputMode="numeric"
            value={saisie.priorite}
            onChange={(e) => maj("priorite", e.target.value)}
            erreur={f.erreurs.priorite}
            aide="De 1 (cœur de la dimension) à 9."
          />
          <Champ
            libelle="Durée de réponse (secondes)"
            required
            inputMode="numeric"
            value={saisie.duree}
            onChange={(e) => maj("duree", e.target.value)}
            erreur={f.erreurs.duree}
            aide="De 5 à 600 secondes."
          />
        </div>
      </fieldset>

      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {itemId ? "Enregistrer le brouillon" : "Créer le brouillon"}
        </Bouton>
      </div>
    </form>
  );
}
