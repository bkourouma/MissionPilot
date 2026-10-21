"use client";

import { useState, type FormEvent } from "react";
import {
  RED_FINANCEMENT_PERIODES_MAX,
  RED_FINANCEMENT_SENS,
  RED_FINANCEMENT_SENS_LIBELLES,
  RED_FINANCEMENT_TYPE_PERIODE_LIBELLES,
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
  TEXTE_PROPOSITION,
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
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";

const OPTIONS_TYPES = RED_FINANCEMENT_TYPES_PERIODE.map((t) => ({
  valeur: t,
  libelle: RED_FINANCEMENT_TYPE_PERIODE_LIBELLES[t],
}));
const OPTIONS_SENS = RED_FINANCEMENT_SENS.map((t) => ({
  valeur: t,
  libelle: RED_FINANCEMENT_SENS_LIBELLES[t],
}));
const optionsNatures = (sens: RedFinancementSens) =>
  naturesDuSens(sens).map((n) => ({ valeur: n, libelle: libelleNatureFinancement(n) }));
const OPTIONS_PERIODES = Array.from({ length: RED_FINANCEMENT_PERIODES_MAX }, (_, i) => ({
  valeur: String(i + 1),
  libelle: `Période ${i + 1}`,
}));

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
  const f = useFormulaire<ChampFinancement>();
  const [s, setS] = useState<SaisieFinancement>(() =>
    saisieFinancementDepuis(version, devise, aujourdhui),
  );
  const [propositionEnCours, setPropositionEnCours] = useState(false);
  const [retour, setRetour] = useState<{ ton: "info" | "danger"; texte: string } | null>(null);

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
      setRetour({ ton: "info", texte: messageProposition(p) });
    } catch (e) {
      setRetour({ ton: "danger", texte: messageRedressement(e) });
    } finally {
      setPropositionEnCours(false);
    }
  }

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      corpsFinancementDepuisFormulaire(s, devise),
      (charge) => api.post(cheminVersionsFinancement(dossierId), charge),
      {
        succes: "Nouvelle version du plan de financement enregistrée.",
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
      aria-label="Nouvelle version du plan de financement"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Enregistrement impossible"
      />
      <div className="mp-grille-champs">
        <Champ
          libelle="Date de début (1er du mois)"
          type="date"
          required
          value={s.date_debut}
          onChange={(e) => setS((x) => ({ ...x, date_debut: e.target.value }))}
          erreur={f.erreurs.date_debut}
        />
        <Select
          libelle="Type de période"
          required
          value={s.type_periode}
          onChange={(e) =>
            setS((x) => ({ ...x, type_periode: e.target.value as RedFinancementTypePeriode }))
          }
          options={OPTIONS_TYPES}
          erreur={f.erreurs.type_periode}
        />
        <Champ
          libelle="Nombre de périodes"
          required
          inputMode="numeric"
          autoComplete="off"
          value={s.nombre_periodes}
          onChange={(e) => setS((x) => ({ ...x, nombre_periodes: e.target.value }))}
          erreur={f.erreurs.nombre_periodes}
          aide={`De 1 à ${RED_FINANCEMENT_PERIODES_MAX}.`}
        />
      </div>

      <div className="mp-red-section">
        <h3 className="mp-red-section__titre">Emplois et ressources</h3>
        {f.erreurs.lignes ? (
          <Alerte tonalite="danger" annonce="alert">
            <p>{f.erreurs.lignes}</p>
          </Alerte>
        ) : null}
        {s.lignes.length === 0 ? (
          <p className="mp-texte-doux">
            Aucune ligne : ajoutez les emplois et les ressources de chaque période.
          </p>
        ) : (
          <ul className="mp-red-lignes">
            {s.lignes.map((l, i) => (
              <li key={l.cle} className="mp-red-ligne">
                <p className="mp-red-ligne__reference">
                  Ligne {i + 1}
                  {l.origine !== null ? " : proposée, à relire" : ""}
                </p>
                <Select
                  libelle="Sens"
                  value={l.sens}
                  onChange={(e) => {
                    const sens = e.target.value as RedFinancementSens;
                    majLigne(l.cle, { sens, nature: naturesDuSens(sens)[0] ?? "" });
                  }}
                  options={OPTIONS_SENS}
                />
                <Select
                  libelle="Nature"
                  value={l.nature}
                  onChange={(e) => majLigne(l.cle, { nature: e.target.value })}
                  options={optionsNatures(l.sens)}
                />
                <Select
                  libelle="Période"
                  value={l.periode}
                  onChange={(e) => majLigne(l.cle, { periode: e.target.value })}
                  options={OPTIONS_PERIODES}
                />
                <Champ
                  libelle="Montant"
                  inputMode="decimal"
                  autoComplete="off"
                  value={l.montant}
                  onChange={(e) => majLigne(l.cle, { montant: e.target.value })}
                  aide={aideMontant(devise)}
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
                  aria-label={`Retirer la ligne ${i + 1} (${libelleNatureFinancement(l.nature)}, période ${l.periode})`}
                  onClick={() =>
                    setS((x) => ({ ...x, lignes: x.lignes.filter((y) => y.cle !== l.cle) }))
                  }
                >
                  Retirer
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
            Ajouter une ligne
          </Bouton>
          <Bouton
            variante="secondaire"
            chargement={propositionEnCours}
            texteChargement="Chargement…"
            onClick={() => void preremplir()}
          >
            Pré-remplir depuis la trésorerie et les accords
          </Bouton>
        </div>
        <p className="mp-texte-doux mp-texte-petit">{TEXTE_PROPOSITION}</p>
        <div aria-live="polite">
          {retour ? (
            <Alerte tonalite={retour.ton} annonce="status">
              <p>{retour.texte}</p>
            </Alerte>
          ) : null}
        </div>
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
