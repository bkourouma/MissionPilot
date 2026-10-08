"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ErreurApi, messageErreur } from "../../lib/api";
import { formaterDate, formaterDateHeure } from "../../lib/format";
import {
  actionsDemande,
  avancement,
  cheminDemande,
  detailAvancement,
  echeanceDepassee,
  hrefSalle,
  messageSalle,
  PALIER_RELANCE,
  STATUT_DEMANDE,
  type DemandeDetail,
} from "../../lib/salle-mission";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { Champ } from "../ui/Champ";
import { PieceCabinet } from "./PieceCabinet";
import "./salle.css";

export interface DemandeCabinetProps {
  missionId: string;
  demande: DemandeDetail;
  contexte: { gerer: boolean; missionCloturee: boolean; documents: boolean };
  aujourdhui: string;
}

const message = (e: unknown) =>
  (e instanceof ErreurApi ? messageSalle(e.code) : null) ?? messageErreur(e);

/**
 * Vue d'une demande documentaire pour l'équipe : suivi des pièces, envoi au client,
 * prolongation, relance, clôture ; ajout d'une pièce ; enregistrement comme modèle.
 */
export function DemandeCabinet({ missionId, demande, contexte, aujourdhui }: DemandeCabinetProps) {
  const router = useRouter();
  const actions = actionsDemande(demande, contexte);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [echeance, setEcheance] = useState(demande.echeance ?? "");
  const [nouvellePiece, setNouvellePiece] = useState("");
  const statut = STATUT_DEMANDE[demande.statut];
  const chemin = cheminDemande(missionId, demande.id);

  async function agir(action: () => Promise<unknown>, succes?: string) {
    setOccupe(true);
    setErreur(null);
    setInfo(null);
    try {
      await action();
      if (succes) setInfo(succes);
      router.refresh();
      return true;
    } catch (e) {
      setErreur(message(e));
      return false;
    } finally {
      setOccupe(false);
    }
  }

  async function supprimer() {
    if (!window.confirm("Supprimer ce brouillon et ses pièces ?")) return;
    if (await agir(() => api.supprimer(chemin))) router.push(hrefSalle(missionId));
  }

  async function clore() {
    if (!window.confirm("Clore la demande ? Le client ne pourra plus rien y déposer.")) return;
    await agir(() => api.post(`${chemin}/cloturer`, {}), "Demande close.");
  }

  async function enregistrerModele() {
    const nom = window.prompt("Nom du modèle", demande.titre);
    if (!nom || nom.trim() === "") return;
    await agir(
      () =>
        api.post("/api/salle/modeles", {
          nom: nom.trim(),
          pieces: demande.pieces.map((p) => ({
            libelle: p.libelle,
            description: p.description,
            obligatoire: p.obligatoire,
          })),
        }),
      "Modèle enregistré : il sera proposé pour vos prochaines demandes.",
    );
  }

  const depassee = echeanceDepassee(demande, aujourdhui);

  return (
    <div className="mp-pile mp-pile--large">
      <section className="mp-pile">
        <div className="mp-salle__entete-carte">
          <h2 className="mp-section__titre">{demande.titre}</h2>
          <BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>
        </div>
        <ul className="mp-salle__meta">
          <li>
            {demande.echeance ? `Échéance : ${formaterDate(demande.echeance)}` : "Pas d'échéance"}
            {depassee ? " (dépassée)" : ""}
          </li>
          <li>{avancement(demande.synthese)}</li>
          {detailAvancement(demande.synthese) ? (
            <li>{detailAvancement(demande.synthese)}</li>
          ) : null}
          {demande.envoyee_le ? <li>Envoyée le {formaterDateHeure(demande.envoyee_le)}</li> : null}
          <li>
            Destinataires :{" "}
            {demande.destinataires.length > 0
              ? demande.destinataires.map((d) => d.nom).join(", ")
              : "aucun utilisateur actif du portail"}
          </li>
        </ul>
        {demande.message ? <p className="mp-salle__motif">{demande.message}</p> : null}
        {erreur ? (
          <Alerte tonalite="danger" annonce="alert">
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        {info ? (
          <Alerte tonalite="succes" annonce="status">
            <p>{info}</p>
          </Alerte>
        ) : null}
        {actions.envoyer && demande.destinataires.length === 0 ? (
          <Alerte tonalite="attention" annonce="aucune">
            <p>
              Aucun dirigeant ni contributeur du client n&apos;est actif sur le portail : invitez-en
              un depuis la fiche du client avant d&apos;envoyer.
            </p>
          </Alerte>
        ) : null}
        <div className="mp-salle__actions">
          {actions.modifier ? (
            <Champ
              libelle="Échéance"
              type="date"
              value={echeance}
              min={aujourdhui}
              onChange={(e) => setEcheance(e.target.value)}
            />
          ) : null}
          {actions.prolonger ? (
            <Champ
              libelle="Nouvelle échéance"
              type="date"
              value={echeance}
              min={aujourdhui}
              onChange={(e) => setEcheance(e.target.value)}
            />
          ) : null}
          {(actions.modifier || actions.prolonger) && echeance !== (demande.echeance ?? "") ? (
            <Bouton
              variante="secondaire"
              disabled={occupe || echeance === ""}
              onClick={() =>
                void agir(() => api.patch(chemin, { echeance }), "Échéance enregistrée.")
              }
            >
              Enregistrer l&apos;échéance
            </Bouton>
          ) : null}
        </div>
        <div className="mp-salle__actions">
          {actions.envoyer ? (
            <Bouton
              icone="envoyer"
              chargement={occupe}
              disabled={demande.pieces.length === 0}
              onClick={() =>
                void agir(
                  () => api.post(`${chemin}/envoyer`, {}),
                  "Demande envoyée : le client est prévenu par notification et par e-mail.",
                )
              }
            >
              Envoyer au client
            </Bouton>
          ) : null}
          {actions.relancer ? (
            <Bouton
              variante="secondaire"
              icone="cloche"
              disabled={occupe}
              onClick={() =>
                void agir(() => api.post(`${chemin}/relancer`, {}), "Relance envoyée au client.")
              }
            >
              Relancer maintenant
            </Bouton>
          ) : null}
          {actions.prolonger ? (
            <CaseACocher
              libelle="Relances automatiques (J−3, J+1, J+7)"
              checked={demande.relances_auto}
              disabled={occupe}
              onChange={(e) =>
                void agir(() => api.patch(chemin, { relances_auto: e.target.checked }))
              }
            />
          ) : null}
          {actions.clore ? (
            <Bouton variante="discret" disabled={occupe} onClick={() => void clore()}>
              Clore la demande
            </Bouton>
          ) : null}
          {actions.supprimer ? (
            <Bouton
              variante="danger"
              icone="corbeille"
              disabled={occupe}
              onClick={() => void supprimer()}
            >
              Supprimer le brouillon
            </Bouton>
          ) : null}
          {contexte.gerer && demande.pieces.length > 0 ? (
            <Bouton
              variante="discret"
              icone="copie"
              disabled={occupe}
              onClick={() => void enregistrerModele()}
            >
              Enregistrer comme modèle
            </Bouton>
          ) : null}
        </div>
      </section>

      <section className="mp-pile" aria-labelledby="pieces-titre">
        <h2 className="mp-section__titre" id="pieces-titre">
          Pièces demandées
        </h2>
        {demande.pieces.length === 0 ? (
          <p className="mp-texte-doux">Aucune pièce pour l&apos;instant.</p>
        ) : (
          <ul className="mp-salle__pieces">
            {demande.pieces.map((p) => (
              <PieceCabinet
                key={p.id}
                missionId={missionId}
                demande={demande}
                piece={p}
                contexte={contexte}
              />
            ))}
          </ul>
        )}
        {actions.ajouterPiece ? (
          <form
            className="mp-salle__actions"
            onSubmit={(e) => {
              e.preventDefault();
              if (nouvellePiece.trim() === "") return;
              void agir(() => api.post(`${chemin}/pieces`, { libelle: nouvellePiece.trim() })).then(
                (ok) => ok && setNouvellePiece(""),
              );
            }}
          >
            <Champ
              libelle="Ajouter une pièce"
              value={nouvellePiece}
              maxLength={200}
              onChange={(e) => setNouvellePiece(e.target.value)}
            />
            <Bouton type="submit" variante="secondaire" icone="plus" disabled={occupe}>
              Ajouter
            </Bouton>
          </form>
        ) : null}
      </section>

      {demande.relances.length > 0 ? (
        <section className="mp-pile" aria-labelledby="relances-titre">
          <h2 className="mp-section__titre" id="relances-titre">
            Relances
          </h2>
          <ul className="mp-salle__depots">
            {demande.relances.map((r, i) => (
              <li key={i}>
                {formaterDateHeure(r.cree_le)} — {PALIER_RELANCE[r.palier]} à{" "}
                {r.destinataire_nom ?? "—"}
                {r.relance_par_nom ? ` (par ${r.relance_par_nom})` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
