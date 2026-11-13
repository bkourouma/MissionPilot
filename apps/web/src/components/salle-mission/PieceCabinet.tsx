"use client";

import { useRafraichir } from "../formulaires/useRafraichir";
import { useState } from "react";
import type { Langue } from "@missionpilot/shared";
import { api, ErreurApi, messageErreur } from "../../lib/api";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { formaterTaille, messageTeleversement } from "../../lib/fichiers";
import { formaterDateHeure } from "../../lib/format";
import {
  acceptationParDeposant,
  cheminDepot,
  cheminPiece,
  hrefFichierDepot,
  messageAcceptationParDeposant,
  messageSalle,
  peutDecider,
  peutDeposerPourLeClient,
  peutRetirerDepot,
  peutVerser,
  statutPiece,
  type ContexteSalle,
  type DemandeDetail,
  type PieceSalle,
} from "../../lib/salle-mission";
import { televerser } from "../../lib/televersement";
import { ChoixFichier } from "../fichiers/ChoixFichier";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { ZoneTexte } from "../ui/ZoneTexte";

export interface PieceCabinetProps {
  missionId: string;
  demande: Pick<DemandeDetail, "statut">;
  piece: PieceSalle;
  contexte: ContexteSalle;
}

type Panneau = "aucun" | "rejet" | "depot";

const message = (e: unknown, langue: Langue) =>
  (e instanceof ErreurApi ? messageSalle(e.code, langue) : null) ?? messageErreur(e, langue);

/**
 * Une pièce vue par l'équipe : statut, dépôts (téléchargement, origine, accusé de réception),
 * historique ; accepter (et verser au dossier de mission), rejeter avec un motif adressé au
 * client, déposer une pièce reçue hors portail.
 */
export function PieceCabinet({ missionId, demande, piece, contexte }: PieceCabinetProps) {
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
  const [panneau, setPanneau] = useState<Panneau>("aucun");
  const [motif, setMotif] = useState("");
  const [verser, setVerser] = useState(contexte.documents);
  const [fichier, setFichier] = useState<File | null>(null);
  const [progression, setProgression] = useState<number | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const statut = statutPiece(piece.statut, langue);

  async function agir(action: () => Promise<unknown>) {
    setOccupe(true);
    setErreur(null);
    try {
      await action();
      setPanneau("aucun");
      setMotif("");
      rafraichir();
    } catch (e) {
      setErreur(message(e, langue));
    } finally {
      setOccupe(false);
    }
  }

  /** Retire un dépôt non retenu ; l'erreur s'affiche et la confirmation se referme. */
  async function retirerDepot(depotId: string): Promise<boolean> {
    setErreur(null);
    try {
      await api.supprimer(cheminDepot(missionId, depotId));
      rafraichir();
      return true;
    } catch (e) {
      setErreur(message(e, langue));
      return false;
    }
  }

  async function deposer() {
    if (!fichier) return;
    setErreur(null);
    setProgression(0);
    try {
      await televerser(`${cheminPiece(missionId, piece.id)}/depots`, fichier, fichier.name, {
        onProgression: setProgression,
      });
      setFichier(null);
      setPanneau("aucun");
      rafraichir();
    } catch (e) {
      setErreur(messageTeleversement(e, langue));
    } finally {
      setProgression(null);
    }
  }

  return (
    <li className="mp-salle__piece">
      <div className="mp-salle__entete-carte">
        <h3 className="mp-salle__piece-titre">
          {piece.libelle}
          {piece.obligatoire ? null : (
            <span className="mp-texte-doux"> {t("(facultative)", "(optional)")}</span>
          )}
        </h3>
        <BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>
      </div>
      {piece.description ? <p className="mp-texte-doux">{piece.description}</p> : null}
      {piece.motif_rejet ? (
        <p className="mp-salle__motif">
          <strong>
            {t("Motif du rejet adressé au client : ", "Rejection reason sent to the client: ")}
          </strong>
          {piece.motif_rejet}
        </p>
      ) : null}
      {piece.depots.length > 0 ? (
        <ul
          className="mp-salle__depots"
          aria-label={t(`Dépôts de « ${piece.libelle} »`, `Uploads for "${piece.libelle}"`)}
        >
          {piece.depots.map((d) => (
            <li key={d.id}>
              {d.fichier ? (
                <a href={hrefFichierDepot(missionId, d.id)} className="mp-coupure">
                  {d.fichier.nom}
                </a>
              ) : (
                <span className="mp-texte-doux">{t("Fichier retiré", "File removed")}</span>
              )}
              <span className="mp-texte-doux">
                {d.fichier ? `${formaterTaille(d.fichier.taille, langue)} · ` : ""}
                {d.origine === "portail"
                  ? t("déposé par", "uploaded by")
                  : t("versé par l'équipe :", "uploaded by the team:")}{" "}
                {d.depose_par.nom ?? "—"}, {t("le", "on")}{" "}
                {formaterDateHeure(d.depose_le, undefined, langue)}
              </span>
              {d.accuse ? (
                <BadgeStatut tonalite={d.accuse.statut === "envoye" ? "succes" : "attention"}>
                  {d.accuse.statut === "envoye"
                    ? t("Accusé de réception envoyé", "Acknowledgment of receipt sent")
                    : t(
                        "Accusé suspendu (coupe-circuit)",
                        "Acknowledgment suspended (circuit breaker)",
                      )}
                </BadgeStatut>
              ) : null}
              {d.document_id ? (
                <BadgeStatut tonalite="neutre">
                  {t("Versé au dossier", "Added to the file")}
                </BadgeStatut>
              ) : contexte.gerer && contexte.documents && peutVerser(piece, d) ? (
                <Bouton
                  variante="discret"
                  icone="dossier"
                  disabled={occupe}
                  onClick={() =>
                    void agir(() => api.post(`${cheminDepot(missionId, d.id)}/rattacher`, {}))
                  }
                >
                  {t("Verser au dossier de mission", "Add to the engagement file")}
                </Bouton>
              ) : null}
              {peutRetirerDepot(piece, d, contexte) ? (
                <BoutonConfirmation
                  libelle={t("Retirer ce dépôt", "Remove this upload")}
                  ariaLabel={t(
                    `Retirer le dépôt ${d.fichier?.nom ?? ""} de « ${piece.libelle} »`,
                    `Remove the upload ${d.fichier?.nom ?? ""} from "${piece.libelle}"`,
                  )}
                  question={t(
                    "Retirer ce dépôt ? Le fichier sera supprimé et le client pourra en déposer un autre.",
                    "Remove this upload? The file will be deleted and the client will be able to upload another.",
                  )}
                  libelleConfirmation={t("Oui, retirer le dépôt", "Yes, remove the upload")}
                  texteChargement={t("Retrait…", "Removing…")}
                  variante="discret"
                  icone="corbeille"
                  action={() => retirerDepot(d.id)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {piece.historique.length > 0 ? (
        <details>
          <summary className="mp-texte-doux">
            {t("Historique", "History")} ({piece.historique.length})
          </summary>
          <ol className="mp-salle__depots">
            {piece.historique.map((h) => (
              <li key={h.rang}>
                {formaterDateHeure(h.le, undefined, langue)} —{" "}
                {statutPiece(h.statut, langue).libelle}
                {h.par_nom ? ` (${h.par_nom})` : ""}
                {h.motif ? ` : ${h.motif}` : ""}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      {erreur ? (
        <Alerte tonalite="danger" annonce="alert">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {panneau === "rejet" ? (
        <div className="mp-pile">
          <ZoneTexte
            libelle={t(
              "Motif du rejet (envoyé au client)",
              "Rejection reason (sent to the client)",
            )}
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            maxLength={1000}
            rows={3}
            required
            aide={t(
              "Dites précisément ce qui manque ou ce qu'il faut corriger.",
              "State precisely what is missing or needs correcting.",
            )}
          />
          <div className="mp-actions-formulaire">
            <Bouton
              variante="danger"
              chargement={occupe}
              disabled={motif.trim() === ""}
              onClick={() =>
                void agir(() =>
                  api.post(`${cheminPiece(missionId, piece.id)}/rejeter`, { motif: motif.trim() }),
                )
              }
            >
              {t("Rejeter et prévenir le client", "Reject and notify the client")}
            </Bouton>
            <Bouton variante="discret" onClick={() => setPanneau("aucun")} disabled={occupe}>
              {t("Annuler", "Cancel")}
            </Bouton>
          </div>
        </div>
      ) : null}
      {panneau === "depot" ? (
        <div className="mp-pile">
          <ChoixFichier
            libelle={t(
              "Pièce reçue hors portail (courriel, remise en main propre)",
              "Document received outside the portal (email, hand delivery)",
            )}
            fichier={fichier}
            onChoix={setFichier}
            photo
            progression={progression}
          />
          <div className="mp-actions-formulaire">
            <Bouton
              icone="envoyer"
              disabled={!fichier || progression !== null}
              chargement={progression !== null}
              onClick={() => void deposer()}
            >
              {t("Déposer pour le client", "Upload on behalf of the client")}
            </Bouton>
            <Bouton
              variante="discret"
              onClick={() => setPanneau("aucun")}
              disabled={progression !== null}
            >
              {t("Annuler", "Cancel")}
            </Bouton>
          </div>
        </div>
      ) : null}
      {panneau === "aucun" ? (
        <div className="mp-salle__actions">
          {peutDecider(piece, contexte) && acceptationParDeposant(piece, contexte) ? (
            <>
              <p className="mp-texte-doux" role="note">
                {messageAcceptationParDeposant(langue)}
              </p>
              <Bouton variante="secondaire" onClick={() => setPanneau("rejet")} disabled={occupe}>
                {t("Rejeter…", "Reject…")}
              </Bouton>
            </>
          ) : peutDecider(piece, contexte) ? (
            <>
              {contexte.documents ? (
                <CaseACocher
                  libelle={t("Verser au dossier de mission", "Add to the engagement file")}
                  checked={verser}
                  onChange={(e) => setVerser(e.target.checked)}
                />
              ) : null}
              <Bouton
                icone="succes"
                chargement={occupe}
                onClick={() =>
                  void agir(() =>
                    api.post(`${cheminPiece(missionId, piece.id)}/accepter`, {
                      rattacher: contexte.documents && verser,
                    }),
                  )
                }
              >
                {t("Accepter", "Accept")}
              </Bouton>
              <Bouton variante="secondaire" onClick={() => setPanneau("rejet")} disabled={occupe}>
                {t("Rejeter…", "Reject…")}
              </Bouton>
            </>
          ) : null}
          {peutDeposerPourLeClient(demande, piece, contexte) ? (
            <Bouton variante="discret" icone="trombone" onClick={() => setPanneau("depot")}>
              {t(
                "Déposer une pièce reçue hors portail",
                "Upload a document received outside the portal",
              )}
            </Bouton>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
