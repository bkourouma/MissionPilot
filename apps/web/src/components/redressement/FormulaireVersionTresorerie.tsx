"use client";

import { useState, type FormEvent } from "react";
import type {
  RedPropositionEcheancesVue,
  RedSensFlux,
  RedTresorerieVersionVue,
  RedTresorerieVue,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import { aideMontant } from "../../lib/saisie";
import type { Devise } from "../../lib/format";
import {
  abregerSemaine,
  cheminEcheancesAccords,
  cheminVersionsTresorerie,
  libelleCategorieFlux,
  messageRedressement,
  optionsCategories,
  optionsSensFlux,
} from "../../lib/redressement";
import {
  corpsVersionDepuisFormulaire,
  ligneVide,
  montantVersTexte,
  nouvelleCleLigne,
  saisieVersionDepuis,
  type ChampVersionTresorerie,
  type SaisieLigneTresorerie,
  type SaisieVersionTresorerie,
} from "../../lib/redressement-saisie";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { indexFocusApresRetrait, useFocusLignes } from "./useFocusLignes";

/**
 * « Nouvelle version de la prévision » (RED-11) : fenêtre (lundi de début, solde bancaire
 * initial, seuil de tension) puis lignes d'encaissements et de décaissements attendus, semaine
 * par semaine. Préremplie depuis la version courante ; une nouvelle version décale la fenêtre ou
 * corrige la prévision sans rien effacer (ajout seul). « Importer les échéances des accords »
 * ajoute au brouillon les lignes proposées par l'API, sans enregistrer.
 */
export function FormulaireVersionTresorerie({
  dossierId,
  devise,
  version,
  aujourdhui,
}: {
  dossierId: string;
  devise: Devise;
  version: RedTresorerieVersionVue | null;
  aujourdhui: string;
}) {
  const t = useT();
  const langue = useLangue();
  const SEMAINES = Array.from({ length: 13 }, (_, i) => ({
    valeur: String(i + 1),
    libelle: abregerSemaine(i + 1, langue),
  }));
  const f = useFormulaire<ChampVersionTresorerie>();
  const { refListe, focaliser } = useFocusLignes();
  const [s, setS] = useState<SaisieVersionTresorerie>(() =>
    saisieVersionDepuis(version, devise, aujourdhui),
  );
  const [importEnCours, setImportEnCours] = useState(false);
  const [retourImport, setRetourImport] = useState<{
    ton: "info" | "danger";
    texte: string;
  } | null>(null);

  const majLigne = (cle: string, valeur: Partial<SaisieLigneTresorerie>) =>
    setS((x) => ({
      ...x,
      lignes: x.lignes.map((l) => (l.cle === cle ? { ...l, ...valeur } : l)),
    }));

  async function importer() {
    setImportEnCours(true);
    setRetourImport(null);
    try {
      const p = await api.get<RedPropositionEcheancesVue>(cheminEcheancesAccords(dossierId));
      const presentes = new Set(s.lignes.map((l) => l.echeance_id).filter(Boolean));
      const nouvelles = p.lignes.filter((l) => !presentes.has(l.echeance_id));
      setS((x) => ({
        ...x,
        lignes: [
          ...x.lignes,
          ...nouvelles.map((l): SaisieLigneTresorerie => ({
            cle: nouvelleCleLigne(),
            sens: l.sens,
            categorie: l.categorie,
            semaine: String(l.semaine),
            libelle: t("Échéance d'accord", "Agreement installment"),
            montant: montantVersTexte(l.montant, devise),
            creancier_id: l.creancier_id,
            echeance_id: l.echeance_id,
          })),
        ],
      }));
      const ignorees =
        p.anterieures + p.ulterieures > 0
          ? t(
              ` ${p.anterieures} échéance(s) antérieure(s) et ${p.ulterieures} postérieure(s) à la fenêtre ne sont pas reprises.`,
              ` ${p.anterieures} installment(s) before and ${p.ulterieures} after the window are not included.`,
            )
          : "";
      setRetourImport({
        ton: "info",
        texte: t(
          `${nouvelles.length} ligne(s) ajoutée(s) au brouillon, non enregistrée(s).${ignorees}`,
          `${nouvelles.length} line(s) added to the draft, not saved.${ignorees}`,
        ),
      });
    } catch (e) {
      setRetourImport({ ton: "danger", texte: messageRedressement(e, langue) });
    } finally {
      setImportEnCours(false);
    }
  }

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      corpsVersionDepuisFormulaire(s, devise, langue),
      (charge) => api.post<RedTresorerieVue>(cheminVersionsTresorerie(dossierId), charge),
      {
        succes: t("Nouvelle version de la prévision enregistrée.", "New forecast version saved."),
        messageSpecifique: (e) => messageRedressement(e, langue),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Nouvelle version de la prévision", "New forecast version")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Enregistrement impossible", "Could not save")}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Date de début (un lundi)", "Start date (a Monday)")}
          type="date"
          required
          value={s.date_debut}
          onChange={(e) => setS((x) => ({ ...x, date_debut: e.target.value }))}
          erreur={f.erreurs.date_debut}
          aide={t(
            "Première semaine de la fenêtre de 13 semaines.",
            "First week of the 13-week window.",
          )}
        />
        <Champ
          libelle={t("Solde bancaire initial", "Opening bank balance")}
          required
          inputMode="decimal"
          autoComplete="off"
          value={s.solde_initial}
          onChange={(e) => setS((x) => ({ ...x, solde_initial: e.target.value }))}
          erreur={f.erreurs.solde_initial}
          aide={t(
            `${aideMontant(devise)} Un solde négatif s'écrit avec « - ».`,
            `${aideMontant(devise, langue)} A negative balance is written with "-".`,
          )}
        />
        <Champ
          libelle={t("Seuil de tension", "Tension threshold")}
          inputMode="decimal"
          autoComplete="off"
          value={s.seuil_tension}
          onChange={(e) => setS((x) => ({ ...x, seuil_tension: e.target.value }))}
          erreur={f.erreurs.seuil_tension}
          aide={t(
            "Une semaine est en tension quand le solde projeté passe sous ce seuil.",
            "A week is tight when the projected balance falls below this threshold.",
          )}
        />
      </div>

      <div className="mp-red-section">
        <h3 className="mp-red-section__titre">{t("Lignes de la prévision", "Forecast lines")}</h3>
        {f.erreurs.lignes ? (
          <Alerte tonalite="danger" annonce="alert">
            <p>{f.erreurs.lignes}</p>
          </Alerte>
        ) : null}
        {s.lignes.length === 0 ? (
          <p className="mp-texte-doux">
            {t(
              "Aucune ligne : ajoutez les encaissements et décaissements attendus.",
              "No line: add the expected receipts and disbursements.",
            )}
          </p>
        ) : (
          <ul ref={refListe} className="mp-red-lignes">
            {s.lignes.map((l, i) => {
              const rattachee = l.echeance_id !== null;
              return (
                <li key={l.cle} className="mp-red-ligne">
                  <p className="mp-red-ligne__reference">
                    {t("Ligne", "Line")} {i + 1}
                    {rattachee
                      ? t(
                          " : rattachée à l'échéance d'un accord",
                          ": linked to an agreement installment",
                        )
                      : ""}
                  </p>
                  <Select
                    libelle={t("Sens", "Direction")}
                    value={l.sens}
                    disabled={rattachee}
                    onChange={(e) => {
                      const sens = e.target.value as RedSensFlux;
                      majLigne(l.cle, {
                        sens,
                        categorie: optionsCategories(sens, langue)[0]?.valeur ?? "",
                      });
                    }}
                    options={optionsSensFlux(langue)}
                  />
                  <Select
                    libelle={t("Catégorie", "Category")}
                    value={l.categorie}
                    disabled={rattachee}
                    onChange={(e) => majLigne(l.cle, { categorie: e.target.value })}
                    options={optionsCategories(l.sens, langue)}
                  />
                  <Select
                    libelle={t("Semaine", "Week")}
                    value={l.semaine}
                    onChange={(e) => majLigne(l.cle, { semaine: e.target.value })}
                    options={SEMAINES}
                  />
                  <Champ
                    libelle={t("Montant", "Amount")}
                    inputMode="decimal"
                    autoComplete="off"
                    value={l.montant}
                    onChange={(e) => majLigne(l.cle, { montant: e.target.value })}
                  />
                  <Champ
                    libelle={t("Libellé (facultatif)", "Label (optional)")}
                    maxLength={200}
                    autoComplete="off"
                    value={l.libelle}
                    onChange={(e) => majLigne(l.cle, { libelle: e.target.value })}
                  />
                  <Bouton
                    variante="discret"
                    aria-label={t(
                      `Retirer la ligne ${i + 1} (${libelleCategorieFlux(l.categorie)}, ${abregerSemaine(Number(l.semaine))})`,
                      `Remove line ${i + 1} (${libelleCategorieFlux(l.categorie, langue)}, ${abregerSemaine(Number(l.semaine), langue)})`,
                    )}
                    onClick={() => {
                      setS((x) => ({ ...x, lignes: x.lignes.filter((y) => y.cle !== l.cle) }));
                      focaliser(indexFocusApresRetrait(i, s.lignes.length - 1));
                    }}
                  >
                    {t("Retirer", "Remove")}
                  </Bouton>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mp-actions-formulaire">
          <Bouton
            variante="secondaire"
            onClick={() => {
              setS((x) => ({ ...x, lignes: [...x.lignes, ligneVide()] }));
              focaliser(s.lignes.length);
            }}
          >
            {t("Ajouter une ligne", "Add a line")}
          </Bouton>
          <Bouton
            variante="secondaire"
            chargement={importEnCours}
            texteChargement={t("Import…", "Importing…")}
            onClick={() => void importer()}
          >
            {t("Importer les échéances des accords", "Import agreement installments")}
          </Bouton>
        </div>
        {retourImport ? (
          <Alerte tonalite={retourImport.ton} annonce="status">
            <p>{retourImport.texte}</p>
          </Alerte>
        ) : null}
      </div>

      <ZoneTexte
        libelle={t("Motif (facultatif)", "Reason (optional)")}
        maxLength={500}
        value={s.motif}
        onChange={(e) => setS((x) => ({ ...x, motif: e.target.value }))}
        erreur={f.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer la nouvelle version", "Save the new version")}
        </Bouton>
      </div>
    </form>
  );
}
