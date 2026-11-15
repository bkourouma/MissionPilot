"use client";

import { useRef, useState, type FormEvent } from "react";
import { FAMILLES_RISQUE_DD, NIVEAUX_RISQUE_DD, type NiveauRisqueDd } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminConstatSignal,
  cheminRisques,
  cheminVersionsRisque,
  libellesDd,
  messageDd,
  optionsDe,
  type SignalDossier,
} from "../../lib/due-diligence";
import {
  ecartAvecSignal,
  MOTIF_ECART_MAX,
  MOTIF_MAX,
  saisieRisqueVide,
  TITRE_MAX,
  validerConstat,
  validerCorrectionRisque,
  validerRetrait,
  validerRisque,
  ENONCE_MAX,
  type ChampCorrectionRisque,
  type ChampRisque,
  type SaisieCorrectionRisque,
  type SaisieRisque,
} from "../../lib/due-diligence-saisie";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useRafraichir } from "../formulaires/useRafraichir";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { BadgeNiveauRisque } from "./BadgesDd";
import { ChampsAffirmation } from "./ChampsAffirmation";

export interface OptionEtape {
  valeur: string;
  libelle: string;
}

// --- Formulaire d'un risque -------------------------------------------------------------------

interface FormulaireRisqueProps {
  dossierId: string;
  etapes: OptionEtape[];
  peutSigner: boolean;
  /** Signal d'origine : préremplit famille, niveau et titre ; l'écart de niveau se justifie. */
  signal: SignalDossier | null;
  onCree: () => void;
}

function FormulaireRisque({
  dossierId,
  etapes,
  peutSigner,
  signal,
  onCree,
}: FormulaireRisqueProps) {
  const t = useT();
  const langue = useLangue();
  const L = libellesDd(langue);
  const optionsFamille = optionsDe(FAMILLES_RISQUE_DD, L.FAMILLE);
  const optionsNiveau = optionsDe(NIVEAUX_RISQUE_DD, L.NIVEAU_RISQUE);
  const f = useFormulaire<ChampRisque>();
  const [s, setS] = useState<SaisieRisque>(
    signal
      ? {
          ...saisieRisqueVide(),
          famille: signal.famille,
          niveau: signal.gravite_indicative,
          libelle: signal.libelle,
          signal_id: signal.signal_id,
        }
      : saisieRisqueVide(),
  );
  const maj = (p: Partial<SaisieRisque>) => setS((x) => ({ ...x, ...p }));
  const gravite = signal?.gravite_indicative ?? null;
  const ecart = ecartAvecSignal(s.niveau, gravite);

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerRisque(s, gravite, langue),
      async (charge) => {
        const cree = await api.post<{ id: string }>(cheminRisques(dossierId), charge);
        // Un risque créé depuis un signal l'inscrit comme « constaté » et les relie.
        if (signal) {
          try {
            await api.post(cheminConstatSignal(dossierId, signal.signal_id), {
              etat: "constate",
              commentaire: null,
              risque_id: cree.id,
            });
          } catch {
            // Le risque existe : le constat se saisit depuis le panneau des signaux.
          }
        }
        return cree;
      },
      {
        succes: t(
          "Risque ajouté. Reliez-lui des sources depuis la fiche de l'assertion.",
          "Risk added. Link sources to it from the statement page.",
        ),
        messageSpecifique: (err) => messageDd(err, langue),
        apres: () => {
          setS(saisieRisqueVide());
          onCree();
        },
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={soumettre}
      aria-label={t("Nouveau risque", "New risk")}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Risque refusé", "Risk refused")}
      />
      {signal ? (
        <Alerte
          tonalite="info"
          titre={t("Risque créé depuis un signal d'alerte", "Risk created from a warning signal")}
          annonce="aucune"
        >
          <p>
            {t(
              `« ${signal.libelle} » : gravité indicative ${L.NIVEAU_RISQUE[signal.gravite_indicative].toLowerCase()}.`,
              `“${signal.libelle}”: indicative severity ${L.NIVEAU_RISQUE[signal.gravite_indicative].toLowerCase()}.`,
            )}
          </p>
        </Alerte>
      ) : null}
      <div className="mp-grille-champs">
        <Select
          libelle={t("Famille", "Family")}
          required
          invite={t("Choisir…", "Choose…")}
          options={optionsFamille}
          value={s.famille}
          onChange={(e) => maj({ famille: e.target.value })}
          erreur={f.erreurs.famille}
        />
        <Select
          libelle={t("Niveau", "Level")}
          required
          invite={t("Choisir…", "Choose…")}
          options={optionsNiveau}
          value={s.niveau}
          onChange={(e) => maj({ niveau: e.target.value })}
          erreur={f.erreurs.niveau}
        />
        <Select
          libelle={t("Étape de la chaîne", "Value chain step")}
          invite={t("Aucune étape précise", "No specific step")}
          options={etapes}
          value={s.etape_id}
          onChange={(e) => maj({ etape_id: e.target.value })}
          erreur={f.erreurs.etape_id}
        />
      </div>
      <Champ
        libelle={t("Intitulé du risque", "Risk title")}
        required
        maxLength={TITRE_MAX}
        value={s.libelle}
        onChange={(e) => maj({ libelle: e.target.value })}
        erreur={f.erreurs.libelle}
      />
      {ecart ? (
        <ZoneTexte
          libelle={t("Motif de l'écart", "Reason for the difference")}
          required
          rows={2}
          maxLength={MOTIF_ECART_MAX}
          value={s.motif_ecart}
          onChange={(e) => maj({ motif_ecart: e.target.value })}
          erreur={f.erreurs.motif_ecart}
          aide={t(
            "Le niveau choisi diffère de la gravité indicative du signal : l'écart est tracé dans les ajustements.",
            "The chosen level differs from the signal's indicative severity: the difference is traced in the adjustments.",
          )}
        />
      ) : null}
      <ChampsAffirmation
        valeur={s}
        onChange={maj}
        erreurs={f.erreurs}
        peutSigner={peutSigner}
        libelle={t("Justification du niveau", "Justification of the level")}
        aide={t(
          "Une affirmation vérifiable, qui devient une assertion du registre des preuves.",
          "A verifiable statement, which becomes a statement in the evidence register.",
        )}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Ajouter le risque", "Add the risk")}
        </Bouton>
      </div>
    </form>
  );
}

// --- Un signal et ses boutons de constat ------------------------------------------------------

function LigneSignal({
  signal,
  dossierId,
  peutEcrire,
  onCreerRisque,
}: {
  signal: SignalDossier;
  dossierId: string;
  peutEcrire: boolean;
  onCreerRisque: (s: SignalDossier) => void;
}) {
  const t = useT();
  const langue = useLangue();
  const L = libellesDd(langue);
  const { rafraichir, enAttente } = useRafraichir();
  const [ecarter, setEcarter] = useState(false);
  const [commentaire, setCommentaire] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function constater(etat: "constate" | "ecarte" | "a_verifier") {
    const v = validerConstat(etat, commentaire, signal.risque_id, langue);
    if (!v.ok) {
      setErreur(v.erreurs.commentaire ?? t("Constat invalide.", "Invalid finding."));
      return;
    }
    setErreur(null);
    setEnCours(true);
    try {
      await api.post(cheminConstatSignal(dossierId, signal.signal_id), v.charge);
      setEcarter(false);
      setCommentaire("");
      rafraichir();
    } catch (e) {
      setErreur(messageDd(e, langue));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <li className="mp-dd-element">
      <p className="mp-dd-element__titre">{signal.libelle}</p>
      <span className="mp-dd-meta">
        <BadgeNiveauRisque niveau={signal.gravite_indicative} />
        <BadgeStatut tonalite="neutre" sansIcone>
          {L.FAMILLE[signal.famille]}
        </BadgeStatut>
        <BadgeStatut tonalite={signal.etat_constat === "constate" ? "danger" : "neutre"}>
          {signal.etat_constat
            ? L.ETAT_CONSTAT[signal.etat_constat]
            : t("Pas encore examiné", "Not yet reviewed")}
        </BadgeStatut>
      </span>
      {signal.question ? (
        <p className="mp-dd-texte">
          <strong>{t("Question à poser : ", "Question to ask: ")}</strong>
          {signal.question}
        </p>
      ) : null}
      {signal.reference_publique ? (
        <p className="mp-texte-doux mp-texte-petit">{`${t("Référence publique", "Public reference")} : ${signal.reference_publique}`}</p>
      ) : null}
      {peutEcrire ? (
        <>
          {ecarter ? (
            <ZoneTexte
              libelle={t("Pourquoi écarter ce signal ?", "Why dismiss this signal?")}
              required
              rows={2}
              value={commentaire}
              onChange={(e) => setCommentaire(e.target.value)}
              erreur={erreur ?? undefined}
              aide={t(
                "Un signal écarté se justifie ; le commentaire est conservé.",
                "A dismissed signal must be justified; the comment is kept.",
              )}
            />
          ) : erreur ? (
            <Alerte tonalite="danger" annonce="alert">
              <p>{erreur}</p>
            </Alerte>
          ) : null}
          <div className="mp-barre-actions mp-barre-actions--compacte">
            <Bouton
              variante="secondaire"
              disabled={enCours || enAttente}
              onClick={() => void constater("constate")}
            >
              {t("Constaté", "Observed")}
            </Bouton>
            {ecarter ? (
              <>
                <Bouton
                  variante="secondaire"
                  disabled={enCours || enAttente}
                  onClick={() => void constater("ecarte")}
                >
                  {t("Confirmer : écarté", "Confirm: dismissed")}
                </Bouton>
                <Bouton variante="discret" onClick={() => setEcarter(false)}>
                  {t("Annuler", "Cancel")}
                </Bouton>
              </>
            ) : (
              <Bouton
                variante="secondaire"
                disabled={enCours || enAttente}
                onClick={() => setEcarter(true)}
              >
                {t("Écarté", "Dismissed")}
              </Bouton>
            )}
            <Bouton
              variante="secondaire"
              disabled={enCours || enAttente}
              onClick={() => void constater("a_verifier")}
            >
              {t("À vérifier", "To verify")}
            </Bouton>
            <Bouton
              variante="primaire"
              disabled={enCours || enAttente}
              onClick={() => onCreerRisque(signal)}
            >
              {t("Créer le risque", "Create the risk")}
            </Bouton>
          </div>
        </>
      ) : null}
    </li>
  );
}

// --- Espace : signaux applicables et formulaire -----------------------------------------------

export interface EspaceRisquesProps {
  dossierId: string;
  etapes: OptionEtape[];
  signaux: SignalDossier[];
  /** Message si les signaux applicables n'ont pas pu être chargés. */
  erreurSignaux: string | null;
  peutEcrire: boolean;
  peutSigner: boolean;
}

/**
 * Panneau « Signaux d'alerte applicables » (DD-11) et formulaire de risque (DD-06) : « Créer le
 * risque » préremplit le formulaire depuis le signal et, une fois le risque créé, inscrit le
 * signal comme constaté. Les signaux applicables sont choisis par le moteur de l'API.
 */
export function EspaceRisques({
  dossierId,
  etapes,
  signaux,
  erreurSignaux,
  peutEcrire,
  peutSigner,
}: EspaceRisquesProps) {
  const t = useT();
  const { rafraichir } = useRafraichir();
  const [signal, setSignal] = useState<SignalDossier | null>(null);
  const ancre = useRef<HTMLDivElement>(null);

  function creerDepuis(s: SignalDossier) {
    setSignal(s);
    // Laisse le formulaire se réinitialiser puis y amène le focus.
    setTimeout(() => {
      ancre.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      ancre.current?.focus();
    }, 0);
  }

  return (
    <>
      <section className="mp-dd-pile" aria-labelledby="titre-signaux">
        <h2 id="titre-signaux" className="mp-section__titre">
          {t("Signaux d'alerte applicables", "Applicable warning signals")}
        </h2>
        {erreurSignaux ? (
          <Alerte
            tonalite="attention"
            titre={t("Signaux indisponibles", "Signals unavailable")}
            annonce="aucune"
          >
            <p>{erreurSignaux}</p>
          </Alerte>
        ) : signaux.length === 0 ? (
          <p className="mp-texte-doux">
            {t(
              "Aucun signal de la bibliothèque ne s'applique à ce secteur et à ce pays. La bibliothèque est maintenue par les experts du cabinet (Paramètres, Due diligence).",
              "No signal in the library applies to this sector and country. The library is maintained by the firm's experts (Settings, Due diligence).",
            )}
          </p>
        ) : (
          <ul
            className="mp-dd-liste"
            aria-label={t(
              "Signaux d'alerte applicables à ce dossier",
              "Warning signals applicable to this file",
            )}
          >
            {signaux.map((s) => (
              <LigneSignal
                key={s.signal_id}
                signal={s}
                dossierId={dossierId}
                peutEcrire={peutEcrire}
                onCreerRisque={creerDepuis}
              />
            ))}
          </ul>
        )}
      </section>

      {peutEcrire ? (
        <section className="mp-dd-pile" aria-labelledby="titre-nouveau-risque">
          <div ref={ancre} tabIndex={-1} id="nouveau-risque">
            <h2 id="titre-nouveau-risque" className="mp-section__titre">
              {t("Nouveau risque", "New risk")}
            </h2>
          </div>
          <FormulaireRisque
            key={signal?.signal_id ?? "libre"}
            dossierId={dossierId}
            etapes={etapes}
            peutSigner={peutSigner}
            signal={signal}
            onCree={() => {
              setSignal(null);
              rafraichir();
            }}
          />
        </section>
      ) : null}
    </>
  );
}

// --- Correction d'un risque -------------------------------------------------------------------

export interface CorrectionRisqueProps {
  risque: {
    id: string;
    version: number;
    libelle: string;
    niveau: NiveauRisqueDd;
    enonce: string;
    etape_id: string | null;
    signal_id: string | null;
  };
  etapes: OptionEtape[];
  /** Gravité indicative du signal d'origine, si le risque en vient. */
  graviteSignal: NiveauRisqueDd | null;
}

/** Correction motivée d'un risque (nouvelle version) ou retrait. */
export function CorrectionRisque({ risque, etapes, graviteSignal }: CorrectionRisqueProps) {
  const t = useT();
  const langue = useLangue();
  const optionsNiveau = optionsDe(NIVEAUX_RISQUE_DD, libellesDd(langue).NIVEAU_RISQUE);
  const f = useFormulaire<ChampCorrectionRisque>();
  const [s, setS] = useState<SaisieCorrectionRisque>({
    niveau: risque.niveau,
    libelle: risque.libelle,
    enonce: risque.enonce,
    etape_id: risque.etape_id ?? "",
    motif_ecart: "",
    motif: "",
  });
  const maj = (p: Partial<SaisieCorrectionRisque>) => setS((x) => ({ ...x, ...p }));
  const ecart = s.niveau !== risque.niveau && ecartAvecSignal(s.niveau, graviteSignal);

  async function corriger(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      validerCorrectionRisque(s, risque, graviteSignal, langue),
      (charge) =>
        api.post<{ version: number }>(cheminVersionsRisque(risque.id), {
          ...charge,
          version_courante: risque.version,
        }),
      {
        succes: t(
          "Nouvelle version enregistrée ; l'ancienne reste dans l'historique.",
          "New version saved; the previous one stays in the history.",
        ),
        messageSpecifique: (err) => messageDd(err, langue),
        apres: () => maj({ motif: "", motif_ecart: "" }),
      },
    );
  }

  async function retirer() {
    await f.envoyer(
      validerRetrait(s.motif, true, langue),
      (charge) =>
        api.post<{ version: number }>(cheminVersionsRisque(risque.id), {
          ...charge,
          version_courante: risque.version,
        }),
      {
        succes: t("Risque retiré.", "Risk removed."),
        messageSpecifique: (err) => messageDd(err, langue),
      },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={corriger}
      aria-label={t(`Corriger le risque ${risque.libelle}`, `Edit the risk ${risque.libelle}`)}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Correction refusée", "Correction refused")}
      />
      <div className="mp-grille-champs">
        <Select
          libelle={t("Niveau", "Level")}
          required
          options={optionsNiveau}
          value={s.niveau}
          onChange={(e) => maj({ niveau: e.target.value })}
          erreur={f.erreurs.niveau}
        />
        <Select
          libelle={t("Étape de la chaîne", "Value chain step")}
          invite={t("Aucune étape précise", "No specific step")}
          options={etapes}
          value={s.etape_id}
          onChange={(e) => maj({ etape_id: e.target.value })}
          erreur={f.erreurs.etape_id}
        />
      </div>
      <Champ
        libelle={t("Intitulé du risque", "Risk title")}
        required
        maxLength={TITRE_MAX}
        value={s.libelle}
        onChange={(e) => maj({ libelle: e.target.value })}
        erreur={f.erreurs.libelle}
      />
      <ZoneTexte
        libelle={t("Justification du niveau", "Justification of the level")}
        required
        rows={3}
        maxLength={ENONCE_MAX}
        value={s.enonce}
        onChange={(e) => maj({ enonce: e.target.value })}
        erreur={f.erreurs.enonce}
      />
      {ecart ? (
        <ZoneTexte
          libelle={t("Motif de l'écart", "Reason for the difference")}
          required
          rows={2}
          maxLength={MOTIF_ECART_MAX}
          value={s.motif_ecart}
          onChange={(e) => maj({ motif_ecart: e.target.value })}
          erreur={f.erreurs.motif_ecart}
          aide={t(
            "Le niveau diffère de la gravité indicative du signal d'origine : l'écart est tracé.",
            "The level differs from the indicative severity of the original signal: the difference is traced.",
          )}
        />
      ) : null}
      <ZoneTexte
        libelle={t("Motif", "Reason")}
        required
        rows={2}
        maxLength={MOTIF_MAX}
        value={s.motif}
        onChange={(e) => maj({ motif: e.target.value })}
        erreur={f.erreurs.motif}
        aide={t(
          "Conservé dans l'historique. Obligatoire pour corriger comme pour retirer le risque.",
          "Kept in the history. Required to edit as well as to remove the risk.",
        )}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer la correction", "Save the correction")}
        </Bouton>
        <Bouton variante="danger" onClick={() => void retirer()} disabled={f.enCours}>
          {t("Retirer ce risque", "Remove this risk")}
        </Bouton>
      </div>
    </form>
  );
}
