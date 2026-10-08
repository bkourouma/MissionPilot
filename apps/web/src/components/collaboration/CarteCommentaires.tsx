import Link from "next/link";
import { aPermission, type Role, type TypeEntiteCollaboration } from "@missionpilot/shared";
import { hrefNouvelleTache } from "../../lib/taches-collaboration";
import { classesBouton } from "../ui/Bouton";
import { Carte } from "../ui/Carte";
import { Icone } from "../ui/Icone";
import { Commentaires } from "./Commentaires";

export interface CarteCommentairesProps {
  entiteType: TypeEntiteCollaboration;
  entiteId: string;
  utilisateur: { id: string; roles: readonly Role[] };
  /** Nom de l'élément pour les noms accessibles (ex. « la facture F-2026-0012 »). */
  nomElement: string;
}

/**
 * Carte « Commentaires » d'une fiche (facture, opportunité, proposition…) avec, pour qui a
 * « tache.assigner », un lien pour assigner une tâche liée à l'élément.
 */
export function CarteCommentaires({
  entiteType,
  entiteId,
  utilisateur,
  nomElement,
}: CarteCommentairesProps) {
  return (
    <Carte
      titre="Commentaires"
      actions={
        aPermission(utilisateur.roles, "tache.assigner") ? (
          <Link
            href={hrefNouvelleTache(entiteType, entiteId)}
            className={classesBouton("secondaire")}
          >
            <Icone nom="taches" />
            <span>Assigner une tâche</span>
            <span className="mp-visuellement-cache">{` liée à ${nomElement}`}</span>
          </Link>
        ) : null
      }
    >
      <Commentaires
        entiteType={entiteType}
        entiteId={entiteId}
        utilisateurId={utilisateur.id}
        associe={utilisateur.roles.includes("associe")}
        niveauTitre={null}
        nomElement={nomElement}
      />
    </Carte>
  );
}
