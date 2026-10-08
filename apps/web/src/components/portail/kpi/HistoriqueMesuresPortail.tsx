"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../../lib/api";
import { formaterDate, formaterDateHeure } from "../../../lib/format";
import { formaterValeurKpi, libellePeriode } from "../../../lib/kpi";
import {
  COMMENTAIRE_MAX,
  dateMesureMax,
  JUSTIFICATIF_MAX,
  MOTIF_MAX,
  validerCorrection,
  valeurVersSaisie,
  type ChampMesure,
  type SaisieMesure,
} from "../../../lib/kpi-saisie";
import {
  auteurMesure,
  cheminApiCorrectionMesure,
  etatMesurePortail,
  mesureCorrigeable,
  messagePortailKpi,
  type KpiPortail,
  type MesurePortail,
} from "../../../lib/portail-kpi";
import { RetourFormulaire } from "../../formulaires/RetourFormulaire";
import { useFormulaire } from "../../formulaires/useFormulaire";
import { Alerte } from "../../ui/Alerte";
import { BadgeStatut } from "../../ui/BadgeStatut";
import { Bouton } from "../../ui/Bouton";
import { Champ } from "../../ui/Champ";
import { ZoneTexte } from "../../ui/ZoneTexte";
import "../../kpi/kpi.css";

type DefinitionMesure = Pick<KpiPortail, "unite" | "debut_suivi" | "fin_suivi">;

/**
 * Historique des mesures du KPI, du plus récent au plus ancien, en ajout seul : une correction
 * crée une nouvelle ligne qui remplace la précédente, qui reste visible. Le contributeur ne
 * corrige que ses propres mesures actives, avec un motif.
 */
export function HistoriqueMesuresPortail({
  kpi,
  lignes,
  aujourdhui,
  saisissable,
}: {
  kpi: DefinitionMesure;
  lignes: readonly MesurePortail[];
  aujourdhui: string;
  saisissable: boolean;
}) {
  const [ouverte, setOuverte] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState<string | null>(null);
  const refAnnonce = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (annonce) refAnnonce.current?.focus();
  }, [annonce]);

  return (
    <div className="mp-pile">
      {annonce ? (
        <Alerte ref={refAnnonce} tonalite="succes" annonce="status">
          <p>{annonce}</p>
        </Alerte>
      ) : null}
      <ol className="mp-kpi-historique">
        {lignes.map((m) => {
          const etat = etatMesurePortail(m);
          const corrigeable = mesureCorrigeable(m, saisissable);
          return (
            <li
              key={m.id}
              className={m.active ? "mp-kpi-ligne mp-kpi-ligne--active" : "mp-kpi-ligne"}
            >
              <div className="mp-kpi-ligne__entete">
                <p className="mp-kpi-ligne__date">
                  {formaterDate(m.date_mesure)}
                  <span className="mp-texte-doux"> · {libellePeriode(m.periode)}</span>
                </p>
                <BadgeStatut tonalite={etat.tonalite}>{etat.libelle}</BadgeStatut>
              </div>
              <p className="mp-kpi-ligne__valeur">
                {m.annulation ? "Annulation de la mesure" : formaterValeurKpi(m.valeur, kpi.unite)}
              </p>
              <dl className="mp-kpi-ligne__details">
                {m.remplace_id && !m.annulation ? (
                  <div>
                    <dt>Nature</dt>
                    <dd>Correction d&apos;une mesure précédente</dd>
                  </div>
                ) : null}
                {m.motif ? (
                  <div>
                    <dt>Motif</dt>
                    <dd className="mp-texte-preserve">{m.motif}</dd>
                  </div>
                ) : null}
                {m.commentaire ? (
                  <div>
                    <dt>Commentaire</dt>
                    <dd className="mp-texte-preserve">{m.commentaire}</dd>
                  </div>
                ) : null}
                {m.justificatif ? (
                  <div>
                    <dt>Justificatif</dt>
                    <dd className="mp-coupure">{m.justificatif}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Saisie</dt>
                  <dd>
                    {formaterDateHeure(m.saisie_le)} · {auteurMesure(m)}
                  </dd>
                </div>
              </dl>
              {corrigeable ? (
                <div className="mp-barre-actions">
                  <Bouton
                    variante="secondaire"
                    icone="crayon"
                    aria-expanded={ouverte === m.id}
                    aria-label={`Corriger la mesure du ${formaterDate(m.date_mesure)}`}
                    onClick={() => setOuverte(ouverte === m.id ? null : m.id)}
                  >
                    Corriger
                  </Bouton>
                </div>
              ) : null}
              {ouverte === m.id ? (
                <FormulaireCorrection
                  mesure={m}
                  kpi={kpi}
                  aujourdhui={aujourdhui}
                  onSucces={() => {
                    setOuverte(null);
                    setAnnonce(
                      `Correction enregistrée pour le ${formaterDate(m.date_mesure)} : l'ancienne valeur reste dans l'historique.`,
                    );
                  }}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function FormulaireCorrection({
  mesure,
  kpi,
  aujourdhui,
  onSucces,
}: {
  mesure: MesurePortail;
  kpi: DefinitionMesure;
  aujourdhui: string;
  onSucces: () => void;
}) {
  const f = useFormulaire<ChampMesure>();
  const [s, setS] = useState<SaisieMesure>({
    date_mesure: mesure.date_mesure,
    valeur: valeurVersSaisie(mesure.valeur),
    commentaire: mesure.commentaire ?? "",
    justificatif: mesure.justificatif ?? "",
    motif: "",
  });
  const maj = (cle: keyof SaisieMesure) => (e: { target: { value: string } }) =>
    setS((x) => ({ ...x, [cle]: e.target.value }));
  const max = dateMesureMax(kpi, aujourdhui);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerCorrection(s, kpi, aujourdhui),
      (charge) => api.post<MesurePortail>(cheminApiCorrectionMesure(mesure.id), charge),
      { messageSpecifique: messagePortailKpi, apres: onSucces },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={`Corriger la mesure du ${formaterDate(mesure.date_mesure)}`}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Correction refusée"
      />
      <p className="mp-texte-doux mp-texte-petit">
        La correction crée une nouvelle ligne ; l&apos;ancienne reste visible dans
        l&apos;historique.
      </p>
      <div className="mp-grille-champs">
        <Champ
          libelle="Date de la mesure"
          type="date"
          required
          min={kpi.debut_suivi}
          max={max}
          value={s.date_mesure}
          onChange={maj("date_mesure")}
          erreur={f.erreurs.date_mesure}
        />
        <Champ
          libelle={kpi.unite ? `Valeur corrigée (${kpi.unite})` : "Valeur corrigée"}
          required
          inputMode="decimal"
          autoComplete="off"
          value={s.valeur}
          onChange={maj("valeur")}
          erreur={f.erreurs.valeur}
        />
      </div>
      <ZoneTexte
        libelle="Motif de la correction"
        required
        rows={2}
        maxLength={MOTIF_MAX}
        value={s.motif}
        onChange={maj("motif")}
        erreur={f.erreurs.motif}
        aide="Obligatoire : il reste dans l'historique."
      />
      <ZoneTexte
        libelle="Commentaire (facultatif)"
        rows={2}
        maxLength={COMMENTAIRE_MAX}
        value={s.commentaire}
        onChange={maj("commentaire")}
        erreur={f.erreurs.commentaire}
      />
      <Champ
        libelle="Justificatif (facultatif)"
        maxLength={JUSTIFICATIF_MAX}
        value={s.justificatif}
        onChange={maj("justificatif")}
        erreur={f.erreurs.justificatif}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer la correction
        </Bouton>
      </div>
    </form>
  );
}
