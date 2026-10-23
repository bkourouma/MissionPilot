"use client";

import { useRef, useState, type FormEvent } from "react";
import { FAMILLES_RISQUE_DD, NIVEAUX_RISQUE_DD, type NiveauRisqueDd } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  cheminConstatSignal,
  cheminRisques,
  cheminVersionsRisque,
  ETAT_CONSTAT_SIGNAL_LIBELLES,
  FAMILLE_RISQUE_DD_LIBELLES,
  messageDd,
  NIVEAU_RISQUE_DD_LIBELLES,
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
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { ZoneTexte } from "../ui/ZoneTexte";
import { BadgeNiveauRisque } from "./BadgesDd";
import { ChampsAffirmation } from "./ChampsAffirmation";

const OPTIONS_FAMILLE = optionsDe(FAMILLES_RISQUE_DD, FAMILLE_RISQUE_DD_LIBELLES);
const OPTIONS_NIVEAU = optionsDe(NIVEAUX_RISQUE_DD, NIVEAU_RISQUE_DD_LIBELLES);

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
      validerRisque(s, gravite),
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
        succes: "Risque ajouté. Reliez-lui des sources depuis la fiche de l'assertion.",
        messageSpecifique: messageDd,
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
      aria-label="Nouveau risque"
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Risque refusé"
      />
      {signal ? (
        <Alerte tonalite="info" titre="Risque créé depuis un signal d'alerte" annonce="aucune">
          <p>
            {`« ${signal.libelle} » : gravité indicative ${NIVEAU_RISQUE_DD_LIBELLES[signal.gravite_indicative].toLowerCase()}.`}
          </p>
        </Alerte>
      ) : null}
      <div className="mp-grille-champs">
        <Select
          libelle="Famille"
          required
          invite="Choisir…"
          options={OPTIONS_FAMILLE}
          value={s.famille}
          onChange={(e) => maj({ famille: e.target.value })}
          erreur={f.erreurs.famille}
        />
        <Select
          libelle="Niveau"
          required
          invite="Choisir…"
          options={OPTIONS_NIVEAU}
          value={s.niveau}
          onChange={(e) => maj({ niveau: e.target.value })}
          erreur={f.erreurs.niveau}
        />
        <Select
          libelle="Étape de la chaîne"
          invite="Aucune étape précise"
          options={etapes}
          value={s.etape_id}
          onChange={(e) => maj({ etape_id: e.target.value })}
          erreur={f.erreurs.etape_id}
        />
      </div>
      <Champ
        libelle="Intitulé du risque"
        required
        maxLength={TITRE_MAX}
        value={s.libelle}
        onChange={(e) => maj({ libelle: e.target.value })}
        erreur={f.erreurs.libelle}
      />
      {ecart ? (
        <ZoneTexte
          libelle="Motif de l'écart"
          required
          rows={2}
          maxLength={MOTIF_ECART_MAX}
          value={s.motif_ecart}
          onChange={(e) => maj({ motif_ecart: e.target.value })}
          erreur={f.erreurs.motif_ecart}
          aide="Le niveau choisi diffère de la gravité indicative du signal : l'écart est tracé dans les ajustements."
        />
      ) : null}
      <ChampsAffirmation
        valeur={s}
        onChange={maj}
        erreurs={f.erreurs}
        peutSigner={peutSigner}
        libelle="Justification du niveau"
        aide="Une affirmation vérifiable, qui devient une assertion du registre des preuves."
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Ajouter le risque
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
  const { rafraichir, enAttente } = useRafraichir();
  const [ecarter, setEcarter] = useState(false);
  const [commentaire, setCommentaire] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function constater(etat: "constate" | "ecarte" | "a_verifier") {
    const v = validerConstat(etat, commentaire, signal.risque_id);
    if (!v.ok) {
      setErreur(v.erreurs.commentaire ?? "Constat invalide.");
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
      setErreur(messageDd(e));
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
          {FAMILLE_RISQUE_DD_LIBELLES[signal.famille]}
        </BadgeStatut>
        <BadgeStatut tonalite={signal.etat_constat === "constate" ? "danger" : "neutre"}>
          {signal.etat_constat
            ? ETAT_CONSTAT_SIGNAL_LIBELLES[signal.etat_constat]
            : "Pas encore examiné"}
        </BadgeStatut>
      </span>
      {signal.question ? (
        <p className="mp-dd-texte">
          <strong>Question à poser : </strong>
          {signal.question}
        </p>
      ) : null}
      {signal.reference_publique ? (
        <p className="mp-texte-doux mp-texte-petit">{`Référence publique : ${signal.reference_publique}`}</p>
      ) : null}
      {peutEcrire ? (
        <>
          {ecarter ? (
            <ZoneTexte
              libelle="Pourquoi écarter ce signal ?"
              required
              rows={2}
              value={commentaire}
              onChange={(e) => setCommentaire(e.target.value)}
              erreur={erreur ?? undefined}
              aide="Un signal écarté se justifie ; le commentaire est conservé."
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
              Constaté
            </Bouton>
            {ecarter ? (
              <>
                <Bouton
                  variante="secondaire"
                  disabled={enCours || enAttente}
                  onClick={() => void constater("ecarte")}
                >
                  Confirmer : écarté
                </Bouton>
                <Bouton variante="discret" onClick={() => setEcarter(false)}>
                  Annuler
                </Bouton>
              </>
            ) : (
              <Bouton
                variante="secondaire"
                disabled={enCours || enAttente}
                onClick={() => setEcarter(true)}
              >
                Écarté
              </Bouton>
            )}
            <Bouton
              variante="secondaire"
              disabled={enCours || enAttente}
              onClick={() => void constater("a_verifier")}
            >
              À vérifier
            </Bouton>
            <Bouton
              variante="primaire"
              disabled={enCours || enAttente}
              onClick={() => onCreerRisque(signal)}
            >
              Créer le risque
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
          Signaux d&apos;alerte applicables
        </h2>
        {erreurSignaux ? (
          <Alerte tonalite="attention" titre="Signaux indisponibles" annonce="aucune">
            <p>{erreurSignaux}</p>
          </Alerte>
        ) : signaux.length === 0 ? (
          <p className="mp-texte-doux">
            Aucun signal de la bibliothèque ne s&apos;applique à ce secteur et à ce pays. La
            bibliothèque est maintenue par les experts du cabinet (Paramètres, Due diligence).
          </p>
        ) : (
          <ul className="mp-dd-liste" aria-label="Signaux d'alerte applicables à ce dossier">
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
              Nouveau risque
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
      validerCorrectionRisque(s, risque, graviteSignal),
      (charge) =>
        api.post<{ version: number }>(cheminVersionsRisque(risque.id), {
          ...charge,
          version_courante: risque.version,
        }),
      {
        succes: "Nouvelle version enregistrée ; l'ancienne reste dans l'historique.",
        messageSpecifique: messageDd,
        apres: () => maj({ motif: "", motif_ecart: "" }),
      },
    );
  }

  async function retirer() {
    await f.envoyer(
      validerRetrait(s.motif, true),
      (charge) =>
        api.post<{ version: number }>(cheminVersionsRisque(risque.id), {
          ...charge,
          version_courante: risque.version,
        }),
      { succes: "Risque retiré.", messageSpecifique: messageDd },
    );
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={corriger}
      aria-label={`Corriger le risque ${risque.libelle}`}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Correction refusée"
      />
      <div className="mp-grille-champs">
        <Select
          libelle="Niveau"
          required
          options={OPTIONS_NIVEAU}
          value={s.niveau}
          onChange={(e) => maj({ niveau: e.target.value })}
          erreur={f.erreurs.niveau}
        />
        <Select
          libelle="Étape de la chaîne"
          invite="Aucune étape précise"
          options={etapes}
          value={s.etape_id}
          onChange={(e) => maj({ etape_id: e.target.value })}
          erreur={f.erreurs.etape_id}
        />
      </div>
      <Champ
        libelle="Intitulé du risque"
        required
        maxLength={TITRE_MAX}
        value={s.libelle}
        onChange={(e) => maj({ libelle: e.target.value })}
        erreur={f.erreurs.libelle}
      />
      <ZoneTexte
        libelle="Justification du niveau"
        required
        rows={3}
        maxLength={ENONCE_MAX}
        value={s.enonce}
        onChange={(e) => maj({ enonce: e.target.value })}
        erreur={f.erreurs.enonce}
      />
      {ecart ? (
        <ZoneTexte
          libelle="Motif de l'écart"
          required
          rows={2}
          maxLength={MOTIF_ECART_MAX}
          value={s.motif_ecart}
          onChange={(e) => maj({ motif_ecart: e.target.value })}
          erreur={f.erreurs.motif_ecart}
          aide="Le niveau diffère de la gravité indicative du signal d'origine : l'écart est tracé."
        />
      ) : null}
      <ZoneTexte
        libelle="Motif"
        required
        rows={2}
        maxLength={MOTIF_MAX}
        value={s.motif}
        onChange={(e) => maj({ motif: e.target.value })}
        erreur={f.erreurs.motif}
        aide="Conservé dans l'historique. Obligatoire pour corriger comme pour retirer le risque."
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer la correction
        </Bouton>
        <Bouton variante="danger" onClick={() => void retirer()} disabled={f.enCours}>
          Retirer ce risque
        </Bouton>
      </div>
    </form>
  );
}
