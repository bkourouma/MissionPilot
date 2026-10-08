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
  ORIGINE_LIBELLES,
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
          const etat = etatLigneMesure(m, lignes);
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
                  {formaterDate(m.date_mesure)}
                  <span className="mp-texte-doux"> · {libellePeriode(m.periode)}</span>
                </p>
                <span className="mp-badges">
                  <BadgeStatut tonalite={etat.tonalite}>{etat.libelle}</BadgeStatut>
                  <BadgeStatut tonalite="neutre" sansIcone>
                    {ORIGINE_LIBELLES[m.origine]}
                  </BadgeStatut>
                </span>
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
                    {formaterDateHeure(m.saisie_le)} par {m.saisie_par.nom ?? "un utilisateur"}
                  </dd>
                </div>
              </dl>
              {corrigeable ? (
                <div className="mp-barre-actions">
                  <Bouton
                    variante="secondaire"
                    icone="crayon"
                    aria-expanded={ouvert === "corriger"}
                    aria-label={`Corriger la mesure du ${formaterDate(m.date_mesure)}`}
                    onClick={() =>
                      setPanneau(ouvert === "corriger" ? null : { id: m.id, action: "corriger" })
                    }
                  >
                    Corriger
                  </Bouton>
                  {annulable ? (
                    <Bouton
                      variante="discret"
                      icone="fermer"
                      aria-expanded={ouvert === "annuler"}
                      aria-label={`Annuler la mesure du ${formaterDate(m.date_mesure)}`}
                      onClick={() =>
                        setPanneau(ouvert === "annuler" ? null : { id: m.id, action: "annuler" })
                      }
                    >
                      Annuler la mesure
                    </Bouton>
                  ) : (
                    <p className="mp-texte-doux mp-texte-petit">
                      Saisie depuis le portail : seul un responsable de la mission peut
                      l&apos;annuler.
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
                      `Correction enregistrée pour le ${formaterDate(m.date_mesure)} : l'ancienne valeur reste dans l'historique.`,
                    )
                  }
                />
              ) : null}
              {ouvert === "annuler" ? (
                <FormulaireAnnulation
                  mesure={m}
                  onSucces={() =>
                    reussi(
                      `Mesure du ${formaterDate(m.date_mesure)} annulée : la date peut être saisie à nouveau.`,
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
      (charge) => api.post<MesureKpi>(cheminCorrectionMesure(mesure.id), charge),
      { messageSpecifique: messageKpi, apres: onSucces },
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
        {`La correction crée une nouvelle ligne ; l'ancienne reste visible. ${MAX_CORRECTIONS_PAR_MESURE} corrections successives au plus par mesure${rang > 0 ? ` (celle-ci en compte déjà au moins ${rang})` : ""} : au-delà, annulez la mesure puis saisissez-la à nouveau.`}
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
          libelle={`Valeur corrigée (${kpi.unite})`}
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
        libelle="Commentaire"
        rows={2}
        maxLength={COMMENTAIRE_MAX}
        value={s.commentaire}
        onChange={maj("commentaire")}
        erreur={f.erreurs.commentaire}
      />
      <Champ
        libelle="Justificatif"
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

function FormulaireAnnulation({ mesure, onSucces }: { mesure: MesureKpi; onSucces: () => void }) {
  const f = useFormulaire<"motif">();
  const [motif, setMotif] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerAnnulation(motif),
      (charge) => api.post<MesureKpi>(cheminAnnulationMesure(mesure.id), charge),
      { messageSpecifique: (err) => messageAnnulationKpi(err, mesure.origine), apres: onSucces },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire mp-sous-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={`Annuler la mesure du ${formaterDate(mesure.date_mesure)}`}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Annulation refusée"
      />
      <p className="mp-texte-doux mp-texte-petit">
        L&apos;annulation ajoute une ligne sans valeur ; la mesure annulée reste visible et la date
        peut ensuite être saisie à nouveau.
      </p>
      <ZoneTexte
        libelle="Motif de l'annulation"
        required
        rows={2}
        maxLength={MOTIF_MAX}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
        aide="Obligatoire : il reste dans l'historique (ex. « Saisie en double »)."
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="danger"
          chargement={f.enCours}
          texteChargement="Annulation…"
        >
          Confirmer l&apos;annulation
        </Bouton>
      </div>
    </form>
  );
}
