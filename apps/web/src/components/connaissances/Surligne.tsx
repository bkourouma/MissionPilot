import { segmentsSurlignes } from "../../lib/capitalisation";

/** Texte dont les mots de la requête sont marqués (nœuds texte seulement, jamais de HTML). */
export function Surligne({ texte, q }: { texte: string; q: string }) {
  return (
    <>
      {segmentsSurlignes(texte, q).map((s, i) =>
        s.surligne ? <mark key={i}>{s.texte}</mark> : <span key={i}>{s.texte}</span>,
      )}
    </>
  );
}
