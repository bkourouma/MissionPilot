import Link from "next/link";
import type { ElementReponseCopilote, ReponseCopilote } from "@missionpilot/shared";
import { libelleMode, lienSur } from "../../lib/copilote";

/** Éléments liés d'une réponse : libellés d'entités en texte brut, liens internes seulement. */
export function ListeElements({ elements }: { elements: readonly ElementReponseCopilote[] }) {
  if (elements.length === 0) return null;
  return (
    <ul className="mp-copilote__elements">
      {elements.map((e, i) => (
        <li key={`${e.lien}-${i}`} className="mp-copilote__element">
          <Link href={lienSur(e.lien)}>{e.libelle}</Link>
          {e.detail ? <span className="mp-copilote__detail">{e.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Réponse du copilote : le texte vient du serveur (gabarits du code), affiché tel quel ; la
 * mention du mode (sans IA, avec sa raison) accompagne toujours la réponse d'un routage sans modèle.
 */
export function ReponseVue({ reponse }: { reponse: ReponseCopilote }) {
  const mode = libelleMode(reponse);
  return (
    <>
      <p>{reponse.texte}</p>
      <ListeElements elements={reponse.elements} />
      {mode ? <p className="mp-copilote__mode">{mode}</p> : null}
    </>
  );
}
