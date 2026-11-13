"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { creerTraduire, type Langue } from "@missionpilot/shared";
import { api, ErreurApi } from "../../lib/api";
import { formaterDateHeure, formaterNombre } from "../../lib/format";
import { contreAnalysePossible } from "../../lib/contradicteur";
import { messageErreurIa } from "../../lib/ia";
import { libelleTache } from "../../lib/ia-modeles";
import {
  actionsGeneration,
  AIDE_GABARIT,
  AIDE_GABARIT_EN,
  cheminGeneration,
  estEssai,
  lignesTracabilite,
  MESSAGE_ESSAI,
  MESSAGE_ESSAI_EN,
  MESSAGE_GABARIT,
  MESSAGE_GABARIT_EN,
  messageEchecGeneration,
  messageSuccesValidation,
  messageValide,
  presentationStatutContenu,
  presentationStatutGeneration,
  statutConnu,
  TYPE_SOURCE_IA_LIBELLES_EN,
  TYPE_SOURCE_LIBELLES,
  validerAcquittement,
  validerTexteModifie,
  type GenerationIa,
  type UtilisateurIa,
} from "../../lib/ia-contenu";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { ZoneTexte } from "../ui/ZoneTexte";
import {
  BadgeContenuIa,
  BadgeEssaiIa,
  BadgeGabaritIa,
  BadgeStatutGenerationIa,
} from "./BadgeContenuIa";
import { BandeauChiffresNonVerifies } from "./BandeauChiffresNonVerifies";
import { ContreAnalyse } from "./ContreAnalyse";
import { HistoriqueVersionsIa } from "./HistoriqueVersionsIa";
import { useSuiviGeneration } from "./useSuiviGeneration";
import "./ia.css";

export interface PanneauContenuIaProps {
  /** Détail de la génération (GET /api/ia/generations/:id, avec `texte` et `versions`). */
  generation: GenerationIa;
  /** Utilisateur courant : masque « Valider » à un contributeur (l'API décide de toute façon). */
  utilisateur?: UtilisateurIa;
  titre?: string;
  niveauTitre?: 2 | 3 | 4;
  /** Appelé à chaque nouvel état (suivi, modification, validation, annulation). */
  onChange?: (g: GenerationIa) => void;
  /** Propose « Demander une contre-analyse » sur un brouillon IA ou modifié (défaut : oui). */
  contreAnalyse?: boolean;
}

type Action = "modifier" | "valider" | "annuler";
type Message = { tonalite: "succes" | "danger"; texte: string };

/**
 * Cycle « brouillon IA → modifié → validé » d'un contenu généré (SOC-06) : suivi de la
 * génération en file, texte éditable (chaque enregistrement crée une version « Modifié »),
 * bandeau bloquant des chiffres non vérifiés, validation explicite en deux temps, historique
 * des versions et traçabilité. Monter avec `key={generation.id}`.
 */
export function PanneauContenuIa({
  generation,
  utilisateur,
  titre,
  niveauTitre = 3,
  onChange,
  contreAnalyse = true,
}: PanneauContenuIaProps) {
  const t = useT();
  const langue = useLangue();
  const suivi = useSuiviGeneration(generation, onChange);
  const g = suivi.generation;
  const statut = statutConnu(g.statut);
  // Refus APPROBATION_REQUISE déjà reçu (droits sur la mission) : « Valider » reste masqué.
  const [refusValidation, setRefusValidation] = useState<string | null>(null);
  const actions = actionsGeneration(g, utilisateur, refusValidation, langue);
  const idTitre = useId();
  const Titre = `h${niveauTitre}` as const;
  const [message, setMessage] = useState<Message | null>(null);
  const [enCours, setEnCours] = useState<Action | null>(null);
  const refAlerte = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (message?.tonalite === "danger") refAlerte.current?.focus();
  }, [message]);

  async function executer(
    action: Action,
    appel: () => Promise<GenerationIa>,
    succes: (g: GenerationIa) => string,
  ): Promise<boolean> {
    setEnCours(action);
    setMessage(null);
    try {
      const r = await appel();
      suivi.remplacer(r);
      setMessage({ tonalite: "succes", texte: succes(r) });
      return true;
    } catch (e) {
      setMessage({ tonalite: "danger", texte: messageErreurIa(e, langue) });
      if (action === "valider" && e instanceof ErreurApi && e.code === "APPROBATION_REQUISE") {
        setRefusValidation(messageErreurIa(e, langue));
      }
      // État changé ailleurs (validé par un autre, nombres recalculés) : relire.
      if (e instanceof ErreurApi && ["CONTENU_VALIDE", "CHIFFRES_NON_VERIFIES"].includes(e.code)) {
        await suivi.relire();
      }
      return false;
    } finally {
      setEnCours(null);
    }
  }

  const annuler = () =>
    executer(
      "annuler",
      () => api.post<GenerationIa>(`${cheminGeneration(g.id)}/annuler`),
      () => t("Génération annulée.", "Generation cancelled."),
    );

  return (
    <section className="mp-contenu-ia" aria-labelledby={idTitre}>
      <header className="mp-contenu-ia__entete">
        <Titre id={idTitre} className="mp-contenu-ia__titre">
          {titre ?? t("Contenu généré", "Generated content")}
        </Titre>
        <div className="mp-badges">
          <BadgeStatutGenerationIa statut={statut} />
          <BadgeContenuIa statut={g.statut_contenu} />
          {g.gabarit ? <BadgeGabaritIa /> : null}
          {estEssai(g) ? <BadgeEssaiIa /> : null}
        </div>
        <p className="mp-contenu-ia__meta">
          {t(
            `Prompt « ${g.prompt.nom} » (version ${g.prompt.version}) · ${libelleTache(g.tache)} · demandé par ${g.demandeur.nom} le ${formaterDateHeure(g.cree_le)}`,
            `Prompt "${g.prompt.nom}" (version ${g.prompt.version}) · ${libelleTache(g.tache, "en")} · requested by ${g.demandeur.nom} on ${formaterDateHeure(g.cree_le, undefined, "en")}`,
          )}
        </p>
      </header>
      <p className="mp-visuellement-cache" role="status">
        {annonceStatut(g, langue)}
      </p>
      {message ? (
        <Alerte
          ref={refAlerte}
          tonalite={message.tonalite}
          titre={
            message.tonalite === "danger"
              ? t("Action impossible", "Action not possible")
              : undefined
          }
        >
          <p>{message.texte}</p>
        </Alerte>
      ) : null}
      {suivi.erreur ? (
        <Alerte tonalite="attention" annonce="status">
          <p>{suivi.erreur}</p>
        </Alerte>
      ) : null}
      {g.gabarit ? (
        <Alerte tonalite="info" annonce="aucune" titre={t(MESSAGE_GABARIT, MESSAGE_GABARIT_EN)}>
          <p>{t(AIDE_GABARIT, AIDE_GABARIT_EN)}</p>
        </Alerte>
      ) : null}
      <ExecutionIa
        g={g}
        annuler={actions.annuler ? annuler : null}
        annulation={enCours === "annuler"}
        arrete={suivi.arrete}
        relire={suivi.relire}
      />
      {statut === "terminee" && g.version !== null && g.statut_contenu !== null ? (
        <CircuitHumainIa g={g} actions={actions} enCours={enCours} executer={executer} />
      ) : null}
      {contreAnalyse && contreAnalysePossible(g, utilisateur) ? (
        <ContreAnalyse key={g.id} generationId={g.id} />
      ) : null}
      <TracabiliteIa g={g} />
      {g.versions && g.versions.length > 0 ? <HistoriqueVersionsIa versions={g.versions} /> : null}
    </section>
  );
}

/** Annonce polie d'un changement d'état (la région n'est lue qu'à ses changements). */
function annonceStatut(g: GenerationIa, langue: Langue): string {
  const t = creerTraduire(langue);
  const parties = [presentationStatutGeneration(statutConnu(g.statut), langue).libelle];
  if (g.statut_contenu) {
    parties.push(
      t(
        `contenu : ${presentationStatutContenu(g.statut_contenu, langue).libelle}`,
        `content: ${presentationStatutContenu(g.statut_contenu, langue).libelle}`,
      ),
    );
  }
  if (g.gabarit)
    parties.push(t("produit par un gabarit, sans IA", "produced by a template, no AI"));
  if (g.chiffres_non_verifies && g.statut_contenu !== "valide") {
    parties.push(
      t(
        "des chiffres non vérifiés sont à attester avant validation",
        "unverified figures must be attested before approval",
      ),
    );
  }
  return parties.join(" ; ");
}

/** File d'attente, progression, échec ou annulation. */
function ExecutionIa({
  g,
  annuler,
  annulation,
  arrete,
  relire,
}: {
  g: GenerationIa;
  annuler: (() => Promise<boolean>) | null;
  annulation: boolean;
  arrete: boolean;
  relire: () => Promise<void>;
}) {
  const t = useT();
  const langue = useLangue();
  const statut = statutConnu(g.statut);
  if (statut === "echec") {
    return (
      <Alerte
        tonalite="danger"
        annonce="aucune"
        titre={t("La génération a échoué", "The generation failed")}
      >
        <p>{messageEchecGeneration(g.erreur, langue)}</p>
      </Alerte>
    );
  }
  if (statut === "annulee") {
    return (
      <Alerte
        tonalite="info"
        annonce="aucune"
        titre={t("Génération annulée", "Generation cancelled")}
      >
        <p>{t("Aucun contenu n'a été produit.", "No content was produced.")}</p>
      </Alerte>
    );
  }
  if (statut !== "en_file" && statut !== "en_cours") return null;
  const enFile = statut === "en_file";
  return (
    <div className="mp-suivi-ia">
      <div className="mp-suivi-ia__ligne">
        <progress
          max={100}
          value={enFile ? undefined : g.progression}
          aria-label={t("Progression de la génération", "Generation progress")}
        />
        <span>
          {enFile
            ? t("En attente de traitement…", "Waiting to be processed…")
            : `${formaterNombre(g.progression, 0, langue)} %`}
        </span>
      </div>
      <p className="mp-texte-petit">
        {t(
          "Cet écran se met à jour tout seul ; vous pouvez le quitter et revenir plus tard.",
          "This screen updates by itself; you can leave it and come back later.",
        )}
      </p>
      {arrete ? (
        <div className="mp-barre-actions">
          <span className="mp-texte-petit">
            {t("Le suivi automatique s'est arrêté.", "Automatic tracking has stopped.")}
          </span>
          <Bouton variante="secondaire" onClick={() => void relire()}>
            {t("Actualiser", "Refresh")}
          </Bouton>
        </div>
      ) : null}
      {annuler ? (
        <div>
          <Bouton
            variante="secondaire"
            icone="fermer"
            chargement={annulation}
            texteChargement={t("Annulation…", "Cancelling…")}
            onClick={() => void annuler()}
          >
            {t("Annuler la génération", "Cancel the generation")}
          </Bouton>
        </div>
      ) : null}
    </div>
  );
}

/** Relecture : texte, modification, chiffres à attester et validation en deux temps. */
function CircuitHumainIa({
  g,
  actions,
  enCours,
  executer,
}: {
  g: GenerationIa;
  actions: ReturnType<typeof actionsGeneration>;
  enCours: Action | null;
  executer: (
    a: Action,
    appel: () => Promise<GenerationIa>,
    succes: (g: GenerationIa) => string,
  ) => Promise<boolean>;
}) {
  const t = useT();
  const langue = useLangue();
  const [edition, setEdition] = useState(false);
  const [saisie, setSaisie] = useState("");
  const [acquitte, setAcquitte] = useState(false);
  const [confirmer, setConfirmer] = useState(false);
  const [erreurs, setErreurs] = useState<{ texte?: string; acquittement?: string }>({});
  const refTexte = useRef<HTMLTextAreaElement>(null);
  const refAcquittement = useRef<HTMLDivElement>(null);
  const valide = g.statut_contenu === "valide";
  const essai = estEssai(g);
  const statutContenu = g.statut_contenu ?? "brouillon_ia";

  useEffect(() => {
    if (edition) refTexte.current?.focus();
  }, [edition]);

  function ouvrirEdition() {
    setSaisie(g.texte ?? "");
    setErreurs({});
    setConfirmer(false);
    setEdition(true);
  }

  async function enregistrer(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const v = validerTexteModifie(saisie, g.texte, langue);
    if (!v.ok) {
      setErreurs(v.erreurs);
      refTexte.current?.focus();
      return;
    }
    setErreurs({});
    const ok = await executer(
      "modifier",
      () => api.post<GenerationIa>(`${cheminGeneration(g.id)}/modifier`, v.charge),
      (r) =>
        t(
          `Version ${r.version ?? ""} enregistrée : contenu modifié, en attente de validation.`,
          `Version ${r.version ?? ""} saved: content edited, pending approval.`,
        ),
    );
    if (ok) {
      setEdition(false);
      setAcquitte(false);
    }
  }

  function demanderValidation() {
    const v = validerAcquittement(g, acquitte, langue);
    if (!v.ok) {
      setErreurs(v.erreurs);
      refAcquittement.current?.querySelector("input")?.focus();
      return;
    }
    setErreurs({});
    setConfirmer(true);
  }

  async function valider() {
    const v = validerAcquittement(g, acquitte, langue);
    if (!v.ok) return;
    await executer(
      "valider",
      () => api.post<GenerationIa>(`${cheminGeneration(g.id)}/valider`, v.charge),
      (r) => messageSuccesValidation(r, langue),
    );
    setConfirmer(false);
  }

  return (
    <>
      {valide ? (
        <Alerte tonalite="succes" annonce="aucune" titre={t("Contenu validé", "Content approved")}>
          <p>{messageValide(g, langue)}</p>
        </Alerte>
      ) : (
        <Alerte
          tonalite="info"
          annonce="aucune"
          titre={
            essai
              ? t("Contenu d'essai à relire", "Test content to review")
              : t(
                  "À relire avant tout envoi au client",
                  "To review before anything is sent to the client",
                )
          }
        >
          <p>{presentationStatutContenu(statutContenu, langue).aide}</p>
          {essai ? <p>{t(MESSAGE_ESSAI, MESSAGE_ESSAI_EN)}</p> : null}
        </Alerte>
      )}
      {edition ? (
        <form className="mp-formulaire" noValidate onSubmit={enregistrer}>
          <ZoneTexte
            ref={refTexte}
            libelle={t("Texte du contenu", "Content text")}
            aide={
              g.donnees
                ? t(
                    "Contenu structuré (JSON) : gardez la structure et les noms des champs.",
                    "Structured content (JSON): keep the structure and the field names.",
                  )
                : t(
                    "Une nouvelle version « Modifié » est enregistrée ; l'historique est conservé.",
                    'A new "Edited" version is saved; the history is kept.',
                  )
            }
            rows={12}
            maxLength={100_000}
            lang="fr"
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            erreur={erreurs.texte}
          />
          <div className="mp-actions-formulaire">
            <Bouton
              type="submit"
              chargement={enCours === "modifier"}
              texteChargement={t("Enregistrement…", "Saving…")}
            >
              {t("Enregistrer la version modifiée", "Save the edited version")}
            </Bouton>
            <Bouton
              variante="secondaire"
              disabled={enCours === "modifier"}
              onClick={() => {
                setEdition(false);
                setErreurs({});
              }}
            >
              {t("Abandonner la modification", "Discard the changes")}
            </Bouton>
          </div>
        </form>
      ) : (
        <div className={`mp-contenu-ia__texte${valide ? " mp-contenu-ia__texte--valide" : ""}`}>
          {g.texte ?? ""}
        </div>
      )}
      {g.chiffres_non_verifies && !valide ? (
        <BandeauChiffresNonVerifies
          nombres={g.nombres_non_verifies}
          acquitte={acquitte}
          onAcquitteChange={(v) => {
            setAcquitte(v);
            if (v) setErreurs((e) => ({ ...e, acquittement: undefined }));
          }}
          erreur={erreurs.acquittement}
          desactive={edition || enCours !== null}
          refZone={refAcquittement}
        />
      ) : null}
      {!edition && !confirmer && (actions.modifier || actions.valider) ? (
        <div className="mp-barre-actions">
          {actions.modifier ? (
            <Bouton
              variante="secondaire"
              icone="crayon"
              disabled={enCours !== null}
              onClick={ouvrirEdition}
            >
              {t("Modifier le texte", "Edit the text")}
            </Bouton>
          ) : null}
          {actions.valider ? (
            <Bouton icone="succes" disabled={enCours !== null} onClick={demanderValidation}>
              {t("Valider le contenu", "Approve the content")}
            </Bouton>
          ) : null}
        </div>
      ) : null}
      {confirmer ? (
        <ConfirmationValidationIa
          chiffres={g.chiffres_non_verifies === true}
          essai={essai}
          enCours={enCours === "valider"}
          valider={valider}
          renoncer={() => setConfirmer(false)}
        />
      ) : null}
      {actions.raisonValidation ? (
        <p className="mp-texte-petit mp-texte-doux">{actions.raisonValidation}</p>
      ) : null}
    </>
  );
}

/** Seconde étape de la validation : elle fige le contenu, d'où la question explicite. */
function ConfirmationValidationIa({
  chiffres,
  essai,
  enCours,
  valider,
  renoncer,
}: {
  chiffres: boolean;
  essai: boolean;
  enCours: boolean;
  valider: () => Promise<void>;
  renoncer: () => void;
}) {
  const t = useT();
  const id = useId();
  const refOui = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    refOui.current?.focus();
  }, []);
  return (
    <div className="mp-sous-formulaire mp-pile" role="group" aria-labelledby={id}>
      <p id={id} className="mp-confirmation__question">
        {t("Valider définitivement ce contenu ?", "Approve this content for good?")}
      </p>
      <p className="mp-texte-petit">
        {t(
          `Une fois validé, il ne se modifie plus ; ${essai ? "contenu d'essai, il ne sera jamais transmis au client." : "seul un contenu validé peut être transmis au client."}${chiffres ? " Vous attestez les nombres signalés." : ""}`,
          `Once approved, it can no longer be edited; ${essai ? "as test content, it will never be sent to the client." : "only approved content can be sent to the client."}${chiffres ? " You attest the flagged numbers." : ""}`,
        )}
      </p>
      <div className="mp-confirmation__boutons">
        <Bouton
          ref={refOui}
          chargement={enCours}
          texteChargement={t("Validation…", "Approving…")}
          onClick={() => void valider()}
        >
          {t("Oui, valider", "Yes, approve")}
        </Bouton>
        <Bouton variante="secondaire" disabled={enCours} onClick={renoncer}>
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </div>
  );
}

/** Prompt, production (modèle ou gabarit), durée, jetons et coût (si l'API les fournit), sources. */
function TracabiliteIa({ g }: { g: GenerationIa }) {
  const t = useT();
  const langue = useLangue();
  const lignes = lignesTracabilite(g, langue);
  return (
    <details className="mp-details">
      <summary>{t("Traçabilité", "Traceability")}</summary>
      <dl className="mp-liste-def mp-liste-def--compacte">
        {lignes.map(([dt, dd]) => (
          <div key={dt}>
            <dt>{dt}</dt>
            <dd className="mp-coupure">{dd}</dd>
          </div>
        ))}
        <div>
          <dt>{t("Sources citées", "Sources cited")}</dt>
          <dd>
            {g.sources.length === 0 ? (
              t("Aucune", "None")
            ) : (
              <ul className="mp-liste-simple">
                {g.sources.map((s) => (
                  <li key={`${s.type}-${s.id}`}>
                    {`${(langue === "en" ? TYPE_SOURCE_IA_LIBELLES_EN : TYPE_SOURCE_LIBELLES)[s.type] ?? s.type}${t(" : ", ": ")}${s.libelle}`}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </details>
  );
}
