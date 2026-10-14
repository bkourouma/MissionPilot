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
  RED_SENS_OPTIONS,
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
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

const SEMAINES = Array.from({ length: 13 }, (_, i) => ({
  valeur: String(i + 1),
  libelle: abregerSemaine(i + 1),
}));

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
  const f = useFormulaire<ChampVersionTresorerie>();
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
            libelle: "Échéance d'accord",
            montant: montantVersTexte(l.montant, devise),
            creancier_id: l.creancier_id,
            echeance_id: l.echeance_id,
          })),
        ],
      }));
      const ignorees =
        p.anterieures + p.ulterieures > 0
          ? ` ${p.anterieures} échéance(s) antérieure(s) et ${p.ulterieures} postérieure(s) à la fenêtre ne sont pas reprises.`
          : "";
      setRetourImport({
        ton: "info",
        texte: `${nouvelles.length} ligne(s) ajoutée(s) au brouillon, non enregistrée(s).${ignorees}`,
      });
    } catch (e) {
      setRetourImport({ ton: "danger", texte: messageRedressement(e) });
    } finally {
      setImportEnCours(false);
    }
  }

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      corpsVersionDepuisFormulaire(s, devise),
      (charge) => api.post<RedTresorerieVue>(cheminVersionsTresorerie(dossierId), charge),
      {
        succes: "Nouvelle version de la prévision enregistrée.",
        messageSpecifique: messageRedressement,
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label="Nouvelle version de la prévision"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Enregistrement impossible"
      />
      <div className="mp-grille-champs">
        <Champ
          libelle="Date de début (un lundi)"
          type="date"
          required
          value={s.date_debut}
          onChange={(e) => setS((x) => ({ ...x, date_debut: e.target.value }))}
          erreur={f.erreurs.date_debut}
          aide="Première semaine de la fenêtre de 13 semaines."
        />
        <Champ
          libelle="Solde bancaire initial"
          required
          inputMode="decimal"
          autoComplete="off"
          value={s.solde_initial}
          onChange={(e) => setS((x) => ({ ...x, solde_initial: e.target.value }))}
          erreur={f.erreurs.solde_initial}
          aide={`${aideMontant(devise)} Un solde négatif s'écrit avec « - ».`}
        />
        <Champ
          libelle="Seuil de tension"
          inputMode="decimal"
          autoComplete="off"
          value={s.seuil_tension}
          onChange={(e) => setS((x) => ({ ...x, seuil_tension: e.target.value }))}
          erreur={f.erreurs.seuil_tension}
          aide="Une semaine est en tension quand le solde projeté passe sous ce seuil."
        />
      </div>

      <div className="mp-red-section">
        <h3 className="mp-red-section__titre">Lignes de la prévision</h3>
        {f.erreurs.lignes ? (
          <Alerte tonalite="danger" annonce="alert">
            <p>{f.erreurs.lignes}</p>
          </Alerte>
        ) : null}
        {s.lignes.length === 0 ? (
          <p className="mp-texte-doux">
            Aucune ligne : ajoutez les encaissements et décaissements attendus.
          </p>
        ) : (
          <ul className="mp-red-lignes">
            {s.lignes.map((l, i) => {
              const rattachee = l.echeance_id !== null;
              return (
                <li key={l.cle} className="mp-red-ligne">
                  <p className="mp-red-ligne__reference">
                    Ligne {i + 1}
                    {rattachee ? " : rattachée à l'échéance d'un accord" : ""}
                  </p>
                  <Select
                    libelle="Sens"
                    value={l.sens}
                    disabled={rattachee}
                    onChange={(e) => {
                      const sens = e.target.value as RedSensFlux;
                      majLigne(l.cle, {
                        sens,
                        categorie: optionsCategories(sens)[0]?.valeur ?? "",
                      });
                    }}
                    options={RED_SENS_OPTIONS}
                  />
                  <Select
                    libelle="Catégorie"
                    value={l.categorie}
                    disabled={rattachee}
                    onChange={(e) => majLigne(l.cle, { categorie: e.target.value })}
                    options={optionsCategories(l.sens)}
                  />
                  <Select
                    libelle="Semaine"
                    value={l.semaine}
                    onChange={(e) => majLigne(l.cle, { semaine: e.target.value })}
                    options={SEMAINES}
                  />
                  <Champ
                    libelle="Montant"
                    inputMode="decimal"
                    autoComplete="off"
                    value={l.montant}
                    onChange={(e) => majLigne(l.cle, { montant: e.target.value })}
                  />
                  <Champ
                    libelle="Libellé (facultatif)"
                    maxLength={200}
                    autoComplete="off"
                    value={l.libelle}
                    onChange={(e) => majLigne(l.cle, { libelle: e.target.value })}
                  />
                  <Bouton
                    variante="discret"
                    aria-label={`Retirer la ligne ${i + 1} (${libelleCategorieFlux(l.categorie)}, ${abregerSemaine(Number(l.semaine))})`}
                    onClick={() =>
                      setS((x) => ({ ...x, lignes: x.lignes.filter((y) => y.cle !== l.cle) }))
                    }
                  >
                    Retirer
                  </Bouton>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mp-actions-formulaire">
          <Bouton
            variante="secondaire"
            onClick={() => setS((x) => ({ ...x, lignes: [...x.lignes, ligneVide()] }))}
          >
            Ajouter une ligne
          </Bouton>
          <Bouton
            variante="secondaire"
            chargement={importEnCours}
            texteChargement="Import…"
            onClick={() => void importer()}
          >
            Importer les échéances des accords
          </Bouton>
        </div>
        {retourImport ? (
          <Alerte tonalite={retourImport.ton} annonce="status">
            <p>{retourImport.texte}</p>
          </Alerte>
        ) : null}
      </div>

      <ZoneTexte
        libelle="Motif (facultatif)"
        maxLength={500}
        value={s.motif}
        onChange={(e) => setS((x) => ({ ...x, motif: e.target.value }))}
        erreur={f.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer la nouvelle version
        </Bouton>
      </div>
    </form>
  );
}
