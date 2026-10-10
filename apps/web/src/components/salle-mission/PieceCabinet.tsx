"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ErreurApi, messageErreur } from "../../lib/api";
import { formaterTaille, messageTeleversement } from "../../lib/fichiers";
import { formaterDateHeure } from "../../lib/format";
import {
  acceptationParDeposant,
  cheminDepot,
  cheminPiece,
  hrefFichierDepot,
  MESSAGE_ACCEPTATION_PAR_DEPOSANT,
  messageSalle,
  peutDecider,
  peutDeposerPourLeClient,
  peutRetirerDepot,
  peutVerser,
  STATUT_PIECE,
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

const message = (e: unknown) =>
  (e instanceof ErreurApi ? messageSalle(e.code) : null) ?? messageErreur(e);

/**
 * Une pièce vue par l'équipe : statut, dépôts (téléchargement, origine, accusé de réception),
 * historique ; accepter (et verser au dossier de mission), rejeter avec un motif adressé au
 * client, déposer une pièce reçue hors portail.
 */
export function PieceCabinet({ missionId, demande, piece, contexte }: PieceCabinetProps) {
  const router = useRouter();
  const [panneau, setPanneau] = useState<Panneau>("aucun");
  const [motif, setMotif] = useState("");
  const [verser, setVerser] = useState(contexte.documents);
  const [fichier, setFichier] = useState<File | null>(null);
  const [progression, setProgression] = useState<number | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const statut = STATUT_PIECE[piece.statut];

  async function agir(action: () => Promise<unknown>) {
    setOccupe(true);
    setErreur(null);
    try {
      await action();
      setPanneau("aucun");
      setMotif("");
      router.refresh();
    } catch (e) {
      setErreur(message(e));
    } finally {
      setOccupe(false);
    }
  }

  /** Retire un dépôt non retenu ; l'erreur s'affiche et la confirmation se referme. */
  async function retirerDepot(depotId: string): Promise<boolean> {
    setErreur(null);
    try {
      await api.supprimer(cheminDepot(missionId, depotId));
      router.refresh();
      return true;
    } catch (e) {
      setErreur(message(e));
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
      router.refresh();
    } catch (e) {
      setErreur(messageTeleversement(e));
    } finally {
      setProgression(null);
    }
  }

  return (
    <li className="mp-salle__piece">
      <div className="mp-salle__entete-carte">
        <h3 className="mp-salle__piece-titre">
          {piece.libelle}
          {piece.obligatoire ? null : <span className="mp-texte-doux"> (facultative)</span>}
        </h3>
        <BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>
      </div>
      {piece.description ? <p className="mp-texte-doux">{piece.description}</p> : null}
      {piece.motif_rejet ? (
        <p className="mp-salle__motif">
          <strong>Motif du rejet adressé au client : </strong>
          {piece.motif_rejet}
        </p>
      ) : null}
      {piece.depots.length > 0 ? (
        <ul className="mp-salle__depots" aria-label={`Dépôts de « ${piece.libelle} »`}>
          {piece.depots.map((d) => (
            <li key={d.id}>
              {d.fichier ? (
                <a href={hrefFichierDepot(missionId, d.id)} className="mp-coupure">
                  {d.fichier.nom}
                </a>
              ) : (
                <span className="mp-texte-doux">Fichier retiré</span>
              )}
              <span className="mp-texte-doux">
                {d.fichier ? `${formaterTaille(d.fichier.taille)} · ` : ""}
                {d.origine === "portail" ? "déposé par" : "versé par l'équipe :"}{" "}
                {d.depose_par.nom ?? "—"}, le {formaterDateHeure(d.depose_le)}
              </span>
              {d.accuse ? (
                <BadgeStatut tonalite={d.accuse.statut === "envoye" ? "succes" : "attention"}>
                  {d.accuse.statut === "envoye"
                    ? "Accusé de réception envoyé"
                    : "Accusé suspendu (coupe-circuit)"}
                </BadgeStatut>
              ) : null}
              {d.document_id ? (
                <BadgeStatut tonalite="neutre">Versé au dossier</BadgeStatut>
              ) : contexte.gerer && contexte.documents && peutVerser(piece, d) ? (
                <Bouton
                  variante="discret"
                  icone="dossier"
                  disabled={occupe}
                  onClick={() =>
                    void agir(() => api.post(`${cheminDepot(missionId, d.id)}/rattacher`, {}))
                  }
                >
                  Verser au dossier de mission
                </Bouton>
              ) : null}
              {peutRetirerDepot(piece, d, contexte) ? (
                <BoutonConfirmation
                  libelle="Retirer ce dépôt"
                  ariaLabel={`Retirer le dépôt ${d.fichier?.nom ?? ""} de « ${piece.libelle} »`}
                  question="Retirer ce dépôt ? Le fichier sera supprimé et le client pourra en déposer un autre."
                  libelleConfirmation="Oui, retirer le dépôt"
                  texteChargement="Retrait…"
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
          <summary className="mp-texte-doux">Historique ({piece.historique.length})</summary>
          <ol className="mp-salle__depots">
            {piece.historique.map((h) => (
              <li key={h.rang}>
                {formaterDateHeure(h.le)} — {STATUT_PIECE[h.statut].libelle}
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
            libelle="Motif du rejet (envoyé au client)"
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            maxLength={1000}
            rows={3}
            required
            aide="Dites précisément ce qui manque ou ce qu'il faut corriger."
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
              Rejeter et prévenir le client
            </Bouton>
            <Bouton variante="discret" onClick={() => setPanneau("aucun")} disabled={occupe}>
              Annuler
            </Bouton>
          </div>
        </div>
      ) : null}
      {panneau === "depot" ? (
        <div className="mp-pile">
          <ChoixFichier
            libelle="Pièce reçue hors portail (courriel, remise en main propre)"
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
              Déposer pour le client
            </Bouton>
            <Bouton
              variante="discret"
              onClick={() => setPanneau("aucun")}
              disabled={progression !== null}
            >
              Annuler
            </Bouton>
          </div>
        </div>
      ) : null}
      {panneau === "aucun" ? (
        <div className="mp-salle__actions">
          {peutDecider(piece, contexte) && acceptationParDeposant(piece, contexte) ? (
            <>
              <p className="mp-texte-doux" role="note">
                {MESSAGE_ACCEPTATION_PAR_DEPOSANT}
              </p>
              <Bouton variante="secondaire" onClick={() => setPanneau("rejet")} disabled={occupe}>
                Rejeter…
              </Bouton>
            </>
          ) : peutDecider(piece, contexte) ? (
            <>
              {contexte.documents ? (
                <CaseACocher
                  libelle="Verser au dossier de mission"
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
                Accepter
              </Bouton>
              <Bouton variante="secondaire" onClick={() => setPanneau("rejet")} disabled={occupe}>
                Rejeter…
              </Bouton>
            </>
          ) : null}
          {peutDeposerPourLeClient(demande, piece, contexte) ? (
            <Bouton variante="discret" icone="trombone" onClick={() => setPanneau("depot")}>
              Déposer une pièce reçue hors portail
            </Bouton>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
