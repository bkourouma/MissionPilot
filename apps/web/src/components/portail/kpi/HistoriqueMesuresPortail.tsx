"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../../lib/api";
import { formaterDate, formaterDateHeure, libelleUnite } from "../../../lib/format";
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
import { useLangue, useT } from "../../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
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
          const etat = etatMesurePortail(m, langue);
          const corrigeable = mesureCorrigeable(m, saisissable);
          const dateMesure = formaterDate(m.date_mesure, "UTC", langue);
          return (
            <li
              key={m.id}
              className={m.active ? "mp-kpi-ligne mp-kpi-ligne--active" : "mp-kpi-ligne"}
            >
              <div className="mp-kpi-ligne__entete">
                <p className="mp-kpi-ligne__date">
                  {dateMesure}
                  <span className="mp-texte-doux"> · {libellePeriode(m.periode, langue)}</span>
                </p>
                <BadgeStatut tonalite={etat.tonalite}>{etat.libelle}</BadgeStatut>
              </div>
              <p className="mp-kpi-ligne__valeur">
                {m.annulation
                  ? t("Annulation de la mesure", "Measurement cancellation")
                  : formaterValeurKpi(m.valeur, kpi.unite, langue)}
              </p>
              <dl className="mp-kpi-ligne__details">
                {m.remplace_id && !m.annulation ? (
                  <div>
                    <dt>{t("Nature", "Type")}</dt>
                    <dd>
                      {t(
                        "Correction d'une mesure précédente",
                        "Correction of a previous measurement",
                      )}
                    </dd>
                  </div>
                ) : null}
                {m.motif ? (
                  <div>
                    <dt>{t("Motif", "Reason")}</dt>
                    <dd className="mp-texte-preserve">{m.motif}</dd>
                  </div>
                ) : null}
                {m.commentaire ? (
                  <div>
                    <dt>{t("Commentaire", "Comment")}</dt>
                    <dd className="mp-texte-preserve">{m.commentaire}</dd>
                  </div>
                ) : null}
                {m.justificatif ? (
                  <div>
                    <dt>{t("Justificatif", "Supporting document")}</dt>
                    <dd className="mp-coupure">{m.justificatif}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>{t("Saisie", "Entry")}</dt>
                  <dd>
                    {formaterDateHeure(m.saisie_le, undefined, langue)} · {auteurMesure(m, langue)}
                  </dd>
                </div>
              </dl>
              {corrigeable ? (
                <div className="mp-barre-actions">
                  <Bouton
                    variante="secondaire"
                    icone="crayon"
                    aria-expanded={ouverte === m.id}
                    aria-label={t(
                      `Corriger la mesure du ${dateMesure}`,
                      `Correct the measurement of ${dateMesure}`,
                    )}
                    onClick={() => setOuverte(ouverte === m.id ? null : m.id)}
                  >
                    {t("Corriger", "Correct")}
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
                      t(
                        `Correction enregistrée pour le ${dateMesure} : l'ancienne valeur reste dans l'historique.`,
                        `Correction saved for ${dateMesure}: the old value stays in the history.`,
                      ),
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
  const t = useT();
  const langue = useLangue();
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
      validerCorrection(s, kpi, aujourdhui, langue),
      (charge) => api.post<MesurePortail>(cheminApiCorrectionMesure(mesure.id), charge),
      { messageSpecifique: (err) => messagePortailKpi(err, langue), apres: onSucces },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t(
        `Corriger la mesure du ${formaterDate(mesure.date_mesure, "UTC", langue)}`,
        `Correct the measurement of ${formaterDate(mesure.date_mesure, "UTC", langue)}`,
      )}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur={t("Correction refusée", "Correction refused")}
      />
      <p className="mp-texte-doux mp-texte-petit">
        {t(
          "La correction crée une nouvelle ligne ; l'ancienne reste visible dans l'historique.",
          "The correction creates a new line; the old one stays visible in the history.",
        )}
      </p>
      <div className="mp-grille-champs">
        <Champ
          libelle={t("Date de la mesure", "Measurement date")}
          type="date"
          required
          min={kpi.debut_suivi}
          max={max}
          value={s.date_mesure}
          onChange={maj("date_mesure")}
          erreur={f.erreurs.date_mesure}
        />
        <Champ
          libelle={
            kpi.unite
              ? `${t("Valeur corrigée", "Corrected value")} (${libelleUnite(kpi.unite)})`
              : t("Valeur corrigée", "Corrected value")
          }
          required
          inputMode="decimal"
          autoComplete="off"
          value={s.valeur}
          onChange={maj("valeur")}
          erreur={f.erreurs.valeur}
        />
      </div>
      <ZoneTexte
        libelle={t("Motif de la correction", "Reason for the correction")}
        required
        rows={2}
        maxLength={MOTIF_MAX}
        value={s.motif}
        onChange={maj("motif")}
        erreur={f.erreurs.motif}
        aide={t("Obligatoire : il reste dans l'historique.", "Required: it stays in the history.")}
      />
      <ZoneTexte
        libelle={t("Commentaire (facultatif)", "Comment (optional)")}
        rows={2}
        maxLength={COMMENTAIRE_MAX}
        value={s.commentaire}
        onChange={maj("commentaire")}
        erreur={f.erreurs.commentaire}
      />
      <Champ
        libelle={t("Justificatif (facultatif)", "Supporting document (optional)")}
        maxLength={JUSTIFICATIF_MAX}
        value={s.justificatif}
        onChange={maj("justificatif")}
        erreur={f.erreurs.justificatif}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer la correction", "Save the correction")}
        </Bouton>
      </div>
    </form>
  );
}
