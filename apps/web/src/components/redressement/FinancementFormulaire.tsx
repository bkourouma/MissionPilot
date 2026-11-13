"use client";

import { useState, type FormEvent } from "react";
import {
  RED_FINANCEMENT_PERIODES_MAX,
  RED_FINANCEMENT_SENS,
  RED_FINANCEMENT_TYPES_PERIODE,
  type RedFinancementPropositionVue,
  type RedFinancementSens,
  type RedFinancementTypePeriode,
  type RedFinancementVersionVue,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import type { Devise } from "../../lib/format";
import { messageRedressement } from "../../lib/redressement";
import {
  cheminPropositionFinancement,
  cheminVersionsFinancement,
  libelleNatureFinancement,
  libelleSensFinancement,
  libelleTypePeriodeFinancement,
  textesFinancement,
} from "../../lib/redressement-financement";
import {
  appliquerProposition,
  cadreProposition,
  corpsFinancementDepuisFormulaire,
  ligneFinancementVide,
  messageProposition,
  naturesDuSens,
  saisieFinancementDepuis,
  type ChampFinancement,
  type SaisieFinancement,
  type SaisieLigneFinancement,
} from "../../lib/redressement-financement-saisie";
import { aideMontant } from "../../lib/saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

/**
 * Nouvelle version du plan de financement : cadre (premier jour de mois, années ou semestres,
 * nombre de périodes) puis lignes d'emplois et de ressources par période. « Pré-remplir depuis la
 * trésorerie et les accords » interroge la proposition de l'API et alimente le brouillon sans
 * rien enregistrer : le consultant relit, ajuste puis enregistre.
 */
export function FinancementFormulaire({
  dossierId,
  devise,
  version,
  aujourdhui,
}: {
  dossierId: string;
  devise: Devise;
  version: RedFinancementVersionVue | null;
  aujourdhui: string;
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampFinancement>();
  const [s, setS] = useState<SaisieFinancement>(() =>
    saisieFinancementDepuis(version, devise, aujourdhui),
  );
  const [propositionEnCours, setPropositionEnCours] = useState(false);
  const [retour, setRetour] = useState<{ ton: "info" | "danger"; texte: string } | null>(null);

  const optionsTypes = RED_FINANCEMENT_TYPES_PERIODE.map((v) => ({
    valeur: v,
    libelle: libelleTypePeriodeFinancement(v, langue),
  }));
  const optionsSens = RED_FINANCEMENT_SENS.map((v) => ({
    valeur: v,
    libelle: libelleSensFinancement(v, langue),
  }));
  const optionsNatures = (sens: RedFinancementSens) =>
    naturesDuSens(sens).map((n) => ({ valeur: n, libelle: libelleNatureFinancement(n, langue) }));
  const optionsPeriodes = Array.from({ length: RED_FINANCEMENT_PERIODES_MAX }, (_, i) => ({
    valeur: String(i + 1),
    libelle: `${t("Période", "Period")} ${i + 1}`,
  }));

  const majLigne = (cle: string, valeur: Partial<SaisieLigneFinancement>) =>
    setS((x) => ({
      ...x,
      lignes: x.lignes.map((l) => (l.cle === cle ? { ...l, ...valeur } : l)),
    }));

  async function preremplir() {
    setPropositionEnCours(true);
    setRetour(null);
    try {
      const p = await api.get<RedFinancementPropositionVue>(
        cheminPropositionFinancement(dossierId, cadreProposition(s)),
      );
      setS((x) => appliquerProposition(x, p, devise));
      setRetour({ ton: "info", texte: messageProposition(p, langue) });
    } catch (e) {
      setRetour({ ton: "danger", texte: messageRedressement(e, langue) });
    } finally {
      setPropositionEnCours(false);
    }
  }

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      corpsFinancementDepuisFormulaire(s, devise, langue),
      (charge) => api.post(cheminVersionsFinancement(dossierId), charge),
      {
        succes: t(
          "Nouvelle version du plan de financement enregistrée.",
          "New financing plan version saved.",
        ),
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
      aria-label={t("Nouvelle version du plan de financement", "New financing plan version")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Enregistrement impossible", "Saving not possible")}
      />
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Date de début (1er du mois)", "Start date (1st of the month)")}
          type="date"
          required
          value={s.date_debut}
          onChange={(e) => setS((x) => ({ ...x, date_debut: e.target.value }))}
          erreur={f.erreurs.date_debut}
        />
        <Select
          libelle={t("Type de période", "Period type")}
          required
          value={s.type_periode}
          onChange={(e) =>
            setS((x) => ({ ...x, type_periode: e.target.value as RedFinancementTypePeriode }))
          }
          options={optionsTypes}
          erreur={f.erreurs.type_periode}
        />
        <Champ
          libelle={t("Nombre de périodes", "Number of periods")}
          required
          inputMode="numeric"
          autoComplete="off"
          value={s.nombre_periodes}
          onChange={(e) => setS((x) => ({ ...x, nombre_periodes: e.target.value }))}
          erreur={f.erreurs.nombre_periodes}
          aide={t(
            `De 1 à ${RED_FINANCEMENT_PERIODES_MAX}.`,
            `From 1 to ${RED_FINANCEMENT_PERIODES_MAX}.`,
          )}
        />
      </div>

      <div className="mp-red-section">
        <h3 className="mp-red-section__titre">
          {t("Emplois et ressources", "Uses and resources")}
        </h3>
        {f.erreurs.lignes ? (
          <Alerte tonalite="danger" annonce="alert">
            <p>{f.erreurs.lignes}</p>
          </Alerte>
        ) : null}
        {s.lignes.length === 0 ? (
          <p className="mp-texte-doux">
            {t(
              "Aucune ligne : ajoutez les emplois et les ressources de chaque période.",
              "No line: add the uses and resources of each period.",
            )}
          </p>
        ) : (
          <ul className="mp-red-lignes">
            {s.lignes.map((l, i) => (
              <li key={l.cle} className="mp-red-ligne">
                <p className="mp-red-ligne__reference">
                  {t("Ligne", "Line")} {i + 1}
                  {l.origine !== null ? t(" : proposée, à relire", ": proposed, to review") : ""}
                </p>
                <Select
                  libelle={t("Sens", "Direction")}
                  value={l.sens}
                  onChange={(e) => {
                    const sens = e.target.value as RedFinancementSens;
                    majLigne(l.cle, { sens, nature: naturesDuSens(sens)[0] ?? "" });
                  }}
                  options={optionsSens}
                />
                <Select
                  libelle={t("Nature", "Nature")}
                  value={l.nature}
                  onChange={(e) => majLigne(l.cle, { nature: e.target.value })}
                  options={optionsNatures(l.sens)}
                />
                <Select
                  libelle={t("Période", "Period")}
                  value={l.periode}
                  onChange={(e) => majLigne(l.cle, { periode: e.target.value })}
                  options={optionsPeriodes}
                />
                <Champ
                  libelle={t("Montant", "Amount")}
                  inputMode="decimal"
                  autoComplete="off"
                  value={l.montant}
                  onChange={(e) => majLigne(l.cle, { montant: e.target.value })}
                  aide={aideMontant(devise, langue)}
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
                    `Retirer la ligne ${i + 1} (${libelleNatureFinancement(l.nature)}, période ${l.periode})`,
                    `Remove line ${i + 1} (${libelleNatureFinancement(l.nature, langue)}, period ${l.periode})`,
                  )}
                  onClick={() =>
                    setS((x) => ({ ...x, lignes: x.lignes.filter((y) => y.cle !== l.cle) }))
                  }
                >
                  {t("Retirer", "Remove")}
                </Bouton>
              </li>
            ))}
          </ul>
        )}
        <div className="mp-actions-formulaire">
          <Bouton
            variante="secondaire"
            onClick={() => setS((x) => ({ ...x, lignes: [...x.lignes, ligneFinancementVide()] }))}
          >
            {t("Ajouter une ligne", "Add a line")}
          </Bouton>
          <Bouton
            variante="secondaire"
            chargement={propositionEnCours}
            texteChargement={t("Chargement…", "Loading…")}
            onClick={() => void preremplir()}
          >
            {t(
              "Pré-remplir depuis la trésorerie et les accords",
              "Pre-fill from the cash forecast and the agreements",
            )}
          </Bouton>
        </div>
        <p className="mp-texte-doux mp-texte-petit">{textesFinancement(langue).proposition}</p>
        <div aria-live="polite">
          {retour ? (
            <Alerte tonalite={retour.ton} annonce="status">
              <p>{retour.texte}</p>
            </Alerte>
          ) : null}
        </div>
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
