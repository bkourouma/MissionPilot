"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import {
  ACCEPT_INGESTION,
  avecRequete,
  controlerFichierIngestion,
  messageErreur,
  televerserDocument,
  type DocumentIngestion,
} from "../../lib/ingestion";
import { aideTeleversement, type UsageTeleversement } from "../../lib/ingestion-detail";

export interface TeleversementDocumentProps {
  /** Point d'API de téléversement, sans requête (ex. `/api/dossiers/<id>/etats-financiers/document`). */
  chemin: string;
  /** Champs de requête (valeurs vides ignorées). */
  requete?: Record<string, string | number | boolean | null | undefined>;
  libelleBouton: string;
  /** Appelé avec la vue du document créé (statut `en_file`). */
  onCree: (document: DocumentIngestion) => void;
  /** Contrôle des autres champs avant l'envoi ; renvoyer false bloque l'envoi. */
  avantEnvoi?: () => boolean;
  /** Libellé du champ fichier. */
  libelleFichier?: string;
  /** Champs supplémentaires, affichés avant le champ fichier. */
  children?: ReactNode;
  /** Désactive l'envoi. */
  desactive?: boolean;
  /** Seul l'import d'un état financier affiche la consigne OCR (« part toujours en revue »). */
  usage?: UsageTeleversement;
}

/**
 * Champ fichier + contrôle côté client (extension .pdf / .xlsx, plafonds) + envoi + message
 * d'état. Le fichier n'est ni lu ni conservé dans le navigateur au-delà de l'envoi.
 */
export function TeleversementDocument({
  chemin,
  requete = {},
  libelleBouton,
  onCree,
  avantEnvoi,
  libelleFichier,
  children,
  desactive = false,
  usage = "autre",
}: TeleversementDocumentProps) {
  const t = useT();
  const langue = useLangue();
  const [fichier, setFichier] = useState<File | null>(null);
  const [erreurFichier, setErreurFichier] = useState<string | undefined>();
  const [enCours, setEnCours] = useState(false);
  const [progression, setProgression] = useState<number | null>(null);
  const [echec, setEchec] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [cle, setCle] = useState(0);

  async function envoyer(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setEchec(null);
    setSucces(null);
    const champsOk = avantEnvoi ? avantEnvoi() : true;
    const controle = controlerFichierIngestion(fichier, langue);
    setErreurFichier(controle.ok ? undefined : controle.message);
    if (!champsOk || !controle.ok || !fichier) return;
    setEnCours(true);
    setProgression(0);
    try {
      const doc = await televerserDocument(avecRequete(chemin, requete), fichier, {
        onProgression: setProgression,
      });
      setSucces(
        t(
          `« ${doc.nom} » est reçu. Sa lecture se fait en arrière-plan : le statut se met à jour tout seul.`,
          `"${doc.nom}" has been received. It is read in the background: the status updates on its own.`,
        ),
      );
      setFichier(null);
      setCle((c) => c + 1);
      onCree(doc);
    } catch (e) {
      setEchec(messageErreur(e));
    } finally {
      setEnCours(false);
      setProgression(null);
    }
  }

  const pct = progression === null ? "" : ` (${Math.round(progression * 100)} %)`;

  return (
    <form className="mp-formulaire" noValidate onSubmit={envoyer} aria-label={libelleBouton}>
      {children}
      <Champ
        key={cle}
        libelle={libelleFichier ?? t("Fichier (PDF ou Excel)", "File (PDF or Excel)")}
        type="file"
        required
        accept={ACCEPT_INGESTION}
        aide={aideTeleversement(usage, langue)}
        onChange={(e) => {
          setFichier(e.target.files?.[0] ?? null);
          setErreurFichier(undefined);
        }}
        erreur={erreurFichier}
      />
      {echec ? (
        <Alerte tonalite="danger" titre={t("Envoi refusé", "Upload rejected")}>
          <p>{echec}</p>
        </Alerte>
      ) : null}
      {succes ? (
        <Alerte tonalite="succes" titre={t("Document reçu", "Document received")}>
          <p>{succes}</p>
        </Alerte>
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          icone="telechargement"
          disabled={desactive}
          chargement={enCours}
          texteChargement={`${t("Envoi en cours", "Uploading")}${pct}…`}
        >
          {libelleBouton}
        </Bouton>
      </div>
    </form>
  );
}
