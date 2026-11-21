"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
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
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
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
  const refListe = useRef<HTMLFieldSetElement>(null);
  const refAjout = useRef<HTMLButtonElement>(null);
  const focusApres = useRef<number | "ajout" | null>(null);

  // Focus au bon endroit : sur le premier champ de l'élément ajouté, ou sur « Ajouter » après un retrait.
  useEffect(() => {
    const cible = focusApres.current;
    if (cible === null) return;
    focusApres.current = null;
    if (cible === "ajout") refAjout.current?.focus();
    else {
      const elements = refListe.current?.querySelectorAll<HTMLElement>(".mp-regle");
      elements?.item(cible)?.querySelector<HTMLElement>("input, select, textarea")?.focus();
    }
  }, [s.regles.length]);
  const maj = (p: Partial<SaisieListe>) => setS((x) => ({ ...x, ...p }));
  const majRegle = (i: number, p: Partial<SaisieRegle>) =>
    setS((x) => ({ ...x, regles: x.regles.map((r, j) => (j === i ? { ...r, ...p } : r)) }));

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerListe(s, correction, langue),
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
        succes: correction
          ? t("Nouvelle version enregistrée.", "New version saved.")
          : t("Liste créée.", "List created."),
        messageSpecifique: (err) => messageDd(err, langue),
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
        correction
          ? t(`Corriger la liste ${liste.liste.nom}`, `Edit the list ${liste.liste.nom}`)
          : t("Nouvelle liste d'exclusion", "New exclusion list")
      }
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Liste refusée", "List refused")}
      />
      {correction ? null : (
        <div className="mp-grille-champs">
          <Champ
            libelle={t("Nom de la liste", "List name")}
            required
            maxLength={TITRE_MAX}
            value={s.nom}
            onChange={(e) => maj({ nom: e.target.value })}
            erreur={f.erreurs.nom}
          />
          <Select
            libelle={t("Investisseur concerné", "Investor concerned")}
            invite={t("Liste générale (tous les investisseurs)", "General list (all investors)")}
            options={investisseurs}
            value={s.client_id}
            onChange={(e) => maj({ client_id: e.target.value })}
            erreur={f.erreurs.client_id}
          />
        </div>
      )}
      <Champ
        libelle={t("Cadre public de référence", "Public reference framework")}
        maxLength={300}
        value={s.reference_cadre}
        onChange={(e) => maj({ reference_cadre: e.target.value })}
        erreur={f.erreurs.reference_cadre}
        aide={t(
          "Le nom d'un document public dont la liste s'inspire (par exemple « Normes de performance de la SFI »). Aucun extrait.",
          "The name of a public document the list draws on (for example “IFC Performance Standards”). No excerpt.",
        )}
      />
      {f.erreurs.regles ? (
        <Alerte tonalite="danger" titre={t("Règles à corriger", "Rules to fix")} annonce="alert">
          <p>{f.erreurs.regles}</p>
        </Alerte>
      ) : null}
      <fieldset className="mp-groupe" ref={refListe}>
        <legend className="mp-champ__libelle">{t("Règles d'exclusion", "Exclusion rules")}</legend>
        {s.regles.map((r, i) => (
          <div key={r.code !== "" ? r.code : `nouvelle-${i}`} className="mp-regle">
            <Champ
              libelle={t(`Règle ${i + 1} : libellé`, `Rule ${i + 1}: label`)}
              maxLength={TITRE_MAX}
              value={r.libelle}
              onChange={(e) => majRegle(i, { libelle: e.target.value })}
            />
            <Champ
              libelle={t("Mots-clés", "Keywords")}
              value={r.mots_cles}
              onChange={(e) => majRegle(i, { mots_cles: e.target.value })}
              aide={t(
                "Séparés par des virgules (10 au plus, de 60 caractères au plus). Un mot-clé correspond aussi à ses dérivés (« casino » : « casinos »).",
                "Separated by commas (10 at most, 60 characters at most each). A keyword also matches its derived forms (“casino”: “casinos”).",
              )}
            />
            <div className="mp-grille-champs">
              <ChoixMultiple
                libelle={t("Secteurs concernés", "Sectors concerned")}
                options={optionsTaxonomie(secteurs)}
                valeurs={r.secteur_codes}
                onChange={(v) => majRegle(i, { secteur_codes: v })}
                libelleAjout={t("Ajouter le secteur", "Add the sector")}
              />
              <ChoixMultiple
                libelle={t("Pays concernés", "Countries concerned")}
                options={optionsTaxonomie(pays)}
                valeurs={r.pays_codes}
                onChange={(v) => majRegle(i, { pays_codes: v })}
                libelleAjout={t("Ajouter le pays", "Add the country")}
              />
            </div>
            <div>
              <Bouton
                variante="discret"
                onClick={() => {
                  focusApres.current = "ajout";
                  setS((x) => ({ ...x, regles: x.regles.filter((_, j) => j !== i) }));
                }}
                aria-label={t(`Retirer la règle ${i + 1}`, `Remove rule ${i + 1}`)}
              >
                {t("Retirer la règle", "Remove the rule")}
              </Bouton>
            </div>
          </div>
        ))}
        <div>
          <Bouton
            ref={refAjout}
            variante="secondaire"
            icone="plus"
            onClick={() => {
              focusApres.current = s.regles.length;
              setS((x) => ({ ...x, regles: [...x.regles, saisieRegleVide()] }));
            }}
          >
            {t("Ajouter une règle", "Add a rule")}
          </Bouton>
        </div>
      </fieldset>
      {correction ? (
        <ZoneTexte
          libelle={t("Motif de la correction", "Reason for the correction")}
          required
          rows={2}
          maxLength={MOTIF_MAX}
          value={s.motif}
          onChange={(e) => maj({ motif: e.target.value })}
          erreur={f.erreurs.motif}
          aide={t("Conservé dans l'historique des versions.", "Kept in the version history.")}
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {correction
            ? t("Enregistrer la nouvelle version", "Save the new version")
            : t("Créer la liste", "Create the list")}
        </Bouton>
      </div>
    </form>
  );
}
