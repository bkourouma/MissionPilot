"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { formaterDate, formaterDateHeure } from "../../lib/format";
import {
  cheminAnnulationMesure,
  cheminCorrectionMesure,
  etatLigneMesure,
  formaterValeurKpi,
  libellePeriode,
  MAX_CORRECTIONS_PAR_MESURE,
  messageAnnulationKpi,
  messageKpi,
  libelleOrigine,
  rangCorrection,
  type DefinitionKpi,
  type MesureKpi,
} from "../../lib/kpi";
import {
  COMMENTAIRE_MAX,
  dateMesureMax,
  JUSTIFICATIF_MAX,
  MOTIF_MAX,
  validerAnnulation,
  validerCorrection,
  valeurVersSaisie,
  type ChampMesure,
  type SaisieMesure,
} from "../../lib/kpi-saisie";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { ZoneTexte } from "../ui/ZoneTexte";

type DefinitionMesure = Pick<DefinitionKpi, "unite" | "debut_suivi" | "fin_suivi">;

export interface HistoriqueMesuresProps {
  kpi: DefinitionMesure;
  lignes: readonly MesureKpi[];
  aujourdhui: string;
  /** Corriger et annuler les mesures du cabinet (kpi.saisir, mission ouverte, KPI actif). */
  saisir: boolean;
  /** Annuler une mesure d'origine « portail » (gestion du KPI). */
  annulerPortail: boolean;
}

type Panneau = { id: string; action: "corriger" | "annuler" } | null;

/**
 * Historique des mesures EN AJOUT SEUL, du plus récent au plus ancien : chaque saisie,
 * correction et annulation reste, avec son motif, son origine et son auteur. Une mesure
 * active se corrige (nouvelle ligne qui la remplace) ou s'annule (ligne d'annulation), motif
 * obligatoire ; au plus 20 corrections successives par mesure.
 */
export function HistoriqueMesures({
  kpi,
  lignes,
  aujourdhui,
  saisir,
  annulerPortail,
}: HistoriqueMesuresProps) {
  const t = useT();
  const langue = useLangue();
  const [panneau, setPanneau] = useState<Panneau>(null);
  const [annonce, setAnnonce] = useState<string | null>(null);
  const refAnnonce = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (annonce) refAnnonce.current?.focus();
  }, [annonce]);

  const reussi = (message: string) => {
    setPanneau(null);
    setAnnonce(message);
  };

  return (
    <div className="mp-pile">
      {annonce ? (
        <Alerte ref={refAnnonce} tonalite="succes" annonce="status">
          <p>{annonce}</p>
        </Alerte>
      ) : null}
      <ol className="mp-kpi-historique">
        {lignes.map((m) => {
          const etat = etatLigneMesure(m, lignes, langue);
          const dateMesure = formaterDate(m.date_mesure, "UTC", langue);
          const rang = rangCorrection(m, lignes);
          const corrigeable = saisir && m.active;
          const annulable = corrigeable && (m.origine === "cabinet" || annulerPortail);
          const ouvert = panneau?.id === m.id ? panneau.action : null;
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
                <span className="mp-badges">
                  <BadgeStatut tonalite={etat.tonalite}>{etat.libelle}</BadgeStatut>
                  <BadgeStatut tonalite="neutre" sansIcone>
                    {libelleOrigine(m.origine, langue)}
                  </BadgeStatut>
                </span>
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
                    {formaterDateHeure(m.saisie_le, undefined, langue)} {t("par", "by")}{" "}
                    {m.saisie_par.nom ?? t("un utilisateur", "a user")}
                  </dd>
                </div>
              </dl>
              {corrigeable ? (
                <div className="mp-barre-actions">
                  <Bouton
                    variante="secondaire"
                    icone="crayon"
                    aria-expanded={ouvert === "corriger"}
                    aria-label={t(
                      `Corriger la mesure du ${dateMesure}`,
                      `Correct the measurement of ${dateMesure}`,
                    )}
                    onClick={() =>
                      setPanneau(ouvert === "corriger" ? null : { id: m.id, action: "corriger" })
                    }
                  >
                    {t("Corriger", "Correct")}
                  </Bouton>
                  {annulable ? (
                    <Bouton
                      variante="discret"
                      icone="fermer"
                      aria-expanded={ouvert === "annuler"}
                      aria-label={t(
                        `Annuler la mesure du ${dateMesure}`,
                        `Cancel the measurement of ${dateMesure}`,
                      )}
                      onClick={() =>
                        setPanneau(ouvert === "annuler" ? null : { id: m.id, action: "annuler" })
                      }
                    >
                      {t("Annuler la mesure", "Cancel the measurement")}
                    </Bouton>
                  ) : (
                    <p className="mp-texte-doux mp-texte-petit">
                      {t(
                        "Saisie depuis le portail : seul un responsable de la mission peut l'annuler.",
                        "Entered from the portal: only an engagement lead can cancel it.",
                      )}
                    </p>
                  )}
                </div>
              ) : null}
              {ouvert === "corriger" ? (
                <FormulaireCorrection
                  mesure={m}
                  kpi={kpi}
                  aujourdhui={aujourdhui}
                  rang={rang}
                  onSucces={() =>
                    reussi(
                      t(
                        `Correction enregistrée pour le ${dateMesure} : l'ancienne valeur reste dans l'historique.`,
                        `Correction saved for ${dateMesure}: the old value stays in the history.`,
                      ),
                    )
                  }
                />
              ) : null}
              {ouvert === "annuler" ? (
                <FormulaireAnnulation
                  mesure={m}
                  onSucces={() =>
                    reussi(
                      t(
                        `Mesure du ${dateMesure} annulée : la date peut être saisie à nouveau.`,
                        `Measurement of ${dateMesure} cancelled: the date can be entered again.`,
                      ),
                    )
                  }
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
  rang,
  onSucces,
}: {
  mesure: MesureKpi;
  kpi: DefinitionMesure;
  aujourdhui: string;
  rang: number;
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
      (charge) => api.post<MesureKpi>(cheminCorrectionMesure(mesure.id), charge),
      { messageSpecifique: (err) => messageKpi(err, langue), apres: onSucces },
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
          `La correction crée une nouvelle ligne ; l'ancienne reste visible. ${MAX_CORRECTIONS_PAR_MESURE} corrections successives au plus par mesure${rang > 0 ? ` (celle-ci en compte déjà au moins ${rang})` : ""} : au-delà, annulez la mesure puis saisissez-la à nouveau.`,
          `The correction creates a new line; the old one stays visible. At most ${MAX_CORRECTIONS_PAR_MESURE} successive corrections per measurement${rang > 0 ? ` (this one already has at least ${rang})` : ""}: beyond that, cancel the measurement then enter it again.`,
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
          libelle={`${t("Valeur corrigée", "Corrected value")} (${kpi.unite})`}
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
        libelle={t("Commentaire", "Comment")}
        rows={2}
        maxLength={COMMENTAIRE_MAX}
        value={s.commentaire}
        onChange={maj("commentaire")}
        erreur={f.erreurs.commentaire}
      />
      <Champ
        libelle={t("Justificatif", "Supporting document")}
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

function FormulaireAnnulation({ mesure, onSucces }: { mesure: MesureKpi; onSucces: () => void }) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"motif">();
  const [motif, setMotif] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerAnnulation(motif, langue),
      (charge) => api.post<MesureKpi>(cheminAnnulationMesure(mesure.id), charge),
      {
        messageSpecifique: (err) => messageAnnulationKpi(err, mesure.origine, langue),
        apres: onSucces,
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t(
        `Annuler la mesure du ${formaterDate(mesure.date_mesure, "UTC", langue)}`,
        `Cancel the measurement of ${formaterDate(mesure.date_mesure, "UTC", langue)}`,
      )}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur={t("Annulation refusée", "Cancellation refused")}
      />
      <p className="mp-texte-doux mp-texte-petit">
        {t(
          "L'annulation ajoute une ligne sans valeur ; la mesure annulée reste visible et la date peut ensuite être saisie à nouveau.",
          "The cancellation adds a line without a value; the cancelled measurement stays visible and the date can then be entered again.",
        )}
      </p>
      <ZoneTexte
        libelle={t("Motif de l'annulation", "Reason for the cancellation")}
        required
        rows={2}
        maxLength={MOTIF_MAX}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
        aide={t(
          "Obligatoire : il reste dans l'historique (ex. « Saisie en double »).",
          'Required: it stays in the history (e.g. "Duplicate entry").',
        )}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="danger"
          chargement={f.enCours}
          texteChargement={t("Annulation…", "Cancelling…")}
        >
          {t("Confirmer l'annulation", "Confirm the cancellation")}
        </Bouton>
      </div>
    </form>
  );
}
