import { formaterTaille } from "../../../lib/fichiers";
import { formaterDateHeure } from "../../../lib/format";
import {
  depotPossible,
  libelleEcheance,
  resumePourClient,
  statutPiece,
  type DemandePortail,
} from "../../../lib/salle-mission-portail";
import { Alerte } from "../../ui/Alerte";
import { BadgeStatut } from "../../ui/BadgeStatut";
import { DepotPiece } from "./DepotPiece";
import "../../salle-mission/salle.css";

export interface DemandePortailVueProps {
  demande: DemandePortail;
  aujourdhui: string;
}

/**
 * Demande de documents vue par le client : message du cabinet, échéance, et pour chaque pièce
 * son statut, le motif d'un rejet, les dépôts de l'entreprise (avec l'accusé de réception) et,
 * tant que la pièce n'est pas acceptée, le dépôt d'un fichier.
 */
export function DemandePortailVue({ demande, aujourdhui }: DemandePortailVueProps) {
  const echeance = libelleEcheance(demande, aujourdhui);
  return (
    <div className="mp-pile mp-pile--large">
      <div className="mp-pile">
        <div className="mp-salle__entete-carte">
          <p className="mp-texte-doux">{resumePourClient(demande.synthese)}</p>
          <BadgeStatut tonalite={echeance.tonalite}>{echeance.texte}</BadgeStatut>
        </div>
        {demande.message ? <p className="mp-salle__motif">{demande.message}</p> : null}
        {demande.statut === "close" ? (
          <Alerte tonalite="info" annonce="aucune">
            <p>Cette demande est close : elle n&apos;accepte plus de document.</p>
          </Alerte>
        ) : null}
      </div>
      <ul className="mp-salle__pieces">
        {demande.pieces.map((p) => {
          const statut = statutPiece(p.statut);
          const aFournir = p.statut === "demandee" || p.statut === "rejetee";
          return (
            <li
              key={p.id}
              className={
                aFournir && demande.statut === "envoyee"
                  ? "mp-salle__piece mp-salle__piece--a-fournir"
                  : "mp-salle__piece"
              }
            >
              <div className="mp-salle__entete-carte">
                <h2 className="mp-salle__piece-titre">
                  {p.libelle}
                  {p.obligatoire ? null : <span className="mp-texte-doux"> (facultatif)</span>}
                </h2>
                <BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>
              </div>
              {p.description ? <p className="mp-texte-doux">{p.description}</p> : null}
              {p.motif_rejet ? (
                <p className="mp-salle__motif">
                  <strong>Pourquoi déposer de nouveau : </strong>
                  {p.motif_rejet}
                </p>
              ) : null}
              {p.depots.length > 0 ? (
                <ul
                  className="mp-salle__depots"
                  aria-label={`Documents déposés pour « ${p.libelle} »`}
                >
                  {p.depots.map((d) => (
                    <li key={d.id}>
                      <span className="mp-coupure">{d.nom}</span>
                      <span className="mp-texte-doux">
                        {formaterTaille(d.taille)} ·{" "}
                        {d.depose_par_moi ? "par vous" : "par un collègue"}, le{" "}
                        {formaterDateHeure(d.depose_le)}
                      </span>
                      {d.accuse_le ? (
                        <BadgeStatut tonalite="succes">Accusé de réception envoyé</BadgeStatut>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {depotPossible(demande, p) ? (
                <div className="mp-salle__actions">
                  <DepotPiece pieceId={p.id} libelle={p.libelle} redepot={p.statut === "rejetee"} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
