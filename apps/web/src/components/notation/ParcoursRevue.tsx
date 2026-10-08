"use client";

import { useRouter } from "next/navigation";
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

const ETAPES: { statut: StatutVersionNotation; libelle: string }[] = [
  { statut: "brouillon", libelle: "Brouillon" },
  { statut: "en_revue", libelle: "En revue (expert)" },
  { statut: "publiee", libelle: "Publiée" },
];

const SUCCES: Record<Exclude<ActionNotation, "calculs" | "ajustements">, string> = {
  soumettre: "Version soumise en revue : un expert métier doit maintenant la relire.",
  renvoyer: "Version renvoyée en brouillon avec votre motif.",
  publier: "Version publiée : elle est désormais figée.",
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
  const router = useRouter();
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
      setSucces(SUCCES[action]);
      attendre();
      router.refresh();
      return true;
    } catch (e) {
      setErreur(messageNotation(e));
      if (etatNotationChange(e)) router.refresh();
      return false;
    } finally {
      setEnCours(false);
    }
  }

  async function renvoyer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = validerMotifRenvoi(motif);
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
      <ol className="mp-notation-etapes" aria-label={`Étapes de revue de la version ${numero}`}>
        {ETAPES.map((e, i) => (
          <li key={e.statut} aria-current={i === indexCourant ? "step" : undefined}>
            {e.libelle}
            {i === indexCourant ? (
              <span className="mp-visuellement-cache"> (étape actuelle)</span>
            ) : null}
          </li>
        ))}
      </ol>
      {statut === "remplacee" ? (
        <p className="mp-texte-doux">
          Cette version n&apos;a pas été publiée : un calcul plus récent l&apos;a remplacée.
        </p>
      ) : null}

      {revue.length > 0 ? (
        <ol className="mp-notation-chronologie" aria-label="Historique de la revue">
          {revue.map((e) => (
            <li key={e.rang}>
              <strong>{libelleActionRevue(e.action)}</strong> le {formaterDateHeure(e.le)} par{" "}
              {e.par.nom}
              {e.motif ? (
                <>
                  {" "}
                  — motif : <span className="mp-notation-motif">{e.motif}</span>
                </>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {erreur ? (
        <Alerte ref={refErreur} tonalite="danger" titre="Action refusée">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {succes ? (
        <Alerte tonalite="succes" annonce="status">
          <p>{succes}</p>
        </Alerte>
      ) : null}

      {statut === "publiee" ? (
        <Alerte tonalite="succes" titre="Version publiée et figée" annonce="aucune">
          <p>
            Elle ne se modifie plus : toute correction passe par un nouveau calcul, qui crée une
            nouvelle version à relire.
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
            libelle="Soumettre en revue"
            question={`Soumettre la version ${numero} à la revue d'un expert métier ? Elle ne pourra plus être ajustée, sauf renvoi en brouillon.`}
            libelleConfirmation="Oui, soumettre"
            texteChargement="Soumission…"
            variante="primaire"
            icone="envoyer"
            action={() => (occupe ? Promise.resolve(false) : agir("soumettre"))}
          />
        </div>
      ) : null}
      {statut === "brouillon" && !gestionnaire && !droits.soumettre ? (
        <p className="mp-texte-doux">
          La version est en brouillon : le consultant ou le chef de mission doit la soumettre en
          revue avant qu&apos;un expert métier puisse la publier.
        </p>
      ) : null}
      {droits.publier ? (
        <div className="mp-barre-actions">
          <BoutonConfirmation
            libelle="Publier"
            question={`Publier la version ${numero} ? Elle sera figée : toute correction passera par un nouveau calcul.`}
            libelleConfirmation="Oui, publier"
            texteChargement="Publication…"
            variante="primaire"
            icone="succes"
            action={() => (occupe ? Promise.resolve(false) : agir("publier"))}
          />
        </div>
      ) : null}
      {droits.explicationPublication ? (
        <Alerte tonalite="info" titre="Publication" annonce="aucune">
          <p>{droits.explicationPublication}</p>
        </Alerte>
      ) : null}

      {droits.renvoyer ? (
        <form className="mp-formulaire mp-sous-formulaire" noValidate onSubmit={renvoyer}>
          <ZoneTexte
            ref={refMotif}
            id={`${id}-motif`}
            libelle="Motif du renvoi en brouillon"
            required
            rows={3}
            maxLength={MOTIF_MAX}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            erreur={erreurMotif}
            aide="Ce qui doit être revu (écart à justifier, réponse à compléter…). Le motif est conservé dans l'historique."
          />
          <div className="mp-actions-formulaire">
            <Bouton
              type="submit"
              variante="secondaire"
              chargement={enCours}
              texteChargement="Renvoi…"
              disabled={attente}
            >
              Renvoyer en brouillon
            </Bouton>
          </div>
        </form>
      ) : null}
    </div>
  );
}
