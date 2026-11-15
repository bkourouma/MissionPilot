"use client";

import { useRafraichir } from "../formulaires/useRafraichir";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { StatutVersionNotation } from "@missionpilot/shared";
import { api } from "../../lib/api";
import { formaterDateHeure } from "../../lib/format";
import {
  cheminActionNotation,
  etatNotationChange,
  libelleActionRevue,
  MOTIF_MAX,
  messageNotation,
  validerMotifRenvoi,
  type ActionNotation,
  type DroitsVersion,
  type EvenementRevue,
} from "../../lib/notation";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { useAttenteRafraichissement } from "../formulaires/useAttenteRafraichissement";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { ZoneTexte } from "../ui/ZoneTexte";

export interface ParcoursRevueProps {
  notationId: string;
  numero: number;
  statut: StatutVersionNotation;
  revue: EvenementRevue[];
  droits: DroitsVersion;
  /** L'utilisateur peut gérer la notation (consultant, chef…) : messages adaptés. */
  gestionnaire: boolean;
}

const ETAPES: { statut: StatutVersionNotation; fr: string; en: string }[] = [
  { statut: "brouillon", fr: "Brouillon", en: "Draft" },
  { statut: "en_revue", fr: "En revue (expert)", en: "In review (expert)" },
  { statut: "publiee", fr: "Publiée", en: "Published" },
];

const SUCCES: Record<
  Exclude<ActionNotation, "calculs" | "ajustements">,
  { fr: string; en: string }
> = {
  soumettre: {
    fr: "Version soumise en revue : un expert métier doit maintenant la relire.",
    en: "Version submitted for review: a business expert must now review it.",
  },
  renvoyer: {
    fr: "Version renvoyée en brouillon avec votre motif.",
    en: "Version sent back to draft with your reason.",
  },
  publier: {
    fr: "Version publiée : elle est désormais figée.",
    en: "Version published: it is now locked.",
  },
};

/**
 * Parcours de revue (NOT-07) : brouillon → en revue → publiée. Soumission par qui gère la
 * notation ; renvoi motivé et publication par un expert métier qui n'a ni calculé, ni ajusté,
 * ni soumis la version (séparation des tâches). Le bouton « Publier » n'est proposé qu'à un tel
 * expert ; sinon une explication est affichée. L'API reste seule juge.
 */
export function ParcoursRevue({
  notationId,
  numero,
  statut,
  revue,
  droits,
  gestionnaire,
}: ParcoursRevueProps) {
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
  const id = useId();
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [motif, setMotif] = useState("");
  const [erreurMotif, setErreurMotif] = useState<string | undefined>();
  const [enCours, setEnCours] = useState(false);
  const [attente, attendre] = useAttenteRafraichissement(statut);
  const refErreur = useRef<HTMLDivElement>(null);
  const refMotif = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (erreur) refErreur.current?.focus();
  }, [erreur]);

  // Autre version affichée : les messages de la précédente ne la concernent pas.
  useEffect(() => {
    setErreur(null);
    setSucces(null);
  }, [numero]);

  async function agir(action: keyof typeof SUCCES, corps?: unknown): Promise<boolean> {
    setErreur(null);
    setSucces(null);
    setEnCours(true);
    try {
      await api.post(cheminActionNotation(notationId, action), corps);
      setSucces(t(SUCCES[action].fr, SUCCES[action].en));
      attendre();
      rafraichir();
      return true;
    } catch (e) {
      setErreur(messageNotation(e, langue));
      if (etatNotationChange(e)) rafraichir();
      return false;
    } finally {
      setEnCours(false);
    }
  }

  async function renvoyer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = validerMotifRenvoi(motif, langue);
    if (!v.ok) {
      setErreurMotif(v.erreurs.motif);
      refMotif.current?.focus();
      return;
    }
    setErreurMotif(undefined);
    if (await agir("renvoyer", v.charge)) setMotif("");
  }

  const occupe = enCours || attente;
  const indexCourant = ETAPES.findIndex((e) => e.statut === statut);
  return (
    <div className="mp-notation__section">
      <ol
        className="mp-notation-etapes"
        aria-label={t(
          `Étapes de revue de la version ${numero}`,
          `Review steps of version ${numero}`,
        )}
      >
        {ETAPES.map((e, i) => (
          <li key={e.statut} aria-current={i === indexCourant ? "step" : undefined}>
            {t(e.fr, e.en)}
            {i === indexCourant ? (
              <span className="mp-visuellement-cache">
                {t(" (étape actuelle)", " (current step)")}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {statut === "remplacee" ? (
        <p className="mp-texte-doux">
          {t(
            "Cette version n'a pas été publiée : un calcul plus récent l'a remplacée.",
            "This version was not published: a more recent computation replaced it.",
          )}
        </p>
      ) : null}

      {revue.length > 0 ? (
        <ol
          className="mp-notation-chronologie"
          aria-label={t("Historique de la revue", "Review history")}
        >
          {revue.map((e) => (
            <li key={e.rang}>
              <strong>{libelleActionRevue(e.action, langue)}</strong> {t("le", "on")}{" "}
              {formaterDateHeure(e.le, "Africa/Abidjan", langue)} {t("par", "by")} {e.par.nom}
              {e.motif ? (
                <>
                  {" "}
                  — {t("motif", "reason")} : <span className="mp-notation-motif">{e.motif}</span>
                </>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {erreur ? (
        <Alerte ref={refErreur} tonalite="danger" titre={t("Action refusée", "Action refused")}>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {succes ? (
        <Alerte tonalite="succes" annonce="status">
          <p>{succes}</p>
        </Alerte>
      ) : null}

      {statut === "publiee" ? (
        <Alerte
          tonalite="succes"
          titre={t("Version publiée et figée", "Version published and locked")}
          annonce="aucune"
        >
          <p>
            {t(
              "Elle ne se modifie plus : toute correction passe par un nouveau calcul, qui crée une nouvelle version à relire.",
              "It can no longer be edited: any correction goes through a new computation, which creates a new version to review.",
            )}
          </p>
        </Alerte>
      ) : null}

      {droits.blocageSoumission ? (
        <Alerte tonalite="attention" annonce="aucune">
          <p>{droits.blocageSoumission}</p>
        </Alerte>
      ) : null}
      {droits.soumettre ? (
        <div className="mp-barre-actions">
          <BoutonConfirmation
            libelle={t("Soumettre en revue", "Submit for review")}
            question={t(
              `Soumettre la version ${numero} à la revue d'un expert métier ? Elle ne pourra plus être ajustée, sauf renvoi en brouillon.`,
              `Submit version ${numero} for review by a business expert? It can no longer be adjusted, unless sent back to draft.`,
            )}
            libelleConfirmation={t("Oui, soumettre", "Yes, submit")}
            texteChargement={t("Soumission…", "Submitting…")}
            variante="primaire"
            icone="envoyer"
            action={() => (occupe ? Promise.resolve(false) : agir("soumettre"))}
          />
        </div>
      ) : null}
      {statut === "brouillon" && !gestionnaire && !droits.soumettre ? (
        <p className="mp-texte-doux">
          {t(
            "La version est en brouillon : le consultant ou le chef de mission doit la soumettre en revue avant qu'un expert métier puisse la publier.",
            "The version is a draft: the consultant or the engagement manager must submit it for review before a business expert can publish it.",
          )}
        </p>
      ) : null}
      {droits.publier ? (
        <div className="mp-barre-actions">
          <BoutonConfirmation
            libelle={t("Publier", "Publish")}
            question={t(
              `Publier la version ${numero} ? Elle sera figée : toute correction passera par un nouveau calcul.`,
              `Publish version ${numero}? It will be locked: any correction will go through a new computation.`,
            )}
            libelleConfirmation={t("Oui, publier", "Yes, publish")}
            texteChargement={t("Publication…", "Publishing…")}
            variante="primaire"
            icone="succes"
            action={() => (occupe ? Promise.resolve(false) : agir("publier"))}
          />
        </div>
      ) : null}
      {droits.explicationPublication ? (
        <Alerte tonalite="info" titre={t("Publication", "Publication")} annonce="aucune">
          <p>{droits.explicationPublication}</p>
        </Alerte>
      ) : null}

      {droits.renvoyer ? (
        <form className="mp-formulaire mp-sous-formulaire" noValidate onSubmit={renvoyer}>
          <ZoneTexte
            ref={refMotif}
            id={`${id}-motif`}
            libelle={t("Motif du renvoi en brouillon", "Reason for sending back to draft")}
            required
            rows={3}
            maxLength={MOTIF_MAX}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            erreur={erreurMotif}
            aide={t(
              "Ce qui doit être revu (écart à justifier, réponse à compléter…). Le motif est conservé dans l'historique.",
              "What needs to be reviewed (difference to justify, answer to complete…). The reason is kept in the history.",
            )}
          />
          <div className="mp-actions-formulaire">
            <Bouton
              type="submit"
              variante="secondaire"
              chargement={enCours}
              texteChargement={t("Renvoi…", "Sending back…")}
              disabled={attente}
            >
              {t("Renvoyer en brouillon", "Send back to draft")}
            </Bouton>
          </div>
        </form>
      ) : null}
    </div>
  );
}
