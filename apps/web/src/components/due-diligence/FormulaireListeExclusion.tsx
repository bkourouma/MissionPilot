"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  cheminListesExclusion,
  cheminVersionsListe,
  messageDd,
  type EntreeTaxonomie,
  type ListeExclusion,
  type VersionListeExclusion,
  type ReponseEcriture,
} from "../../lib/due-diligence";
import {
  MOTIF_MAX,
  saisieRegleVide,
  TITRE_MAX,
  validerListe,
  type ChampListe,
  type SaisieListe,
  type SaisieRegle,
} from "../../lib/due-diligence-saisie";
import { joindreListe } from "../../lib/saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { ChoixMultiple } from "./ChoixMultiple";

const optionsTaxonomie = (entrees: readonly EntreeTaxonomie[]) =>
  entrees.map((e) => ({ valeur: e.code, libelle: e.libelle }));

export interface FormulaireListeExclusionProps {
  secteurs: readonly EntreeTaxonomie[];
  pays: readonly EntreeTaxonomie[];
  /** Investisseurs proposés (clients du cabinet) ; vide : seule la liste générale est possible. */
  investisseurs: { valeur: string; libelle: string }[];
  /** Présent : correction de cette liste (nouvelle version, motif exigé) à partir de sa version courante. */
  liste?: { liste: ListeExclusion; courante: VersionListeExclusion };
}

/**
 * Liste d'exclusion (DD-14) : règles à mots-clés, secteurs et pays, générale ou propre à un
 * investisseur. Le cadre public d'inspiration est cité en référence (nom seulement, aucun
 * extrait). Le code interne d'une règle est tiré de son libellé.
 */
export function FormulaireListeExclusion({
  secteurs,
  pays,
  investisseurs,
  liste,
}: FormulaireListeExclusionProps) {
  const f = useFormulaire<ChampListe>();
  const correction = liste !== undefined;
  const [s, setS] = useState<SaisieListe>(
    liste
      ? {
          nom: liste.liste.nom,
          client_id: liste.liste.client_id ?? "",
          reference_cadre: liste.courante.reference_cadre ?? "",
          regles: liste.courante.regles.map((r) => ({
            libelle: r.libelle,
            mots_cles: joindreListe(r.mots_cles),
            secteur_codes: r.secteur_codes,
            pays_codes: r.pays_codes,
            code: r.code,
          })),
          motif: "",
        }
      : { nom: "", client_id: "", reference_cadre: "", regles: [saisieRegleVide()], motif: "" },
  );
  const maj = (p: Partial<SaisieListe>) => setS((x) => ({ ...x, ...p }));
  const majRegle = (i: number, p: Partial<SaisieRegle>) =>
    setS((x) => ({ ...x, regles: x.regles.map((r, j) => (j === i ? { ...r, ...p } : r)) }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerListe(s, correction),
      (charge) =>
        liste
          ? api.post<ReponseEcriture>(cheminVersionsListe(liste.liste.id), {
              regles: charge.regles,
              reference_cadre: charge.reference_cadre,
              motif: charge.motif,
              version_courante: liste.liste.version,
            })
          : api.post<ReponseEcriture>(cheminListesExclusion(), charge),
      {
        succes: correction ? "Nouvelle version enregistrée." : "Liste créée.",
        messageSpecifique: messageDd,
        apres: () =>
          correction
            ? maj({ motif: "" })
            : setS({
                nom: "",
                client_id: "",
                reference_cadre: "",
                regles: [saisieRegleVide()],
                motif: "",
              }),
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
        correction ? `Corriger la liste ${liste.liste.nom}` : "Nouvelle liste d'exclusion"
      }
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Liste refusée"
      />
      {correction ? null : (
        <div className="mp-grille-champs">
          <Champ
            libelle="Nom de la liste"
            required
            maxLength={TITRE_MAX}
            value={s.nom}
            onChange={(e) => maj({ nom: e.target.value })}
            erreur={f.erreurs.nom}
          />
          <Select
            libelle="Investisseur concerné"
            invite="Liste générale (tous les investisseurs)"
            options={investisseurs}
            value={s.client_id}
            onChange={(e) => maj({ client_id: e.target.value })}
            erreur={f.erreurs.client_id}
          />
        </div>
      )}
      <Champ
        libelle="Cadre public de référence"
        maxLength={300}
        value={s.reference_cadre}
        onChange={(e) => maj({ reference_cadre: e.target.value })}
        erreur={f.erreurs.reference_cadre}
        aide="Le nom d'un document public dont la liste s'inspire (par exemple « Normes de performance de la SFI »). Aucun extrait."
      />
      {f.erreurs.regles ? (
        <Alerte tonalite="danger" titre="Règles à corriger" annonce="alert">
          <p>{f.erreurs.regles}</p>
        </Alerte>
      ) : null}
      <fieldset className="mp-groupe">
        <legend className="mp-champ__libelle">Règles d&apos;exclusion</legend>
        {s.regles.map((r, i) => (
          <div key={r.code !== "" ? r.code : `nouvelle-${i}`} className="mp-regle">
            <Champ
              libelle={`Règle ${i + 1} : libellé`}
              maxLength={TITRE_MAX}
              value={r.libelle}
              onChange={(e) => majRegle(i, { libelle: e.target.value })}
            />
            <Champ
              libelle="Mots-clés"
              value={r.mots_cles}
              onChange={(e) => majRegle(i, { mots_cles: e.target.value })}
              aide="Séparés par des virgules (10 au plus, de 60 caractères au plus). Un mot-clé correspond aussi à ses dérivés (« casino » : « casinos »)."
            />
            <div className="mp-grille-champs">
              <ChoixMultiple
                libelle="Secteurs concernés"
                options={optionsTaxonomie(secteurs)}
                valeurs={r.secteur_codes}
                onChange={(v) => majRegle(i, { secteur_codes: v })}
                libelleAjout="Ajouter le secteur"
              />
              <ChoixMultiple
                libelle="Pays concernés"
                options={optionsTaxonomie(pays)}
                valeurs={r.pays_codes}
                onChange={(v) => majRegle(i, { pays_codes: v })}
                libelleAjout="Ajouter le pays"
              />
            </div>
            <div>
              <Bouton
                variante="discret"
                onClick={() => setS((x) => ({ ...x, regles: x.regles.filter((_, j) => j !== i) }))}
                aria-label={`Retirer la règle ${i + 1}`}
              >
                Retirer la règle
              </Bouton>
            </div>
          </div>
        ))}
        <div>
          <Bouton
            variante="secondaire"
            icone="plus"
            onClick={() => setS((x) => ({ ...x, regles: [...x.regles, saisieRegleVide()] }))}
          >
            Ajouter une règle
          </Bouton>
        </div>
      </fieldset>
      {correction ? (
        <ZoneTexte
          libelle="Motif de la correction"
          required
          rows={2}
          maxLength={MOTIF_MAX}
          value={s.motif}
          onChange={(e) => maj({ motif: e.target.value })}
          erreur={f.erreurs.motif}
          aide="Conservé dans l'historique des versions."
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          {correction ? "Enregistrer la nouvelle version" : "Créer la liste"}
        </Bouton>
      </div>
    </form>
  );
}
